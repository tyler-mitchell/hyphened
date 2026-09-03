import { type } from "arktype";

import { MotionSkeletonRestPose, type MotionSkeletonDefinition } from "webgpu-engine/motion";
import type { EmbodimentRestPose } from "./skeleton";

/** Minimal physical-rig surface required to prove direct compatibility with learned motion. */
export interface EmbodimentRig {
  readonly restPose: EmbodimentRestPose;
}

/**
 * A direct binding between one canonical learned-motion skeleton and one physical character rig.
 * Different meshes may share this binding contract; mesh geometry and collision shapes are not
 * part of pose semantics. Rigs with different topology require an explicit retargeting product
 * rather than being admitted through joint-count coincidence.
 */
export interface MotionRigBinding<Rig extends EmbodimentRig = EmbodimentRig> {
  readonly motionRestPose: MotionSkeletonRestPose;
  readonly rig: Rig;
}

const exactJointOrder = (input: {
  readonly embodiment: EmbodimentRestPose["skeleton"];
  readonly motion: MotionSkeletonDefinition;
}): boolean =>
  input.motion.jointNames.length === input.embodiment.jointNames.length &&
  input.motion.jointNames.every((name, joint) => input.embodiment.jointNames[joint] === name);

const exactHierarchy = (input: {
  readonly embodiment: EmbodimentRestPose["skeleton"];
  readonly motion: MotionSkeletonDefinition;
}): boolean =>
  input.motion.parentJointIndices.length === input.embodiment.parentJointIndices.length &&
  input.motion.parentJointIndices.every(
    (parent, joint) => input.embodiment.parentJointIndices[joint] === parent,
  );

/** Admit the zero-retargeting case used by character skins authored to the canonical skeleton. */
export const bindMotionRig = <Rig extends EmbodimentRig>(input: {
  readonly motionSkeleton: MotionSkeletonDefinition;
  readonly rig: Rig;
}):
  | { readonly status: "available"; readonly value: MotionRigBinding<Rig> }
  | { readonly status: "unavailable"; readonly reason: string } => {
  const embodimentSkeleton = input.rig.restPose.skeleton;
  if (
    embodimentSkeleton.jointCount !== input.motionSkeleton.jointCount ||
    embodimentSkeleton.rootJointIndex !== input.motionSkeleton.rootJointIndex ||
    !exactJointOrder({ embodiment: embodimentSkeleton, motion: input.motionSkeleton }) ||
    !exactHierarchy({ embodiment: embodimentSkeleton, motion: input.motionSkeleton })
  ) {
    return {
      status: "unavailable",
      reason: `embodiment rig is not directly compatible with ${input.motionSkeleton.sourceTarget}`,
    };
  }
  const motionRestPose = MotionSkeletonRestPose({
    jointPositions: input.rig.restPose.jointPositions.slice(),
    skeleton: input.motionSkeleton,
  });
  if (motionRestPose instanceof type.errors) {
    return { status: "unavailable", reason: motionRestPose.summary };
  }
  return {
    status: "available",
    value: { motionRestPose, rig: input.rig },
  };
};
