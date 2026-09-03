import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import { PUBLISHED_FRAMES_PER_WINDOW } from "../../provider/generation/layout";
import { sceneProject } from "../../scene/project";
import { encodeMotionPrompt } from "../../scene/prompt-encoder";
import { promptLibrary } from "../../scene/prompts";
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
      "List the prompts an actor can be conditioned on, each with its route pace in metres per second (zero means the actor performs in place). set_motion_span accepts exactly these prompt strings.",
    execute: async (raw) => {
      ListMotionPromptsInput.assert(raw);
      return webMcpResult({
        prompts: promptLibrary.list().map(({ pace, prompt }) => ({ pace, prompt })),
      });
    },
    inputSchema: webMcpInputSchema(ListMotionPromptsInput),
    name: "list_motion_prompts",
    outputSchema: {
      additionalProperties: false,
      properties: {
        prompts: {
          items: {
            additionalProperties: false,
            properties: { pace: { type: "number" }, prompt: { type: "string" } },
            required: ["pace", "prompt"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["prompts"],
      type: "object",
    },
  },
  {
    description:
      "Add a new prompt to the library by encoding a caption with the exact text encoder (a sentence in the training caption style, such as 'A person raises both arms in victory.'). Give the route pace in metres per second the actor should travel under it; zero performs in place. The prompt persists with the scene and set_motion_span accepts it at once. Fails when the encoder service is unreachable; the library prompts still work.",
    execute: async (raw) => {
      const input = EncodeMotionPromptInput.assert(raw);
      const known = promptLibrary.find(input.prompt);
      const pace = input.pace ?? known?.pace ?? 0;
      const result = await encodeMotionPrompt(input.prompt).then(
        (embedding) => ({ embedding }),
        (cause: unknown) => ({ cause }),
      );
      if ("cause" in result) return failure(result.cause);
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
