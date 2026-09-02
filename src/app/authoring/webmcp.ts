import type {
  CallToolResult,
  ContentBlock,
  InputSchema,
  JsonSchemaForInference,
  JsonValue,
  ModelContextClient,
  ToolAnnotations,
} from "@mcp-b/webmcp-types";
import type { BaseType } from "arktype";

export type WebMcpToolResult = Omit<CallToolResult, "content"> & { content: ContentBlock[] };

export interface RegisteredWebMcpTool {
  readonly annotations?: ToolAnnotations;
  readonly description: string;
  readonly execute: (input: unknown, client: ModelContextClient) => Promise<WebMcpToolResult>;
  readonly inputSchema: InputSchema;
  readonly name: string;
  readonly outputSchema?: JsonSchemaForInference;
}

export const webMcpInputSchema = <$>(schema: BaseType<unknown, $>): InputSchema =>
  schema.toJsonSchema({
    fallback: ({ base }) => base,
  }) as InputSchema;

export const webMcpResult = (value: unknown): WebMcpToolResult => ({
  content: [],
  structuredContent: JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? current.toString() : current,
    ),
  ) as JsonValue,
});

export const webMcpResourceResult = (input: {
  readonly mimeType: string;
  readonly name: string;
  readonly uri: string;
  readonly value?: unknown;
}): WebMcpToolResult => ({
  ...(input.value === undefined ? {} : webMcpResult(input.value)),
  content: [
    {
      mimeType: input.mimeType,
      name: input.name,
      type: "resource_link",
      uri: input.uri,
    },
  ],
});
