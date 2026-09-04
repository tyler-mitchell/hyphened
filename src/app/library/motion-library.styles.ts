import { tv } from "@hyphened/ui/tv";

/**
 * What the palette overrides on `@hyphened/ui`'s command component: the HUD's type scale, its
 * monospaced numerals, and a fixed height so the dialog never grows over the timeline. Layout,
 * filtering, grouping and keyboard selection belong to the component.
 */
export const motionLibraryStyles = tv({
  slots: {
    launcher:
      "pointer-events-auto absolute top-3 left-3 z-30 h-editor-control-row gap-2 rounded-full border-border-control bg-surface-control-panel pr-2 pl-3 text-[13px] text-foreground-control-muted shadow-editor-control-collapsed backdrop-blur-editor-control hover:bg-surface-control-panel hover:text-foreground-control",
    shortcut:
      "rounded-md bg-surface-control px-1.5 py-0.5 font-mono text-[11px] text-foreground-control-faint",

    dialog: "h-[420px]",
    search: "h-12 text-[15px] font-medium",

    filters: "no-scrollbar w-auto shrink-0 gap-1 overflow-x-auto border-b px-2 py-2",
    chip: "shrink-0 rounded-md px-2 text-[13px] font-medium whitespace-nowrap",
    chipCount: "font-mono text-[11px] tabular-nums opacity-50",

    list: "no-scrollbar px-2 py-2",
    group: "border-none p-0",
    groupLabel:
      "sticky top-0 z-[1] bg-popover px-2 pt-3 pb-1.5 font-mono text-[11px] tracking-[0.08em] uppercase",
    item: "items-baseline gap-3 rounded-editor-control px-2 py-2",
    caption: "min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium",
    meta: "flex shrink-0 items-baseline gap-2 font-mono text-[11px] tabular-nums text-muted-foreground",
    posture: "text-foreground",
    empty: "text-[13px] font-medium",

    footer:
      "flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5 font-mono text-[11px] text-muted-foreground",
    hints: "flex items-center gap-3",
  },
});
