import { tv } from "@hyphened/ui/tv";

export const timelineItemStyles = tv({
  base: "group absolute inset-y-[var(--timeline-lane-inset)] z-[2] flex min-w-[6px] touch-none cursor-grab items-center overflow-hidden rounded-editor-control border px-2 text-left text-[13px] font-medium shadow-sm outline-none transition-[filter,box-shadow,border-color,opacity] duration-150 select-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-[dragging]:pointer-events-none data-[dragging]:z-20 data-[dragging]:brightness-115 data-[dragging]:shadow-editor-control data-[resizing]:z-20 data-[resizing]:brightness-115 data-[resizing]:shadow-editor-control data-[pending]:opacity-90",
  variants: {
    status: {
      loading:
        "border-surface-control-subtle bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.05)_0,rgb(255_255_255/0.05)_5px,transparent_5px,transparent_10px)] text-foreground-control-faint",
      ready: "",
    },
    selected: {
      true: "z-[10] border-foreground-control/70 shadow-editor-control",
    },
    /** A constraint family reads by colour before its label is legible at overview zoom. */
    tone: {
      "prompt-0": "border-[#4aa8f2]/40 bg-[#153954] text-[#c7e9ff]",
      "prompt-1": "border-[#ef6a72]/45 bg-[#4a2028] text-[#ffd3d6]",
      "prompt-2": "border-[#3fbf87]/45 bg-[#16382a] text-[#c2f3dc]",
      "prompt-3": "border-[#c874e0]/45 bg-[#3d1f45] text-[#f2d0ff]",
      "full-body": "border-[#e08a3c]/45 bg-[#4a3018] text-[#ffdcb4]",
      root: "border-[#a284f0]/45 bg-[#2e2350] text-[#ded1ff]",
      "left-hand": "border-[#3fbf87]/45 bg-[#16382a] text-[#c2f3dc]",
      "right-hand": "border-[#ef6a92]/45 bg-[#45202f] text-[#ffd0de]",
      "left-foot": "border-[#e0a03c]/45 bg-[#453418] text-[#ffe6b4]",
      "right-foot": "border-[#8f7ce8]/45 bg-[#2a2448] text-[#d8d0ff]",
      unknown: "border-surface-control-subtle bg-surface-control text-foreground-control",
    },
  },
  defaultVariants: { status: "ready", tone: "unknown" },
});

export const timelineItemContentStyles = tv({
  slots: {
    label: "relative z-[1] min-w-0 flex-1 truncate font-medium",
    subtitle: "relative z-[1] ml-2 truncate font-mono text-[11px] tabular-nums opacity-55",
  },
});

export const timelineItemResizeHandleStyles = tv({
  base: "absolute inset-y-0 z-20 w-2.5 cursor-ew-resize touch-none border-0 bg-transparent p-0 opacity-0 outline-none transition-opacity duration-150 before:absolute before:inset-y-1.5 before:w-px before:bg-foreground-control/75 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset data-[edge=end]:right-0 data-[edge=end]:before:right-0.5 data-[edge=start]:left-0 data-[edge=start]:before:left-0.5",
});

export const timelineOccurrenceSummaryStyles = tv({
  slots: {
    count:
      "relative z-[1] rounded-sm bg-background/75 px-1 font-mono text-[11px] tabular-nums text-foreground-control-muted",
    root: "absolute inset-y-1 z-[3] min-w-2 overflow-hidden rounded-editor-control border border-surface-control-subtle bg-surface-control/70 text-left outline-none transition-[filter,border-color] duration-150 before:absolute before:inset-0 before:bg-[repeating-linear-gradient(90deg,transparent_0,transparent_3px,rgb(255_255_255/0.08)_3px,rgb(255_255_255/0.08)_4px)] hover:border-border hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring",
  },
  variants: {
    selected: {
      true: { root: "border-foreground-control/70 shadow-editor-control" },
    },
  },
});

export const timelinePointStyles = tv({
  slots: {
    dot: "size-2.5 rotate-45 rounded-[2px] border shadow-[0_0_10px_currentColor]",
    root: "absolute inset-y-0 z-[4] -translate-x-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[dragging]:pointer-events-none data-[dragging]:z-20 data-[dragging]:brightness-125 data-[pending]:opacity-90",
    stem: "absolute top-1/2 bottom-0 left-1/2 w-px bg-current opacity-65",
  },
  variants: {
    status: { loading: { root: "opacity-50" }, ready: {} },
    selected: {
      true: {
        dot: "border-foreground-control",
        root: "z-[6] scale-125 drop-shadow-[0_0_5px_rgb(255_255_255/0.7)]",
      },
    },
    tone: {
      "prompt-0": { dot: "border-[#8acbff] bg-[#298ad5] text-[#298ad5]", root: "text-[#298ad5]" },
      "prompt-1": { dot: "border-[#ff9ca3] bg-[#dc4c57] text-[#dc4c57]", root: "text-[#dc4c57]" },
      "prompt-2": { dot: "border-[#8ce9c0] bg-[#25a877] text-[#25a877]", root: "text-[#25a877]" },
      "prompt-3": { dot: "border-[#e9a8f5] bg-[#a850c4] text-[#a850c4]", root: "text-[#a850c4]" },
      "full-body": { dot: "border-[#ffc98a] bg-[#d9822b] text-[#d9822b]", root: "text-[#d9822b]" },
      root: { dot: "border-[#c4b0ff] bg-[#7c5cd6] text-[#7c5cd6]", root: "text-[#7c5cd6]" },
      "left-hand": { dot: "border-[#8ce9c0] bg-[#25a877] text-[#25a877]", root: "text-[#25a877]" },
      "right-hand": { dot: "border-[#ffa6c0] bg-[#d64c79] text-[#d64c79]", root: "text-[#d64c79]" },
      "left-foot": { dot: "border-[#ffd79a] bg-[#d69a2b] text-[#d69a2b]", root: "text-[#d69a2b]" },
      "right-foot": { dot: "border-[#c0b4ff] bg-[#6f5dd1] text-[#6f5dd1]", root: "text-[#6f5dd1]" },
      unknown: {
        dot: "border-foreground-control-faint bg-foreground-control-faint text-foreground-control-faint",
        root: "text-foreground-control-faint",
      },
    },
  },
  defaultVariants: { status: "ready", tone: "unknown" },
});
