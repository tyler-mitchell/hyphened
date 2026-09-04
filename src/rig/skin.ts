import { refuseEmbodimentAsset } from "./errors";
import {
  admitHumanoidSkinManifest,
  type HumanoidSkinManifest,
  type HumanoidSkinSectionName,
} from "./skin-manifest";
import { admitEmbodimentRestPose, type EmbodimentRestPose } from "./skeleton";

export const humanoidSkinAssetUrls = {
  manifest: "/assets/ardy/humanoid/humanoid-skin.json",
  binary: "/assets/ardy/humanoid/humanoid-skin.bin",
} as const;

/** One character's mesh and skin, as the stage consumes it, independent of where it was read. */
export interface HumanoidSkinAsset {
  /** One base-colour image per material, in layer order; the actor's colour when the file carries none. */
  readonly baseColors?: ReadonlyArray<{
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly mimeType: string;
  }>;
  /** Each vertex's base-colour layer, present with `baseColors`. */
  readonly materials?: Uint32Array;
  /** Texture coordinates, present only for a character whose file carries them. */
  readonly uvs?: Float32Array;
  /** Authored skin-bind root translation recovered from the root inverse-bind transform. */
  readonly bindRootPosition: readonly [number, number, number];
  readonly influencesPerVertex: number;
  readonly jointCount: number;
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly jointIndices: Uint32Array;
  readonly jointWeights: Float32Array;
  readonly inverseBindMatrices: Float32Array;
}

/** Coherent neutral rig geometry and skin data admitted from one physical asset revision. */
export interface HumanoidRigAssets {
  readonly restPose: EmbodimentRestPose;
  readonly skin: HumanoidSkinAsset;
}

export interface HumanoidRigAssetSource {
  readonly binaryUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly manifestUrl?: string;
}

const fail = (reason: string): never => refuseEmbodimentAsset("rig", reason);

/** A rig's standing height in metres: the span of its joints on the vertical axis. */
export const humanoidRigHeight = (rig: HumanoidRigAssets): number => {
  const elevations = Array.from(rig.restPose.jointPositions).filter(
    (_unused, at) => at % 3 === 1,
  );
  return Math.max(...elevations) - Math.min(...elevations);
};

const fetchAsset = async (input: {
  readonly fetchImpl: typeof fetch;
  readonly label: string;
  readonly url: string;
}): Promise<Response> => {
  const response = await input.fetchImpl.call(globalThis, input.url);
  if (!response.ok) return fail(`failed to fetch ${input.label}: HTTP ${response.status}`);
  return response;
};

const digestHex = async (binary: ArrayBuffer): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", binary));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const view = <T extends Float32Array | Uint32Array>(input: {
  readonly binary: ArrayBuffer;
  readonly manifest: HumanoidSkinManifest;
  readonly name: HumanoidSkinSectionName;
  readonly construct: new (buffer: ArrayBuffer, byteOffset: number, length: number) => T;
}): T => {
  const section = input.manifest.sections[input.name];
  return new input.construct(input.binary, section.byteOffset, section.byteLength / 4);
};

const finitePayloadViolation = (input: {
  readonly label: string;
  readonly values: Float32Array;
}): string | undefined =>
  input.values.some((value) => !Number.isFinite(value))
    ? `${input.label} contains a non-finite value`
    : undefined;

const influenceViolation = (input: {
  readonly influencesPerVertex: number;
  readonly values: Float32Array;
  readonly vertexCount: number;
}): string | undefined =>
  Array.from({ length: input.vertexCount }, (_unused, vertex) => {
    const start = vertex * input.influencesPerVertex;
    const influences = input.values.subarray(start, start + input.influencesPerVertex);
    if (influences.some((weight) => weight < 0 || weight > 1)) {
      return `humanoid skin vertex ${vertex} has an invalid influence weight`;
    }
    const weightSum = influences.reduce((sum, weight) => sum + weight, 0);
    return Math.abs(weightSum - 1) > 1e-4
      ? `humanoid skin vertex ${vertex} weights do not sum to one`
      : undefined;
  }).find((violation): violation is string => violation !== undefined);

const validatePayload = (asset: HumanoidSkinAsset): void => {
  const violation = [
    finitePayloadViolation({ label: "humanoid bind positions", values: asset.positions }),
    finitePayloadViolation({ label: "humanoid bind normals", values: asset.normals }),
    finitePayloadViolation({ label: "humanoid skin weights", values: asset.jointWeights }),
    finitePayloadViolation({
      label: "humanoid inverse-bind matrices",
      values: asset.inverseBindMatrices,
    }),
    asset.indices.some((index) => index >= asset.vertexCount)
      ? "humanoid mesh contains an out-of-range vertex index"
      : undefined,
    asset.jointIndices.some((index) => index >= asset.jointCount)
      ? "humanoid mesh contains an out-of-range skin joint index"
      : undefined,
    influenceViolation({
      influencesPerVertex: asset.influencesPerVertex,
      values: asset.jointWeights,
      vertexCount: asset.vertexCount,
    }),
  ].find((candidate): candidate is string => candidate !== undefined);
  if (violation !== undefined) fail(violation);
};

const readManifestJson = (response: Response): Promise<unknown> =>
  response.json().catch(() => fail("humanoid skin manifest is not valid JSON"));

/** Recover `t` from the rigid inverse-bind transform `[Rᵀ, -Rᵀt]`. */
const bindRootPosition = (inverseBindMatrices: Float32Array): readonly [number, number, number] => {
  const inverseTranslation = inverseBindMatrices.subarray(12, 15);
  const component = (axis: number): number =>
    -(
      inverseBindMatrices[axis * 4]! * inverseTranslation[0]! +
      inverseBindMatrices[axis * 4 + 1]! * inverseTranslation[1]! +
      inverseBindMatrices[axis * 4 + 2]! * inverseTranslation[2]!
    );
  return [component(0), component(1), component(2)];
};

const admitPayload = (input: {
  readonly binary: ArrayBuffer;
  readonly manifest: HumanoidSkinManifest;
}): HumanoidRigAssets => {
  const inverseBindMatrices = view({
    ...input,
    name: "inverseBindMatrices",
    construct: Float32Array,
  });
  const skin: HumanoidSkinAsset = {
    bindRootPosition: bindRootPosition(inverseBindMatrices),
    influencesPerVertex: input.manifest.influencesPerVertex,
    jointCount: input.manifest.jointCount,
    vertexCount: input.manifest.vertexCount,
    positions: view({ ...input, name: "positions", construct: Float32Array }),
    normals: view({ ...input, name: "normals", construct: Float32Array }),
    indices: view({ ...input, name: "indices", construct: Uint32Array }),
    jointIndices: view({ ...input, name: "jointIndices", construct: Uint32Array }),
    jointWeights: view({ ...input, name: "jointWeights", construct: Float32Array }),
    inverseBindMatrices,
  };
  validatePayload(skin);
  return {
    restPose: admitEmbodimentRestPose({
      jointPositions: view({ ...input, name: "neutralJoints", construct: Float32Array }),
      jointNames: input.manifest.jointNames,
      parentJointIndices: input.manifest.parents,
    }),
    skin,
  };
};

/** Fetch and admit one coherent physical rig bundle. */
export const loadHumanoidRigAssets = async (
  input: HumanoidRigAssetSource = {},
): Promise<HumanoidRigAssets> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const manifestResponse = await fetchAsset({
    fetchImpl,
    label: "humanoid skin manifest",
    url: input.manifestUrl ?? humanoidSkinAssetUrls.manifest,
  });
  const binaryResponse = await fetchAsset({
    fetchImpl,
    label: "humanoid skin binary",
    url: input.binaryUrl ?? humanoidSkinAssetUrls.binary,
  });
  const manifestSource = await readManifestJson(manifestResponse);
  const manifest = admitHumanoidSkinManifest(manifestSource);
  const binary = await binaryResponse.arrayBuffer();
  if (binary.byteLength !== manifest.binary.byteLength)
    fail("humanoid skin binary byte length does not match its manifest");
  if ((await digestHex(binary)) !== manifest.binary.sha256)
    fail("humanoid skin binary hash does not match its manifest");
  return admitPayload({ binary, manifest });
};
