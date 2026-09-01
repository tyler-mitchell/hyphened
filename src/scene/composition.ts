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
export { MOTION_ACTOR_EVENT, MOTION_PROMPT_EVENT, MOTION_ROUTE_EVENT } from "./scene-events";
import { MOTION_ACTOR_EVENT, MOTION_PROMPT_EVENT, MOTION_ROUTE_EVENT } from "./scene-events";

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

const CameraPoint = type(["number", "number", "number"]);
export const CameraProjectionData = type({
  far: "number > 0",
  fieldOfViewY: "0 < number < 3.141592653589793",
  kind: "'perspective'",
  near: "number > 0",
});
export type CameraProjectionData = typeof CameraProjectionData.infer;

const CameraTargetData = type({
  entities: type("string >= 1").array().atLeastLength(1),
  kind: "'entities'",
  offset: CameraPoint,
}).or({
  kind: "'point'",
  position: CameraPoint,
});

export const CameraItemData = type({
  distance: "number > 0",
  kind: "'camera'",
  label: "string >= 1",
  mode: "'orbit'",
  pitch: "number",
  projection: CameraProjectionData,
  target: CameraTargetData,
  yaw: "number",
}).or({
  kind: "'camera'",
  label: "string >= 1",
  mode: "'look-at'",
  position: CameraPoint,
  projection: CameraProjectionData,
  target: CameraTargetData,
});
export type CameraItemData = typeof CameraItemData.infer;

export const CAMERA_TRACK = "camera";

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
    children: actorTrackEntries.map(([track, declared]): SceneNode => ({
      data: { label: declared.label, tone: declared.tone },
      id: actorTrackId({ subject, track }),
      items: track === PROMPT_TRACK ? promptItems : rootItems,
      kind: "track" as const,
      overlap: declared.overlap,
    })),
    data: { label: subject },
    id: actorGroupId(subject),
    kind: "group" as const,
  };
};

export const cameraTrack = (input: {
  readonly durationFrames: number;
  readonly entities: readonly string[];
}): SceneNode => {
  const cut = Math.floor(input.durationFrames / 2);
  const target = { entities: input.entities, kind: "entities" as const, offset: [0, 0, 0] };
  const projection = {
    far: 1_000,
    fieldOfViewY: Math.PI / 4,
    kind: "perspective" as const,
    near: 0.1,
  };
  return {
    data: { label: "Camera" },
    id: CAMERA_TRACK,
    items: [
      {
        data: CameraItemData.assert({
          distance: 5.5,
          kind: "camera",
          label: "Opening Camera",
          mode: "orbit",
          pitch: 0.22,
          projection,
          target,
          yaw: 0.55,
        }),
        id: "camera-0",
        range: { clock: "motionFrame", duration: cut, start: 0 },
      },
      {
        data: CameraItemData.assert({
          distance: 4.5,
          kind: "camera",
          label: "Side Camera",
          mode: "orbit",
          pitch: 0.12,
          projection,
          target,
          yaw: 1.1,
        }),
        id: "camera-1",
        range: {
          clock: "motionFrame",
          duration: input.durationFrames - cut,
          start: cut,
        },
      },
    ],
    kind: "track",
    overlap: "forbid",
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

const CameraTrack = type({
  id: `'${CAMERA_TRACK}'`,
  items: type({
    data: CameraItemData,
    range: { clock: "'motionFrame'", duration: "number.integer > 0", start: "number.integer >= 0" },
  }).array(),
  kind: "'track'",
  overlap: "'forbid'",
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
    if (node.id === CAMERA_TRACK) {
      const track = CameraTrack.assert(node);
      for (const item of track.items) {
        const camera = CameraItemData.assert(item.data);
        if (camera.projection.far <= camera.projection.near) {
          throw new RangeError("Camera far plane must exceed its near plane.");
        }
      }
      continue;
    }
    const group = ActorGroupShape.assert(node);
    for (const child of group.children) {
      ACTOR_TRACK_ADMISSION[actorTrackKind(child.id) as ActorTrackId].assert(child);
    }
  }
  const before = actorSubjects(context.before);
  const after = actorSubjects(context.after);
  const authoredFingerprint = (
    document: TimelineCompositionEditEventContext<typeof motionTimelineDeclaration>["after"],
    subject: string,
  ) =>
    JSON.stringify(
      (document.compositions[SCENE_COMPOSITION]?.children ?? []).find(
        (node) => node.id === actorGroupId(subject),
      ),
    );
  const edited = [...after].filter(
    (subject) =>
      before.has(subject) &&
      authoredFingerprint(context.before, subject) !== authoredFingerprint(context.after, subject),
  );
  return [
    ...edited.map(
      (subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_ROUTE_EVENT,
        payload: { subject },
        subject,
      }),
    ),
    ...[...after]
      .filter((subject) => !before.has(subject))
      .map((subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_ACTOR_EVENT,
        payload: ActorPresence.assert({ active: true, subject }),
        subject,
      })),
    ...[...before]
      .filter((subject) => !after.has(subject))
      .map((subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_ACTOR_EVENT,
        payload: ActorPresence.assert({ active: false, subject }),
        subject,
      })),
  ];
};
