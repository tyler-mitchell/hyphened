import {
  createTimelineClockCapability,
  definePipelineSystem,
  timelineClockReference,
  type Phase,
} from "webgpu-engine";

import {
  createMotionProduct,
  createMotionReferenceCandidate,
  createMotionSubjectState,
  MOTION_REQUEST_SCHEDULE,
  MOTION_SUBJECT_SCHEDULE,
  type MotionSubjectDefinition,
} from "../motion";
import { ARDY_MOTION_CONTACT_COUNT, createMotionProvider } from "../provider/system";
import type { TextEmbedding } from "../provider/embedding";
import type { MotionPipelineProgram } from "../schema";
import { createMotionCamera, MOTION_CAMERA_COMMAND, MOTION_CAMERA_ID } from "./camera";
import { createProductMotionPresentation } from "./presentation";
import { createMotionRenderer, MOTION_CAPTURE_RESOURCE_KEY } from "./renderer";
import { createSkinPalette } from "./skin";
import { createMotionSurface } from "./surface";

export const MOTION_PRODUCTION_ID = "motion-production";
export const MOTION_CAPTURE_RESOURCE_ID = `${MOTION_PRODUCTION_ID}/${MOTION_CAPTURE_RESOURCE_KEY}`;
export const MOTION_CAMERA_COMMANDS = {
  frames: `${MOTION_CAMERA_ID}/${MOTION_CAMERA_COMMAND.frames}`,
  targetEntities: `${MOTION_CAMERA_ID}/${MOTION_CAMERA_COMMAND.targetEntities}`,
} as const;

const phase = {
  clock: "clock",
  subject: "subject",
  compile: "motion-compile",
  motion: "motion",
  camera: "camera",
  skin: "skin",
  render: "render",
} as const;

const phases: Phase[] = [
  { id: phase.clock, moment: { at: "step" } },
  { id: phase.subject, moment: { at: "step" }, after: [phase.clock] },
  { id: phase.compile, moment: { at: "step" }, after: [phase.subject] },
  { id: phase.motion, moment: { at: "present" } },
  { id: phase.camera, moment: { at: "present" }, after: [phase.motion] },
  { id: phase.skin, moment: { at: "present" }, after: [phase.motion] },
  { id: phase.render, moment: { at: "present" }, after: [phase.camera, phase.skin] },
];

/** Compose the real provider-to-pixel path as one WebGPU Engine capability graph. */
export const createMotionPipelineSystem = (input: {
  readonly embeddings: ReadonlyArray<TextEmbedding>;
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
  const candidate = createMotionReferenceCandidate({
    contactCount: ARDY_MOTION_CONTACT_COUNT,
    frameCapacity: input.program.compilation.sourceFrameCount,
    id: "motion-candidate",
    jointCount: input.program.motion.jointCount,
    phase: phase.compile,
  });
  const provider = createMotionProvider({
    after: phase.compile,
    candidate: candidate.candidate,
    clock: "generationStep",
    embeddings: input.embeddings,
    id: "motion-provider",
    manifest: input.manifest,
    referenceFrameCapacity: input.program.compilation.sourceFrameCount,
    requestScheduleKind: MOTION_REQUEST_SCHEDULE,
    restPose: input.restPose,
    subjectState: subjects.state,
    subjects: input.subjects,
  });
  const product = createMotionProduct({
    candidate: candidate.candidate,
    id: "motion-product",
    phase: provider.publicationPhase,
    skeletonId: input.program.motion.skeleton,
  });
  const motion = createProductMotionPresentation({
    clock: timelineClockReference(clock),
    id: "motion-presentation",
    phase: phase.motion,
    product: product.product,
    program: input.program.motion,
  });
  const surface = createMotionSurface({ id: "motion-surface" });
  const camera = createMotionCamera({
    clock: timelineClockReference(clock),
    phase: phase.camera,
    presentation: motion,
    program: input.program.render,
    surface,
  });
  const skin = createSkinPalette({
    id: "skin-palette",
    phase: phase.skin,
    presentation: motion,
    program: input.program.render,
  });
  const renderer = createMotionRenderer({
    camera,
    phase: phase.render,
    presentation: motion,
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
      motion.capability,
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
      motion,
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
