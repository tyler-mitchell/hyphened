import type { TimelineRuntime } from "@coretime/core";
import { observeRuntime, toBase64, type Engine } from "webgpu-engine";

import { compositionRevision, SCENE_COMPOSITION, SceneComposition } from "../../scene/composition";
import { sceneProject } from "../../scene/project";
import { motionTimelineDeclaration, MOTION_FRAMES_PER_SECOND } from "../../scene/timeline";
import { MAX_SCENE_PREVIEW_REQUEST_BYTES, MotionPreviewInput } from "../../schema";
import { MOTION_CAPTURE_RESOURCE_ID } from "../../stage/system";
import { publishCaptureArtifact } from "./capture-artifact";
import { webMcpImageResult, webMcpInputSchema, type RegisteredWebMcpTool } from "./webmcp";

/** Capture the authored camera and motion as one animated scene artifact. */
export const scenePreviewTool = (input: {
  readonly engine: Engine<typeof motionTimelineDeclaration>;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): RegisteredWebMcpTool => ({
  annotations: { readOnlyHint: true },
  description:
    "Capture a part of the scene as an animated GIF. The capture reads the live GPU renderer. It uses the authored camera and the actors you can see. `samples` is the number of images. `stride` is the number of motion frames between them. The defaults capture six seconds at five images each second. The result holds the animation and a link to it. At the end, the transport goes back to its position and play state. If the images are too large, the capture is refused. Then use fewer samples or a smaller canvas.",
  execute: async (raw) => {
    const request = MotionPreviewInput.assert(raw);
    try {
      const project = await sceneProject();
      if (project.timeline !== input.timeline) {
        throw new Error("The scene changed before its preview could start.");
      }
      const document = await input.timeline.composition.read({ composition: SCENE_COMPOSITION });
      const composition = SceneComposition.assert(document.composition);
      const lastFrame = request.startFrame + (request.samples - 1) * request.stride;
      if (lastFrame >= composition.frameCount) {
        throw new Error(
          `Scene preview frame ${String(lastFrame)} exceeds scene frame ${String(composition.frameCount - 1)}.`,
        );
      }

      const transport = await input.timeline.transport.state();
      const advance = (remaining: number): Promise<void> =>
        remaining === 0
          ? Promise.resolve()
          : input.timeline.transport.stepBy({ ticks: 1 }).then(() => advance(remaining - 1));
      const shoot = async (
        remaining: number,
        frames: ReadonlyArray<string>,
      ): Promise<ReadonlyArray<string>> => {
        await input.engine.flush();
        const shot = await observeRuntime(input.engine).browserPng({
          target: MOTION_CAPTURE_RESOURCE_ID,
        });
        const encoded = toBase64(shot.bytes);
        const captured = [...frames, encoded];
        if (
          captured.reduce((bytes, frame) => bytes + frame.length, 0) >
          MAX_SCENE_PREVIEW_REQUEST_BYTES
        ) {
          throw new Error(
            `The captured scene preview exceeds the ${String(MAX_SCENE_PREVIEW_REQUEST_BYTES)}-byte encoding limit. Reduce samples or the canvas size.`,
          );
        }
        if (remaining === 1) return captured;
        await advance(request.stride);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return shoot(remaining - 1, captured);
      };

      const frames = await (async () => {
        await input.timeline.transport.pause();
        try {
          await input.timeline.transport.seekTo({
            clock: "motionFrame",
            tick: request.startFrame,
          });
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return await shoot(request.samples, []);
        } finally {
          await input.timeline.transport.seekTo(transport.position);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await input.engine.flush();
          if (transport.playing) {
            await input.timeline.transport.play({ rate: transport.rate });
          }
        }
      })();

      const body = JSON.stringify({
        delayMs: Math.round((request.stride / MOTION_FRAMES_PER_SECOND) * 1_000),
        frames,
        slug: `scene-${project.record.definition.id}`,
      });
      if (body.length > MAX_SCENE_PREVIEW_REQUEST_BYTES) {
        throw new Error(
          `The encoded scene preview exceeds the ${String(MAX_SCENE_PREVIEW_REQUEST_BYTES)}-byte request limit. Reduce samples or the canvas size.`,
        );
      }
      const response = await fetch("/api/motion-gif", {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `The scene preview could not be encoded: ${(await response.text()).slice(0, 300)}`,
        );
      }
      const animation = await response.blob();
      const data = toBase64(new Uint8Array(await animation.arrayBuffer()));
      const artifact = await publishCaptureArtifact(animation);

      return webMcpImageResult({
        data,
        mimeType: animation.type,
        name: `${project.record.definition.title} animated preview`,
        uri: artifact,
        value: {
          artifact,
          captureFramesPerSecond: MOTION_FRAMES_PER_SECOND / request.stride,
          compositionVersion: compositionRevision(document.version),
          durationSeconds: (request.samples * request.stride) / MOTION_FRAMES_PER_SECOND,
          firstFrame: request.startFrame,
          lastFrame,
          samples: request.samples,
          scene: project.record.definition.id,
          stride: request.stride,
          title: project.record.definition.title,
        },
      });
    } catch (cause) {
      return {
        content: [
          {
            text: cause instanceof Error ? cause.message : String(cause),
            type: "text" as const,
          },
        ],
        isError: true,
      };
    }
  },
  inputSchema: webMcpInputSchema(MotionPreviewInput),
  name: "capture_scene_preview",
  outputSchema: {
    additionalProperties: false,
    properties: {
      artifact: { type: "string" },
      captureFramesPerSecond: { type: "number" },
      compositionVersion: { type: "string" },
      durationSeconds: { type: "number" },
      firstFrame: { type: "integer" },
      lastFrame: { type: "integer" },
      samples: { type: "integer" },
      scene: { type: "string" },
      stride: { type: "integer" },
      title: { type: "string" },
    },
    required: [
      "artifact",
      "captureFramesPerSecond",
      "compositionVersion",
      "durationSeconds",
      "firstFrame",
      "lastFrame",
      "samples",
      "scene",
      "stride",
      "title",
    ],
    type: "object",
  },
});
