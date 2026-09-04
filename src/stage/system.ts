import {
  capabilityResourceKey,
  createTimelineClockCapability,
  definePipelineSystem,
  timelineClockReference,
  type Phase,
  type PhysicsBodyInit,
} from "webgpu-engine";

import {
  ARDY_MOTION_CONTACT_COUNT,
  createMotionCandidate,
  createMotionProduct,
  createMotionProvider,
  createMotionSubjectState,
  createProductMotionPresentation,
  HISTORY_FRAME_CAPACITY,
  MOTION_REQUEST_SCHEDULE,
  MOTION_SUBJECT_SCHEDULE,
  type MotionSubjectDefinition,
  type TextEmbedding,
} from "webgpu-engine/motion";
import type { MotionPipelineProgram } from "../schema";
import { createMotionBodies } from "./bodies";
import { createMotionCamera, MOTION_CAMERA_COMMAND, MOTION_CAMERA_ID } from "./camera";
import {
  createMotionRenderer,
  MOTION_BASE_COLOR_RESOURCE_KEY,
  MOTION_CAPTURE_RESOURCE_KEY,
} from "./renderer";
import type { EnvironmentRenderProgram } from "./environment";
import { createSkinPalette } from "./skin";
import { createMotionSurface } from "./surface";

export const MOTION_PRODUCTION_ID = "motion-production";
const MOTION_PRESENTATION_ID = "motion-presentation";
export const MOTION_CAPTURE_RESOURCE_ID = `${MOTION_PRODUCTION_ID}/${MOTION_CAPTURE_RESOURCE_KEY}`;
export const MOTION_BASE_COLOR_RESOURCE_ID = `${MOTION_PRODUCTION_ID}/${MOTION_BASE_COLOR_RESOURCE_KEY}`;
export const MOTION_PRESENTED_RESOURCE_ID = `${MOTION_PRODUCTION_ID}/${capabilityResourceKey({
  capabilityId: MOTION_PRESENTATION_ID,
  localName: "presented",
})}`;
export const MOTION_CAMERA_COMMANDS = {
  frames: `${MOTION_CAMERA_ID}/${MOTION_CAMERA_COMMAND.frames}`,
  targetEntities: `${MOTION_CAMERA_ID}/${MOTION_CAMERA_COMMAND.targetEntities}`,
} as const;

const phase = {
  clock: "clock",
  subject: "subject",
  compile: "motion-compile",
  body: "body",
  motion: "motion",
  camera: "camera",
  skin: "skin",
  render: "render",
} as const;

/** Compose the real provider-to-pixel path as one WebGPU Engine capability graph. */
export const createMotionPipelineSystem = (input: {
  /** The base-colour array size as width, height, layers; one white texel when the character brought none. */
  readonly baseColorSize: readonly [number, number, number];
  /** The scene's placed bodies, lowered from the composition: loose pool rows and fixed colliders. */
  readonly bodies: {
    readonly fixed: ReadonlyArray<PhysicsBodyInit>;
    readonly loose: ReadonlyArray<PhysicsBodyInit>;
  };
  readonly embeddings: () => ReadonlyArray<TextEmbedding>;
  readonly environment: EnvironmentRenderProgram;
  readonly manifest: Parameters<typeof createMotionProvider>[0]["manifest"];
  readonly program: MotionPipelineProgram;
  readonly restPose: Parameters<typeof createMotionProvider>[0]["restPose"];
  readonly subjects: ReadonlyArray<MotionSubjectDefinition>;
}) => {
  const clock = createTimelineClockCapability({ id: "motion-clock", phase: phase.clock });
  const subjects = createMotionSubjectState({
    id: "motion-subjects",
    phase: phase.subject,
    scheduleKind: MOTION_SUBJECT_SCHEDULE,
    subjects: input.subjects,
  });
  const candidate = createMotionCandidate({ id: "motion-candidate" });
  const provider = createMotionProvider({
    after: phase.compile,
    candidate: candidate.candidate,
    embeddings: input.embeddings,
    id: "motion-provider",
    manifest: input.manifest,
    referenceFrameCapacity: input.program.compilation.sourceFrameCount,
    requestScheduleKind: MOTION_REQUEST_SCHEDULE,
    restPose: input.restPose,
    subjectState: subjects.state,
    subjects: input.subjects,
  });
  // The provider offers one reconstructed window at a time; the product retains the whole scene.
  const product = createMotionProduct({
    candidate: candidate.candidate,
    contactCount: ARDY_MOTION_CONTACT_COUNT,
    frameCapacity: input.program.compilation.sourceFrameCount,
    id: "motion-product",
    jointCount: input.program.motion.jointCount,
    phase: provider.publicationPhase,
    skeletonId: input.program.motion.skeleton,
    source: provider.reconstruction,
    windowFrameCapacity: HISTORY_FRAME_CAPACITY + input.manifest.config.generationFrames,
  });
  const presentation = createProductMotionPresentation({
    clock: timelineClockReference(clock),
    id: MOTION_PRESENTATION_ID,
    phase: phase.motion,
    product: product.product,
    program: input.program.motion,
  });
  const bodies = createMotionBodies({
    bodies: input.bodies,
    clock: timelineClockReference(clock),
    ground: input.program.render.ground,
    id: "motion-bodies",
    phase: phase.body,
    product: product.product,
    program: input.program.motion,
    subjects: input.subjects,
  });
  const phases: Phase[] = [
    { id: phase.clock, moment: { at: "step" } },
    { id: phase.subject, moment: { at: "step" }, after: [phase.clock] },
    { id: phase.compile, moment: { at: "step" }, after: [phase.subject] },
    // The provider publishes at the present moment; the step reads the retained product from the
    // previous frame, which its resources declare as valid.
    { id: phase.body, moment: { at: "step" }, after: [phase.compile] },
    { id: phase.motion, moment: { at: "present" }, after: [provider.publicationPhase] },
    { id: phase.camera, moment: { at: "present" }, after: [phase.motion] },
    { id: phase.skin, moment: { at: "present" }, after: [phase.motion] },
    { id: phase.render, moment: { at: "present" }, after: [phase.camera, phase.skin] },
  ];
  const surface = createMotionSurface({ id: "motion-surface" });
  const camera = createMotionCamera({
    clock: timelineClockReference(clock),
    phase: phase.camera,
    presentation,
    program: input.program.render,
    surface,
  });
  const skin = createSkinPalette({
    id: "skin-palette",
    phase: phase.skin,
    presentation,
    program: input.program.render,
  });
  const renderer = createMotionRenderer({
    baseColorSize: input.baseColorSize,
    bodies,
    camera,
    environment: input.environment,
    phase: phase.render,
    presentation,
    program: input.program.render,
    skin,
    surface,
  });

  return definePipelineSystem({
    capabilities: [
      clock,
      subjects.capability,
      candidate.capability,
      ...provider.capabilities,
      product.capability,
      presentation.capability,
      ...bodies.capabilities,
      surface.capability,
      camera.capability,
      skin.capability,
      renderer,
    ],
    id: MOTION_PRODUCTION_ID,
    metadata: {
      camera,
      candidate,
      clock,
      motion: presentation,
      product,
      provider,
      renderer,
      skin,
      subjects,
      surface,
    },
    phases,
    resources: {},
  });
};
