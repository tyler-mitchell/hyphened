import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { typegpuBrowserProject, typegpuDevtools } from "typegpu-devtools/vitest-plugin";
import { browserConsole } from "vite-browser-console";
import type { Vite } from "vite-plus/test/node";

const devtoolsPlugins: Vite.Plugin[] = typegpuDevtools();
const typegpuProject = typegpuBrowserProject();
const dedupe = ["react", "react-dom", "typegpu", "typegpu/common", "typegpu/data", "typegpu/std"];
const browserProject = {
  ...typegpuProject,
  optimizeDeps: {
    ...typegpuProject.optimizeDeps,
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
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  lint: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  optimizeDeps: {
    exclude: ["arktype", "typegpu", "typegpu/common", "typegpu/data", "typegpu/std"],
  },
  plugins: [
    browserConsole({ directory: ".runtime/browser-console" }),
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
        },
      },
      browserProject,
    ],
  },
};
