import type {
  TimelineClockName,
  TimelineCompositionEventInput,
  TimelineCompositionEventResolver,
  TimelineCompositionVersion,
  TimelineEventKind,
  TimelineNode,
  TimelineSeriesId,
} from "@coretime/core";

import { MOTION_PROMPT_LIBRARY } from "../provider/prompt/embedding";
import {
  $,
  ActorPresence,
  CameraItemData,
  DEFAULT_SCENE_PRESENTATION,
  PromptItemData,
  RootConstraint,
  type ScenePresentationConfiguration,
} from "../schema";
import { authoredActor } from "./default";
import type { motionTimelineDeclaration } from "./timeline";

export const SCENE_COMPOSITION = "scene";
export const MOTION_PROMPT_EVENT = "motion/prompt" as const;
export const MOTION_ACTOR_EVENT = "motion/actor" as const;
export const MOTION_ROUTE_EVENT = "motion/route" as const;

export const compositionRevision = (version: TimelineCompositionVersion): string =>
  version.kind === "declaration"
    ? version.fingerprint
    : `${version.position.runId}:${version.position.branchId}:${String(version.position.index)}`;

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
)
  .narrow(
    (item, context) =>
      item.startEvent === undefined ||
      JSON.stringify(item.data) === JSON.stringify(item.startEvent.data) ||
      context.mustBe("a prompt whose item and playback event agree"),
  )
  .pipe((item) => ({
    ...item,
    conditioning: {
      identity: JSON.stringify({
        kind: "artifact",
        sha256: MOTION_PROMPT_LIBRARY.find(({ prompt }) => prompt === item.data.prompt)!.sha256,
      }),
    },
  }))
  .to($.MotionPromptSpan);

const PromptTrack = $.MotionPromptTrack.merge({ items: PromptSpan.array() });

const RootTrack = $.RootTrack;

const CameraTrack = $.TimelineCameraTrack.merge({
  items: $.TimelineCameraTrackItem.merge({ data: CameraItemData }).array(),
});

const ActorGroupShape = $.ActorGroup.narrow((group, context) => {
  const subject = actorSubject(group.id);
  if (subject === undefined) return context.mustBe("an actor group");
  const expected = actorTrackEntries.map(([track]) => actorTrackId({ subject, track }));
  return (
    JSON.stringify(group.children.map(({ id }) => id)) === JSON.stringify(expected) ||
    context.mustBe(`an actor owning exactly ${expected.join(", ")}`)
  );
});

const MotionActorGroup = ActorGroupShape.pipe((group) => ({
  promptTrack: PromptTrack.assert(group.children[0]),
  rootTrack: RootTrack.assert(group.children[1]),
  subject: actorSubject(group.id)!,
})).to($.MotionSceneActor);

const contiguousFrameCount = (
  items: readonly { readonly range: { readonly duration: number; readonly start: number } }[],
): number | undefined => {
  const ordered = items.toSorted((left, right) => left.range.start - right.range.start);
  return ordered.length > 0 &&
    ordered.every(
      (item, index) =>
        item.range.start ===
        (index === 0 ? 0 : ordered[index - 1]!.range.start + ordered[index - 1]!.range.duration),
    )
    ? ordered.at(-1)!.range.start + ordered.at(-1)!.range.duration
    : undefined;
};

export const SceneComposition = $.SceneCompositionInput.merge({
  children: MotionActorGroup.or(CameraTrack).array(),
})
  .narrow((composition, context) => {
    const actors = composition.children.flatMap((node) => ("subject" in node ? [node] : []));
    const cameras = composition.children.flatMap((node) => ("subject" in node ? [] : [node]));
    const subjects = new Set(actors.map(({ subject }) => subject));
    const frameCount =
      cameras[0] === undefined ? undefined : contiguousFrameCount(cameras[0].items);
    return (
      (actors.length > 0 &&
        cameras.length === 1 &&
        frameCount !== undefined &&
        actors.every((actor) => contiguousFrameCount(actor.promptTrack.items) === frameCount) &&
        cameras[0]!.items.every(
          ({ data }) =>
            data.target.kind !== "entities" ||
            data.target.entities.every((subject) => subjects.has(subject)),
        )) ||
      context.mustBe("one camera track targeting at least one declared actor group")
    );
  })
  .pipe((composition) => {
    const actors = composition.children.flatMap((node) => ("subject" in node ? [node] : []));
    const cameraTrack = composition.children.flatMap((node) =>
      "subject" in node ? [] : [node],
    )[0]!;
    return {
      actors,
      cameraTrack,
      frameCount: contiguousFrameCount(cameraTrack.items)!,
    };
  })
  .to($.MotionSceneComposition);

export const sceneCompositionEvents: TimelineCompositionEventResolver<
  typeof motionTimelineDeclaration
> = (context) => {
  const afterScene = SceneComposition.assert(context.after.compositions[SCENE_COMPOSITION]);
  const beforeComposition = context.before.compositions[SCENE_COMPOSITION];
  const beforeActors =
    beforeComposition === undefined ? [] : SceneComposition.assert(beforeComposition).actors;
  const before = new Map(beforeActors.map((actor) => [actor.subject, actor]));
  const after = new Map(afterScene.actors.map((actor) => [actor.subject, actor]));
  const edited = [...after].filter(
    ([subject, actor]) =>
      before.has(subject) && JSON.stringify(before.get(subject)) !== JSON.stringify(actor),
  );
  return [
    ...edited.map(([subject]): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
      kind: MOTION_ROUTE_EVENT,
      payload: { subject },
      subject,
    })),
    ...[...after.keys()]
      .filter((subject) => !before.has(subject))
      .map((subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_ACTOR_EVENT,
        payload: ActorPresence.assert({ active: true, subject }),
        subject,
      })),
    ...[...before.keys()]
      .filter((subject) => !after.has(subject))
      .map((subject): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_ACTOR_EVENT,
        payload: ActorPresence.assert({ active: false, subject }),
        subject,
      })),
  ];
};
