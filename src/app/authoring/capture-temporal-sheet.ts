import type { TimelineRuntime } from "@coretime/core";
import { observeRuntime, type ComposeSheetOptions, type Engine } from "webgpu-engine";

import { MOTION_CAPTURE_RESOURCE_ID } from "../../stage/system";
import {
  actorTrackId,
  CAMERA_TRACK,
  compositionRevision,
  PROMPT_TRACK,
  SCENE_COMPOSITION,
  SceneComposition,
} from "../../scene/composition";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { CameraItemData, DEFAULT_TEMPORAL_SHEET_COLUMNS, PromptItemData } from "../../schema";

const reviewHints = [
  "Check that the window, camera, and visible performers fit the question.",
  "Answer the question, then scan every cell once for unrelated visible problems.",
  "Mention important performers, times, angles, or scene regions that remain unseen.",
] as const;

const awaitPresentedFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Capture one bounded, composition-labeled window from the live renderer. */
export const captureMotionTemporalSheet = async (input: {
  readonly engine: Engine<typeof motionTimelineDeclaration>;
  readonly layout?: Omit<ComposeSheetOptions, "title">;
  readonly samples: number;
  readonly stride: number;
  readonly subject?: string;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
  readonly window:
    | { readonly kind: "current" }
    | { readonly frame: number; readonly kind: "frame" };
}) => {
  const transport = await input.timeline.transport.state();
  const currentFrame = (
    await input.timeline.quantize({
      coordinate: transport.position,
      grid: { clock: "motionFrame", every: 1 },
      mode: "floor",
    })
  ).tick;
  const firstFrame = input.window.kind === "current" ? currentFrame : input.window.frame;
  const frames = Array.from(
    { length: input.samples },
    (_unused, index) => firstFrame + index * input.stride,
  );
  const document = await input.timeline.composition.read({ composition: SCENE_COMPOSITION });
  const composition = SceneComposition.assert(document.composition);
  const subjects = composition.actors.map(({ subject }) => subject);
  const subject = input.subject ?? subjects[0];
  if (subject === undefined || !subjects.includes(subject)) {
    throw new Error(
      subject === undefined
        ? "The scene composition has no actor to capture."
        : `The scene composition has no actor "${subject}".`,
    );
  }
  const lastFrame = frames.at(-1)!;
  if (lastFrame >= composition.frameCount) {
    throw new Error(
      `Temporal sheet frame ${String(lastFrame)} exceeds scene frame ${String(composition.frameCount - 1)}.`,
    );
  }

  const observations = await Promise.all(
    frames.map(async (frame) => {
      const readout = await input.timeline.composition.at({
        composition: SCENE_COMPOSITION,
        position: { clock: "motionFrame", tick: frame },
      });
      const prompt = readout.occurrences.find(
        (occurrence) => occurrence.track === actorTrackId({ subject, track: PROMPT_TRACK }),
      );
      const camera = readout.occurrences.find((occurrence) => occurrence.track === CAMERA_TRACK);
      const cameraData = camera === undefined ? undefined : CameraItemData.assert(camera.item.data);
      return {
        camera: cameraData ?? null,
        cameraItem: camera?.item.id ?? "No authored camera",
        cameraMode: cameraData?.mode ?? "unassigned",
        frame,
        motionState:
          prompt === undefined
            ? "No authored motion state"
            : PromptItemData.assert(prompt.item.data).prompt,
      };
    }),
  );

  const image = await (async () => {
    await input.timeline.transport.pause();
    try {
      await input.timeline.transport.seekTo({ clock: "motionFrame", tick: firstFrame });
      await awaitPresentedFrame();
      return await observeRuntime(input.engine).sheet({
        advance: async () => {
          await input.timeline.transport.stepBy({ ticks: 1 });
        },
        cellLabel: (index) => {
          const sample = observations[index]!;
          return `frame ${String(sample.frame)} · state ${sample.motionState} · camera ${sample.cameraItem}`;
        },
        columns: input.layout?.columns ?? DEFAULT_TEMPORAL_SHEET_COLUMNS,
        flush: () => input.engine.flush(),
        samples: input.samples,
        stride: input.stride,
        target: MOTION_CAPTURE_RESOURCE_ID,
        title: `Motion · ${subject} · frames ${String(firstFrame)}-${String(lastFrame)}`,
        ...input.layout,
      });
    } finally {
      await input.timeline.transport.seekTo(transport.position);
      await awaitPresentedFrame();
      await input.engine.flush();
      if (transport.playing) await input.timeline.transport.play({ rate: transport.rate });
    }
  })();

  return {
    image,
    receipt: {
      activeSubjects: subjects,
      compositionVersion: compositionRevision(document.version),
      firstFrame,
      lastFrame,
      requestedWindow: input.window,
      reviewHints,
      sampleCount: observations.length,
      samples: observations,
      subject,
      view: {
        cameraItems: Array.from(new Set(observations.map(({ cameraItem }) => cameraItem))),
        kind: "authored-camera" as const,
      },
    },
  };
};
