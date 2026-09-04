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
    description: `Control the transport. play starts the scene. pause stops it at the current frame. restart goes to frame 0 and plays. seek needs \`frame\`. step takes signed \`ticks\` and uses 1 if you give none. setRate needs a positive \`rate\`. The scene pauses at its last frame. A seek after the last frame is refused. The browser keeps the scene between reloads. newScene opens a new scene on a built-in story (\`story\`: ${storyChoices()
      .map(({ id, title }) => `${id} = ${title}`)
      .join(", ")}; ${DEFAULT_STORY} if you give none). The old scene stays in the catalog. The tools go away while the new scene opens, then read_scene_readiness reports open again. To open a scene on your own story, use author_scene.`,
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
      if (input.action === "pause") await timeline.transport.pause();
      if (input.action === "play") await timeline.transport.play();
      if (input.action === "restart") await restart();
      if (input.action === "seek") {
        const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
        const { frameCount } = SceneComposition.assert(readout.composition);
        if (input.frame >= frameCount) {
          throw new Error(
            `Frame ${String(input.frame)} is past the scene's last frame ${String(frameCount - 1)}.`,
          );
        }
        await timeline.transport.seekTo({ clock: "motionFrame", tick: input.frame });
      }
      if (input.action === "setRate") await timeline.transport.setRate({ rate: input.rate });
      if (input.action === "step") await timeline.transport.stepBy({ ticks: input.ticks ?? 1 });
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
