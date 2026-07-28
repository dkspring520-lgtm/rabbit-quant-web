const CACHE_NAME = "rabbit-notifications-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || "双兔助手 · 新提醒";
  const options = {
    body: data.body || "有新的做T提醒，请打开操盘台查看。",
    tag: data.tag || "rabbit-alert",
    data: { url: data.url || "/?view=desk" },
    icon: "/rabbit-logo-compact.png",
    badge: "/rabbit-logo-compact.png",
    renotify: data.level === "formal",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/?view=desk", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
