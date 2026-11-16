import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);
const raiz = join(import.meta.dirname, '../public');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const core: any = require_(join(raiz, 'sw-core.js'));
const ORIGEM = 'https://app.test';

const pedido = (caminho: string, extra: { method?: string; mode?: string; headers?: Record<string, string>; origem?: string } = {}) => ({
  url: `${extra.origem ?? ORIGEM}${caminho}`, method: extra.method ?? 'GET', mode: extra.mode ?? 'navigate', headers: new Headers(extra.headers ?? {}), origem: ORIGEM,
});

describe('sw-core: o que o service worker faz com cada pedido', () => {
  it('telas do colaborador: rede primeiro com cópia offline; as demais navegações só têm a página offline de reserva', () => {
    for (const c of ['/minha-escala', '/minha-escala/pedidos', '/minha-escala/banco-horas', '/minha-escala/pedidos?x=1']) expect(core.classificar(pedido(c)), c).toBe('pagina');
    for (const c of ['/empresas', '/empresas/abc/escalas', '/carteira', '/login', '/', '/minha-escalaX']) expect(core.classificar(pedido(c)), c).toBe('navegacao');
  });
  it('estáticos: cache primeiro', () => {
    for (const c of ['/_next/static/chunks/a.js', '/offline', '/icons/192']) expect(core.classificar(pedido(c, { mode: 'no-cors' })), c).toBe('estatico');
  });
  it('nunca interfere em API, autenticação, POST, outra origem e requisições do roteador do Next (RSC)', () => {
    expect(core.classificar(pedido('/api/v1/carteira'))).toBe('ignorar');
    expect(core.classificar(pedido('/auth/callback'))).toBe('ignorar');
    expect(core.classificar(pedido('/minha-escala', { method: 'POST' }))).toBe('ignorar');
    expect(core.classificar(pedido('/minha-escala', { origem: 'https://outro.site' }))).toBe('ignorar');
    expect(core.classificar(pedido('/minha-escala', { headers: { RSC: '1' } }))).toBe('ignorar');
    expect(core.classificar(pedido('/minha-escala', { headers: { 'Next-Router-Prefetch': '1' } }))).toBe('ignorar');
    expect(core.classificar(pedido('/dados.json', { mode: 'cors' }))).toBe('ignorar');
    expect(core.classificar({ url: 'lixo', method: 'GET', mode: 'navigate', headers: new Headers() })).toBe('ignorar');
  });
  it('a chave da cópia ignora parâmetros de busca; só serve cópia do mesmo usuário; só guarda resposta autenticada e comum', () => {
    expect(core.chavePagina('https://app.test/minha-escala?a=1#x')).toBe('https://app.test/minha-escala');
    expect(core.podeServir('abc', 'abc')).toBe(true);
    expect(core.podeServir('abc', 'xyz')).toBe(false);
    expect(core.podeServir('abc', '')).toBe(false);
    expect(core.podeServir(null, 'abc')).toBe(false);
    const r = (status: number, uid: string | null, extra: { redirected?: boolean; type?: string } = {}) => ({ status, type: extra.type ?? 'basic', redirected: extra.redirected ?? false, headers: new Headers(uid ? { 'x-jc-uid': uid } : {}) });
    expect(core.deveGuardar(r(200, 'u'))).toBe(true);
    expect(core.deveGuardar(r(200, null))).toBe(false);
    expect(core.deveGuardar(r(500, 'u'))).toBe(false);
    expect(core.deveGuardar(r(200, 'u', { redirected: true }))).toBe(false);
    expect(core.deveGuardar(r(200, 'u', { type: 'opaque' }))).toBe(false);
  });
});

// ---------- o service worker de verdade, com um navegador de mentira ----------
class CacheFalso {
  m = new Map<string, Response>();
  private k = (x: string | { url: string }) => new URL(typeof x === 'string' ? x : x.url, ORIGEM).href;
  async put(x: string | { url: string }, r: Response) { this.m.set(this.k(x), r); }
  async match(x: string | { url: string }) { const r = this.m.get(this.k(x)); return r ? r.clone() : undefined; }
  async delete(x: string | { url: string }) { return this.m.delete(this.k(x)); }
  async addAll(urls: string[]) { for (const u of urls) await this.put(u, new Response('estático')); }
}
class CachesFalso {
  lojas = new Map<string, CacheFalso>();
  async open(n: string) { if (!this.lojas.has(n)) this.lojas.set(n, new CacheFalso()); return this.lojas.get(n)!; }
  async keys() { return [...this.lojas.keys()]; }
  async delete(n: string) { return this.lojas.delete(n); }
}
const resposta = (corpo: string, o: { uid?: string; status?: number; redirected?: boolean; type?: string } = {}) => {
  const status = o.status ?? 200;
  const r = new Response(corpo, { status: status >= 200 ? status : 200, headers: o.uid ? { 'x-jc-uid': o.uid } : {} });
  if (status < 200) Object.defineProperty(r, 'status', { value: status });          // resposta "opaqueredirect" tem status 0
  Object.defineProperty(r, 'type', { value: o.type ?? 'basic' });
  Object.defineProperty(r, 'redirected', { value: o.redirected ?? false });
  return r;
};

type Ouvintes = Record<string, Array<(e: unknown) => void>>;
function novoNavegador(cachesIniciais: string[] = []) {
  const ouvintes: Ouvintes = {};
  const caches = new CachesFalso();
  for (const n of cachesIniciais) caches.lojas.set(n, new CacheFalso());
  const rede = { online: true, chamadas: [] as string[], resposta: (_url: string): Response => resposta('padrão') };
  const fetchFalso = async (req: { url: string }) => {
    rede.chamadas.push(req.url);
    if (!rede.online) throw new TypeError('Failed to fetch');
    return rede.resposta(req.url);
  };
  const eu: Record<string, unknown> = {
    location: { origin: ORIGEM }, clients: { claim: async () => undefined }, skipWaiting: async () => undefined,
    addEventListener: (t: string, f: (e: unknown) => void) => { (ouvintes[t] ??= []).push(f); },
  };
  const importScripts = (_: string) => { new Function('self', 'module', readFileSync(join(raiz, 'sw-core.js'), 'utf8'))(eu, undefined); };
  new Function('self', 'caches', 'fetch', 'importScripts', 'Response', 'Headers', readFileSync(join(raiz, 'sw.js'), 'utf8'))(eu, caches, fetchFalso, importScripts, Response, Headers);

  const disparar = async (tipo: string, evento: Record<string, unknown> = {}) => {
    const esperas: Promise<unknown>[] = []; let resp: Promise<Response> | undefined; let tratou = false;
    const e = { ...evento, waitUntil: (p: Promise<unknown>) => { esperas.push(p); }, respondWith: (p: Promise<Response>) => { tratou = true; resp = Promise.resolve(p); } };
    for (const f of ouvintes[tipo] ?? []) f(e);
    const r = resp ? await resp : undefined;
    await Promise.all(esperas);
    return { tratou, resposta: r };
  };
  return {
    caches, rede,
    instalar: () => disparar('install'), ativar: () => disparar('activate'),
    mensagem: (data: unknown) => disparar('message', { data }),
    buscar: (caminho: string, extra: Parameters<typeof pedido>[1] = {}) => disparar('fetch', { request: pedido(caminho, extra) }),
  };
}
const texto = async (r?: Response) => (r ? r.text() : undefined);

describe('sw.js: instalação e atualização', () => {
  it('instala guardando a página offline e os ícones; ao ativar, apaga versões antigas mas não mexe em caches de terceiros', async () => {
    const n = novoNavegador(['jc-paginas-v0', 'jc-estatico-v0', 'cache-de-outro-app']);
    await n.instalar();
    const estatico = n.caches.lojas.get(core.CACHES.estatico)!;
    expect([...estatico.m.keys()].sort()).toEqual(['https://app.test/icons/192', 'https://app.test/icons/512', 'https://app.test/offline']);
    await n.ativar();
    expect([...n.caches.lojas.keys()].sort()).toEqual([core.CACHES.estatico, 'cache-de-outro-app'].sort());
  });
});

describe('sw.js: escala offline', () => {
  let n: ReturnType<typeof novoNavegador>;
  beforeEach(async () => { n = novoNavegador(); await n.instalar(); await n.mensagem({ tipo: 'usuario', id: 'u1' }); });

  it('online guarda a cópia; sem internet mostra a última versão salva, marcada como offline', async () => {
    n.rede.resposta = () => resposta('<h1>Escala de fevereiro</h1>', { uid: 'u1' });
    const on = await n.buscar('/minha-escala');
    expect(await texto(on.resposta)).toBe('<h1>Escala de fevereiro</h1>');
    n.rede.online = false;
    const off = await n.buscar('/minha-escala');
    expect(await texto(off.resposta)).toBe('<h1>Escala de fevereiro</h1>');
    expect(off.resposta!.headers.get('x-jc-offline')).toBe('1');
    expect(off.resposta!.headers.get('x-jc-uid')).toBe('u1');
  });
  it('várias telas do colaborador ficam disponíveis; parâmetros de busca não criam cópias separadas', async () => {
    n.rede.resposta = (u) => resposta(`tela ${new URL(u).pathname}`, { uid: 'u1' });
    for (const c of ['/minha-escala', '/minha-escala/pedidos', '/minha-escala/banco-horas?a=1', '/minha-escala/banco-horas?b=2']) await n.buscar(c);
    expect([...n.caches.lojas.get(core.CACHES.paginas)!.m.keys()].sort()).toEqual(['https://app.test/minha-escala', 'https://app.test/minha-escala/banco-horas', 'https://app.test/minha-escala/pedidos']);
    n.rede.online = false;
    expect(await texto((await n.buscar('/minha-escala/pedidos')).resposta)).toBe('tela /minha-escala/pedidos');
  });
  it('sem cópia, mostra a página offline em vez de um erro do navegador', async () => {
    n.rede.online = false;
    expect(await texto((await n.buscar('/minha-escala')).resposta)).toBe('estático');   // a página /offline pré-guardada
  });
  it('privacidade: outra pessoa no mesmo aparelho nunca vê a cópia da anterior', async () => {
    n.rede.resposta = () => resposta('escala da Ana', { uid: 'u1' });
    await n.buscar('/minha-escala');
    await n.mensagem({ tipo: 'usuario', id: 'u2' });                                   // outra pessoa entrou
    expect(n.caches.lojas.has(core.CACHES.paginas)).toBe(false);                        // cópias da Ana foram apagadas
    n.rede.online = false;
    expect(await texto((await n.buscar('/minha-escala')).resposta)).toBe('estático');
  });
  it('privacidade: cópia de um usuário não é servida se o aparelho não sabe quem está usando', async () => {
    n.rede.resposta = () => resposta('escala da Ana', { uid: 'u1' });
    await n.buscar('/minha-escala');
    const outro = novoNavegador();
    await outro.instalar();
    (await outro.caches.open(core.CACHES.paginas)).m.set(`${ORIGEM}/minha-escala`, resposta('copia solta', { uid: 'u1' }));   // cópia sem usuário registrado
    outro.rede.online = false;
    expect(await texto((await outro.buscar('/minha-escala')).resposta)).toBe('estático');
  });
  it('sair apaga as cópias e o usuário', async () => {
    n.rede.resposta = () => resposta('escala da Ana', { uid: 'u1' });
    await n.buscar('/minha-escala');
    await n.mensagem({ tipo: 'limpar' });
    expect([...n.caches.lojas.keys()]).toEqual([core.CACHES.estatico]);
    n.rede.online = false;
    expect(await texto((await n.buscar('/minha-escala')).resposta)).toBe('estático');
  });
  it('resposta sem uid (ex.: tela de login) não é guardada', async () => {
    n.rede.resposta = () => resposta('login', {});
    await n.buscar('/minha-escala');
    expect(n.caches.lojas.get(core.CACHES.paginas)?.m.size ?? 0).toBe(0);
  });
  it('sessão encerrada (redirecionamento ou 401/403) apaga a cópia; erro 500 mantém a cópia boa', async () => {
    n.rede.resposta = () => resposta('escala', { uid: 'u1' });
    await n.buscar('/minha-escala');
    n.rede.resposta = () => resposta('', { status: 500, uid: 'u1' });
    await n.buscar('/minha-escala');
    expect(n.caches.lojas.get(core.CACHES.paginas)!.m.size).toBe(1);
    n.rede.resposta = () => resposta('', { type: 'opaqueredirect', status: 0 });
    await n.buscar('/minha-escala');
    expect(n.caches.lojas.get(core.CACHES.paginas)!.m.size).toBe(0);
    n.rede.resposta = () => resposta('escala', { uid: 'u1' });
    await n.buscar('/minha-escala');
    n.rede.resposta = () => resposta('negado', { status: 403 });
    await n.buscar('/minha-escala');
    expect(n.caches.lojas.get(core.CACHES.paginas)!.m.size).toBe(0);
  });
});

describe('sw.js: o que NÃO é guardado', () => {
  let n: ReturnType<typeof novoNavegador>;
  beforeEach(async () => { n = novoNavegador(); await n.instalar(); await n.mensagem({ tipo: 'usuario', id: 'u1' }); });

  it('telas de gestão passam direto pela rede e, sem internet, mostram a página offline (nada de dado da empresa em cache)', async () => {
    n.rede.resposta = () => resposta('dados da empresa', { uid: 'u1' });
    expect(await texto((await n.buscar('/empresas/abc/colaboradores')).resposta)).toBe('dados da empresa');
    expect(n.caches.lojas.get(core.CACHES.paginas)?.m.size ?? 0).toBe(0);
    n.rede.online = false;
    expect(await texto((await n.buscar('/empresas/abc/colaboradores')).resposta)).toBe('estático');
  });
  it('API, autenticação, POST e requisições do roteador não são tocados', async () => {
    for (const [c, extra] of [['/api/v1/carteira', {}], ['/auth/sair', { method: 'POST' }], ['/minha-escala', { method: 'POST' }], ['/minha-escala', { headers: { RSC: '1' } }]] as const) {
      expect((await n.buscar(c, extra)).tratou, c).toBe(false);
    }
  });
  it('arquivos estáticos: cache primeiro, rede só na primeira vez', async () => {
    n.rede.resposta = () => resposta('console.log(1)');
    const url = '/_next/static/chunks/app.js';
    expect(await texto((await n.buscar(url, { mode: 'no-cors' })).resposta)).toBe('console.log(1)');
    n.rede.online = false;
    expect(await texto((await n.buscar(url, { mode: 'no-cors' })).resposta)).toBe('console.log(1)');
    expect(n.rede.chamadas.filter((u) => u.endsWith('app.js'))).toHaveLength(1);
  });
});
