// The published UI package carries Button; Badge and Input are not in it, and the public build
// resolves against that package rather than this workspace. A facet and the search field are a
// span and an input styled by this file's own slots until the package publishes those two.
import { Button } from "@hyphened/ui";
import { Library, X } from "lucide-react";
import { useMemo, useState } from "react";

import { MOTION_FRAMES_PER_SECOND } from "webgpu-engine/motion";
import { promptLibrary, type MotionPrompt } from "../../scene/prompts";
import {
  motionLibraryChipStyles,
  motionLibraryEntryStyles,
  motionLibraryFacetStyles,
  motionLibraryStyles,
} from "./motion-library.styles";

/** An entry that carries no category still belongs to the library; it is grouped, not hidden. */
const UNCLASSIFIED = "unclassified";
const ALL = "all";

const categoryOf = ({ category }: MotionPrompt) => category ?? UNCLASSIFIED;

/**
 * The facets one row shows, in reading order. A facet is present only when it tells the author
 * something: a posture of stand to stand constrains nothing, and a laterality of none is not a
 * side. Posture is the fact that decides whether two beats can sit next to each other.
 */
const entryFacets = (entry: MotionPrompt) => [
  { facet: "pace" as const, text: entry.pace > 0 ? `${String(entry.pace)} m/s` : "in place" },
  ...(entry.posture === undefined || (entry.posture.enter === "stand" && entry.posture.exit === "stand")
    ? []
    : [{ facet: "posture" as const, text: `${entry.posture.enter} → ${entry.posture.exit}` }]),
  ...(entry.laterality === undefined || entry.laterality === "none"
    ? []
    : [{ facet: "laterality" as const, text: entry.laterality }]),
  ...(entry.duration === undefined
    ? []
    : [{ facet: "duration" as const, text: `${String(entry.duration / MOTION_FRAMES_PER_SECOND)}s` }]),
];

const matchesSearch = ({ entry, search }: { entry: MotionPrompt; search: string }) =>
  entry.prompt.toLowerCase().includes(search) ||
  (entry.tags ?? []).some((tag) => tag.includes(search));

const LibraryEntry = ({ entry }: { readonly entry: MotionPrompt }) => {
  const styles = motionLibraryEntryStyles();
  return (
    <li className={styles.root()}>
      <p className={styles.caption()}>{entry.prompt}</p>
      <div className={styles.facets()}>
        {entryFacets(entry).map(({ facet, text }) => (
          <span key={facet} className={motionLibraryFacetStyles({ facet })}>
            {text}
          </span>
        ))}
        {entry.tags === undefined ? null : (
          <span className={styles.tags()}>{entry.tags.join(" · ")}</span>
        )}
      </div>
    </li>
  );
};

const CategoryFilter = ({
  counts,
  onSelect,
  selected,
}: {
  readonly counts: ReadonlyArray<readonly [string, number]>;
  readonly onSelect: (category: string) => void;
  readonly selected: string;
}) => {
  const styles = motionLibraryChipStyles();
  return (
    <div className={styles.root()}>
      {counts.map(([category, count]) => (
        <Button
          key={category}
          size="xs"
          variant="ghost"
          aria-pressed={category === selected}
          className={motionLibraryChipStyles({ active: category === selected }).chip()}
          onClick={() => {
            onSelect(category);
          }}
        >
          {category} {String(count)}
        </Button>
      ))}
    </div>
  );
};

/**
 * The motion library, visible. Every caption an actor can be conditioned on, with the facets that
 * decide which one an author picks: how fast it travels, the stance it enters and leaves, the side
 * of the body it uses, and how long it runs. The agent reads the same facts through
 * list_motion_prompts; this is the same library for the person at the screen.
 */
export const MotionLibraryPanel = () => {
  const styles = motionLibraryStyles();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  // The library is registered when the scene opens, and this panel mounts inside the open session.
  const entries = useMemo(
    () => promptLibrary.list().toSorted((left, right) => left.prompt.localeCompare(right.prompt)),
    [],
  );
  const counts = useMemo(() => {
    const byCategory = entries.reduce(
      (total, entry) => total.set(categoryOf(entry), (total.get(categoryOf(entry)) ?? 0) + 1),
      new Map<string, number>(),
    );
    return [
      [ALL, entries.length] as const,
      ...Array.from(byCategory.entries()).toSorted(([left], [right]) => left.localeCompare(right)),
    ];
  }, [entries]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (category === ALL || categoryOf(entry) === category) &&
        (needle === "" || matchesSearch({ entry, search: needle })),
    );
  }, [category, entries, search]);

  if (!open) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Show the motion library"
        className={styles.root({ className: "size-7 items-center justify-center" })}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Library />
      </Button>
    );
  }

  return (
    <section className={styles.root()}>
      <header className={styles.header()}>
        <span className={styles.title()}>Motion library</span>
        <span className={styles.count()}>
          {String(shown.length)} / {String(entries.length)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Hide the motion library"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X />
        </Button>
      </header>
      <div className={styles.filters()}>
        <input
          className={styles.search()}
          placeholder="Search a caption or a tag"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <CategoryFilter counts={counts} onSelect={setCategory} selected={category} />
      </div>
      {shown.length === 0 ? (
        <p className={styles.empty()}>No caption matches.</p>
      ) : (
        <ul className={styles.list()}>
          {shown.map((entry) => (
            <LibraryEntry key={entry.prompt} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
};
