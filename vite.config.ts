import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import {
  typegpuBrowserProject,
  typegpuDevtools,
} from "typegpu-devtools/vitest-plugin";
import { browserConsole } from "vite-browser-console";
import { searchForWorkspaceRoot } from "vite";
import type { Vite } from "vite-plus/test/node";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const devtoolsPlugins: Vite.Plugin[] = typegpuDevtools();
const typegpuProject = typegpuBrowserProject();
const dedupe = [
  "react",
  "react-dom",
  "typegpu",
  "typegpu/common",
  "typegpu/data",
  "typegpu/std",
];
const browserProject = {
  ...typegpuProject,
  plugins: [browserConsole(), ...(typegpuProject.plugins ?? [])],
  optimizeDeps: {
    ...typegpuProject.optimizeDeps,
    exclude: [
      ...(typegpuProject.optimizeDeps?.exclude ?? []),
      "@surrealdb/wasm",
    ],
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
  },
  resolve: { dedupe, tsconfigPaths: true },
} satisfies Vite.UserConfig;

export default {
  fmt: {
    ignorePatterns: [
      "**/.nitro/**",
      "**/.output/**",
      "**/.tanstack/**",
      "**/node_modules/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/.nitro/**",
      "**/.output/**",
      "**/.tanstack/**",
      "**/node_modules/**",
    ],
  },
  optimizeDeps: {
    exclude: [
      "@surrealdb/wasm",
      "arktype",
      "typegpu",
      "typegpu/common",
      "typegpu/data",
      "typegpu/std",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
  plugins: [
    browserConsole({
      directory: "console-logs",
      maxErrorCharacters: 32_000,
      maxFileCharacters: 256_000,
      maxUniqueErrors: 128,
    }),
    ...devtoolsPlugins,
    tailwindcss(),
    ...(process.env.VITEST === "true"
      ? []
      : [tanstackStart({ srcDirectory: "src" })]),
    viteReact(),
    ...(process.env.VITEST === "true" ? [] : [nitro()]),
  ],
  resolve: {
    dedupe,
    tsconfigPaths: true,
  },
  server: {
    // Forward the page's actionable diagnostics into the file-backed browser console plugin.
    forwardConsole: {
      unhandledErrors: true,
      logLevels: ["error", "warn"],
    },
    fs: {
      allow: [searchForWorkspaceRoot(appRoot)],
    },
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
  },
  test: {
    projects: [
      {
        test: {
          name: "ardy-node",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      browserProject,
    ],
  },
};
