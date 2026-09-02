import type { TimelineRuntime } from "@coretime/core";
import type { WebGpuCanvasSession } from "webgpu-engine/react";

import { loadHumanoidRigAssets } from "../rig/skin";
import { bindMotionRig } from "../rig/binding";
import { initialRequestFor, subjectAdmissionCommands } from "../motion/schedule";
import { MOTION_FRAMES_PER_SECOND, motionTimelineDeclaration } from "../scene/timeline";
import { loadMotionProvider } from "../provider/load";
import { loadTextEmbedding, MOTION_PROMPT_LIBRARY } from "../provider/embedding";
import {
  actorGroup,
  cameraTrack,
  compositionRevision,
  SCENE_COMPOSITION,
  SceneComposition,
} from "../scene/composition";
import {
  MotionRenderConfiguration,
  type MotionRenderConfigurationInput,
  INITIAL_SUBJECT_COUNT,
  ScenePresentationConfiguration,
  type ScenePresentationConfigurationInput,
} from "../schema";
import { SCENE_SPAN_FRAMES } from "../scene/default";
import { compileMotionPipelineProgram } from "./compile";
import { createMotionPipelineSystem } from "./system";

// Props are placed by the story: a crate a second and a half into each actor's first run, so a
// running body meets it, and a bar two and a half seconds into its duck span, past the first
// full window under that prompt.
const PROP_PLACEMENTS = {
  beams: { framesIn: 50, prompt: "Duck under obstacle and rise." },
  crates: { framesIn: 30, prompt: "A person is running." },
} as const;

/** The world position of each actor's first route vertex after a frame into its first span of a prompt. */
const routePointsAt = (
  composition: SceneComposition,
  placement: { readonly framesIn: number; readonly prompt: string },
) =>
  composition.actors.flatMap(({ promptTrack, rootTrack, worldOffset }) => {
    const span = promptTrack.items.find(({ data }) => data.prompt === placement.prompt);
    const vertex =
      span === undefined
        ? undefined
        : rootTrack.items.find(({ at }) => at.tick >= span.range.start + placement.framesIn);
    return vertex === undefined
      ? []
      : [
          [
            worldOffset[0] + vertex.data.position[0],
            worldOffset[1],
            worldOffset[2] + vertex.data.position[1],
          ] as const,
        ];
  });

/** Acquire authored data and assets, then return one framework-owned production session. */
export const openMotionProduction = async (input: {
  readonly presentation?: ScenePresentationConfigurationInput;
  readonly render?: MotionRenderConfigurationInput;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): Promise<WebGpuCanvasSession<typeof motionTimelineDeclaration>> => {
  const [provider, rig, ...loadedEmbeddings] = await Promise.all([
    loadMotionProvider(),
    loadHumanoidRigAssets(),
    ...MOTION_PROMPT_LIBRARY.map((source) => loadTextEmbedding({ source })),
  ]);
  if (provider.status === "unavailable") throw new Error(provider.reason);
  const unavailableEmbedding = loadedEmbeddings.find(({ status }) => status === "unavailable");
  if (unavailableEmbedding?.status === "unavailable") throw new Error(unavailableEmbedding.reason);
  const embeddings = loadedEmbeddings.flatMap((loaded) =>
    loaded.status === "available" ? [loaded.value] : [],
  );
  const binding = bindMotionRig({ motionSkeleton: provider.manifest.skeleton, rig });
  if (binding.status === "unavailable") throw new Error(binding.reason);
  if (provider.manifest.config.framesPerSecond !== MOTION_FRAMES_PER_SECOND) {
    throw new Error("the motion provider and production timeline must use the same frame rate");
  }

  const presentation = ScenePresentationConfiguration.assert(input.presentation ?? {});
  const render = MotionRenderConfiguration.assert(input.render ?? {});
  const layout = presentation.actorLayout;
  const seeded = Array.from({ length: INITIAL_SUBJECT_COUNT }, (_unused, row) => {
    const column = row % layout.columns;
    return {
      id: `actor-${row + 1}`,
      row,
      worldOffset: [
        layout.origin[0] + (column - (layout.columns - 1) / 2) * layout.columnSpacing,
        layout.origin[1],
        layout.origin[2] + Math.floor(row / layout.columns) * layout.rowSpacing,
      ] as const,
    };
  });
  await input.timeline.composition.initialize({
    compositions: {
      [SCENE_COMPOSITION]: {
        children: [
          cameraTrack({
            durationFrames: SCENE_SPAN_FRAMES,
            entities: seeded.map(({ id }) => id),
            presentation: presentation.camera,
          }),
          ...seeded.map(actorGroup),
        ],
        clock: "motionFrame",
      },
    },
    id: "ardy:scene:initialize",
  });
  const compositionReadout = await input.timeline.composition.read({
    composition: SCENE_COMPOSITION,
  });
  const composition = SceneComposition.assert(compositionReadout.composition);
  // The authored composition is the one owner of actor identity, row, and placement.
  const subjects = composition.actors.map(({ row, subject, worldOffset }) => ({
    id: subject,
    row,
    worldOffset,
  }));
  const program = compileMotionPipelineProgram({
    artifact: {
      id: compositionReadout.id,
      version: compositionRevision(compositionReadout.version),
    },
    composition,
    framesPerSecond: MOTION_FRAMES_PER_SECOND,
    render,
    rig: binding.value,
  });
  const system = createMotionPipelineSystem({
    beams: routePointsAt(composition, PROP_PLACEMENTS.beams),
    crates: routePointsAt(composition, PROP_PLACEMENTS.crates),
    embeddings,
    manifest: provider.manifest,
    program,
    restPose: binding.value.motionRestPose,
    subjects,
  });

  return {
    requiredFeatures: ["shader-f16"],
    system,
    onOpen: async ({ engine, timeline }) => {
      const parameters = await provider.loadParameters({
        parameters: system.metadata.provider.parameters,
        runtime: engine,
      });
      if (parameters.status === "unavailable") throw new Error(parameters.reason);
      await timeline.scheduleCommands(
        subjects.flatMap(({ id }) =>
          subjectAdmissionCommands({
            request: initialRequestFor({
              actor: id,
              id: `initial-motion-${id}`,
              program: program.compilation,
              revision: 0,
              subjectGeneration: 1,
            }),
          }),
        ),
      );
      await timeline.transport.stepBy({ ticks: 1 });
      // Generation advances at the present moment whether or not the transport plays. Play only
      // once every actor is presented at the first frame, so no actor appears mid-scene.
      const samples = system.metadata.motion.samples;
      const presentedId =
        system.capabilityExports[samples.capability]!.exports[samples.export]!.resource.id;
      const jointCount = system.metadata.motion.jointCount;
      const everyActorPresented = async (): Promise<boolean> => {
        const presented = (await engine.read({ id: presentedId })) as readonly {
          readonly present: number;
        }[];
        return program.motion.actors.every(
          (_actor, index) => presented[index * jointCount]?.present === 1,
        );
      };
      while (!(await everyActorPresented())) {
        // Each read settles after the device finishes the frame that ran before it.
      }
      await timeline.transport.play();
    },
  };
};
