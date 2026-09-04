import tgpu, { d, std } from "typegpu";
import { texture2dArray } from "typegpu/data";
import {
  Body,
  BODY_FLAG_ALIVE,
  BODY_FLAG_HIDDEN,
  BODY_FLAG_STATIC,
  capabilityResourceKey,
  defineGraphCapability,
  defineRenderStage,
  defineShaderFamily,
  geometryVertexIndex,
  GeometryVertexRow,
  IndexedGeometryRecordRow,
  interpolateBodyPose,
  res,
  rotateByQuat,
  Shape,
  type SystemGraphCapability,
} from "webgpu-engine";

import { MotionPoseSample, u32DivMod, type MotionPresentation } from "webgpu-engine/motion";
import { PHYSICS_ID, type MotionBodies } from "./bodies";
import type { MotionCamera } from "./camera";
import { motionViewBindings, type MotionRenderProgram } from "../schema";
import type { EnvironmentRenderProgram } from "./environment";
import type { SkinPalette } from "./skin";
import type { createMotionSurface } from "./surface";

export const MOTION_RENDERER_ID = "motion-renderer";
export const MOTION_CAPTURE_RESOURCE_KEY = capabilityResourceKey({
  capabilityId: MOTION_RENDERER_ID,
  localName: "capture",
});
export const MOTION_BASE_COLOR_RESOURCE_KEY = capabilityResourceKey({
  capabilityId: MOTION_RENDERER_ID,
  localName: "baseColor",
});

const SkinnedVertex = d.struct({
  joints0: d.vec4u,
  joints1: d.vec4u,
  normal: d.vec4f,
  position: d.vec4f,
  // Texture coordinates in xy, the base-colour array layer this vertex samples in z.
  uv: d.vec4f,
  weights0: d.vec4f,
  weights1: d.vec4f,
});
const Skin = d.struct({ jointCount: d.u32 });
const SceneColor = {
  capture: d.location(0, d.vec4f),
  presentation: d.location(1, d.vec4f),
} as const;
const EnvironmentInstanceRow = d.struct({
  worldFromLocal: d.mat4x4f,
  normalFromLocal: d.mat4x4f,
  color: d.vec4f,
  geometry: d.u32,
  pad0: d.u32,
  pad1: d.u32,
  pad2: d.u32,
});
const environmentBindings = tgpu.bindGroupLayout({
  indices: { storage: d.arrayOf(d.u32), access: "readonly" },
  instances: { storage: d.arrayOf(EnvironmentInstanceRow), access: "readonly" },
  records: { storage: d.arrayOf(IndexedGeometryRecordRow), access: "readonly" },
  vertices: { storage: d.arrayOf(GeometryVertexRow), access: "readonly" },
});
const environmentVertex = tgpu.vertexFn({
  in: { instanceIndex: d.builtin.instanceIndex, vertexIndex: d.builtin.vertexIndex },
  out: {
    color: d.interpolate("flat", d.vec4f),
    normal: d.vec3f,
    position: d.builtin.position,
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const instance = environmentBindings.$.instances[instanceIndex];
  const record = environmentBindings.$.records[instance.geometry];
  if (vertexIndex >= record.indexCount) {
    return { color: instance.color, normal: d.vec3f(0, 1, 0), position: d.vec4f(0, 0, 2, 1) };
  }
  const local = environmentBindings.$.indices[
    geometryVertexIndex(record.indexOffset, vertexIndex)
  ];
  const vertex = environmentBindings.$.vertices[
    geometryVertexIndex(record.vertexOffset, local)
  ];
  const world = std.mul(instance.worldFromLocal, vertex.position);
  return {
    color: instance.color,
    normal: std.normalize(std.mul(instance.normalFromLocal, vertex.normal).xyz),
    position: std.mul(motionViewBindings.$.view[d.u32(0)].viewProjection, world),
  };
});
const CharacterTexture = texture2dArray(d.f32);
const skinBindings = tgpu.bindGroupLayout({
  baseColor: { texture: CharacterTexture },
  baseColorSampler: { sampler: "filtering" },
  indices: { storage: d.arrayOf(d.u32), access: "readonly" },
  paletteColumns: { storage: d.arrayOf(d.vec4f), access: "readonly" },
  samples: { storage: d.arrayOf(MotionPoseSample), access: "readonly" },
  skin: { uniform: Skin },
  vertices: { storage: d.arrayOf(SkinnedVertex), access: "readonly" },
});

const paletteTransform = tgpu.fn(
  [d.u32, d.u32, d.vec4f],
  d.vec4f,
)((actor, joint, vector) => {
  "use gpu";
  const offset = (actor * skinBindings.$.skin.jointCount + joint) * d.u32(4);
  const column0 = skinBindings.$.paletteColumns[offset];
  const column1 = skinBindings.$.paletteColumns[offset + d.u32(1)];
  const column2 = skinBindings.$.paletteColumns[offset + d.u32(2)];
  const column3 = skinBindings.$.paletteColumns[offset + d.u32(3)];
  return d.vec4f(
    column0.x * vector.x + column1.x * vector.y + column2.x * vector.z + column3.x * vector.w,
    column0.y * vector.x + column1.y * vector.y + column2.y * vector.z + column3.y * vector.w,
    column0.z * vector.x + column1.z * vector.y + column2.z * vector.z + column3.z * vector.w,
    column0.w * vector.x + column1.w * vector.y + column2.w * vector.z + column3.w * vector.w,
  );
});

const skinVector = tgpu.fn(
  [d.u32, d.u32, d.vec4f],
  d.vec4f,
)((actor, vertexIndex, vector) => {
  "use gpu";
  const vertex = skinBindings.$.vertices[vertexIndex];
  const first = paletteTransform(actor, vertex.joints0.x, vector);
  const second = paletteTransform(actor, vertex.joints0.y, vector);
  const third = paletteTransform(actor, vertex.joints0.z, vector);
  const fourth = paletteTransform(actor, vertex.joints0.w, vector);
  const fifth = paletteTransform(actor, vertex.joints1.x, vector);
  const sixth = paletteTransform(actor, vertex.joints1.y, vector);
  const seventh = paletteTransform(actor, vertex.joints1.z, vector);
  const eighth = paletteTransform(actor, vertex.joints1.w, vector);
  return d.vec4f(
    first.x * vertex.weights0.x +
      second.x * vertex.weights0.y +
      third.x * vertex.weights0.z +
      fourth.x * vertex.weights0.w +
      fifth.x * vertex.weights1.x +
      sixth.x * vertex.weights1.y +
      seventh.x * vertex.weights1.z +
      eighth.x * vertex.weights1.w,
    first.y * vertex.weights0.x +
      second.y * vertex.weights0.y +
      third.y * vertex.weights0.z +
      fourth.y * vertex.weights0.w +
      fifth.y * vertex.weights1.x +
      sixth.y * vertex.weights1.y +
      seventh.y * vertex.weights1.z +
      eighth.y * vertex.weights1.w,
    first.z * vertex.weights0.x +
      second.z * vertex.weights0.y +
      third.z * vertex.weights0.z +
      fourth.z * vertex.weights0.w +
      fifth.z * vertex.weights1.x +
      sixth.z * vertex.weights1.y +
      seventh.z * vertex.weights1.z +
      eighth.z * vertex.weights1.w,
    first.w * vertex.weights0.x +
      second.w * vertex.weights0.y +
      third.w * vertex.weights0.z +
      fourth.w * vertex.weights0.w +
      fifth.w * vertex.weights1.x +
      sixth.w * vertex.weights1.y +
      seventh.w * vertex.weights1.z +
      eighth.w * vertex.weights1.w,
  );
});

const vertex = tgpu.vertexFn({
  in: { instanceIndex: d.builtin.instanceIndex, vertexIndex: d.builtin.vertexIndex },
  out: {
    actor: d.interpolate("flat", d.u32),
    material: d.interpolate("flat", d.u32),
    normal: d.vec3f,
    position: d.builtin.position,
    uv: d.vec2f,
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const source = skinBindings.$.indices[vertexIndex];
  const skinned = skinVector(
    instanceIndex,
    source,
    d.vec4f(skinBindings.$.vertices[source].position.xyz, 1),
  );
  const position = std.mul(motionViewBindings.$.view[d.u32(0)].viewProjection, skinned);
  return {
    actor: instanceIndex,
    material: d.u32(skinBindings.$.vertices[source].uv.z),
    uv: skinBindings.$.vertices[source].uv.xy,
    normal: std.normalize(
      skinVector(instanceIndex, source, d.vec4f(skinBindings.$.vertices[source].normal.xyz, 0)).xyz,
    ),
    position: std.select(
      d.vec4f(0, 0, 2, 1),
      position,
      skinBindings.$.samples[instanceIndex * skinBindings.$.skin.jointCount].present !== d.u32(0),
    ),
  };
});

const crateBindings = tgpu.bindGroupLayout({
  bodies: { storage: d.arrayOf(Body), access: "readonly" },
  previousBodies: { storage: d.arrayOf(Body), access: "readonly" },
  shapes: { storage: d.arrayOf(Shape), access: "readonly" },
});
const BOX_VERTEX_COUNT = 36;
// A unit cube as host tables: six faces of two triangles, one outward normal per face.
const faceAxes = [0, 0, 1, 1, 2, 2] as const;
const faceSigns = [1, -1, 1, -1, 1, -1] as const;
const quadU = [-1, 1, 1, -1, 1, -1] as const;
const quadV = [-1, -1, 1, -1, 1, 1] as const;
const cubeCorners = tgpu.const(
  d.arrayOf(d.vec3f, BOX_VERTEX_COUNT),
  Array.from({ length: BOX_VERTEX_COUNT }, (_unused, vertexIndex) => {
    const face = Math.floor(vertexIndex / 6);
    const sign = faceSigns[face]!;
    const u = quadU[vertexIndex % 6]! * sign;
    const v = quadV[vertexIndex % 6]!;
    const byAxis = [d.vec3f(sign, u, v), d.vec3f(v, sign, u), d.vec3f(u, v, sign)] as const;
    return byAxis[faceAxes[face]!];
  }),
);
const cubeNormals = tgpu.const(
  d.arrayOf(d.vec3f, 6),
  Array.from({ length: 6 }, (_unused, face) => {
    const sign = faceSigns[face]!;
    const byAxis = [d.vec3f(sign, 0, 0), d.vec3f(0, sign, 0), d.vec3f(0, 0, sign)] as const;
    return byAxis[faceAxes[face]!];
  }),
);
// Every physics pool row draws as one instanced box; a hidden row (a collider whose visual lives
// elsewhere) degenerates to nothing.
const crateVertex = tgpu.vertexFn({
  in: { instanceIndex: d.builtin.instanceIndex, vertexIndex: d.builtin.vertexIndex },
  out: { normal: d.vec3f, position: d.builtin.position, fixed: d.interpolate("flat", d.f32) },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const body = crateBindings.$.bodies[instanceIndex];
  const pose = interpolateBodyPose(body, crateBindings.$.previousBodies[instanceIndex], true);
  const shape = crateBindings.$.shapes[body.shapeOffset];
  // A retired or cleared row keeps its last extent; only an alive, visible body draws.
  const visual = std.select(
    d.f32(0),
    d.f32(1),
    (body.flags & d.u32(BODY_FLAG_ALIVE | BODY_FLAG_HIDDEN)) === d.u32(BODY_FLAG_ALIVE),
  );
  const corner = cubeCorners.$[vertexIndex];
  const scaled = d.vec3f(
    corner.x * shape.halfExtents.x * visual,
    corner.y * shape.halfExtents.y * visual,
    corner.z * shape.halfExtents.z * visual,
  );
  const local = std.add(shape.localPosition, rotateByQuat(shape.localOrientation, scaled));
  const world = std.add(pose.position, rotateByQuat(pose.orientation, local));
  return {
    fixed: std.select(d.f32(0), d.f32(1), (body.flags & d.u32(BODY_FLAG_STATIC)) !== 0),
    normal: rotateByQuat(
      pose.orientation,
      rotateByQuat(shape.localOrientation, cubeNormals.$[u32DivMod(vertexIndex, d.u32(6)).x]),
    ),
    position: std.mul(motionViewBindings.$.view[d.u32(0)].viewProjection, d.vec4f(world, 1)),
  };
});

/** Render the GPU-resident Actor palette with one immutable mesh and one instanced draw. */
export const createMotionRenderer = (input: {
  /** The base-colour array size as width, height, layers; one white texel when the character brought none. */
  readonly baseColorSize: readonly [number, number, number];
  readonly bodies: MotionBodies;
  readonly phase: string;
  readonly camera: MotionCamera;
  readonly environment: EnvironmentRenderProgram;
  readonly presentation: MotionPresentation;
  readonly program: MotionRenderProgram;
  readonly skin: SkinPalette;
  readonly surface: ReturnType<typeof createMotionSurface>;
}): SystemGraphCapability => {
  const environmentFragment = tgpu.fragmentFn({
    in: { color: d.interpolate("flat", d.vec4f), normal: d.vec3f },
    out: SceneColor,
  })(({ color, normal }) => {
    "use gpu";
    const light = std.max(
      std.dot(
        std.normalize(normal),
        std.normalize(motionViewBindings.$.view[d.u32(0)].lightDirection.xyz),
      ),
      d.f32(0),
    );
    const intensity =
      d.f32(input.program.ambientIntensity) + light * d.f32(input.program.directionalIntensity);
    const output = d.vec4f(color.x * intensity, color.y * intensity, color.z * intensity, color.w);
    return { capture: output, presentation: output };
  });
  const environmentFamily = defineShaderFamily({
    id: "environment-entities",
    variants: {
      color: {
        pipeline: {
          depthStencil: { depthCompare: "less" as const, depthWriteEnabled: true },
          fragment: environmentFragment,
          primitive: { cullMode: "back" as const },
          vertex: environmentVertex,
        },
      },
    },
  });
  // A character brought no image when its array is one white texel; then the actor's own colour
  // stands in for a base colour it does not have.
  const baseColorWeight = Number(input.baseColorSize[0] > 1 || input.baseColorSize[1] > 1);
  const actorFragment = tgpu.fragmentFn({
    in: {
      actor: d.interpolate("flat", d.u32),
      material: d.interpolate("flat", d.u32),
      normal: d.vec3f,
      uv: d.vec2f,
    },
    out: SceneColor,
  })(({ actor, material, normal, uv }) => {
    "use gpu";
    const surface = std.textureSample(
      skinBindings.$.baseColor,
      skinBindings.$.baseColorSampler,
      uv,
      material,
    );
    const light = std.max(
      std.dot(
        std.normalize(normal),
        std.normalize(motionViewBindings.$.view[d.u32(0)].lightDirection.xyz),
      ),
      d.f32(0),
    );
    const color = std.select(
      d.vec4f(
        input.program.actorColors[1][0],
        input.program.actorColors[1][1],
        input.program.actorColors[1][2],
        input.program.actorColors[1][3],
      ),
      d.vec4f(
        input.program.actorColors[0][0],
        input.program.actorColors[0][1],
        input.program.actorColors[0][2],
        input.program.actorColors[0][3],
      ),
      actor % d.u32(input.program.actorColors.length) === d.u32(0),
    );
    const intensity =
      d.f32(input.program.ambientIntensity) + light * d.f32(input.program.directionalIntensity);
    const albedo = std.add(
      std.mul(color, d.f32(1 - baseColorWeight)),
      std.mul(surface, d.f32(baseColorWeight)),
    );
    const output = d.vec4f(
      albedo.x * intensity,
      albedo.y * intensity,
      albedo.z * intensity,
      albedo.w,
    );
    return { capture: output, presentation: output };
  });
  const actorFamily = defineShaderFamily({
    id: "motion-actors",
    variants: {
      color: {
        pipeline: {
          depthStencil: { depthCompare: "less" as const, depthWriteEnabled: true },
          fragment: actorFragment,
          primitive: { cullMode: input.program.actorCullMode },
          vertex,
        },
      },
    },
  });
  const floorVertex = tgpu.vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex },
    out: { position: d.builtin.position },
  })(({ vertexIndex }) => {
    "use gpu";
    let x = d.f32(-input.program.ground.halfExtent);
    let z = d.f32(-input.program.ground.halfExtent);
    if (vertexIndex === d.u32(1) || vertexIndex === d.u32(2) || vertexIndex === d.u32(4)) {
      x = d.f32(input.program.ground.halfExtent);
    }
    if (vertexIndex === d.u32(2) || vertexIndex === d.u32(4) || vertexIndex === d.u32(5)) {
      z = d.f32(input.program.ground.halfExtent);
    }
    const origin = motionViewBindings.$.view[d.u32(0)].groundOrigin;
    return {
      position: std.mul(
        motionViewBindings.$.view[d.u32(0)].viewProjection,
        d.vec4f(x + origin.x, origin.y, z + origin.z, 1),
      ),
    };
  });
  const floorFamily = defineShaderFamily({
    id: "motion-floor",
    variants: {
      color: {
        pipeline: {
          depthStencil: { depthCompare: "less" as const, depthWriteEnabled: true },
          fragment: tgpu.fragmentFn({ out: SceneColor })(() => {
            const output = d.vec4f(
              input.program.ground.color[0],
              input.program.ground.color[1],
              input.program.ground.color[2],
              input.program.ground.color[3],
            );
            return { capture: output, presentation: output };
          }),
          vertex: floorVertex,
        },
      },
    },
  });
  // Loose bodies read as warm crates; fixed obstacles as cool steel.
  const crateFragment = tgpu.fragmentFn({
    in: { fixed: d.interpolate("flat", d.f32), normal: d.vec3f },
    out: SceneColor,
  })(({ normal, fixed }) => {
    "use gpu";
    const light = std.max(
      std.dot(
        std.normalize(normal),
        std.normalize(motionViewBindings.$.view[d.u32(0)].lightDirection.xyz),
      ),
      d.f32(0),
    );
    const intensity =
      d.f32(input.program.ambientIntensity) + light * d.f32(input.program.directionalIntensity);
    const albedo = std.mix(d.vec3f(0.82, 0.42, 0.16), d.vec3f(0.35, 0.4, 0.48), fixed);
    const output = d.vec4f(std.mul(albedo, intensity), 1);
    return { capture: output, presentation: output };
  });
  const crateFamily = defineShaderFamily({
    id: "motion-crates",
    variants: {
      color: {
        pipeline: {
          depthStencil: { depthCompare: "less" as const, depthWriteEnabled: true },
          fragment: crateFragment,
          primitive: { cullMode: "back" as const },
          vertex: crateVertex,
        },
      },
    },
  });
  return defineGraphCapability({
    id: MOTION_RENDERER_ID,
    needs: {
      depth: input.surface.attachment,
      paletteColumns: input.skin.columns,
      physicsBodies: { capability: PHYSICS_ID, export: "bodies" },
      physicsBodiesPrevious: { capability: PHYSICS_ID, export: "bodies", version: "previous" },
      physicsShapes: { capability: PHYSICS_ID, export: "shapes" },
      samples: input.presentation.samples,
      view: input.camera.view,
    },
    exports: { capture: "capture" },
    resources: {
      capture: res.renderTarget({
        format: "rgba8unorm",
        lifetime: "persistent",
        schema: d.texture2d(d.f32),
        size: "presentation",
      }),
      ...(input.environment.instances.length === 0
        ? {}
        : {
            environmentIndices: res.storageBuffer({
              capacity: input.environment.indices.length,
              initial: input.environment.indices,
              lifetime: "persistent",
              schema: d.u32,
            }),
            environmentInstances: res.storageBuffer({
              capacity: input.environment.instances.length,
              initial: input.environment.instances.map((instance) =>
                EnvironmentInstanceRow({
                  color: d.vec4f(...instance.color),
                  geometry: instance.geometry,
                  normalFromLocal: instance.normalFromLocal,
                  pad0: 0,
                  pad1: 0,
                  pad2: 0,
                  worldFromLocal: instance.worldFromLocal,
                }),
              ),
              lifetime: "persistent",
              schema: EnvironmentInstanceRow,
            }),
            environmentRecords: res.storageBuffer({
              capacity: input.environment.records.length,
              initial: input.environment.records.map((record) => IndexedGeometryRecordRow(record)),
              lifetime: "persistent",
              schema: IndexedGeometryRecordRow,
            }),
            environmentVertices: res.storageBuffer({
              capacity: input.environment.vertices.length,
              initial: input.environment.vertices,
              lifetime: "persistent",
              schema: GeometryVertexRow,
            }),
          }),
      indices: res.storageBuffer({
        capacity: input.program.indices.length,
        initial: input.program.indices,
        lifetime: "persistent",
        schema: d.u32,
      }),
      skin: res.uniform({
        initial: Skin({ jointCount: input.program.jointCount }),
        schema: Skin,
      }),
      baseColor: res.asyncTexture({
        format: "rgba8unorm",
        schema: CharacterTexture,
        size: [input.baseColorSize[0], input.baseColorSize[1], input.baseColorSize[2]],
      }),
      baseColorSampler: res.sampler({
        binding: "filtering",
        descriptor: {
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: "linear",
          minFilter: "linear",
        },
      }),
      vertices: res.storageBuffer({
        capacity: input.program.vertices.length,
        initial: input.program.vertices.map((source) =>
          SkinnedVertex({
            joints0: d.vec4u(...source.joints0),
            joints1: d.vec4u(...source.joints1),
            normal: d.vec4f(...source.normal, 0),
            position: d.vec4f(...source.position, 1),
            uv: d.vec4f(source.uv[0], source.uv[1], source.material, 0),
            weights0: d.vec4f(...source.weights0),
            weights1: d.vec4f(...source.weights1),
          }),
        ),
        lifetime: "persistent",
        schema: SkinnedVertex,
      }),
    },
    renderStages: [
      defineRenderStage({
        // Attachment policy and the six-vertex ground topology are renderer invariants. Authored
        // appearance, orientation, and extent enter only through MotionRenderProgram.
        colors: [
          {
            clear: input.program.background,
            loadOp: "clear",
            name: "capture",
            target: { resource: "capture" },
          },
          {
            clear: input.program.background,
            loadOp: "clear",
            name: "presentation",
            target: "presentation",
          },
        ],
        depthStencil: {
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
          resource: "depth",
        },
        id: "scene",
        items: [
          ...(input.program.ground.visible
            ? [
                {
                  bindGroups: [{ bindings: { view: "view" }, layout: motionViewBindings }],
                  draws: [{ vertices: 6 }],
                  family: floorFamily,
                  id: "floor",
                },
              ]
            : []),
          ...(input.environment.instances.length === 0
            ? []
            : [
                {
                  bindGroups: [
                    { bindings: { view: "view" }, layout: motionViewBindings },
                    {
                      bindings: {
                        indices: "environmentIndices",
                        instances: "environmentInstances",
                        records: "environmentRecords",
                        vertices: "environmentVertices",
                      },
                      layout: environmentBindings,
                    },
                  ],
                  draws: [
                    {
                      instances: input.environment.instances.length,
                      vertices: input.environment.maxIndexCount,
                    },
                  ],
                  family: environmentFamily,
                  id: "environment",
                },
              ]),
          {
            bindGroups: [
              { bindings: { view: "view" }, layout: motionViewBindings },
              {
                bindings: {
                  baseColor: "baseColor",
                  baseColorSampler: "baseColorSampler",
                  indices: "indices",
                  paletteColumns: "paletteColumns",
                  samples: "samples",
                  skin: "skin",
                  vertices: "vertices",
                },
                layout: skinBindings,
              },
            ],
            draws: [{ instances: input.skin.actorCount, vertices: input.program.indices.length }],
            family: actorFamily,
            id: "actors",
          },
          {
            bindGroups: [
              { bindings: { view: "view" }, layout: motionViewBindings },
              {
                bindings: {
                  bodies: "physicsBodies",
                  previousBodies: "physicsBodiesPrevious",
                  shapes: "physicsShapes",
                },
                layout: crateBindings,
              },
            ],
            draws: [{ instances: input.bodies.bodyCount, vertices: BOX_VERTEX_COUNT }],
            family: crateFamily,
            id: "crates",
          },
        ],
        phase: input.phase,
      }),
    ],
  });
};
