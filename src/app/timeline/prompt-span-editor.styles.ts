import { tv } from "@hyphened/ui/tv";

export const promptSpanEditorStyles = tv({
  // Inset past the end resize handle, which is 10px wide at the item's right edge.
  base: "absolute top-1/2 right-3 z-[3] grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-editor-control border-0 bg-background/80 p-0 text-current opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default [&_svg]:size-3",
});
