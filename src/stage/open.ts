import type {
  TimelineEventSubscription,
  TimelineRuntime,
  TimeScheduleCommandInput,
} from "@coretime/core";
import { physicsSpawnRecord, type PhysicsBodyInit } from "webgpu-engine";
import type { WebGpuCanvasSession } from "webgpu-engine/react";

import { loadHumanoidRigAssets } from "../rig/skin";
import { bindMotionRig } from "../rig/binding";
import {
  initialRequestFor,
  replanRequestFor,
  requestScheduleCommand,
  subjectAdmissionCommands,
} from "learned-motion/motion/schedule";
import { MOTION_FRAMES_PER_SECOND, motionTimelineDeclaration } from "../scene/timeline";
import { loadMotionProvider } from "learned-motion/provider/load";
import { loadTextEmbedding, MOTION_PROMPT_LIBRARY } from "learned-motion/provider/embedding";
import { PUBLISHED_FRAMES_PER_WINDOW } from "learned-motion/provider/generation/layout";
import {
  actorGroup,
  bodyTrack,
  cameraTrack,
  compositionRevision,
  MOTION_BODY_EVENT,
  MOTION_ROUTE_EVENT,
  SCENE_COMPOSITION,
  SceneComposition,
} from "../scene/composition";
import {
  BODY_POOL_SPARE,
  MotionRenderConfiguration,
  type MotionRenderConfigurationInput,
  INITIAL_SUBJECT_COUNT,
  type MotionSceneComposition,
  ONE_MOTION_FRAME,
  PHYSICS_RETIRE_SCHEDULE,
  PHYSICS_SPAWN_SCHEDULE,
  PHYSICS_STATIC_UPDATE_SCHEDULE,
  ScenePresentationConfiguration,
  type ScenePresentationConfigurationInput,
} from "learned-motion/schema";
import { authoredBodies, SCENE_SPAN_FRAMES } from "../scene/default";
import { promptLibrary } from "../scene/prompts";
import { compileMotionCompilation, compileMotionPipelineProgram } from "./compile";
import { createMotionPipelineSystem } from "./system";

/** Lower the composition's bodies to physics rows: each stands on its actor's route at its frame. */
const bodyInits = (
  composition: MotionSceneComposition,
): ReadonlyArray<{ readonly id: string; readonly init: PhysicsBodyInit }> =>
  composition.bodies.flatMap((body) => {
    const actor = composition.actors.find(({ subject }) => subject === body.subject);
    const vertex = actor?.rootTrack.items.find(({ at }) => at.tick >= body.tick);
    return actor === undefined || vertex === undefined
      ? []
      : [
          {
            id: body.id,
            init: {
              halfExtents: body.halfExtents,
              mass: body.mass,
              position: [
                actor.worldOffset[0] + vertex.data.position[0],
                actor.worldOffset[1] + body.elevation,
                actor.worldOffset[2] + vertex.data.position[1],
              ] as const,
            },
          },
        ];
  });

/** A body without mass is fixed: a static collider the engine moves in place. */
const isFixed = (init: PhysicsBodyInit): boolean => (init.mass ?? 0) === 0;

const physicsScheduleCommand = (input: {
  readonly payload: readonly unknown[];
  readonly scheduleKind: string;
}): TimeScheduleCommandInput => ({
  command: "schedule",
  input: { after: ONE_MOTION_FRAME, payload: input.payload },
  scheduleKind: input.scheduleKind,
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
  for (const loaded of loadedEmbeddings) {
    if (loaded.status === "available") promptLibrary.admit({ embedding: loaded.value });
  }
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
          bodyTrack(seeded.flatMap(({ id, row }) => authoredBodies(id, row))),
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
  const subscriptions = new Set<TimelineEventSubscription>();
  const openedBodies = bodyInits(composition);
  const openedFixed = openedBodies.filter(({ init }) => isFixed(init));
  const openedLoose = openedBodies.filter(({ init }) => !isFixed(init));
  const system = createMotionPipelineSystem({
    bodies: {
      fixed: openedFixed.map(({ init }) => init),
      loose: openedLoose.map(({ init }) => init),
    },
    embeddings: promptLibrary.embeddings,
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
      // An authored edit to an actor replans it from the first window boundary at least one
      // window ahead of the playhead. The request continues from the actor's own frames before
      // the boundary, and its motion replaces the old from there as each window generates.
      const revisions = new Map<string, number>();
      // Bodies edited after open are lowered live. A loose body retires its pool row and spawns
      // into a free one; a fixed body is a static collider that one update moves, resizes, or
      // clears in place. The two row registries are the lowering's own data.
      const firstBodyRow = subjects.length + 1;
      const bodyRowOf = new Map<string, number>();
      const staticRowOf = new Map<string, number>();
      const freeRows = new Set<number>();
      const freeStatics = new Set<number>();
      const resetRegistries = () => {
        bodyRowOf.clear();
        openedLoose.forEach(({ id }, index) => bodyRowOf.set(id, firstBodyRow + index));
        staticRowOf.clear();
        openedFixed.forEach(({ id }, index) => staticRowOf.set(id, index));
        freeRows.clear();
        freeStatics.clear();
        Array.from({ length: BODY_POOL_SPARE }, (_unused, index) => {
          freeRows.add(firstBodyRow + openedLoose.length + index);
          freeStatics.add(openedFixed.length + index);
        });
      };
      resetRegistries();
      const lowerBodies = async (ids: readonly string[]) => {
        const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
        const lowered = bodyInits(SceneComposition.assert(readout.composition));
        const commands = ids.flatMap((id) => {
          const body = lowered.find((entry) => entry.id === id);
          const row = bodyRowOf.get(id);
          const staticRow = staticRowOf.get(id);
          const fixed = body !== undefined && isFixed(body.init);
          const retire = row === undefined ? [] : [{ row }];
          if (row !== undefined) {
            bodyRowOf.delete(id);
            freeRows.add(row);
          }
          const clear = staticRow === undefined || fixed ? [] : [{ row: staticRow, solid: false }];
          if (staticRow !== undefined && !fixed) {
            staticRowOf.delete(id);
            freeStatics.add(staticRow);
          }
          const nextRow = body !== undefined && !fixed ? [...freeRows][0] : undefined;
          if (nextRow !== undefined) {
            freeRows.delete(nextRow);
            bodyRowOf.set(id, nextRow);
          }
          const nextStatic = fixed ? (staticRow ?? [...freeStatics][0]) : undefined;
          if (nextStatic !== undefined) {
            freeStatics.delete(nextStatic);
            staticRowOf.set(id, nextStatic);
          }
          const spawn =
            body === undefined || nextRow === undefined ? [] : [physicsSpawnRecord(nextRow, body.init)];
          const place =
            body === undefined || nextStatic === undefined
              ? []
              : [
                  {
                    halfExtents: body.init.halfExtents,
                    position: body.init.position,
                    row: nextStatic,
                    solid: true,
                  },
                ];
          return [
            ...(retire.length === 0
              ? []
              : [physicsScheduleCommand({ payload: retire, scheduleKind: PHYSICS_RETIRE_SCHEDULE })]),
            ...(spawn.length === 0
              ? []
              : [physicsScheduleCommand({ payload: spawn, scheduleKind: PHYSICS_SPAWN_SCHEDULE })]),
            ...([...clear, ...place].length === 0
              ? []
              : [
                  physicsScheduleCommand({
                    payload: [...clear, ...place],
                    scheduleKind: PHYSICS_STATIC_UPDATE_SCHEDULE,
                  }),
                ]),
          ];
        });
        if (commands.length > 0) await timeline.scheduleCommands(commands);
      };
      const subscribeLowering = async () => {
      subscriptions.add(
        await timeline.events.subscribe({
          from: "current",
          handle: async ({ events }) => {
            for (const event of events) {
              const actor = event.subject;
              if (actor === undefined) continue;
              const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
              const scene = SceneComposition.assert(readout.composition);
              const compilation = compileMotionCompilation({
                composition: scene,
                framesPerSecond: MOTION_FRAMES_PER_SECOND,
              });
              // The actor's bodies stand on its route at their frames; they follow the new route.
              await lowerBodies(
                scene.bodies.flatMap(({ id, subject }) => (subject === actor ? [id] : [])),
              );
              const transport = await timeline.transport.state();
              const frame = (
                await timeline.quantize({
                  coordinate: transport.position,
                  grid: { clock: "motionFrame", every: 1 },
                  mode: "floor",
                })
              ).tick;
              const boundary =
                Math.ceil((frame + PUBLISHED_FRAMES_PER_WINDOW) / PUBLISHED_FRAMES_PER_WINDOW) *
                PUBLISHED_FRAMES_PER_WINDOW;
              if (boundary >= compilation.frameCount) continue;
              const revision = (revisions.get(actor) ?? 0) + 1;
              revisions.set(actor, revision);
              await timeline.scheduleCommands([
                requestScheduleCommand({
                  request: replanRequestFor({
                    actor,
                    boundary,
                    id: `replan-${actor}-${String(revision)}`,
                    program: compilation,
                    revision,
                    subjectGeneration: 1,
                  }),
                }),
              ]);
            }
          },
          kinds: [MOTION_ROUTE_EVENT],
        }),
      );
      subscriptions.add(
        await timeline.events.subscribe({
          from: "current",
          handle: async ({ events }) => {
            await lowerBodies(events.flatMap(({ subject }) => (subject === undefined ? [] : [subject])));
          },
          kinds: [MOTION_BODY_EVENT],
        }),
      );
      };
      const closeLowering = async () => {
        await Promise.all([...subscriptions].map((subscription) => subscription.close()));
        subscriptions.clear();
      };
      await subscribeLowering();
      // A restart keeps the run and the subscriptions but drops every pending dynamic schedule and
      // resets the device tables to their opened state. The scene is reconstructed from the
      // current composition: each actor's request is compiled again and admitted with the restart,
      // and every body the composition holds beyond the opened set spawns again.
      restarts.set(timeline, async () => {
        await closeLowering();
        const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
        const scene = SceneComposition.assert(readout.composition);
        const compilation = compileMotionCompilation({
          composition: scene,
          framesPerSecond: MOTION_FRAMES_PER_SECOND,
        });
        revisions.clear();
        resetRegistries();
        await timeline.transport.restart({
          commands: subjects.flatMap(({ id }) =>
            subjectAdmissionCommands({
              request: initialRequestFor({
                actor: id,
                id: `initial-motion-${id}`,
                program: compilation,
                revision: 0,
                subjectGeneration: 1,
              }),
            }),
          ),
        });
        await lowerBodies(
          scene.bodies.flatMap(({ id }) =>
            bodyRowOf.has(id) || staticRowOf.has(id) ? [] : [id],
          ),
        );
        await subscribeLowering();
      });
    },
    close: async () => {
      restarts.delete(input.timeline);
      await Promise.all([...subscriptions].map((subscription) => subscription.close()));
    },
  };
};

const restarts = new WeakMap<
  TimelineRuntime<typeof motionTimelineDeclaration>,
  () => Promise<void>
>();

/** Restart the scene as the production reconstructs it; a timeline without a production restarts bare. */
export const restartMotionScene = (
  timeline: TimelineRuntime<typeof motionTimelineDeclaration>,
): Promise<void> =>
  restarts.get(timeline)?.() ?? timeline.transport.restart().then(() => undefined);
