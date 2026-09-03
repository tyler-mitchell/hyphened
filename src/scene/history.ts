import type { TimelineRuntime } from "@coretime/core";

import type { motionTimelineDeclaration } from "./timeline";

/** One authored transaction of the scene: who made it and what they did. */
export interface SceneHistoryEntry {
  readonly action: string;
  readonly author: "agent" | "editor" | "scene";
  readonly id: string;
  readonly step: number;
}

/**
 * Authorship lives in the transaction id. Agent tools commit `agent/<tool>/<uuid>`, the timeline
 * editor commits `timeline:composition:<operation>:<uuid>`, and the seed is `ardy:scene:initialize`.
 * Every other transaction (schedules, publications) is not an authored edit.
 */
export const sceneAuthorship = (
  id: string,
): Pick<SceneHistoryEntry, "action" | "author"> | undefined => {
  if (id.startsWith("agent/")) return { action: id.split("/")[1] ?? "edit", author: "agent" };
  if (id.startsWith("timeline:composition:")) {
    return { action: id.split(":")[2] ?? "edit", author: "editor" };
  }
  if (id === "ardy:scene:initialize") return { action: "seed", author: "scene" };
  return undefined;
};

/** Follow the scene's authored transactions from the beginning of its history, then live. */
export const observeSceneHistory = async (input: {
  readonly handle: (entry: SceneHistoryEntry) => void;
  readonly timeline: TimelineRuntime<typeof motionTimelineDeclaration>;
}): Promise<{ readonly close: () => Promise<void> }> => {
  const subscription = await input.timeline.events.subscribe({
    from: "beginning",
    handle: async (transaction) => {
      const authorship = sceneAuthorship(transaction.transaction.id);
      if (authorship === undefined) return;
      input.handle({ ...authorship, id: transaction.transaction.id, step: transaction.step });
    },
  });
  await subscription.whenReady();
  return { close: () => subscription.close() };
};

/** The authored transactions recorded so far, oldest first. */
export const readSceneHistory = async (
  timeline: TimelineRuntime<typeof motionTimelineDeclaration>,
): Promise<readonly SceneHistoryEntry[]> => {
  const entries: SceneHistoryEntry[] = [];
  const subscription = await observeSceneHistory({
    handle: (entry) => {
      entries.push(entry);
    },
    timeline,
  });
  await subscription.close();
  return entries;
};
