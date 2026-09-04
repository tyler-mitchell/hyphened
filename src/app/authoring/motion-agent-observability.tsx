import { useEngine } from "webgpu-engine/react";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import { sceneProject } from "../../scene/project";
import { compileMotionCameraRows } from "../../stage/camera";
import { compileMotionCameraProgram } from "../../stage/compile";
import { MOTION_CAMERA_COMMANDS, MOTION_PRESENTED_RESOURCE_ID } from "../../stage/system";
import { SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import { ACTOR_POOL_SPARE, MotionTemporalSheetInput, SceneReadinessInput } from "../../schema";
import { publishCaptureArtifact } from "./capture-artifact";
import { captureMotionTemporalSheet } from "./capture-temporal-sheet";
import { actorPathTools } from "./actor-path-tools";
import { actorTools } from "./actor-tools";
import { bodyTools } from "./body-tools";
import { cameraCompositionTools } from "./camera-composition-tools";
import { motionSpanTools } from "./motion-span-tools";
import { sceneCompositionTools } from "./scene-composition-tools";
import { scenePreviewTool } from "./scene-preview-tool";
import { transportTools } from "./transport-tools";
import { useAgentTools } from "./use-agent-tool";
import {
  webMcpImageResult,
  webMcpInputSchema,
  webMcpResult,
  type RegisteredWebMcpTool,
} from "./webmcp";

/** Register the app's semantic browser-agent operations. */
export const MotionAgentObservability = () => {
  const { engine, restart, timeline } = useEngine<typeof motionTimelineDeclaration>();
  const synchronize = async (subject?: string) => {
    const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
    const rows = compileMotionCameraRows(
      compileMotionCameraProgram({
        composition: SceneComposition.assert(readout.composition),
        ...(subject === undefined ? {} : { subject }),
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
    ...actorTools({ synchronize, timeline }),
    ...actorPathTools({ synchronize, timeline }),
    ...bodyTools({ synchronize, timeline }),
    ...cameraCompositionTools({ synchronize, timeline }),
    ...motionSpanTools({ synchronize, timeline }),
    ...sceneCompositionTools({ timeline }),
    scenePreviewTool({ engine, timeline }),
    ...transportTools({ restart, timeline }),
    {
      annotations: { readOnlyHint: true },
      description:
        "Read what the GPU shows now for each authored actor. `present` tells you if the current frame has a pose you can see. `rootPosition` gives the actor's world position, and comes only when the actor is present.",
      execute: async (raw: unknown) => {
        SceneReadinessInput.assert(raw);
        const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
        const scene = SceneComposition.assert(readout.composition);
        const project = await sceneProject();
        const rows = (await engine.read({ id: MOTION_PRESENTED_RESOURCE_ID })) as readonly {
          readonly present: number;
          readonly rootPosition: readonly number[];
        }[];
        const actorCount = Math.max(
          project.record.definition.story.actors.length + ACTOR_POOL_SPARE,
          ...scene.actors.map(({ row }) => row + 1),
        );
        const jointCount = rows.length / actorCount;
        return webMcpResult({
          actors: scene.actors.map(({ row, subject }) => {
            const sample = rows[row * jointCount];
            const present = sample?.present === 1;
            // An absent actor has no position rather than a null one: `present` already carries
            // that fact, and the schema dialect cannot express a nullable array.
            return {
              id: subject,
              present,
              ...(present ? { rootPosition: [...sample!.rootPosition.slice(0, 3)] } : {}),
            };
          }),
        });
      },
      inputSchema: webMcpInputSchema(SceneReadinessInput),
      name: "read_presented_actors",
      outputSchema: {
        additionalProperties: false,
        properties: {
          actors: {
            items: {
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                present: { type: "boolean" },
                rootPosition: {
                  items: { type: "number" },
                  maxItems: 3,
                  minItems: 3,
                  type: "array",
                },
              },
              required: ["id", "present"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["actors"],
        type: "object",
      },
    },
    {
      annotations: { readOnlyHint: true },
      description:
        "Capture a window of motion frames as one sheet of labelled images. The capture reads the live GPU renderer. One sample gives a still of one frame. More samples show the motion across time. `subject` selects the actor that the review camera frames and the labels name. If you give no subject, the tool selects one. The result holds the image. At the end, the authored camera, the transport position, and the play state all go back.",
      execute: async (raw: unknown) => {
        const input = MotionTemporalSheetInput.assert(raw);
        try {
          const capture = await captureMotionTemporalSheet({
            engine,
            samples: input.samples,
            stride: input.stride,
            synchronizeCamera: synchronize,
            timeline,
            window: input.window,
            ...(input.layout === undefined ? {} : { layout: input.layout }),
            ...(input.subject === undefined ? {} : { subject: input.subject }),
          });
          return webMcpImageResult({
            data: capture.image.dataUrl.slice(capture.image.dataUrl.indexOf(",") + 1),
            mimeType: capture.image.mimeType,
            name: "Motion temporal sheet",
            uri: await publishCaptureArtifact(capture.image.blob),
            value: capture.receipt,
          });
        } catch (cause) {
          // A refused seek, artifact-publication failure, or device fault is the agent's next decision.
          const text = cause instanceof Error ? cause.message : String(cause);
          return { content: [{ text, type: "text" as const }], isError: true };
        }
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
              kind: { const: "subject-targeted-camera", type: "string" },
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
