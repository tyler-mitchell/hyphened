import { createFileRoute } from "@tanstack/react-router";

import { MotionPlayground } from "../playground/motion-playground";

/**
 * An internal route for judging the motion library one caption at a time. It holds no document and
 * saves nothing, so opening a caption here never touches the scene a person is authoring.
 */
export const Route = createFileRoute("/playground")({
  // WebGPU device ownership begins only after client hydration, as on the scene route.
  ssr: false,
  component: MotionPlayground,
});
