import type { ModelContextClient } from "@mcp-b/webmcp-types";
import { useEffect, useEffectEvent, useState } from "react";

import type { RegisteredWebMcpTool } from "./webmcp";

/** Register the stable operation set with the browser's native WebMCP surface. */
export const useAgentTools = (tools: readonly RegisteredWebMcpTool[]): void => {
  const execute = useEffectEvent(
    (input: {
      readonly client: ModelContextClient;
      readonly name: string;
      readonly raw: unknown;
    }) => {
      const tool = tools.find(({ name }) => name === input.name);
      if (tool === undefined)
        throw new Error(`WebMCP operation "${input.name}" is not registered.`);
      return tool.execute(input.raw, input.client);
    },
  );
  const [registrations] = useState(() =>
    tools.map((tool) => ({
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
      outputSchema: tool.outputSchema,
    })),
  );

  useEffect(() => {
    const controller = new AbortController();

    const register = async (
      modelContext: NonNullable<typeof document.modelContext>,
      registration: (typeof registrations)[number],
    ) => {
      try {
        await modelContext.registerTool(
          {
            ...registration,
            execute: (raw, client) => execute({ client, name: registration.name, raw }),
          },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          console.info(`WebMCP registered ${registration.name}.`);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(`WebMCP could not register ${registration.name}.`, error);
        }
      }
    };

    // The polyfill wraps the native context when present and installs one otherwise, so in-page
    // agents can list and execute tools in browsers without native WebMCP.
    void import("@mcp-b/global").then(() => {
      if (controller.signal.aborted) return;
      const modelContext = document.modelContext;
      if (modelContext === undefined) {
        console.warn("WebMCP is unavailable; ardy registered no agent tools.");
        return;
      }
      for (const registration of registrations) {
        void register(modelContext, registration);
      }
    });

    return () => controller.abort();
  }, [registrations]);
};
