import { useEngine } from "webgpu-engine/react";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import { compileMotionCameraRows } from "../../stage/camera";
import { compileMotionCameraProgram } from "../../stage/compile";
import { MOTION_CAMERA_COMMANDS } from "../../stage/system";
import { SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import { MotionTemporalSheetInput } from "../../schema";
import { publishCaptureArtifact } from "./capture-artifact";
import { captureMotionTemporalSheet } from "./capture-temporal-sheet";
import { cameraCompositionTools } from "./camera-composition-tools";
import { sceneCompositionTools } from "./scene-composition-tools";
import { transportTools } from "./transport-tools";
import { useAgentTools } from "./use-agent-tool";
import { webMcpInputSchema, webMcpResourceResult, type RegisteredWebMcpTool } from "./webmcp";

/** Register the app's semantic browser-agent operations. */
export const MotionAgentObservability = () => {
  const { engine, timeline } = useEngine<typeof motionTimelineDeclaration>();
  const synchronize = async () => {
    const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
    const rows = compileMotionCameraRows(
      compileMotionCameraProgram({
        composition: SceneComposition.assert(readout.composition),
      }),
    );
    const results = [
      engine.submit({
        count: rows.frames.length,
        data: rows.frames,
        id: MOTION_CAMERA_COMMANDS.frames,
      }),
      engine.submit({
        count: rows.targetEntities.length,
        data: rows.targetEntities,
        id: MOTION_CAMERA_COMMANDS.targetEntities,
      }),
    ];
    const overflow = results.find(({ kind }) => kind === "overflow");
    if (overflow?.kind === "overflow") {
      throw new Error(
        `Camera program exceeds device capacity ${String(overflow.capacity)} with ${String(overflow.requested)} rows.`,
      );
    }
  };
  useAgentTools([
    ...cameraCompositionTools({ synchronize, timeline }),
    ...sceneCompositionTools({ synchronize, timeline }),
    ...transportTools({ timeline }),
    {
      annotations: { readOnlyHint: true },
      description:
        "Capture any valid motion-frame window as a labeled temporal sheet from the live GPU renderer. The capture temporarily drives exact Core Time steps and restores the prior transport position and play state.",
      execute: async (raw: unknown) => {
        const input = MotionTemporalSheetInput.assert(raw);
        const capture = await captureMotionTemporalSheet({
          engine,
          samples: input.samples,
          stride: input.stride,
          timeline,
          window: input.window,
          ...(input.layout === undefined ? {} : { layout: input.layout }),
          ...(input.subject === undefined ? {} : { subject: input.subject }),
        });
        return webMcpResourceResult({
          mimeType: capture.image.mimeType,
          name: "Motion temporal sheet",
          uri: await publishCaptureArtifact(capture.image.blob),
          value: capture.receipt,
        });
      },
      inputSchema: webMcpInputSchema(MotionTemporalSheetInput),
      name: "capture_motion_temporal_sheet",
      outputSchema: {
        additionalProperties: false,
        properties: {
          activeSubjects: { items: { type: "string" }, type: "array" },
          compositionVersion: { type: "string" },
          firstFrame: { type: "number" },
          lastFrame: { type: "number" },
          requestedWindow: { additionalProperties: true, type: "object" },
          reviewHints: { items: { type: "string" }, type: "array" },
          sampleCount: { type: "number" },
          samples: {
            items: {
              additionalProperties: false,
              properties: {
                camera: { type: ["object", "null"] },
                cameraItem: { type: "string" },
                cameraMode: { type: "string" },
                frame: { type: "number" },
                motionState: { type: "string" },
              },
              required: ["camera", "cameraItem", "cameraMode", "frame", "motionState"],
              type: "object",
            },
            type: "array",
          },
          subject: { type: "string" },
          view: {
            additionalProperties: false,
            properties: {
              cameraItems: { items: { type: "string" }, type: "array" },
              kind: { const: "authored-camera", type: "string" },
            },
            required: ["cameraItems", "kind"],
            type: "object",
          },
        },
        required: [
          "activeSubjects",
          "compositionVersion",
          "firstFrame",
          "lastFrame",
          "requestedWindow",
          "reviewHints",
          "sampleCount",
          "samples",
          "subject",
          "view",
        ],
        type: "object",
      },
    } satisfies RegisteredWebMcpTool,
  ]);
  return null;
};
