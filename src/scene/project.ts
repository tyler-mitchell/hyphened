import {
  openTimeline,
  TimelineHistoryIncompatibleError,
  type TimelineRuntime,
} from "@coretime/core";
import { openIndexedDbTimelineJournal } from "@coretime/core/indexeddb";
import {
  openTimelineProjectCatalog,
  type TimelineProjectCatalog,
  type TimelineProjectEntry,
} from "@coretime/project";
import { openBrowserProjectDatabase } from "@coretime/project/browser";
import { type } from "arktype";

import { motionTextEmbedding, type TextEmbedding } from "webgpu-engine/motion";
import { promptLibrary } from "./prompts";
import { motionTimelineDeclaration } from "./timeline";

const SceneProjectDefinition = type({
  format: "'ardy/scene'",
  id: "string >= 1",
  schemaVersion: "1",
  title: "string >= 1",
});
type SceneProjectDefinition = typeof SceneProjectDefinition.infer;

const SCOPE = { format: "ardy/scene", schemaVersion: 1 } as const;
const DATABASE = "ardy";
const EMBEDDING_TABLE = "embedding";

/** One encoded prompt row kept beside the catalog, so a persisted scene's prompts stay admissible. */
const EmbeddingRecord = type({
  embedding: "unknown",
  pace: "number >= 0",
  prompt: "string > 0",
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

const runId = (project: string) => `ardy:scene:${project}:${crypto.randomUUID()}`;

const openRun = async (run: string) => {
  const journal = await openIndexedDbTimelineJournal({ database: DATABASE, id: run });
  try {
    const timeline = await openTimeline({
      declaration: motionTimelineDeclaration,
      run,
      storage: { journal: journal.journal, kind: "journal" },
    });
    return { journal, timeline };
  } catch (cause) {
    await journal.close();
    throw cause;
  }
};

const createScene = async (catalog: TimelineProjectCatalog<SceneProjectDefinition>) => {
  const definition = {
    format: "ardy/scene",
    id: crypto.randomUUID(),
    schemaVersion: 1,
    title: "Scene",
  } as const;
  const record = await catalog.create({ definition, run: runId(definition.id) });
  if (record === undefined) throw new Error("The scene project could not be created.");
  await catalog.setActive({ project: definition.id });
  return record;
};

/**
 * The browser's durable scene: the project catalog lives in SurrealDB with an IndexedDB snapshot,
 * the composition history in the Core Time IndexedDB journal of the project's run. The active
 * project reopens; when none exists a new one is created and the scene seeds on open.
 */
export const openSceneProject = async (): Promise<SceneProject> => {
  const database = await openBrowserProjectDatabase({
    additionalTables: [EMBEDDING_TABLE],
    database: DATABASE,
    namespace: "coretime",
    snapshot: { database: "ardy-scene-projects" },
  });
  const [stored] = await database.client.query<[unknown[]]>(`SELECT * FROM ${EMBEDDING_TABLE}`);
  for (const row of stored ?? []) {
    const record = EmbeddingRecord(row);
    if (record instanceof type.errors) continue;
    const embedding = motionTextEmbedding.Admission(record.embedding);
    if (embedding instanceof type.errors) continue;
    promptLibrary.admit({ embedding, pace: record.pace });
  }
  const saveEmbedding: SceneProject["saveEmbedding"] = async (input) => {
    await database.client.query(
      `UPSERT type::thing($table, $id) CONTENT { embedding: $embedding, pace: $pace, prompt: $prompt }`,
      {
        embedding: input.embedding,
        id: input.embedding.identity.sha256,
        pace: input.pace,
        prompt: input.embedding.prompt,
        table: EMBEDDING_TABLE,
      },
    );
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
  const opened = await openRun(record.run).catch(async (cause: unknown) => {
    if (!(cause instanceof TimelineHistoryIncompatibleError)) throw cause;
    // History from an older build stays under its run; the project moves to a new run.
    const moved = await catalog.saveRun({ project: record.definition.id, run: runId(record.definition.id) });
    if (moved === undefined) throw cause;
    return openRun(moved.run);
  });
  return {
    catalog,
    close: async () => {
      await opened.timeline.close();
      await opened.journal.close();
      await database.close();
    },
    record,
    saveEmbedding,
    timeline: opened.timeline,
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

// Database, journal, and timeline ownership cannot move across a hot module replacement.
if (import.meta.hot) {
  import.meta.hot.accept(() => location.reload());
}
