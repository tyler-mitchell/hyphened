import type { TimelineRuntime } from "@coretime/core";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import { ControlMotionInput } from "../../schema";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

export const transportTools = ({
  timeline,
}: {
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      "Control the Core Time transport: play, pause, seek to a motion frame, step by ticks, set the playback rate, or restart. Edit actor and camera composition with the composition tools.",
    execute: async (raw) => {
      const input = ControlMotionInput.assert(raw);
      const actions = {
        pause: () => timeline.transport.pause(),
        play: () => timeline.transport.play(),
        restart: () => timeline.transport.restart(),
        seek: () => {
          if (input.frame === undefined) throw new Error("seek needs a frame");
          return timeline.transport.seekTo({ clock: "motionFrame", tick: input.frame });
        },
        setRate: () => {
          if (input.rate === undefined) throw new Error("setRate needs a rate");
          return timeline.transport.setRate({ rate: input.rate });
        },
        step: () => timeline.transport.stepBy({ ticks: input.ticks ?? 1 }),
      } as const;
      await actions[input.action]();
      return webMcpResult({ action: input.action });
    },
    inputSchema: webMcpInputSchema(ControlMotionInput),
    name: "control_motion_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { type: "string" },
      },
      required: ["action"],
      type: "object",
    },
  },
];
