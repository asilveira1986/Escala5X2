# App do colaborador (PWA)

O colaborador instala o JornadaCerta no celular e abre a **escala sem internet**.

## O que funciona
- **Instalar**: Android/Chrome mostra o botão "Instalar" em *Minha escala*; no iPhone (Safari) aparece a instrução "Compartilhar → Adicionar à Tela de Início". O app abre direto em *Minha escala* e tem atalhos para *Meus pedidos* e *Meu banco de horas*.
- **Offline**: as telas `/minha-escala/**` (escala, pedidos, banco de horas) ficam guardadas no aparelho a cada visita com internet; sem conexão aparece a última versão salva, com o aviso "Sem conexão". Ações que gravam (pedir troca, dar ciência) precisam de conexão.
- **Sem conexão em outras telas** (gestão, carteira, etc.): aparece uma página "Você está sem conexão" com atalho para a escala. Nada de dados de empresa fica em cache.

## Privacidade
A escala é dado pessoal. Por isso:
- só as telas do próprio colaborador são guardadas;
- cada cópia leva o identificador do usuário (cabeçalho `x-jc-uid`, posto pelo servidor) e **só é servida à mesma pessoa**; se outra pessoa entra no aparelho, as cópias anteriores são apagadas;
- **Sair** apaga as cópias; sessão encerrada (redirecionamento ao login, 401/403) também apaga a cópia da tela;
- API, autenticação, requisições `POST` e do roteador do Next nunca passam pelo cache.

## Como é feito
`public/sw.js` (service worker) + `public/sw-core.js` (decisões puras, testadas), `app/manifest.ts`, ícones gerados no build (`/icons/192`, `/icons/512`, `/icons/512-maskable`, `apple-icon`; **provisórios**, a marca definitiva fica para depois), `app/offline`, `components/PwaRegistro` (registra o service worker, informa o usuário e avisa quando a conexão cai), `BotaoInstalar` e `BotaoSair`.

Pontos de implantação: o Dockerfile do web agora copia `apps/web/public` (o modo *standalone* do Next não o inclui sozinho) e `/sw.js` é servido sem cache para que correções cheguem aos aparelhos. O app precisa ser servido por **HTTPS** (o Railway já é).

## Testes
- `apps/web/test/pwa-sw.test.ts`: o `sw.js` de verdade rodando num navegador simulado (instalação, atualização, cópia e uso offline, troca de usuário, sair, sessão encerrada, o que não deve ser guardado).
- `apps/web/test/pwa-componentes.test.tsx`: registro, aviso offline, instalar (Android e iPhone) e sair.
- Verificado também em **Chromium real** (Playwright): a escala aparece offline com o conteúdo da última visita, telas de gestão offline mostram a página offline, troca de usuário e "sair" nunca expõem cópia antiga.

## Não faz (ainda)
Notificações push (as avisos por WhatsApp/e-mail vêm nas próximas fatias), sincronização de ações feitas offline e a marca definitiva nos ícones.
