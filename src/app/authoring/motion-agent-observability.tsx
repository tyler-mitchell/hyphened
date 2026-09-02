import { useEngine } from "webgpu-engine/react";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import type { MotionScene } from "./runtime";
import { compileMotionCameraRows } from "../../stage/camera";
import { compileMotionCameraProgram } from "../../stage/compile";
import { MOTION_CAMERA_COMMANDS } from "../../stage/system";
import { SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import {
  MotionSceneInspectionInput,
  MotionTemporalSheetInput,
  PoseContinuityInput,
} from "../../schema";
import { publishCaptureArtifact } from "./capture-artifact";
import { captureMotionTemporalSheet } from "./capture-temporal-sheet";
import { cameraCompositionTools } from "./camera-composition-tools";
import { sceneCompositionTools } from "./scene-composition-tools";
import { transportTools } from "./transport-tools";
import { useAgentTools } from "./use-agent-tool";
import {
  webMcpFieldSelection,
  webMcpInputSchema,
  webMcpResourceResult,
  webMcpResult,
  type RegisteredWebMcpTool,
} from "./webmcp";

const defaultMotionSceneFields = [
  "droppedMotionFrameCount",
  "transportFrame",
  "transportPlaying",
] as const;
const motionSceneFields = [
  ...defaultMotionSceneFields,
  "activeSubjectCount",
  "admission.demandDriftMetres",
  "admission.productFrameStart",
  "admission.readFrames",
  "admission.requestFrame",
  "admission.residencyFrames",
  "admission.seamFrames",
  "admission.snapshotFrames",
  "authoredSubjects",
  "cameraFollow.reading",
  "cameraFollow.target",
  "gpuReferences",
  "gpuSubjects",
  "gpuTargets",
  "motionStateFacts",
  "pendingFactCount",
  "pendingFacts",
  "providerCandidate.available",
  "providerCandidate.frameCount",
  "providerCandidate.historySubjectGeneration",
  "providerCandidate.historySubjectRow",
  "providerCandidate.productFrameStart",
  "providerCandidate.requestRevision",
  "providerCandidate.revision",
  "providerCandidate.windowIndex",
  "providerProgram.operation",
  "providerRequests",
  "residentProductFrameEnd",
  "subjectContinuity",
  "truncated",
  "view.clientHeight",
  "view.clientWidth",
  "view.height",
  "view.selector",
  "view.width",
] as const;

/** Register the app's semantic browser-agent operations. */
export const MotionAgentObservability = (props: { readonly scene?: MotionScene }) => {
  const { canvas, engine, timeline } = useEngine<typeof motionTimelineDeclaration>();
  const scene = props.scene;
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
    ...(scene === undefined
      ? []
      : [
          {
            annotations: { readOnlyHint: true },
            description:
              "Read selected Core Time-to-GPU motion fields. Use the include dot-path map for non-default fields.",
            execute: async (raw: unknown) => {
              const input = MotionSceneInspectionInput.assert(raw);
              const fields = webMcpFieldSelection({
                available: motionSceneFields,
                defaults: defaultMotionSceneFields,
                include: input.include,
              });
              const readout = await scene.inspect({
                include: fields.roots,
                motionStateFactLimit: input.motionStateFactLimit,
                ...(input.subject === undefined ? {} : { subject: input.subject }),
              });
              return webMcpResult(
                fields.project({
                  ...readout,
                  ...(fields.includes("view")
                    ? {
                        view: {
                          clientHeight: canvas.clientHeight,
                          clientWidth: canvas.clientWidth,
                          height: canvas.height,
                          selector: "canvas",
                          width: canvas.width,
                        },
                      }
                    : {}),
                }),
              );
            },
            inputSchema: webMcpInputSchema(MotionSceneInspectionInput),
            name: "inspect_motion_scene",
          } satisfies RegisteredWebMcpTool,
        ]),
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
    ...(scene === undefined
      ? []
      : [
          {
            annotations: { readOnlyHint: true },
            description:
              "Measure whether each body moves continuously. Reads the joint-position history the scene records every frame and reports, per actor, the root and whole-body displacement per motion frame: the median step, the largest step, how many frames the body held still, and how many steps exceeded eight times the median. A teleport, a judder, or a foot skate shows up here; the pose frame index does not reveal any of them.",
            execute: async (raw: unknown) => {
              const input = PoseContinuityInput.assert(raw);
              return webMcpResult(await scene.measurePoseContinuity({ samples: input.samples }));
            },
            inputSchema: webMcpInputSchema(PoseContinuityInput),
            name: "measure_pose_continuity",
            outputSchema: {
              additionalProperties: false,
              properties: {
                actors: {
                  items: {
                    additionalProperties: false,
                    properties: {
                      boneStretchMetres: { type: "number" },
                      discontinuities: { type: "number" },
                      heldFrames: { type: "number" },
                      jointDiscontinuities: { type: "number" },
                      jointMaxStepMetres: { type: "number" },
                      rootMaxStepMetres: { type: "number" },
                      rootMedianStepMetres: { type: "number" },
                      samples: { type: "number" },
                      subject: { type: "string" },
                    },
                    required: [
                      "boneStretchMetres",
                      "discontinuities",
                      "heldFrames",
                      "jointDiscontinuities",
                      "jointMaxStepMetres",
                      "rootMaxStepMetres",
                      "rootMedianStepMetres",
                      "samples",
                      "subject",
                    ],
                    type: "object",
                  },
                  type: "array",
                },
                droppedMotionFrames: { type: "number" },
                frameSpan: { type: "number" },
                samples: { type: "number" },
                transportFrame: { type: "number" },
              },
              required: ["actors", "droppedMotionFrames", "frameSpan", "samples", "transportFrame"],
              type: "object",
            },
          } satisfies RegisteredWebMcpTool,
        ]),
  ]);
  return null;
};
