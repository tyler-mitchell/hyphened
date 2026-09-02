import type { AuthoredActor, AuthoredPromptSpan, AuthoredRootConstraint } from "../schema";
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

const AUTHORED_SCENARIO: ReadonlyArray<{ readonly frames: number; readonly prompt: string }> = [
  { frames: 120, prompt: "A person is walking." },
  { frames: 200, prompt: "A person is running." },
  { frames: 80, prompt: "Duck under obstacle and rise." },
  { frames: 120, prompt: "A person is running." },
  { frames: 160, prompt: "A person is standing still." },
];

export const authoredPromptSpans = (): readonly AuthoredPromptSpan[] => {
  const available = new Set(MOTION_PROMPT_LIBRARY.map(({ prompt }) => prompt));
  return AUTHORED_SCENARIO.reduce<readonly AuthoredPromptSpan[]>((spans, scene) => {
    if (!available.has(scene.prompt)) throw new Error(`unpinned scenario prompt: ${scene.prompt}`);
    const start = spans.reduce((total, span) => total + span.durationFrames, 0);
    return [...spans, { durationFrames: scene.frames, prompt: scene.prompt, start }];
  }, []);
};

// A body changes speed over a couple of seconds, so the timetable ramps between prompts instead
// of stepping; a step demands the new pace one frame after the old one.
const PACE_TRANSITION_FRAMES = 2 * MOTION_FRAMES_PER_SECOND;

const spanPace = (span: AuthoredPromptSpan | undefined): number =>
  span === undefined
    ? DEFAULT_PACE_METRES_PER_SECOND
    : (PROMPT_PACE_METRES_PER_SECOND[span.prompt] ?? DEFAULT_PACE_METRES_PER_SECOND);

const paceAtFrame = (spans: readonly AuthoredPromptSpan[], frame: number): number => {
  const index = spans.findLastIndex(({ start }) => start <= frame);
  const span = spans[index] ?? spans[0];
  // The scene starts from rest, so the first span ramps up from zero like every later change.
  const previous = index > 0 ? spanPace(spans[index - 1]) : 0;
  const progress = span === undefined ? 1 : (frame - span.start) / PACE_TRANSITION_FRAMES;
  return previous + (spanPace(span) - previous) * Math.min(1, Math.max(0, progress));
};

const authoredZAt = (spans: readonly AuthoredPromptSpan[], frame: number): number => {
  let travelled = 0;
  for (let step = 0; step < frame; step += 1) {
    travelled += paceAtFrame(spans, step) / MOTION_FRAMES_PER_SECOND;
  }
  return -travelled;
};

// The sway follows the path, not the clock: a standing or ducking actor is not asked to shuffle
// sideways, which the model answers by kneeling.
const authoredXAt = (input: { readonly progress: number; readonly row: number }): number =>
  Math.fround(input.row * 4 * Math.sin(input.progress * Math.PI));

export const authoredRootConstraints = (row: number): readonly AuthoredRootConstraint[] => {
  const spans = authoredPromptSpans();
  // Vertices sit half an interval off the window grid (frames 10, 30, 50, ...). A vertex on a
  // window's first generated frame would snap that frame onto the timetable regardless of where
  // the history ended; half an interval in, the model has frames to reach it.
  const ticks = Array.from(
    { length: Math.ceil((SCENE_SPAN_FRAMES - 1) / WAYPOINT_INTERVAL_FRAMES) },
    (_unused, waypoint) =>
      Math.min((waypoint + 0.5) * WAYPOINT_INTERVAL_FRAMES, SCENE_SPAN_FRAMES - 1),
  );
  const pathLength = -authoredZAt(spans, SCENE_SPAN_FRAMES - 1);
  return ticks.map((tick) => {
    const z = authoredZAt(spans, tick);
    return {
      constraint: {
        position: [authoredXAt({ progress: -z / pathLength, row }), Math.fround(z)],
      },
      tick,
    };
  });
};

export const authoredActor = (subject: string, row: number): AuthoredActor => ({
  prompts: authoredPromptSpans(),
  roots: authoredRootConstraints(row),
  subject,
});
