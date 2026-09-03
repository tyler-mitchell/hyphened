import {
  openTimeline,
  type TimelineCompositionChange,
  type TimelineRuntime,
} from "@coretime/core";
import {
  openTimelineProjectCatalog,
  type TimelineProjectCatalog,
  type TimelineProjectEntry,
} from "@coretime/project";
import { openBrowserProjectDatabase } from "@coretime/project/browser";
import { type } from "arktype";
import { arktypeToSurqlTable } from "arktype-adapters/surrealdb";
import { orm, t, table } from "surqlize";

import {
  motionTextEmbedding,
  motionTextEmbeddingSource,
  type TextEmbedding,
} from "webgpu-engine/motion";
import { AuthoredStory } from "../schema";
import { SCENE_COMPOSITION } from "./composition";
import { AUTHORED_STORIES, authoredStoryIdentity, DEFAULT_STORY } from "./default";
import { sceneAuthorship } from "./history";
import { promptLibrary } from "./prompts";
import { motionTimelineDeclaration } from "./timeline";

/** The scene document: its identity plus the authored compositions saved from the last commit. */
const SceneProjectDefinition = type({
  "compositions?": "Record<string, object>",
  format: "'ardy/scene'",
  id: "string >= 1",
  schemaVersion: "1",
  /** The built-in story id this scene was seeded from; a built-in that changed opens a fresh scene. */
  "seed?": "string >= 1",
  /** The story this scene was seeded from, built-in or authored by an agent. */
  story: AuthoredStory,
  title: "string >= 1",
});
type SceneProjectDefinition = typeof SceneProjectDefinition.infer;

const SCOPE = { format: "ardy/scene", schemaVersion: 1 } as const;
const DATABASE = "ardy";
const EMBEDDING_TABLE = "embedding";
const RESTORE_TRANSACTION = "ardy:scene:restore";

/**
 * One encoded prompt row kept beside the catalog, keyed by the row digest. The encoder identity
 * is the pinned one, so only the prompt, its pace, and the feature values are stored.
 */
const embeddingSchema = arktypeToSurqlTable({
  schema: { pace: "number >= 0", prompt: "string > 0", values: "surql.array<number>" },
  table: EMBEDDING_TABLE,
});
const embeddingTable = table(EMBEDDING_TABLE, {
  pace: t.number(),
  prompt: t.string(),
  values: t.array(t.number()),
});

export interface SceneProject {
  readonly catalog: TimelineProjectCatalog<SceneProjectDefinition>;
  readonly record: TimelineProjectEntry<SceneProjectDefinition>;
  /** Close this scene's run and its saving; the database and catalog stay open for the next. */
  readonly release: () => Promise<void>;
  /** Why this scene opened fresh instead of the saved one; absent when the saved one opened. */
  readonly reset?: string;
  /** Keep one encoded prompt with the scene; it is admitted into the library on every open. */
  readonly saveEmbedding: (input: {
    readonly embedding: TextEmbedding;
    readonly pace: number;
  }) => Promise<void>;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}

/** A story to open a scene on: a built-in by id, or one an agent authored. */
export interface SceneStoryChoice {
  readonly seed?: string;
  readonly story: AuthoredStory;
}

const createScene = async (
  catalog: TimelineProjectCatalog<SceneProjectDefinition>,
  choice: SceneStoryChoice,
) => {
  const definition = {
    format: "ardy/scene",
    id: crypto.randomUUID(),
    schemaVersion: 1,
    ...(choice.seed === undefined ? {} : { seed: choice.seed }),
    story: choice.story,
    title: choice.story.title,
  } as const;
  const record = await catalog.create({ definition, run: `ardy:scene:${definition.id}` });
  if (record === undefined) throw new Error("The scene project could not be created.");
  await catalog.setActive({ project: definition.id });
  return record;
};

/**
 * The browser's durable scene is its document: the project catalog in SurrealDB, with an IndexedDB
 * snapshot, holds the authored compositions and the encoded prompts. Playback is live-only, so
 * every open starts a fresh in-memory run seeded from the saved document, and every authored
 * commit saves the document back. The catalog opens once per page; each scene opens from its
 * record.
 */
const openSceneCatalog = async () => {
  const database = await openBrowserProjectDatabase({
    additionalTables: [EMBEDDING_TABLE],
    database: DATABASE,
    namespace: "coretime",
    snapshot: { database: "ardy-scene-projects" },
  });
  await database.client.query(embeddingSchema.surql);
  const embeddings = orm(database.client, embeddingTable);
  for (const row of await embeddings.select(EMBEDDING_TABLE)) {
    const embedding = motionTextEmbedding.Admission({
      identity: { kind: "encoded", sha256: String(row.id.id) },
      prompt: row.prompt,
      source: motionTextEmbeddingSource,
      values: row.values,
    });
    if (embedding instanceof type.errors) continue;
    promptLibrary.admit({ embedding, pace: row.pace });
  }
  const saveEmbedding: SceneProject["saveEmbedding"] = async (input) => {
    await embeddings.upsert(EMBEDDING_TABLE, input.embedding.identity.sha256).content({
      pace: input.pace,
      prompt: input.embedding.prompt,
      values: input.embedding.values,
    });
    await database.persist();
  };
  // The catalog refuses an entry it cannot admit and says so through this hook. A refusal during a
  // read is the difference between a fresh browser and a saved scene that was just discarded, and
  // the two look identical from the record alone.
  const refused = { entry: false };
  const catalog = await openTimelineProjectCatalog({
    admitDefinition: (value): SceneProjectDefinition | undefined => {
      const admitted = SceneProjectDefinition(value);
      return admitted instanceof type.errors ? undefined : admitted;
    },
    database: database.client,
    persist: database.persist,
    scope: SCOPE,
    warn: ({ cause, message }) => {
      refused.entry = true;
      console.warn(message, cause);
    },
  });
  /** The active record, and whether the catalog refused a stored one to arrive at none. */
  const activeRecord = async () => {
    refused.entry = false;
    const record = await catalog.active();
    return { discarded: record === undefined && refused.entry, record };
  };
  const openRecord = async (
    record: TimelineProjectEntry<SceneProjectDefinition>,
    reset?: string,
  ): Promise<SceneProject> => {
    const timeline = await openTimeline({
      declaration: motionTimelineDeclaration,
      run: record.run,
      storage: { kind: "memory" },
    });
    const saved = record.definition.compositions?.[SCENE_COMPOSITION];
    if (saved !== undefined) {
      // The document is the floor of this session's history, not an edit an undo can take back.
      const restore = {
        composition: SCENE_COMPOSITION,
        type: "composition/replace",
        value: saved,
      } as TimelineCompositionChange<typeof motionTimelineDeclaration>;
      await timeline.composition.edit({
        changes: [restore],
        history: false,
        id: RESTORE_TRANSACTION,
      });
    }
    // Every authored transaction (the seed, an editor edit, an agent edit, undo, redo) saves the
    // document; the restore itself is the document and is not saved again.
    const saving = await timeline.events.subscribe({
      from: "current",
      handle: async ({ transaction }) => {
        if (
          transaction.id === RESTORE_TRANSACTION ||
          sceneAuthorship(transaction.id) === undefined
        ) {
          return;
        }
        const { compositions } = await timeline.composition.readAll();
        await catalog.saveDefinition({ definition: { ...record.definition, compositions } });
      },
    });
    return {
      catalog,
      record,
      release: async () => {
        await saving.close();
        await timeline.close();
      },
      ...(reset === undefined ? {} : { reset }),
      saveEmbedding,
      timeline,
    };
  };
  return { activeRecord, catalog, openRecord };
};

const owner: {
  catalog?: ReturnType<typeof openSceneCatalog>;
  opening?: Promise<SceneProject>;
  readonly observers: Set<(project: SceneProject) => void>;
} = { observers: new Set() };

const sceneCatalog = () => {
  owner.catalog ??= openSceneCatalog();
  return owner.catalog;
};

/** The default built-in story, for a fresh document or a stale one. */
const defaultChoice = (): SceneStoryChoice => ({
  seed: DEFAULT_STORY,
  story: AUTHORED_STORIES[DEFAULT_STORY]!,
});

const DISCARDED_SCENE =
  "The saved scene did not match the current scene format, so it was discarded and a new scene opened on the default story.";
const CHANGED_STORY =
  "The built-in story this scene was seeded from has changed, so a new scene opened on its current form.";

/**
 * The one scene project of this document. The active record reopens unless it was seeded from a
 * built-in story that has since changed; then a fresh scene opens on that story's current form
 * and the record stays in the catalog. An agent-authored story is never stale.
 *
 * A saved scene the catalog cannot admit is discarded rather than opened, so a stored document
 * from an older scene format never stops the app from opening. Either reset is reported, since a
 * fresh browser and a discarded scene are different facts that otherwise look the same.
 */
export const sceneProject = (): Promise<SceneProject> => {
  owner.opening ??= sceneCatalog().then(async ({ activeRecord, catalog, openRecord }) => {
    const { discarded, record } = await activeRecord();
    if (record === undefined) {
      const fresh = await createScene(catalog, defaultChoice());
      return openRecord(fresh, discarded ? DISCARDED_SCENE : undefined);
    }
    const seed =
      record.definition.seed === undefined ? undefined : AUTHORED_STORIES[record.definition.seed];
    const stale =
      seed !== undefined &&
      (await authoredStoryIdentity(seed)) !== (await authoredStoryIdentity(record.definition.story));
    if (!stale) return openRecord(record);
    const reseeded = await createScene(catalog, { seed: record.definition.seed, story: seed });
    return openRecord(reseeded, CHANGED_STORY);
  });
  return owner.opening;
};

/** Observe the scene project of this document; a new scene replaces it in place. */
export const observeSceneProject = (observer: (project: SceneProject) => void): (() => void) => {
  owner.observers.add(observer);
  return () => owner.observers.delete(observer);
};

/**
 * Start a fresh scene in place: a new project becomes active and opens on its own run, and the
 * observers (the canvas session) move to it. The previous run is released by the session that
 * held it, once that session has closed.
 */
export const startNewScene = async (choice?: SceneStoryChoice): Promise<SceneProject> => {
  const { catalog, openRecord } = await sceneCatalog();
  const next = await openRecord(await createScene(catalog, choice ?? defaultChoice()));
  owner.opening = Promise.resolve(next);
  owner.observers.forEach((observer) => observer(next));
  return next;
};

// Database and timeline ownership cannot move across a hot module replacement.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload());
}
