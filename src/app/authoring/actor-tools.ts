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
    description: `Add an actor to the running scene: where it stands in the world (origin, metres), its planar path in its own frame (default: stays where it stands), and its beats in order (default: "${STANDING_PROMPT}" for the whole scene). Beats must begin on window boundaries and sum to the scene's frame count. The actor appears from the next window boundary and its id is returned; the scene has a few spare rows beyond its cast, and author_scene opens a scene with any cast size.`,
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
        version: { type: "string" },
      },
      required: ["actor", "row", "version"],
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
