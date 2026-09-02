import { d } from "typegpu";
import { capabilityExport, defineGraphCapability, res, textureSampledView } from "webgpu-engine";

/** Own the presentation-sized depth surface shared by projection and rendering. */
export const createMotionSurface = (input: { readonly id: string }) => {
  const depth = res.renderTarget({
    format: "depth24plus",
    lifetime: "persistent",
    schema: d.textureDepth2d(),
    size: "presentation",
    views: [{ id: "attachment", usage: ["attachment"] }, textureSampledView({ mipLevelCount: 1 })],
  });
  const capability = defineGraphCapability({
    id: input.id,
    resources: { depth },
    exports: {
      attachment: { resource: "depth", view: "attachment" },
      dimensions: { resource: "depth", view: "sampled" },
    },
  });
  return {
    attachment: capabilityExport<typeof depth>({ capability: capability.id, export: "attachment" }),
    capability,
    dimensions: capabilityExport<typeof depth>({ capability: capability.id, export: "dimensions" }),
  };
};
