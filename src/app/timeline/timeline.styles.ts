import { tv } from "@hyphened/ui/tv";

export const timelineRootStyles = tv({
  base: "flex min-h-0 flex-1 select-none flex-col overflow-hidden border-t border-[var(--editor-border)] bg-[var(--editor-canvas)] text-[var(--editor-text)] data-[density=compact]:text-[11px] data-[density=comfortable]:text-xs [&_input]:select-text [&_textarea]:select-text",
});

export const timelinePanelStyles = tv({
  base: "flex min-w-0 flex-1 flex-col overflow-hidden",
});

export const timelineHeaderStyles = tv({
  slots: {
    composition: "max-w-36 truncate font-mono",
    label: "px-1 text-[9px] font-semibold uppercase text-[var(--editor-text-muted)]",
    menu: "w-44",
    primary: "flex items-center gap-1",
    root: "flex h-11 shrink-0 items-center justify-between border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-2",
    semantic:
      "border-[var(--editor-accent)]/25 bg-[var(--editor-accent-soft)] text-[var(--editor-text)]",
    status: "flex items-center gap-1.5 text-[9px] text-[#6f7b8d]",
  },
});

export const timelineViewportStyles = tv({
  base: "relative min-h-0 flex-1 touch-none overflow-x-hidden overflow-y-auto bg-[var(--editor-canvas)] overscroll-contain data-[panning]:cursor-grabbing",
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
      "relative z-[1] min-w-0 overflow-hidden border-b border-white/[0.055] bg-transparent transition-opacity has-[[data-dragging]]:z-20 has-[[data-dragging]]:overflow-visible",
    content: "min-w-0 flex-1",
    header:
      "sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-2.5",
    icon: "size-3.5 text-[#7e899a]",
    isolation:
      "inline-flex size-6 items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-[#687586] outline-none hover:bg-white/5 hover:text-[#d7e1ed] focus-visible:ring-1 focus-visible:ring-[#9bd1ff] aria-pressed:bg-white/10 aria-pressed:text-[#d7e1ed] [&_svg]:size-3.5",
    label: "min-w-0 flex-1 truncate font-medium text-[var(--editor-text-secondary)]",
    root: "grid h-[var(--timeline-track-height)] grid-cols-[var(--timeline-label-width)_minmax(0,1fr)] data-[dimmed]:[&_[data-slot=track-canvas]]:opacity-25 data-[dimmed]:[&_[data-slot=track-header]]:opacity-45 data-[focused]:[&_[data-slot=track-canvas]]:bg-[var(--editor-surface)] data-[focused]:[&_[data-slot=track-header]]:bg-[var(--editor-control)] data-[focused]:[&_[data-slot=track-header]]:text-white data-[selected]:[&_[data-slot=track-header]]:bg-[var(--editor-control)] data-[dragging]:opacity-85",
    secondary: "truncate font-mono text-[9px] text-[var(--editor-text-muted)]",
  },
});

export const timelineGroupStyles = tv({
  slots: {
    canvas: "border-b border-[var(--editor-border)] bg-[var(--editor-surface)]/80",
    disclosure:
      "grid size-5 shrink-0 place-items-center border-0 bg-transparent p-0 text-[#748195] outline-none hover:text-[#d7e0ec] focus-visible:ring-1 focus-visible:ring-[#8dc8ff] [&_svg]:size-3.5",
    header:
      "sticky left-0 z-20 flex min-w-0 items-center gap-1 border-r border-b border-[var(--editor-border)] bg-[var(--editor-surface)] pr-2 pl-[calc(0.375rem+var(--timeline-group-depth)*0.75rem)] text-left hover:bg-[var(--editor-control)] data-[selected]:bg-[var(--editor-control)]",
    label:
      "min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--editor-text-secondary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--editor-info)]",
    root: "grid h-[var(--timeline-track-height)] grid-cols-[var(--timeline-label-width)_minmax(0,1fr)] data-[dragging]:opacity-85",
  },
});

export const timelineTransitionStyles = tv({
  slots: {
    label:
      "relative z-[1] max-w-full truncate rounded-sm bg-[var(--editor-canvas)]/80 px-1 font-mono text-[8px] text-[var(--editor-text)]",
    root: "group absolute top-1/2 z-[8] flex h-4 min-w-2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-[3px] border border-[#b8a7ff]/55 bg-[linear-gradient(115deg,rgb(71_57_130/0.9),rgb(38_85_115/0.84))] shadow-[0_0_0_1px_rgb(8_12_18/0.7),0_3px_10px_rgb(0_0_0/0.4)] outline-none before:absolute before:inset-0 before:bg-[repeating-linear-gradient(120deg,transparent_0,transparent_5px,rgb(255_255_255/0.09)_5px,rgb(255_255_255/0.09)_6px)] hover:brightness-115 data-[dragging]:z-20 data-[dragging]:brightness-125 data-[pending]:opacity-90 data-[selected]:border-[#e0d8ff] data-[selected]:shadow-[0_0_0_1px_rgb(224_216_255/0.7),0_5px_16px_rgb(65_45_145/0.55)] focus-visible:ring-2 focus-visible:ring-[#a78bfa]",
  },
});

export const timelineRulerStyles = tv({
  slots: {
    corner:
      "sticky left-0 z-30 flex items-center border-r border-[var(--editor-border)] bg-[var(--editor-panel)] px-3 text-[10px] font-medium uppercase text-[var(--editor-text-muted)]",
    root: "sticky top-0 z-20 grid h-8 min-w-full bg-[var(--editor-panel)]",
    surface: "relative cursor-grab overflow-hidden data-[panning]:cursor-grabbing",
    tick: "absolute inset-y-0 border-l border-[var(--editor-border)] pt-1.5 pl-1.5 font-mono text-[9px] tabular-nums text-[var(--editor-text-muted)] data-[major]:border-[var(--editor-border-strong)] data-[major]:text-[var(--editor-text-secondary)]",
  },
});

export const timelineScrubAreaStyles = tv({
  slots: {
    corner: "sticky left-0 z-30 border-r border-[var(--editor-border)] bg-[var(--editor-panel)]",
    handle:
      "pointer-events-none absolute top-0 left-0 h-3 w-3 -translate-x-1/2 rounded-b-[4px] bg-[var(--editor-accent)] shadow-[0_0_12px_rgb(155_135_245/0.55)]",
    hover: "pointer-events-none absolute inset-y-0 w-px bg-white/35",
    hoverLabel:
      "pointer-events-none absolute top-full z-50 mt-1 -translate-x-1/2 rounded-[3px] border border-[var(--editor-border)] bg-[var(--editor-surface)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--editor-text-secondary)] shadow-lg",
    root: "sticky top-8 z-20 grid h-3 min-w-full border-b border-[var(--editor-border)] bg-[var(--editor-surface)]",
    surface:
      "relative cursor-ew-resize overflow-visible outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#a78bfa]/70 data-[scrubbing]:bg-[#a78bfa]/[0.06]",
  },
});

export const timelinePlayheadStyles = tv({
  slots: {
    line: "pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[var(--editor-accent)] shadow-[0_0_8px_rgb(155_135_245/0.45)]",
    root: "absolute inset-y-0 z-40 w-3 -translate-x-1/2 touch-none cursor-ew-resize outline-none focus-visible:bg-[var(--editor-accent)]/10",
  },
});

export const timelineSnapGuideStyles = tv({
  slots: {
    line: "absolute inset-y-0 left-1/2 w-px bg-cyan-300/75 shadow-[0_0_7px_rgb(103_232_249/0.35)]",
    root: "pointer-events-none absolute inset-y-0 z-30 w-px -translate-x-1/2",
  },
});

export const timelineSelectionAreaStyles = tv({
  slots: {
    box: "pointer-events-none absolute z-50 border border-cyan-300/80 bg-cyan-300/10 shadow-[0_0_14px_rgb(103_232_249/0.16)]",
    root: "relative min-w-full select-none data-[selecting]:cursor-crosshair",
  },
});
