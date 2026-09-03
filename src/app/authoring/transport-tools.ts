import type { TimelineRuntime } from "@coretime/core";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import { startNewScene } from "../../scene/project";
import { ControlMotionInput } from "../../schema";
import { restartMotionScene } from "../../stage/open";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

export const transportTools = ({
  timeline,
}: {
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      "Control the Core Time transport: play, pause, seek to a motion frame, step by ticks, set the playback rate, or restart. The authored scene persists in this browser across reloads; newScene abandons it for a fresh seeded scene and reloads the page. Edit actor and camera composition with the composition tools.",
    execute: async (raw) => {
      const input = ControlMotionInput.assert(raw);
      const actions = {
        newScene: () => startNewScene(),
        pause: () => timeline.transport.pause(),
        play: () => timeline.transport.play(),
        restart: () => restartMotionScene(timeline),
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
