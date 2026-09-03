import { tv } from "@hyphened/ui/tv";

export const motionLibraryStyles = tv({
  slots: {
    count: "font-mono text-[9px] tabular-nums text-[var(--editor-text-muted)]",
    empty: "px-3 py-6 text-center text-[10px] text-[var(--editor-text-muted)]",
    filters: "flex shrink-0 flex-col gap-1.5 border-b border-[var(--editor-border)] px-2 py-2",
    header:
      "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-2.5",
    list: "min-h-0 flex-1 overflow-y-auto overscroll-contain",
    root: "pointer-events-auto absolute top-3 left-3 z-30 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-[6px] border border-[var(--editor-border)] bg-[var(--editor-panel)]/95 text-[var(--editor-text)] shadow-[0_10px_30px_rgb(0_0_0/0.45)] backdrop-blur-sm",
    search: "h-7 rounded-[4px] text-[11px]",
    title: "text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--editor-text-secondary)]",
  },
});

export const motionLibraryChipStyles = tv({
  slots: {
    root: "flex flex-wrap gap-1",
    chip: "h-5 rounded-[4px] px-1.5 text-[9px] font-medium tracking-wide uppercase",
  },
  variants: {
    active: {
      true: { chip: "bg-[var(--editor-accent-soft)] text-[var(--editor-text)]" },
      false: { chip: "text-[var(--editor-text-muted)] hover:text-[var(--editor-text-secondary)]" },
    },
  },
  defaultVariants: { active: false },
});

export const motionLibraryEntryStyles = tv({
  slots: {
    caption: "text-[11px] leading-snug text-[var(--editor-text)]",
    facets: "flex flex-wrap items-center gap-1",
    root: "flex flex-col gap-1 border-b border-white/[0.045] px-2.5 py-2 last:border-b-0",
    tags: "font-mono text-[9px] text-[var(--editor-text-muted)]",
  },
});

/**
 * A facet badge. Posture is the one an author acts on, so it carries the accent; the rest stay
 * quiet. Travel reads as a speed, and an in-place caption says so rather than showing a zero.
 */
export const motionLibraryFacetStyles = tv({
  base: "h-4 rounded-[3px] border-transparent px-1 font-mono text-[9px] tabular-nums",
  variants: {
    facet: {
      duration: "bg-white/[0.05] text-[var(--editor-text-muted)]",
      laterality: "bg-white/[0.05] text-[var(--editor-text-muted)]",
      pace: "bg-white/[0.06] text-[var(--editor-text-secondary)]",
      posture: "bg-[var(--editor-accent-soft)] text-[var(--editor-text-secondary)]",
    },
  },
});
