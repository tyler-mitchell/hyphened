import { tv } from "@hyphened/ui/tv";
import { useCallback, useEffect, useState } from "react";
import { WebGpuCanvas, useEngine, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MotionAgentObservability } from "./authoring/motion-agent-observability";
import { SceneReadinessTool, type SceneReadiness } from "./authoring/scene-readiness";
import { SceneTimeline } from "./timeline/scene-timeline";
import { openMotionProduction } from "../stage/open";
import { observeSceneProject, sceneProject, type SceneProject } from "../scene/project";
import { motionTimelineDeclaration } from "../scene/timeline";

const sceneStyles = tv({
  slots: {
    root: "relative isolate flex h-dvh w-screen flex-col overflow-hidden bg-slate-200",
    canvas: "block min-h-0 w-full flex-1 cursor-crosshair touch-none outline-none",
    // A cinema frame: the stage presents at 2.39:1 inside the canvas; the capture is unmasked.
    letterbox: "pointer-events-none absolute inset-x-0 h-[7%] bg-black",
    timeline: "flex h-72 shrink-0 flex-col",
    failure: "m-auto max-w-prose p-6 font-mono text-sm text-red-700",
  },
});

/** The failure with its cause chain: a wrapped step failure names what failed. */
const describeFailure = (cause: unknown): string =>
  cause instanceof Error
    ? [cause.message, ...(cause.cause === undefined ? [] : [describeFailure(cause.cause)])].join(
        " ← ",
      )
    : String(cause);

const BoundSceneTimeline = ({ durationFrames }: { readonly durationFrames: number }) => {
  const { restart, timeline } = useEngine<typeof motionTimelineDeclaration>();
  return <SceneTimeline durationFrames={durationFrames} restart={restart} timeline={timeline} />;
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
  useEffect(() => {
    const mount = { live: true };
    sceneProject().then(
      (opened) => {
        if (mount.live) setProject(opened);
      },
      (cause: unknown) => {
        if (mount.live) setReadiness({ reason: describeFailure(cause), status: "failed" });
      },
    );
    // A new scene replaces the project in place: the canvas below is keyed on it, so the running
    // session closes and a new one opens on the new run.
    const unobserve = observeSceneProject((next) => {
      if (!mount.live) return;
      setReadiness({ status: "opening" });
      setProject(next);
    });
    return () => {
      mount.live = false;
      unobserve();
    };
  }, []);
  const opened = useCallback(() => setReadiness({ status: "open" }), []);
  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = async ({
    timeline,
  }) => {
    const held = await sceneProject();
    const session = await openMotionProduction({ story: held.record.definition.story, timeline });
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
      <SceneReadinessTool readiness={readiness} reset={project?.reset} />
      {readiness.status === "failed" ? (
        <p className={styles.failure()}>The scene did not open: {readiness.reason}</p>
      ) : null}
      {project === undefined ? null : (
        <WebGpuCanvas
          key={project.record.definition.id}
          className={styles.canvas()}
          onError={(cause) => setReadiness({ reason: describeFailure(cause), status: "failed" })}
          openSession={openSession}
          timeline={project.timeline}
        >
          <SceneOpened onOpen={opened} />
          <MotionAgentObservability />
          <div className={styles.letterbox({ className: "top-0" })} />
          <div className={styles.letterbox({ className: "bottom-72" })} />
          <div className={styles.timeline()}>
            <BoundSceneTimeline durationFrames={project.record.definition.story.frameCount} />
          </div>
        </WebGpuCanvas>
      )}
    </main>
  );
};
