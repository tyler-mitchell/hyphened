import { openTimeline, type TimelineRuntime } from "@coretime/core";
import { Badge } from "@hyphened/ui/components/badge";
import { Button } from "@hyphened/ui/components/button";
import { useEffect, useMemo, useState } from "react";
import { observeRuntime } from "webgpu-engine";
import { useEngine, WebGpuCanvas, type WebGpuCanvasSessionFactory } from "webgpu-engine/react";

import { MOTION_FRAMES_PER_SECOND, PUBLISHED_FRAMES_PER_WINDOW } from "webgpu-engine/motion";
import type { AuthoredStory } from "../../schema";
import { promptLibrary, type MotionPrompt } from "../../scene/prompts";
import { motionTimelineDeclaration } from "../../scene/timeline";
import { openMotionProduction } from "../../stage/open";
import { MOTION_CAPTURE_RESOURCE_ID } from "../../stage/system";
import { motionPlaygroundEntryStyles, motionPlaygroundStyles } from "./motion-playground.styles";

/**
 * Long enough to read a caption's whole shape and still a multiple of the generation window, so a
 * cyclic caption repeats a few times and one that completes has room to finish.
 */
const PREVIEW_FRAMES = PUBLISHED_FRAMES_PER_WINDOW * 3;
const PREVIEW_SECONDS = PREVIEW_FRAMES / MOTION_FRAMES_PER_SECOND;

/**
 * One caption alone, as a story. The actor stands at the origin and the path is exactly as long as
 * its pace claims over the preview, so the route asks for the gait the caption names rather than
 * dragging it toward a distance it cannot cover. A caption performed in place gets no path.
 */
const previewStory = (entry: MotionPrompt): AuthoredStory => ({
  actors: [
    {
      origin: [0, 0, 0],
      path:
        entry.pace > 0
          ? [
              [0, 0],
              [0, -entry.pace * PREVIEW_SECONDS],
            ]
          : [[0, 0]],
      scenario: [{ frames: PREVIEW_FRAMES, prompt: entry.prompt }],
    },
  ],
  coverage: [{ end: PREVIEW_FRAMES, preset: "hero", row: 0, start: 0 }],
  frameCount: PREVIEW_FRAMES,
  title: entry.prompt,
});

/**
 * A caption's slug, by the same rule the library names its rows: lower case, words joined by
 * hyphens, no trailing stop. It names the captured file, so a GIF on disk says which caption it is.
 */
const slugOf = (prompt: string) =>
  prompt
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const facetsOf = (entry: MotionPrompt) => [
  entry.pace > 0 ? `${String(entry.pace)} m/s` : "in place",
  ...(entry.posture === undefined ||
  (entry.posture.enter === "stand" && entry.posture.exit === "stand")
    ? []
    : [`${entry.posture.enter} → ${entry.posture.exit}`]),
  ...(entry.category === undefined ? [] : [entry.category]),
];

/** Every other frame, so a six second preview is thirty images rather than a hundred and twenty. */
const CAPTURE_STRIDE = 2;
const CAPTURE_FRAMES = PREVIEW_FRAMES / CAPTURE_STRIDE;
const CAPTURE_DELAY_MS = (CAPTURE_STRIDE / MOTION_FRAMES_PER_SECOND) * 1000;

const awaitPresentedFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type CaptureState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly taken: number }
  | { readonly kind: "ready"; readonly path?: string; readonly url: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Capture the caption on screen as an animated GIF.
 *
 * A caption's name is not evidence of what it produces, and a still frame is not evidence of
 * motion. The transport is stepped one capture stride at a time and the presented frame read back
 * at each stop, so the images are the motion this caption actually generated rather than a
 * re-render of it. The server encodes them, because the browser has no encoder.
 *
 * Capture is read only: the transport is returned to where it was and playback resumes if it was
 * running.
 */
const PreviewCapture = ({ slug }: { readonly slug: string }) => {
  const { engine, timeline } = useEngine<typeof motionTimelineDeclaration>();
  const [state, setState] = useState<CaptureState>({ kind: "idle" });
  const styles = motionPlaygroundStyles();

  const capture = async () => {
    setState({ kind: "working", taken: 0 });
    const before = await timeline.transport.state();
    const shoot = async (
      remaining: number,
      taken: ReadonlyArray<string>,
    ): Promise<ReadonlyArray<string>> => {
      if (remaining === 0) return taken;
      const shot = await observeRuntime(engine).browserPng({
        target: MOTION_CAPTURE_RESOURCE_ID,
      });
      setState({ kind: "working", taken: taken.length + 1 });
      await timeline.transport.stepBy({ ticks: CAPTURE_STRIDE });
      await awaitPresentedFrame();
      return shoot(remaining - 1, [...taken, shot.dataUrl.slice(shot.dataUrl.indexOf(",") + 1)]);
    };

    const frames = await (async () => {
      await timeline.transport.pause();
      try {
        await timeline.transport.seekTo({ clock: "motionFrame", tick: 0 });
        await awaitPresentedFrame();
        return await shoot(CAPTURE_FRAMES, []);
      } finally {
        await timeline.transport.seekTo(before.position);
        await awaitPresentedFrame();
        await engine.flush();
        if (before.playing) await timeline.transport.play({ rate: before.rate });
      }
    })();

    const response = await fetch("/api/motion-gif", {
      body: JSON.stringify({ delayMs: Math.round(CAPTURE_DELAY_MS), frames, slug }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      setState({ kind: "failed", reason: (await response.text()).slice(0, 300) });
      return;
    }
    const path = response.headers.get("x-motion-preview-path") ?? undefined;
    setState({
      kind: "ready",
      ...(path === undefined ? {} : { path }),
      url: URL.createObjectURL(await response.blob()),
    });
  };

  return (
    <div className={styles.capture()}>
      <Button
        size="xs"
        variant="ghost"
        disabled={state.kind === "working"}
        onClick={() => {
          void capture().catch((cause: unknown) => {
            setState({
              kind: "failed",
              reason: cause instanceof Error ? cause.message : String(cause),
            });
          });
        }}
      >
        {state.kind === "working"
          ? `Capturing ${String(state.taken)} of ${String(CAPTURE_FRAMES)}`
          : "Capture GIF"}
      </Button>
      {state.kind === "failed" ? (
        <span className={styles.captureNote()}>{state.reason}</span>
      ) : null}
      {state.kind === "ready" ? (
        <>
          <a className={styles.captureNote()} download={`${slug}.gif`} href={state.url}>
            Download {slug}.gif
          </a>
          {state.path === undefined ? null : (
            <span className={styles.captureNote()}>Saved to {state.path}</span>
          )}
          <img alt={`${slug} performed`} className={styles.capturePreview()} src={state.url} />
        </>
      ) : null}
    </div>
  );
};

const CatalogueEntry = ({
  entry,
  onSelect,
  selected,
}: {
  readonly entry: MotionPrompt;
  readonly onSelect: (entry: MotionPrompt) => void;
  readonly selected: boolean;
}) => {
  const styles = motionPlaygroundEntryStyles({ selected });
  const caption = motionPlaygroundStyles();
  return (
    <button
      className={styles.row()}
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onSelect(entry);
      }}
    >
      <span className={caption.caption()}>{entry.prompt}</span>
      <span className={styles.facets()}>
        {facetsOf(entry).map((facet) => (
          <Badge key={facet} className={caption.facet()} variant="ghost">
            {facet}
          </Badge>
        ))}
      </span>
    </button>
  );
};

/**
 * The motion playground: every caption in the library, each performed alone.
 *
 * The library is a set of captions whose motion nobody has watched. A scene shows them chained and
 * cut, which is the wrong instrument for asking whether one caption produces the movement it names.
 * Here a caption is opened as a one actor story on its own throwaway timeline, so what is on screen
 * is that caption and nothing else.
 *
 * This route holds no document. Its timeline is in memory and nothing it opens is saved, so a
 * caption can be opened, judged, and dropped without touching the durable scene.
 */
export const MotionPlayground = () => {
  const styles = motionPlaygroundStyles();
  const [timeline, setTimeline] = useState<TimelineRuntime<typeof motionTimelineDeclaration>>();
  const [entries, setEntries] = useState<ReadonlyArray<MotionPrompt>>([]);
  const [selected, setSelected] = useState<MotionPrompt>();
  const [search, setSearch] = useState("");
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const mount = { live: true };
    void openTimeline({
      declaration: motionTimelineDeclaration,
      run: "ardy:playground",
      storage: { kind: "memory" },
    }).then((opened) => {
      if (mount.live) setTimeline(opened);
    });
    void promptLibrary.loadManifest().then(
      () => {
        if (mount.live) setEntries(promptLibrary.list());
      },
      () => {
        if (mount.live) setEntries(promptLibrary.list());
      },
    );
    return () => {
      mount.live = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter(
        (entry) =>
          needle === "" ||
          entry.prompt.toLowerCase().includes(needle) ||
          (entry.tags ?? []).some((tag) => tag.includes(needle)) ||
          (entry.category ?? "").includes(needle),
      )
      .toSorted((left, right) => left.prompt.localeCompare(right.prompt));
  }, [entries, search]);

  const openSession: WebGpuCanvasSessionFactory<typeof motionTimelineDeclaration> = async (
    input,
  ) => {
    if (selected === undefined) throw new Error("No caption is selected.");
    // A caption's row is fetched the first time it is used, so it is loaded before the story opens.
    await promptLibrary.ensure([selected.prompt]);
    return openMotionProduction({ story: previewStory(selected), timeline: input.timeline });
  };

  return (
    <main className={styles.root()}>
      <aside className={styles.side()}>
        <header className={styles.header()}>
          <span className={styles.title()}>Motion playground</span>
          <span className={styles.count()}>{String(shown.length)}</span>
        </header>
        <div className={styles.section()}>
          <input
            className={styles.field()}
            placeholder="Search a caption, a tag, or a category"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {shown.length === 0 ? (
          <p className={styles.empty()}>No caption matches.</p>
        ) : (
          <div className={styles.scroller()}>
            {shown.map((entry) => (
              <CatalogueEntry
                key={entry.prompt}
                entry={entry}
                onSelect={(next) => {
                  setFailure(undefined);
                  setSelected(next);
                }}
                selected={entry.prompt === selected?.prompt}
              />
            ))}
          </div>
        )}
      </aside>
      <section className={styles.stage()}>
        <div className={styles.stageBar()}>
          <span className={styles.caption()}>
            {selected?.prompt ?? "Choose a caption to watch it performed alone."}
          </span>
          {selected === undefined ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelected(undefined);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <div className={styles.stageBody()}>
          {failure === undefined ? null : <p className={styles.waiting()}>{failure}</p>}
          {timeline === undefined || selected === undefined || failure !== undefined ? (
            failure === undefined ? (
              <p className={styles.waiting()}>
                {timeline === undefined
                  ? "Opening a throwaway timeline for this route."
                  : `Each caption plays alone for ${String(PREVIEW_SECONDS)} seconds on its own story, so what you see is that caption and nothing else.`}
              </p>
            ) : null
          ) : (
            <WebGpuCanvas
              key={selected.prompt}
              className={styles.canvas()}
              onError={(cause: unknown) => {
                setFailure(cause instanceof Error ? cause.message : String(cause));
              }}
              openSession={openSession}
              timeline={timeline}
            >
              <PreviewCapture slug={slugOf(selected.prompt)} />
            </WebGpuCanvas>
          )}
        </div>
      </section>
    </main>
  );
};
