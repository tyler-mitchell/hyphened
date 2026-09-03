import { defineTimeline } from "@coretime/core";

import { MOTION_REQUEST_SCHEDULE, MOTION_SUBJECT_SCHEDULE } from "webgpu-engine/motion";
import { MOTION_DRIVER_POLICY, MOTION_FRAMES_PER_SECOND } from "webgpu-engine/motion";
import {
  PHYSICS_RETIRE_SCHEDULE,
  PHYSICS_SPAWN_SCHEDULE,
  PHYSICS_STATIC_UPDATE_SCHEDULE,
  PHYSICS_SUBSTEP_CLOCK,
  PHYSICS_SUBSTEPS_PER_FRAME,
} from "../schema";
import {
  MOTION_ACTOR_EVENT,
  MOTION_BODY_EVENT,
  MOTION_PROMPT_EVENT,
  MOTION_ROUTE_EVENT,
  SCENE_COMPOSITION,
} from "../scene/composition";

export { MOTION_FRAMES_PER_SECOND };

export const motionTimelineDeclaration = defineTimeline({
  clocks: {
    motionFrame: { kind: "integer", rate: MOTION_FRAMES_PER_SECOND },
    [PHYSICS_SUBSTEP_CLOCK]: {
      kind: "mapped",
      rate: { denominator: 1, numerator: PHYSICS_SUBSTEPS_PER_FRAME },
      reference: "motionFrame",
    },
  },
  composition: {
    root: SCENE_COMPOSITION,
    compositions: {
      [SCENE_COMPOSITION]: { clock: "motionFrame", children: [] },
    },
  },
  driver: MOTION_DRIVER_POLICY,
  events: {
    [MOTION_ACTOR_EVENT]: { version: 1 },
    [MOTION_BODY_EVENT]: { version: 1 },
    [MOTION_PROMPT_EVENT]: { version: 1 },
    [MOTION_ROUTE_EVENT]: { version: 1 },
  },
  primary: "motionFrame",
  schedules: {
    [MOTION_REQUEST_SCHEDULE]: { armed: true },
    [MOTION_SUBJECT_SCHEDULE]: { armed: true },
    [PHYSICS_RETIRE_SCHEDULE]: { armed: true },
    [PHYSICS_SPAWN_SCHEDULE]: { armed: true },
    [PHYSICS_STATIC_UPDATE_SCHEDULE]: { armed: true },
  },
  transport: { playing: false, rate: 1 },
});
