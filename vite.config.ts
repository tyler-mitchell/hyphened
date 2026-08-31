import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { typegpuBrowserProject, typegpuDevtools } from "typegpu-devtools/vitest-plugin";
import { browserConsole } from "vite-browser-console";
import type { Vite } from "vite-plus/test/node";

/**
 * Runner frames bury the one assertion that failed. A ReferenceError keeps its full stack, because
 * there the dependency frame is the finding.
 */
const onStackTrace = (error: { readonly name: string }, frame: { readonly file: string }) =>
  error.name === "ReferenceError" ? undefined : !frame.file.includes("node_modules");

const devtoolsPlugins: Vite.Plugin[] = typegpuDevtools();
const typegpuProject = typegpuBrowserProject();
const dedupe = ["react", "react-dom", "typegpu", "typegpu/common", "typegpu/data", "typegpu/std"];
const browserProject = {
  ...typegpuProject,
  test: { ...typegpuProject.test, onStackTrace },
  plugins: [browserConsole(), ...(typegpuProject.plugins ?? [])],
  optimizeDeps: {
    ...typegpuProject.optimizeDeps,
    exclude: ["@surrealdb/wasm"],
    include: [
      "react",
      "react/jsx-runtime",
      "react-dom",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
  },
  resolve: { dedupe, tsconfigPaths: true },
};

export default {
  fmt: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  lint: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
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
    ...(process.env.VITEST === "true" ? [] : [tanstackStart({ srcDirectory: "src" })]),
    viteReact(),
    ...(process.env.VITEST === "true" ? [] : [nitro()]),
  ],
  resolve: {
    dedupe,
    tsconfigPaths: true,
  },
  server: {
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
          onStackTrace,
          // Group 0 so the node tests drain before the browser project, which declares its own
          // `maxWorkers` at group 1. Vitest refuses two projects that share a group order while
          // declaring different worker counts, and refuses the whole run rather than that project.
          sequence: { groupOrder: 0 },
        },
      },
      browserProject,
    ],
  },
};
