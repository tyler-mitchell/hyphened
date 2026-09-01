import { refuseEmbodimentAsset } from "./errors";

export const humanoidSkinSectionNames = [
  "positions",
  "normals",
  "indices",
  "jointIndices",
  "jointWeights",
  "inverseBindMatrices",
  "neutralJoints",
] as const;

export type HumanoidSkinSectionName = (typeof humanoidSkinSectionNames)[number];

export interface HumanoidSkinSection {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly componentType: "f32" | "u32";
  readonly shape: ReadonlyArray<number>;
}

export interface HumanoidSkinManifest {
  readonly kind: "humanoid-skin@1";
  readonly source: {
    readonly repository: "https://github.com/nv-tlabs/ardy";
    readonly revision: "693f74d13b3d04a0a22ce127ee79c929dd89756b";
    readonly jointsSha256: string;
    readonly skinSha256: string;
  };
  readonly binary: {
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly jointCount: number;
  readonly influencesPerVertex: number;
  readonly jointNames: ReadonlyArray<string>;
  readonly parents: ReadonlyArray<number>;
  readonly sections: Readonly<Record<HumanoidSkinSectionName, HumanoidSkinSection>>;
}

const expectedSource = {
  repository: "https://github.com/nv-tlabs/ardy",
  revision: "693f74d13b3d04a0a22ce127ee79c929dd89756b",
  jointsSha256: "5e1d60cb1935c2ea50c6978848697d83efde5621cbbc287891ddae3ba55dde61",
  skinSha256: "4ed2b1ea33a997d7777a59d74ec2312b52af2276331048c954441f5f44f6e58b",
} as const;

/** Exact physical joint order carried by the released humanoid skin bundle. */
const releasedHumanoidSkeletonTopology = {
  jointNames: [
    "Hips",
    "Spine",
    "Spine1",
    "Spine2",
    "Spine3",
    "Neck",
    "Head",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "RightHandEnd",
    "RightHandThumb1",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "LeftHandEnd",
    "LeftHandThumb1",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
  ],
  parents: [
    -1, 0, 1, 2, 3, 4, 5, 4, 7, 8, 9, 10, 10, 4, 13, 14, 15, 16, 16, 0, 19, 20, 21, 0, 23, 24, 25,
  ],
} as const;

const releasedHumanoidSkinLayout = {
  vertexCount: 9084,
  triangleCount: 18152,
  jointCount: 27,
  influencesPerVertex: 5,
  sections: {
    positions: { componentType: "f32", shape: [9084, 3] },
    normals: { componentType: "f32", shape: [9084, 3] },
    indices: { componentType: "u32", shape: [18152, 3] },
    jointIndices: { componentType: "u32", shape: [9084, 5] },
    jointWeights: { componentType: "f32", shape: [9084, 5] },
    inverseBindMatrices: { componentType: "f32", shape: [27, 4, 4] },
    neutralJoints: { componentType: "f32", shape: [27, 3] },
  } satisfies Record<
    HumanoidSkinSectionName,
    { readonly componentType: "f32" | "u32"; readonly shape: ReadonlyArray<number> }
  >,
} as const;

const aligned = (value: number): number => Math.ceil(value / 16) * 16;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const fail = (reason: string): never => refuseEmbodimentAsset("manifest", reason);

const finiteInteger = (input: { readonly label: string; readonly value: unknown }): number => {
  if (typeof input.value !== "number" || !Number.isSafeInteger(input.value) || input.value < 0) {
    return fail(`${input.label} must be a non-negative safe integer`);
  }
  return input.value;
};

const exactString = <T extends string>(input: {
  readonly expected: T;
  readonly label: string;
  readonly value: unknown;
}): T => {
  if (input.value !== input.expected) {
    return fail(`${input.label} does not identify the pinned humanoid asset`);
  }
  return input.expected;
};

const sha256 = (input: { readonly label: string; readonly value: unknown }): string => {
  if (typeof input.value !== "string" || !/^[a-f0-9]{64}$/.test(input.value)) {
    return fail(`${input.label} must be a lowercase SHA-256 digest`);
  }
  return input.value;
};

const exactShape = (input: {
  readonly expected: ReadonlyArray<number>;
  readonly label: string;
  readonly value: unknown;
}): ReadonlyArray<number> => {
  if (
    !Array.isArray(input.value) ||
    input.value.length !== input.expected.length ||
    input.value.some((dimension, axis) => dimension !== input.expected[axis])
  ) {
    return fail(`${input.label} does not match [${input.expected.join(",")}]`);
  }
  return input.expected;
};

const admitParents = (input: {
  readonly jointCount: number;
  readonly value: unknown;
}): ReadonlyArray<number> => {
  if (!Array.isArray(input.value) || input.value.length !== input.jointCount) {
    return fail(`skeleton parent table must contain ${input.jointCount} joints`);
  }
  // Every non-root parent must precede its child, which admits one rooted acyclic hierarchy
  // without a second mutable traversal or a repaired topology.
  return input.value.map((parent, joint) => {
    if (typeof parent !== "number" || !Number.isSafeInteger(parent)) {
      return fail(`skeleton parent ${joint} must be an integer`);
    }
    if ((joint === 0 && parent !== -1) || (joint > 0 && (parent < 0 || parent >= joint))) {
      return fail(`skeleton parent ${joint} is outside the admitted skeleton`);
    }
    return parent;
  });
};

const admitSections = (input: {
  readonly binaryByteLength: number;
  readonly value: unknown;
}): Readonly<Record<HumanoidSkinSectionName, HumanoidSkinSection>> => {
  if (!isRecord(input.value)) return fail("humanoid skin sections must be an object");
  const sectionSource = input.value;
  const keys = Object.keys(sectionSource);
  if (
    keys.length !== humanoidSkinSectionNames.length ||
    keys.some((key) => !humanoidSkinSectionNames.includes(key as HumanoidSkinSectionName))
  ) {
    return fail("humanoid skin sections do not match the admitted layout");
  }
  const admitted = humanoidSkinSectionNames.reduce<{
    readonly cursor: number;
    readonly sections: Partial<Record<HumanoidSkinSectionName, HumanoidSkinSection>>;
  }>(
    (state, name) => {
      const raw = sectionSource[name];
      const expected = releasedHumanoidSkinLayout.sections[name];
      if (!isRecord(raw)) return fail(`humanoid skin section ${name} must be an object`);
      const byteOffset = finiteInteger({ label: `${name}.byteOffset`, value: raw.byteOffset });
      const byteLength = finiteInteger({ label: `${name}.byteLength`, value: raw.byteLength });
      const shape = exactShape({
        expected: expected.shape,
        label: `${name}.shape`,
        value: raw.shape,
      });
      const expectedByteLength = shape.reduce((product, dimension) => product * dimension, 1) * 4;
      if (
        byteOffset !== aligned(state.cursor) ||
        byteOffset % 16 !== 0 ||
        byteLength !== expectedByteLength
      ) {
        return fail(`humanoid skin section ${name} has an invalid aligned byte range`);
      }
      const componentType = exactString({
        expected: expected.componentType,
        label: `${name}.componentType`,
        value: raw.componentType,
      });
      return {
        cursor: byteOffset + byteLength,
        sections: {
          ...state.sections,
          [name]: { byteLength, byteOffset, componentType, shape },
        },
      };
    },
    { cursor: 0, sections: {} },
  );
  if (aligned(admitted.cursor) !== input.binaryByteLength) {
    return fail("humanoid skin binary length does not close the admitted section layout");
  }
  return admitted.sections as Readonly<Record<HumanoidSkinSectionName, HumanoidSkinSection>>;
};

const admitJointNames = (input: {
  readonly jointCount: number;
  readonly value: unknown;
}): ReadonlyArray<string> => {
  if (
    !Array.isArray(input.value) ||
    input.value.length !== input.jointCount ||
    input.value.some((name) => typeof name !== "string" || name.length === 0) ||
    input.value.some((name, index, names) => names.indexOf(name) !== index)
  ) {
    return fail(
      `humanoid skin joint names must contain ${input.jointCount} unique non-empty names`,
    );
  }
  return input.value.map((name) => String(name));
};

/** Admit only the exact 27-joint humanoid mesh/skeleton product generated from the pinned upstream revision. */
export const admitHumanoidSkinManifest = (value: unknown): HumanoidSkinManifest => {
  if (!isRecord(value)) return fail("humanoid skin manifest must be an object");
  exactString({
    expected: "humanoid-skin@1",
    label: "humanoid skin kind",
    value: value.kind,
  });
  if (!isRecord(value.source)) return fail("humanoid skin source must be an object");
  const source = {
    repository: exactString({
      expected: expectedSource.repository,
      label: "humanoid source repository",
      value: value.source.repository,
    }),
    revision: exactString({
      expected: expectedSource.revision,
      label: "humanoid source revision",
      value: value.source.revision,
    }),
    jointsSha256: exactString({
      expected: expectedSource.jointsSha256,
      label: "humanoid joint source hash",
      value: value.source.jointsSha256,
    }),
    skinSha256: exactString({
      expected: expectedSource.skinSha256,
      label: "humanoid skin source hash",
      value: value.source.skinSha256,
    }),
  };
  if (!isRecord(value.binary)) return fail("humanoid skin binary descriptor must be an object");
  const binary = {
    byteLength: finiteInteger({
      label: "humanoid skin binary byteLength",
      value: value.binary.byteLength,
    }),
    sha256: sha256({ label: "humanoid skin binary hash", value: value.binary.sha256 }),
  };
  const vertexCount = finiteInteger({
    label: "humanoid skin vertexCount",
    value: value.vertexCount,
  });
  const triangleCount = finiteInteger({
    label: "humanoid skin triangleCount",
    value: value.triangleCount,
  });
  const jointCount = finiteInteger({
    label: "humanoid skin jointCount",
    value: value.jointCount,
  });
  const influencesPerVertex = finiteInteger({
    label: "humanoid skin influencesPerVertex",
    value: value.influencesPerVertex,
  });
  if (
    vertexCount !== releasedHumanoidSkinLayout.vertexCount ||
    triangleCount !== releasedHumanoidSkinLayout.triangleCount ||
    jointCount !== releasedHumanoidSkinLayout.jointCount ||
    influencesPerVertex !== releasedHumanoidSkinLayout.influencesPerVertex
  ) {
    return fail("humanoid skin counts do not match the released 27-joint humanoid asset");
  }
  const jointNames = admitJointNames({ jointCount, value: value.jointNames });
  const parents = admitParents({ jointCount, value: value.parents });
  if (
    jointNames.some((name, joint) => name !== releasedHumanoidSkeletonTopology.jointNames[joint]) ||
    parents.some((parent, joint) => parent !== releasedHumanoidSkeletonTopology.parents[joint])
  ) {
    return fail("humanoid skin topology does not match the released physical rig");
  }
  const sections = admitSections({ binaryByteLength: binary.byteLength, value: value.sections });
  return {
    kind: "humanoid-skin@1",
    source,
    binary,
    vertexCount,
    triangleCount,
    jointCount,
    influencesPerVertex,
    jointNames,
    parents,
    sections,
  };
};
