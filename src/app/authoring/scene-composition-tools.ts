import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import {
  EditSceneCompositionInput,
  ReadSceneCompositionInput,
  SceneAtInput,
  SceneHistoryInput,
  SceneWindowInput,
} from "../../schema";
import {
  compositionRevision,
  SCENE_COMPOSITION,
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
      return webMcpResult({ readout });
    },
    inputSchema: webMcpInputSchema(SceneAtInput),
    name: "read_scene_at_frame",
    outputSchema: {
      additionalProperties: false,
      properties: { readout: { additionalProperties: true, type: "object" } },
      required: ["readout"],
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
      return webMcpResult({ readout });
    },
    inputSchema: webMcpInputSchema(SceneWindowInput),
    name: "read_scene_window",
    outputSchema: {
      additionalProperties: false,
      properties: { readout: { additionalProperties: true, type: "object" } },
      required: ["readout"],
      type: "object",
    },
  },
  {
    description:
      "Undo or redo the most recent authored scene edit through the same durable history the timeline editor uses. Returns the resulting composition version.",
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
