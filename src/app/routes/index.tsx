import { createFileRoute } from "@tanstack/react-router";

import { SceneLoading } from "../scene-loading";
import { App } from "../shell";

/** The saved scene document or built-in story template selected by the address. */
const validateSearch = (
  search: Record<string, unknown>,
): { readonly scene?: string; readonly story?: string } => {
  if (typeof search.scene === "string" && search.scene.length > 0) return { scene: search.scene };
  return typeof search.story === "string" && search.story.length > 0 ? { story: search.story } : {};
};

export const Route = createFileRoute("/")({
  // Artifact fetches and WebGPU device ownership begin only after client hydration.
  ssr: false,
  component: App,
  pendingComponent: SceneLoading,
  validateSearch,
});
