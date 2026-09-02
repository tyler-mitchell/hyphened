import tgpu, { d, std } from "typegpu";
import {
  capabilityExport,
  defineCommand,
  defineComputePass,
  defineGraphCapability,
  defineResourceBindings,
  presentationInterpolation,
  res,
  TimelineClockUniform,
  type StorageBufferResourceSpec,
  type SystemCapabilityExportReference,
  type SystemGraphCapability,
  type UniformResourceSpec,
} from "webgpu-engine";

import type { MotionPresentation } from "./presentation";
import type { createMotionSurface } from "./surface";
import { MotionView, type MotionCameraProgram, type MotionRenderProgram } from "../schema";

// WGSL supports textureDimensions(texture_depth_2d); TypeGPU 0.12 omits depth textures from its
// TypeScript overload while its resolver emits the correct intrinsic.
const depthTextureDimensions = std.textureDimensions as unknown as (
  texture: d.textureDepth2d,
) => d.v2u;

export const MotionCameraFrame = d.struct({
  far: d.f32,
  fieldOfViewY: d.f32,
  interpolate: d.u32,
  mode: d.u32,
  near: d.f32,
  targetEntityCount: d.u32,
  targetEntityOffset: d.u32,
  targetKind: d.u32,
  orbit: d.vec4f,
  position: d.vec4f,
  targetOffset: d.vec4f,
  targetPoint: d.vec4f,
});

export const MOTION_CAMERA_ID = "motion-camera";
export const MOTION_CAMERA_COMMAND = {
  frames: "write-frames",
  targetEntities: "write-target-entities",
} as const;

export const compileMotionCameraRows = (program: MotionCameraProgram) => {
  const targetEntities = program.frames.flatMap(({ target }) =>
    target.kind === "entities" ? target.entities : [],
  );
  return {
    frames: program.frames.map((frame, index) => {
      const projection = frame.projection;
      const targetEntityOffset = program.frames
        .slice(0, index)
        .reduce(
          (count, previous) =>
            count + (previous.target.kind === "entities" ? previous.target.entities.length : 0),
          0,
        );
      return MotionCameraFrame({
        far: projection.far,
        fieldOfViewY: projection.fieldOfViewY,
        interpolate: Number(frame.interpolate),
        mode: Number(frame.mode === "orbit"),
        near: projection.near,
        orbit:
          frame.mode === "orbit" ? d.vec4f(frame.distance, frame.pitch, frame.yaw, 0) : d.vec4f(),
        position: frame.mode === "look-at" ? d.vec4f(...frame.position, 1) : d.vec4f(),
        targetEntityCount: frame.target.kind === "entities" ? frame.target.entities.length : 0,
        targetEntityOffset,
        targetKind: Number(frame.target.kind === "entities"),
        targetOffset:
          frame.target.kind === "entities" ? d.vec4f(...frame.target.offset, 0) : d.vec4f(),
        targetPoint:
          frame.target.kind === "point" ? d.vec4f(...frame.target.position, 1) : d.vec4f(),
      });
    }),
    targetEntities: targetEntities.concat(0).slice(0, Math.max(1, targetEntities.length)),
  };
};

export interface MotionCamera {
  readonly capability: SystemGraphCapability;
  readonly view: SystemCapabilityExportReference<StorageBufferResourceSpec<typeof MotionView, 1>>;
}

/** Resolve authored camera cuts, transforms, and entity targets from the presented GPU pose. */
export const createMotionCamera = (input: {
  readonly clock: SystemCapabilityExportReference<UniformResourceSpec<typeof TimelineClockUniform>>;
  readonly phase: string;
  readonly presentation: MotionPresentation;
  readonly program: MotionRenderProgram;
  readonly surface: ReturnType<typeof createMotionSurface>;
}): MotionCamera => {
  const rows = compileMotionCameraRows(input.program.camera);
  const capability = defineGraphCapability({
    id: MOTION_CAMERA_ID,
    needs: {
      clock: input.clock,
      samples: input.presentation.samples,
      surface: input.surface.dimensions,
    },
    resources: {
      frames: res.storageBuffer({
        capacity: rows.frames.length,
        initial: rows.frames,
        lifetime: "persistent",
        schema: MotionCameraFrame,
      }),
      targetEntities: res.storageBuffer({
        capacity: Math.max(1, input.program.frameCount * input.presentation.actorCount),
        initial: rows.targetEntities,
        lifetime: "persistent",
        schema: d.u32,
      }),
      view: res.storageBuffer({
        capacity: 1,
        initial: [
          MotionView({
            groundOrigin: d.vec4f(),
            lightDirection: d.vec4f(...input.program.lightDirection, 0),
            viewProjection: d.mat4x4f(),
          }),
        ],
        lifetime: "persistent",
        schema: MotionView,
      }),
    },
    exports: { view: "view" },
    commands: [
      defineCommand({
        id: MOTION_CAMERA_COMMAND.frames,
        mode: "replace",
        phase: input.phase,
        target: "frames",
      }),
      defineCommand({
        id: MOTION_CAMERA_COMMAND.targetEntities,
        mode: "replace",
        phase: input.phase,
        target: "targetEntities",
      }),
    ],
    build: ({ needs, resources }) => {
      const io = defineResourceBindings({
        id: `${MOTION_CAMERA_ID}/resources`,
        entries: {
          clock: needs.clock,
          frames: resources.frames,
          samples: needs.samples,
          surface: needs.surface,
          targetEntities: resources.targetEntities,
          view: { resource: resources.view, access: "write" },
        },
      });
      const target = tgpu.fn(
        [MotionCameraFrame],
        d.vec4f,
      )((frame) => {
        "use gpu";
        let sum = d.vec3f();
        let count = d.f32(0);
        for (let offset = d.u32(0); offset < frame.targetEntityCount; offset++) {
          const actor = io.$.targetEntities[frame.targetEntityOffset + offset];
          const sample = io.$.samples[actor * d.u32(input.program.jointCount)];
          const present = d.f32(sample.present);
          sum = std.add(sum, std.mul(sample.rootPosition.xyz, present));
          count += present;
        }
        const entityTarget = d.vec4f(
          std.add(std.mul(sum, d.f32(1) / std.max(count, d.f32(1))), frame.targetOffset.xyz),
          1,
        );
        return std.select(frame.targetPoint, entityTarget, frame.targetKind !== d.u32(0));
      });
      const position = tgpu.fn(
        [MotionCameraFrame, d.vec4f],
        d.vec4f,
      )((frame, resolvedTarget) => {
        "use gpu";
        const horizontal = frame.orbit.x * std.cos(frame.orbit.y);
        const orbit = d.vec4f(
          resolvedTarget.x + horizontal * std.sin(frame.orbit.z),
          resolvedTarget.y + frame.orbit.x * std.sin(frame.orbit.y),
          resolvedTarget.z + horizontal * std.cos(frame.orbit.z),
          1,
        );
        return std.select(frame.position, orbit, frame.mode !== d.u32(0));
      });
      const present = tgpu
        .computeFn({ workgroupSize: [1, 1, 1] })(() => {
          "use gpu";
          const time = d.f32(io.$.clock.tick) + presentationInterpolation();
          const frameIndex = std.min(d.u32(time), d.u32(input.program.frameCount - 1));
          const nextFrameIndex = std.min(
            frameIndex + d.u32(1),
            d.u32(input.program.frameCount - 1),
          );
          const current = io.$.frames[frameIndex];
          const next = io.$.frames[nextFrameIndex];
          const alpha = std.select(
            d.f32(0),
            time - std.floor(time),
            current.interpolate !== d.u32(0),
          );
          const currentTarget = target(current);
          const nextTarget = target(next);
          const resolvedTarget = std.add(
            currentTarget,
            std.mul(std.sub(nextTarget, currentTarget), alpha),
          );
          const currentPosition = position(current, currentTarget);
          const nextPosition = position(next, nextTarget);
          const resolvedPosition = std.add(
            currentPosition,
            std.mul(std.sub(nextPosition, currentPosition), alpha),
          );
          const fieldOfViewY =
            current.fieldOfViewY + (next.fieldOfViewY - current.fieldOfViewY) * alpha;
          const near = current.near + (next.near - current.near) * alpha;
          const far = current.far + (next.far - current.far) * alpha;
          const backward = std.normalize(std.sub(resolvedPosition.xyz, resolvedTarget.xyz));
          const right = std.normalize(
            std.cross(
              d.vec3f(
                input.program.cameraUp[0],
                input.program.cameraUp[1],
                input.program.cameraUp[2],
              ),
              backward,
            ),
          );
          const up = std.cross(backward, right);
          const view = d.mat4x4f(
            d.vec4f(right.x, up.x, backward.x, 0),
            d.vec4f(right.y, up.y, backward.y, 0),
            d.vec4f(right.z, up.z, backward.z, 0),
            d.vec4f(
              -std.dot(right, resolvedPosition.xyz),
              -std.dot(up, resolvedPosition.xyz),
              -std.dot(backward, resolvedPosition.xyz),
              1,
            ),
          );
          const focal = d.f32(1) / std.tan(fieldOfViewY * d.f32(0.5));
          const depth = d.f32(1) / (near - far);
          const surfaceSize = depthTextureDimensions(io.$.surface);
          const projection = d.mat4x4f(
            d.vec4f(focal / (d.f32(surfaceSize.x) / d.f32(surfaceSize.y)), 0, 0, 0),
            d.vec4f(0, focal, 0, 0),
            d.vec4f(0, 0, far * depth, -1),
            d.vec4f(0, 0, near * far * depth, 0),
          );
          io.$.view[d.u32(0)] = MotionView({
            groundOrigin: d.vec4f(
              resolvedTarget.x,
              input.program.ground.height,
              resolvedTarget.z,
              1,
            ),
            lightDirection: d.vec4f(
              input.program.lightDirection[0],
              input.program.lightDirection[1],
              input.program.lightDirection[2],
              0,
            ),
            viewProjection: std.mul(projection, view),
          });
        })
        .$name(`${MOTION_CAMERA_ID}/present`);
      return {
        passes: [
          defineComputePass({
            bindGroups: [io],
            dispatch: 1,
            id: "present",
            phase: input.phase,
            shader: present,
          }),
        ],
      };
    },
  });
  return {
    capability,
    view: capabilityExport({ capability, export: "view" }),
  };
};
