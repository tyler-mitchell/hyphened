import { type } from "arktype";
import { createTypeGpuStructFromArkTypeObject as typegpuStruct } from "arktype-adapters/typegpu";
import tgpu, { d } from "typegpu";
import {
  MotionCompilationProgram,
  MotionPresentationProgram,
  motionModelScope,
} from "webgpu-engine/motion";

import { CAMERA_SHOT_PRESETS } from "./scene/cinematography";

/** The rigid-body solver substeps on a clock mapped from the motion frame. */
export const PHYSICS_SUBSTEP_CLOCK = "physicsSubstep";
/** Actor rows kept beyond the story's cast so an actor can be added while the scene runs. */
export const ACTOR_POOL_SPARE = 2;
export const PHYSICS_SUBSTEPS_PER_FRAME = 4;
export const INITIAL_SUBJECT_COUNT = 2;
export const DEFAULT_TEMPORAL_SHEET_COLUMNS = 4;
export const DEFAULT_TEMPORAL_SHEET_CELL_WIDTH = 480;

/** The application's authoring vocabulary, composed over the motion model's own scope. */
export const $ = type.module({
  ...motionModelScope.export(),
  ActorColors: "Vector4[] == 2",
  ActorTrackChild: { id: "string >= 1", kind: "'track'" },
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
  /** One beat of an actor's scenario: a caption held for a number of frames. */
  AuthoredBeat: { frames: "number.integer > 0", prompt: "NonEmptyString" },
  /** One shot of a story's coverage: a preset on the actor of a row over a frame range. */
  AuthoredShot: { end: "U32", preset: "CameraShotPreset", row: "U32", start: "U32" },
  /**
   * A story as an agent authors it and as the built-in scenes are written: each actor is where it
   * stands in the world, the planar path it follows in its own frame, and its beats in order; the
   * coverage is the cuts, contiguous from frame 0 to the end.
   */
  AuthoredStory: {
    actors: "AuthoredStoryActor[] >= 1",
    coverage: "AuthoredShot[] >= 1",
    frameCount: "number.integer > 0",
    title: "string >= 1",
  },
  AuthoredStoryActor: {
    origin: "Vector3",
    path: "PlanarPoint[] >= 1",
    scenario: "AuthoredBeat[] >= 1",
  },
  AuthorSceneInput: { story: "AuthoredStory" },
  /** A new actor while the scene runs: where it stands, its path, and its beats; beats default to standing still. */
  AddActorInput: {
    origin: "Vector3",
    "path?": "PlanarPoint[] >= 1",
    "scenario?": "AuthoredBeat[] >= 1",
  },
  RemoveActorInput: { actor: "NonEmptyString" },
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
  /**
   * A shot as an agent authors it: a named preset framed off the subject's heading, or an explicit
   * orbit or look-at view. Projection and target default to the scene's when omitted; a focal
   * length in millimetres (35 mm filmback) sets the field of view.
   */
  CameraShotInput: "PresetCameraShotInput | OrbitCameraShotInput | LookCameraShotInput",
  CameraShotPreset: type.enumerated(...CAMERA_SHOT_PRESETS),
  PresetCameraShotInput: {
    kind: "'camera'",
    "label?": "string >= 1",
    preset: "CameraShotPreset",
    subject: "string >= 1",
  },
  CameraTimelineItemInput: {
    data: "CameraShotInput",
    durationFrames: "number.integer > 0",
    id: "string >= 1",
    startFrame: "number.integer >= 0",
  },
  ControlMotionInput: {
    action: "'newScene' | 'pause' | 'play' | 'restart' | 'seek' | 'setRate' | 'step'",
    "frame?": "number.integer >= 0",
    "rate?": "number > 0",
    /** For newScene: the built-in story to open; the default story when omitted. */
    "story?": "string >= 1",
    "ticks?": "number.integer",
  },
  EditSceneCompositionInput: {
    changes: "SceneCompositionChange[] >= 1",
    summary: "1 <= string <= 160",
    transactionId: [
      "string >= 1",
      "=",
      () => `agent/edit_scene_composition/${crypto.randomUUID()}`,
    ],
  },
  GroundAppearance: {
    color: "Vector4",
    halfExtent: "number > 0",
    height: "number",
    visible: "boolean",
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
  MotionTemporalSheetInput: {
    "layout?": "TemporalSheetLayout",
    samples: "1 <= number.integer <= 24",
    stride: "1 <= number.integer <= 60",
    "subject?": "string >= 1",
    window: "TemporalSheetWindow",
  },
  MotionViewRow: {
    groundOrigin: "tgpu.vec4f",
    lightDirection: "tgpu.vec4f",
    viewProjection: "tgpu.mat4x4f",
  },
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
  ReadSceneSummaryInput: {},
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
  SceneAtInput: { frame: "number.integer >= 0" },
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
    transactionId: ["string >= 1", "=", () => `agent/history/${crypto.randomUUID()}`],
  },
  ScenePresentationCamera: {
    label: "string >= 1",
    projection: "PerspectiveProjection",
  },
  ScenePresentationConfiguration: {
    camera: "ScenePresentationCamera",
  },
  SceneReadinessInput: {},
  ReadSceneHistoryInput: {},
  /**
   * Filters over the prompt library, per docs/internal/motion-library.md. Without a filter and
   * without `all` the tool returns counts and no entries; filters combine with AND; an entry
   * without a facet never matches a filter on it; `limit` bounds every reply that carries entries.
   * The cap of 200 is the size of the largest planned category, so one call reads one full
   * category and no more; a larger limit is refused, not clamped, so an agent learns to narrow.
   */
  ListMotionPromptsInput: {
    "all?": "boolean",
    "category?": "NonEmptyString",
    "enter?": "NonEmptyString",
    "exit?": "NonEmptyString",
    limit: "1 <= number.integer <= 200 = 100",
    "maxPace?": "number >= 0",
    "minPace?": "number >= 0",
    "tag?": "NonEmptyString",
  },
  EncodeMotionPromptInput: { "pace?": "number >= 0", prompt: "NonEmptyString" },
  PlanarPoint: ["Finite", "Finite"],
  RemoveBodyInput: { id: "NonEmptyString" },
  SetActorPathInput: { actor: "NonEmptyString", path: "PlanarPoint[] >= 1" },
  SetBodyInput: {
    "elevation?": "number >= 0",
    halfExtents: "ReadonlyVector3",
    "id?": "NonEmptyString",
    label: "string >= 1",
    mass: "number >= 0",
    subject: "NonEmptyString",
    tick: "U32",
  },
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
    "cellWidth?": "64 <= number.integer <= 2048",
    "columns?": "1 <= number.integer <= 12",
    "format?": "'jpeg' | 'png' | 'webp'",
    "gap?": "0 <= number.integer <= 128",
    "quality?": "0 <= number <= 1",
    "smoothing?": "boolean",
  },
  TemporalSheetWindow: "TemporalSheetCurrentWindow | TemporalSheetFrameWindow",
  TimelineCameraEntityTarget: {
    entities: "(string >= 1)[] >= 1",
    kind: "'entities'",
    offset: "Vector3",
  },
  TimelineCameraTarget: "TimelineCameraEntityTarget | CameraPointTarget",
  TimelineCameraTrackItem: {
    data: "CameraItemData",
    id: "string >= 1",
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
  /** A camera item with `to` moves from its view to that view across its own frames, eased. */
  TimelineLookCameraItem: {
    kind: "'camera'",
    label: "string >= 1",
    mode: "'look-at'",
    position: "Vector3",
    projection: "PerspectiveProjection",
    target: "TimelineCameraTarget",
    "to?": { position: "Vector3" },
  },
  TimelineOrbitCameraItem: {
    distance: "number > 0",
    kind: "'camera'",
    label: "string >= 1",
    mode: "'orbit'",
    pitch: "Finite",
    projection: "PerspectiveProjection",
    target: "TimelineCameraTarget",
    "to?": { distance: "number > 0", pitch: "Finite", yaw: "Finite" },
    yaw: "Finite",
  },
  LookCameraShotInput: {
    "focalLength?": "number > 0",
    kind: "'camera'",
    label: "string >= 1",
    mode: "'look-at'",
    position: "Vector3",
    "projection?": "PerspectiveProjection",
    "target?": "TimelineCameraTarget",
    "to?": { position: "Vector3" },
  },
  OrbitCameraShotInput: {
    distance: "number > 0",
    "focalLength?": "number > 0",
    kind: "'camera'",
    label: "string >= 1",
    mode: "'orbit'",
    pitch: "Finite",
    "projection?": "PerspectiveProjection",
    "target?": "TimelineCameraTarget",
    "to?": { distance: "number > 0", pitch: "Finite", yaw: "Finite" },
    yaw: "Finite",
  },
});

export const MotionView = typegpuStruct($.MotionViewRow);

export const motionViewBindings = tgpu.bindGroupLayout({
  view: { storage: d.arrayOf(MotionView), access: "readonly" },
});

export const MotionRenderConfiguration = $.MotionRenderConfiguration;
export type MotionRenderConfiguration = typeof MotionRenderConfiguration.infer;
export type MotionRenderConfigurationInput = typeof MotionRenderConfiguration.inferIn;

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

export const AuthoredPromptSpan = $.AuthoredPromptSpan.readonly();
export type AuthoredPromptSpan = typeof AuthoredPromptSpan.infer;
export const AuthoredRootConstraint = $.AuthoredRootConstraint.readonly();
export type AuthoredRootConstraint = typeof AuthoredRootConstraint.infer;
export const AuthoredActor = $.AuthoredActor.merge({
  prompts: AuthoredPromptSpan.array().readonly(),
  roots: AuthoredRootConstraint.array().readonly(),
}).readonly();
export type AuthoredActor = typeof AuthoredActor.infer;

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
  camera: $.ScenePresentationCamera.default((): typeof $.ScenePresentationCamera.infer => ({
    label: "Camera",
    projection: {
      far: 1_000,
      fieldOfViewY: Math.PI / 4,
      kind: "perspective",
      near: 0.1,
    },
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
export const ListMotionPromptsInput = $.ListMotionPromptsInput;
export const ReadSceneHistoryInput = $.ReadSceneHistoryInput;
export const EncodeMotionPromptInput = $.EncodeMotionPromptInput;
export const RemoveCameraTimelineItemInput = $.RemoveCameraTimelineItemInput;
export const ControlMotionInput = $.ControlMotionInput;
export const EditSceneCompositionInput = $.EditSceneCompositionInput;
export const ReadSceneCompositionInput = $.ReadSceneCompositionInput;
export const ReadSceneSummaryInput = $.ReadSceneSummaryInput;
export const SceneAtInput = $.SceneAtInput;
export const SceneHistoryInput = $.SceneHistoryInput;
export const SceneReadinessInput = $.SceneReadinessInput;
export const SceneWindowInput = $.SceneWindowInput;
export const SetMotionSpanInput = $.SetMotionSpanInput;
export const SetActorPathInput = $.SetActorPathInput;
export const SetBodyInput = $.SetBodyInput;
export const RemoveBodyInput = $.RemoveBodyInput;

/**
 * Schedules the physics capability consumes for bodies placed, changed, or removed after the
 * scene opens. Loose bodies spawn into and retire from pool rows; fixed bodies are static
 * colliders whose pose, extent, and presence one update schedule changes in place.
 */
export const PHYSICS_SPAWN_SCHEDULE = "physics/spawn";
export const PHYSICS_RETIRE_SCHEDULE = "physics/retire";
export const PHYSICS_STATIC_UPDATE_SCHEDULE = "physics/static-update";
/** Free pool rows and free static collider rows kept for bodies placed after the scene opens. */
export const BODY_POOL_SPARE = 8;
export const MotionTemporalSheetInput = $.MotionTemporalSheetInput;
export const AuthoredStory = $.AuthoredStory;
export type AuthoredStory = typeof AuthoredStory.infer;
export const AuthorSceneInput = $.AuthorSceneInput;
export const AddActorInput = $.AddActorInput;
export const RemoveActorInput = $.RemoveActorInput;
