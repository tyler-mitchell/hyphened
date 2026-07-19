import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { mat4 } from "wgpu-matrix";

import { parseCoreAssetNumpyArray, type CoreAssetNumpyArray } from "./numpy";

interface BinarySection {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly componentType: "f32" | "u32";
  readonly shape: ReadonlyArray<number>;
}

type ComponentType = BinarySection["componentType"];

interface BinaryPayload {
  readonly bytes: Uint8Array;
  readonly componentType: ComponentType;
  readonly name: string;
  readonly shape: ReadonlyArray<number>;
}

export interface CoreAssetBundleBuildConfig {
  readonly outputDirectory: string;
  readonly sourceDirectory: string;
}

interface DerivedCoreAssetBundle {
  readonly binary: Uint8Array;
  readonly manifestJson: string;
}

const coreAssetLayout = {
  vertexCount: 9084,
  triangleCount: 18152,
  jointCount: 27,
  influencesPerVertex: 5,
  connectionCount: 26,
  sections: {
    positions: [9084, 3],
    normals: [9084, 3],
    indices: [18152, 3],
    jointIndices: [9084, 5],
    jointWeights: [9084, 5],
    inverseBindMatrices: [27, 4, 4],
    neutralJoints: [27, 3],
  },
} as const;

const coreAssetSource = {
  repository: "https://github.com/nv-tlabs/ardy",
  revision: "693f74d13b3d04a0a22ce127ee79c929dd89756b",
} as const;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const aligned = (value: number): number => Math.ceil(value / 16) * 16;

const arrayAt = (archive: Record<string, Uint8Array>, name: string): CoreAssetNumpyArray => {
  const bytes = archive[`${name}.npy`];
  if (bytes === undefined) throw new Error(`Core skin archive is missing ${name}.npy`);
  return parseCoreAssetNumpyArray(bytes);
};

const exactShape = <T extends CoreAssetNumpyArray>(input: {
  readonly array: T;
  readonly label: string;
  readonly shape: ReadonlyArray<number>;
}): T => {
  if (
    input.array.shape.length !== input.shape.length ||
    input.array.shape.some((value, axis) => value !== input.shape[axis])
  ) {
    throw new Error(
      `${input.label} shape [${input.array.shape.join(",")}] does not match [${input.shape.join(",")}]`,
    );
  }
  return input.array;
};

const asF32 = (input: {
  readonly array: CoreAssetNumpyArray;
  readonly label: string;
}): Float32Array => {
  if (
    !(input.array.values instanceof Float32Array) &&
    !(input.array.values instanceof Float64Array)
  ) {
    throw new Error(`${input.label} must be floating point`);
  }
  const result = Float32Array.from(input.array.values);
  if (result.some((value) => !Number.isFinite(value))) {
    throw new Error(`${input.label} must be finite`);
  }
  return result;
};

const asU32 = (input: {
  readonly array: CoreAssetNumpyArray;
  readonly label: string;
}): Uint32Array => {
  const values = input.array.values;
  if (!(values instanceof Int32Array) && !(values instanceof BigInt64Array)) {
    throw new Error(`${input.label} must be signed integer data`);
  }
  return Uint32Array.from({ length: values.length }, (_unused, index) => {
    const value = values[index]!;
    const number = typeof value === "bigint" ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffff_ffff) {
      throw new Error(`${input.label} contains an out-of-range index`);
    }
    return number;
  });
};

const neutralJoints = (archiveBytes: Uint8Array): Float32Array => {
  const archive = unzipSync(archiveBytes);
  const data = archive["joints/data/0"];
  const pickle = archive["joints/data.pkl"];
  if (data?.byteLength !== coreAssetLayout.jointCount * 3 * 8 || pickle?.byteLength !== 155) {
    throw new Error("Core neutral-joint tensor does not match the admitted 27x3 F64 archive");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Float32Array.from({ length: coreAssetLayout.jointCount * 3 }, (_unused, index) =>
    view.getFloat64(index * 8, true),
  );
};

interface VertexNormalContribution {
  readonly normal: readonly [number, number, number];
  readonly vertex: number;
}

const lowerBound = (input: {
  readonly entries: ReadonlyArray<VertexNormalContribution>;
  readonly high?: number;
  readonly low?: number;
  readonly vertex: number;
}): number => {
  const low = input.low ?? 0;
  const high = input.high ?? input.entries.length;
  if (low >= high) return low;
  const middle = low + Math.floor((high - low) / 2);
  return input.entries[middle]!.vertex < input.vertex
    ? lowerBound({ ...input, low: middle + 1, high })
    : lowerBound({ ...input, low, high: middle });
};

const computeNormals = (input: {
  readonly indices: Uint32Array;
  readonly positions: Float32Array;
}): Float32Array => {
  // Sorting this newly allocated build-only array is the bounded imperative boundary needed for
  // binary-search aggregation; no source or derived contribution escapes mutation.
  const contributions = Array.from(
    Array.from(
      { length: input.indices.length / 3 },
      (_unused, face): ReadonlyArray<VertexNormalContribution> => {
        const indexOffset = face * 3;
        const a = input.indices[indexOffset]! * 3;
        const b = input.indices[indexOffset + 1]! * 3;
        const c = input.indices[indexOffset + 2]! * 3;
        const abx = input.positions[b]! - input.positions[a]!;
        const aby = input.positions[b + 1]! - input.positions[a + 1]!;
        const abz = input.positions[b + 2]! - input.positions[a + 2]!;
        const acx = input.positions[c]! - input.positions[a]!;
        const acy = input.positions[c + 1]! - input.positions[a + 1]!;
        const acz = input.positions[c + 2]! - input.positions[a + 2]!;
        const normal = [
          aby * acz - abz * acy,
          abz * acx - abx * acz,
          abx * acy - aby * acx,
        ] as const;
        return [a / 3, b / 3, c / 3].map((vertex) => ({ normal, vertex }));
      },
    ).flat(),
  ).sort(
    (left: VertexNormalContribution, right: VertexNormalContribution) => left.vertex - right.vertex,
  );
  const vertexNormals = Array.from(
    { length: input.positions.length / 3 },
    (_unused, vertex): readonly [number, number, number] => {
      const start = lowerBound({ entries: contributions, vertex });
      const end = lowerBound({ entries: contributions, vertex: vertex + 1 });
      const normal = contributions
        .slice(start, end)
        .reduce<readonly [number, number, number]>(
          (sum, contribution) => [
            sum[0] + contribution.normal[0],
            sum[1] + contribution.normal[1],
            sum[2] + contribution.normal[2],
          ],
          [0, 0, 0],
        );
      const length = Math.hypot(...normal);
      return length > 0 ? [normal[0] / length, normal[1] / length, normal[2] / length] : [0, 1, 0];
    },
  );
  return Float32Array.from(
    { length: input.positions.length },
    (_unused, index) => vertexNormals[Math.floor(index / 3)]![index % 3]!,
  );
};

const inverseBindMatrices = (rowMajorBindMatrices: Float32Array): Float32Array => {
  const matrices = Array.from({ length: coreAssetLayout.jointCount }, (_unused, joint) => {
    const source = rowMajorBindMatrices.subarray(joint * 16, joint * 16 + 16);
    return mat4.inverse(
      Float32Array.from({ length: 16 }, (_unusedElement, index) => {
        const row = index % 4;
        const column = Math.floor(index / 4);
        return source[row * 4 + column]!;
      }),
    );
  });
  return Float32Array.from(
    { length: rowMajorBindMatrices.length },
    (_unused, index) => matrices[Math.floor(index / 16)]![index % 16]!,
  );
};

const encodeScalar = (input: {
  readonly componentType: ComponentType;
  readonly value: number;
}): ReadonlyArray<number> => {
  // DataView is the exact little-endian serialization boundary; the mutable four-byte buffer does
  // not escape, while every derivation around it remains a value transformation.
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  if (input.componentType === "f32") view.setFloat32(0, input.value, true);
  else view.setUint32(0, input.value, true);
  return Array.from(bytes);
};

const encodeF32 = (values: Float32Array): Uint8Array =>
  Uint8Array.from(
    Array.from(values).flatMap((value) => encodeScalar({ componentType: "f32", value })),
  );

const encodeU32 = (values: Uint32Array): Uint8Array =>
  Uint8Array.from(
    Array.from(values).flatMap((value) => encodeScalar({ componentType: "u32", value })),
  );

const deriveParents = (connections: Uint32Array): ReadonlyArray<number> => {
  const edges = Array.from({ length: coreAssetLayout.connectionCount }, (_unused, connection) => ({
    parent: connections[connection * 2]!,
    child: connections[connection * 2 + 1]!,
  }));
  if (
    edges.some(
      ({ child, parent }) =>
        child === 0 ||
        child >= coreAssetLayout.jointCount ||
        parent >= coreAssetLayout.jointCount ||
        parent >= child,
    )
  ) {
    throw new Error("Core rig connections do not form the expected parent-before-child tree");
  }
  return [
    -1,
    ...Array.from({ length: coreAssetLayout.jointCount - 1 }, (_unused, index) => {
      const child = index + 1;
      const parents = edges.filter((edge) => edge.child === child).map((edge) => edge.parent);
      if (parents.length !== 1) {
        throw new Error(`Core rig joint ${child} must have exactly one admitted parent`);
      }
      return parents[0]!;
    }),
  ];
};

const packPayloads = (
  payloads: ReadonlyArray<BinaryPayload>,
): {
  readonly binary: Uint8Array;
  readonly sections: Readonly<Record<string, BinarySection>>;
} => {
  const packed = payloads.reduce<{
    readonly cursor: number;
    readonly entries: ReadonlyArray<{
      readonly payload: BinaryPayload;
      readonly section: BinarySection;
    }>;
  }>(
    (state, payload) => {
      const byteOffset = aligned(state.cursor);
      return {
        cursor: byteOffset + payload.bytes.byteLength,
        entries: [
          ...state.entries,
          {
            payload,
            section: {
              byteLength: payload.bytes.byteLength,
              byteOffset,
              componentType: payload.componentType,
              shape: payload.shape,
            },
          },
        ],
      };
    },
    { cursor: 0, entries: [] },
  );
  const binary = Uint8Array.from({ length: aligned(packed.cursor) }, (_unused, byteOffset) => {
    const entry = packed.entries.find(
      ({ section }) =>
        byteOffset >= section.byteOffset && byteOffset < section.byteOffset + section.byteLength,
    );
    return entry === undefined ? 0 : entry.payload.bytes[byteOffset - entry.section.byteOffset]!;
  });
  return {
    binary,
    sections: Object.fromEntries(
      packed.entries.map(({ payload, section }) => [payload.name, section]),
    ),
  };
};

const deriveCoreAssetBundle = (input: {
  readonly jointBytes: Uint8Array;
  readonly skinBytes: Uint8Array;
}): DerivedCoreAssetBundle => {
  const archive = unzipSync(input.skinBytes);
  const positions = asF32({
    array: exactShape({
      array: arrayAt(archive, "bind_vertices"),
      label: "bind vertices",
      shape: coreAssetLayout.sections.positions,
    }),
    label: "bind vertices",
  });
  const indices = asU32({
    array: exactShape({
      array: arrayAt(archive, "faces"),
      label: "faces",
      shape: coreAssetLayout.sections.indices,
    }),
    label: "faces",
  });
  const bindMatrices = asF32({
    array: exactShape({
      array: arrayAt(archive, "bind_rig_transform"),
      label: "bind transforms",
      shape: coreAssetLayout.sections.inverseBindMatrices,
    }),
    label: "bind transforms",
  });
  const namesArray = exactShape({
    array: arrayAt(archive, "rig_joint_names"),
    label: "joint names",
    shape: [coreAssetLayout.jointCount],
  });
  if (!Array.isArray(namesArray.values)) throw new Error("Core rig joint names must be Unicode");
  const jointIndices = asU32({
    array: exactShape({
      array: arrayAt(archive, "lbs_indices"),
      label: "skin joint indices",
      shape: coreAssetLayout.sections.jointIndices,
    }),
    label: "skin joint indices",
  });
  const jointWeights = asF32({
    array: exactShape({
      array: arrayAt(archive, "lbs_weights"),
      label: "skin joint weights",
      shape: coreAssetLayout.sections.jointWeights,
    }),
    label: "skin joint weights",
  });
  const connections = asU32({
    array: exactShape({
      array: arrayAt(archive, "rig_joint_connections"),
      label: "rig connections",
      shape: [coreAssetLayout.connectionCount, 2],
    }),
    label: "rig connections",
  });
  const parents = deriveParents(connections);

  const payloads: ReadonlyArray<BinaryPayload> = [
    {
      name: "positions",
      bytes: encodeF32(positions),
      componentType: "f32",
      shape: coreAssetLayout.sections.positions,
    },
    {
      name: "normals",
      bytes: encodeF32(computeNormals({ positions, indices })),
      componentType: "f32",
      shape: coreAssetLayout.sections.normals,
    },
    {
      name: "indices",
      bytes: encodeU32(indices),
      componentType: "u32",
      shape: coreAssetLayout.sections.indices,
    },
    {
      name: "jointIndices",
      bytes: encodeU32(jointIndices),
      componentType: "u32",
      shape: coreAssetLayout.sections.jointIndices,
    },
    {
      name: "jointWeights",
      bytes: encodeF32(jointWeights),
      componentType: "f32",
      shape: coreAssetLayout.sections.jointWeights,
    },
    {
      name: "inverseBindMatrices",
      bytes: encodeF32(inverseBindMatrices(bindMatrices)),
      componentType: "f32",
      shape: coreAssetLayout.sections.inverseBindMatrices,
    },
    {
      name: "neutralJoints",
      bytes: encodeF32(neutralJoints(input.jointBytes)),
      componentType: "f32",
      shape: coreAssetLayout.sections.neutralJoints,
    },
  ];
  const { binary, sections } = packPayloads(payloads);
  const manifest = {
    kind: "ardy-core-skin@1",
    source: {
      ...coreAssetSource,
      jointsSha256: sha256(input.jointBytes),
      skinSha256: sha256(input.skinBytes),
    },
    binary: { byteLength: binary.byteLength, sha256: sha256(binary) },
    vertexCount: coreAssetLayout.vertexCount,
    triangleCount: coreAssetLayout.triangleCount,
    jointCount: coreAssetLayout.jointCount,
    influencesPerVertex: coreAssetLayout.influencesPerVertex,
    jointNames: [...namesArray.values],
    parents,
    sections,
  };
  return { binary, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
};

const writeCoreAssetBundle = async (input: {
  readonly bundle: DerivedCoreAssetBundle;
  readonly outputDirectory: string;
}): Promise<void> => {
  await mkdir(input.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(input.outputDirectory, "core-skin.bin"), input.bundle.binary),
    writeFile(join(input.outputDirectory, "core-skin.json"), input.bundle.manifestJson),
  ]);
};

/** Read pinned upstream artifacts, derive one admitted bundle, then write both admitted outputs. */
export const buildCoreAssetBundle = async (input: CoreAssetBundleBuildConfig): Promise<void> => {
  const [skinBytes, jointBytes] = await Promise.all([
    readFile(join(input.sourceDirectory, "skin_standard.npz")),
    readFile(join(input.sourceDirectory, "joints.p")),
  ]);
  await writeCoreAssetBundle({
    bundle: deriveCoreAssetBundle({ jointBytes, skinBytes }),
    outputDirectory: input.outputDirectory,
  });
};
