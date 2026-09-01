import type {
  TimelineClockName,
  TimelineCompositionEditEventContext,
  TimelineCompositionEventInput,
  TimelineCompositionEventResolver,
  TimelineEventKind,
  TimelineNode,
  TimelineSeriesId,
} from "@coretime/core";

import { MOTION_PROMPT_LIBRARY } from "../providers/ardy/prompt/embedding";
import {
  $,
  ActorPresence,
  CameraItemData,
  DEFAULT_SCENE_PRESENTATION,
  PromptItemData,
  RootConstraint,
  type ScenePresentationConfiguration,
} from "../schema";
import { authoredActor } from "./authored-scene";
import type { motionTimelineDeclaration } from "../motion-scene/timeline";

export const SCENE_COMPOSITION = "scene";
export { MOTION_ACTOR_EVENT, MOTION_PROMPT_EVENT, MOTION_ROUTE_EVENT } from "./scene-events";
import { MOTION_ACTOR_EVENT, MOTION_PROMPT_EVENT, MOTION_ROUTE_EVENT } from "./scene-events";

export const actorGroupId = (subject: string) => `actor/${subject}`;
export const actorSubject = (groupId: string): string | undefined =>
  groupId.startsWith("actor/") ? groupId.slice("actor/".length) : undefined;
export const actorTrackId = (input: { readonly subject: string; readonly track: string }) =>
  `${input.track}/${input.subject}`;
export const actorTrackKind = (trackId: string) => trackId.split("/")[0] ?? trackId;

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
  readonly presentation?: ScenePresentationConfiguration["camera"];
}): SceneNode => {
  const presentation = input.presentation ?? DEFAULT_SCENE_PRESENTATION.camera;
  const cut = Math.floor(input.durationFrames * presentation.cutFraction);
  const target =
    presentation.target.kind === "entities"
      ? { ...presentation.target, entities: input.entities }
      : presentation.target;
  const camera = (shot: ScenePresentationConfiguration["camera"]["shots"][number]) =>
    CameraItemData.assert({ ...shot, kind: "camera", projection: presentation.projection, target });
  return {
    data: { label: presentation.label },
    id: CAMERA_TRACK,
    items: [
      {
        data: camera(presentation.shots[0]),
        id: "camera-0",
        range: { clock: "motionFrame", duration: cut, start: 0 },
      },
      {
        data: camera(presentation.shots[1]),
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

const PromptSpan = $.PromptSpan.narrow(
  (item, context) =>
    availablePrompts.has(item.data.prompt) ||
    context.mustBe("a prompt with a conditioning feature in this build"),
).narrow(
  (item, context) =>
    item.startEvent === undefined ||
    JSON.stringify(item.data) === JSON.stringify(item.startEvent.data) ||
    context.mustBe("a prompt whose item and playback event agree"),
);

const PromptTrack = $.PromptTrack.merge({ items: PromptSpan.array() });

const RootTrack = $.RootTrack;

const CameraTrack = $.TimelineCameraTrack;

const ACTOR_TRACK_ADMISSION = { [PROMPT_TRACK]: PromptTrack, [ROOT_TRACK]: RootTrack } as const;

const ActorGroupShape = $.ActorGroup.narrow((group, context) => {
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
    ...edited.map((subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
      kind: MOTION_ROUTE_EVENT,
      payload: { subject },
      subject,
    })),
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
