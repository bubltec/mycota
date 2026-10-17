/** A tool: JSON Schema input, written for the model that calls it, and what it does. `by` is the attribution string for writes. */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

/** A tool: its definition, and what it does. */
export interface Tool {
  definition: ToolDefinition;
  run(args: Record<string, unknown>, by: string): Promise<unknown>;
}
