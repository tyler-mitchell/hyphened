import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";

import {
  digestHex,
  motionTextEmbedding,
  motionTextEmbeddingSource,
  type TextEmbedding,
} from "webgpu-engine/motion";

const PromptInput = type({ prompt: "string > 0" });
const GradioFileUpdate = type({ value: { url: "string" } });

/**
 * The exact text encoder is upstream's Gradio service, reached only from the server so its
 * address and credentials never enter the page. `ARDY_TEXT_ENCODER_URL` names it;
 * `ARDY_TEXT_ENCODER_AUTH` is `user:password` when the service requires a login.
 */
const encodeOnServer = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => PromptInput.assert(raw))
  .handler(async ({ data }) => {
    const url = process.env.ARDY_TEXT_ENCODER_URL;
    if (url === undefined) throw new Error("ARDY_TEXT_ENCODER_URL is not set on the server.");
    const auth = process.env.ARDY_TEXT_ENCODER_AUTH?.split(":");
    const { Client } = await import("@gradio/client");
    const client = await Client.connect(
      url,
      auth !== undefined && auth.length === 2 ? { auth: [auth[0]!, auth[1]!] } : {},
    );
    // Upstream writes one file per request; a unique name keeps requests from reading each other.
    const result = await client.predict<readonly unknown[]>(motionTextEmbeddingSource.endpoint, {
      filename: `${crypto.randomUUID()}.npy`,
      text: data.prompt,
    });
    const update = GradioFileUpdate(result.data[0]);
    if (update instanceof type.errors) {
      throw new Error("The text encoder did not publish an embedding file.");
    }
    const { load } = await import("npyjs");
    const embedding = await load(update.value.url);
    if (
      embedding.dtype !== "f4" ||
      embedding.fortranOrder ||
      embedding.shape.length !== 2 ||
      embedding.shape[0] !== 1 ||
      embedding.shape[1] !== motionTextEmbeddingSource.featureWidth ||
      !(embedding.data instanceof Float32Array)
    ) {
      throw new Error("The text encoder returned an incompatible embedding.");
    }
    if (embedding.data.some((value) => !Number.isFinite(value))) {
      throw new Error("The text encoder returned non-finite values.");
    }
    return { prompt: data.prompt, values: Array.from(embedding.data) };
  });

/** Encode one caption through the exact encoder and admit it as a conditioning row. */
export const encodeMotionPrompt = async (prompt: string): Promise<TextEmbedding> => {
  const encoded = await encodeOnServer({ data: { prompt } });
  if (encoded.prompt !== prompt) throw new Error("The text encoder rewrote the caption.");
  const values = new Float32Array(encoded.values);
  return motionTextEmbedding.Admission.assert({
    identity: { kind: "encoded", sha256: await digestHex(values.buffer) },
    prompt,
    source: motionTextEmbeddingSource,
    values,
  });
};
