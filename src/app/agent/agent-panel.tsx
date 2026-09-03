// The button subpath is the one component specifier both surfaces of this package carry: the
// workspace maps ./components/* to source, and the published tarball packs button alone. The
// fields below are plain inputs on this file's own slots for the same reason.
import { Button } from "@hyphened/ui/components/button";
import { Bot, Send, X } from "lucide-react";
import { useState } from "react";

import { runAgentExchange, type AgentMessage, type AgentTurn } from "./agent-loop";
import { agentPanelStyles, agentTurnStyles } from "./agent-panel.styles";

const KEY_STORAGE = "ardy.agent.key";

/**
 * Which provider a key belongs to. Anthropic keys carry their own prefix, so the key names its
 * provider and a visitor pastes one without choosing anything. Anything else is treated as OpenAI,
 * which is the other provider the route forwards to.
 */
const providerOfKey = (key: string) => (key.startsWith("sk-ant-") ? "anthropic" : "openai");

const readStoredKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
};

const storeKey = (key: string) => {
  try {
    if (key.length === 0) localStorage.removeItem(KEY_STORAGE);
    else localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // A browser that refuses storage still runs the agent; the key just does not outlive the tab.
  }
};

const AgentTurnView = ({ turn }: { readonly turn: AgentTurn }) => {
  const styles = agentTurnStyles({ speaker: turn.speaker });
  return (
    <article className={styles.root()}>
      {turn.label === undefined ? null : <span className={styles.label()}>{turn.label}</span>}
      {turn.body === undefined ? null : <p className={styles.body()}>{turn.body}</p>}
      {turn.image === undefined ? null : (
        <img alt="Captured from the scene" className={styles.image()} src={turn.image} />
      )}
      {turn.payload === undefined ? null : <pre className={styles.payload()}>{turn.payload}</pre>}
    </article>
  );
};

/**
 * The in-page agent. A judge whose browser has no WebMCP client can still drive the scene by
 * asking for it in words: the panel runs a model against the page's own registered tools and shows
 * every call it makes with its input and its result.
 *
 * The key is the judge's. It is kept in this browser, sent on each request to a route that forwards
 * it once, and never stored on the host.
 */
export const AgentPanel = () => {
  const styles = agentPanelStyles();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(readStoredKey);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ReadonlyArray<AgentTurn>>([]);
  const [history, setHistory] = useState<ReadonlyArray<AgentMessage>>([]);

  const send = async () => {
    const asked = prompt.trim();
    if (asked.length === 0 || key.trim().length === 0 || busy) return;
    setPrompt("");
    setBusy(true);
    setTurns((current) => [...current, { body: asked, id: crypto.randomUUID(), speaker: "person" }]);
    const next = await runAgentExchange({
      history,
      key: key.trim(),
      onTurn: (turn) => {
        setTurns((current) => [...current, turn]);
      },
      prompt: asked,
      provider: providerOfKey(key.trim()),
    }).catch((cause: unknown) => {
      setTurns((current) => [
        ...current,
        {
          body: cause instanceof Error ? cause.message : String(cause),
          id: crypto.randomUUID(),
          speaker: "failure" as const,
        },
      ]);
      return undefined;
    });
    if (next !== undefined) setHistory(next);
    setBusy(false);
  };

  if (!open) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Ask the agent"
        className={styles.root({ className: "size-7 items-center justify-center" })}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Bot />
      </Button>
    );
  }

  return (
    <section className={styles.root()}>
      <header className={styles.header()}>
        <span className={styles.title()}>Ask the agent</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Hide the agent"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X />
        </Button>
      </header>
      <div className={styles.setup()}>
        <input
          className={styles.field()}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Your Anthropic API key, kept in this browser"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            storeKey(event.target.value.trim());
          }}
        />
      </div>
      {turns.length === 0 ? (
        <p className={styles.hint()}>
          This page registers its own tools, so an agent can drive the scene. Try: cover the
          collapse with a crane shot.
        </p>
      ) : (
        <div className={styles.transcript()}>
          {turns.map((turn) => (
            <AgentTurnView key={turn.id} turn={turn} />
          ))}
        </div>
      )}
      <div className={styles.composer()}>
        <input
          className={styles.field()}
          placeholder={busy ? "Working…" : "Ask for a change to the scene"}
          value={prompt}
          disabled={busy}
          onChange={(event) => {
            setPrompt(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void send();
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Send"
          disabled={busy || prompt.trim().length === 0 || key.trim().length === 0}
          onClick={() => {
            void send();
          }}
        >
          <Send />
        </Button>
      </div>
    </section>
  );
};
