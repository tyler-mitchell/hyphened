import { tv } from "@hyphened/ui/tv";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { MotionParameterProgress } from "webgpu-engine/motion";
import { WebGpuCanvas, useEngine, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MotionAgentObservability } from "./authoring/motion-agent-observability";
import { AgentPanel } from "./agent/agent-panel";
import { MotionLibraryPanel } from "./library/motion-library";
import {
  readDevice,
  SceneReadinessTool,
  unsupportedDevice,
  type SceneDevice,
  type SceneReadiness,
} from "./authoring/scene-readiness";
import { SceneTimeline, type StartScene } from "./timeline/scene-timeline";
import { Route } from "./routes/index";
import { AUTHORED_STORIES } from "../scene/default";
import { openMotionProduction } from "../stage/open";
import {
  observeSceneProject,
  sceneProject,
  startNewScene,
  type SceneProject,
  type SceneStoryChoice,
} from "../scene/project";
import { motionTimelineDeclaration } from "../scene/timeline";

const sceneStyles = tv({
  slots: {
    root: "relative isolate flex h-dvh w-screen flex-col overflow-hidden bg-slate-200",
    canvas: "block min-h-0 w-full flex-1 cursor-crosshair touch-none outline-none",
    // A cinema frame: the stage presents at 2.39:1 inside the canvas; the capture is unmasked.
    letterbox: "pointer-events-none absolute inset-x-0 h-[7%] bg-black",
    timeline: "flex h-72 shrink-0 flex-col",
    failure: "m-auto max-w-prose p-6 font-mono text-sm text-red-700",
    notice: "m-auto max-w-prose p-6 text-center text-base leading-relaxed text-slate-700",
    // Over the stage, because the canvas has mounted and is empty while the checkpoint streams.
    loading:
      "pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto w-max max-w-sm -translate-y-1/2 rounded-lg bg-white/90 px-6 py-4 text-center text-sm text-slate-700 shadow-lg",
    loadingDetail: "mt-1 text-xs text-slate-500",
    loadingTrack: "mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-300",
    loadingBar: "h-full rounded-full bg-slate-600 transition-[width] duration-300",
  },
});

/** Whole megabytes, the unit a download reads in. */
const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(0);

/** The failure with its cause chain: a wrapped step failure names what failed. */
const describeFailure = (cause: unknown): string =>
  cause instanceof Error
    ? [cause.message, ...(cause.cause === undefined ? [] : [describeFailure(cause.cause)])].join(
        " ← ",
      )
    : String(cause);

const BoundSceneTimeline = ({
  durationFrames,
  seed,
  startScene,
}: {
  readonly durationFrames: number;
  readonly seed?: string;
  readonly startScene: StartScene;
}) => {
  const { restart, timeline } = useEngine<typeof motionTimelineDeclaration>();
  return (
    <SceneTimeline
      durationFrames={durationFrames}
      restart={restart}
      seed={seed}
      startScene={startScene}
      timeline={timeline}
    />
  );
};

/** Rendered only once the session is open, so mounting it is the fact that the scene opened. */
const SceneOpened = ({ onOpen }: { readonly onOpen: () => void }) => {
  useEffect(onOpen, [onOpen]);
  return null;
};

export const App = () => {
  const styles = sceneStyles();
  // The readiness tool registers before the scene opens and outlives a failed open, so an agent
  // can tell a booting page from one that will never boot on this device.
  const [readiness, setReadiness] = useState<SceneReadiness>({ status: "opening" });
  // The durable scene (project catalog and journal) opens once, outside React, and its timeline
  // is supplied to the canvas so history survives a reload.
  const [project, setProject] = useState<SceneProject>();
  // What this browser can offer. Undefined until the probe answers, so the canvas waits rather
  // than mounting a session that a browser without the required feature cannot open.
  const [device, setDevice] = useState<SceneDevice>();
  // The checkpoint is 380 MB and streams inside the canvas session, after the canvas has mounted.
  // The shell outlives that session, so the shell holds the count and shows it over the stage.
  const [progress, setProgress] = useState<MotionParameterProgress>();
  // The address is read once, at open. It is the visitor's intent for this visit; after that the
  // scene leads and the address follows it.
  const { story: requested } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    const mount = { live: true };
    void readDevice().then((probed) => {
      if (!mount.live) return;
      setDevice(probed);
      // A browser that cannot run the scene has failed already; it will never reach an open.
      const reason = unsupportedDevice(probed);
      if (reason !== undefined) setReadiness({ reason, status: "failed" });
    });
    sceneProject().then(
      (opened) => {
        if (!mount.live) return;
        setProject(opened);
        // An address that names a different story than the saved scene wins, because the visitor
        // followed a link to that story. A scene already on it, or an address naming none, opens
        // the saved scene untouched.
        const addressed = requested === undefined ? undefined : AUTHORED_STORIES[requested];
        if (addressed !== undefined && requested !== opened.record.definition.seed) {
          void startNewScene({ seed: requested, story: addressed }).catch((cause: unknown) => {
            if (mount.live) setReadiness({ reason: describeFailure(cause), status: "failed" });
          });
        }
      },
      (cause: unknown) => {
        if (mount.live) setReadiness({ reason: describeFailure(cause), status: "failed" });
      },
    );
    // A new scene replaces the project in place: the canvas below is keyed on it, so the running
    // session closes and a new one opens on the new run. The address follows the scene, so the
    // link in the bar always names what is playing and can be sent to someone else.
    const unobserve = observeSceneProject((next) => {
      if (!mount.live) return;
      setReadiness({ status: "opening" });
      setProgress(undefined);
      setProject(next);
      void navigate({
        replace: true,
        search: () =>
          next.record.definition.seed === undefined ? {} : { story: next.record.definition.seed },
        to: "/",
      });
    });
    return () => {
      mount.live = false;
      unobserve();
    };
  }, []);
  const opened = useCallback(() => {
    setReadiness({ status: "open" });
    setProgress(undefined);
  }, []);
  // The switch replaces the project, so the canvas and every control inside it unmount. Only the
  // shell outlives that, so the shell owns the outcome: a switch that never reaches a scene is
  // reported here instead of dying with the control that asked for it.
  const startScene = useCallback(
    (choice: SceneStoryChoice) => {
      setReadiness({ status: "opening" });
      return startNewScene(choice).then(
        () => undefined,
        (cause: unknown) => setReadiness({ reason: describeFailure(cause), status: "failed" }),
      );
    },
    [],
  );
  // Undefined while the probe runs and when the browser can run the scene; a sentence otherwise.
  const unsupported = device === undefined ? undefined : unsupportedDevice(device);
  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = async ({
    timeline,
  }) => {
    const held = await sceneProject();
    const session = await openMotionProduction({
      onProgress: setProgress,
      story: held.record.definition.story,
      timeline,
    });
    // The session held this run; when the session closes, the run closes with it.
    return {
      ...session,
      close: async (input) => {
        await session.close?.(input);
        if (held.timeline === timeline) await held.release();
      },
    };
  };

  return (
    <main className={styles.root()}>
      <SceneReadinessTool progress={progress} readiness={readiness} reset={project?.reset} />
      {unsupported === undefined ? null : <p className={styles.notice()}>{unsupported}</p>}
      {progress === undefined || readiness.status !== "opening" ? null : (
        <div className={styles.loading()}>
          <p>
            Loading the motion model, {megabytes(progress.loadedBytes)} MB of{" "}
            {megabytes(progress.totalBytes)} MB.
          </p>
          <p className={styles.loadingDetail()}>
            Part {progress.shard} of {progress.shardCount}. Your browser keeps it for the next
            visit.
          </p>
          <div className={styles.loadingTrack()}>
            <div
              className={styles.loadingBar()}
              style={{
                width: `${String(Math.round((progress.loadedBytes / progress.totalBytes) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
      {readiness.status === "failed" && unsupported === undefined ? (
        <p className={styles.failure()}>The scene did not open: {readiness.reason}</p>
      ) : null}
      {project === undefined || device === undefined || unsupported !== undefined ? null : (
        <WebGpuCanvas
          key={project.record.definition.id}
          className={styles.canvas()}
          onError={(cause) => setReadiness({ reason: describeFailure(cause), status: "failed" })}
          openSession={openSession}
          timeline={project.timeline}
        >
          <SceneOpened onOpen={opened} />
          <MotionAgentObservability />
          <MotionLibraryPanel />
          <AgentPanel />
          <div className={styles.letterbox({ className: "top-0" })} />
          <div className={styles.letterbox({ className: "bottom-72" })} />
          <div className={styles.timeline()}>
            <BoundSceneTimeline
              durationFrames={project.record.definition.story.frameCount}
              seed={project.record.definition.seed}
              startScene={startScene}
            />
          </div>
        </WebGpuCanvas>
      )}
    </main>
  );
};
