import type {
  TimelineEventSubscription,
  TimelineRuntime,
  TimeScheduleCommandInput,
} from "@coretime/core";
import { physicsSpawnRecord, type PhysicsBodyInit } from "webgpu-engine";
import type { WebGpuCanvasSession } from "webgpu-engine/react";

import { loadHumanoidRigAssets } from "../rig/skin";
import { bindMotionRig } from "../rig/binding";
import { type } from "arktype";
import {
  initialRequestFor,
  loadMotionProvider,
  loadTextEmbedding,
  type MotionParameterProgress,
  MOTION_PROMPT_LIBRARY,
  ONE_MOTION_FRAME,
  PUBLISHED_FRAMES_PER_WINDOW,
  replanRequestFor,
  requestScheduleCommand,
  subjectAdmissionCommands,
  subjectScheduleCommand,
} from "webgpu-engine/motion";
import { MOTION_FRAMES_PER_SECOND, motionTimelineDeclaration } from "../scene/timeline";
import {
  actorGroup,
  actorIdOfRow,
  bodyTrack,
  cameraTrack,
  compositionRevision,
  MOTION_ACTOR_EVENT,
  MOTION_BODY_EVENT,
  MOTION_ROUTE_EVENT,
  SCENE_COMPOSITION,
  SceneComposition,
} from "../scene/composition";
import {
  ACTOR_POOL_SPARE,
  ActorPresence,
  type AuthoredStory,
  BODY_POOL_SPARE,
  MotionRenderConfiguration,
  type MotionRenderConfigurationInput,
  type MotionSceneComposition,
  PHYSICS_RETIRE_SCHEDULE,
  PHYSICS_SPAWN_SCHEDULE,
  PHYSICS_STATIC_UPDATE_SCHEDULE,
  ScenePresentationConfiguration,
  type ScenePresentationConfigurationInput,
} from "../schema";
import { authoredBodies, authoredOrigin } from "../scene/default";
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
  /** Called while the checkpoint streams, so the page can show the wait instead of a blank stage. */
  readonly onProgress?: (progress: MotionParameterProgress) => void;
  readonly presentation?: ScenePresentationConfigurationInput;
  readonly render?: MotionRenderConfigurationInput;
  /** The story a new scene seeds from; a reopened document already has its children. */
  readonly story: AuthoredStory;
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
  await promptLibrary.loadManifest();
  const binding = bindMotionRig({ motionSkeleton: provider.manifest.skeleton, rig });
  if (binding.status === "unavailable") throw new Error(binding.reason);
  if (provider.manifest.config.framesPerSecond !== MOTION_FRAMES_PER_SECOND) {
    throw new Error("the motion provider and production timeline must use the same frame rate");
  }

  const presentation = ScenePresentationConfiguration.assert(input.presentation ?? {});
  const render = MotionRenderConfiguration.assert(input.render ?? {});
  const story = input.story;
  const seeded = story.actors.map((_actor, row) => ({
    id: actorIdOfRow(row),
    row,
    worldOffset: authoredOrigin(story, row),
  }));
  // A scene without children is new: seed it. The seed is the floor of the session's history, not
  // an edit an undo can take back; a reopened document already has its children.
  const opened = await input.timeline.composition.read({ composition: SCENE_COMPOSITION });
  if (opened.composition.children.length === 0) {
    await input.timeline.composition.edit({
      changes: [
        {
          composition: SCENE_COMPOSITION,
          type: "composition/replace",
          value: {
            children: [
              cameraTrack({
                durationFrames: story.frameCount,
                presentation: presentation.camera,
                story,
                subjects: seeded,
              }),
              ...seeded.map((subject) => actorGroup(subject, story)),
              bodyTrack(authoredBodies()),
            ],
            clock: "motionFrame",
          },
        },
      ],
      history: false,
      id: "ardy:scene:initialize",
    });
  }
  const compositionReadout = await input.timeline.composition.read({
    composition: SCENE_COMPOSITION,
  });
  const composition = SceneComposition.assert(compositionReadout.composition);
  // A library row loads the first time a span uses it; every span of this document needs its row
  // before the actors' requests are admitted.
  await promptLibrary.ensure(
    composition.actors.flatMap(({ promptTrack }) => promptTrack.items.map(({ data }) => data.prompt)),
  );
  // The authored composition is the one owner of actor identity, row, and placement. The
  // production opens with spare rows beyond the cast, so an actor can be added while it runs;
  // a spare row's id is fixed by its row, and it stays absent until a composition admits it.
  const cast = composition.actors.map(({ row, subject, worldOffset }) => ({
    id: subject,
    row,
    worldOffset,
  }));
  const rowCount = Math.max(-1, ...cast.map(({ row }) => row)) + 1 + ACTOR_POOL_SPARE;
  const subjects = Array.from({ length: rowCount }, (_unused, row) => {
    const member = cast.find((candidate) => candidate.row === row);
    return member ?? { id: actorIdOfRow(row), row, worldOffset: [0, 0, 0] as const };
  });
  const program = compileMotionPipelineProgram({
    artifact: {
      id: compositionReadout.id,
      version: compositionRevision(compositionReadout.version),
    },
    composition,
    framesPerSecond: MOTION_FRAMES_PER_SECOND,
    render,
    rig: binding.value,
    subjects,
  });
  const subscriptions = new Set<TimelineEventSubscription>();
  // The reconstruction is defined once the engine is open; until then a restart is the bare one.
  const production = {
    close: (): Promise<void> => Promise.resolve(),
    restart: (): Promise<void> => input.timeline.transport.restart().then(() => undefined),
  };
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
        ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
        parameters: system.metadata.provider.parameters,
        runtime: engine,
      });
      if (parameters.status === "unavailable") throw new Error(parameters.reason);
      await timeline.scheduleCommands(
        cast.flatMap(({ id }) =>
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
      // once every cast actor is presented at the first frame, so no actor appears mid-scene.
      const samples = system.metadata.motion.samples;
      const presentedId =
        system.capabilityExports[samples.capability]!.exports[samples.export]!.resource.id;
      const jointCount = system.metadata.motion.jointCount;
      const everyActorPresented = async (): Promise<boolean> => {
        const presented = (await engine.read({ id: presentedId })) as readonly {
          readonly present: number;
        }[];
        return cast.every(({ row }) => presented[row * jointCount]?.present === 1);
      };
      while (!(await everyActorPresented())) {
        // Each read settles after the device finishes the frame that ran before it.
      }
      await timeline.transport.play();
      // An authored edit to an actor replans it from the first window boundary at least one
      // window ahead of the playhead. The request continues from the actor's own frames before
      // the boundary, and its motion replaces the old from there as each window generates.
      const revisions = new Map<string, number>();
      // Each subject's presence generation on the device; a change must carry a higher one.
      const generations = new Map(cast.map(({ id }) => [id, 1]));
      const nextBoundary = async (frameCount: number): Promise<number | undefined> => {
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
        return boundary >= frameCount ? undefined : boundary;
      };
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
                rowCount: subjects.length,
              });
              // The actor's bodies stand on its route at their frames; they follow the new route.
              await lowerBodies(
                scene.bodies.flatMap(({ id, subject }) => (subject === actor ? [id] : [])),
              );
              const boundary = await nextBoundary(compilation.frameCount);
              if (boundary === undefined) continue;
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
      // An actor added to the composition is admitted on a spare row from the next window
      // boundary with its own spans; an actor removed leaves the stage at once. Its bodies are
      // the body events' concern.
      subscriptions.add(
        await timeline.events.subscribe({
          from: "current",
          handle: async ({ events }) => {
            const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
            const scene = SceneComposition.assert(readout.composition);
            const compilation = compileMotionCompilation({
              composition: scene,
              framesPerSecond: MOTION_FRAMES_PER_SECOND,
              rowCount: subjects.length,
            });
            const boundary = await nextBoundary(compilation.frameCount);
            const commands = events.flatMap(({ payload }) => {
              const presence = ActorPresence(payload);
              if (presence instanceof type.errors) return [];
              const generation = (generations.get(presence.subject) ?? 0) + 1;
              generations.set(presence.subject, generation);
              if (!presence.active) {
                return [
                  subjectScheduleCommand({
                    state: { active: false, generation, subject: presence.subject },
                  }),
                ];
              }
              if (boundary === undefined) return [];
              return subjectAdmissionCommands({
                request: replanRequestFor({
                  actor: presence.subject,
                  boundary,
                  id: `admit-${presence.subject}-${String(generation)}`,
                  program: compilation,
                  revision: 0,
                  subjectGeneration: generation,
                }),
              });
            });
            if (commands.length > 0) await timeline.scheduleCommands(commands);
          },
          kinds: [MOTION_ACTOR_EVENT],
        }),
      );
      };
      const closeLowering = async () => {
        await Promise.all([...subscriptions].map((subscription) => subscription.close()));
        subscriptions.clear();
      };
      await subscribeLowering();
      // Core Time playback has no end bound, so the scene's last frame pauses the transport, and
      // play pressed at the end plays the scene from the start.
      const lastFrame = composition.frameCount - 1;
      const playhead = await timeline.transport.observeComposition();
      playhead.onChange(({ transport }) => {
        const frame =
          Number(transport.position.tick.numerator) / Number(transport.position.tick.denominator);
        if (!transport.playing || frame < lastFrame) return;
        void (transport.operation === "play" ? production.restart() : timeline.transport.pause());
      });
      production.close = playhead.close;
      // A restart keeps the run and the subscriptions but drops every pending dynamic schedule and
      // resets the device tables to their opened state. The scene is reconstructed from the
      // current composition: each actor's request is compiled again and admitted with the restart,
      // and every body the composition holds beyond the opened set spawns again.
      production.restart = async () => {
        await closeLowering();
        const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
        const scene = SceneComposition.assert(readout.composition);
        const compilation = compileMotionCompilation({
          composition: scene,
          framesPerSecond: MOTION_FRAMES_PER_SECOND,
          rowCount: subjects.length,
        });
        revisions.clear();
        resetRegistries();
        // The device tables return to their opened state, so every present actor is admitted
        // again at generation one; an actor removed since open stays absent.
        generations.clear();
        scene.actors.forEach(({ subject }) => generations.set(subject, 1));
        await timeline.transport.restart({
          commands: scene.actors.flatMap(({ subject }) =>
            subjectAdmissionCommands({
              request: initialRequestFor({
                actor: subject,
                id: `initial-motion-${subject}`,
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
      };
    },
    restart: () => production.restart(),
    close: async () => {
      await production.close();
      await Promise.all([...subscriptions].map((subscription) => subscription.close()));
    },
  };
};
