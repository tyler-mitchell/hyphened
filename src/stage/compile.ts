import type { HumanoidRigAssets } from "../rig/skin";
import type { MotionRigBinding } from "../rig/binding";
import { SCENE_COMPOSITION } from "../scene/composition";
import {
  MotionCameraProgram,
  type MotionCameraProgram as MotionCameraProgramData,
  MotionCompilationProgram,
  MotionPipelineProgram,
  type MotionPipelineProgram as MotionPipelineProgramData,
  MotionPresentationProgram,
  MotionRenderConfiguration,
  MotionRenderProgram,
  type MotionSceneComposition,
  INITIAL_PRODUCT_SEED,
} from "../schema";

export const compileMotionCameraProgram = (input: {
  readonly composition: MotionSceneComposition;
}): MotionCameraProgramData => {
  const actorRows = new Map(input.composition.actors.map(({ row, subject }) => [subject, row]));
  return MotionCameraProgram.assert({
    frames: Array.from({ length: input.composition.frameCount }, (_unused, frame) => {
      const item = input.composition.cameraTrack.items.find(
        (candidate) =>
          candidate.range.start <= frame &&
          frame < candidate.range.start + candidate.range.duration,
      )!;
      const data = item.data;
      const target =
        data.target.kind === "point"
          ? data.target
          : {
              entities: data.target.entities.map((entity) => actorRows.get(entity)!),
              kind: "entities" as const,
              offset: data.target.offset,
            };
      const common = {
        interpolate: frame + 1 < item.range.start + item.range.duration,
        projection: data.projection,
        target,
      };
      return data.mode === "orbit"
        ? {
            ...common,
            distance: data.distance,
            mode: data.mode,
            pitch: data.pitch,
            yaw: data.yaw,
          }
        : { ...common, mode: data.mode, position: data.position };
    }),
  });
};

/** The unit quaternion of a rotation matrix given row-major as `element(row, column)`. */
const quaternionOfRotation = (
  element: (row: number, column: number) => number,
): [number, number, number, number] => {
  const trace = element(0, 0) + element(1, 1) + element(2, 2);
  const candidates: ReadonlyArray<() => [number, number, number, number]> = [
    () => {
      const scale = 2 * Math.sqrt(trace + 1);
      return [
        (element(2, 1) - element(1, 2)) / scale,
        (element(0, 2) - element(2, 0)) / scale,
        (element(1, 0) - element(0, 1)) / scale,
        0.25 * scale,
      ];
    },
    () => {
      const scale = 2 * Math.sqrt(1 + element(0, 0) - element(1, 1) - element(2, 2));
      return [
        0.25 * scale,
        (element(0, 1) + element(1, 0)) / scale,
        (element(0, 2) + element(2, 0)) / scale,
        (element(2, 1) - element(1, 2)) / scale,
      ];
    },
    () => {
      const scale = 2 * Math.sqrt(1 + element(1, 1) - element(0, 0) - element(2, 2));
      return [
        (element(0, 1) + element(1, 0)) / scale,
        0.25 * scale,
        (element(1, 2) + element(2, 1)) / scale,
        (element(0, 2) - element(2, 0)) / scale,
      ];
    },
    () => {
      const scale = 2 * Math.sqrt(1 + element(2, 2) - element(0, 0) - element(1, 1));
      return [
        (element(0, 2) + element(2, 0)) / scale,
        (element(1, 2) + element(2, 1)) / scale,
        0.25 * scale,
        (element(1, 0) - element(0, 1)) / scale,
      ];
    },
  ];
  const branch =
    trace > 0
      ? 0
      : element(0, 0) > element(1, 1) && element(0, 0) > element(2, 2)
        ? 1
        : element(1, 1) > element(2, 2)
          ? 2
          : 3;
  const [x, y, z, w] = candidates[branch]!();
  const length = Math.hypot(x, y, z, w);
  return [x / length, y / length, z / length, w / length];
};

/** Lower one exact Core Time composition revision and admitted rig into the GPU program. */
export const compileMotionPipelineProgram = (input: {
  readonly artifact: { readonly id: string; readonly version: string };
  readonly composition: MotionSceneComposition;
  readonly framesPerSecond: number;
  readonly render?: MotionRenderConfiguration;
  readonly rig: MotionRigBinding<HumanoidRigAssets>;
}): MotionPipelineProgramData => {
  const frameCount = input.composition.frameCount;
  const compilation = MotionCompilationProgram.assert({
    clips: input.composition.actors.flatMap((actor, actorIndex) =>
      actor.promptTrack.items.map((item, clip) => ({
        actor: actor.subject,
        conditioning: item.conditioning,
        frameCount: item.range.duration,
        id: item.id,
        rootTrack: actor.rootTrack.items.flatMap((keyframe) =>
          keyframe.at.tick < item.range.start ||
          keyframe.at.tick >= item.range.start + item.range.duration
            ? []
            : [{ ...keyframe.data, frame: keyframe.at.tick - item.range.start }],
        ),
        seed: INITIAL_PRODUCT_SEED + actorIndex * 100 + clip,
        sourceFrameStart: actorIndex * frameCount + item.range.start,
        timelineFrameStart: item.range.start,
      })),
    ),
    frameCount,
    framesPerSecond: input.framesPerSecond,
    sourceFrameCount: input.composition.actors.length * frameCount,
  });

  const motion = MotionPresentationProgram.assert({
    actors: Object.fromEntries(
      input.composition.actors.map(({ row, subject, worldOffset }) => {
        return [
          subject,
          {
            sourceFrameStart: row * frameCount,
            timelineFrameCount: frameCount,
            timelineFrameStart: 0,
            worldOffset,
          },
        ];
      }),
    ),
    frameCount,
    framesPerSecond: input.framesPerSecond,
    jointCount: input.rig.motionRestPose.skeleton.jointCount,
    skeleton: input.rig.motionRestPose.skeleton.sourceTarget,
  });
  const skin = input.rig.rig.skin;
  const jointCount = input.rig.motionRestPose.skeleton.jointCount;
  const jointPositions = input.rig.motionRestPose.jointPositions;
  const parentIndices = input.rig.motionRestPose.skeleton.parentJointIndices;
  const influenceCount = skin.manifest.influencesPerVertex;
  const renderConfiguration = input.render ?? MotionRenderConfiguration.assert({});
  const render = MotionRenderProgram.assert({
    ...renderConfiguration,
    // The inverse bind transform is `[Rᵀ, -Rᵀt]` column-major; its transpose block is the bind
    // orientation the model's identity pose corresponds to.
    bindRotations: Array.from({ length: jointCount }, (_unused, joint) =>
      quaternionOfRotation(
        (row, column) => skin.inverseBindMatrices[joint * 16 + row * 4 + column]!,
      ),
    ),
    camera: compileMotionCameraProgram({ composition: input.composition }),
    frameCount,
    indices: [...skin.indices],
    inverseBindColumns: Array.from({ length: jointCount * 4 }, (_unused, column) => [
      skin.inverseBindMatrices[column * 4]!,
      skin.inverseBindMatrices[column * 4 + 1]!,
      skin.inverseBindMatrices[column * 4 + 2]!,
      skin.inverseBindMatrices[column * 4 + 3]!,
    ]),
    jointCount,
    parentIndices,
    restLocalTranslations: Array.from({ length: jointCount }, (_unused, joint) => {
      const parent = parentIndices[joint]!;
      return parent < 0
        ? [0, 0, 0]
        : [
            jointPositions[joint * 3]! - jointPositions[parent * 3]!,
            jointPositions[joint * 3 + 1]! - jointPositions[parent * 3 + 1]!,
            jointPositions[joint * 3 + 2]! - jointPositions[parent * 3 + 2]!,
          ];
    }),
    skeleton: input.rig.motionRestPose.skeleton.sourceTarget,
    vertices: Array.from({ length: skin.manifest.vertexCount }, (_unused, vertex) => {
      const influence = vertex * influenceCount;
      return {
        joints0: [
          skin.jointIndices[influence]!,
          skin.jointIndices[influence + 1]!,
          skin.jointIndices[influence + 2]!,
          skin.jointIndices[influence + 3]!,
        ],
        joints1: [skin.jointIndices[influence + 4] ?? 0, 0, 0, 0],
        normal: [
          skin.normals[vertex * 3]!,
          skin.normals[vertex * 3 + 1]!,
          skin.normals[vertex * 3 + 2]!,
        ],
        position: [
          skin.positions[vertex * 3]!,
          skin.positions[vertex * 3 + 1]!,
          skin.positions[vertex * 3 + 2]!,
        ],
        weights0: [
          skin.jointWeights[influence]!,
          skin.jointWeights[influence + 1]!,
          skin.jointWeights[influence + 2]!,
          skin.jointWeights[influence + 3]!,
        ],
        weights1: [skin.jointWeights[influence + 4] ?? 0, 0, 0, 0],
      };
    }),
  });

  return MotionPipelineProgram.assert({
    artifact: {
      composition: SCENE_COMPOSITION,
      id: `${input.artifact.id}/motion`,
      version: input.artifact.version,
    },
    compilation,
    motion,
    render,
  });
};
