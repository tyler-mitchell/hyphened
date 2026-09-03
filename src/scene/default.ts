import type {
  AuthoredActor,
  AuthoredPromptSpan,
  AuthoredRootConstraint,
  BodyItemData,
} from "../schema";
import { MOTION_FRAMES_PER_SECOND } from "../motion";
import { MOTION_PROMPT_LIBRARY } from "../provider/embedding";

export const SCENE_SPAN_FRAMES = 680;
// Route vertices every second. Each vertex inside a window's generation horizon is a timed planar
// root claim; the first vertex beyond it is the future token the model plans toward. One second
// keeps the timetable tight enough that the actor neither sprints toward a distant goal nor
// coasts once ahead of it.
export const WAYPOINT_INTERVAL_FRAMES = MOTION_FRAMES_PER_SECOND;

const DEFAULT_PACE_METRES_PER_SECOND = 1.3;
// Each pace is the timetable the route claims for its prompt. The prompt picks the gait family and
// the pace sets its intensity: the body follows the root motion it is conditioned on. The
// reference's capture under the running prompt runs at 2.3 to 3.1 m/s, a jog; a demand the text
// branch cannot produce is filled by text-free motion and reads as a hunched sprint. With two
// seconds of history and one future claim per window, 3.4 is the next intensity to judge.
const PROMPT_PACE_METRES_PER_SECOND: Readonly<Record<string, number>> = {
  "A person is kicking with their right leg.": 0,
  "A person is running.": 3.4,
  "A person is standing still.": 0,
  "A person is walking.": 1.3,
  "A person reaches forward with their right hand to press a button.": 0,
  "Duck under obstacle and rise.": 0.9,
  "Step onto raised platform and balance.": 0.4,
};

interface AuthoredScene {
  /** The planar points the actor passes through, in its own frame and in order. */
  readonly path: ReadonlyArray<readonly [number, number]>;
  readonly scenario: ReadonlyArray<{ readonly frames: number; readonly prompt: string }>;
}

/**
 * Each actor is a path and a scenario. The timetable along the path comes from the prompts'
 * paces, so the path decides where the body goes and turns and the prompts decide how fast it
 * gets there and what it does on the way. The first actor walks, runs straight, ducks, runs on
 * and stands. The second walks longer, jogs five metres to the side during its run, is straight
 * again before its bar, walks the next stretch, and ends with a kick in place.
 */
const AUTHORED_ACTORS: ReadonlyArray<AuthoredScene> = [
  {
    path: [
      [0, 0],
      [0, -70],
    ],
    scenario: [
      { frames: 120, prompt: "A person is walking." },
      { frames: 200, prompt: "A person is running." },
      { frames: 80, prompt: "Duck under obstacle and rise." },
      { frames: 120, prompt: "A person is running." },
      { frames: 160, prompt: "A person is standing still." },
    ],
  },
  {
    path: [
      [0, 0],
      [0, -14],
      [5, -24],
      [5, -70],
    ],
    scenario: [
      { frames: 160, prompt: "A person is walking." },
      { frames: 200, prompt: "A person is running." },
      { frames: 80, prompt: "Duck under obstacle and rise." },
      { frames: 120, prompt: "A person is walking." },
      { frames: 120, prompt: "A person is kicking with their right leg." },
    ],
  },
];

const authoredScene = (row: number): AuthoredScene => AUTHORED_ACTORS[row % AUTHORED_ACTORS.length]!;

export const authoredPromptSpans = (row: number): readonly AuthoredPromptSpan[] => {
  const available = new Set(MOTION_PROMPT_LIBRARY.map(({ prompt }) => prompt));
  return authoredScene(row).scenario.reduce<readonly AuthoredPromptSpan[]>((spans, scene) => {
    if (!available.has(scene.prompt)) throw new Error(`unpinned scenario prompt: ${scene.prompt}`);
    const start = spans.reduce((total, span) => total + span.durationFrames, 0);
    return [...spans, { durationFrames: scene.frames, prompt: scene.prompt, start }];
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
    : (PROMPT_PACE_METRES_PER_SECOND[span.prompt] ?? DEFAULT_PACE_METRES_PER_SECOND);

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

export const authoredRootConstraints = (row: number): readonly AuthoredRootConstraint[] =>
  routeConstraints({
    frameCount: SCENE_SPAN_FRAMES,
    path: authoredScene(row).path,
    spans: authoredPromptSpans(row),
  });

/**
 * The bodies each actor's story asks for, each standing where the actor's route is at a frame
 * into one of its prompt spans: a loose crate a second and a half into the first run, so a
 * running actor meets it, and a fixed bar two and a half seconds into the duck span, past the
 * first full window under that prompt and low enough that a standing actor must duck.
 */
const AUTHORED_BODIES: ReadonlyArray<{
  readonly body: Omit<BodyItemData, "subject">;
  readonly framesIn: number;
  readonly prompt: string;
}> = [
  {
    body: { elevation: 0.3, halfExtents: [0.3, 0.3, 0.3], label: "crate", mass: 4 },
    framesIn: 30,
    prompt: "A person is running.",
  },
  {
    body: { elevation: 1.31, halfExtents: [1.2, 0.06, 0.06], label: "bar", mass: 0 },
    framesIn: 50,
    prompt: "Duck under obstacle and rise.",
  },
];

export const authoredBodies = (
  subject: string,
  row: number,
): ReadonlyArray<{ readonly data: BodyItemData; readonly tick: number }> => {
  const spans = authoredPromptSpans(row);
  return AUTHORED_BODIES.flatMap(({ body, framesIn, prompt }) => {
    const span = spans.find((candidate) => candidate.prompt === prompt);
    return span === undefined
      ? []
      : [{ data: { ...body, subject }, tick: span.start + framesIn }];
  });
};

export const authoredActor = (subject: string, row: number): AuthoredActor => ({
  prompts: authoredPromptSpans(row),
  roots: authoredRootConstraints(row),
  subject,
});
