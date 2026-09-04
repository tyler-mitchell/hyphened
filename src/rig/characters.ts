export interface ServedCharacter {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
}

const dropped = import.meta.glob<string>("../characters/*.{glb,gltf}", {
  eager: true,
  import: "default",
  query: "?url",
});

const titleOf = (path: string): string => {
  const file = (path.split("/").pop() ?? path).replace(/\.(glb|gltf)$/, "");
  const words = file.replaceAll(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const SERVED_CHARACTERS: readonly ServedCharacter[] = [
  { id: "humanoid", title: "Humanoid" },
  {
    id: "superhero-male",
    title: "Superhero male",
    url: "/assets/ardy/characters/Superhero_Male_FullBody.gltf",
  },
  {
    id: "superhero-female",
    title: "Superhero female",
    url: "/assets/ardy/characters/Superhero_Female_FullBody.gltf",
  },
  ...Object.entries(dropped)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([path, url]) => ({ id: path, title: titleOf(path), url })),
];

export const DEFAULT_CHARACTER = "/assets/ardy/characters/Superhero_Male_FullBody.gltf";

/**
 * The character a scene opens on. A saved scene keeps whichever character it was last given, and
 * a dropped file can leave with the person who dropped it, so a name this build no longer serves
 * opens on the default rather than refusing the scene.
 */
export const servedCharacter = (stored: string | null | undefined): string =>
  SERVED_CHARACTERS.some(({ url }) => url !== undefined && url === stored)
    ? stored!
    : DEFAULT_CHARACTER;
