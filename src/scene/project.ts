import { openTimeline, type TimelineRuntime } from "@coretime/core";
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
import { sceneAuthorship } from "./history";
import { promptLibrary } from "./prompts";
import { motionTimelineDeclaration } from "./timeline";

/** The scene document: its identity plus the authored compositions saved from the last commit. */
const SceneProjectDefinition = type({
  "compositions?": "Record<string, object>",
  format: "'ardy/scene'",
  id: "string >= 1",
  schemaVersion: "1",
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
  readonly close: () => Promise<void>;
  readonly record: TimelineProjectEntry<SceneProjectDefinition>;
  /** Keep one encoded prompt with the scene; it is admitted into the library on every open. */
  readonly saveEmbedding: (input: {
    readonly embedding: TextEmbedding;
    readonly pace: number;
  }) => Promise<void>;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}

const createScene = async (catalog: TimelineProjectCatalog<SceneProjectDefinition>) => {
  const definition = {
    format: "ardy/scene",
    id: crypto.randomUUID(),
    schemaVersion: 1,
    title: "Scene",
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
 * commit saves the document back. The active project reopens; when none exists a new one is
 * created and the scene seeds on open.
 */
export const openSceneProject = async (): Promise<SceneProject> => {
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
  const catalog = await openTimelineProjectCatalog({
    admitDefinition: (value): SceneProjectDefinition | undefined => {
      const admitted = SceneProjectDefinition(value);
      return admitted instanceof type.errors ? undefined : admitted;
    },
    database: database.client,
    persist: database.persist,
    scope: SCOPE,
  });
  const record = (await catalog.active()) ?? (await createScene(catalog));
  const timeline = await openTimeline({
    declaration: motionTimelineDeclaration,
    run: record.run,
    storage: { kind: "memory" },
  });
  const saved = record.definition.compositions;
  if (saved !== undefined) {
    await timeline.composition.initialize({
      compositions: saved as Parameters<
        typeof timeline.composition.initialize
      >[0]["compositions"],
      id: RESTORE_TRANSACTION,
    });
  }
  // Every authored transaction (the seed, an editor edit, an agent edit, undo, redo) saves the
  // document; the restore itself is the document and is not saved again.
  const saving = await timeline.events.subscribe({
    from: "current",
    handle: async ({ transaction }) => {
      if (transaction.id === RESTORE_TRANSACTION || sceneAuthorship(transaction.id) === undefined) {
        return;
      }
      const { compositions } = await timeline.composition.readAll();
      await catalog.saveDefinition({ definition: { ...record.definition, compositions } });
    },
  });
  return {
    catalog,
    close: async () => {
      await saving.close();
      await timeline.close();
      await database.close();
    },
    record,
    saveEmbedding,
    timeline,
  };
};

const owner: { opening?: Promise<SceneProject> } = {};

/** The one scene project of this document, opened on first use. */
export const sceneProject = (): Promise<SceneProject> => {
  owner.opening ??= openSceneProject();
  return owner.opening;
};

/** Start a fresh scene: a new project becomes active and the page reopens on it. */
export const startNewScene = async (): Promise<void> => {
  const project = await sceneProject();
  await createScene(project.catalog);
  location.reload();
};

// Database and timeline ownership cannot move across a hot module replacement.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload());
}
