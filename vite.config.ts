import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { typegpuBrowserProject, typegpuDevtools } from "typegpu-devtools/vitest-plugin";
import type { Vite } from "vite-plus/test/node";

const devtoolsPlugins: Vite.Plugin[] = typegpuDevtools();
const browserProject = typegpuBrowserProject() satisfies Vite.UserConfig;

export default {
  fmt: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  lint: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  optimizeDeps: {
    exclude: ["typegpu", "typegpu/common", "typegpu/data", "typegpu/std"],
  },
  plugins: [
    ...devtoolsPlugins,
    tailwindcss(),
    ...(process.env.VITEST === "true" ? [] : [tanstackStart({ srcDirectory: "src" })]),
    viteReact(),
    ...(process.env.VITEST === "true" ? [] : [nitro()]),
  ],
  resolve: {
    alias: {
      "webgpu-engine": resolve(import.meta.dirname, "../../packages/webgpu-engine/src/index.ts"),
    },
    dedupe: ["react", "react-dom", "typegpu", "typegpu/common", "typegpu/data", "typegpu/std"],
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
        },
      },
      browserProject,
    ],
  },
};
