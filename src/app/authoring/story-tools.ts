import { type } from "arktype";

import { CAMERA_SHOT_PRESETS } from "../../scene/cinematography";
import { authoredPromptSpans, storyChoices } from "../../scene/default";
import { startNewScene } from "../../scene/project";
import { promptLibrary } from "../../scene/prompts";
import { AuthoredStory, AuthorSceneInput } from "../../schema";
import { PUBLISHED_FRAMES_PER_WINDOW } from "webgpu-engine/motion";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

const failure = (cause: unknown) => ({
  content: [
    {
      text: cause instanceof Error ? cause.message : String(cause),
      type: "text" as const,
    },
  ],
  isError: true,
});

/** Everything the seed would refuse, named before a scene is opened on the story. */
const storyRefusal = (story: AuthoredStory): string | undefined => {
  if (story.frameCount % PUBLISHED_FRAMES_PER_WINDOW !== 0) {
    return `frameCount ${String(story.frameCount)} is not a multiple of the ${String(PUBLISHED_FRAMES_PER_WINDOW)}-frame window`;
  }
  const spanRefusal = story.actors
    .map((actor, row) => {
      const total = actor.scenario.reduce((sum, { frames }) => sum + frames, 0);
      if (total !== story.frameCount) {
        return `actor ${String(row)}'s beats sum to ${String(total)} frames, not the story's ${String(story.frameCount)}`;
      }
      try {
        authoredPromptSpans(story, row);
        return undefined;
      } catch (cause) {
        return `actor ${String(row)}: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
    })
    .find((refusal) => refusal !== undefined);
  if (spanRefusal !== undefined) return spanRefusal;
  const shots = story.coverage.toSorted((left, right) => left.start - right.start);
  const gap = shots.find(
    (shot, index) =>
      shot.end <= shot.start ||
      shot.row >= story.actors.length ||
      shot.start !== (index === 0 ? 0 : shots[index - 1]!.end),
  );
  if (gap !== undefined) {
    return `coverage must be contiguous from frame 0 with each row below ${String(story.actors.length)}; the ${gap.preset} shot at ${String(gap.start)}-${String(gap.end)} on row ${String(gap.row)} breaks it`;
  }
  return shots.at(-1)!.end === story.frameCount
    ? undefined
    : `coverage ends at ${String(shots.at(-1)!.end)}, not at the story's ${String(story.frameCount)} frames`;
};

export const storyTools = (): readonly RegisteredWebMcpTool[] => [
  {
    description: `Open a new scene on a story you author, the same shape the built-in stories use. Each actor is where it stands in the world (origin, metres), the planar path it follows in its own frame (x, z; the first point is its origin), and its beats in order: a caption from the prompt library held for a number of frames. Beats must begin on ${String(PUBLISHED_FRAMES_PER_WINDOW)}-frame boundaries and sum to frameCount, itself a multiple of ${String(PUBLISHED_FRAMES_PER_WINDOW)}; 20 frames is one second. Walking, running, and sprinting captions move the actor along its path at their pace; the rest are performed in place. The coverage is the cuts: contiguous shots from frame 0 to frameCount, each a preset (${CAMERA_SHOT_PRESETS.join(", ")}) on one actor by row index. The scene opens in place (read_scene_readiness reports open again once the tools are back) and the previous document stays in the catalog. Read list_motion_prompts for the captions; read_scene_summary lists the built-in stories to learn from.`,
    execute: async (raw) => {
      const input = AuthorSceneInput.assert(raw);
      const story = AuthoredStory(input.story);
      if (story instanceof type.errors) return failure(new Error(story.summary));
      const unknown = story.actors
        .flatMap(({ scenario }) => scenario.map(({ prompt }) => prompt))
        .find((prompt) => promptLibrary.find(prompt) === undefined);
      if (unknown !== undefined) {
        return failure(
          new Error(
            `"${unknown}" is not in the prompt library; prompts: ${promptLibrary
              .list()
              .map(({ prompt }) => prompt)
              .join(" | ")}`,
          ),
        );
      }
      const refusal = storyRefusal(story);
      if (refusal !== undefined) return failure(new Error(refusal));
      const next = await startNewScene({ story });
      return webMcpResult({
        actors: story.actors.map((_actor, row) => `actor-${String(row + 1)}`),
        frameCount: story.frameCount,
        scene: next.record.definition.id,
        title: story.title,
      });
    },
    inputSchema: webMcpInputSchema(AuthorSceneInput),
    name: "author_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actors: { items: { type: "string" }, type: "array" },
        frameCount: { type: "integer" },
        scene: { type: "string" },
        title: { type: "string" },
      },
      required: ["actors", "frameCount", "scene", "title"],
      type: "object",
    },
  },
];

export { storyChoices };
