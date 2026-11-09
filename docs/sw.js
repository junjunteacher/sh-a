// 수행평가 아이디어 아카이브 — 오프라인·빠른 열기용 서비스 워커
const VER = 'v5';
const SHELL = 'shell-' + VER, DATA = 'data-' + VER;
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// 화면·meta.json: 네트워크 먼저(새 자료 반영), 안 되면 저장본
// 과목·상세 묶음: 저장본 먼저 보여주고 뒤에서 새로 받아 둠
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // 글꼴·라이브러리 CDN은 한 번 받으면 저장
    if (/jsdelivr|googleapis|gstatic|cdnjs/.test(url.host)) e.respondWith(cacheFirst(req, SHELL));
    return;
  }
  const p = url.pathname;
  if (req.mode === 'navigate' || p.endsWith('/index.html') || p.endsWith('/meta.json') || p.endsWith('/')) {
    e.respondWith(networkFirst(req, p.endsWith('/meta.json') ? DATA : SHELL));
  } else if (p.includes('/data/')) {
    e.respondWith(staleWhileRevalidate(req, DATA));
  } else {
    e.respondWith(cacheFirst(req, SHELL));
  }
});

async function networkFirst(req, name) {
  const c = await caches.open(name);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (e) {
    return (await c.match(req)) || (await c.match('./index.html')) || Response.error();
  }
}
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}
async function staleWhileRevalidate(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
self.addEventListener('message', e => { if (e.data === 'clear-data') caches.delete(DATA); });
