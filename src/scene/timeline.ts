import { defineTimeline } from "@coretime/core";

import {
  MOTION_REFERENCE_ADOPTION_SCHEDULE,
  MOTION_REQUEST_SCHEDULE,
  MOTION_SUBJECT_SCHEDULE,
} from "../motion";
import { MOTION_DRIVER_POLICY, MOTION_FRAMES_PER_SECOND } from "../motion";
import { MOTION_GENERATION_CLOCK, MOTION_GENERATION_STEPS_PER_FRAME } from "../schema";
import {
  MOTION_ACTOR_EVENT,
  MOTION_PROMPT_EVENT,
  MOTION_ROUTE_EVENT,
  SCENE_COMPOSITION,
} from "../scene/composition";

export { MOTION_FRAMES_PER_SECOND };

export const motionTimelineDeclaration = defineTimeline({
  clocks: {
    motionFrame: { kind: "integer", rate: MOTION_FRAMES_PER_SECOND },
    [MOTION_GENERATION_CLOCK]: {
      kind: "integer",
      rate: MOTION_FRAMES_PER_SECOND * MOTION_GENERATION_STEPS_PER_FRAME,
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
    [MOTION_PROMPT_EVENT]: { version: 1 },
    [MOTION_ROUTE_EVENT]: { version: 1 },
  },
  primary: "motionFrame",
  schedules: {
    [MOTION_REFERENCE_ADOPTION_SCHEDULE]: { armed: true },
    [MOTION_REQUEST_SCHEDULE]: { armed: true },
    [MOTION_SUBJECT_SCHEDULE]: { armed: true },
  },
  transport: { playing: false, rate: 1 },
});
