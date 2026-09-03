/**
 * Shot presets: the setups a director names. Each is a crane arm around the subject, framed off
 * the subject's direction of travel, with a lens. Yaw offsets are radians from that heading:
 * zero sits the camera ahead of the subject looking back, PI behind, PI / 2 alongside.
 */
export const CAMERA_SHOT_PRESETS = [
  "establishing",
  "tracking",
  "follow",
  "close-up",
  "low-angle",
  "crane",
  "reveal",
  "hero",
] as const;
export type CameraShotPreset = (typeof CAMERA_SHOT_PRESETS)[number];

/** A 35 mm filmback: the focal length in millimetres sets the vertical field of view. */
const FILMBACK_HEIGHT_MILLIMETRES = 24;

export const fieldOfViewOfFocalLength = (focalLengthMillimetres: number): number =>
  2 * Math.atan(FILMBACK_HEIGHT_MILLIMETRES / 2 / focalLengthMillimetres);

interface ShotSetup {
  readonly distance: number;
  readonly focalLength: number;
  /** Lead room: metres ahead of the subject along its travel that the arm points at. */
  readonly lead: number;
  /** Where the arm points, relative to the subject's root: the face is about 0.6 above it. */
  readonly offset: readonly [number, number, number];
  readonly pitch: number;
  /** The whole scene, or the named subject. */
  readonly target: "scene" | "subject";
  readonly to?: { readonly distance: number; readonly pitch: number; readonly yawOffset: number };
  readonly yawOffset: number;
}

const SHOTS: Readonly<Record<CameraShotPreset, ShotSetup>> = {
  establishing: {
    distance: 13,
    focalLength: 24,
    lead: 0,
    offset: [0, 0, 0],
    pitch: 0.34,
    target: "scene",
    to: { distance: 10, pitch: 0.24, yawOffset: 0.7 },
    yawOffset: 0.7,
  },
  tracking: {
    distance: 4.5,
    focalLength: 35,
    lead: 0.7,
    offset: [0, 0, 0],
    pitch: 0.05,
    target: "subject",
    yawOffset: Math.PI / 2,
  },
  follow: {
    distance: 3.8,
    focalLength: 35,
    lead: 0.5,
    offset: [0, 0.1, 0],
    pitch: 0.2,
    target: "subject",
    to: { distance: 3.2, pitch: 0.16, yawOffset: Math.PI },
    yawOffset: Math.PI,
  },
  "close-up": {
    distance: 2.6,
    focalLength: 85,
    lead: 0.1,
    offset: [0, 0.45, 0],
    pitch: 0.0,
    target: "subject",
    to: { distance: 2.2, pitch: 0.0, yawOffset: 0.55 },
    yawOffset: 0.55,
  },
  "low-angle": {
    distance: 3,
    focalLength: 28,
    lead: 0.3,
    offset: [0, -0.45, 0],
    pitch: -0.1,
    target: "subject",
    to: { distance: 3, pitch: -0.04, yawOffset: 0.9 },
    yawOffset: 0.9,
  },
  crane: {
    distance: 9,
    focalLength: 32,
    lead: 0.4,
    offset: [0, 0, 0],
    pitch: 0.8,
    target: "subject",
    to: { distance: 4.2, pitch: 0.12, yawOffset: Math.PI * 0.75 },
    yawOffset: Math.PI * 0.75,
  },
  reveal: {
    distance: 5,
    focalLength: 40,
    lead: 0.4,
    offset: [0, 0, 0],
    pitch: 0.1,
    target: "subject",
    to: { distance: 5, pitch: 0.1, yawOffset: Math.PI / 2 },
    yawOffset: Math.PI,
  },
  hero: {
    distance: 6.5,
    focalLength: 50,
    lead: 0.4,
    offset: [0, 0.2, 0],
    pitch: 0.08,
    target: "subject",
    to: { distance: 2.6, pitch: 0.03, yawOffset: 0 },
    yawOffset: 0,
  },
};

type Planar = readonly [number, number];

/** What a shot needs of its subject: its name and its timed route. */
export interface RouteSubject {
  readonly rootTrack: {
    readonly items: ReadonlyArray<{
      readonly at: { readonly tick: number };
      readonly data: { readonly position: Planar };
    }>;
  };
  readonly subject: string;
}

/** The route position at a frame: held before the first vertex, linear between vertices. */
const routePositionAt = (actor: RouteSubject, frame: number): Planar => {
  const items = actor.rootTrack.items.toSorted((left, right) => left.at.tick - right.at.tick);
  const before = items.findLast((item) => item.at.tick <= frame);
  const after = items.find((item) => item.at.tick >= frame);
  if (before === undefined) return after?.data.position ?? [0, 0];
  if (after === undefined || after.at.tick === before.at.tick) return before.data.position;
  const share = (frame - before.at.tick) / (after.at.tick - before.at.tick);
  return [
    before.data.position[0] + (after.data.position[0] - before.data.position[0]) * share,
    before.data.position[1] + (after.data.position[1] - before.data.position[1]) * share,
  ];
};

const STILL_METRES = 0.05;

/**
 * The yaw at which a camera sits ahead of the subject: the azimuth of its travel over the shot.
 * A subject that stands still keeps the direction it arrived from; one that never moved faces
 * down the route.
 */
const travelYaw = (
  actor: RouteSubject,
  range: { readonly end: number; readonly start: number },
) => {
  const legs: ReadonlyArray<readonly [Planar, Planar]> = [
    [routePositionAt(actor, range.start), routePositionAt(actor, range.end)],
    [routePositionAt(actor, 0), routePositionAt(actor, range.start)],
    [routePositionAt(actor, 0), routePositionAt(actor, Number.MAX_SAFE_INTEGER)],
  ];
  const moving = legs.find(
    ([from, to]) => Math.hypot(to[0] - from[0], to[1] - from[1]) >= STILL_METRES,
  );
  return moving === undefined
    ? Math.PI
    : Math.atan2(moving[1][0] - moving[0][0], moving[1][1] - moving[0][1]);
};

/** Lower a preset shot to the orbit camera the composition stores. */
export const presetCameraShot = (input: {
  readonly label?: string;
  readonly preset: CameraShotPreset;
  readonly projection: { readonly far: number; readonly near: number };
  readonly range: { readonly end: number; readonly start: number };
  readonly scene: { readonly actors: ReadonlyArray<{ readonly subject: string }> };
  readonly subject: RouteSubject;
}) => {
  const setup = SHOTS[input.preset];
  const heading = travelYaw(input.subject, input.range);
  return {
    distance: setup.distance,
    kind: "camera" as const,
    label: input.label ?? `${input.preset} · ${input.subject.subject}`,
    mode: "orbit" as const,
    pitch: setup.pitch,
    projection: {
      far: input.projection.far,
      fieldOfViewY: fieldOfViewOfFocalLength(setup.focalLength),
      kind: "perspective" as const,
      near: input.projection.near,
    },
    target: {
      entities:
        setup.target === "scene"
          ? input.scene.actors.map(({ subject }) => subject)
          : [input.subject.subject],
      kind: "entities" as const,
      offset: [
        setup.offset[0] + setup.lead * Math.sin(heading),
        setup.offset[1],
        setup.offset[2] + setup.lead * Math.cos(heading),
      ],
    },
    ...(setup.to === undefined
      ? {}
      : {
          to: {
            distance: setup.to.distance,
            pitch: setup.to.pitch,
            yaw: heading + setup.to.yawOffset,
          },
        }),
    yaw: heading + setup.yawOffset,
  };
};
