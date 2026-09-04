import type {
  AuthoredActor,
  AuthoredPromptSpan,
  AuthoredRootConstraint,
  AuthoredStory,
  AuthoredWall,
  BodyItemData,
} from "../schema";
import {
  digestHex,
  MOTION_FRAMES_PER_SECOND,
  PUBLISHED_FRAMES_PER_WINDOW,
} from "webgpu-engine/motion";
import { DEFAULT_PACE_METRES_PER_SECOND, promptLibrary } from "./prompts";

export const SCENE_SPAN_FRAMES = 680;
export const EMPTY_SCENE_FRAMES = 320;

// Route vertices every second. Each vertex inside a window's generation horizon is a timed planar
// root claim; the first vertex beyond it is the future token the model plans toward. One second
// keeps the timetable tight enough that the actor neither sprints toward a distant goal nor
// coasts once ahead of it.
export const WAYPOINT_INTERVAL_FRAMES = MOTION_FRAMES_PER_SECOND;

/**
 * The built-in stories, in the same shape an agent authors with `author_scene`: each actor is an
 * origin, a path in its own frame, and a scenario of beats; the coverage is the shots a director
 * calls, each a preset on one actor by row. Every beat is a caption in the training set's
 * register and every span begins on a window boundary.
 */
export const AUTHORED_STORIES: Readonly<Record<string, AuthoredStory>> = {
  empty: {
    actors: [],
    coverage: [],
    frameCount: EMPTY_SCENE_FRAMES,
    title: "Untitled Scene",
  },
  "the-victor": {
    actors: [
      {
        origin: [-1, 0, 0],
        path: [
          [0, 0],
          [0, -34],
        ],
        scenario: [
          { frames: 120, prompt: "A person is walking." },
          { frames: 80, prompt: "A person is standing still." },
          { frames: 120, prompt: "A person is sprinting." },
          { frames: 80, prompt: "A person throws a punch with their right hand." },
          { frames: 80, prompt: "A person raises both arms in victory." },
          { frames: 80, prompt: "A person pumps their fist in the air." },
          { frames: 120, prompt: "A person turns around and walks away." },
        ],
      },
      {
        origin: [1, 0, -30],
        path: [
          [0, 0],
          [0, 30],
        ],
        scenario: [
          { frames: 160, prompt: "A person is walking." },
          { frames: 80, prompt: "A person is standing still." },
          { frames: 80, prompt: "A person is sprinting." },
          { frames: 80, prompt: "A person stumbles forward and regains their balance." },
          { frames: 80, prompt: "A person collapses to the ground." },
          { frames: 80, prompt: "A person kneels down on one knee." },
          { frames: 120, prompt: "A person is standing still." },
        ],
      },
    ],
    coverage: [
      { end: 160, preset: "establishing", row: 0, start: 0 },
      { end: 240, preset: "reveal", row: 0, start: 160 },
      { end: 320, preset: "hero", row: 0, start: 240 },
      { end: 400, preset: "low-angle", row: 0, start: 320 },
      { end: 480, preset: "crane", row: 1, start: 400 },
      { end: 560, preset: "close-up", row: 0, start: 480 },
      { end: 680, preset: "follow", row: 0, start: 560 },
    ],
    frameCount: 680,
    title: "The Victor",
  },
  // The route covers thirty metres in 320 frames, so the actor reaches the wall at twelve metres
  // around frame 128, inside the tracking shot. Its collider is kinematic and therefore unstoppable:
  // it does not slow at the wall, it goes through and the bricks scatter.
  "the-wall": {
    actors: [
      {
        origin: [0, 0, 0],
        path: [
          [0, 0],
          [0, -30],
        ],
        scenario: [
          { frames: 80, prompt: "A person is walking." },
          { frames: 240, prompt: "A person is sprinting." },
        ],
      },
    ],
    coverage: [
      { end: 80, preset: "establishing", row: 0, start: 0 },
      { end: 160, preset: "tracking", row: 0, start: 80 },
      { end: 240, preset: "low-angle", row: 0, start: 160 },
      { end: 320, preset: "follow", row: 0, start: 240 },
    ],
    frameCount: 320,
    title: "The Wall",
    walls: [{ bricksPerCourse: 8, courses: 6, offset: [0, 0, -12], row: 0, tick: 0 }],
  },
  "the-reunion": {
    actors: [
      {
        origin: [-0.8, 0, 0],
        path: [
          [0, 0],
          [0, -9],
        ],
        scenario: [
          { frames: 160, prompt: "A person is walking." },
          { frames: 80, prompt: "A person waves with their right hand." },
          { frames: 80, prompt: "A person is standing still." },
          { frames: 80, prompt: "A person claps their hands." },
          { frames: 80, prompt: "A person jumps in place." },
          { frames: 80, prompt: "A person bows forward at the waist and stands back up." },
          { frames: 120, prompt: "A person is standing still." },
        ],
      },
      {
        origin: [0.8, 0, -20],
        path: [
          [0, 0],
          [0, 9],
        ],
        scenario: [
          { frames: 120, prompt: "A person is walking." },
          { frames: 40, prompt: "A person is standing still." },
          { frames: 80, prompt: "A person waves with their right hand." },
          { frames: 80, prompt: "A person jumps in place." },
          { frames: 80, prompt: "A person claps their hands." },
          { frames: 160, prompt: "A person dances." },
          { frames: 120, prompt: "A person salutes with their right hand." },
        ],
      },
    ],
    coverage: [
      { end: 160, preset: "establishing", row: 0, start: 0 },
      { end: 240, preset: "tracking", row: 0, start: 160 },
      { end: 320, preset: "close-up", row: 1, start: 240 },
      { end: 400, preset: "reveal", row: 0, start: 320 },
      { end: 480, preset: "crane", row: 1, start: 400 },
      { end: 560, preset: "close-up", row: 0, start: 480 },
      { end: 680, preset: "establishing", row: 0, start: 560 },
    ],
    frameCount: 680,
    title: "The Reunion",
  },
  "dance-off": {
    actors: [
      {
        origin: [-1.5, 0, 0],
        path: [
          [0, 0],
          [0, -4],
        ],
        scenario: [
          { frames: 80, prompt: "A person is walking." },
          { frames: 160, prompt: "A person dances." },
          { frames: 80, prompt: "A person spins around once." },
          { frames: 80, prompt: "A person does a cartwheel." },
          { frames: 160, prompt: "A person dances." },
          { frames: 120, prompt: "A person raises both arms in victory." },
        ],
      },
      {
        origin: [1.5, 0, 0],
        path: [
          [0, 0],
          [0, -4],
        ],
        scenario: [
          { frames: 80, prompt: "A person is standing still." },
          { frames: 160, prompt: "A person dances." },
          { frames: 80, prompt: "A person jumps in place." },
          { frames: 80, prompt: "A person flexes both arms." },
          { frames: 160, prompt: "A person dances." },
          { frames: 120, prompt: "A person bows forward at the waist and stands back up." },
        ],
      },
    ],
    coverage: [
      { end: 80, preset: "establishing", row: 0, start: 0 },
      { end: 240, preset: "tracking", row: 0, start: 80 },
      { end: 320, preset: "low-angle", row: 0, start: 240 },
      { end: 400, preset: "hero", row: 0, start: 320 },
      { end: 480, preset: "crane", row: 1, start: 400 },
      { end: 560, preset: "close-up", row: 1, start: 480 },
      { end: 680, preset: "reveal", row: 0, start: 560 },
    ],
    frameCount: 680,
    title: "Dance-Off",
  },
};

/** A first visit opens on a scene that plays; the empty story is what `create_scene` starts from. */
export const DEFAULT_STORY = "the-victor";

/** The built-in stories an agent or the page can start: id and title. */
export const storyChoices = (): ReadonlyArray<{ readonly id: string; readonly title: string }> =>
  Object.entries(AUTHORED_STORIES).map(([id, { title }]) => ({ id, title }));

const storyActor = (story: AuthoredStory, row: number) =>
  story.actors[row % story.actors.length]!;

/** Where the actor of a row stands in the world. */
export const authoredOrigin = (
  story: AuthoredStory,
  row: number,
): readonly [number, number, number] => storyActor(story, row).origin;

export const authoredPromptSpans = (
  story: AuthoredStory,
  row: number,
): readonly AuthoredPromptSpan[] => {
  return storyActor(story, row).scenario.reduce<readonly AuthoredPromptSpan[]>((spans, beat) => {
    if (promptLibrary.find(beat.prompt) === undefined) {
      throw new Error(`scenario prompt outside the prompt library: ${beat.prompt}`);
    }
    const start = spans.reduce((total, span) => total + span.durationFrames, 0);
    // One text feature conditions one generated window, so a prompt changes only on a boundary.
    if (start % PUBLISHED_FRAMES_PER_WINDOW !== 0) {
      throw new Error(
        `scenario span "${beat.prompt}" starts at frame ${String(start)}, not on a ${String(PUBLISHED_FRAMES_PER_WINDOW)}-frame window boundary`,
      );
    }
    return [...spans, { durationFrames: beat.frames, prompt: beat.prompt, start }];
  }, []);
};

// A body changes speed over a couple of seconds, so the timetable ramps between prompts instead
// of stepping. It speeds up after a faster prompt begins and slows down before a slower one
// begins: the first window under a slower prompt then claims that prompt's own pace from its
// first frame, so the text and the route ask for the same body instead of the route holding the
// old gait while the text asks for the new one.
const PACE_TRANSITION_FRAMES = 2 * MOTION_FRAMES_PER_SECOND;

const spanPace = (span: AuthoredPromptSpan | undefined): number =>
  span === undefined
    ? DEFAULT_PACE_METRES_PER_SECOND
    : (promptLibrary.find(span.prompt)?.pace ?? DEFAULT_PACE_METRES_PER_SECOND);

const paceAtFrame = (spans: readonly AuthoredPromptSpan[], frame: number): number => {
  const index = spans.findLastIndex(({ start }) => start <= frame);
  const span = spans[index] ?? spans[0];
  if (span === undefined) return DEFAULT_PACE_METRES_PER_SECOND;
  const current = spanPace(span);
  // The scene starts from rest, so the first span ramps up from zero like every later change.
  const previous = index > 0 ? spanPace(spans[index - 1]) : 0;
  const next = spans[index + 1];
  const blend = (from: number, to: number, progress: number) =>
    from + (to - from) * Math.min(1, Math.max(0, progress));
  if (current > previous) {
    return blend(previous, current, (frame - span.start) / PACE_TRANSITION_FRAMES);
  }
  if (next !== undefined && spanPace(next) < current) {
    return blend(spanPace(next), current, (next.start - frame) / PACE_TRANSITION_FRAMES);
  }
  return current;
};

/** Distance travelled along the route by a frame: the timetable's pace integrated frame by frame. */
const distanceAt = (spans: readonly AuthoredPromptSpan[], frame: number): number =>
  Array.from({ length: frame }, (_unused, step) => paceAtFrame(spans, step)).reduce(
    (travelled, pace) => travelled + pace / MOTION_FRAMES_PER_SECOND,
    0,
  );

/** The point a given distance along a path; past the end, the path's last point. */
const pointAlongPath = (
  path: ReadonlyArray<readonly [number, number]>,
  distance: number,
): readonly [number, number] => {
  const walked = path.slice(1).reduce<{
    readonly point: readonly [number, number];
    readonly remaining: number;
  }>(
    ({ point, remaining }, next) => {
      const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
      if (remaining <= 0 || length === 0) return { point, remaining };
      const share = Math.min(1, remaining / length);
      return {
        point: [point[0] + (next[0] - point[0]) * share, point[1] + (next[1] - point[1]) * share],
        remaining: remaining - length,
      };
    },
    { point: path[0]!, remaining: distance },
  );
  return walked.point;
};

/**
 * The route an actor's path and prompt spans lower to: a timed planar vertex every second, each
 * the point along the path at the distance the spans' paces have covered by then. Vertices sit
 * half an interval off the window grid (frames 10, 30, 50, ...). A vertex on a window's first
 * generated frame would snap that frame onto the timetable regardless of where the history
 * ended; half an interval in, the model has frames to reach it.
 */
export const routeConstraints = (input: {
  readonly frameCount: number;
  readonly path: ReadonlyArray<readonly [number, number]>;
  readonly spans: readonly AuthoredPromptSpan[];
}): readonly AuthoredRootConstraint[] => {
  const ticks = Array.from(
    { length: Math.ceil((input.frameCount - 1) / WAYPOINT_INTERVAL_FRAMES) },
    (_unused, waypoint) =>
      Math.min((waypoint + 0.5) * WAYPOINT_INTERVAL_FRAMES, input.frameCount - 1),
  );
  return ticks.map((tick) => {
    const [x, z] = pointAlongPath(input.path, distanceAt(input.spans, tick));
    return { constraint: { position: [Math.fround(x), Math.fround(z)] }, tick };
  });
};

export const authoredRootConstraints = (
  story: AuthoredStory,
  row: number,
): readonly AuthoredRootConstraint[] =>
  routeConstraints({
    frameCount: story.frameCount,
    path: storyActor(story, row).path,
    spans: authoredPromptSpans(story, row),
  });

// The physics playground's proven construction: a brick is half a metre long and a quarter high,
// and odd courses are closed with half bricks so no vertical joint runs the wall's height and no
// end brick stands half-unsupported. Without the closers the wall topples on its own.
const BRICK = [0.25, 0.125, 0.125] as const;
const HALF_BRICK = [0.125, 0.125, 0.125] as const;
const BRICK_MASS = 1;

const layWall = (input: {
  readonly at: number;
  readonly subject: string;
  readonly wall: AuthoredWall;
}): ReadonlyArray<{ readonly data: BodyItemData; readonly tick: number }> => {
  const { at, subject, wall } = input;
  const left = -wall.bricksPerCourse * BRICK[0];
  const right = wall.bricksPerCourse * BRICK[0];
  return Array.from({ length: wall.courses }, (_unusedCourse, course) => {
    const elevation = BRICK[1] + course * 2 * BRICK[1];
    const laid =
      course % 2 === 0
        ? Array.from({ length: wall.bricksPerCourse }, (_unusedBrick, column) => ({
            halfExtents: BRICK,
            x: left + BRICK[0] + column * 2 * BRICK[0],
          }))
        : [
            { halfExtents: HALF_BRICK, x: left + HALF_BRICK[0] },
            ...Array.from({ length: wall.bricksPerCourse - 1 }, (_unusedBrick, column) => ({
              halfExtents: BRICK,
              x: left + 2 * HALF_BRICK[0] + BRICK[0] + column * 2 * BRICK[0],
            })),
            { halfExtents: HALF_BRICK, x: right - HALF_BRICK[0] },
          ];
    return laid.map(({ halfExtents, x }, column) => ({
      data: {
        halfExtents,
        label: `wall${String(at)}-course${String(course)}-brick${String(column)}`,
        mass: BRICK_MASS,
        offset: [wall.offset[0] + x, wall.offset[1] + elevation, wall.offset[2]] as const,
        subject,
      },
      tick: wall.tick,
    }));
  }).flat();
};

/** The story's walls, laid brick by brick; an agent places any other prop with the body tools. */
export const authoredBodies = (
  story: AuthoredStory,
  subjects: ReadonlyArray<{ readonly id: string; readonly row: number }>,
): ReadonlyArray<{ readonly data: BodyItemData; readonly tick: number }> =>
  (story.walls ?? []).flatMap((wall, at) => {
    const subject = subjects.find(({ row }) => row === wall.row);
    return subject === undefined ? [] : layWall({ at, subject: subject.id, wall });
  });

export const authoredActor = (
  story: AuthoredStory,
  subject: string,
  row: number,
): AuthoredActor => ({
  prompts: authoredPromptSpans(story, row),
  roots: authoredRootConstraints(story, row),
  subject,
});

/**
 * The identity of a story: a digest of its actors, coverage, and span. A scene records the story
 * it was seeded from, so a built-in story that changed opens a fresh scene.
 */
export const authoredStoryIdentity = (story: AuthoredStory): Promise<string> =>
  digestHex(new TextEncoder().encode(JSON.stringify(story)).buffer as ArrayBuffer);
