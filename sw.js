// Folio läuft nur noch unter https://folio.blandus.workers.dev. Dieser Service Worker ersetzt den alten:
// er löscht dessen Offline-Kopie der App und meldet sich ab, damit die Umleitungsseite geladen wird.
// Notizen (IndexedDB) bleiben unberührt.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
