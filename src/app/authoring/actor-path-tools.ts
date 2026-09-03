import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import {
  actorGroupId,
  actorTrackId,
  compositionRevision,
  ROOT_TRACK,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import { routeConstraints } from "../../scene/default";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { RootConstraint } from "webgpu-engine/motion";
import { SetActorPathInput } from "../../schema";
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

/**
 * Route authoring by geometry: give one actor a path and its route is relowered from that path
 * and its current prompt spans. The path decides where the body goes and turns; the prompts'
 * paces decide how fast it gets there, so the same path walks or runs by what the spans say.
 */
export const actorPathTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      "Set the planar path one actor travels, as [x, z] points in metres in the actor's own frame starting at its origin. The route is recomputed from the path and the actor's prompt spans, whose paces set the timetable; the actor replans from the next window.",
    execute: async (raw) => {
      const input = SetActorPathInput.assert(raw);
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
      const group = readout.composition.children.find(
        (node) => node.id === actorGroupId(input.actor),
      );
      const track = group?.kind === "group" ? group.children[1] : undefined;
      if (track?.kind !== "track") return failure(new Error("The actor has no route track."));
      const spans = actor.promptTrack.items.map(({ data, range }) => ({
        durationFrames: range.duration,
        prompt: data.prompt,
        start: range.start,
      }));
      const route = routeConstraints({
        frameCount: scene.frameCount,
        path: [[0, 0], ...input.path],
        spans,
      });
      const trackId = actorTrackId({ subject: input.actor, track: ROOT_TRACK });
      const proposal: SceneChange[] = [
        ...track.items.map((item) => ({
          composition: SCENE_COMPOSITION,
          item: item.id,
          type: "item/remove" as const,
        })),
        ...route.map(({ constraint, tick }) => ({
          composition: SCENE_COMPOSITION,
          track: trackId,
          type: "item/add" as const,
          value: {
            at: { clock: "motionFrame" as const, tick },
            data: RootConstraint.assert(constraint),
            id: `root-${String(tick)}/${input.actor}`,
          },
        })),
      ];
      const result = await timeline.composition
        .preview({ changes: proposal })
        .then((preview) =>
          timeline.composition.commit({
            events: sceneCompositionEvents,
            id: `agent/set_actor_path/${crypto.randomUUID()}`,
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
        status: "committed; the actor replans from the next window and follows the new path as it generates",
        version: compositionRevision(result.committed.version),
        vertices: route.length,
      });
    },
    inputSchema: webMcpInputSchema(SetActorPathInput),
    name: "set_actor_path",
    outputSchema: {
      additionalProperties: false,
      properties: {
        actor: { type: "string" },
        status: { type: "string" },
        version: { type: "string" },
        vertices: { type: "integer" },
      },
      required: ["actor", "status", "version", "vertices"],
      type: "object",
    },
  },
];
