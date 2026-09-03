/**
 * The in-page agent's model loop. It reads the page's registered tools from the WebMCP surface and
 * executes them through that same surface, so this is another caller of the product's tools rather
 * than a second path to them. A judge whose browser has no WebMCP client gets the tool surface
 * anyway, because the polyfill installs a context when the browser has none.
 */
export type AgentSpeaker = "agent" | "failure" | "person" | "tool";

export interface AgentTurn {
  readonly body?: string;
  readonly id: string;
  readonly label?: string;
  readonly payload?: string;
  readonly speaker: AgentSpeaker;
}

/** One Anthropic message. Content is the provider's own block union, carried but never inspected. */
export interface AgentMessage {
  readonly content: unknown;
  readonly role: "assistant" | "user";
}

interface ToolUseBlock {
  readonly id: string;
  readonly input: unknown;
  readonly name: string;
  readonly type: "tool_use";
}

interface TextBlock {
  readonly text: string;
  readonly type: "text";
}

type ContentBlock = TextBlock | ToolUseBlock | { readonly type: string };

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;
/** A turn that keeps asking for tools past this has lost the thread; stop rather than loop. */
const MAX_TOOL_ROUNDS = 8;

const isToolUse = (block: ContentBlock): block is ToolUseBlock => block.type === "tool_use";
const isText = (block: ContentBlock): block is TextBlock => block.type === "text";

const readBlocks = (content: unknown): ReadonlyArray<ContentBlock> =>
  Array.isArray(content) ? (content as ReadonlyArray<ContentBlock>) : [];

/**
 * The WebMCP surface carries a tool's input schema as a JSON string, while the model wants the
 * object. A tool whose schema is absent or unreadable still gets offered, taking no arguments,
 * rather than being hidden from the agent.
 */
const EMPTY_SCHEMA = { properties: {}, type: "object" };

const readSchema = (schema: string | undefined): unknown => {
  if (schema === undefined) return EMPTY_SCHEMA;
  try {
    return JSON.parse(schema);
  } catch {
    return EMPTY_SCHEMA;
  }
};

/** The page's tools, in the shape the model expects them. */
const readTools = async () => {
  const context = document.modelContext;
  if (context === undefined) return [];
  const tools = await context.getTools();
  return tools.map((tool) => ({
    description: tool.description,
    input_schema: readSchema(tool.inputSchema),
    name: tool.name,
    tool,
  }));
};

const callModel = async (input: {
  readonly body: unknown;
  readonly key: string;
  readonly provider: string;
}) => {
  const response = await fetch("/api/agent", {
    body: JSON.stringify(input.body),
    headers: {
      "content-type": "application/json",
      "x-agent-key": input.key,
      "x-agent-provider": input.provider,
    },
    method: "POST",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 400));
  return JSON.parse(text) as { readonly content?: unknown; readonly stop_reason?: string };
};

/**
 * Run one exchange to completion: the model answers, and while it asks for tools they are executed
 * on the page and handed back. Every tool call is reported as it happens, so the transcript shows
 * what the agent did to the scene and not only what it said.
 */
export const runAgentExchange = async (input: {
  readonly history: ReadonlyArray<AgentMessage>;
  readonly key: string;
  readonly onTurn: (turn: AgentTurn) => void;
  readonly prompt: string;
  readonly provider: string;
}): Promise<ReadonlyArray<AgentMessage>> => {
  const available = await readTools();
  const tools = available.map(({ description, input_schema, name }) => ({
    description,
    input_schema,
    name,
  }));

  const advance = async (
    messages: ReadonlyArray<AgentMessage>,
    round: number,
  ): Promise<ReadonlyArray<AgentMessage>> => {
    const answer = await callModel({
      body: { max_tokens: MAX_TOKENS, messages, model: MODEL, tools },
      key: input.key,
      provider: input.provider,
    });
    const blocks = readBlocks(answer.content);
    const spoken = blocks.filter(isText).map(({ text }) => text).join("\n").trim();
    if (spoken.length > 0) {
      input.onTurn({ body: spoken, id: crypto.randomUUID(), speaker: "agent" });
    }
    const requested = blocks.filter(isToolUse);
    const withAnswer = [...messages, { content: answer.content, role: "assistant" as const }];
    if (requested.length === 0) return withAnswer;
    if (round >= MAX_TOOL_ROUNDS) {
      input.onTurn({
        body: `The agent asked for tools ${String(MAX_TOOL_ROUNDS)} times without finishing; the exchange stopped here.`,
        id: crypto.randomUUID(),
        speaker: "failure",
      });
      return withAnswer;
    }

    const results = await Promise.all(
      requested.map(async (block) => {
        const known = available.find(({ name }) => name === block.name);
        if (known === undefined) {
          return { content: `"${block.name}" is not registered on this page.`, id: block.id };
        }
        // executeTool takes its arguments as a JSON string, not an object.
        const outcome = await document
          .modelContext!.executeTool(known.tool, JSON.stringify(block.input ?? {}))
          .then(
            (value) => value ?? "",
            (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
          );
        input.onTurn({
          id: crypto.randomUUID(),
          label: block.name,
          payload: `${JSON.stringify(block.input ?? {}, undefined, 2)}\n→ ${outcome}`,
          speaker: "tool",
        });
        return { content: outcome, id: block.id };
      }),
    );

    return advance(
      [
        ...withAnswer,
        {
          content: results.map(({ content, id }) => ({
            content,
            tool_use_id: id,
            type: "tool_result",
          })),
          role: "user" as const,
        },
      ],
      round + 1,
    );
  };

  return advance([...input.history, { content: input.prompt, role: "user" }], 0);
};
