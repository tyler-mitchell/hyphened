import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

const dedupe = ["react", "react-dom", "typegpu", "typegpu/common", "typegpu/data", "typegpu/std"];

export default {
  fmt: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  lint: {
    ignorePatterns: ["**/.nitro/**", "**/.output/**", "**/.tanstack/**", "**/node_modules/**"],
  },
  nitro: {
    routeRules: {
      "/**": { headers: { "Origin-Agent-Cluster": "?1" } },
    },
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
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: {
        entry: "app/router",
        generatedRouteTree: "app/routeTree.gen.ts",
        routesDirectory: "app/routes",
      },
      srcDirectory: "src",
    }),
    viteReact(),
    nitro(),
  ],
  resolve: {
    dedupe,
  },
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
  },
};
