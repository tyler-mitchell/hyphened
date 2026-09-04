import { type } from "arktype";
import {
  loadTextEmbedding,
  MOTION_PROMPT_LIBRARY,
  motionTextEmbeddingSource,
  type MotionTextEmbeddingArtifactSource,
  type TextEmbedding,
} from "webgpu-engine/motion";

/** One prompt an actor can be conditioned on: its feature row identity and its route pace. */
export interface MotionPrompt {
  /** The exact feature row; absent until the pinned artifact loads. */
  readonly embedding?: TextEmbedding;
  /** The row digest, which is the conditioning identity the request carries. */
  readonly identity: string;
  /** The timetable the route claims under this prompt, in metres per second. */
  readonly pace: number;
  readonly prompt: string;
  /** Where the row is published, for a library entry whose row loads on first use. */
  readonly source?: MotionTextEmbeddingArtifactSource;
  readonly tags?: ReadonlyArray<string>;
  /** The library's descriptors of the beat, when the manifest carries them. */
  readonly category?: string;
  /** An authoring hint in frames, on a caption that completes an action. */
  readonly duration?: number;
  readonly laterality?: string;
  /** The stance the beat begins in and the one it leaves the actor in, for chaining beats. */
  readonly posture?: { readonly enter: string; readonly exit: string };
}

/**
 * The generated motion library: rows published beside the app and listed in one manifest. The
 * manifest is read at open; a row is fetched the first time a span uses its prompt, so the
 * library can grow to thousands of captions without a fetch per row at open.
 */
export const MOTION_LIBRARY_URL = "/assets/ardy/humanoid/library/";
const MotionLibraryManifest = type({
  entries: type({
    "category?": "string > 0",
    "duration?": "number.integer > 0",
    "laterality?": "string > 0",
    pace: "number >= 0",
    "posture?": { enter: "string > 0", exit: "string > 0" },
    prompt: "string > 0",
    sha256: /^[0-9a-f]{64}$/,
    slug: /^[a-z0-9][a-z0-9-]*$/,
    "tags?": "string[]",
  }).array(),
});
export type MotionLibraryManifest = typeof MotionLibraryManifest.infer;

export const DEFAULT_PACE_METRES_PER_SECOND = 1.3;

// Each pace is the timetable the route claims for its prompt. The prompt picks the gait family and
// the pace sets its intensity: the body follows the root motion it is conditioned on. The
// reference's capture under the running prompt runs at 2.3 to 3.1 m/s, a jog; a demand the text
// branch cannot produce is filled by text-free motion and reads as a hunched sprint.
/** What a pinned prompt publishes beside its row: the same facts a generated entry carries. */
type PinnedPrompt = Omit<MotionPrompt, "embedding" | "identity" | "prompt" | "source">;

const STANDING = { enter: "stand", exit: "stand" } as const;

// Each pace is the timetable the route claims for its prompt. The prompt picks the gait family and
// the pace sets its intensity: the body follows the root motion it is conditioned on. The
// reference's capture under the running prompt runs at 2.3 to 3.1 m/s, a jog; a demand the text
// branch cannot produce is filled by text-free motion and reads as a hunched sprint.
//
// Four of these leave the actor off their feet. Until they said so, an author chaining after a
// collapse, a sit, a kneel or a crouch had nothing to warn them, and the generated captions carried
// the fact while the pinned ones did not.
const PINNED_PROMPTS: Readonly<Record<string, PinnedPrompt | undefined>> = {
  "A person bows forward at the waist and stands back up.": { category: "gesture", duration: 40, laterality: "none", pace: 0, posture: STANDING, tags: ["bow"] },
  "A person claps their hands.": { category: "gesture", laterality: "both", pace: 0, posture: STANDING, tags: ["clap"] },
  "A person collapses to the ground.": { category: "fall", duration: 40, laterality: "none", pace: 0, posture: { enter: "stand", exit: "supine" }, tags: ["collapse", "fall"] },
  "A person is kicking with their right leg.": { category: "combat", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["kick"] },
  "A person is running.": { category: "locomotion", laterality: "none", pace: 3.4, posture: STANDING, tags: ["run"] },
  // The witnessed planted run: the reference sprint is 5.5 m/s, a 4.2 timetable keeps the feet down.
  "A person is sprinting.": { category: "locomotion", laterality: "none", pace: 4.2, posture: STANDING, tags: ["sprint"] },
  "A person is standing still.": { category: "idle", laterality: "none", pace: 0, posture: STANDING, tags: ["idle"] },
  "A person is walking.": { category: "locomotion", laterality: "none", pace: 1.3, posture: STANDING, tags: ["walk"] },
  "A person jumps in place.": { category: "locomotion", duration: 40, laterality: "none", pace: 0, posture: STANDING, tags: ["jump"] },
  "A person raises both arms in victory.": { category: "gesture", duration: 40, laterality: "both", pace: 0, posture: STANDING, tags: ["victory", "celebrate"] },
  "A person reaches forward with their right hand to press a button.": { category: "everyday", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["reach", "press"] },
  "A person salutes with their right hand.": { category: "gesture", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["salute"] },
  "A person sits down on the ground.": { category: "everyday", duration: 40, laterality: "none", pace: 0, posture: { enter: "stand", exit: "sit" }, tags: ["sit"] },
  "A person stumbles forward and regains their balance.": { category: "fall", duration: 40, laterality: "none", pace: 0.8, posture: STANDING, tags: ["stumble", "recover"] },
  "A person turns around and walks away.": { category: "locomotion", laterality: "none", pace: 1.0, posture: STANDING, tags: ["turn", "walk"] },
  "A person waves with their right hand.": { category: "gesture", laterality: "right", pace: 0, posture: STANDING, tags: ["wave"] },
  // Cutscene beats: each is performed in place.
  "A person pumps their fist in the air.": { category: "gesture", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["celebrate", "fist"] },
  "A person flexes both arms.": { category: "gesture", duration: 40, laterality: "both", pace: 0, posture: STANDING, tags: ["flex"] },
  "A person spins around once.": { category: "gesture", duration: 40, laterality: "none", pace: 0, posture: STANDING, tags: ["spin"] },
  "A person kneels down on one knee.": { category: "everyday", duration: 40, laterality: "none", pace: 0, posture: { enter: "stand", exit: "kneel" }, tags: ["kneel"] },
  "A person throws a punch with their right hand.": { category: "combat", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["punch"] },
  // A cartwheel covers about a body length and a half.
  "A person does a cartwheel.": { category: "sport", duration: 40, laterality: "none", pace: 1.0, posture: STANDING, tags: ["cartwheel"] },
  "A person crouches and looks around.": { category: "idle", duration: 40, laterality: "none", pace: 0, posture: { enter: "stand", exit: "crouch" }, tags: ["crouch", "look"] },
  "A person picks something up from the ground.": { category: "everyday", duration: 40, laterality: "both", pace: 0, posture: STANDING, tags: ["pick-up"] },
  "A person points forward with their right hand.": { category: "gesture", duration: 40, laterality: "right", pace: 0, posture: STANDING, tags: ["point"] },
  "A person dances.": { category: "dance", laterality: "none", pace: 0, posture: STANDING, tags: ["dance"] },
  "Duck under obstacle and rise.": { category: "locomotion", duration: 40, laterality: "none", pace: 0.9, posture: STANDING, tags: ["duck"] },
  "Step onto raised platform and balance.": { category: "locomotion", duration: 40, laterality: "none", pace: 0.4, posture: STANDING, tags: ["step-up", "balance"] },
  // Caption-style forms of the two imperatives above; the training captions describe a person.
  "A person ducks under an obstacle and stands back up.": { category: "locomotion", duration: 40, laterality: "none", pace: 0.9, posture: STANDING, tags: ["duck"] },
  "A person steps onto a raised platform and balances.": { category: "locomotion", duration: 40, laterality: "none", pace: 0.4, posture: STANDING, tags: ["step-up", "balance"] },
};

const entries = new Map<string, MotionPrompt>(
  MOTION_PROMPT_LIBRARY.map((source) => {
    const pinned = PINNED_PROMPTS[source.prompt];
    return [
      source.prompt,
      {
        ...pinned,
        identity: source.sha256,
        pace: pinned?.pace ?? DEFAULT_PACE_METRES_PER_SECOND,
        prompt: source.prompt,
        source,
      },
    ];
  }),
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
      ...known,
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
  /** Load the rows of the named prompts that are published but not yet loaded. */
  ensure: async (prompts: ReadonlyArray<string>): Promise<void> => {
    const pending = Array.from(new Set(prompts)).flatMap((prompt) => {
      const entry = entries.get(prompt);
      return entry === undefined || entry.embedding !== undefined || entry.source === undefined
        ? []
        : [entry];
    });
    const loaded = await Promise.all(
      pending.map(async (entry) => ({
        entry,
        result: await loadTextEmbedding({ source: entry.source! }),
      })),
    );
    const unavailable = loaded.find(({ result }) => result.status === "unavailable");
    if (unavailable?.result.status === "unavailable") {
      throw new Error(`"${unavailable.entry.prompt}": ${unavailable.result.reason}`);
    }
    loaded.forEach(({ entry, result }) => {
      if (result.status === "available") {
        promptLibrary.admit({ embedding: result.value, pace: entry.pace });
      }
    });
  },
  find: (prompt: string): MotionPrompt | undefined => entries.get(prompt),
  list: (): ReadonlyArray<MotionPrompt> => Array.from(entries.values()),
  /** Register the published library's manifest; a missing manifest is an empty library. */
  loadManifest: async (fetchImpl: typeof fetch = fetch): Promise<number> => {
    const response = await fetchImpl(`${MOTION_LIBRARY_URL}manifest.json`);
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`motion library manifest: HTTP ${String(response.status)}`);
    const manifest = MotionLibraryManifest.assert(await response.json());
    manifest.entries.forEach(
      ({ category, duration, laterality, pace, posture, prompt, sha256, slug, tags }) => {
        const known = entries.get(prompt);
        // A pinned row wins: its pace and posture are hand-tuned against the reference capture.
        if (known?.embedding !== undefined || known?.source !== undefined) return;
        entries.set(prompt, {
          identity: sha256,
          pace,
          prompt,
          source: {
            byteLength: motionTextEmbeddingSource.featureWidth * Float32Array.BYTES_PER_ELEMENT,
            encoder: motionTextEmbeddingSource,
            prompt,
            sha256,
            url: `${MOTION_LIBRARY_URL}${slug}.f32?sha256=${sha256}`,
          },
          ...(category === undefined ? {} : { category }),
          ...(duration === undefined ? {} : { duration }),
          ...(laterality === undefined ? {} : { laterality }),
          ...(posture === undefined ? {} : { posture }),
          ...(tags === undefined ? {} : { tags }),
        });
      },
    );
    return manifest.entries.length;
  },
};
