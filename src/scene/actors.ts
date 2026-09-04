import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import {
  ACTOR_POOL_SPARE,
  type AuthoredStory,
  type MotionSceneComposition,
  PromptItemData,
} from "../schema";
import {
  actorGroup,
  actorGroupId,
  actorIdOfRow,
  MOTION_PROMPT_EVENT,
  SCENE_COMPOSITION,
  sceneCompositionEvents,
} from "./composition";
import { promptLibrary } from "./prompts";
import type { motionTimelineDeclaration } from "./timeline";

type SceneChange = TimelineCompositionChange<typeof motionTimelineDeclaration>;

export const STANDING_PROMPT = "A person is standing still.";

const openedRowCount = (story: AuthoredStory): number => story.actors.length + ACTOR_POOL_SPARE;

export const freeActorRows = (input: {
  readonly scene: MotionSceneComposition;
  readonly story: AuthoredStory;
}): number => openedRowCount(input.story) - input.scene.actors.length;

/** The composition change that adds an actor on the lowest free row, and the actor's identity. */
export const addActorChange = async (input: {
  readonly origin: readonly [number, number, number];
  readonly path?: ReadonlyArray<readonly [number, number]>;
  readonly scenario?: ReadonlyArray<{ readonly frames: number; readonly prompt: string }>;
  readonly scene: MotionSceneComposition;
  readonly story: AuthoredStory;
}): Promise<{ readonly change: SceneChange; readonly id: string; readonly row: number }> => {
  const taken = new Set(input.scene.actors.map(({ row }) => row));
  const rows = Array.from({ length: openedRowCount(input.story) }, (_unused, row) => row);
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

/** The change that re-captions one prompt span, keeping its exact range. */
export const setSpanPromptChange = async (input: {
  readonly item: string;
  readonly prompt: string;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): Promise<SceneChange> => {
  if (promptLibrary.find(input.prompt) === undefined) {
    throw new Error(`"${input.prompt}" is not in the prompt library.`);
  }
  const readout = await input.timeline.composition.read({ composition: SCENE_COMPOSITION });
  const track = readout.composition.children
    .flatMap((node) => (node.kind === "group" ? node.children : [node]))
    .find((node) => node.kind === "track" && node.items.some(({ id }) => id === input.item));
  const range =
    track?.kind === "track"
      ? track.items.find(({ id }) => id === input.item)?.range
      : undefined;
  const subject = track?.id.split("/")[1];
  if (range === undefined || subject === undefined) {
    throw new Error(`The scene has no prompt span "${input.item}".`);
  }
  // A library row loads the first time a span uses it.
  await promptLibrary.ensure([input.prompt]);
  const data = PromptItemData.assert({ prompt: input.prompt });
  return {
    composition: SCENE_COMPOSITION,
    item: input.item,
    type: "item/replace",
    value: {
      data,
      id: input.item,
      range: { clock: "motionFrame", duration: range.duration, start: range.start },
      startEvent: { data, kind: MOTION_PROMPT_EVENT, subject },
    },
  };
};

const promptSpan = (input: {
  readonly data: PromptItemData;
  readonly duration: number;
  readonly start: number;
  readonly subject: string;
}) => ({
  data: input.data,
  id: `prompt-${String(input.start)}/${input.subject}`,
  range: { clock: "motionFrame" as const, duration: input.duration, start: input.start },
  startEvent: { data: input.data, kind: MOTION_PROMPT_EVENT, subject: input.subject },
});

/**
 * The changes that take one prompt span out and give its frames to a neighbour.
 *
 * An actor's prompt track tiles the whole scene, so a span cannot simply leave: the neighbour that
 * closes the gap inherits its frames, and the span before it is preferred because its own start,
 * which names it, does not move.
 */
export const removeSpanChanges = async (input: {
  readonly item: string;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): Promise<readonly SceneChange[]> => {
  const readout = await input.timeline.composition.read({ composition: SCENE_COMPOSITION });
  const tracks = readout.composition.children.flatMap((node) =>
    node.kind === "group" ? node.children : [node],
  );
  const track = tracks.find(
    (node) => node.kind === "track" && node.items.some(({ id }) => id === input.item),
  );
  if (track?.kind !== "track") throw new Error(`The scene has no span "${input.item}".`);
  const subject = track.id.split("/")[1];
  const spans = track.items
    .flatMap((item) => (item.range === undefined ? [] : [{ ...item, range: item.range }]))
    .toSorted((left, right) => left.range.start - right.range.start);
  const at = spans.findIndex(({ id }) => id === input.item);
  const span = spans[at];
  if (span === undefined || subject === undefined) {
    throw new Error(`"${input.item}" is not a prompt span.`);
  }
  if (spans.length < 2) throw new Error("An actor keeps at least one prompt for the whole scene.");
  const previous = spans[at - 1];
  const remove = { composition: SCENE_COMPOSITION, item: input.item, type: "item/remove" } as const;
  if (previous !== undefined) {
    return [
      {
        composition: SCENE_COMPOSITION,
        item: previous.id,
        type: "item/replace",
        value: promptSpan({
          data: PromptItemData.assert(previous.data),
          duration: previous.range.duration + span.range.duration,
          start: previous.range.start,
          subject,
        }),
      },
      remove,
    ];
  }
  const next = spans[at + 1]!;
  return [
    remove,
    { composition: SCENE_COMPOSITION, item: next.id, type: "item/remove" },
    {
      composition: SCENE_COMPOSITION,
      track: track.id,
      type: "item/add",
      value: promptSpan({
        data: PromptItemData.assert(next.data),
        duration: span.range.duration + next.range.duration,
        start: span.range.start,
        subject,
      }),
    },
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
