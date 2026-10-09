// Shows "How was Lilia?" notifications and opens that dinner when tapped.
// Nothing is cached: the app is small and always fetched fresh.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    // An unreadable payload still has to show something on iOS.
  }
  e.waitUntil(
    self.registration.showNotification(data.title || "How was dinner?", {
      body: data.body || "A few taps and Alec will write it up.",
      icon: "./icon-180.png",
      tag: data.tag,
      data: { url: new URL(data.url || "./", self.registration.scope).href },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = open.find((c) => c.url.startsWith(self.registration.scope));
      if (win) {
        await win.navigate(url);
        return win.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
