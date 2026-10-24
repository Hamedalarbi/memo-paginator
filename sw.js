/* عامل الخدمة: يجعل الموقع يعمل كتطبيق ويفتح دون إنترنت (الواجهة والتنسيق بالقواعد وتنزيل PDF) */
const VERSION = 'memo-v3';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/html2canvas.min.js', '/jspdf.umd.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // لا نخزّن طلبات التنسيق المتقدم أبداً
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  if (isPage) { // الصفحات: الشبكة أولاً ليصل التحديث فوراً، ثم النسخة المحفوظة عند انقطاع الإنترنت
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then((m) => m || caches.match('/index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((m) => { // الملفات الثابتة: من الذاكرة مع تحديث في الخلفية
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; }).catch(() => m);
    return m || net;
  }));
});
