import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";

import type { motionTimelineDeclaration } from "../../scene/timeline";
import {
  CAMERA_TRACK,
  compositionRevision,
  SCENE_COMPOSITION,
  sceneCompositionEvents,
} from "../../scene/composition";
import { RemoveCameraTimelineItemInput, SetCameraTimelineItemInput } from "learned-motion/schema";
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

/** Commit one semantic camera operation through the scene's canonical admission boundary. */
const commitCameraChange = async (input: {
  readonly change: TimelineCompositionChange<typeof motionTimelineDeclaration>;
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}) => {
  const preview = await input.timeline.composition.preview({ changes: [input.change] });
  const committed = await input.timeline.composition.commit({
    events: sceneCompositionEvents,
    id: `agent/camera/${crypto.randomUUID()}`,
    proposal: preview.proposal,
  });
  await input.synchronize();
  return committed;
};

/** Camera timeline authoring operations for browser agents. */
export const cameraCompositionTools = ({
  synchronize,
  timeline,
}: {
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}): readonly RegisteredWebMcpTool[] => [
  {
    description:
      "Create or fully replace one camera timeline item: a shot. The item owns an exact motion-frame range and the camera view used by both the live stage and temporal capture. Adjacent items are hard cuts. Give `to` (orbit: distance, pitch, yaw; look-at: position) and the shot moves from its view to that view across its own frames with an eased curve: a push-in, a pull-back, or an orbit. Orbit yaw and pitch are radians; distance is metres from the target. Camera-track overlap is rejected by the scene composition.",
    execute: async (raw) => {
      const input = SetCameraTimelineItemInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const track = readout.composition.children.find((node) => node.id === CAMERA_TRACK);
      if (track?.kind !== "track") return failure(new Error("The scene has no camera track."));
      const exists = track.items.some(({ id }) => id === input.id);
      const value = {
        data: input.data,
        id: input.id,
        range: {
          clock: "motionFrame" as const,
          duration: input.durationFrames,
          start: input.startFrame,
        },
      };
      const change: TimelineCompositionChange<typeof motionTimelineDeclaration> = exists
        ? {
            composition: SCENE_COMPOSITION,
            item: input.id,
            type: "item/replace",
            value,
          }
        : {
            composition: SCENE_COMPOSITION,
            track: CAMERA_TRACK,
            type: "item/add",
            value,
          };
      const result = await commitCameraChange({ change, synchronize, timeline }).then(
        (committed) => ({ committed }),
        (cause: unknown) => ({ cause }),
      );
      if ("cause" in result) return failure(result.cause);
      return webMcpResult({
        action: exists ? "replaced" : "added",
        item: input.id,
        version: compositionRevision(result.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(SetCameraTimelineItemInput),
    name: "set_camera_timeline_item",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { enum: ["added", "replaced"], type: "string" },
        item: { type: "string" },
        version: { type: "string" },
      },
      required: ["action", "item", "version"],
      type: "object",
    },
  },
  {
    description:
      "Remove one camera timeline item from the authored scene. The operation fails when the identity does not belong to the camera track.",
    execute: async (raw) => {
      const input = RemoveCameraTimelineItemInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const track = readout.composition.children.find((node) => node.id === CAMERA_TRACK);
      if (track?.kind !== "track" || !track.items.some(({ id }) => id === input.id)) {
        return failure(new Error(`The camera track has no timeline item "${input.id}".`));
      }
      const result = await commitCameraChange({
        change: { composition: SCENE_COMPOSITION, item: input.id, type: "item/remove" },
        synchronize,
        timeline,
      }).then(
        (committed) => ({ committed }),
        (cause: unknown) => ({ cause }),
      );
      if ("cause" in result) return failure(result.cause);
      return webMcpResult({
        action: "removed",
        item: input.id,
        version: compositionRevision(result.committed.version),
      });
    },
    inputSchema: webMcpInputSchema(RemoveCameraTimelineItemInput),
    name: "remove_camera_timeline_item",
    outputSchema: {
      additionalProperties: false,
      properties: {
        action: { const: "removed", type: "string" },
        item: { type: "string" },
        version: { type: "string" },
      },
      required: ["action", "item", "version"],
      type: "object",
    },
  },
];
