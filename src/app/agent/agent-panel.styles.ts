import { tv } from "@hyphened/ui/tv";

import { hudStyles } from "../hud.styles";

export const agentPanelStyles = tv({
  extend: hudStyles,
  slots: {
    launcher: "top-3 right-3",
    panel: "top-3 right-3",
    composer:
      "flex shrink-0 items-center gap-1.5 border-t border-surface-control-subtle px-3 py-2.5",
    scroller: "flex flex-col gap-1.5 px-1.5 py-2",
  },
});

export const agentTurnStyles = tv({
  slots: {
    root: "flex flex-col gap-1 rounded-editor-control px-2.5 py-2 text-[13px] leading-[17px]",
    label: "font-mono text-[11px] tracking-wide text-foreground-control-faint uppercase",
    body: "font-medium whitespace-pre-wrap",
    image: "mt-1 w-full rounded-editor-control border border-surface-control-subtle",
    payload:
      "no-scrollbar mt-1 max-h-36 overflow-auto rounded-editor-control bg-surface-control px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground-control-faint",
  },
  variants: {
    speaker: {
      agent: { root: "bg-surface-control text-foreground-control" },
      failure: { root: "bg-destructive/15 text-foreground-control" },
      person: { root: "bg-surface-control-pressed text-foreground-control" },
      tool: { root: "border border-surface-control-subtle text-foreground-control-muted" },
    },
  },
  defaultVariants: { speaker: "agent" },
});
