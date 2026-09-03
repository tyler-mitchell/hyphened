import { SceneReadinessInput } from "../../schema";
import { useAgentTools } from "./use-agent-tool";
import { webMcpInputSchema, webMcpResult } from "./webmcp";

export type SceneReadiness =
  | { readonly status: "opening" }
  | { readonly status: "open" }
  | { readonly status: "failed"; readonly reason: string };

const REQUIRED_FEATURE = "shader-f16";

const readDevice = async () => {
  if (navigator.gpu === undefined) {
    return { adapter: false, requiredFeature: false, webgpu: false };
  }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  return {
    adapter: adapter !== null,
    requiredFeature: adapter?.features.has(REQUIRED_FEATURE) ?? false,
    webgpu: true,
  };
};

/**
 * Registers the one tool that answers whether the scene is usable yet, and when it is not, whether
 * the browser can run it at all. Every other operation belongs to the scene and is absent until the
 * scene opens, so without this an agent cannot tell a booting app from one that will never boot.
 */
export const SceneReadinessTool = ({
  readiness,
  reset,
}: {
  readonly readiness: SceneReadiness;
  /** Why this scene opened fresh, when a saved scene was discarded or its story changed. */
  readonly reset?: string;
}) => {
  useAgentTools([
    {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description:
        "Report whether the motion scene has opened, and what the browser's WebGPU support is. While the status is opening, the scene's own operations are not yet registered. A device without WebGPU or without the required shader-f16 feature will never open the scene. A reset field appears when the saved scene was discarded and a new one opened in its place, which is how a fresh browser is told apart from a document that was thrown away.",
      execute: async () => {
        SceneReadinessInput.assert({});
        return webMcpResult({
          ...readiness,
          device: await readDevice(),
          ...(reset === undefined ? {} : { reset }),
        });
      },
      inputSchema: webMcpInputSchema(SceneReadinessInput),
      name: "read_scene_readiness",
      outputSchema: {
        additionalProperties: false,
        properties: {
          device: {
            additionalProperties: false,
            properties: {
              adapter: { type: "boolean" },
              requiredFeature: { type: "boolean" },
              webgpu: { type: "boolean" },
            },
            required: ["adapter", "requiredFeature", "webgpu"],
            type: "object",
          },
          reason: { type: "string" },
          reset: { type: "string" },
          status: { enum: ["failed", "open", "opening"], type: "string" },
        },
        required: ["device", "status"],
        type: "object",
      },
    },
  ]);
  return null;
};
