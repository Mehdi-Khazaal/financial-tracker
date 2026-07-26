const CACHE = 'fintrack-v4';

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: only cache static assets, never API calls, never HTML ─────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET, API routes, and cross-origin requests entirely
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // Never cache navigation / HTML requests. Serving a stale index.html would
  // pin the PWA to an old fingerprinted JS bundle even after we deploy new
  // code — the reason the app can revert to the pre-redesign UI until the
  // user force-closes and reopens the installed PWA.
  const isDocument = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isDocument) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Only cache valid successful responses
        if (res.ok && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push: show notification ───────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Fintrack', body: 'You have a new update', icon: '/icon-192.png' };
  try { data = { ...data, ...e.data.json() }; } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' },
      tag: data.tag || 'fintrack',
      renotify: true,
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then(c => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
