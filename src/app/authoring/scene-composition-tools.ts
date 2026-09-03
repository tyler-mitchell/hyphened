import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import { MOTION_FRAMES_PER_SECOND, type motionTimelineDeclaration } from "../../scene/timeline";
import {
  EditSceneCompositionInput,
  ReadSceneCompositionInput,
  ReadSceneHistoryInput,
  ReadSceneSummaryInput,
  SceneAtInput,
  SceneHistoryInput,
  SceneWindowInput,
} from "../../schema";
import { freeActorRows } from "../../scene/actors";
import { AUTHORED_STORIES } from "../../scene/default";
import { sceneProject } from "../../scene/project";
import { readSceneHistory } from "../../scene/history";
import {
  compositionRevision,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

type MotionTimeline = TimelineRuntime<typeof motionTimelineDeclaration>;

const failure = (cause: unknown) => ({
  content: [
    {
      text: cause instanceof Error ? cause.message : String(cause),
      type: "text" as const,
    },
  ],
  isError: true,
});

export const sceneCompositionTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}): readonly RegisteredWebMcpTool[] => [
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Read the authored scene composition: its actor groups, prompt and root-constraint tracks, items, transitions, and current version.",
    execute: async (raw) => {
      const input = ReadSceneCompositionInput.assert(raw);
      const readout = await timeline.composition.read({
        composition: input.composition ?? SCENE_COMPOSITION,
      });
      return webMcpResult({
        composition: readout.composition,
        id: readout.id,
        version: compositionRevision(readout.version),
      });
    },
    inputSchema: webMcpInputSchema(ReadSceneCompositionInput),
    name: "read_scene_composition",
    outputSchema: {
      additionalProperties: false,
      properties: {
        composition: { additionalProperties: true, type: "object" },
        id: { type: "string" },
        version: { type: "string" },
      },
      required: ["composition", "id", "version"],
      type: "object",
    },
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Read a compact summary of the scene: frame count, each actor's origin, prompt spans, and route end, the placed bodies, the camera shots with their views (mode, distance, pitch, yaw, target, and `to` when a shot moves), the transport (current frame, playing, rate), and the current version. Start here; call list_motion_prompts for the prompt library, and read the full composition only when you need item identities.",
    execute: async (raw) => {
      ReadSceneSummaryInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const scene = SceneComposition.assert(readout.composition);
      const transport = await timeline.transport.state();
      const { tick: frame } = await timeline.quantize({
        coordinate: transport.position,
        grid: { clock: "motionFrame", every: 1 },
        mode: "floor",
      });
      return webMcpResult({
        actors: scene.actors.map(({ promptTrack, rootTrack, subject, worldOffset }) => ({
          id: subject,
          // Where the actor's own frame sits in the world, so a new actor can be placed beside it.
          origin: worldOffset,
          routeEnd: rootTrack.items.at(-1)?.data.position ?? [0, 0],
          spans: promptTrack.items
            .toSorted((left, right) => left.range.start - right.range.start)
            .map(({ data, range }) => ({
              end: range.start + range.duration,
              prompt: data.prompt,
              start: range.start,
            })),
        })),
        bodies: scene.bodies.map(({ id, mass, subject, tick }) => ({ id, mass, subject, tick })),
        // Each shot carries its authored view (mode, distance, pitch, yaw, target, and `to` when it
        // moves), so an agent can frame a new cut relative to the existing ones.
        cameras: scene.cameraTrack.items
          .toSorted((left, right) => left.range.start - right.range.start)
          .map(({ data, id, range }) => ({
            ...data,
            end: range.start + range.duration,
            id,
            start: range.start,
          })),
        frameCount: scene.frameCount,
        framesPerSecond: MOTION_FRAMES_PER_SECOND,
        // How many actors add_actor can still seat before a new scene is needed.
        freeActorRows: freeActorRows({
          scene,
          story: (await sceneProject()).record.definition.story,
        }),
        // The built-in stories, in the shape author_scene takes, so an agent can read one and
        // write its own; control_motion_scene newScene opens one by id.
        stories: Object.entries(AUTHORED_STORIES).map(([id, story]) => ({ id, ...story })),
        // Where the playhead is, so a capture or a cut can be placed without a transport read.
        transport: { frame, playing: transport.playing, rate: transport.rate },
        version: compositionRevision(readout.version),
      });
    },
    inputSchema: webMcpInputSchema(ReadSceneSummaryInput),
    name: "read_scene_summary",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actors: { items: { additionalProperties: true, type: "object" }, type: "array" },
        bodies: { items: { additionalProperties: true, type: "object" }, type: "array" },
        cameras: { items: { additionalProperties: true, type: "object" }, type: "array" },
        frameCount: { type: "integer" },
        framesPerSecond: { type: "number" },
        freeActorRows: { type: "integer" },
        stories: { items: { additionalProperties: true, type: "object" }, type: "array" },
        transport: {
          additionalProperties: false,
          properties: {
            frame: { type: "integer" },
            playing: { type: "boolean" },
            rate: { type: "number" },
          },
          required: ["frame", "playing", "rate"],
          type: "object",
        },
        version: { type: "string" },
      },
      required: [
        "actors",
        "bodies",
        "cameras",
        "frameCount",
        "framesPerSecond",
        "freeActorRows",
        "stories",
        "transport",
        "version",
      ],
      type: "object",
    },
  },
  {
    description:
      "Atomically commit canonical Core Time composition changes to the authored scene. The proposal carries its admitted basis through the same boundary the timeline editor uses, so malformed or stale data never reaches history or a device.",
    execute: async (raw) => {
      const input = EditSceneCompositionInput.assert(raw);
      const preview = await timeline.composition
        .preview({
          changes: input.changes as unknown as TimelineCompositionChange<
            typeof motionTimelineDeclaration
          >[],
        })
        .then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause }),
        );
      if ("cause" in preview) return failure(preview.cause);

      const committed = await timeline.composition
        .commit({
          events: sceneCompositionEvents,
          id: input.transactionId,
          proposal: preview.value.proposal,
        })
        .then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause }),
        );
      if ("cause" in committed) return failure(committed.cause);
      await synchronize();

      return webMcpResult({
        changes: committed.value.changes,
        status: committed.value.status,
        summary: input.summary,
        transactionId: committed.value.id,
        version: compositionRevision(committed.value.version),
      });
    },
    inputSchema: webMcpInputSchema(EditSceneCompositionInput),
    name: "edit_scene_composition",
    outputSchema: {
      additionalProperties: false,
      properties: {
        changes: { items: { additionalProperties: true, type: "object" }, type: "array" },
        status: { type: "string" },
        summary: { type: "string" },
        transactionId: { type: "string" },
        version: { type: "string" },
      },
      required: ["changes", "status", "summary", "transactionId", "version"],
      type: "object",
    },
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Evaluate the scene at one exact motion frame: which items, transitions, and markers are active there. Use this instead of inferring execution from authored ranges.",
    execute: async (raw) => {
      const input = SceneAtInput.assert(raw);
      const readout = await timeline.composition.at({
        composition: SCENE_COMPOSITION,
        position: { clock: "motionFrame", tick: input.frame },
      });
      // The active items only: an agent asked what is happening at this frame, not for the tree.
      return webMcpResult({
        active: readout.occurrences.map(({ item, track }) => ({
          data: item.data,
          id: item.id,
          track,
          ...("range" in item && item.range !== undefined
            ? { end: item.range.start + item.range.duration, start: item.range.start }
            : {}),
          ...("at" in item && item.at !== undefined ? { at: item.at.tick } : {}),
        })),
        frame: input.frame,
        version: compositionRevision(readout.version),
      });
    },
    inputSchema: webMcpInputSchema(SceneAtInput),
    name: "read_scene_at_frame",
    outputSchema: {
      additionalProperties: false,
      properties: {
        active: { items: { additionalProperties: true, type: "object" }, type: "array" },
        frame: { type: "integer" },
        version: { type: "string" },
      },
      required: ["active", "frame", "version"],
      type: "object",
    },
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Read a bounded timeline window of the scene: items and transitions intersecting a half-open motion-frame range, summarized the way the editor renders it.",
    execute: async (raw) => {
      const input = SceneWindowInput.assert(raw);
      const readout = await timeline.composition.window({
        composition: SCENE_COMPOSITION,
        range: {
          clock: "motionFrame",
          duration: input.durationFrames,
          start: input.startFrame,
        },
      });
      // The items that touch the window, each with its identity, track, data, and frames.
      return webMcpResult({
        endFrame: input.startFrame + input.durationFrames,
        items: readout.items.map(({ item, track }) => ({
          data: item.data,
          id: item.id,
          track,
          ...("range" in item && item.range !== undefined
            ? { end: item.range.start + item.range.duration, start: item.range.start }
            : {}),
          ...("at" in item && item.at !== undefined ? { at: item.at.tick } : {}),
        })),
        startFrame: input.startFrame,
        version: compositionRevision(readout.version),
      });
    },
    inputSchema: webMcpInputSchema(SceneWindowInput),
    name: "read_scene_window",
    outputSchema: {
      additionalProperties: false,
      properties: {
        endFrame: { type: "integer" },
        items: { items: { additionalProperties: true, type: "object" }, type: "array" },
        startFrame: { type: "integer" },
        version: { type: "string" },
      },
      required: ["endFrame", "items", "startFrame", "version"],
      type: "object",
    },
  },
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Read who authored the scene in this page session: every authored transaction in order, with its author (agent, editor, or the scene itself for the seed or the reopened document), the action (the tool or editor operation), and its journal step. Undo and redo appear as their own entries.",
    execute: async (raw) => {
      ReadSceneHistoryInput.assert(raw);
      return webMcpResult({ entries: await readSceneHistory(timeline) });
    },
    inputSchema: webMcpInputSchema(ReadSceneHistoryInput),
    name: "read_scene_history",
    outputSchema: {
      additionalProperties: false,
      properties: {
        entries: {
          items: {
            additionalProperties: false,
            properties: {
              action: { type: "string" },
              author: { enum: ["agent", "editor", "scene"], type: "string" },
              id: { type: "string" },
              step: { type: "integer" },
            },
            required: ["action", "author", "id", "step"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["entries"],
      type: "object",
    },
  },
  {
    description:
      "Undo or redo the most recent authored scene edit through the same history the timeline editor uses; history spans this page session. Returns the resulting composition version.",
    execute: async (raw) => {
      const input = SceneHistoryInput.assert(raw);
      const identity = { id: input.transactionId };
      const result = await (
        input.action === "undo"
          ? timeline.composition.undo(identity)
          : timeline.composition.redo(identity)
      ).then(
        (value) => ({ value }),
        (cause: unknown) => ({ cause }),
      );
      if ("cause" in result) return failure(result.cause);
      if (result.value === undefined) {
        return failure(new Error(`nothing to ${input.action}`));
      }
      await synchronize();
      return webMcpResult({
        action: input.action,
        version: compositionRevision(result.value.version),
      });
    },
    inputSchema: webMcpInputSchema(SceneHistoryInput),
    name: "undo_scene_composition",
    outputSchema: {
      additionalProperties: false,
      properties: { action: { type: "string" }, version: { type: "string" } },
      required: ["action", "version"],
      type: "object",
    },
  },
];
