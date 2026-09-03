import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import { PUBLISHED_FRAMES_PER_WINDOW } from "webgpu-engine/motion";
import { sceneProject } from "../../scene/project";
import { encodeMotionPrompt } from "../../scene/prompt-encoder";
import { promptLibrary, type MotionPrompt } from "../../scene/prompts";
import {
  actorGroupId,
  actorTrackId,
  compositionRevision,
  MOTION_PROMPT_EVENT,
  PROMPT_TRACK,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import {
  EncodeMotionPromptInput,
  ListMotionPromptsInput,
  PromptItemData,
  SetMotionSpanInput,
} from "../../schema";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

type MotionTimeline = TimelineRuntime<typeof motionTimelineDeclaration>;
type SceneChange = TimelineCompositionChange<typeof motionTimelineDeclaration>;

const failure = (cause: unknown) => ({
  content: [
    {
      text: cause instanceof Error ? cause.message : String(cause),
      type: "text" as const,
    },
  ],
  isError: true,
});

const promptItemId = (input: { readonly start: number; readonly subject: string }) =>
  `prompt-${String(input.start)}/${input.subject}`;

/** The predicates a list_motion_prompts call names; an entry without the facet never matches. */
const promptFilters = ({
  category,
  enter,
  exit,
  maxPace,
  minPace,
  tag,
}: typeof ListMotionPromptsInput.infer): ReadonlyArray<(entry: MotionPrompt) => boolean> => [
  ...(category === undefined ? [] : [(entry: MotionPrompt) => entry.category === category]),
  ...(tag === undefined ? [] : [(entry: MotionPrompt) => entry.tags?.includes(tag) ?? false]),
  ...(enter === undefined ? [] : [(entry: MotionPrompt) => entry.posture?.enter === enter]),
  ...(exit === undefined ? [] : [(entry: MotionPrompt) => entry.posture?.exit === exit]),
  ...(minPace === undefined ? [] : [(entry: MotionPrompt) => entry.pace >= minPace]),
  ...(maxPace === undefined ? [] : [(entry: MotionPrompt) => entry.pace <= maxPace]),
];

/** How many entries carry each value of one facet; an entry without it counts as unclassified. */
const facetCounts = (values: ReadonlyArray<string | undefined>): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => {
    const key = value ?? "unclassified";
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }, {});

/** A library entry as the tool reports it: a facet the entry lacks is omitted, never invented. */
const promptEntry = ({
  category,
  duration,
  laterality,
  pace,
  posture,
  prompt,
  tags,
}: MotionPrompt) => ({
  pace,
  prompt,
  tags: tags ?? [],
  ...(category === undefined ? {} : { category }),
  ...(duration === undefined ? {} : { duration }),
  ...(laterality === undefined ? {} : { laterality }),
  ...(posture === undefined ? {} : { posture }),
});

const facetCountSchema = { additionalProperties: { type: "integer" }, type: "object" } as const;

/**
 * Motion authoring by meaning: give one actor one prompt over one frame range. The range snaps
 * outward to the generation grid, since a prompt can only change where a window begins. The
 * spans it overlaps are trimmed, split, or removed so the actor's prompt track stays contiguous,
 * and the commit goes through the same admission the timeline editor uses.
 */
export const motionSpanTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}): readonly RegisteredWebMcpTool[] => [
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Browse the prompts an actor can be conditioned on. Called with no input, it returns counts and no entries: `total`, `byCategory`, `byPostureEnter`, and `byPostureExit`, each counting entries without the facet under `unclassified` and summing to `total`; call it first to see the library's shape and choose a filter. With any filter (`category`, `tag`, `enter`, `exit`, `minPace`, `maxPace`; combined with AND; pace bounds inclusive, so minPace 0 and maxPace 0 gives the captions performed in place) or `all: true`, it returns `matched` (how many entries the filter selects), `returned` (how many are in this reply, at most `limit`, default 100, maximum 200; a larger limit is refused), and `prompts`; when returned is less than matched, narrow the filter. An entry without a facet never matches a filter on that facet. Each entry carries its route pace in metres per second (zero performs in place), its tags, and, when the library knows them, its category, laterality, posture (the stance a beat begins in and leaves the actor in, for chaining beats), and duration (a hint in frames, on a caption that completes an action). set_motion_span and author_scene accept exactly these prompt strings; a prompt's row loads the first time a span uses it.",
    execute: async (raw) => {
      const input = ListMotionPromptsInput.assert(raw);
      const library = promptLibrary.list();
      const filters = promptFilters(input);
      if (input.all !== true && filters.length === 0) {
        return webMcpResult({
          byCategory: facetCounts(library.map(({ category }) => category)),
          byPostureEnter: facetCounts(library.map(({ posture }) => posture?.enter)),
          byPostureExit: facetCounts(library.map(({ posture }) => posture?.exit)),
          total: library.length,
        });
      }
      const matched = library.filter((entry) => filters.every((matches) => matches(entry)));
      const returned = matched.slice(0, input.limit);
      return webMcpResult({
        matched: matched.length,
        prompts: returned.map(promptEntry),
        returned: returned.length,
      });
    },
    inputSchema: webMcpInputSchema(ListMotionPromptsInput),
    name: "list_motion_prompts",
    outputSchema: {
      additionalProperties: false,
      oneOf: [
        { required: ["byCategory", "byPostureEnter", "byPostureExit", "total"] },
        { required: ["matched", "prompts", "returned"] },
      ],
      properties: {
        byCategory: facetCountSchema,
        byPostureEnter: facetCountSchema,
        byPostureExit: facetCountSchema,
        matched: { type: "integer" },
        prompts: {
          items: {
            additionalProperties: false,
            properties: {
              category: { type: "string" },
              duration: { type: "integer" },
              laterality: { type: "string" },
              pace: { type: "number" },
              posture: {
                additionalProperties: false,
                properties: { enter: { type: "string" }, exit: { type: "string" } },
                required: ["enter", "exit"],
                type: "object",
              },
              prompt: { type: "string" },
              tags: { items: { type: "string" }, type: "array" },
            },
            required: ["pace", "prompt", "tags"],
            type: "object",
          },
          type: "array",
        },
        returned: { type: "integer" },
        total: { type: "integer" },
      },
      type: "object",
    },
  },
  {
    description:
      "Add a new prompt to the library by encoding a caption with the exact text encoder (a sentence in the training caption style, such as 'A person raises both arms in victory.'). Give the route pace in metres per second the actor should travel under it; zero performs in place. The prompt persists with the scene and set_motion_span accepts it at once. When the encoder service is unreachable it fails and says so; the 75 library captions still work, so call list_motion_prompts and use the nearest one.",
    execute: async (raw) => {
      const input = EncodeMotionPromptInput.assert(raw);
      const known = promptLibrary.find(input.prompt);
      const pace = input.pace ?? known?.pace ?? 0;
      const result = await encodeMotionPrompt(input.prompt).then(
        (embedding) => ({ embedding }),
        (cause: unknown) => ({ cause }),
      );
      // The encoder is a separate GPU service and can be unreachable. Saying so alone ends the
      // agent's workflow; naming the recovery keeps it going on the captions already present.
      if ("cause" in result) {
        return failure(
          new Error(
            `The text encoder is unreachable, so this caption cannot be added: ${
              result.cause instanceof Error ? result.cause.message : String(result.cause)
            }. The library still works: call list_motion_prompts to see its facets, pick the nearest caption, and use that with set_motion_span or author_scene.`,
          ),
        );
      }
      promptLibrary.admit({ embedding: result.embedding, pace });
      await (await sceneProject()).saveEmbedding({ embedding: result.embedding, pace });
      return webMcpResult({
        identity: result.embedding.identity.sha256,
        pace,
        prompt: input.prompt,
      });
    },
    inputSchema: webMcpInputSchema(EncodeMotionPromptInput),
    name: "encode_motion_prompt",
    outputSchema: {
      additionalProperties: false,
      properties: {
        identity: { type: "string" },
        pace: { type: "number" },
        prompt: { type: "string" },
      },
      required: ["identity", "pace", "prompt"],
      type: "object",
    },
  },
  {
    description:
      "Set what one actor does over a frame range: one prompt string from list_motion_prompts. Overlapped spans are trimmed or split; the range snaps to the 40-frame generation grid. The actor replans from the edited span and its new motion appears as it generates.",
    execute: async (raw) => {
      const input = SetMotionSpanInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const scene = SceneComposition.assert(readout.composition);
      const actor = scene.actors.find(({ subject }) => subject === input.actor);
      if (actor === undefined) {
        return failure(
          new Error(
            `The scene has no actor "${input.actor}"; actors: ${scene.actors.map(({ subject }) => subject).join(", ")}.`,
          ),
        );
      }
      if (promptLibrary.find(input.prompt) === undefined) {
        const library = promptLibrary.list().map(({ prompt }) => prompt);
        return failure(
          new Error(
            `"${input.prompt}" is not in the prompt library; prompts: ${library.join(" | ")}`,
          ),
        );
      }
      // A library row loads the first time a span uses it.
      const ensured = await promptLibrary.ensure([input.prompt]).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      if (ensured !== undefined) return failure(ensured);
      const grid = PUBLISHED_FRAMES_PER_WINDOW;
      const start = Math.floor(input.startFrame / grid) * grid;
      const end = Math.min(
        scene.frameCount,
        Math.ceil((input.startFrame + input.durationFrames) / grid) * grid,
      );
      if (end <= start) {
        return failure(
          new Error(
            `The span must begin before the scene's last frame ${String(scene.frameCount - 1)}.`,
          ),
        );
      }
      const group = readout.composition.children.find(
        (node) => node.id === actorGroupId(input.actor),
      );
      const track = group?.kind === "group" ? group.children[0] : undefined;
      if (track?.kind !== "track") return failure(new Error("The actor has no prompt track."));

      const spanAt = (
        item: { readonly data?: unknown },
        range: { readonly end: number; readonly start: number },
      ) => {
        const data = PromptItemData.assert(item.data);
        return {
          data,
          id: promptItemId({ start: range.start, subject: input.actor }),
          range: {
            clock: "motionFrame" as const,
            duration: range.end - range.start,
            start: range.start,
          },
          startEvent: { data, kind: MOTION_PROMPT_EVENT, subject: input.actor },
        };
      };
      const trackId = actorTrackId({ subject: input.actor, track: PROMPT_TRACK });
      const changes = track.items.flatMap((item): SceneChange[] => {
        if (item.range === undefined) return [];
        const itemStart = item.range.start;
        const itemEnd = item.range.start + item.range.duration;
        if (itemEnd <= start || itemStart >= end) return [];
        const before = itemStart < start;
        const after = itemEnd > end;
        return [
          ...(before
            ? [
                {
                  composition: SCENE_COMPOSITION,
                  item: item.id,
                  type: "item/replace" as const,
                  value: spanAt(item, { end: start, start: itemStart }),
                },
              ]
            : [{ composition: SCENE_COMPOSITION, item: item.id, type: "item/remove" as const }]),
          ...(after
            ? [
                {
                  composition: SCENE_COMPOSITION,
                  track: trackId,
                  type: "item/add" as const,
                  value: spanAt(item, { end: itemEnd, start: end }),
                },
              ]
            : []),
        ];
      });
      const proposal = [
        ...changes,
        {
          composition: SCENE_COMPOSITION,
          track: trackId,
          type: "item/add" as const,
          value: spanAt({ data: { prompt: input.prompt } }, { end, start }),
        },
      ];
      const result = await timeline.composition
        .preview({ changes: proposal })
        .then((preview) =>
          timeline.composition.commit({
            events: sceneCompositionEvents,
            // The transaction identity names its author so history reads who made each change.
            id: `agent/set_motion_span/${crypto.randomUUID()}`,
            proposal: preview.proposal,
          }),
        )
        .then(
          (committed) => ({ committed }),
          (cause: unknown) => ({ cause }),
        );
      if ("cause" in result) return failure(result.cause);
      await synchronize();
      return webMcpResult({
        actor: input.actor,
        endFrame: end,
        prompt: input.prompt,
        snapped: start !== input.startFrame || end !== input.startFrame + input.durationFrames,
        startFrame: start,
        status: "committed; the actor replans from this span and its motion appears as it generates",
        version: compositionRevision(result.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(SetMotionSpanInput),
    name: "set_motion_span",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actor: { type: "string" },
        endFrame: { type: "integer" },
        prompt: { type: "string" },
        snapped: { type: "boolean" },
        startFrame: { type: "integer" },
        status: { type: "string" },
        version: { type: "string" },
      },
      required: ["actor", "endFrame", "prompt", "snapped", "startFrame", "status", "version"],
      type: "object",
    },
  },
];
