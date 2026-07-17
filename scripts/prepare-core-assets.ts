import { resolve } from "node:path";
import { defineCommand, runMain } from "citty";

import { buildCoreAssetBundle } from "./core-assets/build";

const command = defineCommand({
  meta: {
    name: "prepare-core-assets",
    description: "Build the browser-native Core skeleton and skin bundle from pinned ARDY assets",
  },
  args: {
    source: {
      type: "string",
      description: "Directory containing upstream joints.p and skin_standard.npz",
      default: "public/assets/ardy/core/source",
    },
    output: {
      type: "string",
      description: "Output directory for the admitted browser bundle",
      default: "public/assets/ardy/core",
    },
  },
  async run({ args }) {
    await buildCoreAssetBundle({
      sourceDirectory: resolve(args.source),
      outputDirectory: resolve(args.output),
    });
  },
});

await runMain(command);
