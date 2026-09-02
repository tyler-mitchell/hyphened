import tgpu, { d, std } from "typegpu";
import {
  capabilityExport,
  defineComputePass,
  defineGraphCapability,
  defineResourceBindings,
  res,
  type StorageBufferResourceSpec,
  type SystemCapabilityExportReference,
  type SystemGraphCapability,
} from "webgpu-engine";

import type { MotionPresentation } from "../motion/presentation";
import { MotionWorldTransform, type MotionRenderProgram } from "../schema";

const rotationColumns = tgpu.fn(
  [d.vec4f],
  d.arrayOf(d.vec4f, 3),
)((rotation) => {
  "use gpu";
  const x = rotation.x;
  const y = rotation.y;
  const z = rotation.z;
  const w = rotation.w;
  return [
    d.vec4f(
      d.f32(1) - d.f32(2) * (y * y + z * z),
      d.f32(2) * (x * y + z * w),
      d.f32(2) * (x * z - y * w),
      0,
    ),
    d.vec4f(
      d.f32(2) * (x * y - z * w),
      d.f32(1) - d.f32(2) * (x * x + z * z),
      d.f32(2) * (y * z + x * w),
      0,
    ),
    d.vec4f(
      d.f32(2) * (x * z + y * w),
      d.f32(2) * (y * z - x * w),
      d.f32(1) - d.f32(2) * (x * x + y * y),
      0,
    ),
  ];
});

const multiplyQuaternions = tgpu.fn(
  [d.vec4f, d.vec4f],
  d.vec4f,
)((parent, local) => {
  "use gpu";
  return d.vec4f(
    parent.w * local.x + parent.x * local.w + parent.y * local.z - parent.z * local.y,
    parent.w * local.y - parent.x * local.z + parent.y * local.w + parent.z * local.x,
    parent.w * local.z + parent.x * local.y - parent.y * local.x + parent.z * local.w,
    parent.w * local.w - parent.x * local.x - parent.y * local.y - parent.z * local.z,
  );
});

const rotateVector = tgpu.fn(
  [d.vec4f, d.vec3f],
  d.vec3f,
)((rotation, vector) => {
  "use gpu";
  const axis = rotation.xyz;
  return std.add(
    vector,
    std.mul(
      std.cross(axis, std.add(std.cross(axis, vector), std.mul(vector, rotation.w))),
      d.f32(2),
    ),
  );
});

const multiplyColumn = tgpu.fn(
  [d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.vec4f],
  d.vec4f,
)((column0, column1, column2, column3, vector) => {
  "use gpu";
  return d.vec4f(
    column0.x * vector.x + column1.x * vector.y + column2.x * vector.z + column3.x * vector.w,
    column0.y * vector.x + column1.y * vector.y + column2.y * vector.z + column3.y * vector.w,
    column0.z * vector.x + column1.z * vector.y + column2.z * vector.z + column3.z * vector.w,
    column0.w * vector.x + column1.w * vector.y + column2.w * vector.z + column3.w * vector.w,
  );
});

const skinColumns = tgpu.fn(
  [d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.vec4f],
  d.arrayOf(d.vec4f, 4),
)((rotation, position, inverse0, inverse1, inverse2, inverse3) => {
  "use gpu";
  const world = rotationColumns(rotation);
  return [
    multiplyColumn(world[0], world[1], world[2], position, inverse0),
    multiplyColumn(world[0], world[1], world[2], position, inverse1),
    multiplyColumn(world[0], world[1], world[2], position, inverse2),
    multiplyColumn(world[0], world[1], world[2], position, inverse3),
  ];
});

export interface SkinPalette {
  readonly actorCount: number;
  readonly capability: SystemGraphCapability;
  readonly jointCount: number;
  readonly columns: SystemCapabilityExportReference<
    StorageBufferResourceSpec<typeof d.vec4f, number>
  >;
  readonly worldTransforms: SystemCapabilityExportReference<
    StorageBufferResourceSpec<typeof MotionWorldTransform, number>
  >;
}

/** Expand interpolated local poses through one topologically ordered GPU hierarchy. */
export const createSkinPalette = (input: {
  readonly id: string;
  readonly phase: string;
  readonly presentation: MotionPresentation;
  readonly program: MotionRenderProgram;
}): SkinPalette => {
  const capability = defineGraphCapability({
    id: input.id,
    needs: {
      samples: input.presentation.samples,
    },
    resources: {
      inverseBindColumns: res.storageBuffer({
        capacity: input.program.inverseBindColumns.length,
        initial: input.program.inverseBindColumns.map((column) => d.vec4f(...column)),
        lifetime: "persistent",
        schema: d.vec4f,
      }),
      paletteColumns: res.storageBuffer({
        capacity: input.presentation.actorCount * input.program.jointCount * 4,
        lifetime: "persistent",
        schema: d.vec4f,
      }),
      parentIndices: res.storageBuffer({
        capacity: input.program.parentIndices.length,
        initial: input.program.parentIndices.map(d.i32),
        lifetime: "persistent",
        schema: d.i32,
      }),
      restLocalTranslations: res.storageBuffer({
        capacity: input.program.restLocalTranslations.length,
        initial: input.program.restLocalTranslations.map((translation) =>
          d.vec4f(...translation, 0),
        ),
        lifetime: "persistent",
        schema: d.vec4f,
      }),
      worldTransforms: res.storageBuffer({
        capacity: input.presentation.actorCount * input.program.jointCount,
        lifetime: "persistent",
        schema: MotionWorldTransform,
      }),
    },
    exports: { columns: "paletteColumns", worldTransforms: "worldTransforms" },
    build: ({ needs, resources }) => {
      const io = defineResourceBindings({
        id: `${input.id}/resources`,
        entries: {
          inverseBindColumns: resources.inverseBindColumns,
          paletteColumns: { resource: resources.paletteColumns, access: "write" },
          parentIndices: resources.parentIndices,
          restLocalTranslations: resources.restLocalTranslations,
          samples: needs.samples,
          worldTransforms: { resource: resources.worldTransforms, access: "read-write" },
        },
      });
      const fold = tgpu
        .computeFn({ in: { gid: d.builtin.globalInvocationId }, workgroupSize: [1, 1, 1] })(
          ({ gid }) => {
            "use gpu";
            const actorBase = gid.x * d.u32(input.program.jointCount);
            const rootRotation = io.$.samples[actorBase].rotation;
            const rootPosition = io.$.samples[actorBase].rootPosition;
            io.$.worldTransforms[actorBase] = MotionWorldTransform({
              position: rootPosition,
              rotation: rootRotation,
            });
            const rootSkin = skinColumns(
              rootRotation,
              rootPosition,
              io.$.inverseBindColumns[d.u32(0)],
              io.$.inverseBindColumns[d.u32(1)],
              io.$.inverseBindColumns[d.u32(2)],
              io.$.inverseBindColumns[d.u32(3)],
            );
            const rootPaletteBase = actorBase * d.u32(4);
            io.$.paletteColumns[rootPaletteBase] = d.vec4f(rootSkin[0]);
            io.$.paletteColumns[rootPaletteBase + d.u32(1)] = d.vec4f(rootSkin[1]);
            io.$.paletteColumns[rootPaletteBase + d.u32(2)] = d.vec4f(rootSkin[2]);
            io.$.paletteColumns[rootPaletteBase + d.u32(3)] = d.vec4f(rootSkin[3]);
            for (let joint = d.u32(1); joint < d.u32(input.program.jointCount); joint++) {
              const parent = d.u32(io.$.parentIndices[joint]);
              const parentTransform = io.$.worldTransforms[actorBase + parent];
              const rotation = multiplyQuaternions(
                parentTransform.rotation,
                io.$.samples[actorBase + joint].rotation,
              );
              const position = d.vec4f(
                std.add(
                  parentTransform.position.xyz,
                  rotateVector(parentTransform.rotation, io.$.restLocalTranslations[joint].xyz),
                ),
                1,
              );
              io.$.worldTransforms[actorBase + joint] = MotionWorldTransform({
                position,
                rotation,
              });
              const inverseBase = joint * d.u32(4);
              const palette = skinColumns(
                rotation,
                position,
                io.$.inverseBindColumns[inverseBase],
                io.$.inverseBindColumns[inverseBase + d.u32(1)],
                io.$.inverseBindColumns[inverseBase + d.u32(2)],
                io.$.inverseBindColumns[inverseBase + d.u32(3)],
              );
              const paletteBase = (actorBase + joint) * d.u32(4);
              io.$.paletteColumns[paletteBase] = d.vec4f(palette[0]);
              io.$.paletteColumns[paletteBase + d.u32(1)] = d.vec4f(palette[1]);
              io.$.paletteColumns[paletteBase + d.u32(2)] = d.vec4f(palette[2]);
              io.$.paletteColumns[paletteBase + d.u32(3)] = d.vec4f(palette[3]);
            }
          },
        )
        .$name(`${input.id}/fold`);
      return {
        passes: [
          defineComputePass({
            bindGroups: [io],
            dispatch: input.presentation.actorCount,
            id: "fold",
            phase: input.phase,
            shader: fold,
          }),
        ],
      };
    },
  });
  return {
    actorCount: input.presentation.actorCount,
    capability,
    columns: capabilityExport({ capability, export: "columns" }),
    jointCount: input.program.jointCount,
    worldTransforms: capabilityExport({ capability, export: "worldTransforms" }),
  };
};
