import type { AuthoredActor, AuthoredPromptSpan, AuthoredRootConstraint } from "../schema";
import { MOTION_FRAMES_PER_SECOND } from "../motion";
import { MOTION_PROMPT_LIBRARY } from "../provider/prompt/embedding";

export const SCENE_SPAN_FRAMES = 680;
export const WAYPOINT_INTERVAL_FRAMES = 20;

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
  { frames: 140, prompt: "A person is running." },
  { frames: 140, prompt: "A person is standing still." },
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
  return Array.from(
    { length: Math.ceil((SCENE_SPAN_FRAMES - 1) / WAYPOINT_INTERVAL_FRAMES) },
    (_unused, waypoint) => {
      const tick = Math.min((waypoint + 1) * WAYPOINT_INTERVAL_FRAMES, SCENE_SPAN_FRAMES - 1);
      const x = authoredXAt({ frame: tick, row });
      const z = Math.fround(authoredZAt(spans, tick));
      const headingFrom = tick === SCENE_SPAN_FRAMES - 1 ? tick - 1 : tick;
      const headingTo = tick === SCENE_SPAN_FRAMES - 1 ? tick : tick + 1;
      return {
        constraint: {
          headingRadians: Math.atan2(
            authoredXAt({ frame: headingTo, row }) - authoredXAt({ frame: headingFrom, row }),
            Math.fround(authoredZAt(spans, headingTo)) -
              Math.fround(authoredZAt(spans, headingFrom)),
          ),
          position: [x, z] as const,
        },
        tick,
      };
    },
  );
};

export const authoredActor = (subject: string, row: number): AuthoredActor => ({
  prompts: authoredPromptSpans(),
  roots: authoredRootConstraints(row),
  subject,
});
