import type { ModelContextClient } from "@mcp-b/webmcp-types";
import { useEffect, useEffectEvent, useState } from "react";

import type { RegisteredWebMcpTool } from "./webmcp";

// A scene replacement can mount its canvas before the prior canvas finishes closing. Tool names are
// document-global, so the next registration must retire the prior owner before it claims the name.
const registrationOwners = new Map<string, AbortController>();

/** Register the stable operation set with the browser's native WebMCP surface. */
export const useAgentTools = (tools: readonly RegisteredWebMcpTool[]): void => {
  const execute = useEffectEvent(
    async (input: {
      readonly client: ModelContextClient;
      readonly name: string;
      readonly raw: unknown;
    }) => {
      try {
        const tool = tools.find(({ name }) => name === input.name);
        if (tool === undefined) {
          throw new Error(`WebMCP operation "${input.name}" is not registered.`);
        }
        return await tool.execute(input.raw, input.client);
      } catch (cause) {
        return {
          content: [
            { text: cause instanceof Error ? cause.message : String(cause), type: "text" as const },
          ],
          isError: true,
        };
      }
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
    const lifecycle = new AbortController();
    const owned = new Map<string, AbortController>();

    const register = async (
      modelContext: NonNullable<typeof document.modelContext>,
      registration: (typeof registrations)[number],
    ) => {
      registrationOwners.get(registration.name)?.abort();
      const controller = new AbortController();
      registrationOwners.set(registration.name, controller);
      owned.set(registration.name, controller);
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
    const ready =
      document.modelContext === undefined
        ? import("@mcp-b/global").then(() => undefined)
        : Promise.resolve();
    void ready.then(() => {
      if (lifecycle.signal.aborted) return;
      const modelContext = document.modelContext;
      if (modelContext === undefined) {
        console.warn("WebMCP is unavailable; ardy registered no agent tools.");
        return;
      }
      for (const registration of registrations) {
        void register(modelContext, registration);
      }
    });

    return () => {
      lifecycle.abort();
      for (const [name, controller] of owned) {
        if (registrationOwners.get(name) !== controller) continue;
        registrationOwners.delete(name);
        controller.abort();
      }
    };
  }, [registrations]);
};
