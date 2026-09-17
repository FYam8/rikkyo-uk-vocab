const RELEASE = "3.2.0--common-vocab-engine-1.0.0--0.22.1-core--e2026-09-17--p3";
const CACHE_NAME = `rikkyo-uk-vocab-${RELEASE}`;
const SCOPE = "/rikkyo-uk-vocab/";

async function buildAtomicCache() {
  const releaseResponse = await fetch(`${SCOPE}release-manifest.json`, { cache: "no-store" });
  const dataResponse = await fetch(`${SCOPE}data/manifest.json`, { cache: "no-store" });
  const indexResponse = await fetch(SCOPE, { cache: "no-store" });
  if (!releaseResponse.ok || !dataResponse.ok || !indexResponse.ok) throw new Error("RELEASE_TUPLE_FETCH_FAILED");
  const release = await releaseResponse.clone().json();
  const data = await dataResponse.clone().json();
  if (release.productVersion !== "3.2.0" || release.engineVersion !== "common-vocab-engine/1.0.0" || release.datasetVersion !== data.dataVersion || release.persistenceSchemaVersion !== 3 || release.enrichmentVersion !== data.enrichmentVersion) {
    throw new Error("RELEASE_TUPLE_MISMATCH");
  }
  const html = await indexResponse.clone().text();
  const assetPaths = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.location.origin + SCOPE).pathname);
  const urls = [SCOPE, `${SCOPE}release-manifest.json`, `${SCOPE}data/manifest.json`, `${SCOPE}data/registry.json`, `${SCOPE}data/${data.enrichment}`,
    ...data.chunks.map((name) => `${SCOPE}data/${name}`), `${SCOPE}manifest.webmanifest`, ...assetPaths];
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll([...new Set(urls)]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(buildAtomicCache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("rikkyo-uk-vocab-") && key !== CACHE_NAME)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
