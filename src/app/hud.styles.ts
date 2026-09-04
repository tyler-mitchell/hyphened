import { tv } from "@hyphened/ui/tv";

export const HUD_EASE = "cubic-bezier(0.22,1,0.36,1)";

export const hudStyles = tv({
  slots: {
    launcher:
      "pointer-events-auto absolute z-30 size-[42px] rounded-full border-border-control bg-surface-control-panel text-foreground-control-muted shadow-editor-control-collapsed backdrop-blur-editor-control hover:bg-surface-control-panel hover:text-foreground-control",
    panel: `pointer-events-auto absolute z-30 flex max-h-[calc(100%-1.5rem)] w-[320px] flex-col overflow-hidden rounded-[14px] border border-border-control bg-surface-control-panel shadow-editor-control backdrop-blur-editor-control [transition:opacity_250ms_${HUD_EASE},transform_250ms_${HUD_EASE},filter_250ms_${HUD_EASE}] starting:scale-[0.97] starting:opacity-0 starting:blur-[2px]`,
    header:
      "flex h-editor-control-row shrink-0 items-center gap-2 border-b border-surface-control-subtle px-3",
    title: "flex-1 truncate text-[15px] font-semibold text-foreground-control",
    count: "shrink-0 font-mono text-[11px] tabular-nums text-foreground-control-faint",
    field:
      "h-editor-control-row w-full min-w-0 rounded-editor-control border-0 bg-surface-control px-3 text-[13px] font-medium text-foreground-control shadow-none transition-colors duration-150 outline-none placeholder:text-foreground-control-faint hover:bg-surface-control-hover focus:bg-surface-control-hover focus-visible:ring-0 md:text-[13px] dark:bg-surface-control",
    section: "flex shrink-0 flex-col gap-1.5 px-3 pt-2.5 pb-2",
    scroller: "no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2.5",
    empty: "px-4 py-8 text-center text-[13px] font-medium text-foreground-control-faint",
    row: "flex flex-col gap-1 rounded-editor-control px-2.5 py-2 transition-colors duration-150",
    facet: "h-[18px] rounded-md px-1.5 font-mono text-[11px] tabular-nums",
  },
});
