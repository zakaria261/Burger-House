const CACHE='burger-house-shell-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/icons/icon-192.png','/logo-burger-house.jpg'])));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.includes('sign')||u.pathname.includes('callback'))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/')));return;}
if(u.pathname.startsWith('/_next/static/')||u.pathname.startsWith('/icons/')||u.pathname==='/logo-burger-house.jpg')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return res;})));});
self.addEventListener('message',e=>{if(e.data?.type==='CACHE_URLS'&&Array.isArray(e.data.urls)){const urls=e.data.urls.filter(v=>{try{const u=new URL(v);return u.origin===self.location.origin&&(u.pathname.startsWith('/_next/static/')||u.pathname.startsWith('/fonts/'));}catch{return false;}});e.waitUntil(caches.open(CACHE).then(c=>c.addAll(urls)));}});
