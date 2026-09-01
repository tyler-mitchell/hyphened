export interface EmbodimentSkeleton {
  readonly jointCount: number;
  readonly jointNames: ReadonlyArray<string>;
  readonly parentJointIndices: ReadonlyArray<number>;
  readonly rootJointIndex: number;
}

/** Neutral geometry owned by the physical rig, independent of learned-motion tensor semantics. */
export interface EmbodimentRestPose {
  readonly jointPositions: Float32Array;
  readonly skeleton: EmbodimentSkeleton;
}

export const admitEmbodimentRestPose = (input: {
  readonly jointPositions: Float32Array;
  readonly jointNames: ReadonlyArray<string>;
  readonly parentJointIndices: ReadonlyArray<number>;
}): EmbodimentRestPose => {
  const jointCount = input.jointNames.length;
  if (jointCount === 0 || input.parentJointIndices.length !== jointCount) {
    throw new RangeError("embodiment rig requires one parent and name for every joint");
  }
  const rootJointIndex = input.parentJointIndices.indexOf(-1);
  if (
    rootJointIndex < 0 ||
    input.parentJointIndices.lastIndexOf(-1) !== rootJointIndex ||
    input.parentJointIndices.some(
      (parent, joint) =>
        !Number.isSafeInteger(parent) ||
        (joint === rootJointIndex ? parent !== -1 : parent < 0 || parent >= joint),
    )
  ) {
    throw new RangeError("embodiment rig requires one parent-before-child skeleton hierarchy");
  }
  if (
    input.jointNames.some((name) => name.length === 0) ||
    new Set(input.jointNames).size !== jointCount
  ) {
    throw new RangeError("embodiment rig requires unique non-empty joint names");
  }
  if (
    input.jointPositions.length !== jointCount * 3 ||
    input.jointPositions.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError("embodiment rest pose requires one finite xyz position per joint");
  }
  return {
    jointPositions: input.jointPositions,
    skeleton: {
      jointCount,
      jointNames: [...input.jointNames],
      parentJointIndices: [...input.parentJointIndices],
      rootJointIndex,
    },
  };
};
