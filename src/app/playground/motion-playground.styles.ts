import { tv } from "@hyphened/ui/tv";

import { hudStyles } from "../hud.styles";

export const motionPlaygroundStyles = tv({
  extend: hudStyles,
  slots: {
    root: "flex h-dvh w-screen overflow-hidden bg-background text-foreground-control",
    side: "flex w-[320px] shrink-0 flex-col border-r border-surface-control-subtle bg-surface-control-panel",
    facet: "bg-surface-control text-foreground-control-muted",

    stage: "relative flex min-w-0 flex-1 flex-col",
    stageBar:
      "flex h-editor-control-row shrink-0 items-center gap-2 border-b border-surface-control-subtle bg-surface-control-panel px-3",
    stageBody: "relative min-h-0 flex-1",
    canvas: "block size-full cursor-crosshair touch-none outline-none",
    caption: "min-w-0 flex-1 truncate text-[13px] font-medium text-foreground-control",
    waiting:
      "m-auto max-w-prose p-8 text-center text-[13px] leading-relaxed text-foreground-control-faint",

    capture:
      "pointer-events-auto absolute right-3 bottom-3 z-20 flex w-[240px] flex-col items-start gap-1.5 rounded-[14px] border border-border-control bg-surface-control-panel p-2.5 shadow-editor-control backdrop-blur-editor-control",
    captureNote:
      "font-mono text-[11px] leading-relaxed break-all text-foreground-control-faint underline-offset-2",
    capturePreview: "mt-1 w-full rounded-editor-control border border-surface-control-subtle",
  },
});

export const motionPlaygroundEntryStyles = tv({
  extend: hudStyles,
  slots: {
    row: "w-full cursor-pointer text-left hover:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none",
    facets: "flex flex-wrap items-center gap-1",
  },
  variants: {
    selected: { true: { row: "bg-surface-control-pressed" } },
  },
});
