import type { TimelineRuntime } from "@coretime/core";

import { SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { AUTHORED_STORIES, DEFAULT_STORY, storyChoices } from "../../scene/default";
import { startNewScene } from "../../scene/project";
import { ControlMotionInput } from "../../schema";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

export const transportTools = ({
  restart,
  timeline,
}: {
  readonly restart: () => Promise<void>;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      `Control the Core Time transport: play, pause, seek to a motion frame, step by ticks, set the playback rate, or restart. Playback pauses at the scene's last frame, and a seek past it is refused. The authored scene persists in this browser across reloads; newScene opens a fresh scene in place on a built-in story (\`story\`: ${storyChoices()
        .map(({ id, title }) => `${id} = ${title}`)
        .join(", ")}; the first when omitted) and the previous document stays in the catalog (read_scene_readiness reports open again once the tools are back). To open a scene on a story of your own, call author_scene.`,
    execute: async (raw) => {
      const input = ControlMotionInput.assert(raw);
      if (input.action === "newScene") {
        const seed = input.story ?? DEFAULT_STORY;
        const story = AUTHORED_STORIES[seed];
        if (story === undefined) {
          throw new Error(
            `"${seed}" is not a built-in story; stories: ${storyChoices()
              .map(({ id, title }) => `${id} (${title})`)
              .join(", ")}`,
          );
        }
        // The scene reopens in place on a new run; the tools re-register once it is open.
        const next = await startNewScene({ seed, story });
        const state = await next.timeline.transport.state();
        return webMcpResult({
          action: input.action,
          frame: 0,
          playing: state.playing,
          rate: state.rate,
        });
      }
      const actions = {
        pause: () => timeline.transport.pause(),
        play: () => timeline.transport.play(),
        restart,
        seek: async () => {
          if (input.frame === undefined) throw new Error("seek needs a frame");
          const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
          const { frameCount } = SceneComposition.assert(readout.composition);
          if (input.frame >= frameCount) {
            throw new Error(
              `Frame ${String(input.frame)} is past the scene's last frame ${String(frameCount - 1)}.`,
            );
          }
          return timeline.transport.seekTo({ clock: "motionFrame", tick: input.frame });
        },
        setRate: () => {
          if (input.rate === undefined) throw new Error("setRate needs a rate");
          return timeline.transport.setRate({ rate: input.rate });
        },
        step: () => timeline.transport.stepBy({ ticks: input.ticks ?? 1 }),
      } as const;
      await actions[input.action]();
      // The transport after the action, so the next decision needs no second read.
      const transport = await timeline.transport.state();
      const { tick: frame } = await timeline.quantize({
        coordinate: transport.position,
        grid: { clock: "motionFrame", every: 1 },
        mode: "floor",
      });
      return webMcpResult({
        action: input.action,
        frame,
        playing: transport.playing,
        rate: transport.rate,
      });
    },
    inputSchema: webMcpInputSchema(ControlMotionInput),
    name: "control_motion_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { type: "string" },
        frame: { type: "integer" },
        playing: { type: "boolean" },
        rate: { type: "number" },
      },
      required: ["action", "frame", "playing", "rate"],
      type: "object",
    },
  },
];
