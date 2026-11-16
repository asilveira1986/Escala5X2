/* Service worker do JornadaCerta: abrir a escala sem internet. Regras e privacidade em sw-core.js. */
importScripts('/sw-core.js');

var C = self.JCSW;
var usuarioMem;

function usuarioAtual() {
  if (usuarioMem !== undefined) return Promise.resolve(usuarioMem);
  return caches.open(C.CACHES.meta).then(function (m) { return m.match('/__usuario'); }).then(function (r) { return r ? r.text() : ''; }).then(function (t) { usuarioMem = t; return t; });
}

function definirUsuario(id) {
  return usuarioAtual().then(function (antes) {
    usuarioMem = id || '';
    return caches.open(C.CACHES.meta).then(function (m) { return id ? m.put('/__usuario', new Response(id)) : m.delete('/__usuario'); }).then(function () {
      if (antes && antes !== usuarioMem) return caches.delete(C.CACHES.paginas); // outra pessoa no mesmo aparelho
    });
  });
}

function limparTudo() {
  usuarioMem = '';
  return caches.delete(C.CACHES.paginas).then(function () { return caches.delete(C.CACHES.meta); });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(C.CACHES.estatico).then(function (c) { return c.addAll(C.PRECACHE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  var vivos = [C.CACHES.paginas, C.CACHES.estatico, C.CACHES.meta];
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n.indexOf('jc-') === 0 && vivos.indexOf(n) < 0; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.tipo === 'usuario') e.waitUntil(definirUsuario(typeof d.id === 'string' ? d.id : ''));
  else if (d.tipo === 'limpar') e.waitUntil(limparTudo());
});

function paginaOffline() {
  return caches.open(C.CACHES.estatico).then(function (c) { return c.match('/offline'); }).then(function (r) {
    return r || new Response('Sem conexão.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var tipo = C.classificar({ url: req.url, method: req.method, mode: req.mode, headers: req.headers, origem: self.location.origin });
  if (tipo === 'ignorar') return;

  if (tipo === 'estatico') {
    event.respondWith(
      caches.open(C.CACHES.estatico).then(function (c) {
        return c.match(req).then(function (hit) {
          return hit || fetch(req).then(function (res) { if (res.status === 200) c.put(req, res.clone()); return res; });
        });
      })
    );
    return;
  }

  if (tipo === 'navegacao') {
    event.respondWith(fetch(req).catch(function () { return paginaOffline(); }));
    return;
  }

  // 'pagina': rede primeiro; guarda a cópia do usuário atual; sem rede, serve a cópia (só se for do mesmo usuário)
  var chave = C.chavePagina(req.url);
  event.respondWith(
    fetch(req).then(function (res) {
      if (C.deveGuardar(res)) {
        var copia = res.clone();
        event.waitUntil(caches.open(C.CACHES.paginas).then(function (c) { return c.put(chave, copia); }));
      } else if (res.type === 'opaqueredirect' || res.redirected || res.status === 401 || res.status === 403) {
        // Sessão acabou (redirecionou ao login ou foi negada): não deixa cópia antiga por aí. Erro 5xx NÃO apaga a cópia boa.
        event.waitUntil(caches.open(C.CACHES.paginas).then(function (c) { return c.delete(chave); }));
      }
      return res;
    }).catch(function () {
      return Promise.all([caches.open(C.CACHES.paginas).then(function (c) { return c.match(chave); }), usuarioAtual()]).then(function (r) {
        var hit = r[0], usuario = r[1];
        if (hit && C.podeServir(hit.headers.get('x-jc-uid'), usuario)) {
          var h = new Headers(hit.headers);
          h.set('x-jc-offline', '1');
          return hit.blob().then(function (corpo) { return new Response(corpo, { status: hit.status, headers: h }); });
        }
        return paginaOffline();
      });
    })
  );
});
