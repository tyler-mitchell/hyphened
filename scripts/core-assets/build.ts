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

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const aligned = (value: number): number => Math.ceil(value / 16) * 16;

const arrayAt = (archive: Record<string, Uint8Array>, name: string): CoreAssetNumpyArray => {
  const bytes = archive[`${name}.npy`];
  if (bytes === undefined) throw new Error(`Core skin archive is missing ${name}.npy`);
  return parseCoreAssetNumpyArray(bytes);
};

const exactShape = <T extends CoreAssetNumpyArray>(
  array: T,
  shape: ReadonlyArray<number>,
  label: string,
): T => {
  if (
    array.shape.length !== shape.length ||
    array.shape.some((value, axis) => value !== shape[axis])
  ) {
    throw new Error(
      `${label} shape [${array.shape.join(",")}] does not match [${shape.join(",")}]`,
    );
  }
  return array;
};

const asF32 = (array: CoreAssetNumpyArray, label: string): Float32Array => {
  if (!(array.values instanceof Float32Array) && !(array.values instanceof Float64Array)) {
    throw new Error(`${label} must be floating point`);
  }
  const result = Float32Array.from(array.values);
  if (result.some((value) => !Number.isFinite(value))) throw new Error(`${label} must be finite`);
  return result;
};

const asU32 = (array: CoreAssetNumpyArray, label: string): Uint32Array => {
  const values = array.values;
  if (!(values instanceof Int32Array) && !(values instanceof BigInt64Array)) {
    throw new Error(`${label} must be signed integer data`);
  }
  return Uint32Array.from({ length: values.length }, (_unused, index) => {
    const value = values[index]!;
    const number = typeof value === "bigint" ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffff_ffff) {
      throw new Error(`${label} contains an out-of-range index`);
    }
    return number;
  });
};

const neutralJoints = (archiveBytes: Uint8Array): Float32Array => {
  const archive = unzipSync(archiveBytes);
  const data = archive["joints/data/0"];
  const pickle = archive["joints/data.pkl"];
  if (data?.byteLength !== 27 * 3 * 8 || pickle?.byteLength !== 155) {
    throw new Error("Core neutral-joint tensor does not match the admitted 27x3 F64 archive");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Float32Array.from({ length: 27 * 3 }, (_unused, index) =>
    view.getFloat64(index * 8, true),
  );
};

const computeNormals = (positions: Float32Array, indices: Uint32Array): Float32Array => {
  const normals = new Float64Array(positions.length);
  for (let face = 0; face < indices.length; face += 3) {
    const a = indices[face]! * 3;
    const b = indices[face + 1]! * 3;
    const c = indices[face + 2]! * 3;
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  return Float32Array.from({ length: positions.length }, (_unused, index) => {
    const vertex = index - (index % 3);
    const length = Math.hypot(normals[vertex]!, normals[vertex + 1]!, normals[vertex + 2]!);
    return length > 0 ? normals[index]! / length : index % 3 === 1 ? 1 : 0;
  });
};

const inverseBindMatrices = (rowMajorBindMatrices: Float32Array): Float32Array => {
  const result = new Float32Array(rowMajorBindMatrices.length);
  for (let joint = 0; joint < 27; joint += 1) {
    const source = rowMajorBindMatrices.subarray(joint * 16, joint * 16 + 16);
    const columnMajor = Float32Array.from({ length: 16 }, (_unused, index) => {
      const row = index % 4;
      const column = Math.floor(index / 4);
      return source[row * 4 + column]!;
    });
    result.set(mat4.inverse(columnMajor), joint * 16);
  }
  return result;
};

const encodeF32 = (values: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
};

const encodeU32 = (values: Uint32Array): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
};

export const buildCoreAssetBundle = async (input: {
  readonly outputDirectory: string;
  readonly sourceDirectory: string;
}): Promise<void> => {
  const skinPath = join(input.sourceDirectory, "skin_standard.npz");
  const jointsPath = join(input.sourceDirectory, "joints.p");
  const [skinBytes, jointBytes] = await Promise.all([readFile(skinPath), readFile(jointsPath)]);
  const archive = unzipSync(skinBytes);
  const positions = asF32(
    exactShape(arrayAt(archive, "bind_vertices"), [9084, 3], "bind vertices"),
    "bind vertices",
  );
  const indices = asU32(exactShape(arrayAt(archive, "faces"), [18152, 3], "faces"), "faces");
  const bindMatrices = asF32(
    exactShape(arrayAt(archive, "bind_rig_transform"), [27, 4, 4], "bind transforms"),
    "bind transforms",
  );
  const namesArray = exactShape(arrayAt(archive, "rig_joint_names"), [27], "joint names");
  if (!Array.isArray(namesArray.values)) throw new Error("Core rig joint names must be Unicode");
  const jointIndices = asU32(
    exactShape(arrayAt(archive, "lbs_indices"), [9084, 5], "skin joint indices"),
    "skin joint indices",
  );
  const jointWeights = asF32(
    exactShape(arrayAt(archive, "lbs_weights"), [9084, 5], "skin joint weights"),
    "skin joint weights",
  );
  const connections = asU32(
    exactShape(arrayAt(archive, "rig_joint_connections"), [26, 2], "rig connections"),
    "rig connections",
  );
  const parents = Array.from({ length: 27 }, () => -1);
  for (let connection = 0; connection < 26; connection += 1) {
    const parent = connections[connection * 2]!;
    const child = connections[connection * 2 + 1]!;
    if (child === 0 || child >= 27 || parent >= 27 || parents[child] !== -1) {
      throw new Error("Core rig connections do not form the expected rooted tree");
    }
    parents[child] = parent;
  }
  if (parents.slice(1).some((parent) => parent < 0)) {
    throw new Error("Core rig connections leave an unparented non-root joint");
  }

  const payloads = {
    positions: { bytes: encodeF32(positions), componentType: "f32", shape: [9084, 3] },
    normals: {
      bytes: encodeF32(computeNormals(positions, indices)),
      componentType: "f32",
      shape: [9084, 3],
    },
    indices: { bytes: encodeU32(indices), componentType: "u32", shape: [18152, 3] },
    jointIndices: { bytes: encodeU32(jointIndices), componentType: "u32", shape: [9084, 5] },
    jointWeights: { bytes: encodeF32(jointWeights), componentType: "f32", shape: [9084, 5] },
    inverseBindMatrices: {
      bytes: encodeF32(inverseBindMatrices(bindMatrices)),
      componentType: "f32",
      shape: [27, 4, 4],
    },
    neutralJoints: {
      bytes: encodeF32(neutralJoints(jointBytes)),
      componentType: "f32",
      shape: [27, 3],
    },
  } as const;
  let byteOffset = 0;
  const sections: Record<string, BinarySection> = {};
  for (const [name, payload] of Object.entries(payloads)) {
    byteOffset = aligned(byteOffset);
    sections[name] = {
      byteLength: payload.bytes.byteLength,
      byteOffset,
      componentType: payload.componentType,
      shape: payload.shape,
    };
    byteOffset += payload.bytes.byteLength;
  }
  const binary = new Uint8Array(aligned(byteOffset));
  for (const [name, payload] of Object.entries(payloads)) {
    binary.set(payload.bytes, sections[name]!.byteOffset);
  }
  const manifest = {
    kind: "ardy-core-skin@1",
    source: {
      repository: "https://github.com/nv-tlabs/ardy",
      revision: "693f74d13b3d04a0a22ce127ee79c929dd89756b",
      jointsSha256: sha256(jointBytes),
      skinSha256: sha256(skinBytes),
    },
    binary: { byteLength: binary.byteLength, sha256: sha256(binary) },
    vertexCount: 9084,
    triangleCount: 18152,
    jointCount: 27,
    influencesPerVertex: 5,
    jointNames: namesArray.values,
    parents,
    sections,
  };
  await mkdir(input.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(input.outputDirectory, "core-skin.bin"), binary),
    writeFile(
      join(input.outputDirectory, "core-skin.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
  ]);
};
