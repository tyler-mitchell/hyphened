import tgpu, { d, std } from "typegpu";
import {
  capabilityExport,
  createPhysicsCapability,
  defineComputePass,
  defineGraphCapability,
  defineResourceBindings,
  KinematicBodyUpdate,
  KinematicUpdateParams,
  res,
  TimelineClockUniform,
  type PhysicsBodyInit,
  type SystemCapabilityExportReference,
  type SystemGraphCapability,
  type UniformResourceSpec,
} from "webgpu-engine";

import {
  actorProductFrame,
  MOTION_FRAMES_PER_SECOND,
  MotionActorBinding,
  MotionProductFrameSource,
  productFrameCommitted,
  quaternionFromColumns,
  type MotionPresentationProgram,
  type MotionProduct,
  type MotionSubjectDefinition,
} from "webgpu-engine/motion";
import {
  BODY_POOL_SPARE,
  PHYSICS_RETIRE_SCHEDULE,
  PHYSICS_SPAWN_SCHEDULE,
  PHYSICS_STATIC_UPDATE_SCHEDULE,
  PHYSICS_SUBSTEP_CLOCK,
} from "../schema";

export const PHYSICS_ID = "physics";
/** An upright box around the pelvis: the collider a moving body presents to loose objects. */
const CHARACTER_HALF_EXTENTS = [0.22, 0.85, 0.22] as const;
const SLAB_HALF_EXTENT = 200;

export interface MotionBodies {
  /**
   * Body table rows, in order: one kinematic box per actor, the ground slab, the scene's loose
   * bodies, the spare pool rows, then the fixed bodies as static colliders with their spare rows.
   * Rows without a body draw nothing.
   */
  readonly bodyCount: number;
  readonly capabilities: ReadonlyArray<SystemGraphCapability>;
}

/** A reserved static collider row with no extent, far below the slab, until a fixed body takes it. */
const FREE_STATIC_COLLIDER = { halfExtents: [0, 0, 0], position: [0, -1000, 0] } as const;

/**
 * Tier one of motion and physics: each actor's learned pose drives a kinematic box that the solver
 * sees as a moving collider. The solver owns every contact and every dynamic response; the actor
 * owns only its trajectory. The scene's loose bodies are pool rows; its fixed bodies are static
 * colliders, which the engine moves, resizes, and clears in place through one update schedule.
 */
export const createMotionBodies = (input: {
  readonly bodies: {
    readonly fixed: ReadonlyArray<PhysicsBodyInit>;
    readonly loose: ReadonlyArray<PhysicsBodyInit>;
  };
  readonly clock: SystemCapabilityExportReference<UniformResourceSpec<typeof TimelineClockUniform>>;
  readonly ground: { readonly height: number };
  readonly id: string;
  readonly phase: string;
  readonly product: MotionProduct;
  readonly program: MotionPresentationProgram;
  readonly subjects: ReadonlyArray<MotionSubjectDefinition>;
}): MotionBodies => {
  const actorCount = input.subjects.length;
  // The actor colliders and the slab are hidden: the actor's visual is its skin and the slab's is
  // the floor. The scene's bodies draw from the body table.
  const rows: PhysicsBodyInit[] = [
    ...input.subjects.map(({ worldOffset }) => ({
      halfExtents: CHARACTER_HALF_EXTENTS,
      hidden: true,
      position: [
        worldOffset[0],
        worldOffset[1] + CHARACTER_HALF_EXTENTS[1],
        worldOffset[2],
      ] as const,
    })),
    {
      halfExtents: [SLAB_HALF_EXTENT, 0.5, SLAB_HALF_EXTENT],
      hidden: true,
      position: [0, input.ground.height - 0.5, 0],
    },
    ...input.bodies.loose,
  ];
  const capacity = rows.length + BODY_POOL_SPARE;
  const colliders = [
    ...input.bodies.fixed.map(({ halfExtents, position }) => ({ halfExtents, position })),
    ...Array.from({ length: BODY_POOL_SPARE }, () => FREE_STATIC_COLLIDER),
  ];
  const physics = createPhysicsCapability({
    after: input.phase,
    bodies: rows,
    capacity,
    id: PHYSICS_ID,
    iterations: 4,
    kinematics: { capacity: actorCount, source: "device" },
    retires: { capacity: BODY_POOL_SPARE, scheduleKind: PHYSICS_RETIRE_SCHEDULE },
    spawns: { capacity: BODY_POOL_SPARE, scheduleKind: PHYSICS_SPAWN_SCHEDULE },
    staticColliders: {
      colliders,
      updates: { capacity: colliders.length, scheduleKind: PHYSICS_STATIC_UPDATE_SCHEDULE },
    },
    substepClock: PHYSICS_SUBSTEP_CLOCK,
  });
  const producer = defineGraphCapability({
    id: input.id,
    needs: {
      clock: input.clock,
      kinematicParams: capabilityExport({ capability: physics, export: "kinematicParams" }),
      kinematicUpdates: capabilityExport({ capability: physics, export: "kinematicUpdates" }),
      localRotationColumns: input.product.localRotationColumns,
      rootPositions: input.product.rootPositions,
      sources: input.product.sources,
    },
    // The step cannot read a present-moment resource, so the authored actor table is declared
    // here as well; both copies are the same immutable program data.
    resources: {
      actors: res.storageBuffer({
        capacity: input.program.bindings.length,
        initial: input.program.bindings,
        lifetime: "persistent",
        schema: MotionActorBinding,
      }),
    },
    build: ({ needs, resources }) => {
      const io = defineResourceBindings({
        id: `${input.id}/resources`,
        entries: {
          actors: resources.actors,
          clock: needs.clock,
          kinematicParams: { resource: needs.kinematicParams, access: "write" },
          kinematicUpdates: { resource: needs.kinematicUpdates, access: "write" },
          localRotationColumns: needs.localRotationColumns,
          rootPositions: needs.rootPositions,
          sources: needs.sources,
        },
      });
      // At the step, each actor's committed pose for the current frame becomes its collider's
      // pose; a frame not yet published leaves the collider at its rest placement.
      const drive = tgpu
        .computeFn({ in: { gid: d.builtin.globalInvocationId }, workgroupSize: [1, 1, 1] })(
          ({ gid }) => {
            "use gpu";
            if (gid.x > d.u32(0)) return;
            const timelineFrame = std.min(
              io.$.clock.tick,
              d.u32(input.program.frameCount - 1),
            );
            for (let actor = d.u32(0); actor < d.u32(actorCount); actor++) {
              const binding = io.$.actors[actor];
              const frame = actorProductFrame(binding, timelineFrame);
              const sourceFrame = frame.x;
              const slot = sourceFrame % d.u32(input.product.frameCapacity);
              const available =
                frame.y !== d.u32(0) &&
                productFrameCommitted(MotionProductFrameSource(io.$.sources[slot]), sourceFrame);
              const nextSlot = (sourceFrame + d.u32(1)) % d.u32(input.product.frameCapacity);
              const nextAvailable =
                available &&
                frame.z !== d.u32(0) &&
                productFrameCommitted(
                  MotionProductFrameSource(io.$.sources[nextSlot]),
                  sourceFrame + d.u32(1),
                );
              const root = std.add(binding.worldOffset.xyz, io.$.rootPositions[slot].xyz);
              const nextRoot = std.add(
                binding.worldOffset.xyz,
                io.$.rootPositions[nextSlot].xyz,
              );
              const velocity = std.select(
                d.vec3f(),
                std.mul(std.sub(nextRoot, root), d.f32(MOTION_FRAMES_PER_SECOND)),
                nextAvailable,
              );
              const base = slot * d.u32(input.product.jointCount) * d.u32(3);
              const rotation = quaternionFromColumns(
                io.$.localRotationColumns[base],
                io.$.localRotationColumns[base + d.u32(1)],
                io.$.localRotationColumns[base + d.u32(2)],
              );
              const rest = d.vec3f(
                binding.worldOffset.x,
                binding.worldOffset.y + d.f32(CHARACTER_HALF_EXTENTS[1]),
                binding.worldOffset.z,
              );
              io.$.kinematicUpdates[actor] = KinematicBodyUpdate({
                angularVelocity: d.vec3f(),
                orientation: std.select(d.vec4f(0, 0, 0, 1), rotation, available),
                pad0: 0,
                pad1: 0,
                position: std.select(rest, root, available),
                row: actor,
                velocity,
              });
            }
            io.$.kinematicParams[d.u32(0)] = KinematicUpdateParams({
              count: d.u32(actorCount),
              pad0: 0,
              pad1: 0,
              pad2: 0,
            });
          },
        )
        .$name(`${input.id}/drive`);
      return {
        passes: [
          defineComputePass({
            bindGroups: [io],
            dispatch: 1,
            id: "drive",
            phase: input.phase,
            shader: drive,
          }),
        ],
      };
    },
  });
  return { bodyCount: capacity + colliders.length, capabilities: [producer, physics] };
};
