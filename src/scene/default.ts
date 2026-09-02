import type { AuthoredActor, AuthoredPromptSpan, AuthoredRootConstraint } from "../schema";
import { MOTION_FRAMES_PER_SECOND } from "../motion";
import { MOTION_PROMPT_LIBRARY } from "../provider/embedding";

export const SCENE_SPAN_FRAMES = 680;
// Route vertices every three seconds. The provider interpolates the route between them and claims
// its own goals relative to each generated window, so this spacing only shapes the path geometry.
export const WAYPOINT_INTERVAL_FRAMES = 3 * MOTION_FRAMES_PER_SECOND;

const DEFAULT_PACE_METRES_PER_SECOND = 1.3;
const PROMPT_PACE_METRES_PER_SECOND: Readonly<Record<string, number>> = {
  "A person is kicking with their right leg.": 0,
  "A person is running.": 4.2,
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

const paceAtFrame = (spans: readonly AuthoredPromptSpan[], frame: number): number => {
  const span = spans.findLast(({ start }) => start <= frame) ?? spans[0];
  return span === undefined
    ? DEFAULT_PACE_METRES_PER_SECOND
    : (PROMPT_PACE_METRES_PER_SECOND[span.prompt] ?? DEFAULT_PACE_METRES_PER_SECOND);
};

const authoredZAt = (spans: readonly AuthoredPromptSpan[], frame: number): number => {
  let travelled = 0;
  for (let step = 0; step < frame; step += 1) {
    travelled += paceAtFrame(spans, step) / MOTION_FRAMES_PER_SECOND;
  }
  return -travelled;
};

const authoredXAt = (input: { readonly frame: number; readonly row: number }): number =>
  Math.fround(input.row * 4 * Math.sin((input.frame / (SCENE_SPAN_FRAMES - 1)) * Math.PI));

export const authoredRootConstraints = (row: number): readonly AuthoredRootConstraint[] => {
  const spans = authoredPromptSpans();
  const ticks = Array.from(
    { length: Math.ceil((SCENE_SPAN_FRAMES - 1) / WAYPOINT_INTERVAL_FRAMES) },
    (_unused, waypoint) =>
      Math.min((waypoint + 1) * WAYPOINT_INTERVAL_FRAMES, SCENE_SPAN_FRAMES - 1),
  );
  return ticks.map((tick) => ({
    constraint: {
      position: [authoredXAt({ frame: tick, row }), Math.fround(authoredZAt(spans, tick))],
    },
    tick,
  }));
};

export const authoredActor = (subject: string, row: number): AuthoredActor => ({
  prompts: authoredPromptSpans(),
  roots: authoredRootConstraints(row),
  subject,
});
