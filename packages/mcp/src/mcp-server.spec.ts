import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { McpServer } from './mcp-server.js';
import type { Tool } from './tool.js';

const echo: Tool = {
  definition: { name: 'echo', title: 'Echo', description: 'Echo back.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  run: async (args, by) => ({ args, by }),
};
const bad: Tool = {
  definition: { name: 'bad', title: 'Bad', description: 'Always fails.', inputSchema: { type: 'object' }, annotations: {} },
  run: async () => {
    throw new BadRequestException(['a is required', 'b must be a string']);
  },
};
const list: Tool = { ...echo, definition: { ...echo.definition, name: 'list' }, run: async () => [1, 2] };

const server = new McpServer({ serverInfo: { name: 'acme', version: '1.0.0' }, instructions: 'Be careful.', tools: [echo, bad, list] });
const rpc = (method: string, params?: Record<string, unknown>, id: number | null = 1) => ({ jsonrpc: '2.0' as const, id: id as number, method, params });

describe('McpServer', () => {
  it('initializes with the requested protocol version when supported, else the newest', async () => {
    const ok = (await server.handleBody(rpc('initialize', { protocolVersion: '2025-03-26' }), 'x')) as any;
    expect(ok.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'acme' }, instructions: 'Be careful.' });
    const unknown = (await server.handleBody(rpc('initialize', { protocolVersion: '1999-01-01' }), 'x')) as any;
    expect(unknown.result.protocolVersion).toBe('2025-11-25');
  });

  it('lists tools and calls them with the attribution', async () => {
    expect(((await server.handleBody(rpc('tools/list'), 'x')) as any).result.tools.map((t: any) => t.name)).toEqual(['echo', 'bad', 'list']);
    const res = (await server.handleBody(rpc('tools/call', { name: 'echo', arguments: { q: 1 } }), 'a@x.com (mcp)')) as any;
    expect(res.result.structuredContent).toEqual({ args: { q: 1 }, by: 'a@x.com (mcp)' });
    expect(JSON.parse(res.result.content[0].text)).toEqual({ args: { q: 1 }, by: 'a@x.com (mcp)' });
  });

  it('wraps non-object results so structuredContent stays an object', async () => {
    const res = (await server.handleBody(rpc('tools/call', { name: 'list' }), 'x')) as any;
    expect(res.result.structuredContent).toEqual({ result: [1, 2] });
  });

  it('returns tool failures as readable results, not protocol errors', async () => {
    const failed = (await server.handleBody(rpc('tools/call', { name: 'bad' }), 'x')) as any;
    expect(failed.result).toEqual({ content: [{ type: 'text', text: 'a is required; b must be a string' }], isError: true });
    const unknown = (await server.handleBody(rpc('tools/call', { name: 'nope' }), 'x')) as any;
    expect(unknown.result).toMatchObject({ isError: true });
    expect(unknown.result.content[0].text).toContain('Unknown tool');
  });

  it('answers unknown methods with -32601, ping with {}, and stays silent for notifications', async () => {
    expect(((await server.handleBody(rpc('nope'), 'x')) as any).error.code).toBe(-32601);
    expect(((await server.handleBody(rpc('ping'), 'x')) as any).result).toEqual({});
    expect(await server.handleBody({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'x')).toBeUndefined();
  });

  it('answers a batch with a batch, skipping notifications', async () => {
    const res = (await server.handleBody([rpc('ping', undefined, 1), { jsonrpc: '2.0', method: 'notifications/x' }, rpc('ping', undefined, 2)], 'x')) as any[];
    expect(res.map((r) => r.id)).toEqual([1, 2]);
  });
});
