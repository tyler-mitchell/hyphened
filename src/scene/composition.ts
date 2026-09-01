import { type } from "arktype";
import type {
  TimelineClockName,
  TimelineCompositionEditEventContext,
  TimelineCompositionEventInput,
  TimelineCompositionEventResolver,
  TimelineEventKind,
  TimelineNode,
  TimelineSeriesId,
} from "@coretime/core";

import { RootConstraint } from "../motion/request";
import { MOTION_PROMPT_LIBRARY } from "../providers/ardy/prompt/embedding";
import { authoredActor } from "./authored-scene";
import type { motionTimelineDeclaration } from "../motion-scene";

export const SCENE_COMPOSITION = "scene";
export const MOTION_PROMPT_EVENT = "motion/prompt" as const;
export const MOTION_ACTOR_EVENT = "motion/actor" as const;

export const actorGroupId = (subject: string) => `actor/${subject}`;
export const actorSubject = (groupId: string): string | undefined =>
  groupId.startsWith("actor/") ? groupId.slice("actor/".length) : undefined;
export const actorTrackId = (input: { readonly subject: string; readonly track: string }) =>
  `${input.track}/${input.subject}`;
export const actorTrackKind = (trackId: string) => trackId.split("/")[0] ?? trackId;

export const PromptItemData = type({ prompt: "string >= 1" });
export type PromptItemData = typeof PromptItemData.infer;

export const ActorPresence = type({ active: "boolean", subject: "string >= 1" });
export type ActorPresence = typeof ActorPresence.infer;

export const ACTOR_TRACKS = {
  prompts: {
    admits: PromptItemData,
    glyph: "prompt",
    label: "Prompts",
    overlap: "forbid",
    tone: "prompt",
  },
  root: {
    admits: RootConstraint,
    glyph: "route",
    label: "2D Root",
    overlap: "allow",
    tone: "root",
  },
} as const;

export type ActorTrackId = keyof typeof ACTOR_TRACKS;
export type ActorTrack = (typeof ACTOR_TRACKS)[ActorTrackId];

export const PROMPT_TRACK = "prompts" satisfies ActorTrackId;
export const ROOT_TRACK = "root" satisfies ActorTrackId;

export const actorTrackEntries = Object.entries(ACTOR_TRACKS) as ReadonlyArray<
  readonly [ActorTrackId, ActorTrack]
>;

export const actorTrack = (trackId: string): ActorTrack | undefined => {
  const kind = actorTrackKind(trackId);
  return Object.hasOwn(ACTOR_TRACKS, kind) ? ACTOR_TRACKS[kind as ActorTrackId] : undefined;
};

export const promptItemId = (input: { readonly start: number; readonly subject: string }) =>
  `prompt-${String(input.start)}/${input.subject}`;

type SceneNode = TimelineNode<
  TimelineClockName<typeof motionTimelineDeclaration>,
  TimelineSeriesId<typeof motionTimelineDeclaration>,
  TimelineEventKind<typeof motionTimelineDeclaration>
>;
export const actorGroup = (subject: string): SceneNode => {
  const authored = authoredActor(subject);
  const promptItems = authored.prompts.map((span) => {
    const data = PromptItemData.assert({ prompt: span.prompt });
    return {
      data,
      id: promptItemId({ start: span.start, subject }),
      range: {
        clock: "motionFrame" as const,
        duration: span.durationFrames,
        start: span.start,
      },
      startEvent: { data, kind: MOTION_PROMPT_EVENT, subject },
    };
  });
  const rootItems = authored.roots.map(({ constraint, tick }) => ({
    at: { clock: "motionFrame" as const, tick },
    data: RootConstraint.assert(constraint),
    id: `root-${String(tick)}/${subject}`,
  }));
  return {
    children: actorTrackEntries.map(
      ([track, declared]): SceneNode => ({
        data: { label: declared.label, tone: declared.tone },
        id: actorTrackId({ subject, track }),
        items: track === PROMPT_TRACK ? promptItems : rootItems,
        kind: "track" as const,
        overlap: declared.overlap,
      }),
    ),
    data: { label: subject },
    id: actorGroupId(subject),
    kind: "group" as const,
  };
};

const availablePrompts: ReadonlySet<string> = new Set(
  MOTION_PROMPT_LIBRARY.map(({ prompt }) => prompt),
);

const PromptSpan = type({
  data: PromptItemData,
  range: { clock: "'motionFrame'", duration: "number.integer > 0", start: "number.integer >= 0" },
  "startEvent?": { data: PromptItemData, kind: `'${MOTION_PROMPT_EVENT}'`, subject: "string >= 1" },
})
  .narrow(
    (item, context) =>
      availablePrompts.has(item.data.prompt) ||
      context.mustBe("a prompt with a conditioning feature in this build"),
  )
  .narrow(
    (item, context) =>
      item.startEvent === undefined ||
      JSON.stringify(item.data) === JSON.stringify(item.startEvent.data) ||
      context.mustBe("a prompt whose item and playback event agree"),
  );

const PromptTrack = type({ items: PromptSpan.array() });

const RootTrack = type({
  items: type({
    at: { clock: "'motionFrame'", tick: "number.integer >= 0" },
    data: RootConstraint,
  }).array(),
});

const ACTOR_TRACK_ADMISSION = { [PROMPT_TRACK]: PromptTrack, [ROOT_TRACK]: RootTrack } as const;

const ActorGroupShape = type({
  children: type({ id: "string >= 1", kind: "'track'" }).array(),
  id: "string >= 1",
  kind: "'group'",
}).narrow((group, context) => {
  const subject = actorSubject(group.id);
  if (subject === undefined) return context.mustBe("an actor group");
  const expected = actorTrackEntries.map(([track]) => actorTrackId({ subject, track }));
  return (
    JSON.stringify(group.children.map(({ id }) => id)) === JSON.stringify(expected) ||
    context.mustBe(`an actor owning exactly ${expected.join(", ")}`)
  );
});

const actorSubjects = (
  document: TimelineCompositionEditEventContext<typeof motionTimelineDeclaration>["after"],
): ReadonlySet<string> =>
  new Set(
    (document.compositions[SCENE_COMPOSITION]?.children ?? []).flatMap((node) => {
      const subject = actorSubject(node.id);
      return subject === undefined ? [] : [subject];
    }),
  );

export const sceneCompositionEvents: TimelineCompositionEventResolver<
  typeof motionTimelineDeclaration
> = (context) => {
  for (const node of context.after.compositions[SCENE_COMPOSITION]?.children ?? []) {
    const group = ActorGroupShape.assert(node);
    for (const child of group.children) {
      ACTOR_TRACK_ADMISSION[actorTrackKind(child.id) as ActorTrackId].assert(child);
    }
  }
  const before = actorSubjects(context.before);
  const after = actorSubjects(context.after);
  return [
    ...[...after]
      .filter((subject) => !before.has(subject))
      .map(
        (subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
          kind: MOTION_ACTOR_EVENT,
          payload: ActorPresence.assert({ active: true, subject }),
          subject,
        }),
      ),
    ...[...before]
      .filter((subject) => !after.has(subject))
      .map(
        (subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
          kind: MOTION_ACTOR_EVENT,
          payload: ActorPresence.assert({ active: false, subject }),
          subject,
        }),
      ),
  ];
};
