/* SyncSprint service worker: push notifications and an offline fallback page. No caching of app data. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "SyncSprint", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "SyncSprint";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/apple-icon",
    badge: "/icon.svg",
    tag: data.tag || undefined,
    data: { url: data.url || "/w" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/w", self.location.origin);
  // Only ever open pages of this app.
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === target.origin && "focus" in c) {
        await c.navigate(target.href).catch(() => {});
        return c.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

// Offline: show a friendly page for navigations instead of the browser's error.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7fb;color:#1d2129"><div style="text-align:center"><h1>You’re offline</h1><p>SyncSprint will reconnect and sync as soon as you’re back online.</p></div>',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )));
});
