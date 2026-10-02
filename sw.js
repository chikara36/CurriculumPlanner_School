const CACHE='curriculum-planner-school-v1.1.1';
const CORE=[
  './','./index.html','./styles.css','./app.js','./model.js','./storage.js','./calendar.js','./drive.js','./reports.js','./solver-client.js','./solver.worker.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin){return;}
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return res;}).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html'))));
});
