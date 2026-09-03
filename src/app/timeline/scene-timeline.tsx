import type {
  TimelineCompositionWindowTrack,
  TimelinePersistenceValue,
  TimelineRuntime,
} from "@coretime/core";
import { timelineFractionToNumber } from "@coretime/core";
import { useTimelineValue } from "@coretime/core/react";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  formatTimelinePosition,
  Timeline,
  useTimelineCommand,
  useTimelineCompositionContext,
} from "@coretime/editor";
import { Button } from "@hyphened/ui/components/button";
import { tv } from "@hyphened/ui/tv";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  Footprints,
  Hand,
  type LucideIcon,
  MessageSquareText,
  Pause,
  PersonStanding,
  Play,
  Redo2,
  RotateCcw,
  Route,
  Trash2,
  Undo2,
  UserPlus,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { MOTION_FRAMES_PER_SECOND } from "webgpu-engine/motion";
import { addActorChange, commitSceneChanges } from "../../scene/actors";
import {
  actorTrack,
  SCENE_COMPOSITION,
  SceneComposition,
  sceneCompositionEvents,
} from "../../scene/composition";
import { AUTHORED_STORIES, DEFAULT_STORY, storyChoices } from "../../scene/default";
import { observeSceneHistory, type SceneHistoryEntry } from "../../scene/history";
import { sceneProject, type SceneStoryChoice } from "../../scene/project";
import type { motionTimelineDeclaration } from "../../scene/timeline";
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

/** Open a new scene on a story. The shell owns the outcome, so this never rejects. */
export type StartScene = (choice: SceneStoryChoice) => Promise<void>;

type ItemTone = NonNullable<Parameters<typeof timelineItemStyles>[0]>["tone"];

const GLYPHS: Readonly<Record<string, LucideIcon>> = {
  foot: Footprints,
  hand: Hand,
  pose: PersonStanding,
  prompt: MessageSquareText,
  route: Route,
};

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
      "ml-1 flex h-7 items-center gap-0.5 rounded-[5px] border border-[var(--editor-border)] bg-[var(--editor-control)] px-0.5 shadow-inner aria-invalid:border-[var(--editor-danger)]/40",
    playIcon: "translate-x-px",
    position:
      "min-w-[92px] px-1.5 text-center font-mono text-[9px] tabular-nums text-[var(--editor-text-secondary)]",
    story:
      "h-5 max-w-[120px] rounded-[4px] border-0 bg-transparent px-1 text-[10px] text-[var(--editor-text-secondary)] outline-none hover:text-[var(--editor-text)] focus-visible:ring-1 focus-visible:ring-[var(--editor-info)]",
    tool: "rounded-[4px] px-1.5 py-0.5 text-[10px] text-[var(--editor-text-secondary)] hover:text-[var(--editor-text)]",
  },
  variants: {
    active: { true: { tool: "bg-[var(--editor-border)] text-[var(--editor-text)]" } },
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
  restart,
  seed,
  startScene,
  timeline,
}: {
  restart: RestartScene;
  seed?: string;
  startScene: StartScene;
  timeline: TimelineRuntime<MotionDeclaration>;
}) => {
  const playing = useTimelineValue(timeline.state$.transport.playing);
  const command = useTimelineCommand();
  const styles = chromeStyles();
  // The picker starts on the story of the scene that is open, so after a switch it names what is
  // playing instead of the default. A scene an agent authored has no built-in story to name.
  const [choice, setChoice] = useState(seed ?? DEFAULT_STORY);

  return (
    <div
      aria-busy={command.pending}
      aria-invalid={command.errorMessage !== undefined}
      className={styles.group()}
      title={command.errorMessage}
    >
      <Button
        aria-label={playing ? "Pause" : "Play"}
        disabled={command.pending}
        onClick={() =>
          void command.run(() => (playing ? timeline.transport.pause() : timeline.transport.play()))
        }
        size="icon-xs"
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
      {/* A fresh scene on a built-in story; the current document stays in the catalog. */}
      <select
        aria-label="Story"
        className={styles.story()}
        onChange={(event) => setChoice(event.target.value)}
        value={choice}
      >
        {storyChoices().map(({ id, title }) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
      <Button
        aria-label="New scene"
        disabled={command.pending}
        onClick={() =>
          void command.run(() => startScene({ seed: choice, story: AUTHORED_STORIES[choice]! }))
        }
        size="icon-xs"
        variant="ghost"
      >
        <FilePlus2 />
      </Button>
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

const SceneEditingControls = ({ timeline }: { timeline: TimelineRuntime<MotionDeclaration> }) => {
  const editor = useTimelineCompositionContext<MotionDeclaration>();
  const command = useTimelineCommand();
  const styles = chromeStyles();
  return (
    <div className={styles.group()}>
      <Button
        aria-label="Undo"
        disabled={!editor.history.canUndo || editor.history.pending}
        onClick={() => void editor.history.undo()}
        size="icon-xs"
        variant="ghost"
      >
        <Undo2 />
      </Button>
      <Button
        aria-label="Redo"
        disabled={!editor.history.canRedo || editor.history.pending}
        onClick={() => void editor.history.redo()}
        size="icon-xs"
        variant="ghost"
      >
        <Redo2 />
      </Button>
      <Button
        aria-label="Duplicate selection"
        disabled={!editor.selection.commands.canDuplicate}
        onClick={() => void editor.selection.commands.duplicate()}
        size="icon-xs"
        variant="ghost"
      >
        <Copy />
      </Button>
      <Button
        aria-label="Remove selection"
        disabled={!editor.selection.commands.canRemove}
        onClick={() => void editor.selection.commands.remove()}
        size="icon-xs"
        variant="ghost"
      >
        <Trash2 />
      </Button>
      {/* A new actor on a spare row, standing two metres right of the cast; the agent tool is
          the same operation with a path and beats. */}
      <Button
        aria-label="Add actor"
        disabled={command.pending}
        onClick={() =>
          void command.run(async () => {
            const readout = await timeline.composition.read({ composition: SCENE_COMPOSITION });
            const scene = SceneComposition.assert(readout.composition);
            const project = await sceneProject();
            const right = Math.max(0, ...scene.actors.map(({ worldOffset }) => worldOffset[0]));
            const { change } = await addActorChange({
              origin: [right + 2, 0, 0],
              scene,
              story: project.record.definition.story,
            });
            await commitSceneChanges({ author: "editor/add-actor", changes: [change], timeline });
          })
        }
        size="icon-xs"
        variant="ghost"
      >
        <UserPlus />
      </Button>
      <Toolbar.Root aria-label="Timeline editing tools" className="flex items-center gap-0.5">
        {(["select", "slip", "slide", "split"] as const).map((tool) => (
          <Timeline.EditToolButton
            active={editor.tool.tool === tool}
            className={styles.tool({ active: editor.tool.tool === tool })}
            key={tool}
            onToolChange={editor.tool.setTool}
            tool={tool}
          />
        ))}
      </Toolbar.Root>
    </div>
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
  const label = stringField(indexed.track.data, "label") ?? indexed.track.id;
  const declared = actorTrack(indexed.track.id);
  const Icon = GLYPHS[declared?.glyph ?? ""] ?? Footprints;
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
  restart,
  seed,
  startScene,
  timeline,
}: {
  restart: RestartScene;
  seed?: string;
  startScene: StartScene;
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
            restart={restart}
            seed={seed}
            startScene={startScene}
            timeline={timeline}
          />
          <SceneEditingControls timeline={timeline} />
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
            renderGroup={({ group: indexed }) => (
              <Timeline.Group
                className={group.root()}
                depth={indexed.ancestors.length}
                node={indexed.group.id}
                parent={indexed.ancestors.at(-1)}
              >
                <Timeline.GroupHeader
                  className={group.header()}
                  classNames={{ disclosure: group.disclosure(), label: group.label() }}
                  collapsedIndicator={<ChevronRight />}
                  expandedIndicator={<ChevronDown />}
                  label={stringField(indexed.group.data, "label") ?? indexed.group.id}
                />
                <Timeline.GroupCanvas className={group.canvas()} />
              </Timeline.Group>
            )}
            renderItem={({ item }) => {
              const tone = itemTone({ data: item.item.data, track: item.track });
              return (
                <Timeline.CompositionItem
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
                  label={
                    stringField(item.item.data, "prompt") ??
                    stringField(item.item.data, "label") ??
                    item.item.id
                  }
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
  durationFrames,
  restart,
  seed,
  startScene,
  timeline,
}: {
  durationFrames: number;
  restart: RestartScene;
  seed?: string;
  startScene: StartScene;
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
        composition={SCENE_COMPOSITION}
        events={sceneCompositionEvents}
        rootComposition={SCENE_COMPOSITION}
        snapping={{ distance: 10 }}
      >
        <SceneTimelineSurface
          restart={restart}
          seed={seed}
          startScene={startScene}
          timeline={timeline}
        />
      </Timeline.Composition>
    </Timeline.Root>
  </Timeline.ErrorBoundary>
);
