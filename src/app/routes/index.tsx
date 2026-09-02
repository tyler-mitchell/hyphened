import { createFileRoute } from "@tanstack/react-router";

import { App } from "../shell";

export const Route = createFileRoute("/")({
  // Artifact fetches and WebGPU device ownership begin only after client hydration.
  ssr: false,
  component: App,
});
