const CAPTURE_ARTIFACT_CACHE = "ardy-capture-artifacts-v1";

export const publishCaptureArtifact = async (blob: Blob): Promise<string> => {
  const path = `/artifacts/${Date.now().toString(36)}.webp`;
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
