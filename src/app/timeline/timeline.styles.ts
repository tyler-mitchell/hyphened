import { tv } from "@hyphened/ui/tv";

export const timelineRootStyles = tv({
  base: "flex min-h-0 flex-1 flex-col overflow-hidden border-t border-surface-control-subtle bg-background text-foreground-control select-none data-[density=comfortable]:text-[13px] data-[density=compact]:text-[12px] [&_input]:select-text [&_textarea]:select-text",
});

export const timelinePanelStyles = tv({
  base: "flex min-w-0 flex-1 flex-col overflow-hidden",
});

export const timelineHeaderStyles = tv({
  slots: {
    composition: "max-w-36 truncate font-mono text-[11px] text-foreground-control-muted",
    label: "px-1 text-[11px] font-medium text-foreground-control-faint",
    menu: "w-44",
    primary: "flex items-center gap-1",
    root: "flex h-editor-control-row shrink-0 items-center justify-between border-b border-surface-control-subtle bg-surface-control-panel px-2",
    semantic: "border-transparent bg-surface-control-pressed text-foreground-control",
    status: "flex items-center gap-1.5 font-mono text-[11px] text-foreground-control-faint",
  },
});

export const timelineViewportStyles = tv({
  base: "no-scrollbar relative min-h-0 flex-1 touch-none overflow-x-hidden overflow-y-auto overscroll-contain bg-background data-[panning]:cursor-grabbing",
});

export const timelineTrackListStyles = tv({
  slots: {
    root: "relative min-w-full pb-3 [--timeline-lane-inset:6px]",
    row: "absolute top-0 left-0 z-[1] w-full has-[[data-dragging]]:z-20",
  },
});

export const timelineTrackStyles = tv({
  slots: {
    actions: "flex items-center gap-0.5",
    canvas:
      "relative z-[1] min-w-0 overflow-hidden border-b border-surface-control-subtle bg-transparent transition-opacity has-[[data-dragging]]:z-20 has-[[data-dragging]]:overflow-visible",
    content: "min-w-0 flex-1",
    header:
      "sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-b border-surface-control-subtle bg-surface-control-panel px-2.5",
    icon: "size-3.5 text-foreground-control-faint",
    isolation:
      "inline-flex size-6 cursor-pointer items-center justify-center rounded-editor-control border-0 bg-transparent p-0 text-foreground-control-faint outline-none transition-colors duration-150 hover:bg-surface-control hover:text-foreground-control focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-surface-control-pressed aria-pressed:text-foreground-control [&_svg]:size-3.5",
    label: "min-w-0 flex-1 truncate text-[13px] font-medium text-foreground-control-muted",
    root: "grid h-[var(--timeline-track-height)] grid-cols-[var(--timeline-label-width)_minmax(0,1fr)] data-[dimmed]:[&_[data-slot=track-canvas]]:opacity-25 data-[dimmed]:[&_[data-slot=track-header]]:opacity-45 data-[focused]:[&_[data-slot=track-canvas]]:bg-surface-control/40 data-[focused]:[&_[data-slot=track-header]]:bg-surface-control data-[focused]:[&_[data-slot=track-header]]:text-foreground-control data-[selected]:[&_[data-slot=track-header]]:bg-surface-control data-[dragging]:opacity-85",
    secondary: "truncate font-mono text-[11px] text-foreground-control-faint",
  },
});

export const timelineGroupStyles = tv({
  slots: {
    canvas: "border-b border-surface-control-subtle bg-surface-control/30",
    disclosure:
      "grid size-5 shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-foreground-control-faint outline-none transition-colors duration-150 hover:text-foreground-control focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3.5",
    header:
      "sticky left-0 z-20 flex w-full min-w-0 items-center gap-1 border-r border-b border-surface-control-subtle bg-surface-control-panel pr-2 pl-[calc(0.375rem+var(--timeline-group-depth)*0.75rem)] text-left transition-colors duration-150 hover:bg-surface-control data-[selected]:bg-surface-control",
    label:
      "min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left font-mono text-[11px] tracking-[0.08em] text-foreground-control-faint uppercase outline-none focus-visible:ring-1 focus-visible:ring-ring",
    root: "grid h-[var(--timeline-track-height)] grid-cols-[var(--timeline-label-width)_minmax(0,1fr)] data-[dragging]:opacity-85",
  },
});

export const timelineTransitionStyles = tv({
  slots: {
    label:
      "relative z-[1] max-w-full truncate rounded-sm bg-background/80 px-1 font-mono text-[11px] text-foreground-control",
    root: "group absolute top-1/2 z-[8] flex h-4 min-w-2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-editor-control border border-primary/50 bg-primary/20 outline-none transition-[filter,box-shadow] duration-150 hover:brightness-115 data-[dragging]:z-20 data-[dragging]:brightness-125 data-[pending]:opacity-90 data-[selected]:border-primary data-[selected]:shadow-[0_0_0_1px_var(--color-primary)] focus-visible:ring-2 focus-visible:ring-ring",
  },
});

export const timelineRulerStyles = tv({
  slots: {
    corner:
      "sticky left-0 z-30 flex items-center border-r border-surface-control-subtle bg-surface-control-panel px-3 font-mono text-[11px] text-foreground-control-faint uppercase",
    root: "sticky top-0 z-20 grid h-8 min-w-full bg-surface-control-panel",
    surface: "relative cursor-grab overflow-hidden data-[panning]:cursor-grabbing",
    tick: "absolute inset-y-0 border-l border-surface-control-subtle pt-1.5 pl-1.5 font-mono text-[11px] tabular-nums text-foreground-control-faint data-[major]:border-border data-[major]:text-foreground-control-muted",
  },
});

export const timelineScrubAreaStyles = tv({
  slots: {
    corner: "sticky left-0 z-30 border-r border-surface-control-subtle bg-surface-control-panel",
    handle:
      "pointer-events-none absolute top-0 left-0 h-3 w-3 -translate-x-1/2 rounded-b-[4px] bg-editor-accent shadow-editor-accent-glow",
    hover: "pointer-events-none absolute inset-y-0 w-px bg-foreground-control/35",
    hoverLabel:
      "pointer-events-none absolute top-full z-50 mt-1 -translate-x-1/2 rounded-editor-control border border-surface-control-subtle bg-surface-control-panel px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground-control-muted shadow-editor-control",
    root: "sticky top-8 z-20 grid h-3 min-w-full border-b border-surface-control-subtle bg-surface-control-panel",
    surface:
      "relative cursor-ew-resize overflow-visible outline-none transition-colors duration-150 hover:bg-surface-control/40 focus-visible:bg-surface-control focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-[scrubbing]:bg-primary/10",
  },
});

export const timelinePlayheadStyles = tv({
  slots: {
    line: "pointer-events-none absolute inset-y-0 left-1/2 w-px bg-editor-accent shadow-editor-accent-glow",
    root: "absolute inset-y-0 z-40 w-3 -translate-x-1/2 touch-none cursor-ew-resize outline-none focus-visible:bg-editor-accent/10",
  },
});

export const timelineSnapGuideStyles = tv({
  slots: {
    line: "absolute inset-y-0 left-1/2 w-px bg-ring",
    root: "pointer-events-none absolute inset-y-0 z-30 w-px -translate-x-1/2",
  },
});

export const timelineSelectionAreaStyles = tv({
  slots: {
    box: "pointer-events-none absolute z-50 rounded-editor-control border border-ring bg-ring/10",
    root: "relative min-w-full select-none data-[selecting]:cursor-crosshair",
  },
});
