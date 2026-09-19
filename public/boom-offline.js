const VERSION = 'boom-menu-offline-v1';
const SHELL = ["/", "/index.html"];
const CACHEABLE_API = ["/api/visual-catalog/public", "/api/public/branches"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith("boom-menu-offline-") && k !== VERSION).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

function isCacheableApi(url) {
  return CACHEABLE_API.includes(url.pathname);
}
function isMenuMedia(url) {
  return url.pathname.startsWith("/uploads/menu-media/");
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isCacheableApi(url)) {
    event.respondWith((async () => {
      try {
        const network = await fetch(request);
        if (network.ok) {
          const copy = network.clone();
          const cache = await caches.open(VERSION);
          await cache.put(request, copy);
        }
        return network;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({error:"OFFLINE_CACHE_MISS"}), {
          status: 503,
          headers: {"Content-Type":"application/json"}
        });
      }
    })());
    return;
  }

  if (isMenuMedia(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const network = await fetch(request);
        if (network.ok) {
          const cache = await caches.open(VERSION);
          await cache.put(request, network.clone());
        }
        return network;
      } catch {
        return new Response("", {status: 504, statusText:"Offline media unavailable"});
      }
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match("/index.html")) || (await caches.match("/")) || new Response("Offline", {status:503});
      }
    })());
  }
});
