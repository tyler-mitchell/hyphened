const ARTIFACT_PATH_PREFIX = "/artifacts/";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    requestUrl.origin !== self.location.origin ||
    !requestUrl.pathname.startsWith(ARTIFACT_PATH_PREFIX)
  ) {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response ?? new Response("Capture artifact not found.", { status: 404 })),
  );
});
