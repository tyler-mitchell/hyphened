const CAPTURE_ARTIFACT_CACHE = "ardy-capture-artifacts-v1";
const artifactExtensions = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export const publishCaptureArtifact = async (blob: Blob): Promise<string> => {
  const extension = artifactExtensions[blob.type as keyof typeof artifactExtensions] ?? "bin";
  const path = `/artifacts/${crypto.randomUUID()}.${extension}`;
  await navigator.serviceWorker.register("/artifact-service-worker.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const cache = await caches.open(CAPTURE_ARTIFACT_CACHE);
  await cache.put(
    path,
    new Response(blob, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": blob.type,
      },
    }),
  );
  return new URL(path, location.origin).href;
};
