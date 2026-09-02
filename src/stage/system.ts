import {
  createTimelineClockCapability,
  definePipelineSystem,
  timelineClockReference,
  type Phase,
} from "webgpu-engine";

import { createLearnedMotionCapability } from "../domains/learned-motion/capability";
import type { TextEmbedding } from "../provider/embedding";
import type { MotionPipelineProgram, MotionSubjectDefinition } from "../schema";
import { createMotionCamera, MOTION_CAMERA_COMMAND, MOTION_CAMERA_ID } from "./camera";
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
  readonly manifest: Parameters<typeof createLearnedMotionCapability>[0]["manifest"];
  readonly program: MotionPipelineProgram;
  readonly restPose: Parameters<typeof createLearnedMotionCapability>[0]["restPose"];
  readonly subjects: ReadonlyArray<MotionSubjectDefinition>;
}) => {
  const clock = createTimelineClockCapability({ id: "motion-clock", phase: phase.clock });
  const motion = createLearnedMotionCapability({
    clock: timelineClockReference(clock),
    embeddings: input.embeddings,
    manifest: input.manifest,
    phases: { compile: phase.compile, presentation: phase.motion, subject: phase.subject },
    program: input.program,
    restPose: input.restPose,
    subjects: input.subjects,
  });
  const surface = createMotionSurface({ id: "motion-surface" });
  const camera = createMotionCamera({
    clock: timelineClockReference(clock),
    phase: phase.camera,
    presentation: motion.presentation,
    program: input.program.render,
    surface,
  });
  const skin = createSkinPalette({
    id: "skin-palette",
    phase: phase.skin,
    presentation: motion.presentation,
    program: input.program.render,
  });
  const renderer = createMotionRenderer({
    camera,
    phase: phase.render,
    presentation: motion.presentation,
    program: input.program.render,
    skin,
    surface,
  });

  return definePipelineSystem({
    capabilities: [
      clock,
      ...motion.capabilities,
      surface.capability,
      camera.capability,
      skin.capability,
      renderer,
    ],
    id: MOTION_PRODUCTION_ID,
    metadata: {
      camera,
      clock,
      ...motion.metadata,
      renderer,
      skin,
      surface,
    },
    phases,
    resources: {},
  });
};
