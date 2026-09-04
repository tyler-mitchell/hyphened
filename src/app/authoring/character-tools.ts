import { type } from "arktype";

import { loadMotionProvider } from "webgpu-engine/motion";
import { loadGltfCharacter } from "../../rig/gltf-character";
import { humanoidRigHeight, loadHumanoidRigAssets } from "../../rig/skin";
import { bindMotionRig } from "../../rig/binding";
import { wearCharacter } from "../../scene/project";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

const InspectCharacterInput = type({ url: "string >= 1" });
const WearCharacterInput = type({ "url?": "string >= 1" });

const failure = (cause: unknown) => ({
  content: [
    { text: cause instanceof Error ? cause.message : String(cause), type: "text" as const },
  ],
  isError: true,
});

/** The provider's manifest carries the skeleton; only its indices are read, not the weights. */
const readCharacter = async (url: string) => {
  const provider = await loadMotionProvider();
  if (provider.status === "unavailable") throw new Error(provider.reason);
  const motionSkeleton = provider.manifest.skeleton;
  const targetHeight = humanoidRigHeight(await loadHumanoidRigAssets());
  return {
    character: await loadGltfCharacter({ motionSkeleton, targetHeight, uri: url }),
    motionSkeleton,
  };
};

const settled = <T>(work: Promise<T>) =>
  work.then(
    (value) => ({ value }),
    (cause: unknown) => ({ cause }),
  );

/** Read a character file's skeleton and report whether it can drive the motion model. */
export const characterTools = (): readonly RegisteredWebMcpTool[] => [
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "Read the skeleton of a character file and report if it can drive the motion model. Give a .glb or .gltf that this site serves, as a URL or a site-relative path. `compatible` is the answer. `missing` lists the model's joints that the character does not have under any name. A character with missing joints can still be compatible, because a tip joint with nothing below it binds to its parent. The character can also use its own joint order, or carry joints of its own, because the tool reads its skeleton in the model's order. `reparented` lists joints whose parent is not the model's parent. The model's rotations put these joints in the wrong place. This is a warning, not a refusal. `height` is the character's height in the units of its own file. A glTF file does not say which unit it uses, so the scene scales the character to the model's height when an actor wears it. `joints` and `motionJoints` are the two joint lists, without exporter namespaces, so you can compare a rig that uses its own names. This tool reads the skeleton only. It does not put the character in the scene.",
    execute: async (raw) => {
      const input = InspectCharacterInput.assert(raw);
      const read = await settled(readCharacter(input.url));
      if ("cause" in read) return failure(read.cause);
      const { character, motionSkeleton } = read.value;
      const bound =
        character.rig === undefined
          ? undefined
          : bindMotionRig({ motionSkeleton, rig: character.rig });
      return webMcpResult({
        compatible: bound?.status === "available",
        ...(bound === undefined || bound.status === "available"
          ? {}
          : { difference: bound.reason }),
        height: character.height,
        joints: [...character.jointNames],
        missing: [...character.missing],
        motionJoints: [...motionSkeleton.jointNames],
        reparented: [...character.reparented],
        url: input.url,
      });
    },
    inputSchema: webMcpInputSchema(InspectCharacterInput),
    name: "inspect_character",
    outputSchema: {
      additionalProperties: false,
      properties: {
        compatible: { type: "boolean" },
        difference: { type: "string" },
        height: { type: "number" },
        joints: { items: { type: "string" }, type: "array" },
        missing: { items: { type: "string" }, type: "array" },
        motionJoints: { items: { type: "string" }, type: "array" },
        reparented: { items: { type: "string" }, type: "array" },
        url: { type: "string" },
      },
      required: ["compatible", "height", "joints", "missing", "motionJoints", "reparented", "url"],
      type: "object",
    },
  },
  {
    description:
      "Put a character file on this scene's actors. If you give no `url`, the actors wear the released humanoid. The character must carry every joint that the model drives. A character that cannot is refused, and the scene stays as it was. The scene then opens again on its own run and wears the character, which takes a moment. The scene keeps this choice. The reply gives the two facts that explain a character that looks wrong on screen. `height` is the character's height in the units of its own file, and the scene scales the character to the model's height. `reparented` lists the joints whose parent is not the model's parent, so their pose is wrong.",
    execute: async (raw) => {
      const input = WearCharacterInput.assert(raw);
      const url = input.url;
      const read = url === undefined ? undefined : await settled(readCharacter(url));
      if (read !== undefined && "cause" in read) return failure(read.cause);
      const character = read === undefined || "cause" in read ? undefined : read.value.character;
      if (character !== undefined && character.rig === undefined) {
        return failure(
          new Error(
            `${String(url)} cannot drive the motion model; it lacks ${character.undrivable.join(", ")}`,
          ),
        );
      }
      const worn = await settled(wearCharacter(url));
      if ("cause" in worn) return failure(worn.cause);
      return webMcpResult({
        character: url ?? "the released humanoid",
        // The two facts that explain a character that looks wrong once it is on screen.
        ...(character === undefined ? {} : { height: character.height }),
        ...(character === undefined || character.reparented.length === 0
          ? {}
          : { reparented: [...character.reparented] }),
        scene: worn.value.record.definition.id,
        status: "the scene is reopening on its own run wearing this character",
      });
    },
    inputSchema: webMcpInputSchema(WearCharacterInput),
    name: "wear_character",
    outputSchema: {
      additionalProperties: false,
      properties: {
        character: { type: "string" },
        height: { type: "number" },
        reparented: { items: { type: "string" }, type: "array" },
        scene: { type: "string" },
        status: { type: "string" },
      },
      required: ["character", "scene", "status"],
      type: "object",
    },
  },
];
