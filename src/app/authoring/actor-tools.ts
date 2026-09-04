import type { TimelineRuntime } from "@coretime/core";

import {
  addActorChange,
  commitSceneChanges,
  removeActorChanges,
  STANDING_PROMPT,
} from "../../scene/actors";
import { compositionRevision, SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import { sceneProject } from "../../scene/project";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { AddActorInput, RemoveActorInput } from "../../schema";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

const failure = (cause: unknown) => ({
  content: [
    {
      text: cause instanceof Error ? cause.message : String(cause),
      type: "text" as const,
    },
  ],
  isError: true,
});

/** The cast while the scene runs: an actor seated on a spare row, or one leaving the stage. */
export const actorTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): readonly RegisteredWebMcpTool[] => [
  {
    description: `Add an actor to the running scene. \`origin\` is where the actor stands in the world, in metres. \`path\` is its planar path in its own frame. If you give no path, the actor stays where it stands. \`scenario\` is its beats in order. If you give no beats, the actor does "${STANDING_PROMPT}" for the whole scene. Each beat must start on a window boundary. The beats together must equal the scene's frame count. The composition changes immediately, and the model makes the motion after that. To build an empty scene, add all the actors and the camera first. Then use control_motion_scene restart before you capture, because restart waits for the first poses you can see. The scene holds a set number of spare rows, and read_scene_summary reports how many.`,
    execute: async (raw) => {
      const input = AddActorInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const scene = SceneComposition.assert(readout.composition);
      const project = await sceneProject();
      const result = await addActorChange({
        origin: input.origin,
        ...(input.path === undefined ? {} : { path: input.path }),
        ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
        scene,
        story: project.record.definition.story,
      })
        .then(async ({ change, id, row }) => ({
          committed: await commitSceneChanges({
            author: "agent/add_actor",
            changes: [change],
            timeline,
          }),
          id,
          row,
        }))
        .then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause }),
        );
      if ("cause" in result) return failure(result.cause);
      await synchronize();
      return webMcpResult({
        actor: result.value.id,
        row: result.value.row,
        status: "committed; learned motion is generating",
        version: compositionRevision(result.value.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(AddActorInput),
    name: "add_actor",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actor: { type: "string" },
        row: { type: "integer" },
        status: { type: "string" },
        version: { type: "string" },
      },
      required: ["actor", "row", "status", "version"],
      type: "object",
    },
  },
  {
    description:
      "Remove an actor from the running scene at once, with the bodies that stood on its route. Camera shots that targeted it fall back to the remaining actors. The scene keeps at least one actor.",
    execute: async (raw) => {
      const input = RemoveActorInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const scene = SceneComposition.assert(readout.composition);
      const result = await Promise.resolve()
        .then(() =>
          commitSceneChanges({
            author: "agent/remove_actor",
            changes: removeActorChanges({ actor: input.actor, scene }),
            timeline,
          }),
        )
        .then(
          (value) => ({ value }),
          (cause: unknown) => ({ cause }),
        );
      if ("cause" in result) return failure(result.cause);
      await synchronize();
      return webMcpResult({
        actor: input.actor,
        version: compositionRevision(result.value.version),
      });
    },
    inputSchema: webMcpInputSchema(RemoveActorInput),
    name: "remove_actor",
    outputSchema: {
      additionalProperties: false,
      properties: { actor: { type: "string" }, version: { type: "string" } },
      required: ["actor", "version"],
      type: "object",
    },
  },
];
