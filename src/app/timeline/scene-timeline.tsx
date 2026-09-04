import type {
  TimelineCompositionWindowTrack,
  TimelinePersistenceValue,
  TimelineRuntime,
} from "@coretime/core";
import { timelineFractionToNumber } from "@coretime/core";
import { useTimelineValue } from "@coretime/core/react";
import {
  formatTimelinePosition,
  Timeline,
  type TimelineCompositionEditPermission,
  useTimelineCommand,
  useTimelineCompositionContext,
} from "@coretime/editor";
import { type } from "arktype";
import { Button } from "@hyphened/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hyphened/ui/components/select";
import { tv } from "@hyphened/ui/tv";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Camera,
  Footprints,
  Hand,
  type LucideIcon,
  MessageSquareText,
  Pause,
  PersonStanding,
  Play,
  RotateCcw,
  Route,
  Video,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { MOTION_FRAMES_PER_SECOND } from "webgpu-engine/motion";
import { useEngine } from "webgpu-engine/react";
import { SERVED_CHARACTERS } from "../../rig/characters";
import { recordScene } from "../../stage/record";
import { wearCharacter } from "../../scene/project";
import {
  actorTrack,
  CAMERA_TRACK,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import { observeSceneHistory, type SceneHistoryEntry } from "../../scene/history";
import type { motionTimelineDeclaration } from "../../scene/timeline";
import { PromptSpanEditor } from "./prompt-span-editor";
import {
  timelineItemContentStyles,
  timelineItemResizeHandleStyles,
  timelineItemStyles,
  timelineOccurrenceSummaryStyles,
  timelinePointStyles,
} from "./timeline-item.styles";
import {
  timelineGroupStyles,
  timelineHeaderStyles,
  timelinePanelStyles,
  timelinePlayheadStyles,
  timelineRootStyles,
  timelineRulerStyles,
  timelineScrubAreaStyles,
  timelineSelectionAreaStyles,
  timelineSnapGuideStyles,
  timelineTrackListStyles,
  timelineTrackStyles,
  timelineTransitionStyles,
  timelineViewportStyles,
} from "./timeline.styles";

type MotionDeclaration = typeof motionTimelineDeclaration;

export type RestartScene = () => Promise<void>;

export interface SceneChoice {
  readonly id: string;
  readonly title: string;
}

type ItemTone = NonNullable<Parameters<typeof timelineItemStyles>[0]>["tone"];

const GLYPHS: Readonly<Record<string, LucideIcon>> = {
  [CAMERA_TRACK]: Camera,
  foot: Footprints,
  hand: Hand,
  pose: PersonStanding,
  prompt: MessageSquareText,
  route: Route,
};

/**
 * Whether the scene can still describe itself after an edit.
 *
 * An edit the scene cannot describe used to throw inside the event resolver, which reaches the
 * editor as nothing happening. Refusing it here makes the same rule a denial the item can show.
 */
const sceneAdmits = (
  permission: TimelineCompositionEditPermission<MotionDeclaration>,
): boolean =>
  permission.kind !== "proposal" ||
  !(SceneComposition(permission.after.compositions[SCENE_COMPOSITION]) instanceof type.errors);

const PROMPT_TONE_COUNT = 4;

const promptTone = (prompt: string): ItemTone => {
  const hashed = Array.from(prompt).reduce(
    (total, character) => total + character.codePointAt(0)!,
    0,
  );
  return `prompt-${String(hashed % PROMPT_TONE_COUNT)}` as ItemTone;
};

const dataRecord = (
  value: TimelinePersistenceValue | undefined,
): Record<string, TimelinePersistenceValue | undefined> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, TimelinePersistenceValue | undefined>)
    : undefined;

const stringField = (value: TimelinePersistenceValue | undefined, key: string) => {
  const field = dataRecord(value)?.[key];
  return typeof field === "string" ? field : undefined;
};

const itemTone = (item: {
  readonly data?: TimelinePersistenceValue;
  readonly track: string;
}): ItemTone => {
  const prompt = stringField(item.data, "prompt");
  if (prompt !== undefined) return promptTone(prompt);
  return (actorTrack(item.track)?.tone as ItemTone) ?? "unknown";
};

const chromeStyles = tv({
  slots: {
    group:
      "ml-1 flex h-7 items-center gap-0.5 rounded-editor-control border-0 bg-surface-control px-0.5 aria-invalid:bg-destructive/15",
    playIcon: "translate-x-px",
    position:
      "min-w-[92px] px-1.5 text-center font-mono text-[11px] tabular-nums text-foreground-control-muted",
    story:
      "h-6 max-w-[140px] rounded-editor-control border-0 bg-transparent px-1.5 text-[13px] font-medium text-foreground-control-muted outline-none transition-colors duration-150 hover:text-foreground-control focus-visible:ring-1 focus-visible:ring-ring",
  },
});

const TransportPosition = ({ timeline }: { timeline: TimelineRuntime<MotionDeclaration> }) => {
  const position = useTimelineValue(timeline.state$.transport.position);
  const styles = chromeStyles();
  return (
    <output className={styles.position()}>
      {formatTimelinePosition({
        declaration: timeline.declaration,
        position: {
          clock: position.clock,
          tick: {
            denominator: "1",
            numerator: String(Math.floor(timelineFractionToNumber(position.tick))),
          },
        },
        style: "elapsed",
      })}
    </output>
  );
};

const SceneTransportControls = ({
  character,
  restart,
  scene,
  scenes,
  timeline,
}: {
  character: string | undefined;
  restart: RestartScene;
  scene: string;
  scenes: readonly SceneChoice[];
  timeline: TimelineRuntime<MotionDeclaration>;
}) => {
  const playing = useTimelineValue(timeline.state$.transport.playing);
  const command = useTimelineCommand();
  const navigate = useNavigate();
  const styles = chromeStyles();
  const { engine } = useEngine<MotionDeclaration>();
  const [recorded, setRecorded] = useState<number | undefined>(undefined);
  // Recording steps the transport frame by frame, so the file plays at the timeline's rate however
  // slowly generation ran. The browser cannot start a download for the page, so the link is clicked.
  const record = async () => {
    const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
    const composition = SceneComposition.assert(readout.composition);
    setRecorded(0);
    try {
      const film = await recordScene({
        engine,
        frameCount: composition.frameCount,
        onProgress: (frame: number) =>
          setRecorded(Math.round((frame / composition.frameCount) * 100)),
        timeline,
      });
      const href = URL.createObjectURL(film);
      const link = window.document.createElement("a");
      link.download = `${scene}.mp4`;
      link.href = href;
      link.click();
      URL.revokeObjectURL(href);
    } finally {
      setRecorded(undefined);
    }
  };
  const served = SERVED_CHARACTERS.find(({ url }) => url === character);
  const choices =
    served === undefined && character !== undefined
      ? [
          ...SERVED_CHARACTERS,
          { id: character, title: character.split("/").pop() ?? character, url: character },
        ]
      : SERVED_CHARACTERS;
  const worn = served ?? choices[choices.length - 1]!;
  const transportAction = playing ? "Pause" : "Play";
  const toggleTransport = () =>
    void command.run(() => (playing ? timeline.transport.pause() : timeline.transport.play()));
  useHotkey("Space", toggleTransport, {
    enabled: !command.pending,
    ignoreInputs: true,
    requireReset: true,
  });

  return (
    <div
      aria-busy={command.pending}
      aria-invalid={command.errorMessage !== undefined}
      className={styles.group()}
      title={command.errorMessage}
    >
      <Button
        aria-label={transportAction}
        disabled={command.pending}
        onClick={toggleTransport}
        size="icon-xs"
        title={`${transportAction} (Space)`}
        variant="ghost"
      >
        {playing ? <Pause /> : <Play className={styles.playIcon()} />}
      </Button>
      {/* Restarting through the scene, not the transport: a bare transport restart resets the
          schedules that carry actor presence without re-admitting the actors, which empties the
          scene. */}
      <Button
        aria-label="Restart"
        disabled={command.pending}
        onClick={() => void command.run(restart)}
        size="icon-xs"
        variant="ghost"
      >
        <RotateCcw />
      </Button>
      <Button
        aria-label="Record"
        disabled={command.pending || recorded !== undefined}
        onClick={() => void command.run(record)}
        size="icon-xs"
        title="Record the scene to an MP4"
        variant="ghost"
      >
        {recorded === undefined ? <Video /> : <span className="text-[9px]">{recorded}</span>}
      </Button>
      <Select
        onValueChange={(value) => {
          if (value !== null) void navigate({ search: { scene: value }, to: "/" });
        }}
        value={scene}
      >
        <SelectTrigger aria-label="Scene" className={styles.story()} size="sm">
          <SelectValue>{scenes.find(({ id }) => id === scene)?.title ?? "Scene"}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {scenes.map(({ id, title }) => (
            <SelectItem key={id} value={id}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choices.length < 2 ? null : (
        <Select
          onValueChange={(value) => {
            const chosen = choices.find(({ id }) => id === value);
            if (chosen !== undefined) void command.run(() => wearCharacter(chosen.url));
          }}
          value={worn.id}
        >
          <SelectTrigger aria-label="Character" className={styles.story()} size="sm">
            <SelectValue>{worn.title}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {choices.map(({ id, title }) => (
              <SelectItem key={id} value={id}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <TransportPosition timeline={timeline} />
    </div>
  );
};

const TRAIL_LENGTH = 6;

/** The last authored transactions with their authors, read from the scene's own journal. */
const SceneHistoryTrail = ({ timeline }: { timeline: TimelineRuntime<MotionDeclaration> }) => {
  const [entries, setEntries] = useState<readonly SceneHistoryEntry[]>([]);
  useEffect(() => {
    // The subscription replays history from the beginning, so a re-run of this effect (React's
    // development double mount) starts from an empty trail, and a replaced subscription that is
    // still closing delivers nothing.
    const mount = { live: true };
    setEntries([]);
    const opening = observeSceneHistory({
      handle: (entry) => {
        if (mount.live) setEntries((current) => [...current, entry].slice(-TRAIL_LENGTH));
      },
      timeline,
    });
    return () => {
      mount.live = false;
      void opening.then((subscription) => subscription.close());
    };
  }, [timeline]);
  return (
    <ol aria-label="Authorship trail" className="flex items-center gap-2 text-xs">
      {entries.map((entry) => (
        <li className="whitespace-nowrap" key={entry.id}>
          <span className="opacity-60">{entry.author}</span> {entry.action}
        </li>
      ))}
    </ol>
  );
};

const SceneTrackRow = ({
  children,
  indexed,
}: {
  children: ReactNode;
  indexed: TimelineCompositionWindowTrack;
}) => {
  const styles = timelineTrackStyles();
  const declared = actorTrack(indexed.track.id);
  const label = declared?.label ?? stringField(indexed.track.data, "label") ?? indexed.track.id;
  const Icon = GLYPHS[declared?.glyph ?? indexed.track.id] ?? Footprints;
  return (
    <Timeline.Track
      className={styles.root()}
      node={indexed.track.id}
      parent={indexed.ancestors.at(-1)}
    >
      <Timeline.TrackHeader
        className={styles.header()}
        contentClassName={styles.content()}
        icon={<Icon className={styles.icon()} />}
        label={label}
        labelClassName={styles.label()}
        secondary=""
        secondaryClassName={styles.secondary()}
      />
      <Timeline.TrackCanvas className={styles.canvas()} trackId={indexed.track.id}>
        {children}
      </Timeline.TrackCanvas>
    </Timeline.Track>
  );
};

const SceneTimelineSurface = ({
  character,
  restart,
  scene,
  scenes,
  timeline,
}: {
  character: string | undefined;
  restart: RestartScene;
  scene: string;
  scenes: readonly SceneChoice[];
  timeline: TimelineRuntime<MotionDeclaration>;
}) => {
  const editor = useTimelineCompositionContext<MotionDeclaration>();
  const content = timelineItemContentStyles();
  const group = timelineGroupStyles();
  const header = timelineHeaderStyles();
  const playhead = timelinePlayheadStyles();
  const ruler = timelineRulerStyles();
  const scrubArea = timelineScrubAreaStyles();
  const selectionArea = timelineSelectionAreaStyles();
  const snapGuide = timelineSnapGuideStyles();
  const trackList = timelineTrackListStyles();
  const transition = timelineTransitionStyles();

  return (
    <section aria-label="Scene timeline" className={timelinePanelStyles()}>
      <Timeline.Header className={header.root()}>
        <div className={header.primary()}>
          <span className={header.label()}>Scene</span>
          <SceneTransportControls
            character={character}
            restart={restart}
            scene={scene}
            scenes={scenes}
            timeline={timeline}
          />
        </div>
        <div className={header.status()}>
          <SceneHistoryTrail timeline={timeline} />
          {editor.errorMessage === undefined ? null : <span>{editor.errorMessage}</span>}
        </div>
      </Timeline.Header>
      <Timeline.Viewport className={timelineViewportStyles()}>
        <Timeline.Ruler
          className={ruler.root()}
          classNames={{ corner: ruler.corner(), surface: ruler.surface(), tick: ruler.tick() }}
          label="frame"
        />
        <Timeline.ScrubArea
          className={scrubArea.root()}
          classNames={{
            corner: scrubArea.corner(),
            handle: scrubArea.handle(),
            hover: scrubArea.hover(),
            hoverLabel: scrubArea.hoverLabel(),
            surface: scrubArea.surface(),
          }}
        />
        <Timeline.SelectionArea boxClassName={selectionArea.box()} className={selectionArea.root()}>
          <Timeline.CompositionTrackList<MotionDeclaration>
            className={trackList.root()}
            renderGroup={({ group: indexed }) => {
              const expanded = editor.visibility.isExpanded(indexed.group.id);
              const label = stringField(indexed.group.data, "label") ?? indexed.group.id;
              return (
                <Timeline.Group
                  className={group.root()}
                  depth={indexed.ancestors.length}
                  node={indexed.group.id}
                  parent={indexed.ancestors.at(-1)}
                >
                  <Timeline.GroupDisclosure
                    className={group.header()}
                    expanded={expanded}
                    label={label}
                    onExpandedChange={(next) =>
                      editor.visibility.setExpanded({ expanded: next, group: indexed.group.id })
                    }
                  >
                    <span aria-hidden className={group.disclosure()}>
                      {expanded ? <ChevronDown /> : <ChevronRight />}
                    </span>
                    <span className={group.label()}>{label}</span>
                  </Timeline.GroupDisclosure>
                  <Timeline.GroupCanvas className={group.canvas()} />
                </Timeline.Group>
              );
            }}
            renderItem={({ item }) => {
              const tone = itemTone({ data: item.item.data, track: item.track });
              const prompt = stringField(item.item.data, "prompt");
              return (
                <Timeline.CompositionItem
                  decoration={
                    prompt === undefined ? undefined : (
                      <PromptSpanEditor item={item.item.id} timeline={timeline} />
                    )
                  }
                  classNames={{
                    item: ({ selected, status }) => ({
                      label: content.label(),
                      resizeHandle: timelineItemResizeHandleStyles(),
                      root: timelineItemStyles({ selected, status, tone }),
                      subtitle: content.subtitle(),
                    }),
                    occurrenceSummary: ({ selected }) => {
                      const classes = timelineOccurrenceSummaryStyles({ selected });
                      return { count: classes.count(), root: classes.root() };
                    },
                    point: ({ selected, status }) => {
                      const classes = timelinePointStyles({ selected, status, tone });
                      return { dot: classes.dot(), root: classes.root(), stem: classes.stem() };
                    },
                  }}
                  item={item}
                  label={prompt ?? stringField(item.item.data, "label") ?? item.item.id}
                  resizeMode="roll"
                  subtitle={(interaction) =>
                    interaction.duration === 0
                      ? ""
                      : `${(interaction.duration / MOTION_FRAMES_PER_SECOND).toFixed(1)} s`
                  }
                />
              );
            }}
            renderTrack={({ children, track }) => (
              <SceneTrackRow indexed={track}>{children}</SceneTrackRow>
            )}
            renderTransition={({ transition: indexed }) => (
              <Timeline.CompositionTransition
                className={transition.root()}
                label={stringField(indexed.transition.data, "label") ?? "Blend"}
                labelClassName={transition.label()}
                resizeHandleClassName={timelineItemResizeHandleStyles()}
                transition={indexed}
              />
            )}
            rowClassName={trackList.row()}
          >
            <Timeline.Grid />
            <Timeline.SnapGuide className={snapGuide.root()} lineClassName={snapGuide.line()} />
            <Timeline.Playhead className={playhead.root()} lineClassName={playhead.line()} />
          </Timeline.CompositionTrackList>
        </Timeline.SelectionArea>
      </Timeline.Viewport>
    </section>
  );
};

export const SceneTimeline = ({
  character,
  durationFrames,
  restart,
  scene,
  scenes,
  timeline,
}: {
  character: string | undefined;
  durationFrames: number;
  restart: RestartScene;
  scene: string;
  scenes: readonly SceneChoice[];
  timeline: Parameters<typeof Timeline.Root<MotionDeclaration>>[0]["timeline"];
}) => (
  <Timeline.ErrorBoundary
    fallback={({ error, resetErrorBoundary }) => (
      <output className="flex items-center gap-2 px-3 py-2 font-mono text-xs text-red-300">
        {String(error)}
        <Button onClick={resetErrorBoundary} size="xs" variant="ghost">
          Retry
        </Button>
      </output>
    )}
    resetKeys={[timeline]}
  >
    <Timeline.Root<MotionDeclaration>
      className={timelineRootStyles()}
      formatPosition={(position) =>
        formatTimelinePosition({
          declaration: timeline.declaration,
          position: {
            clock: "motionFrame",
            tick: { denominator: "1", numerator: String(Math.round(position)) },
          },
          style: "elapsed",
        })
      }
      timeline={timeline}
      viewport={{ initialRange: { duration: durationFrames, start: 0 } }}
    >
      <Timeline.Composition<MotionDeclaration>
        canEdit={sceneAdmits}
        composition={SCENE_COMPOSITION}
        events={sceneCompositionEvents}
        rootComposition={SCENE_COMPOSITION}
        snapping={{ distance: 10 }}
      >
        <SceneTimelineSurface
          character={character}
          restart={restart}
          scene={scene}
          scenes={scenes}
          timeline={timeline}
        />
      </Timeline.Composition>
    </Timeline.Root>
  </Timeline.ErrorBoundary>
);
