import type {
  TimelineClockName,
  TimelineCompositionEventInput,
  TimelineCompositionEventResolver,
  TimelineCompositionVersion,
  TimelineEventKind,
  TimelineNode,
  TimelineSeriesId,
} from "@coretime/core";

import { promptLibrary } from "./prompts";
import {
  $,
  ActorPresence,
  CameraItemData,
  DEFAULT_SCENE_PRESENTATION,
  BodyItemData,
  PromptItemData,
  type ScenePresentationConfiguration,
} from "../schema";
import {
  MOTION_FRAMES_PER_SECOND,
  RootConstraint,
  type MotionSubjectDefinition,
} from "webgpu-engine/motion";
import { authoredActor, authoredPromptSpans } from "./default";
import type { motionTimelineDeclaration } from "./timeline";

export const SCENE_COMPOSITION = "scene";
export const MOTION_PROMPT_EVENT = "motion/prompt" as const;
export const MOTION_ACTOR_EVENT = "motion/actor" as const;
export const MOTION_ROUTE_EVENT = "motion/route" as const;
/** A body on the body track was added, changed, or removed; the subject is the body's item id. */
export const MOTION_BODY_EVENT = "motion/body" as const;

export const compositionRevision = (version: TimelineCompositionVersion): string =>
  version.kind === "declaration"
    ? version.fingerprint
    : `${version.position.runId}:${version.position.branchId}:${String(version.position.index)}`;

export const actorGroupId = (subject: string) => `actor/${subject}`;
export const actorSubject = (groupId: string): string | undefined =>
  groupId.startsWith("actor/") ? groupId.slice("actor/".length) : undefined;
export const actorTrackId = (input: { readonly subject: string; readonly track: string }) =>
  `${input.track}/${input.subject}`;
const actorTrackKind = (trackId: string) => trackId.split("/")[0] ?? trackId;

export const CAMERA_TRACK = "camera";
export const BODY_TRACK = "bodies";

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

type ActorTrackId = keyof typeof ACTOR_TRACKS;
type ActorTrack = (typeof ACTOR_TRACKS)[ActorTrackId];

export const PROMPT_TRACK = "prompts" satisfies ActorTrackId;
export const ROOT_TRACK = "root" satisfies ActorTrackId;

const actorTrackEntries = Object.entries(ACTOR_TRACKS) as ReadonlyArray<
  readonly [ActorTrackId, ActorTrack]
>;

export const actorTrack = (trackId: string): ActorTrack | undefined => {
  const kind = actorTrackKind(trackId);
  return Object.hasOwn(ACTOR_TRACKS, kind) ? ACTOR_TRACKS[kind as ActorTrackId] : undefined;
};

const promptItemId = (input: { readonly start: number; readonly subject: string }) =>
  `prompt-${String(input.start)}/${input.subject}`;

type SceneNode = TimelineNode<
  TimelineClockName<typeof motionTimelineDeclaration>,
  TimelineSeriesId<typeof motionTimelineDeclaration>,
  TimelineEventKind<typeof motionTimelineDeclaration>
>;
export const actorGroup = (subject: MotionSubjectDefinition): SceneNode => {
  const authored = authoredActor(subject.id, subject.row);
  const promptItems = authored.prompts.map((span) => {
    const data = PromptItemData.assert({ prompt: span.prompt });
    return {
      data,
      id: promptItemId({ start: span.start, subject: subject.id }),
      range: {
        clock: "motionFrame" as const,
        duration: span.durationFrames,
        start: span.start,
      },
      startEvent: { data, kind: MOTION_PROMPT_EVENT, subject: subject.id },
    };
  });
  const rootItems = authored.roots.map(({ constraint, tick }) => ({
    at: { clock: "motionFrame" as const, tick },
    data: RootConstraint.assert(constraint),
    id: `root-${String(tick)}/${subject.id}`,
  }));
  return {
    children: actorTrackEntries.map(([track, declared]): SceneNode => ({
      data: { label: declared.label, tone: declared.tone },
      id: actorTrackId({ subject: subject.id, track }),
      items: track === PROMPT_TRACK ? promptItems : rootItems,
      kind: "track" as const,
      overlap: declared.overlap,
    })),
    data: {
      label: subject.id,
      row: subject.row,
      worldOffset: subject.worldOffset,
    },
    id: actorGroupId(subject.id),
    kind: "group" as const,
  };
};

/**
 * The body track: one entity per body placed in the world. Its components are its shape and
 * mass and where it stands (an actor's route at the item's frame, at an elevation). Lowering
 * resolves each into a physics row.
 */
export const bodyTrack = (
  bodies: ReadonlyArray<{ readonly data: BodyItemData; readonly tick: number }>,
): SceneNode => ({
  data: { label: "Bodies" },
  id: BODY_TRACK,
  items: bodies.map(({ data, tick }) => ({
    at: { clock: "motionFrame" as const, tick },
    data: BodyItemData.assert(data),
    id: `${data.label}-${String(tick)}/${data.subject}`,
  })),
  kind: "track",
  overlap: "allow",
});

/** Frames before the earliest span of a prompt across the seeded actors, or none when no actor has it. */
const framesBeforePrompt = (input: {
  readonly actorCount: number;
  readonly lead: number;
  readonly prompt: string;
}): number | undefined => {
  const starts = Array.from({ length: input.actorCount }, (_unused, row) =>
    authoredPromptSpans(row).find((span) => span.prompt === input.prompt)?.start,
  ).filter((start): start is number => start !== undefined);
  return starts.length === 0 ? undefined : Math.max(0, Math.min(...starts) - input.lead);
};

export const cameraTrack = (input: {
  readonly durationFrames: number;
  readonly entities: readonly string[];
  readonly presentation?: ScenePresentationConfiguration["camera"];
}): SceneNode => {
  const presentation = input.presentation ?? DEFAULT_SCENE_PRESENTATION.camera;
  // The cut to the side view is placed by the story, two seconds before the first duck, so the
  // duck is seen from the side; a scene without a duck cuts at the authored fraction.
  const cut =
    framesBeforePrompt({
      actorCount: input.entities.length,
      lead: 2 * MOTION_FRAMES_PER_SECOND,
      prompt: "Duck under obstacle and rise.",
    }) ?? Math.floor(input.durationFrames * presentation.cutFraction);
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

const PromptSpan = $.PromptSpan.narrow(
  (item, context) =>
    promptLibrary.find(item.data.prompt) !== undefined ||
    context.mustBe("a prompt with a conditioning feature in the prompt library"),
)
  .narrow(
    (item, context) =>
      item.startEvent === undefined ||
      JSON.stringify(item.data) === JSON.stringify(item.startEvent.data) ||
      context.mustBe("a prompt whose item and playback event agree"),
  )
  .pipe((item) => ({
    ...item,
    // The embedding row's digest is the conditioning identity.
    conditioning: {
      identity: promptLibrary.find(item.data.prompt)!.identity,
    },
  }))
  .to($.MotionPromptSpan);

const PromptTrack = $.MotionPromptTrack.merge({ items: PromptSpan.array() });

const RootTrack = $.RootTrack;

const CameraTrack = $.TimelineCameraTrack.merge({
  items: $.TimelineCameraTrackItem.merge({ data: CameraItemData }).array(),
});

const BodyTrack = $.TimelineBodyTrack;

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
  row: group.data.row,
  rootTrack: RootTrack.assert(group.children[1]),
  subject: actorSubject(group.id)!,
  worldOffset: group.data.worldOffset,
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

type SceneChild =
  | typeof MotionActorGroup.infer
  | typeof CameraTrack.infer
  | typeof BodyTrack.infer;
const sceneActors = (children: readonly SceneChild[]) =>
  children.flatMap((node) => ("subject" in node ? [node] : []));
const sceneCameras = (children: readonly SceneChild[]) =>
  children.flatMap((node) => ("id" in node && node.id === CAMERA_TRACK ? [node] : []));
const sceneBodies = (children: readonly SceneChild[]) =>
  children.flatMap((node) => ("id" in node && node.id === BODY_TRACK ? [node] : []));

export const SceneComposition = $.SceneCompositionInput.merge({
  children: MotionActorGroup.or(CameraTrack).or(BodyTrack).array(),
})
  .narrow((composition, context) => {
    const actors = sceneActors(composition.children);
    const cameras = sceneCameras(composition.children);
    const bodies = sceneBodies(composition.children);
    const subjects = new Set(actors.map(({ subject }) => subject));
    const rows = new Set(actors.map(({ row }) => row));
    const frameCount =
      cameras[0] === undefined ? undefined : contiguousFrameCount(cameras[0].items);
    return (
      (actors.length > 0 &&
        rows.size === actors.length &&
        cameras.length === 1 &&
        bodies.length <= 1 &&
        frameCount !== undefined &&
        actors.every((actor) => contiguousFrameCount(actor.promptTrack.items) === frameCount) &&
        cameras[0]!.items.every(
          ({ data }) =>
            data.target.kind !== "entities" ||
            data.target.entities.every((subject) => subjects.has(subject)),
        ) &&
        bodies.every((track) => track.items.every(({ data }) => subjects.has(data.subject)))) ||
      context.mustBe(
        "one camera track and at most one body track, each targeting declared actor groups",
      )
    );
  })
  .pipe((composition) => {
    const actors = sceneActors(composition.children);
    const cameraTrack = sceneCameras(composition.children)[0]!;
    return {
      actors,
      cameraTrack,
      frameCount: contiguousFrameCount(cameraTrack.items)!,
      bodies: sceneBodies(composition.children).flatMap((track) =>
        track.items.map(({ at, data, id }) => ({
          elevation: data.elevation,
          halfExtents: data.halfExtents,
          id,
          mass: data.mass,
          subject: data.subject,
          tick: at.tick,
        })),
      ),
    };
  })
  .to($.MotionSceneComposition);

export const sceneCompositionEvents: TimelineCompositionEventResolver<
  typeof motionTimelineDeclaration
> = (context) => {
  const afterScene = SceneComposition.assert(context.after.compositions[SCENE_COMPOSITION]);
  const beforeComposition = context.before.compositions[SCENE_COMPOSITION];
  const beforeScene =
    beforeComposition === undefined ? undefined : SceneComposition.assert(beforeComposition);
  const before = new Map((beforeScene?.actors ?? []).map((actor) => [actor.subject, actor]));
  const after = new Map(afterScene.actors.map((actor) => [actor.subject, actor]));
  const edited = [...after].filter(
    ([subject, actor]) =>
      before.has(subject) && JSON.stringify(before.get(subject)) !== JSON.stringify(actor),
  );
  const bodiesBefore = new Map((beforeScene?.bodies ?? []).map((body) => [body.id, body]));
  const bodiesAfter = new Map(afterScene.bodies.map((body) => [body.id, body]));
  const bodyIds = new Set([...bodiesBefore.keys(), ...bodiesAfter.keys()]);
  return [
    ...[...bodyIds]
      .filter(
        (id) => JSON.stringify(bodiesBefore.get(id)) !== JSON.stringify(bodiesAfter.get(id)),
      )
      .map((id): TimelineCompositionEventInput<typeof motionTimelineDeclaration> => ({
        kind: MOTION_BODY_EVENT,
        payload: { id },
        subject: id,
      })),
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
