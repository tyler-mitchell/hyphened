import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { createFileRoute } from "@tanstack/react-router";

import { runtimeCheckpoint } from "webgpu-engine/motion";
import {
  resolveInstalledRuntimeArtifact,
  resolveInstalledModelRoot,
} from "webgpu-engine/motion/node";

interface SatisfiedByteRange {
  readonly end: number;
  readonly start: number;
  readonly status: 200 | 206;
}

type ByteRangeAdmission =
  | { readonly kind: "satisfied"; readonly range: SatisfiedByteRange }
  | { readonly kind: "unsatisfied" };

const admitByteRange = (input: {
  readonly byteLength: number;
  readonly header: string | null;
}): ByteRangeAdmission => {
  if (input.header === null) {
    return {
      kind: "satisfied",
      range: { end: input.byteLength - 1, start: 0, status: 200 },
    };
  }
  const match = /^bytes=(\d+)-(\d+)$/u.exec(input.header);
  if (match === null) return { kind: "unsatisfied" };
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= start &&
    end < input.byteLength
    ? { kind: "satisfied", range: { end, start, status: 206 } }
    : { kind: "unsatisfied" };
};

type ArtifactFileAdmission =
  | { readonly kind: "available"; readonly byteLength: number; readonly modifiedAt: number }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable" };

const admitArtifactFile = async (input: {
  readonly path: string;
}): Promise<ArtifactFileAdmission> =>
  stat(input.path)
    .then((file) =>
      file.isFile() && file.size > 0
        ? {
            kind: "available" as const,
            byteLength: file.size,
            modifiedAt: file.mtimeMs,
          }
        : { kind: "invalid" as const },
    )
    .catch(() => ({ kind: "unavailable" as const }));

export const Route = createFileRoute("/api/motion-model/$artifact")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const artifact = resolveInstalledRuntimeArtifact({
          artifact: params.artifact,
          modelRoot: resolveInstalledModelRoot({
            ...(process.env.ARDY_MODEL_ROOT === undefined
              ? {}
              : { configuredRoot: process.env.ARDY_MODEL_ROOT }),
            workingDirectory: process.cwd(),
          }),
        });
        if (artifact === undefined) {
          return new Response("Unknown motion model profile or artifact", { status: 404 });
        }

        const file = await admitArtifactFile({ path: artifact.path });
        if (file.kind !== "available") {
          if (file.kind === "unavailable") {
            return new Response(
              `motion model is not installed at ${artifact.modelDirectory}; set ARDY_MODEL_ROOT to the installed model catalog root if the application runs elsewhere`,
              { status: 503 },
            );
          }
          return new Response("motion model artifact is not a non-empty file", { status: 503 });
        }

        const etag = `"${params.artifact}:${file.modifiedAt}:${file.byteLength}"`;
        const cacheControl =
          params.artifact !== "runtime-manifest" &&
          // `Digest` is a morph from ArrayBuffer to hex string. The query parameter is already a
          // string, so it is the OUTPUT type that admits it; asking the morph itself never matches.
          runtimeCheckpoint.Digest.out.allows(new URL(request.url).searchParams.get("sha256"))
            ? "public, max-age=31536000, immutable, no-transform"
            : "no-cache";
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, {
            headers: { "Cache-Control": cacheControl, ETag: etag },
            status: 304,
          });
        }
        const range = admitByteRange({
          byteLength: file.byteLength,
          header: request.headers.get("range"),
        });
        if (range.kind === "unsatisfied") {
          return new Response(null, {
            headers: { "Content-Range": `bytes */${file.byteLength}` },
            status: 416,
          });
        }
        return new Response(
          Readable.toWeb(
            createReadStream(artifact.path, {
              end: range.range.end,
              start: range.range.start,
            }),
          ) as ReadableStream<Uint8Array>,
          {
            headers: {
              "Accept-Ranges": "bytes",
              "Cache-Control": cacheControl,
              "Content-Length": String(range.range.end - range.range.start + 1),
              "Content-Type": artifact.contentType,
              ETag: etag,
              ...(range.range.status === 206
                ? {
                    "Content-Range": `bytes ${range.range.start}-${range.range.end}/${file.byteLength}`,
                  }
                : {}),
            },
            status: range.range.status,
          },
        );
      },
    },
  },
});
