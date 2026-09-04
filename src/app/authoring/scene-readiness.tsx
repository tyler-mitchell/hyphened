import type { MotionParameterProgress } from "webgpu-engine/motion";

import { SceneReadinessInput } from "../../schema";
import { useAgentTools } from "./use-agent-tool";
import { webMcpInputSchema, webMcpResult } from "./webmcp";

export type SceneReadiness =
  | { readonly status: "opening" }
  | { readonly status: "open" }
  | { readonly status: "failed"; readonly reason: string };

const REQUIRED_FEATURE = "shader-f16";
/**
 * The engine's compute passes declare `requires immediate_address_space`, so a browser without the
 * language feature fails while building the physics shader rather than while probing the adapter.
 * Reading it here turns that WGSL validation error into a sentence a visitor can act on.
 */
const REQUIRED_LANGUAGE_FEATURE = "immediate_address_space";

/** What this browser can offer the scene. The scene needs all four. */
export interface SceneDevice {
  readonly adapter: boolean;
  readonly languageFeature: boolean;
  readonly requiredFeature: boolean;
  readonly webgpu: boolean;
}

export const readDevice = async (): Promise<SceneDevice> => {
  if (navigator.gpu === undefined) {
    return { adapter: false, languageFeature: false, requiredFeature: false, webgpu: false };
  }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  return {
    adapter: adapter !== null,
    // Older browsers carry no wgslLanguageFeatures set at all, which reads as absent.
    languageFeature: navigator.gpu.wgslLanguageFeatures?.has(REQUIRED_LANGUAGE_FEATURE) ?? false,
    requiredFeature: adapter?.features.has(REQUIRED_FEATURE) ?? false,
    webgpu: true,
  };
};

/** Each way the browser can fall short, in the order a reader can act on. */
const UNSUPPORTED_DEVICE = [
  {
    missing: ({ webgpu }: SceneDevice) => !webgpu,
    reason:
      "This browser does not support WebGPU, which this scene needs. Open the page in Google Chrome on a desktop computer.",
  },
  {
    missing: ({ adapter }: SceneDevice) => !adapter,
    reason:
      "This browser supports WebGPU but no graphics adapter is available. Make sure hardware acceleration is on, then reload.",
  },
  {
    missing: ({ requiredFeature }: SceneDevice) => !requiredFeature,
    reason: `This browser does not have the ${REQUIRED_FEATURE} feature that this scene needs. Open the page in Google Chrome on a desktop computer.`,
  },
  {
    missing: ({ languageFeature }: SceneDevice) => !languageFeature,
    reason:
      "This browser's WebGPU is too old for the physics shaders this scene builds. Chrome 149 and later carry what it needs; an older Chrome or an embedded browser does not.",
  },
] as const;

/** Why this browser cannot run the scene, or nothing when it can. */
export const unsupportedDevice = (device: SceneDevice): string | undefined =>
  UNSUPPORTED_DEVICE.find(({ missing }) => missing(device))?.reason;

/**
 * Registers the one tool that answers whether the scene is usable yet, and when it is not, whether
 * the browser can run it at all. Every other operation belongs to the scene and is absent until the
 * scene opens, so without this an agent cannot tell a booting app from one that will never boot.
 */
export const SceneReadinessTool = ({
  progress,
  readiness,
  reset,
}: {
  /** How much of the motion checkpoint has arrived, while it is still arriving. */
  readonly progress?: MotionParameterProgress;
  readonly readiness: SceneReadiness;
  /** Why this scene opened fresh, when a saved scene was discarded or its story changed. */
  readonly reset?: string;
}) => {
  useAgentTools([
    {
      annotations: { idempotentHint: true, readOnlyHint: true },
      description:
        "Report if the motion scene has opened, and what WebGPU this browser has. While the status is opening, the scene's own tools are not registered yet. A device without WebGPU will never open the scene. So will a device without the shader-f16 feature, or without the immediate_address_space language feature that the physics shaders need. A `reset` field appears if the saved scene was discarded and a new one opened in its place. It tells a new browser apart from a document that was thrown away. A `progress` field appears while the motion checkpoint downloads. It gives the bytes received, the total, and which shard is arriving. A page that reports progress is working, not stuck, so wait and read again instead of reloading.",
      execute: async () => {
        SceneReadinessInput.assert({});
        return webMcpResult({
          ...readiness,
          device: await readDevice(),
          ...(progress === undefined ? {} : { progress }),
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
              languageFeature: { type: "boolean" },
              requiredFeature: { type: "boolean" },
              webgpu: { type: "boolean" },
            },
            required: ["adapter", "languageFeature", "requiredFeature", "webgpu"],
            type: "object",
          },
          progress: {
            additionalProperties: false,
            properties: {
              loadedBytes: { type: "integer" },
              shard: { type: "integer" },
              shardCount: { type: "integer" },
              totalBytes: { type: "integer" },
            },
            required: ["loadedBytes", "shard", "shardCount", "totalBytes"],
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
