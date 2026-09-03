import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import {
  BODY_TRACK,
  compositionRevision,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { BodyItemData, RemoveBodyInput, SetBodyInput } from "learned-motion/schema";
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
 * Bodies placed by meaning: a box of a given mass standing where an actor's route is at a frame.
 * The item is composition data; lowering spawns it into the physics pool at once.
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
      "Place or replace one body in the scene: a box with half extents in metres and a mass (0 is fixed, like a bar; above 0 is loose, like a crate), standing where an actor's route is at a frame, its centre `elevation` above the ground. It enters physics at once: a loose body spawns, and a fixed body moves or resizes in place.",
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
          elevation: input.elevation,
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
      "Remove one body from the scene by its item id. It leaves physics at once.",
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
