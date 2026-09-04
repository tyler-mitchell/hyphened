import { type } from "arktype";

import { CAMERA_SHOT_PRESETS } from "../../scene/cinematography";
import { SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import { authoredPromptSpans, storyChoices } from "../../scene/default";
import { openSceneProject, sceneProject, startNewScene } from "../../scene/project";
import { promptLibrary } from "../../scene/prompts";
import { environmentAsset } from "../../stage/environment";
import {
  AuthoredStory,
  AuthorSceneInput,
  CreateSceneInput,
  OpenSceneInput,
  SceneReadinessInput,
} from "../../schema";
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
    description:
      "Make a new empty scene and open it. The scene you have now stays saved and does not change. The new scene opens paused at frame 0. It has no actors, no bodies, and no environment. It has one camera on a point target, across all of its frames. Add the actors, the environment, the motion, and the camera. Then use control_motion_scene restart before you capture.",
    execute: async (raw) => {
      const input = CreateSceneInput.assert(raw);
      if (input.frameCount % PUBLISHED_FRAMES_PER_WINDOW !== 0) {
        return failure(
          new Error(
            `frameCount must be a multiple of ${String(PUBLISHED_FRAMES_PER_WINDOW)} frames`,
          ),
        );
      }
      const next = await startNewScene({
        story: AuthoredStory.assert({
          actors: [],
          coverage: [],
          frameCount: input.frameCount,
          title: input.title,
        }),
      });
      return webMcpResult({
        actors: [],
        frameCount: input.frameCount,
        scene: next.record.definition.id,
        status: "opening",
        title: input.title,
      });
    },
    inputSchema: webMcpInputSchema(CreateSceneInput),
    name: "create_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actors: { items: { type: "string" }, type: "array" },
        frameCount: { type: "integer" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
        title: { type: "string" },
      },
      required: ["actors", "frameCount", "scene", "status", "title"],
      type: "object",
    },
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "List every saved scene document with its stable identity, title, current cast size, environment size, character, and active state. The scene marked active is the one the other tools act on. Use open_scene with an id from this list; create_scene and author_scene create another document without overwriting these.",
    execute: async (raw) => {
      SceneReadinessInput.assert(raw);
      const { catalog } = await sceneProject();
      const [active, entries] = await Promise.all([catalog.active(), catalog.list()]);
      return webMcpResult({
        scenes: entries.map(({ definition }) => {
          const saved = definition.compositions?.[SCENE_COMPOSITION];
          const composition = saved === undefined ? undefined : SceneComposition(saved);
          return {
            active: definition.id === active?.definition.id,
            actors:
              composition === undefined || composition instanceof type.errors
                ? definition.story.actors.length
                : composition.actors.length,
            character: definition.character ?? "the released humanoid",
            environmentEntities: definition.environment?.length ?? 0,
            frameCount: definition.story.frameCount,
            id: definition.id,
            title: definition.title,
          };
        }),
      });
    },
    inputSchema: webMcpInputSchema(SceneReadinessInput),
    name: "list_scenes",
    outputSchema: {
      additionalProperties: false,
      properties: {
        scenes: {
          items: {
            additionalProperties: false,
            properties: {
              active: { type: "boolean" },
              actors: { type: "integer" },
              character: { type: "string" },
              environmentEntities: { type: "integer" },
              frameCount: { type: "integer" },
              id: { type: "string" },
              title: { type: "string" },
            },
            required: [
              "active",
              "actors",
              "character",
              "environmentEntities",
              "frameCount",
              "id",
              "title",
            ],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["scenes"],
      type: "object",
    },
  },
  {
    description:
      "Open one saved scene document by the stable id returned from list_scenes. The current document remains saved in the catalog, and the WebMCP tools re-register on the opened scene.",
    execute: async (raw) => {
      const input = OpenSceneInput.assert(raw);
      try {
        const next = await openSceneProject(input.scene);
        const saved = next.record.definition.compositions?.[SCENE_COMPOSITION];
        const composition = saved === undefined ? undefined : SceneComposition(saved);
        return webMcpResult({
          actors:
            composition === undefined || composition instanceof type.errors
              ? next.record.definition.story.actors.length
              : composition.actors.length,
          frameCount: next.record.definition.story.frameCount,
          scene: next.record.definition.id,
          status: "opening",
          title: next.record.definition.title,
        });
      } catch (cause) {
        return failure(cause);
      }
    },
    inputSchema: webMcpInputSchema(OpenSceneInput),
    name: "open_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actors: { type: "integer" },
        frameCount: { type: "integer" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
        title: { type: "string" },
      },
      required: ["actors", "frameCount", "scene", "status", "title"],
      type: "object",
    },
  },
  {
    description: `Make a new scene and open it, with its actors, its motion, its camera coverage, and, if you want, its environment and stage look. Do all of this in one call. Each actor has an origin, which is where it stands in the world, in metres. It has a planar path in its own frame, as (x, z) points, and the first point is its origin. It has beats in order, and each beat is a caption from the prompt library that the actor holds for a number of frames. Each beat must start on a ${String(PUBLISHED_FRAMES_PER_WINDOW)}-frame boundary. The beats together must equal frameCount, and frameCount must be a multiple of ${String(PUBLISHED_FRAMES_PER_WINDOW)}. 20 frames make one second. A walking, running, or sprinting caption moves the actor along its path at that caption's pace. The actor performs every other caption in place. Coverage is a sequence of preset shots with no gaps (${CAMERA_SHOT_PRESETS.join(", ")}), and each shot names an actor by its row. Environment entries use the assets that list_environment_assets returns. The render field sets the background, the ground, and the light. The scene you have now stays saved and does not change.`,
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
            `"${unknown}" is not in the motion library. Use list_motion_prompts with a category, posture, pace, or tag filter to choose a supported caption.`,
          ),
        );
      }
      const unknownAsset = input.environment?.find(
        ({ asset }) => environmentAsset(asset) === undefined,
      );
      if (unknownAsset !== undefined) {
        return failure(
          new Error(
            `Environment asset "${unknownAsset.asset}" does not exist; call list_environment_assets.`,
          ),
        );
      }
      const refusal = storyRefusal(story);
      if (refusal !== undefined) return failure(new Error(refusal));
      const next = await startNewScene({
        ...(input.environment === undefined ? {} : { environment: input.environment }),
        ...(input.render === undefined ? {} : { render: input.render }),
        story,
      });
      return webMcpResult({
        actors: story.actors.map((_actor, row) => `actor-${String(row + 1)}`),
        environmentEntities: input.environment?.length ?? 0,
        frameCount: story.frameCount,
        scene: next.record.definition.id,
        status: "opening",
        title: story.title,
      });
    },
    inputSchema: webMcpInputSchema(AuthorSceneInput),
    name: "author_scene",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actors: { items: { type: "string" }, type: "array" },
        environmentEntities: { type: "integer" },
        frameCount: { type: "integer" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
        title: { type: "string" },
      },
      required: ["actors", "environmentEntities", "frameCount", "scene", "status", "title"],
      type: "object",
    },
  },
];

export { storyChoices };
