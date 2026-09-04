import type { TimelineCompositionChange, TimelineRuntime } from "@coretime/core";
import { type } from "arktype";

import { fieldOfViewOfFocalLength, presetCameraShot } from "../../scene/cinematography";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import {
  CAMERA_TRACK,
  compositionRevision,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import {
  CameraItemData,
  DEFAULT_SCENE_PRESENTATION,
  RemoveCameraTimelineItemInput,
  SetCameraTimelineItemInput,
} from "../../schema";
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

type SceneChange = TimelineCompositionChange<typeof motionTimelineDeclaration>;

/** Commit one semantic camera operation through the scene's canonical admission boundary. */
const commitCameraChange = async (input: {
  readonly changes: readonly SceneChange[];
  readonly synchronize: () => Promise<void>;
  readonly timeline: MotionTimeline;
}) => {
  const preview = await input.timeline.composition.preview({ changes: input.changes });
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
      "Make one camera shot, or replace one completely. `startFrame` is the shot's first frame. `durationFrames` is how many frames it holds, and it does not include the frame after the last. If you give a `to` view, the camera moves to it and arrives on the last frame, with a smooth start and stop. Two shots next to each other make a hard cut. For a preset shot, use `{ kind: 'camera', preset, subject }`. The presets are establishing, tracking, follow, close-up, low-angle, crane, reveal, and hero. For an orbit view, give the distance in metres and the pitch and yaw in radians. For a look-at view, give the position. `focalLength` is in millimetres on a 35 mm filmback. If you give no `projection` or `target`, the scene supplies them. The new shot cuts, divides, or removes the shots it covers, so the camera track keeps no gaps.",
    execute: async (raw) => {
      const input = SetCameraTimelineItemInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const track = readout.composition.children.find((node) => node.id === CAMERA_TRACK);
      if (track?.kind !== "track") return failure(new Error("The scene has no camera track."));
      const exists = track.items.some(({ id }) => id === input.id);
      const scene = SceneComposition.assert(readout.composition);
      // The camera track spans exactly the scene, so a shot is clipped to the scene's frames.
      const start = Math.min(input.startFrame, scene.frameCount);
      const end = Math.min(input.startFrame + input.durationFrames, scene.frameCount);
      if (end <= start) {
        return failure(
          new Error(
            `The shot must begin before the scene's last frame ${String(scene.frameCount - 1)}.`,
          ),
        );
      }
      const projection = DEFAULT_SCENE_PRESENTATION.camera.projection;
      const shot = (() => {
        if ("preset" in input.data) {
          const wanted = input.data.subject;
          const subject = scene.actors.find(({ subject }) => subject === wanted);
          if (subject === undefined) {
            return new Error(
              `The scene has no actor "${wanted}"; actors: ${scene.actors.map(({ subject }) => subject).join(", ")}.`,
            );
          }
          return presetCameraShot({
            ...(input.data.label === undefined ? {} : { label: input.data.label }),
            preset: input.data.preset,
            projection,
            range: { end, start },
            scene,
            subject,
          });
        }
        const { focalLength, ...view } = input.data;
        return {
          ...view,
          ...(focalLength === undefined
            ? {}
            : {
                projection: {
                  ...(view.projection ?? projection),
                  fieldOfViewY: fieldOfViewOfFocalLength(focalLength),
                },
              }),
        };
      })();
      if (shot instanceof Error) return failure(shot);
      const data = CameraItemData({
        projection,
        target: {
          entities: scene.actors.map(({ subject }) => subject),
          kind: "entities",
          offset: [0, 0, 0],
        },
        ...shot,
      });
      if (data instanceof type.errors) return failure(new Error(data.summary));
      const value = {
        data,
        id: input.id,
        range: { clock: "motionFrame" as const, duration: end - start, start },
      };
      // Adjacent shots are hard cuts, so the new shot takes its frames from whatever it overlaps:
      // a shot it starts inside keeps its head, a shot it ends inside keeps its tail, and a shot
      // it covers is removed. The track stays contiguous, which the scene composition requires.
      const trimmed = track.items.flatMap((item): SceneChange[] => {
        if (item.id === input.id || item.range === undefined) return [];
        const itemStart = item.range.start;
        const itemEnd = item.range.start + item.range.duration;
        if (itemEnd <= start || itemStart >= end) return [];
        const shot = (range: { readonly end: number; readonly start: number }) => ({
          data: item.data,
          range: {
            clock: "motionFrame" as const,
            duration: range.end - range.start,
            start: range.start,
          },
        });
        return [
          ...(itemStart < start
            ? [
                {
                  composition: SCENE_COMPOSITION,
                  item: item.id,
                  type: "item/replace" as const,
                  value: { ...shot({ end: start, start: itemStart }), id: item.id },
                },
              ]
            : [{ composition: SCENE_COMPOSITION, item: item.id, type: "item/remove" as const }]),
          ...(itemEnd > end
            ? [
                {
                  composition: SCENE_COMPOSITION,
                  track: CAMERA_TRACK,
                  type: "item/add" as const,
                  value: {
                    ...shot({ end: itemEnd, start: end }),
                    id: `${item.id}/after-${String(end)}`,
                  },
                },
              ]
            : []),
        ];
      });
      const change: SceneChange = exists
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
      const result = await commitCameraChange({
        changes: [...trimmed, change],
        synchronize,
        timeline,
      }).then(
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
      "Remove one camera shot from the authored scene; the shot before it (or after it, for the first shot) extends over its frames so the cuts stay contiguous. The scene's only shot cannot be removed. The operation fails when the identity does not belong to the camera track.",
    execute: async (raw) => {
      const input = RemoveCameraTimelineItemInput.assert(raw);
      const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
      const track = readout.composition.children.find((node) => node.id === CAMERA_TRACK);
      const removed =
        track?.kind === "track" ? track.items.find(({ id }) => id === input.id) : undefined;
      if (track?.kind !== "track" || removed?.range === undefined) {
        return failure(new Error(`The camera track has no timeline item "${input.id}".`));
      }
      const ordered = track.items
        .filter((item) => item.id !== input.id && item.range !== undefined)
        .toSorted((left, right) => left.range!.start - right.range!.start);
      const removedEnd = removed.range.start + removed.range.duration;
      const before = ordered.findLast((item) => item.range!.start < removed.range!.start);
      const after = ordered.find((item) => item.range!.start >= removedEnd);
      const neighbour = before ?? after;
      if (neighbour?.range === undefined) {
        return failure(new Error("The scene keeps at least one camera shot."));
      }
      const extended =
        before === undefined
          ? { end: neighbour.range.start + neighbour.range.duration, start: removed.range.start }
          : { end: removedEnd, start: neighbour.range.start };
      const result = await commitCameraChange({
        changes: [
          { composition: SCENE_COMPOSITION, item: input.id, type: "item/remove" },
          {
            composition: SCENE_COMPOSITION,
            item: neighbour.id,
            type: "item/replace",
            value: {
              data: neighbour.data,
              id: neighbour.id,
              range: {
                clock: "motionFrame" as const,
                duration: extended.end - extended.start,
                start: extended.start,
              },
            },
          },
        ],
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
