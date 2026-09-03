import { MOTION_PROMPT_LIBRARY, type TextEmbedding } from "webgpu-engine/motion";

/** One prompt an actor can be conditioned on: its feature row identity and its route pace. */
export interface MotionPrompt {
  /** The exact feature row; absent until the pinned artifact loads. */
  readonly embedding?: TextEmbedding;
  /** The row digest, which is the conditioning identity the request carries. */
  readonly identity: string;
  /** The timetable the route claims under this prompt, in metres per second. */
  readonly pace: number;
  readonly prompt: string;
}

export const DEFAULT_PACE_METRES_PER_SECOND = 1.3;

// Each pace is the timetable the route claims for its prompt. The prompt picks the gait family and
// the pace sets its intensity: the body follows the root motion it is conditioned on. The
// reference's capture under the running prompt runs at 2.3 to 3.1 m/s, a jog; a demand the text
// branch cannot produce is filled by text-free motion and reads as a hunched sprint.
const PINNED_PROMPT_PACES: Readonly<Record<string, number>> = {
  "A person is kicking with their right leg.": 0,
  "A person is running.": 3.4,
  "A person is standing still.": 0,
  "A person is walking.": 1.3,
  "A person reaches forward with their right hand to press a button.": 0,
  "Duck under obstacle and rise.": 0.9,
  "Step onto raised platform and balance.": 0.4,
};

const entries = new Map<string, MotionPrompt>(
  MOTION_PROMPT_LIBRARY.map(({ prompt, sha256 }) => [
    prompt,
    { identity: sha256, pace: PINNED_PROMPT_PACES[prompt] ?? DEFAULT_PACE_METRES_PER_SECOND, prompt },
  ]),
);

/**
 * The prompt library: the pinned prompts, whose rows attach when their artifacts load, plus any
 * row admitted live from the exact encoder. The composition, the route timetable, the tools, and
 * the provider's request admission all read it, so an admitted row conditions the next request
 * without a reopen.
 */
export const promptLibrary = {
  admit: (input: { readonly embedding: TextEmbedding; readonly pace?: number }): void => {
    const known = entries.get(input.embedding.prompt);
    entries.set(input.embedding.prompt, {
      embedding: input.embedding,
      identity: input.embedding.identity.sha256,
      pace: input.pace ?? known?.pace ?? DEFAULT_PACE_METRES_PER_SECOND,
      prompt: input.embedding.prompt,
    });
  },
  embeddings: (): ReadonlyArray<TextEmbedding> =>
    Array.from(entries.values()).flatMap(({ embedding }) =>
      embedding === undefined ? [] : [embedding],
    ),
  find: (prompt: string): MotionPrompt | undefined => entries.get(prompt),
  list: (): ReadonlyArray<MotionPrompt> => Array.from(entries.values()),
};
