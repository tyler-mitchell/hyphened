import {
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  useCommandFilter,
} from "@hyphened/ui/components/command";
import { Toggle } from "@hyphened/ui/components/toggle";
import { ToggleGroup } from "@hyphened/ui/components/toggle-group";
import { useMemo, useState, type ReactNode } from "react";

import { promptLibrary, type MotionPrompt } from "../../scene/prompts";
import { motionLibraryStyles } from "./motion-library.styles";

/** An entry that carries no category still belongs to the library; it is grouped, not hidden. */
const UNCLASSIFIED = "unclassified";
const ALL = "all";

type PromptGroup = { readonly category: string; readonly items: readonly MotionPrompt[] };

const categoryOf = ({ category }: MotionPrompt) => category ?? UNCLASSIFIED;

/** The two facts that pick between captions. The rest stay searchable but unprinted. */
const metaOf = (entry: MotionPrompt) => ({
  pace: entry.pace > 0 ? `${String(entry.pace)} m/s` : "in place",
  posture:
    entry.posture === undefined ||
    (entry.posture.enter === "stand" && entry.posture.exit === "stand")
      ? undefined
      : `${entry.posture.enter} → ${entry.posture.exit}`,
});

/** Every caption an actor can be conditioned on, as a command palette. */
export const MotionPromptPicker = ({
  action,
  onChoose,
  onOpenChange,
  open,
  status,
}: {
  readonly action: string;
  readonly onChoose: (entry: MotionPrompt) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly status?: ReactNode;
}) => {
  const styles = motionLibraryStyles();
  const filter = useCommandFilter({ sensitivity: "base" });
  const [category, setCategory] = useState(ALL);
  // The library is registered when the scene opens, and this panel mounts inside the open session.
  const entries = useMemo(
    () => promptLibrary.list().toSorted((left, right) => left.prompt.localeCompare(right.prompt)),
    [],
  );

  const gathered = useMemo(
    () =>
      Array.from(
        entries
          .reduce((total, entry) => {
            const name = categoryOf(entry);
            return total.set(name, [...(total.get(name) ?? []), entry]);
          }, new Map<string, readonly MotionPrompt[]>())
          .entries(),
      ).toSorted(([left], [right]) => left.localeCompare(right)),
    [entries],
  );

  const counts = useMemo(
    () => [
      [ALL, entries.length] as const,
      ...gathered.map(([name, items]) => [name, items.length] as const),
    ],
    [entries, gathered],
  );
  const groups: readonly PromptGroup[] = useMemo(
    () =>
      gathered
        .filter(([name]) => category === ALL || name === category)
        .map(([name, items]) => ({ category: name, items })),
    [category, gathered],
  );

  return (
    <CommandDialog
      className={styles.dialog()}
      description="Search every caption an actor can be conditioned on."
      filter={(entry: MotionPrompt, query) =>
        filter.contains(entry, query, (item: MotionPrompt) => item.prompt) ||
        (entry.tags ?? []).some((tag) => filter.contains(tag, query)) ||
        filter.contains(categoryOf(entry), query)
      }
      items={groups}
      itemToStringLabel={(entry: MotionPrompt) => entry.prompt}
      onOpenChange={onOpenChange}
      onValueChange={(entry: MotionPrompt | null) => {
        if (entry !== null) onChoose(entry);
      }}
      open={open}
      title="Motion library"
    >
      <CommandInput className={styles.search()} placeholder="Search captions" />

      <ToggleGroup
        className={styles.filters()}
        onValueChange={(next) => setCategory(next[0] ?? ALL)}
        value={[category]}
      >
        {counts.map(([name, count]) => (
          <Toggle className={styles.chip()} key={name} size="sm" value={name}>
            {name}
            <span className={styles.chipCount()}>{String(count)}</span>
          </Toggle>
        ))}
      </ToggleGroup>

      <CommandEmpty className={styles.empty()}>No caption matches.</CommandEmpty>

      <CommandList className={styles.list()}>
        {(group: PromptGroup) => (
          <CommandGroup className={styles.group()} items={group.items} key={group.category}>
            <CommandGroupLabel className={styles.groupLabel()}>{group.category}</CommandGroupLabel>
            <CommandCollection>
              {(entry: MotionPrompt) => {
                const meta = metaOf(entry);
                return (
                  <CommandItem className={styles.item()} key={entry.prompt} value={entry}>
                    <span className={styles.caption()}>{entry.prompt}</span>
                    <span className={styles.meta()}>
                      {meta.posture === undefined ? null : (
                        <span className={styles.posture()}>{meta.posture}</span>
                      )}
                      <span>{meta.pace}</span>
                    </span>
                  </CommandItem>
                );
              }}
            </CommandCollection>
          </CommandGroup>
        )}
      </CommandList>

      <footer className={styles.footer()}>
        <span className={styles.hints()}>
          <span>↑↓ move</span>
          <span>↵ {action}</span>
          <span>esc close</span>
        </span>
        {status}
      </footer>
    </CommandDialog>
  );
};
