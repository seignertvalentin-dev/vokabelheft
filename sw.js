const VERSION = 'v3';
const SHELL = 'vokabelheft-' + VERSION;
const SHARE = 'vokabelheft-share';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== SHARE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // L'API Anthropic passe toujours par le réseau, jamais par le cache.
  if (url.origin !== self.location.origin) return;

  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  // La page elle-même : réseau d'abord, cache en secours.
  // Une mise à jour déposée sur GitHub arrive donc dès le lancement suivant.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put('./index.html', copy));
        }
        return res;
      }).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

async function receiveShare(req) {
  const target = new URL('./?share=1', self.location).href;
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE);
    const files = form.getAll('file').filter(f => f && f.size);
    const file = files[0];
    const meta = { name: file ? file.name : '', text: form.get('text') || form.get('title') || '' };
    if (file) await cache.put('shared-file', new Response(file));
    await cache.put('shared-meta', new Response(JSON.stringify(meta), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (err) { /* on ouvre l'app quand même */ }
  return Response.redirect(target, 303);
}
