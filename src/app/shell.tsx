import { tv } from "@hyphened/ui/tv";
import { WebGpuCanvas, useEngine, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MotionAgentObservability } from "./authoring/motion-agent-observability";
import { SceneTimeline } from "./timeline/scene-timeline";
import { openMotionProduction } from "../stage/open";
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
      restart={async () => {
        await timeline.transport.restart();
      }}
      timeline={timeline}
    />
  );
};

export const App = () => {
  const styles = sceneStyles();
  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = ({
    timeline,
  }) => openMotionProduction({ timeline });

  return (
    <main className={styles.root()}>
      <WebGpuCanvas
        className={styles.canvas()}
        declaration={motionTimelineDeclaration}
        openSession={openSession}
      >
        <MotionAgentObservability />
        <div className={styles.timeline()}>
          <BoundSceneTimeline />
        </div>
      </WebGpuCanvas>
    </main>
  );
};
