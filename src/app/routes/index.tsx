import { createFileRoute } from "@tanstack/react-router";

import { App } from "../shell";

/**
 * The story the page opens on, as a search parameter, so a scene has an address: a person can send
 * the link to what they are watching and the recipient opens the same story. The parameter names a
 * built-in story; a scene an agent authored has none, and the address then names no story.
 */
const validateSearch = (search: Record<string, unknown>): { readonly story?: string } =>
  typeof search.story === "string" && search.story.length > 0 ? { story: search.story } : {};

export const Route = createFileRoute("/")({
  // Artifact fetches and WebGPU device ownership begin only after client hydration.
  ssr: false,
  component: App,
  validateSearch,
});
