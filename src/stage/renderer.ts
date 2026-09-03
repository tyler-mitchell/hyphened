import tgpu, { d, std } from "typegpu";
import {
  Body,
  BODY_FLAG_ALIVE,
  BODY_FLAG_HIDDEN,
  BODY_FLAG_STATIC,
  capabilityResourceKey,
  defineGraphCapability,
  defineRenderStage,
  defineShaderFamily,
  interpolateBodyPose,
  res,
  rotateByQuat,
  Shape,
  type SystemGraphCapability,
} from "webgpu-engine";

import { u32DivMod } from "learned-motion/gpu";
import { PHYSICS_ID, type MotionBodies } from "./bodies";
import type { MotionCamera } from "./camera";
import { motionViewBindings, MotionPoseSample, type MotionRenderProgram } from "learned-motion/schema";
import type { MotionPresentation } from "learned-motion/motion/presentation";
import type { SkinPalette } from "./skin";
import type { createMotionSurface } from "./surface";

export const MOTION_RENDERER_ID = "motion-renderer";
export const MOTION_CAPTURE_RESOURCE_KEY = capabilityResourceKey({
  capabilityId: MOTION_RENDERER_ID,
  localName: "capture",
});

const SkinnedVertex = d.struct({
  joints0: d.vec4u,
  joints1: d.vec4u,
  normal: d.vec4f,
  position: d.vec4f,
  weights0: d.vec4f,
  weights1: d.vec4f,
});
const Skin = d.struct({ jointCount: d.u32 });
const SceneColor = {
  capture: d.location(0, d.vec4f),
  presentation: d.location(1, d.vec4f),
} as const;
const skinBindings = tgpu.bindGroupLayout({
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
    normal: d.vec3f,
    position: d.builtin.position,
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const source = skinBindings.$.indices[vertexIndex];
  const position = std.mul(
    motionViewBindings.$.view[d.u32(0)].viewProjection,
    skinVector(instanceIndex, source, d.vec4f(skinBindings.$.vertices[source].position.xyz, 1)),
  );
  return {
    actor: instanceIndex,
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
  readonly bodies: MotionBodies;
  readonly phase: string;
  readonly camera: MotionCamera;
  readonly presentation: MotionPresentation;
  readonly program: MotionRenderProgram;
  readonly skin: SkinPalette;
  readonly surface: ReturnType<typeof createMotionSurface>;
}): SystemGraphCapability => {
  const actorFragment = tgpu.fragmentFn({
    in: { actor: d.interpolate("flat", d.u32), normal: d.vec3f },
    out: SceneColor,
  })(({ actor, normal }) => {
    "use gpu";
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
    const output = d.vec4f(color.x * intensity, color.y * intensity, color.z * intensity, color.w);
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
    in: { normal: d.vec3f, fixed: d.interpolate("flat", d.f32) },
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
      vertices: res.storageBuffer({
        capacity: input.program.vertices.length,
        initial: input.program.vertices.map((source) =>
          SkinnedVertex({
            joints0: d.vec4u(...source.joints0),
            joints1: d.vec4u(...source.joints1),
            normal: d.vec4f(...source.normal, 0),
            position: d.vec4f(...source.position, 1),
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
          {
            bindGroups: [
              { bindings: { view: "view" }, layout: motionViewBindings },
              {
                bindings: {
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
