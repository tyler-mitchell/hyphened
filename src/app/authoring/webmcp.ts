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

// Draft-07 writes a tuple as an `items` array. The 2020-12 form (`prefixItems` with `items: false`)
// is refused by the WebMCP polyfill's schema check, which unregisters the tool.
export const webMcpInputSchema = <$>(schema: BaseType<unknown, $>): InputSchema =>
  schema.toJsonSchema({
    fallback: ({ base }) => base,
    target: "draft-07",
  }) as InputSchema;

const unsafePathSegments = new Set(["__proto__", "constructor", "prototype"]);

const pathSegments = (path: string): ReadonlyArray<string> => {
  const segments = path.split(".");
  if (
    path.length === 0 ||
    segments.some((segment) => segment.length === 0 || unsafePathSegments.has(segment))
  ) {
    throw new RangeError(`invalid WebMCP include path "${path}"`);
  }
  return segments;
};

const assignProjection = (
  target: ReadonlyArray<unknown> | Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): ReadonlyArray<unknown> | Readonly<Record<string, unknown>> => {
  if (Array.isArray(target)) {
    if (!/^\d+$/.test(key)) {
      throw new RangeError(`array projection segment "${key}" is not an index`);
    }
    const copy = [...target];
    copy[Number(key)] = value;
    return copy;
  }
  return { ...(target as Readonly<Record<string, unknown>>), [key]: value };
};

const emptyProjection = (
  source: unknown,
): ReadonlyArray<unknown> | Readonly<Record<string, unknown>> => (Array.isArray(source) ? [] : {});

const projectPath = (
  target: ReadonlyArray<unknown> | Readonly<Record<string, unknown>>,
  source: unknown,
  segments: ReadonlyArray<string>,
): ReadonlyArray<unknown> | Readonly<Record<string, unknown>> => {
  const [segment, ...remaining] = segments;
  if (segment === undefined || source === null || typeof source !== "object") return target;
  if (!Object.hasOwn(source, segment)) return target;
  const value = (source as Record<string, unknown>)[segment];
  if (remaining.length === 0) return assignProjection(target, segment, value);
  if (value === null || typeof value !== "object") return assignProjection(target, segment, value);
  const existing = (target as Record<string, unknown>)[segment];
  const childTarget =
    existing !== null && typeof existing === "object"
      ? (existing as ReadonlyArray<unknown> | Readonly<Record<string, unknown>>)
      : emptyProjection(value);
  return assignProjection(target, segment, projectPath(childTarget, value, remaining));
};

export const webMcpFieldSelection = (input: {
  readonly available?: ReadonlyArray<string>;
  readonly defaults: ReadonlyArray<string>;
  readonly include?: Readonly<Record<string, boolean>>;
}) => {
  const paths = Array.from(
    new Set(
      (input.include === undefined
        ? input.defaults
        : Object.entries(input.include).flatMap(([path, enabled]) => (enabled ? [path] : []))
      ).map((path) => {
        pathSegments(path);
        if (
          input.available !== undefined &&
          !input.available.some(
            (available) => available === path || available.startsWith(`${path}.`),
          )
        ) {
          throw new RangeError(`WebMCP result has no field "${path}"`);
        }
        return path;
      }),
    ),
  );
  return {
    includes: (path: string): boolean =>
      paths.some(
        (selected) =>
          selected === path || selected.startsWith(`${path}.`) || path.startsWith(`${selected}.`),
      ),
    paths,
    project: (value: unknown): unknown =>
      paths.reduce<ReadonlyArray<unknown> | Readonly<Record<string, unknown>>>(
        (projected, path) => projectPath(projected, value, pathSegments(path)),
        {},
      ),
    roots: new Set(paths.map((path) => pathSegments(path)[0]!)),
  };
};

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
