import { importGlb, type GltfMatrix } from "webgpu-engine";
import type { MotionSkeletonDefinition } from "webgpu-engine/motion";

import { refuseEmbodimentAsset } from "./errors";
import { admitEmbodimentRestPose } from "./skeleton";
import type { HumanoidRigAssets } from "./skin";

const fail = (reason: string): never => refuseEmbodimentAsset("rig", reason);

const bareJointName = (name: string): string => name.slice(name.lastIndexOf(":") + 1);

const UNREAL_JOINT_NAMES: Readonly<Record<string, string>> = {
  Hips: "pelvis",
  Spine: "spine_01",
  Spine1: "spine_02",
  Spine2: "spine_03",
  Neck: "neck_01",
  Head: "head",
  LeftShoulder: "clavicle_l",
  LeftArm: "upperarm_l",
  LeftForeArm: "lowerarm_l",
  LeftHand: "hand_l",
  LeftHandThumb1: "thumb_01_l",
  RightShoulder: "clavicle_r",
  RightArm: "upperarm_r",
  RightForeArm: "lowerarm_r",
  RightHand: "hand_r",
  RightHandThumb1: "thumb_01_r",
  LeftUpLeg: "thigh_l",
  LeftLeg: "calf_l",
  LeftFoot: "foot_l",
  LeftToeBase: "ball_l",
  RightUpLeg: "thigh_r",
  RightLeg: "calf_r",
  RightFoot: "foot_r",
  RightToeBase: "ball_r",
};

const bindPosition = (matrix: GltfMatrix): readonly [number, number, number] => {
  const [b00, b01, b02, , b10, b11, b12, , b20, b21, b22, , u0, u1, u2] = matrix;
  const c00 = b11 * b22 - b12 * b21;
  const c01 = b12 * b20 - b10 * b22;
  const c02 = b10 * b21 - b11 * b20;
  const determinant = b00 * c00 + b01 * c01 + b02 * c02;
  if (!Number.isFinite(determinant) || determinant === 0) {
    return fail("a joint's inverse bind matrix is singular");
  }
  const inverse = [
    c00, b02 * b21 - b01 * b22, b01 * b12 - b02 * b11,
    c01, b00 * b22 - b02 * b20, b02 * b10 - b00 * b12,
    c02, b01 * b20 - b00 * b21, b00 * b11 - b01 * b10,
  ].map((value) => value / determinant);
  return [
    -(inverse[0]! * u0 + inverse[3]! * u1 + inverse[6]! * u2),
    -(inverse[1]! * u0 + inverse[4]! * u1 + inverse[7]! * u2),
    -(inverse[2]! * u0 + inverse[5]! * u1 + inverse[8]! * u2),
  ];
};

export type GltfCharacter = {
  readonly height: number;
  readonly jointNames: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly reparented: ReadonlyArray<string>;
  readonly rig?: HumanoidRigAssets;
  readonly undrivable: ReadonlyArray<string>;
};

const drivenBy = (input: {
  readonly joints: ReadonlyArray<{ readonly parent: number }>;
  readonly motionOf: ReadonlyArray<number>;
}): ReadonlyArray<number> => {
  const climb = (joint: number, walked: number): number => {
    if (input.motionOf[joint]! >= 0) return input.motionOf[joint]!;
    const parent = input.joints[joint]!.parent;
    if (parent < 0 || walked > input.joints.length) return 0;
    return climb(parent, walked + 1);
  };
  return input.joints.map((_unused, joint) => climb(joint, 0));
};

const foldInfluences = (input: {
  readonly driven: ReadonlyArray<number>;
  readonly joints: readonly [number, number, number, number];
  readonly weights: readonly [number, number, number, number];
}): { readonly joints: readonly number[]; readonly weights: readonly number[] } => {
  const gathered = input.joints.reduce<ReadonlyMap<number, number>>((total, joint, influence) => {
    const motionJoint = input.driven[joint] ?? 0;
    const weight = input.weights[influence] ?? 0;
    return weight <= 0 ? total : new Map(total).set(motionJoint, (total.get(motionJoint) ?? 0) + weight);
  }, new Map());
  const ordered = [...gathered].toSorted(([, left], [, right]) => right - left).slice(0, 4);
  const sum = ordered.reduce((total, [, weight]) => total + weight, 0);
  return {
    joints: Array.from({ length: 4 }, (_unused, slot) => ordered[slot]?.[0] ?? 0),
    weights: Array.from({ length: 4 }, (_unused, slot) =>
      sum > 0 ? (ordered[slot]?.[1] ?? 0) / sum : slot === 0 ? 1 : 0,
    ),
  };
};

export const loadGltfCharacter = async (input: {
  readonly motionSkeleton: MotionSkeletonDefinition;
  /** The model's own stature in metres; the character is scaled to stand this tall. */
  readonly targetHeight: number;
  readonly uri: string;
}): Promise<GltfCharacter> => {
  const asset = await importGlb({
    materials: "base-color-lit",
    skinning: "admit",
    uri: input.uri,
  }).catch((cause: unknown) => fail(`${input.uri} could not be read: ${String(cause)}`));
  const skinIndex = asset.instances.find(({ skin: bound }) => bound !== undefined)?.skin;
  const skin = skinIndex === undefined ? undefined : asset.skins[skinIndex];
  if (skin === undefined) return fail(`${input.uri} carries no skinned character`);
  const jointNames = skin.joints.map(({ name }) => bareJointName(name));
  const elevations = skin.inverseBindMatrices.map((matrix) => bindPosition(matrix)[1]);
  const height = Math.max(...elevations) - Math.min(...elevations);
  const motionJoints = input.motionSkeleton.jointNames;
  const parentJointIndices = input.motionSkeleton.parentJointIndices;
  const lowered = jointNames.map((name) => name.toLowerCase());
  const jointOf = motionJoints.map((name) => {
    const direct = jointNames.indexOf(name);
    if (direct >= 0) return direct;
    const unreal = UNREAL_JOINT_NAMES[name];
    return unreal === undefined ? -1 : lowered.indexOf(unreal);
  });
  const missing = motionJoints.filter((_unused, joint) => jointOf[joint]! < 0);
  const climb = (joint: number, walked: number): number => {
    if (jointOf[joint]! >= 0) return jointOf[joint]!;
    const parent = parentJointIndices[joint]!;
    return parent < 0 || walked > motionJoints.length ? -1 : climb(parent, walked + 1);
  };
  const boundTo = motionJoints.map((_unused, joint) => climb(joint, 0));
  const undrivable = motionJoints.filter((_unused, joint) => boundTo[joint]! < 0);
  const reparented =
    undrivable.length > 0
      ? []
      : motionJoints.filter((_unused, joint) => {
          const parent = parentJointIndices[joint]!;
          const own = jointOf[joint]!;
          return own >= 0 && parent >= 0 && skin.joints[own]!.parent !== boundTo[parent]!;
        });
  if (undrivable.length > 0) return { height, jointNames, missing, reparented, undrivable };
  // glTF declares no unit: Mixamo exports centimetres, Quaternius metres. Measure the span of the
  // joints the model actually drives, so the scaled rest pose lands on the model's own stature; the
  // file's full skeleton spans further, through fingers and toes the model has no joint for.
  const bound = boundTo.map((joint) => bindPosition(skin.inverseBindMatrices[joint]!)[1]!);
  const boundHeight = Math.max(...bound) - Math.min(...bound);
  const scale = boundHeight > 0 ? input.targetHeight / boundHeight : 1;
  const restPose = admitEmbodimentRestPose({
    jointNames: [...motionJoints],
    jointPositions: Float32Array.from(
      boundTo.flatMap((joint) =>
        bindPosition(skin.inverseBindMatrices[joint]!).map((axis) => axis * scale),
      ),
    ),
    parentJointIndices: [...parentJointIndices],
  });

  const parts = asset.instances.flatMap((instance) => {
    const record = asset.geometry.packed.records[instance.geometry];
    const influences = asset.geometry.skinning[instance.geometry];
    if (instance.skin !== skinIndex || record === undefined || influences === undefined) return [];
    const next = asset.geometry.packed.records[instance.geometry + 1];
    const after = next?.vertexOffset ?? asset.geometry.vertices.length;
    return [
      {
        geometry: instance.geometry,
        influences,
        indices: asset.geometry.packed.indices.slice(
          record.indexOffset,
          record.indexOffset + record.indexCount,
        ),
        rows: asset.geometry.vertices.slice(record.vertexOffset, after),
      },
    ];
  });
  if (parts.length === 0) return fail(`${input.uri} has a skeleton but no skinned mesh`);
  // Each material becomes one base-colour array layer, so hair and eyes sample their own image
  // instead of a patch of the body. Their UVs run past one and rely on repeat wrapping, which an
  // atlas cannot preserve.
  const partMaterials = parts.map(
    ({ geometry }) => asset.materials.geometryMaterials[geometry] ?? -1,
  );
  const layerMaterials = [...new Set(partMaterials)];
  const images = layerMaterials.map(
    (material) => asset.textures[asset.materials.configs[material]?.baseColorTexture ?? -1],
  );
  const baseColors = images.filter((image) => image !== undefined);
  if (baseColors.length > 0 && baseColors.length !== images.length) {
    return fail(`${input.uri} mixes meshes that carry a base-colour image with meshes that do not`);
  }
  const materials = Uint32Array.from(
    parts.flatMap(({ rows: part }, at) => part.map(() => layerMaterials.indexOf(partMaterials[at]!))),
  );
  const motionOf = skin.joints.map((_unused, joint) => jointOf.indexOf(joint));
  const driven = drivenBy({ joints: skin.joints, motionOf });
  const rows = parts.flatMap(({ rows: part }) => part);
  const folded = parts.flatMap(({ influences, rows: part }) =>
    part.map((_unused, vertex) =>
      foldInfluences({
        driven,
        joints: influences.joints[vertex] ?? [0, 0, 0, 0],
        weights: influences.weights[vertex] ?? [1, 0, 0, 0],
      }),
    ),
  );
  const indices = parts.flatMap((part, at) => {
    const base = parts.slice(0, at).reduce((total, { rows: earlier }) => total + earlier.length, 0);
    return part.indices.map((index) => index + base);
  });
  return {
    height,
    jointNames,
    missing,
    reparented,
    undrivable,
    rig: {
      restPose,
      skin: {
        bindRootPosition: bindPosition(
          skin.inverseBindMatrices[boundTo[input.motionSkeleton.rootJointIndex]!]!,
        ).map((axis) => axis * scale) as unknown as readonly [number, number, number],
        indices: Uint32Array.from(indices),
        influencesPerVertex: 4,
        // An inverse bind matrix is the inverse of a rigid transform, so scaling the character
        // scales its translation column and leaves its rotation alone.
        inverseBindMatrices: Float32Array.from(
          boundTo.flatMap((joint) =>
            [...skin.inverseBindMatrices[joint]!].map((value, at) =>
              at >= 12 && at <= 14 ? value * scale : value,
            ),
          ),
        ),
        jointCount: motionJoints.length,
        jointIndices: Uint32Array.from(folded.flatMap(({ joints }) => joints)),
        jointWeights: Float32Array.from(folded.flatMap(({ weights }) => weights)),
        normals: Float32Array.from(rows.flatMap(({ normal }) => [normal.x, normal.y, normal.z])),
        positions: Float32Array.from(
          rows.flatMap(({ position }) => [
            position.x * scale,
            position.y * scale,
            position.z * scale,
          ]),
        ),
        uvs: Float32Array.from(rows.flatMap(({ uv }) => [uv.x, uv.y])),
        vertexCount: rows.length,
        ...(baseColors.length === 0 ? {} : { baseColors, materials }),
      },
    },
  };
};
