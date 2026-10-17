import type { Tool, ToolDefinition } from './tool.js';

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpServerOptions {
  serverInfo: { name: string; title?: string; version: string };
  /** Shown to the model on connect: how to use this server's tools. */
  instructions: string;
  tools: Tool[];
}

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

class MethodNotFound extends Error {}

/**
 * MCP over request/response JSON-RPC (Streamable HTTP without server-initiated
 * messages, so no SSE), hand-rolled because the official SDK's transports
 * assume a long-lived server. Framework-free: the Nest controller feeds it
 * parsed bodies, and tests can call it directly.
 */
export class McpServer {
  private readonly tools: Map<string, Tool>;

  constructor(private readonly options: McpServerOptions) {
    this.tools = new Map(options.tools.map((t) => [t.definition.name, t]));
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /**
   * Handles one body, which is a message or a batch. Returns what to send back,
   * or undefined when there is nothing to say (notifications only): reply 202.
   */
  async handleBody(body: JsonRpcMessage | JsonRpcMessage[], by: string): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
    const batch = Array.isArray(body);
    const responses: JsonRpcResponse[] = [];
    for (const message of batch ? body : [body]) {
      if (!message || typeof message !== 'object') continue;
      if (message.id === undefined || message.id === null) continue; // notification
      try {
        responses.push({ jsonrpc: '2.0', id: message.id, result: await this.dispatch(message.method, message.params ?? {}, by) });
      } catch (err) {
        responses.push({ jsonrpc: '2.0', id: message.id, error: { code: err instanceof MethodNotFound ? -32601 : -32603, message: errorMessage(err) } });
      }
    }
    if (responses.length === 0) return undefined;
    return batch ? responses : responses[0];
  }

  private async dispatch(method: string, params: Record<string, unknown>, by: string): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.options.serverInfo,
          instructions: this.options.instructions,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: this.listTools() };
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string') throw new Error('tools/call requires a name');
        try {
          const tool = this.tools.get(name);
          if (!tool) throw new Error(`Unknown tool: ${name}`);
          const result = await tool.run((params.arguments ?? {}) as Record<string, unknown>, by);
          return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: wrap(result) };
        } catch (err) {
          // Tool failures go back to the model as results it can read and correct.
          return { content: [{ type: 'text', text: errorMessage(err) }], isError: true };
        }
      }
      default:
        throw new MethodNotFound(`Unknown method: ${method}`);
    }
  }
}

function wrap(result: unknown): Record<string, unknown> {
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : { result };
}

/** Nest HttpExceptions carry their message in `response.message` (a string or a list). */
export function errorMessage(err: unknown): string {
  const response = (err as { response?: { message?: unknown } })?.response;
  if (response?.message) return Array.isArray(response.message) ? response.message.join('; ') : String(response.message);
  return err instanceof Error ? err.message : 'Tool call failed';
}
