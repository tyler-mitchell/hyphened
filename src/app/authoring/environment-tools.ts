import { type } from "arktype";

import { sceneProject, setSceneEnvironment, setSceneLook } from "../../scene/project";
import {
  EnvironmentEntity,
  MotionRenderConfiguration,
  RemoveEnvironmentEntityInput,
  SceneReadinessInput,
  SetEnvironmentEntityInput,
  SetEnvironmentInput,
} from "../../schema";
import { ENVIRONMENT_ASSETS, environmentAsset } from "../../stage/environment";
import { webMcpInputSchema, webMcpResult, type RegisteredWebMcpTool } from "./webmcp";

const failure = (cause: unknown) => ({
  content: [
    {
      text: cause instanceof Error ? cause.message : String(cause),
      type: "text" as const,
    },
  ],
  isError: true,
});

export const environmentTools = (): readonly RegisteredWebMcpTool[] => [
  {
    annotations: { idempotentHint: true, readOnlyHint: true },
    description:
      "List the CC0 environment assets that author_scene and the environment tools can place. nativeSize is the exact source-model width, height, and depth in scene units. suggestedScale makes the asset proportionate to a 1.7-unit actor and is the preferred starting scale.",
    execute: async (raw) => {
      SceneReadinessInput.assert(raw);
      return webMcpResult({
        assets: ENVIRONMENT_ASSETS.map(
          ({ id, kind, label, nativeSize, suggestedScale }) => ({
            id,
            kind,
            label,
            nativeSize,
            suggestedScale,
          }),
        ),
        license: "Creative Commons CC0",
        source: "Kenney City Kit (Suburban)",
      });
    },
    inputSchema: webMcpInputSchema(SceneReadinessInput),
    name: "list_environment_assets",
    outputSchema: {
      additionalProperties: false,
      properties: {
        assets: {
          items: {
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              label: { type: "string" },
              nativeSize: {
                items: { type: "number" },
                maxItems: 3,
                minItems: 3,
                type: "array",
              },
              suggestedScale: {
                items: { type: "number" },
                maxItems: 3,
                minItems: 3,
                type: "array",
              },
            },
            required: ["id", "kind", "label", "nativeSize", "suggestedScale"],
            type: "object",
          },
          type: "array",
        },
        license: { type: "string" },
        source: { type: "string" },
      },
      required: ["assets", "license", "source"],
      type: "object",
    },
  },
  {
    description:
      "Set how the stage looks. You can set the background, the ground, the actor colours, the ambient light, the directional light, and the light's direction. A field you do not give keeps its authored default. The scene opens again after the change.",
    execute: async (raw) => {
      const render = MotionRenderConfiguration(raw);
      if (render instanceof type.errors) return failure(new Error(render.summary));
      const next = await setSceneLook(render);
      return webMcpResult({ scene: next.record.definition.id, status: "opening" });
    },
    inputSchema: webMcpInputSchema(MotionRenderConfiguration),
    name: "set_scene_look",
    outputSchema: {
      additionalProperties: false,
      properties: {
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
      },
      required: ["scene", "status"],
      type: "object",
    },
  },
  {
    description:
      "Make one environment entity, or replace one completely. Give its id. You do not send the other entities, and they do not change. The entity holds one asset from the catalogue, a transform, and a colour. The scene opens again after the change.",
    execute: async (raw) => {
      const entity = SetEnvironmentEntityInput(raw);
      if (entity instanceof type.errors) return failure(new Error(entity.summary));
      if (environmentAsset(entity.asset) === undefined) {
        return failure(
          new Error(`Environment asset "${entity.asset}" does not exist; call list_environment_assets.`),
        );
      }
      const current = await sceneProject();
      const next = await setSceneEnvironment([
        ...(current.record.definition.environment ?? []).filter(({ id }) => id !== entity.id),
        EnvironmentEntity.assert(entity),
      ]);
      return webMcpResult({ entity: entity.id, scene: next.record.definition.id, status: "opening" });
    },
    inputSchema: webMcpInputSchema(SetEnvironmentEntityInput),
    name: "set_environment_entity",
    outputSchema: {
      additionalProperties: false,
      properties: {
        entity: { type: "string" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
      },
      required: ["entity", "scene", "status"],
      type: "object",
    },
  },
  {
    description:
      "Remove one environment entity by id without changing the rest of the environment. The scene reopens after the change.",
    execute: async (raw) => {
      const input = RemoveEnvironmentEntityInput.assert(raw);
      const current = await sceneProject();
      const environment = current.record.definition.environment ?? [];
      if (!environment.some(({ id }) => id === input.id)) {
        return failure(new Error(`Environment entity "${input.id}" does not exist.`));
      }
      const next = await setSceneEnvironment(environment.filter(({ id }) => id !== input.id));
      return webMcpResult({ entity: input.id, scene: next.record.definition.id, status: "opening" });
    },
    inputSchema: webMcpInputSchema(RemoveEnvironmentEntityInput),
    name: "remove_environment_entity",
    outputSchema: {
      additionalProperties: false,
      properties: {
        entity: { type: "string" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
      },
      required: ["entity", "scene", "status"],
      type: "object",
    },
  },
  {
    description:
      "Replace the active scene's static environment with ECS-shaped entities. Each entity has a stable id, an asset from list_environment_assets, and transform and color components. Omitted position, rotation, scale, and color use neutral defaults. The scene reopens after the environment is saved; other scene documents remain unchanged.",
    execute: async (raw) => {
      const input = SetEnvironmentInput(raw);
      if (input instanceof type.errors) return failure(new Error(input.summary));
      const duplicate = input.entities.find(
        ({ id }, index) => input.entities.findIndex((candidate) => candidate.id === id) !== index,
      );
      if (duplicate !== undefined) {
        return failure(new Error(`Environment entity id "${duplicate.id}" is repeated.`));
      }
      const unknown = input.entities.find(({ asset }) => environmentAsset(asset) === undefined);
      if (unknown !== undefined) {
        return failure(
          new Error(
            `Environment asset "${unknown.asset}" does not exist; call list_environment_assets.`,
          ),
        );
      }
      const next = await setSceneEnvironment(input.entities.map((entity) => EnvironmentEntity.assert(entity)));
      return webMcpResult({
        entities: input.entities.map(({ id }) => id),
        scene: next.record.definition.id,
        status: "opening",
      });
    },
    inputSchema: webMcpInputSchema(SetEnvironmentInput),
    name: "set_environment",
    outputSchema: {
      additionalProperties: false,
      properties: {
        entities: { items: { type: "string" }, type: "array" },
        scene: { type: "string" },
        status: { const: "opening", type: "string" },
      },
      required: ["entities", "scene", "status"],
      type: "object",
    },
  },
];
