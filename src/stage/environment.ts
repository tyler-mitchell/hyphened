import { mat4 } from "wgpu-matrix";
import { d } from "typegpu";
import {
  GeometryVertexRow,
  importGlb,
  type ImportedGltfAsset,
  type IndexedGeometryRecordInput,
} from "webgpu-engine";

import type { EnvironmentEntity } from "../schema";

const ROOT = "/assets/environment/suburban";

export const ENVIRONMENT_ASSETS = [
  {
    id: "suburban-house",
    kind: "building",
    label: "Suburban house",
    nativeSize: [1.3, 0.834, 1.028],
    suggestedScale: [7.2, 7.2, 7.2],
    uri: `${ROOT}/building-type-a.glb`,
  },
  {
    id: "suburban-corner-house",
    kind: "building",
    label: "Corner house",
    nativeSize: [1.3, 0.738, 0.916],
    suggestedScale: [8.1, 8.1, 8.1],
    uri: `${ROOT}/building-type-h.glb`,
  },
  {
    id: "suburban-large-house",
    kind: "building",
    label: "Large house",
    nativeSize: [1.314, 1.156, 1.406],
    suggestedScale: [5.2, 5.2, 5.2],
    uri: `${ROOT}/building-type-t.glb`,
  },
  {
    id: "low-fence",
    kind: "boundary",
    label: "Low fence",
    nativeSize: [1.275, 0.17, 0.837],
    suggestedScale: [5.3, 5.3, 5.3],
    uri: `${ROOT}/fence-low.glb`,
  },
  {
    id: "footpath",
    kind: "ground",
    label: "Footpath",
    nativeSize: [0.2, 0.01, 0.4],
    suggestedScale: [7.5, 1, 7.5],
    uri: `${ROOT}/path-long.glb`,
  },
  {
    id: "planter",
    kind: "prop",
    label: "Planter",
    nativeSize: [0.4, 0.177, 0.3],
    suggestedScale: [3.4, 3.4, 3.4],
    uri: `${ROOT}/planter.glb`,
  },
  {
    id: "large-tree",
    kind: "foliage",
    label: "Large tree",
    nativeSize: [0.21, 0.767, 0.243],
    suggestedScale: [9, 9, 9],
    uri: `${ROOT}/tree-large.glb`,
  },
  {
    id: "small-tree",
    kind: "foliage",
    label: "Small tree",
    nativeSize: [0.21, 0.567, 0.243],
    suggestedScale: [8, 8, 8],
    uri: `${ROOT}/tree-small.glb`,
  },
] as const;

export const environmentAsset = (id: string) =>
  ENVIRONMENT_ASSETS.find((asset) => asset.id === id);

export interface EnvironmentRenderInstance {
  readonly color: readonly [number, number, number, number];
  readonly geometry: number;
  readonly normalFromLocal: d.m4x4f;
  readonly worldFromLocal: d.m4x4f;
}

export interface EnvironmentRenderProgram {
  readonly indices: readonly number[];
  readonly instances: readonly EnvironmentRenderInstance[];
  readonly maxIndexCount: number;
  readonly records: readonly IndexedGeometryRecordInput[];
  readonly vertices: ReadonlyArray<ReturnType<typeof GeometryVertexRow>>;
}

const rotationMatrix = (rotation: readonly [number, number, number]): d.m4x4f =>
  mat4.multiply(
    mat4.rotationZ(rotation[2], d.mat4x4f()),
    mat4.multiply(
      mat4.rotationY(rotation[1], d.mat4x4f()),
      mat4.rotationX(rotation[0], d.mat4x4f()),
      d.mat4x4f(),
    ),
    d.mat4x4f(),
  );

const entityMatrix = (entity: EnvironmentEntity): d.m4x4f =>
  mat4.multiply(
    mat4.translation(entity.position, d.mat4x4f()),
    mat4.multiply(
      rotationMatrix(entity.rotation),
      mat4.scaling(entity.scale, d.mat4x4f()),
      d.mat4x4f(),
    ),
    d.mat4x4f(),
  );

/** Load and merge the static assets referenced by one scene's environment entities. */
export const loadEnvironment = async (
  entities: readonly EnvironmentEntity[],
): Promise<EnvironmentRenderProgram> => {
  const assetIds = [...new Set(entities.map(({ asset }) => asset))];
  const loaded = await Promise.all(
    assetIds.map(async (id) => {
      const declared = environmentAsset(id);
      if (declared === undefined) throw new Error(`The environment asset "${id}" does not exist.`);
      return {
        id,
        asset: await importGlb({ materials: "geometry-only", uri: declared.uri }),
      };
    }),
  );
  const merged = loaded.reduce<{
    readonly assets: Readonly<Record<string, { readonly asset: ImportedGltfAsset; readonly geometryOffset: number }>>;
    readonly indices: readonly number[];
    readonly records: readonly IndexedGeometryRecordInput[];
    readonly vertices: ReadonlyArray<ReturnType<typeof GeometryVertexRow>>;
  }>(
    (current, entry) => ({
      assets: {
        ...current.assets,
        [entry.id]: { asset: entry.asset, geometryOffset: current.records.length },
      },
      indices: [...current.indices, ...entry.asset.geometry.packed.indices],
      records: [
        ...current.records,
        ...entry.asset.geometry.packed.records.map((record) => ({
          boundsRadius: record.boundsRadius,
          indexCount: record.indexCount,
          indexOffset: current.indices.length + record.indexOffset,
          vertexOffset: current.vertices.length + record.vertexOffset,
        })),
      ],
      vertices: [...current.vertices, ...entry.asset.geometry.vertices],
    }),
    { assets: {}, indices: [], records: [], vertices: [] },
  );
  const instances = entities.flatMap((entity) => {
    const loadedAsset = merged.assets[entity.asset]!;
    const placement = entityMatrix(entity);
    return loadedAsset.asset.instances.map((instance) => {
      const worldFromLocal = mat4.multiply(
        placement,
        new Float32Array(instance.worldFromLocal),
        d.mat4x4f(),
      );
      return {
        color: entity.color,
        geometry: loadedAsset.geometryOffset + instance.geometry,
        normalFromLocal: mat4.transpose(
          mat4.inverse(worldFromLocal, d.mat4x4f()),
          d.mat4x4f(),
        ),
        worldFromLocal,
      };
    });
  });
  return {
    indices: merged.indices,
    instances,
    maxIndexCount: Math.max(0, ...merged.records.map(({ indexCount }) => indexCount)),
    records: merged.records,
    vertices: merged.vertices,
  };
};
