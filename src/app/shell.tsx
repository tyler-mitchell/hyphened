import { tv } from "@hyphened/ui/tv";
import { useCallback, useEffect, useState } from "react";
import { WebGpuCanvas, useEngine, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MotionAgentObservability } from "./authoring/motion-agent-observability";
import { SceneReadinessTool, type SceneReadiness } from "./authoring/scene-readiness";
import { SceneTimeline } from "./timeline/scene-timeline";
import { openMotionProduction, restartMotionScene } from "../stage/open";
import { sceneProject, type SceneProject } from "../scene/project";
import { motionTimelineDeclaration } from "../scene/timeline";
import { SCENE_SPAN_FRAMES } from "../scene/default";

const sceneStyles = tv({
  slots: {
    root: "relative isolate flex h-dvh w-screen flex-col overflow-hidden bg-slate-200",
    canvas: "block min-h-0 w-full flex-1 cursor-crosshair touch-none outline-none",
    timeline: "flex h-72 shrink-0 flex-col",
  },
});

const BoundSceneTimeline = () => {
  const { timeline } = useEngine<typeof motionTimelineDeclaration>();
  return (
    <SceneTimeline
      durationFrames={SCENE_SPAN_FRAMES}
      restart={() => restartMotionScene(timeline)}
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
  useEffect(() => {
    const mount = { live: true };
    sceneProject().then(
      (opened) => {
        if (mount.live) setProject(opened);
      },
      (cause: unknown) => {
        if (mount.live) setReadiness({ reason: String(cause), status: "failed" });
      },
    );
    return () => {
      mount.live = false;
    };
  }, []);
  const opened = useCallback(() => setReadiness({ status: "open" }), []);
  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = ({
    timeline,
  }) => openMotionProduction({ timeline });

  return (
    <main className={styles.root()}>
      <SceneReadinessTool readiness={readiness} />
      {project === undefined ? null : (
        <WebGpuCanvas
          className={styles.canvas()}
          onError={(cause) => setReadiness({ reason: String(cause), status: "failed" })}
          openSession={openSession}
          timeline={project.timeline}
        >
          <SceneOpened onOpen={opened} />
          <MotionAgentObservability />
          <div className={styles.timeline()}>
            <BoundSceneTimeline />
          </div>
        </WebGpuCanvas>
      )}
    </main>
  );
};
