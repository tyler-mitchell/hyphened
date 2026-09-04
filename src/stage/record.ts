import type { TimelineRuntime } from "@coretime/core";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from "mediabunny";
import { observeRuntime, type Engine } from "webgpu-engine";

import { MOTION_FRAMES_PER_SECOND, motionTimelineDeclaration } from "../scene/timeline";
import { MOTION_CAPTURE_RESOURCE_ID } from "./system";

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/**
 * Render the scene to an MP4 one frame at a time.
 *
 * Generation runs ahead of the playhead but not at a guaranteed rate, so a screen recording carries
 * whatever stutter the run had. Stepping the transport and reading the capture target instead
 * writes a file at the timeline's own frame rate from a machine that cannot play it back at that
 * rate. Recording is read-only: the transport returns to where it was and resumes if it was playing.
 */
export const recordScene = async (input: {
  readonly engine: Engine<typeof motionTimelineDeclaration>;
  readonly frameCount: number;
  readonly onProgress?: (recorded: number) => void;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): Promise<Blob> => {
  const resumed = await input.timeline.transport.state();
  await input.timeline.transport.pause();
  try {
    await input.timeline.transport.seekTo({ clock: "motionFrame", tick: 0 });
    await settle();
    await input.engine.flush();

    const first = await observeRuntime(input.engine).rgba({ target: MOTION_CAPTURE_RESOURCE_ID });
    // H.264 refuses odd dimensions; the presentation size is whatever the window happens to be.
    const width = first.width - (first.width % 2);
    const height = first.height - (first.height % 2);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The recorder could not open a drawing context.");

    const source = new CanvasSource(canvas, {
      codec: "avc",
      quality: new Quality({ bitrate: 8_000_000 }),
    });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    output.addVideoTrack(source, { frameRate: MOTION_FRAMES_PER_SECOND });
    await output.start();

    const record = async (frame: number): Promise<void> => {
      await input.engine.flush();
      const shot = await observeRuntime(input.engine).rgba({ target: MOTION_CAPTURE_RESOURCE_ID });
      context.putImageData(
        new ImageData(new Uint8ClampedArray(shot.data), shot.width, shot.height),
        0,
        0,
      );
      source.add(frame / MOTION_FRAMES_PER_SECOND, 1 / MOTION_FRAMES_PER_SECOND);
      input.onProgress?.(frame + 1);
      if (frame + 1 >= input.frameCount) return;
      await input.timeline.transport.stepBy({ ticks: 1 });
      await settle();
      return record(frame + 1);
    };
    await record(0);

    await output.finalize();
    const written = output.target.buffer;
    if (written === null) throw new Error("The recorder produced no file.");
    return new Blob([written], { type: "video/mp4" });
  } finally {
    await input.timeline.transport.seekTo(resumed.position);
    await settle();
    await input.engine.flush();
    if (resumed.playing) await input.timeline.transport.play({ rate: resumed.rate });
  }
};
