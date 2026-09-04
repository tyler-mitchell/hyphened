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

const listed = (names: readonly string[]): string =>
  names.length > 8 ? `${names.slice(0, 8).join(", ")} and ${String(names.length - 8)} more` : names.join(", ");

/**
 * Every way a rig differs from the motion skeleton, named. A rig that cannot drive the model is the
 * ordinary case when a character comes from elsewhere, and the difference is the whole diagnosis.
 */
const differences = (input: {
  readonly embodiment: EmbodimentRestPose["skeleton"];
  readonly motion: MotionSkeletonDefinition;
}): readonly string[] => {
  const rigJoints = input.embodiment.jointNames;
  const motionJoints = input.motion.jointNames;
  const missing = motionJoints.filter((name) => !rigJoints.includes(name));
  const extra = rigJoints.filter((name) => !motionJoints.includes(name));
  const reordered = motionJoints.filter(
    (name, joint) => rigJoints.includes(name) && rigJoints[joint] !== name,
  );
  const reparented = motionJoints.filter(
    (name, joint) =>
      rigJoints[joint] === name &&
      input.embodiment.parentJointIndices[joint] !== input.motion.parentJointIndices[joint],
  );
  return [
    ...(missing.length === 0 ? [] : [`missing ${String(missing.length)} joints (${listed(missing)})`]),
    ...(extra.length === 0 ? [] : [`carries ${String(extra.length)} joints the model has no channel for (${listed(extra)})`]),
    ...(missing.length > 0 || extra.length > 0 || reordered.length === 0
      ? []
      : [`orders ${String(reordered.length)} joints differently (${listed(reordered)})`]),
    ...(reparented.length === 0
      ? []
      : [`parents ${String(reparented.length)} joints differently (${listed(reparented)})`]),
  ];
};

/** Admit the zero-retargeting case used by character skins authored to the canonical skeleton. */
export const bindMotionRig = <Rig extends EmbodimentRig>(input: {
  readonly motionSkeleton: MotionSkeletonDefinition;
  readonly rig: Rig;
}):
  | { readonly status: "available"; readonly value: MotionRigBinding<Rig> }
  | { readonly status: "unavailable"; readonly reason: string } => {
  const embodimentSkeleton = input.rig.restPose.skeleton;
  const difference = differences({
    embodiment: embodimentSkeleton,
    motion: input.motionSkeleton,
  });
  if (difference.length > 0 || embodimentSkeleton.rootJointIndex !== input.motionSkeleton.rootJointIndex) {
    const rootDifference =
      embodimentSkeleton.rootJointIndex === input.motionSkeleton.rootJointIndex
        ? []
        : [`roots at joint ${String(embodimentSkeleton.rootJointIndex)} rather than ${String(input.motionSkeleton.rootJointIndex)}`];
    return {
      status: "unavailable",
      reason: `this rig cannot drive ${input.motionSkeleton.sourceTarget}: it ${[...difference, ...rootDifference].join("; it ")}`,
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
