/*
 * Núcleo do service worker do JornadaCerta: decisões puras (o que cachear, quando servir do cache).
 * Carregado pelo sw.js (importScripts) e pelos testes (require). Sem dependências.
 *
 * Privacidade: só as telas do próprio colaborador (/minha-escala/**) ficam guardadas para uso offline, e cada cópia
 * leva o identificador do usuário (cabeçalho x-jc-uid, posto pelo servidor). Cópia de outra pessoa nunca é servida,
 * e tudo é apagado ao sair.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.JCSW = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSAO = 'v1';
  var CACHES = { paginas: 'jc-paginas-' + VERSAO, estatico: 'jc-estatico-' + VERSAO, meta: 'jc-meta' };
  var PRECACHE = ['/offline', '/icons/192', '/icons/512'];

  function ehPrivada(caminho) {
    return caminho === '/minha-escala' || caminho.indexOf('/minha-escala/') === 0;
  }

  /**
   * Classifica um pedido: 'ignorar' (deixa o navegador seguir), 'estatico' (cache primeiro), 'pagina' (rede primeiro,
   * com cópia para offline) ou 'navegacao' (rede; se falhar, página offline).
   */
  function classificar(req) {
    var u;
    try { u = new URL(req.url); } catch (e) { return 'ignorar'; }
    if (req.origem && u.origin !== req.origem) return 'ignorar';
    if (req.method !== 'GET') return 'ignorar';
    var c = u.pathname;
    if (c.indexOf('/api/') === 0 || c.indexOf('/auth/') === 0) return 'ignorar';
    var h = req.headers;
    if (h && (h.get('RSC') || h.get('Next-Router-Prefetch') || h.get('Next-Router-State-Tree'))) return 'ignorar';
    if (c.indexOf('/_next/static/') === 0 || c === '/offline' || c.indexOf('/icons/') === 0) return 'estatico';
    if (req.mode === 'navigate') return ehPrivada(c) ? 'pagina' : 'navegacao';
    return 'ignorar';
  }

  /** A mesma tela com ou sem parâmetros de busca guarda uma única cópia. */
  function chavePagina(url) {
    var u = new URL(url);
    return u.origin + u.pathname;
  }

  /** Só devolve a cópia guardada se ela pertence ao usuário que está usando o aparelho agora. */
  function podeServir(uidDaCopia, usuarioAtual) {
    return !!usuarioAtual && !!uidDaCopia && uidDaCopia === usuarioAtual;
  }

  /** Só guarda resposta de tela autenticada (tem o uid), bem-sucedida e sem redirecionamento. */
  function deveGuardar(resposta) {
    return resposta.status === 200 && resposta.type === 'basic' && !resposta.redirected && !!resposta.headers.get('x-jc-uid');
  }

  return { VERSAO: VERSAO, CACHES: CACHES, PRECACHE: PRECACHE, ehPrivada: ehPrivada, classificar: classificar, chavePagina: chavePagina, podeServir: podeServir, deveGuardar: deveGuardar };
});
