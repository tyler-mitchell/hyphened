export type EmbodimentAssetStage = "binary" | "manifest" | "rig";

/** Invalid or unavailable physical embodiment assets at the rig admission boundary. */
export class EmbodimentAssetError extends Error {
  readonly stage: EmbodimentAssetStage;

  constructor(input: { readonly reason: string; readonly stage: EmbodimentAssetStage }) {
    super(input.reason);
    this.name = "EmbodimentAssetError";
    this.stage = input.stage;
  }
}

export const refuseEmbodimentAsset = (stage: EmbodimentAssetStage, reason: string): never => {
  throw new EmbodimentAssetError({ reason, stage });
};
