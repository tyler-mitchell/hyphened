import { tv } from "@hyphened/ui/tv";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MotionParameterProgress } from "webgpu-engine/motion";
import { WebGpuCanvas, useEngine, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MotionAgentObservability } from "./authoring/motion-agent-observability";
import { characterTools } from "./authoring/character-tools";
import { environmentTools } from "./authoring/environment-tools";
import { NATIVE_WEBMCP } from "./authoring/native-webmcp";
import { storyTools } from "./authoring/story-tools";
import { useAgentTools } from "./authoring/use-agent-tool";
import { AgentPanel } from "./agent/agent-panel";
import { BrowserCapabilityNotice } from "./browser-capability-notice";
import { MotionLibraryPanel } from "./library/motion-library";
import { SceneLoading } from "./scene-loading";
import {
  readDevice,
  SceneReadinessTool,
  unsupportedDevice,
  type SceneDevice,
  type SceneReadiness,
} from "./authoring/scene-readiness";
import { SceneTimeline, type SceneChoice } from "./timeline/scene-timeline";
import { AUTHORED_STORIES } from "../scene/default";
import { servedCharacter } from "../rig/characters";
import { openMotionProduction } from "../stage/open";
import {
  observeSceneProject,
  openSceneProject,
  sceneProject,
  startNewScene,
  type SceneProject,
} from "../scene/project";
import { motionTimelineDeclaration } from "../scene/timeline";

const sceneStyles = tv({
  slots: {
    root: "relative isolate flex h-dvh w-screen flex-col overflow-hidden bg-background",
    canvas: "block min-h-0 w-full flex-1 cursor-crosshair touch-none outline-none",
    // A cinema frame: the stage presents at 2.39:1 inside the canvas; the capture is unmasked.
    letterbox: "pointer-events-none absolute inset-x-0 h-[7%] bg-black",
    timeline: "flex h-72 shrink-0 flex-col",
    failure: "m-auto max-w-prose p-6 font-mono text-[13px] leading-relaxed text-destructive",
  },
});

/**
 * The index route's own hooks, reached by id. The route module imports this file for its component,
 * so importing the route object back would close a cycle and leave `Route` undefined at evaluation.
 */
const indexRoute = getRouteApi("/");
const NATIVE_WEBMCP_AVAILABLE = NATIVE_WEBMCP;

/** The failure with its cause chain: a wrapped step failure names what failed. */
const describeFailure = (cause: unknown): string => {
  if (!(cause instanceof Error)) return String(cause);
  // ArkType can include the complete rejected scene value after `was`. That internal document is
  // useful in development logs and harmful at the public agent boundary, where the path and reason
  // are the actionable facts.
  const message = cause.message
    .split(" • ")
    .map((problem) => problem.split(" (was ")[0]!)
    .join(" • ");
  return [message, ...(cause.cause === undefined ? [] : [describeFailure(cause.cause)])].join(
    " ← ",
  );
};

const BoundSceneTimeline = ({
  character,
  durationFrames,
  scene,
  scenes,
}: {
  readonly character: string | undefined;
  readonly durationFrames: number;
  readonly scene: string;
  readonly scenes: readonly SceneChoice[];
}) => {
  const { restart, timeline } = useEngine<typeof motionTimelineDeclaration>();
  return (
    <SceneTimeline
      character={character}
      durationFrames={durationFrames}
      restart={restart}
      scene={scene}
      scenes={scenes}
      timeline={timeline}
    />
  );
};

/** Rendered only once the session is open, so mounting it is the fact that the scene opened. */
const SceneOpened = ({
  onOpen,
  scene,
}: {
  readonly onOpen: (scene: string) => void;
  readonly scene: string;
}) => {
  useEffect(() => onOpen(scene), [onOpen, scene]);
  return null;
};

/** Durable project operations stay available while the current GPU scene opens or fails. */
const ProjectAgentTools = () => {
  useAgentTools([...characterTools(), ...environmentTools(), ...storyTools()]);
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
  const [scenes, setScenes] = useState<readonly SceneChoice[]>([]);
  // What this browser can offer. Undefined until the probe answers, so the canvas waits rather
  // than mounting a session that a browser without the required feature cannot open.
  const [device, setDevice] = useState<SceneDevice>();
  // The checkpoint streams inside the canvas session, which the shell outlives. Nothing on screen
  // reads this: the scene shows one spinner until it opens. It answers the agent's readiness tool,
  // which is where a caller asks how far along a boot is.
  const [progress, setProgress] = useState<MotionParameterProgress>();
  // Closed: a browser that can run the scene has nothing to be told, and one missing WebMCP gets
  // the notice's own pill, which opens this. A dialog over the stage on every visit is not news.
  const [showAgentSetup, setShowAgentSetup] = useState(false);
  // The address is read once, at open. It is the visitor's intent for this visit; after that the
  // scene leads and the address follows it.
  const { scene: requestedScene, story: requestedStory } = indexRoute.useSearch();
  const navigate = useNavigate();
  const initialAddressHandled = useRef(false);
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
        if (mount.live) setProject(opened);
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
        search: { scene: next.record.definition.id },
        to: "/",
      });
    });
    return () => {
      mount.live = false;
      unobserve();
    };
  }, []);
  useEffect(() => {
    if (project === undefined) return;
    const mount = { live: true };
    void project.catalog.list().then(
      (entries) => {
        if (mount.live) {
          setScenes(
            entries.map(({ definition }) => ({ id: definition.id, title: definition.title })),
          );
        }
      },
      (cause: unknown) => {
        if (mount.live) setReadiness({ reason: describeFailure(cause), status: "failed" });
      },
    );
    return () => {
      mount.live = false;
    };
  }, [project]);
  // The address owns scene selection. A story parameter creates a fresh document; a scene parameter
  // opens that exact saved document. Project observation replaces either address with the active id.
  useEffect(() => {
    if (project === undefined || initialAddressHandled.current) return;
    initialAddressHandled.current = true;
    if (requestedScene !== undefined) {
      if (requestedScene === project.record.definition.id) return;
      setReadiness({ status: "opening" });
      void openSceneProject(requestedScene).catch((cause: unknown) => {
        setReadiness({ reason: describeFailure(cause), status: "failed" });
      });
      return;
    }
    if (requestedStory === undefined) return;
    const addressed = AUTHORED_STORIES[requestedStory];
    if (addressed === undefined || requestedStory === project.record.definition.seed) return;
    setReadiness({ status: "opening" });
    void startNewScene({ seed: requestedStory, story: addressed }).catch((cause: unknown) => {
      setReadiness({ reason: describeFailure(cause), status: "failed" });
    });
  }, [project, requestedScene, requestedStory]);
  const opened = useCallback((scene: string) => {
    void sceneProject().then((active) => {
      if (active.record.definition.id !== scene) return;
      setReadiness({ status: "open" });
      setProgress(undefined);
    });
  }, []);
  // Undefined while the probe runs and when the browser can run the scene; a sentence otherwise.
  const unsupported = device === undefined ? undefined : unsupportedDevice(device);
  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = async ({
    timeline,
  }) => {
    const held = project;
    if (held === undefined) throw new Error("The scene project is not open.");
    const session = await openMotionProduction({
      character: servedCharacter(held.record.definition.character),
      ...(held.record.definition.environment === undefined
        ? {}
        : { environment: held.record.definition.environment }),
      ...(held.record.definition.render === undefined
        ? {}
        : { render: held.record.definition.render }),
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
      <ProjectAgentTools />
      {/*
        Outside the canvas, because the canvas is exactly what a visitor without shader-f16 does not
        get. The panel exists so a browser with no WebMCP client can still call the page's tools, and
        that browser is usually the same one that cannot run the scene; mounting it inside the canvas
        withheld it from every visitor who needed it. It reads the tools from the WebMCP surface, so
        it needs no engine.
      */}
      <AgentPanel />
      {device === undefined || readiness.status === "opening" ? null : (
        <BrowserCapabilityNotice
          capabilities={{ ...device, webMcp: NATIVE_WEBMCP_AVAILABLE }}
          onOpenChange={setShowAgentSetup}
          open={showAgentSetup}
        />
      )}
      {readiness.status === "opening" ? <SceneLoading /> : null}
      {readiness.status === "failed" && unsupported === undefined ? (
        <p className={styles.failure()}>The scene did not open: {readiness.reason}</p>
      ) : null}
      {project === undefined || device === undefined || unsupported !== undefined ? null : (
        <WebGpuCanvas
          key={`${project.record.definition.id}/${project.record.definition.character ?? ""}/${JSON.stringify(project.record.definition.environment ?? [])}/${JSON.stringify(project.record.definition.render ?? {})}`}
          className={styles.canvas()}
          onError={(cause) => {
            const failedScene = project.record.definition.id;
            void sceneProject().then((active) => {
              if (active.record.definition.id !== failedScene) return;
              setReadiness({ reason: describeFailure(cause), status: "failed" });
            });
          }}
          openSession={openSession}
          timeline={project.timeline}
        >
          <SceneOpened onOpen={opened} scene={project.record.definition.id} />
          <MotionAgentObservability />
          <MotionLibraryPanel />
          <div className={styles.letterbox({ className: "top-0" })} />
          <div className={styles.letterbox({ className: "bottom-72" })} />
          <div className={styles.timeline()}>
            <BoundSceneTimeline
              character={project.record.definition.character ?? undefined}
              durationFrames={project.record.definition.story.frameCount}
              scene={project.record.definition.id}
              scenes={scenes}
            />
          </div>
        </WebGpuCanvas>
      )}
    </main>
  );
};
