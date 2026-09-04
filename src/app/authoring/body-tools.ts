import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import {
  BODY_TRACK,
  compositionRevision,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { BodyItemData, RemoveBodyInput, SetBodyInput } from "../../schema";
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

const commitBodyChange = async (input: {
  readonly change: SceneChange;
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
  readonly tool: string;
}) =>
  input.timeline.composition
    .preview({ changes: [input.change] })
    .then((preview) =>
      input.timeline.composition.commit({
        events: sceneCompositionEvents,
        id: `agent/${input.tool}/${crypto.randomUUID()}`,
        proposal: preview.proposal,
      }),
    )
    .then(
      async (committed) => {
        await input.synchronize();
        return { committed };
      },
      (cause: unknown) => ({ cause }),
    );

/**
 * Bodies placed by meaning: a box of a given mass at one sampled position on an actor's route.
 * The item is composition data; lowering applies it to the physics pool after the commit.
 */
export const bodyTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      "Put one body in the scene, or replace one. `tick` selects a point on the actor's route. `offset` moves the body from that point, in metres. If you give no offset, the body stands on the point. `halfExtents` is in metres. A mass of 0 makes a fixed body. A mass more than 0 makes a loose body. After the commit, the body goes into the physics: a loose body starts, and a fixed body moves or changes size where it is.",
    execute: async (raw) => {
      const input = SetBodyInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const scene = SceneComposition.assert(readout.composition);
      if (!scene.actors.some(({ subject }) => subject === input.subject)) {
        return failure(
          new Error(
            `The scene has no actor "${input.subject}"; actors: ${scene.actors.map(({ subject }) => subject).join(", ")}.`,
          ),
        );
      }
      const track = readout.composition.children.find((node) => node.id === BODY_TRACK);
      if (track?.kind !== "track") return failure(new Error("The scene has no body track."));
      const id = input.id ?? `${input.label}-${String(input.tick)}/${input.subject}`;
      const exists = track.items.some((item) => item.id === id);
      const value = {
        at: { clock: "motionFrame" as const, tick: input.tick },
        data: BodyItemData.assert({
          // A body without an offset rests on the route point: its centre sits half its height up.
          offset: input.offset ?? [0, input.halfExtents[1], 0],
          halfExtents: input.halfExtents,
          label: input.label,
          mass: input.mass,
          subject: input.subject,
        }),
        id,
      };
      const change: SceneChange = exists
        ? { composition: SCENE_COMPOSITION, item: id, type: "item/replace", value }
        : { composition: SCENE_COMPOSITION, track: BODY_TRACK, type: "item/add", value };
      const result = await commitBodyChange({ change, synchronize, timeline, tool: "set_body" });
      if ("cause" in result) return failure(result.cause);
      return webMcpResult({
        action: exists ? "replaced" : "added",
        id,
        status: "committed; the body enters physics on the next frame",
        version: compositionRevision(result.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(SetBodyInput),
    name: "set_body",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { enum: ["added", "replaced"], type: "string" },
        id: { type: "string" },
        status: { type: "string" },
        version: { type: "string" },
      },
      required: ["action", "id", "status", "version"],
      type: "object",
    },
  },
  {
    description:
      "Remove one body from the scene. Give its item id. The body leaves the physics after the commit.",
    execute: async (raw) => {
      const input = RemoveBodyInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const track = readout.composition.children.find((node) => node.id === BODY_TRACK);
      if (track?.kind !== "track" || !track.items.some((item) => item.id === input.id)) {
        return failure(new Error(`The body track has no item "${input.id}".`));
      }
      const result = await commitBodyChange({
        change: { composition: SCENE_COMPOSITION, item: input.id, type: "item/remove" },
        synchronize,
        timeline,
        tool: "remove_body",
      });
      if ("cause" in result) return failure(result.cause);
      return webMcpResult({
        action: "removed",
        id: input.id,
        version: compositionRevision(result.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(RemoveBodyInput),
    name: "remove_body",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { const: "removed", type: "string" },
        id: { type: "string" },
        version: { type: "string" },
      },
      required: ["action", "id", "version"],
      type: "object",
    },
  },
];
