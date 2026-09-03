import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import { ACTOR_POOL_SPARE, type AuthoredStory, type MotionSceneComposition } from "../schema";
import {
  actorGroup,
  actorGroupId,
  actorIdOfRow,
  SCENE_COMPOSITION,
  sceneCompositionEvents,
} from "./composition";
import { promptLibrary } from "./prompts";
import type { motionTimelineDeclaration } from "./timeline";

type SceneChange = TimelineCompositionChange<typeof motionTimelineDeclaration>;

export const STANDING_PROMPT = "A person is standing still.";

/**
 * The rows the production opened with: the cast's rows plus the spare rows. The production
 * computes the same bound at open from the composition it opened on; a cast that shrank since
 * still has every row it opened with, so the story's cast size is the floor.
 */
const openedRowCount = (scene: MotionSceneComposition, story: AuthoredStory): number =>
  Math.max(story.actors.length, ...scene.actors.map(({ row }) => row + 1)) + ACTOR_POOL_SPARE;

/** How many actors can still join before the production runs out of rows. */
export const freeActorRows = (input: {
  readonly scene: MotionSceneComposition;
  readonly story: AuthoredStory;
}): number => openedRowCount(input.scene, input.story) - input.scene.actors.length;

/** The composition change that adds an actor on the lowest free row, and the actor's identity. */
export const addActorChange = async (input: {
  readonly origin: readonly [number, number, number];
  readonly path?: ReadonlyArray<readonly [number, number]>;
  readonly scenario?: ReadonlyArray<{ readonly frames: number; readonly prompt: string }>;
  readonly scene: MotionSceneComposition;
  readonly story: AuthoredStory;
}): Promise<{ readonly change: SceneChange; readonly id: string; readonly row: number }> => {
  const taken = new Set(input.scene.actors.map(({ row }) => row));
  const rows = Array.from({ length: openedRowCount(input.scene, input.story) }, (_unused, row) => row);
  const row = rows.find((candidate) => !taken.has(candidate));
  if (row === undefined) {
    throw new Error(
      `the production has no free actor row (${String(rows.length)} rows opened); open a new scene with author_scene to seat more actors`,
    );
  }
  const scenario = input.scenario ?? [{ frames: input.scene.frameCount, prompt: STANDING_PROMPT }];
  const total = scenario.reduce((sum, { frames }) => sum + frames, 0);
  if (total !== input.scene.frameCount) {
    throw new Error(
      `the actor's beats sum to ${String(total)} frames, not the scene's ${String(input.scene.frameCount)}`,
    );
  }
  await promptLibrary.ensure(scenario.map(({ prompt }) => prompt));
  const id = actorIdOfRow(row);
  const story: AuthoredStory = {
    actors: [
      {
        origin: [input.origin[0], input.origin[1], input.origin[2]],
        path: (input.path ?? [[0, 0]]).map(([x, z]) => [x, z]),
        scenario: scenario.map(({ frames, prompt }) => ({ frames, prompt })),
      },
    ],
    coverage: [...input.story.coverage],
    frameCount: input.scene.frameCount,
    title: input.story.title,
  };
  return {
    change: {
      composition: SCENE_COMPOSITION,
      type: "node/add",
      // Row zero of a one-actor story is this actor; the group keeps the pool row.
      value: actorGroup({ id, row, worldOffset: input.origin }, story),
    },
    id,
    row,
  };
};

/** The changes that remove an actor and the bodies that stood on its route. */
export const removeActorChanges = (input: {
  readonly actor: string;
  readonly scene: MotionSceneComposition;
}): readonly SceneChange[] => {
  if (!input.scene.actors.some(({ subject }) => subject === input.actor)) {
    throw new Error(
      `The scene has no actor "${input.actor}"; actors: ${input.scene.actors.map(({ subject }) => subject).join(", ")}.`,
    );
  }
  if (input.scene.actors.length === 1) {
    throw new Error("The scene keeps at least one actor; open a new scene to change the cast entirely.");
  }
  return [
    ...input.scene.bodies.flatMap(({ id, subject }): SceneChange[] =>
      subject === input.actor
        ? [{ composition: SCENE_COMPOSITION, item: id, type: "item/remove" }]
        : [],
    ),
    { composition: SCENE_COMPOSITION, node: actorGroupId(input.actor), type: "node/remove" },
  ];
};

/** Commit scene changes through the same admission the editor uses, under an author. */
export const commitSceneChanges = async (input: {
  readonly author: string;
  readonly changes: readonly SceneChange[];
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}) => {
  const preview = await input.timeline.composition.preview({ changes: [...input.changes] });
  return input.timeline.composition.commit({
    events: sceneCompositionEvents,
    id: `${input.author}/${crypto.randomUUID()}`,
    proposal: preview.proposal,
  });
};
