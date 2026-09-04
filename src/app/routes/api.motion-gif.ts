import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";

import { MAX_SCENE_PREVIEW_REQUEST_BYTES } from "../../schema";

/**
 * Encode one caption's captured frames as an animated GIF.
 *
 * The playground captures frames in the browser, because motion only exists where WebGPU runs, and
 * hands them here to be encoded. libvips writes an animated GIF from one tall strip of frames when
 * it is told the height of a single page, so the frames are decoded, stacked, and encoded once.
 *
 * `ARDY_MOTION_PREVIEW_DIR` names a directory to keep a copy in. It exists so whoever curates the
 * library can look at what a caption produced instead of reading its name; without it the GIF is
 * only returned.
 */
const MAX_FRAMES = 240;

const GifRequest = type({
  delayMs: "number.integer > 0",
  frames: "string[] >= 2",
  slug: /^[a-z0-9][a-z0-9-]*$/,
});

export const Route = createFileRoute("/api/motion-gif")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (body.length > MAX_SCENE_PREVIEW_REQUEST_BYTES) {
          return new Response(
            `The ${String(body.length)}-byte request exceeds the ${String(MAX_SCENE_PREVIEW_REQUEST_BYTES)}-byte scene preview limit.`,
            { status: 413 },
          );
        }
        const input = GifRequest(JSON.parse(body));
        if (input instanceof type.errors) {
          return new Response(input.summary, { status: 400 });
        }
        if (input.frames.length > MAX_FRAMES) {
          return new Response(
            `${String(input.frames.length)} frames exceeds the ${String(MAX_FRAMES)} this route encodes.`,
            { status: 413 },
          );
        }
        // Only this route needs an image encoder, and only in development, so it is loaded when a
        // capture arrives rather than held by every server that serves the scene.
        const sharp = (await import("sharp")).default;
        const decoded = await Promise.all(
          input.frames.map(async (frame) => {
            const image = sharp(Buffer.from(frame, "base64"));
            const { height, width } = await image.metadata();
            return { height: height ?? 0, image, width: width ?? 0 };
          }),
        );
        const first = decoded[0]!;
        if (first.width === 0 || first.height === 0) {
          return new Response("The first frame could not be decoded as an image.", { status: 400 });
        }
        // Every page of a GIF is the same size, so a frame that differs is fitted to the first.
        const pages = await Promise.all(
          decoded.map(({ image }) =>
            image
              .resize({ fit: "cover", height: first.height, width: first.width })
              .removeAlpha()
              .raw()
              .toBuffer(),
          ),
        );
        const gif = await sharp(Buffer.concat(pages), {
          raw: {
            channels: 3,
            height: first.height * pages.length,
            pageHeight: first.height,
            width: first.width,
          },
        })
          .gif({ delay: pages.map(() => input.delayMs), loop: 0 })
          .toBuffer();
        if (gif.byteLength > MAX_SCENE_PREVIEW_REQUEST_BYTES) {
          return new Response("The encoded scene preview exceeds its response limit.", {
            status: 413,
          });
        }

        const keep = process.env.ARDY_MOTION_PREVIEW_DIR?.trim();
        const saved = await (async () => {
          if (keep === undefined || keep.length === 0) return undefined;
          const directory = resolve(keep);
          await mkdir(directory, { recursive: true });
          const path = resolve(directory, `${input.slug}.gif`);
          await writeFile(path, gif);
          return path;
        })();

        return new Response(new Uint8Array(gif), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "image/gif",
            ...(saved === undefined ? {} : { "X-Motion-Preview-Path": saved }),
          },
        });
      },
    },
  },
});
