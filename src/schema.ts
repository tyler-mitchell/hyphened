import { type } from "arktype";
import { arktypeAdaptersScope as adapters } from "arktype-adapters";
import { createTypeGpuStructFromArkTypeObject as typegpuStruct } from "arktype-adapters/typegpu";
import tgpu, { d } from "typegpu";

import {
  FRAMES_PER_TOKEN,
  STREAMING_WINDOW_FRAME_CAPACITY,
  TEXT_EMBEDDING_WIDTH,
} from "./provider/generation/layout";

export const COMPUTE_WORKGROUP_SIZE = 256;
export const DIFFUSION_WORKGROUP_SIZE = 64;
export const MOTION_FRAMES_PER_SECOND = 20;
/** The rigid-body solver substeps on a clock mapped from the motion frame. */
export const PHYSICS_SUBSTEP_CLOCK = "physicsSubstep";
export const PHYSICS_SUBSTEPS_PER_FRAME = 4;
export const INITIAL_SUBJECT_COUNT = 2;
export const INITIAL_PRODUCT_SEED = 2;
export const ONE_MOTION_FRAME = { motionFrame: 1 } as const;
export const DEFAULT_TEMPORAL_SHEET_COLUMNS = 4;
export const MOTION_DRIVER_POLICY = {
  maxStepsPerAdvance: 2,
} as const;

export const $ = type.module({
  ActorColors: "Vector4[] == 2",
  ActorTrackChild: { id: "string >= 1", kind: "'track'" },
  ActorLayout: {
    columns: "number.integer > 0",
    columnSpacing: "number >= 0",
    origin: "Vector3",
    rowSpacing: "number >= 0",
  },
  ActorPresence: { active: "boolean", subject: "string >= 1" },
  AuthoredActor: {
    prompts: "AuthoredPromptSpan[]",
    roots: "AuthoredRootConstraint[]",
    subject: "NonEmptyString",
  },
  AuthoredPromptSpan: {
    durationFrames: "number.integer > 0",
    prompt: "NonEmptyString",
    start: "U32",
  },
  AuthoredRootConstraint: { constraint: "RootConstraint", tick: "U32" },
  ActorGroup: {
    children: "ActorTrackChild[]",
    data: {
      label: "NonEmptyString",
      row: "U32",
      worldOffset: "ReadonlyVector3",
    },
    id: "string >= 1",
    kind: "'group'",
  },
  CameraItemData: "TimelineOrbitCameraItem | TimelineLookCameraItem",
  CameraPointTarget: { kind: "'point'", position: "Vector3" },
  CameraProjection: {
    far: "number > 0",
    fieldOfViewY: "0 < number < 3.141592653589793",
    near: "number > 0",
  },
  CameraTimelineItemInput: {
    data: "CameraItemData",
    durationFrames: "number.integer > 0",
    id: "string >= 1",
    startFrame: "number.integer >= 0",
  },
  ControlMotionInput: {
    action: "'pause' | 'play' | 'restart' | 'seek' | 'setRate' | 'step'",
    "frame?": "number.integer >= 0",
    "rate?": "number > 0",
    "ticks?": "number.integer",
  },
  EditSceneCompositionInput: {
    changes: "SceneCompositionChange[] >= 1",
    summary: "1 <= string <= 160",
    transactionId: ["string >= 1", "=", () => crypto.randomUUID()],
  },
  Finite: type("number").narrow(Number.isFinite),
  FiniteF32: type("number").narrow(
    (value) => Number.isFinite(value) && Math.fround(value) === value,
  ),
  GroundAppearance: {
    color: "Vector4",
    halfExtent: "number > 0",
    height: "number",
    visible: "boolean",
  },
  Joints: ["U32", "U32", "U32", "U32"],
  MotionActorBinding: {
    sourceFrameStart: "U32",
    timelineFrameCount: "number.integer > 0",
    timelineFrameStart: "U32",
    worldOffset: "Vector3",
  },
  MotionActorBindingRow: {
    padding: "tgpu.u32",
    sourceFrameStart: "tgpu.u32",
    timelineFrameCount: "tgpu.u32",
    timelineFrameStart: "tgpu.u32",
    worldOffset: "tgpu.vec4f",
  },
  MotionClipCompilation: {
    actor: "NonEmptyString",
    conditioning: { identity: "NonEmptyString" },
    frameCount: "number.integer > 0",
    id: "NonEmptyString",
    rootTrack: "RootKeyframe[]",
    seed: "U32",
    sourceFrameStart: "U32",
    timelineFrameStart: "U32",
  },
  MotionCompilationProgram: {
    clips: "MotionClipCompilation[] >= 1",
    frameCount: "number.integer > 0",
    framesPerSecond: "number > 0",
    sourceFrameCount: "number.integer > 0",
  },
  MotionEndEffectorJointGroup: {
    positionJointIndices: type("(number.integer >= 0)[]").readonly(),
    rotationJointIndices: type("(number.integer >= 0)[]").readonly(),
  },
  MotionModelConfig: {
    baseDiffusionSteps: "number.integer > 0",
    framesPerSecond: "number.integer > 0",
    generationFrames: "number.integer > 0",
  },
  MotionModelSource: {
    config: "MotionModelConfig",
    modelId: "string",
    profile: "string",
    revision: "string",
    skeleton: "MotionSkeletonDefinition",
  },
  MotionStatistics: {
    explicitMotionMean: "TypedArray.Float32",
    explicitMotionStandardDeviation: "TypedArray.Float32",
    localRootMean: "TypedArray.Float32",
    localRootStandardDeviation: "TypedArray.Float32",
    postQuantizationMean: "TypedArray.Float32",
    postQuantizationStandardDeviation: "TypedArray.Float32",
  },
  MotionPresentationInput: {
    actors: { "[string >= 1]": "MotionActorBinding" },
    frameCount: "number.integer > 0",
    framesPerSecond: "number > 0",
    jointCount: "number.integer > 0",
    skeleton: "string >= 1",
  },
  MotionPresentationProgram: {
    actorCount: "number.integer > 0",
    actors: "(string >= 1)[] >= 1",
    bindings: "MotionActorBindingRow[] >= 1",
    frameCount: "number.integer > 0",
    framesPerSecond: "number > 0",
    jointCount: "number.integer > 0",
    skeleton: "string >= 1",
  },
  MotionPromptSpan: ["PromptSpan", "&", { conditioning: { identity: "NonEmptyString" } }],
  MotionPromptTrack: { items: "MotionPromptSpan[]" },
  MotionRootTrack: { items: "RootTrackItem[]" },
  MotionSceneActor: {
    promptTrack: "MotionPromptTrack",
    row: "U32",
    rootTrack: "MotionRootTrack",
    subject: "NonEmptyString",
    worldOffset: "ReadonlyVector3",
  },
  MotionSceneComposition: {
    actors: "MotionSceneActor[] >= 1",
    cameraTrack: "TimelineCameraTrack",
    frameCount: "number.integer > 0",
    bodies: "SceneBody[]",
  },
  /**
   * A body as lowered from the composition: a box of a given mass standing on an actor's route
   * at a frame, its centre `elevation` above the ground. Zero mass is a fixed body.
   */
  SceneBody: {
    elevation: "number >= 0",
    halfExtents: "ReadonlyVector3",
    id: "NonEmptyString",
    mass: "number >= 0",
    subject: "NonEmptyString",
    tick: "U32",
  },
  BodyItemData: {
    elevation: "number >= 0",
    halfExtents: "ReadonlyVector3",
    label: "string >= 1",
    mass: "number >= 0",
    subject: "NonEmptyString",
  },
  BodyTrackItem: {
    at: { clock: "'motionFrame'", tick: "U32" },
    data: "BodyItemData",
    id: "string >= 1",
  },
  TimelineBodyTrack: {
    id: "'bodies'",
    items: "BodyTrackItem[]",
    kind: "'track'",
    overlap: "'allow'",
  },
  MotionPoseSampleRow: {
    padding: "tgpu.vec3u",
    present: "tgpu.u32",
    rootPosition: "tgpu.vec4f",
    rotation: "tgpu.vec4f",
  },
  MotionConditioningKeyframe: { frame: "U32", identity: "NonEmptyString" },
  MotionProductSpecification: {
    conditioning: "MotionConditioningKeyframe[] >= 1",
    frameCount: "number.integer > 0",
    /** Facing at frame 0 in radians; 0 faces +z. Route keyframes constrain position only. */
    initialHeadingRadians: "Finite",
    rootTrack: "RootKeyframe[]",
    seed: "U32",
  },
  MotionCameraProgram: {
    frames: "RenderCameraShot[] >= 1",
  },
  MotionRenderConfiguration: {
    actorColors: [
      "ActorColors",
      "=",
      (): [number, number, number, number][] => [
        [0.32, 0.55, 0.9, 1],
        [0.9, 0.48, 0.25, 1],
      ],
    ],
    actorCullMode: ["'none' | 'front' | 'back'", "=", "back"],
    ambientIntensity: "number >= 0 = 0.3",
    background: ["Vector4", "=", (): [number, number, number, number] => [0.955, 0.965, 0.975, 1]],
    cameraUp: ["Vector3", "=", (): [number, number, number] => [0, 1, 0]],
    directionalIntensity: "number >= 0 = 0.7",
    ground: [
      "GroundAppearance",
      "=",
      (): {
        color: [number, number, number, number];
        halfExtent: number;
        height: number;
        visible: boolean;
      } => ({ color: [0.82, 0.84, 0.87, 1], halfExtent: 40, height: 0, visible: true }),
    ],
    lightDirection: ["Vector3", "=", (): [number, number, number] => [0.45, 1, 0.35]],
  },
  MotionRenderProgram: [
    "MotionRenderConfiguration",
    "&",
    {
      /** Each joint's bind orientation as a unit quaternion; the skin palette rotates by it. */
      bindRotations: "Vector4[] >= 1",
      camera: "MotionCameraProgram",
      frameCount: "number.integer > 0",
      indices: "(number.integer >= 0)[] >= 3",
      inverseBindColumns: "Vector4[] >= 4",
      jointCount: "number.integer > 0",
      parentIndices: "(number.integer >= -1)[] >= 1",
      restLocalTranslations: "Vector3[] >= 1",
      skeleton: "string >= 1",
      vertices: "SkinnedVertex[] >= 1",
    },
  ],
  MotionRequest: {
    id: "NonEmptyString",
    product: "MotionProductSpecification",
    productFrameStart: "U32",
    revision: "U32",
    subject: "NonEmptyString",
    subjectGeneration: "U32",
  },
  MotionSubjectStateInput: { active: "boolean", generation: "U32", subject: "NonEmptyString" },
  MotionSubjectDefinition: {
    id: "NonEmptyString",
    row: "U32",
    worldOffset: "ReadonlyVector3",
  },
  MotionSkeletonDefinition: {
    endEffectorJointGroups: {
      Hips: "MotionEndEffectorJointGroup",
      LeftFoot: "MotionEndEffectorJointGroup",
      LeftHand: "MotionEndEffectorJointGroup",
      RightFoot: "MotionEndEffectorJointGroup",
      RightHand: "MotionEndEffectorJointGroup",
    },
    jointCount: "number.integer > 0",
    jointNames: type("string[]").readonly(),
    leftHipJointIndex: "number.integer >= 0",
    parentJointIndices: type("number.integer[]").readonly(),
    rightHipJointIndex: "number.integer >= 0",
    rootJointIndex: "number.integer >= 0",
    sourceTarget: "string > 0",
  },
  MotionSkeletonRestPose: {
    jointPositions: "TypedArray.Float32",
    skeleton: "MotionSkeletonDefinition",
  },
  MotionTemporalSheetInput: {
    "layout?": "TemporalSheetLayout",
    samples: "4 <= number.integer <= 24",
    stride: "1 <= number.integer <= 60",
    "subject?": "string >= 1",
    window: "TemporalSheetWindow",
  },
  MotionViewRow: {
    groundOrigin: "tgpu.vec4f",
    lightDirection: "tgpu.vec4f",
    viewProjection: "tgpu.mat4x4f",
  },
  MotionWorldTransformRow: {
    position: "tgpu.vec4f",
    rotation: "tgpu.vec4f",
  },
  NonEmptyString: type("string.trim").to("string >= 1"),
  PerspectiveProjection: ["CameraProjection", "&", { kind: "'perspective'" }],
  PromptItemData: { prompt: "string >= 1" },
  PromptSpan: {
    data: "PromptItemData",
    id: "NonEmptyString",
    range: { clock: "'motionFrame'", duration: "number.integer > 0", start: "number.integer >= 0" },
    "startEvent?": {
      data: "PromptItemData",
      kind: "'motion/prompt'",
      subject: "string >= 1",
    },
  },
  ReadSceneCompositionInput: { "composition?": "string >= 1" },
  ReadonlyVector3: type(["number", "number", "number"])
    .narrow((value) => value.every(Number.isFinite))
    .readonly(),
  RemoveCameraTimelineItemInput: { id: "string >= 1" },
  RenderCameraEntityTarget: {
    entities: "U32[] >= 1",
    kind: "'entities'",
    offset: "Vector3",
  },
  RenderCameraTarget: "RenderCameraEntityTarget | CameraPointTarget",
  RenderLookCameraShot: {
    interpolate: "boolean = true",
    mode: "'look-at'",
    position: "Vector3",
    projection: "CameraProjection",
    target: "RenderCameraTarget",
  },
  RenderOrbitCameraShot: {
    distance: "number > 0",
    interpolate: "boolean = true",
    mode: "'orbit'",
    pitch: "Finite",
    projection: "CameraProjection",
    target: "RenderCameraTarget",
    yaw: "Finite",
  },
  RenderCameraShot: "RenderOrbitCameraShot | RenderLookCameraShot",
  RootConstraint: { position: ["Finite", "Finite"] },
  RootKeyframe: ["RootConstraint", "&", { frame: "U32" }],
  RootTrackItem: {
    at: { clock: "'motionFrame'", tick: "number.integer >= 0" },
    data: "RootConstraint",
  },
  RootTrack: {
    items: "RootTrackItem[]",
  },
  SceneAtInput: { frame: "number.integer >= 0" },
  SceneCameraEntityTarget: { kind: "'entities'", offset: "Vector3" },
  SceneCameraTarget: "SceneCameraEntityTarget | CameraPointTarget",
  SceneCompositionChange: { type: "SceneCompositionChangeType" },
  SceneCompositionChangeType: type.enumerated(
    "composition/add",
    "composition/remove",
    "composition/replace",
    "item/add",
    "item/move",
    "item/remove",
    "item/replace",
    "item/set-composition",
    "item/set-data",
    "item/set-duration",
    "item/set-range",
    "item/set-source",
    "item/set-source-map",
    "item/slide",
    "item/slip",
    "item/split",
    "item/trim",
    "marker/add",
    "marker/move",
    "marker/remove",
    "node/add",
    "node/move",
    "node/remove",
    "node/set-data",
    "track/configure",
    "transition/add",
    "transition/remove",
    "transition/set-duration",
  ),
  SceneCompositionInput: { children: "unknown[]", clock: "'motionFrame'" },
  SceneHistoryInput: {
    action: "'undo' | 'redo'",
    transactionId: ["string >= 1", "=", () => crypto.randomUUID()],
  },
  SceneLookCameraShot: { label: "string >= 1", mode: "'look-at'", position: "Vector3" },
  SceneOrbitCameraShot: {
    distance: "number > 0",
    label: "string >= 1",
    mode: "'orbit'",
    pitch: "Finite",
    yaw: "Finite",
  },
  SceneCameraShot: "SceneOrbitCameraShot | SceneLookCameraShot",
  ScenePresentationCamera: {
    cutFraction: "0 < number < 1",
    label: "string >= 1",
    projection: "PerspectiveProjection",
    shots: "SceneCameraShot[] == 2",
    target: "SceneCameraTarget",
  },
  ScenePresentationConfiguration: {
    actorLayout: "ActorLayout",
    camera: "ScenePresentationCamera",
  },
  SceneReadinessInput: {},
  SetMotionSpanInput: {
    actor: "NonEmptyString",
    durationFrames: "number.integer > 0",
    prompt: "NonEmptyString",
    startFrame: "number.integer >= 0",
  },
  SceneWindowInput: {
    durationFrames: "1 <= number.integer <= 100000",
    startFrame: "number.integer >= 0",
  },
  SkinnedVertex: {
    joints0: "Joints",
    joints1: ["Joints", "=", (): [number, number, number, number] => [0, 0, 0, 0]],
    normal: "Vector3",
    position: "Vector3",
    weights0: "Weights",
    weights1: ["Weights", "=", (): [number, number, number, number] => [0, 0, 0, 0]],
  },
  TemporalSheetCurrentWindow: { kind: "'current'" },
  TemporalSheetFrameWindow: { frame: "number.integer >= 0", kind: "'frame'" },
  TemporalSheetLayout: {
    "background?": [
      "0 <= number.integer <= 255",
      "0 <= number.integer <= 255",
      "0 <= number.integer <= 255",
    ],
    "cellScale?": "0 < number <= 4",
    "columns?": "1 <= number.integer <= 12",
    "format?": "'jpeg' | 'png' | 'webp'",
    "gap?": "0 <= number.integer <= 128",
    "quality?": "0 <= number <= 1",
    "smoothing?": "boolean",
  },
  TemporalSheetWindow: "TemporalSheetCurrentWindow | TemporalSheetFrameWindow",
  TextEmbedding: {
    identity: "TextEmbeddingIdentity",
    prompt: "NonEmptyString",
    source: "TextEmbeddingSource",
    values: "TextEmbeddingArray",
  },
  TextEmbeddingArray: `FiniteF32[] == ${TEXT_EMBEDDING_WIDTH}`,
  TextEmbeddingArtifactIdentity: {
    kind: "'artifact'",
    sha256: "NonEmptyString",
  },
  TextEmbeddingIdentity: "TextEmbeddingArtifactIdentity",
  TextEmbeddingInput: {
    identity: "TextEmbeddingIdentity",
    prompt: "NonEmptyString",
    source: "TextEmbeddingSource",
    values: "TextEmbeddingValues",
  },
  TextEmbeddingModelRevision: {
    model: "NonEmptyString",
    revision: "NonEmptyString",
    role: "NonEmptyString",
  },
  TextEmbeddingSource: {
    "endpoint?": "NonEmptyString",
    featureWidth: type.unit(TEXT_EMBEDDING_WIDTH),
    id: "NonEmptyString",
    kind: "'browser-quantized' | 'released-exact'",
    modelRevisions: "TextEmbeddingModelRevision[] >= 1",
  },
  TextEmbeddingFloat32: type
    .instanceOf(Float32Array)
    .narrow((values) => values.length === TEXT_EMBEDDING_WIDTH && values.every(Number.isFinite)),
  TextEmbeddingValues: "TextEmbeddingArray | TextEmbeddingFloat32",
  TimelineCameraEntityTarget: {
    entities: "(string >= 1)[] >= 1",
    kind: "'entities'",
    offset: "Vector3",
  },
  TimelineCameraTarget: "TimelineCameraEntityTarget | CameraPointTarget",
  TimelineCameraTrackItem: {
    data: "CameraItemData",
    range: {
      clock: "'motionFrame'",
      duration: "number.integer > 0",
      start: "number.integer >= 0",
    },
  },
  TimelineCameraTrack: {
    id: "'camera'",
    items: "TimelineCameraTrackItem[]",
    kind: "'track'",
    overlap: "'forbid'",
  },
  TimelineLookCameraItem: {
    kind: "'camera'",
    label: "string >= 1",
    mode: "'look-at'",
    position: "Vector3",
    projection: "PerspectiveProjection",
    target: "TimelineCameraTarget",
  },
  TimelineOrbitCameraItem: {
    distance: "number > 0",
    kind: "'camera'",
    label: "string >= 1",
    mode: "'orbit'",
    pitch: "Finite",
    projection: "PerspectiveProjection",
    target: "TimelineCameraTarget",
    yaw: "Finite",
  },
  U32: "0 <= number.integer <= 4294967295",
  Vector3: ["Finite", "Finite", "Finite"],
  Vector4: ["Finite", "Finite", "Finite", "Finite"],
  Weights: ["0 <= number <= 1", "0 <= number <= 1", "0 <= number <= 1", "0 <= number <= 1"],
  tgpu: adapters.export().tgpu,
});

export const MotionActorBinding = typegpuStruct($.MotionActorBindingRow);
export const MotionPoseSample = typegpuStruct($.MotionPoseSampleRow);
export const MotionWorldTransform = typegpuStruct($.MotionWorldTransformRow);
export const MotionView = typegpuStruct($.MotionViewRow);

export const motionViewBindings = tgpu.bindGroupLayout({
  view: { storage: d.arrayOf(MotionView), access: "readonly" },
});

export const MotionRenderConfiguration = $.MotionRenderConfiguration;
export type MotionRenderConfiguration = typeof MotionRenderConfiguration.infer;
export type MotionRenderConfigurationInput = typeof MotionRenderConfiguration.inferIn;

export const MotionPresentationProgram = $.MotionPresentationInput.narrow(
  (program, context) =>
    (Object.values(program.actors).length > 0 &&
      Object.values(program.actors).every(
        ({ timelineFrameCount, timelineFrameStart }) =>
          timelineFrameStart + timelineFrameCount <= program.frameCount,
      )) ||
    context.mustBe("Actor bindings inside the timeline frame extent"),
)
  .pipe((program) => ({
    actorCount: Object.keys(program.actors).length,
    actors: Object.keys(program.actors),
    bindings: Object.values(program.actors).map((binding) =>
      MotionActorBinding({
        padding: 0,
        sourceFrameStart: binding.sourceFrameStart,
        timelineFrameCount: binding.timelineFrameCount,
        timelineFrameStart: binding.timelineFrameStart,
        worldOffset: d.vec4f(...binding.worldOffset, 0),
      }),
    ),
    frameCount: program.frameCount,
    framesPerSecond: program.framesPerSecond,
    jointCount: program.jointCount,
    skeleton: program.skeleton,
  }))
  .to($.MotionPresentationProgram);
export type MotionPresentationProgram = typeof MotionPresentationProgram.infer;

export const MotionCameraProgram = $.MotionCameraProgram;
export type MotionCameraProgram = typeof MotionCameraProgram.infer;

export const MotionRenderProgram = $.MotionRenderProgram.narrow(
  (program, context) =>
    (program.camera.frames.length === program.frameCount &&
      program.camera.frames.every((frame) => frame.projection.far > frame.projection.near) &&
      program.inverseBindColumns.length === program.jointCount * 4 &&
      program.parentIndices.length === program.jointCount &&
      program.parentIndices[0] === -1 &&
      program.parentIndices.slice(1).every((parent, index) => parent >= 0 && parent <= index) &&
      program.restLocalTranslations.length === program.jointCount &&
      program.indices.every((index) => index < program.vertices.length) &&
      program.vertices.every(({ joints0, joints1 }) =>
        [...joints0, ...joints1].every((joint) => joint < program.jointCount),
      )) ||
    context.mustBe("mesh indices and skin joints inside their declared ranges"),
);
export type MotionRenderProgram = typeof MotionRenderProgram.infer;

export const RootConstraint = $.RootConstraint;
export type RootConstraint = typeof RootConstraint.infer;

export const AuthoredPromptSpan = $.AuthoredPromptSpan.readonly();
export type AuthoredPromptSpan = typeof AuthoredPromptSpan.infer;
export const AuthoredRootConstraint = $.AuthoredRootConstraint.readonly();
export type AuthoredRootConstraint = typeof AuthoredRootConstraint.infer;
export const AuthoredActor = $.AuthoredActor.merge({
  prompts: AuthoredPromptSpan.array().readonly(),
  roots: AuthoredRootConstraint.array().readonly(),
}).readonly();
export type AuthoredActor = typeof AuthoredActor.infer;

/** Immutable authored content from which a provider constructs one shareable motion product. */
export const MotionProductSpecification = $.MotionProductSpecification.narrow(
  ({ conditioning, frameCount, rootTrack }, context) =>
    (rootTrack.every(
      ({ frame }, index) =>
        frame < frameCount && (index === 0 || frame > rootTrack[index - 1]!.frame),
    ) &&
      conditioning[0]!.frame === 0 &&
      conditioning.every(
        ({ frame }, index) =>
          frame < frameCount && (index === 0 || frame > conditioning[index - 1]!.frame),
      )) ||
    context.mustBe("ascending root keyframes and conditioning keyframes from frame 0"),
);
export type MotionProductSpecification = typeof MotionProductSpecification.infer;

/** Durable request assigning one immutable motion specification to one subject occurrence. */
export const MotionRequest = $.MotionRequest.merge({ product: MotionProductSpecification });
export type MotionRequest = typeof MotionRequest.infer;

export const MotionSubjectStateInput = $.MotionSubjectStateInput;
export type MotionSubjectDefinition = typeof $.MotionSubjectDefinition.infer;

export const MotionSkeletonDefinition = $.MotionSkeletonDefinition.narrow((skeleton, context) => {
  const jointIndices = [
    skeleton.rootJointIndex,
    skeleton.leftHipJointIndex,
    skeleton.rightHipJointIndex,
    ...Object.values(skeleton.endEffectorJointGroups).flatMap((group) => [
      ...group.positionJointIndices,
      ...group.rotationJointIndices,
    ]),
  ];
  return (
    (skeleton.jointNames.length === skeleton.jointCount &&
      new Set(skeleton.jointNames).size === skeleton.jointCount &&
      skeleton.parentJointIndices.length === skeleton.jointCount &&
      skeleton.parentJointIndices.every((parent, joint) =>
        joint === skeleton.rootJointIndex ? parent === -1 : parent >= 0 && parent < joint,
      ) &&
      jointIndices.every((joint) => joint < skeleton.jointCount)) ||
    context.mustBe("a topologically ordered skeleton hierarchy with in-range joint references")
  );
});
export type MotionSkeletonDefinition = typeof MotionSkeletonDefinition.infer;

export const MotionSkeletonRestPose = $.MotionSkeletonRestPose.merge({
  skeleton: MotionSkeletonDefinition,
}).narrow(
  ({ jointPositions, skeleton }, context) =>
    (jointPositions.length === skeleton.jointCount * 3 && jointPositions.every(Number.isFinite)) ||
    context.mustBe("one finite xyz rest position per skeleton joint"),
);
export type MotionSkeletonRestPose = typeof MotionSkeletonRestPose.infer;

export const MotionModelConfig = $.MotionModelConfig.narrow(
  ({ generationFrames }, context) =>
    (generationFrames % FRAMES_PER_TOKEN === 0 &&
      generationFrames + FRAMES_PER_TOKEN <= STREAMING_WINDOW_FRAME_CAPACITY) ||
    context.mustBe(
      `a whole-token generation horizon within the ${STREAMING_WINDOW_FRAME_CAPACITY}-frame model window`,
    ),
);
export type MotionModelConfig = typeof MotionModelConfig.infer;

export const MotionModelSource = $.MotionModelSource.merge({
  config: MotionModelConfig,
  skeleton: MotionSkeletonDefinition,
}).pipe((identity) => {
  const artifactRoot = `/api/models/${identity.profile}/${identity.revision}`;
  return {
    ...identity,
    artifactRoot,
    denoiser: `${artifactRoot}/denoiser`,
    statistics: {
      motionMean: `${artifactRoot}/motion-mean`,
      motionStd: `${artifactRoot}/motion-std`,
      postQuantizationMean: `${artifactRoot}/post-quantization-mean`,
      postQuantizationStd: `${artifactRoot}/post-quantization-std`,
    },
    tokenizer: `${artifactRoot}/tokenizer`,
  };
});
export type MotionModelSource = typeof MotionModelSource.infer;

export const MotionStatistics = $.MotionStatistics.readonly();
export type MotionStatistics = typeof MotionStatistics.infer;

/** Immutable provider jobs derived from one exact authored composition revision. */
export const MotionCompilationProgram = $.MotionCompilationProgram.narrow(
  (program, context) =>
    (program.clips.every(
      (clip) =>
        clip.timelineFrameStart + clip.frameCount <= program.frameCount &&
        clip.sourceFrameStart + clip.frameCount <= program.sourceFrameCount &&
        clip.rootTrack.every(({ frame }) => frame < clip.frameCount),
    ) &&
      new Set(program.clips.map(({ id }) => id)).size === program.clips.length) ||
    context.mustBe("uniquely identified motion clips inside the timeline and source extents"),
);
export type MotionCompilationProgram = typeof MotionCompilationProgram.infer;

export const MotionPipelineProgram = type({
  artifact: {
    composition: $.NonEmptyString,
    id: $.NonEmptyString,
    version: $.NonEmptyString,
  },
  compilation: MotionCompilationProgram,
  motion: MotionPresentationProgram.out,
  render: MotionRenderProgram.out,
}).narrow(
  (program, context) =>
    (program.motion.frameCount === program.render.frameCount &&
      program.compilation.frameCount === program.motion.frameCount &&
      program.compilation.framesPerSecond === program.motion.framesPerSecond &&
      program.motion.jointCount === program.render.jointCount &&
      program.motion.skeleton === program.render.skeleton) ||
    context.mustBe("one frame extent and skeleton shared by motion and rendering"),
);

export type MotionPipelineProgram = typeof MotionPipelineProgram.infer;

/** Seed presentation for a new composition; persisted timeline items become authoritative afterward. */
export const ScenePresentationConfiguration = $.ScenePresentationConfiguration.merge({
  actorLayout: $.ActorLayout.default((): typeof $.ActorLayout.infer => ({
    columns: 2,
    columnSpacing: 4,
    origin: [0, 0, 0],
    rowSpacing: 3,
  })),
  camera: $.ScenePresentationCamera.default((): typeof $.ScenePresentationCamera.infer => ({
    cutFraction: 0.5,
    label: "Camera",
    projection: {
      far: 1_000,
      fieldOfViewY: Math.PI / 4,
      kind: "perspective",
      near: 0.1,
    },
    // Both shots orbit the actors' centroid; at four metres of column spacing plus the route sway,
    // the distance must hold both bodies in the 45 degree field.
    shots: [
      {
        distance: 9,
        label: "Opening Camera",
        mode: "orbit",
        pitch: 0.22,
        yaw: 0.55,
      },
      {
        distance: 10,
        label: "Side Camera",
        mode: "orbit",
        pitch: 0.12,
        yaw: 1.1,
      },
    ],
    target: { kind: "entities", offset: [0, 0, 0] },
  })),
});
export type ScenePresentationConfiguration = typeof ScenePresentationConfiguration.infer;
export type ScenePresentationConfigurationInput = typeof ScenePresentationConfiguration.inferIn;

export const ActorPresence = $.ActorPresence;
export type ActorPresence = typeof ActorPresence.infer;
export const CameraItemData = $.CameraItemData.narrow(
  (camera, context) =>
    camera.projection.far > camera.projection.near ||
    context.mustBe("a camera whose far plane exceeds its near plane"),
);
export type CameraItemData = typeof CameraItemData.infer;
export const PromptItemData = $.PromptItemData;
export type PromptItemData = typeof PromptItemData.infer;
export const BodyItemData = $.BodyItemData;
export type BodyItemData = typeof BodyItemData.infer;
export type MotionSceneComposition = typeof $.MotionSceneComposition.infer;

export const DEFAULT_SCENE_PRESENTATION = ScenePresentationConfiguration.assert({});

export const SetCameraTimelineItemInput = $.CameraTimelineItemInput;
export const RemoveCameraTimelineItemInput = $.RemoveCameraTimelineItemInput;
export const ControlMotionInput = $.ControlMotionInput;
export const EditSceneCompositionInput = $.EditSceneCompositionInput;
export const ReadSceneCompositionInput = $.ReadSceneCompositionInput;
export const SceneAtInput = $.SceneAtInput;
export const SceneHistoryInput = $.SceneHistoryInput;
export const SceneReadinessInput = $.SceneReadinessInput;
export const SceneWindowInput = $.SceneWindowInput;
export const SetMotionSpanInput = $.SetMotionSpanInput;
export const MotionTemporalSheetInput = $.MotionTemporalSheetInput;

export const TextEmbedding = $.TextEmbedding;
export type TextEmbedding = typeof TextEmbedding.infer;
