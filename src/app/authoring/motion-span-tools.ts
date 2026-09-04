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
  query,
  tag,
}: typeof ListMotionPromptsInput.infer): ReadonlyArray<(entry: MotionPrompt) => boolean> => [
  ...(category === undefined ? [] : [(entry: MotionPrompt) => entry.category === category]),
  ...(tag === undefined ? [] : [(entry: MotionPrompt) => entry.tags?.includes(tag) ?? false]),
  ...(enter === undefined ? [] : [(entry: MotionPrompt) => entry.posture?.enter === enter]),
  ...(exit === undefined ? [] : [(entry: MotionPrompt) => entry.posture?.exit === exit]),
  ...(minPace === undefined ? [] : [(entry: MotionPrompt) => entry.pace >= minPace]),
  ...(maxPace === undefined ? [] : [(entry: MotionPrompt) => entry.pace <= maxPace]),
  ...(query === undefined
    ? []
    : [
        (entry: MotionPrompt) => {
          const text = [
            entry.prompt,
            entry.category,
            entry.laterality,
            entry.posture?.enter,
            entry.posture?.exit,
            ...(entry.tags ?? []),
          ]
            .filter((value) => value !== undefined)
            .join(" ")
            .toLowerCase();
          return query
            .toLowerCase()
            .split(/\s+/u)
            .every((term) => text.includes(term));
        },
      ]),
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
      "Search the motion prompts that an actor can perform. `query` matches each word against the caption, its tags, its category, its laterality, and its posture. The other filters are `category`, `tag`, `enter`, `exit`, `minPace`, and `maxPace`. All the filters you give must match. If you give no query and no filter, the result holds only the counts. Set `all` only if you need the whole catalogue. Each result gives the caption exactly as set_motion_span and author_scene accept it, the route pace, the tags, and the posture and duration hints that exist.",
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
      "Add a new prompt to the library. The tool encodes your caption with the same text encoder that made the library. Write the caption in the style of the training captions, such as 'A person raises both arms in victory.' Give the route pace in metres each second that the actor must travel under this prompt. A pace of zero performs the prompt in place. The prompt stays with the scene, and set_motion_span accepts it immediately. If the encoder service does not answer, the tool fails and says so. The published library still works, so search it with list_motion_prompts and use the nearest caption.",
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
      "Set what one actor does across a range of frames. Give one prompt from list_motion_prompts. The tool moves the range to the 40-frame generation grid, because a prompt can change only where a window starts. It cuts or divides the spans that the range covers. The actor then makes a new plan from the edited span, and you see the new motion as the model makes it.",
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
        status:
          "committed; the actor replans from this span and its motion appears as it generates",
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
