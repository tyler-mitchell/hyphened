import { tv } from "@hyphened/ui/tv";

export const agentPanelStyles = tv({
  slots: {
    composer: "flex shrink-0 items-end gap-1.5 border-t border-[var(--editor-border)] px-2 py-2",
    field:
      "h-7 w-full min-w-0 rounded-[4px] border border-[var(--editor-border)] bg-[var(--editor-canvas)] px-2 text-[11px] text-[var(--editor-text)] outline-none transition-colors placeholder:text-[var(--editor-text-muted)] focus-visible:border-[var(--editor-info)] focus-visible:ring-1 focus-visible:ring-[var(--editor-info)]/50",
    header:
      "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-2.5",
    hint: "px-3 py-6 text-center text-[10px] leading-relaxed text-[var(--editor-text-muted)]",
    root: "pointer-events-auto absolute top-3 right-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-[6px] border border-[var(--editor-border)] bg-[var(--editor-panel)]/95 text-[var(--editor-text)] shadow-[0_10px_30px_rgb(0_0_0/0.45)] backdrop-blur-sm",
    setup: "flex shrink-0 flex-col gap-1.5 border-b border-[var(--editor-border)] px-2 py-2",
    title: "text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--editor-text-secondary)]",
    transcript: "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2.5 py-2",
  },
});

/** One turn in the transcript. A tool call reads as a record of what the agent did, not as chat. */
export const agentTurnStyles = tv({
  slots: {
    body: "whitespace-pre-wrap",
    image: "mt-1 w-full rounded-[3px] border border-[var(--editor-border)]",
    label: "font-mono text-[9px] tracking-wide uppercase opacity-70",
    payload:
      "mt-1 max-h-32 overflow-auto rounded-[3px] bg-[var(--editor-canvas)] px-1.5 py-1 font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-[var(--editor-text-muted)]",
    root: "flex flex-col gap-0.5 rounded-[4px] px-2 py-1.5 text-[11px] leading-snug",
  },
  variants: {
    speaker: {
      agent: { root: "bg-white/[0.04] text-[var(--editor-text)]" },
      failure: { root: "bg-[var(--editor-danger)]/12 text-[var(--editor-text)]" },
      person: { root: "bg-[var(--editor-accent-soft)] text-[var(--editor-text)]" },
      tool: { root: "border border-[var(--editor-border)] text-[var(--editor-text-secondary)]" },
    },
  },
  defaultVariants: { speaker: "agent" },
});
