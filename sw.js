/* Green Agenda, service worker (módulo app).
   Referência no v1: app/index.html não tem SW; o antigo sw.js do protótipo
   usava network-first com fallback universal para index.html, o que devolvia
   HTML para CSS e fonte. Aqui (ESPECIFICACAO.md, seção 13):
   - navegação (request.mode === 'navigate'): network-first, fallback para o
     ./index.html do cache;
   - assets da própria origem: cache-first com atualização em segundo plano
     (stale-while-revalidate);
   - a fonte Inter é servida pela própria origem (vendor/fontes/) e entra no
     pré-cache como qualquer asset, então a tipografia sobrevive offline sem
     cache separado nem host externo;
   - tudo o mais passa direto.
   Nunca devolve index.html para requisição que não seja de navegação.
   VERSAO é escrita à mão a cada deploy. */

const VERSAO = 'green-agenda-v7';
/* -v7 desde 25/09/2026: esquema 5 (equipe oficial, perfil financeiro), o
   seletor de conta na tela de entrar e a publicação no GitHub Pages
   (scripts/publicar.sh), que serve o app em subcaminho: por isso todo
   caminho aqui continua relativo (./).
   -v6 desde 25/09/2026: a Inter saiu do Google Fonts e passou a ser servida de
   vendor/fontes/ (dois woff2 no pré-cache). O cache separado de fontes
   (green-agenda-fontes-v2) deixou de existir e é apagado na ativação, junto
   com a versão anterior do pré-cache.
   -v5 desde 24/09/2026: a nuvem (src/nuvem.js, src/config-nuvem.js e a cópia
   local do SDK do Firebase em vendor/firebase/) entrou no pré-cache, e o SW
   passou a tratar push e notificationclick.
   -v4 desde 24/09/2026: esquema 4 (presenças, apelidos, conta compartilhada)
   e a folha css/quadro.css entrou no pré-cache.
   -v3 desde 22/09/2026: esquema 3 (período e campos livres), src/whatsapp.js
   e as folhas css/registrar.css e css/hoje.css entraram no pré-cache.
   -v2 desde 18/09/2026: a interface passou a ser Inter e a Playfair saiu do
   app. O cache de fonte é cache-first e nunca revalida, então sem trocar a
   chave quem já usa o app continuaria recebendo a Playfair guardada. */

const PRE_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './css/tokens.css',
  './css/base.css',
  './css/componentes.css',
  './css/agenda.css',
  './css/telas.css',
  './css/listas.css',
  './css/agendar.css',
  './css/registrar.css',
  './css/hoje.css',
  './css/quadro.css',
  './vendor/fontes/inter-latin-wght-normal.woff2',
  './vendor/fontes/inter-latin-ext-wght-normal.woff2',
  './src/app.js',
  './src/util.js',
  './src/dados.js',
  './src/seed.js',
  './src/whatsapp.js',
  './src/regras.js',
  './src/ui.js',
  './src/icones.js',
  './src/logo.js',
  './src/grade.js',
  './src/agenda.js',
  './src/agendamento.js',
  './src/recursos.js',
  /* Nuvem: o módulo e a configuração são leves; o SDK (cerca de 1 MB) só é
     importado com a nuvem ligada, mas fica guardado para a primeira ativação
     e o app nativo funcionarem sem rede. */
  './src/nuvem.js',
  './src/config-nuvem.js',
  './vendor/firebase/firebase-app.js',
  './vendor/firebase/firebase-auth.js',
  './vendor/firebase/firebase-firestore.js',
  './vendor/firebase/firebase-messaging.js'
];

/* Resposta boa para guardar: ok da mesma origem. A opaca (resposta sem CORS
   de outra origem) deixou de ter uso quando a fonte passou a ser local. */
function podeGuardar(resposta) {
  return !!resposta && resposta.ok;
}

async function preCachear() {
  const cache = await caches.open(VERSAO);
  /* Um item por vez: um arquivo ausente não derruba a instalação inteira. */
  await Promise.all(PRE_CACHE.map(async (caminho) => {
    try {
      const resposta = await fetch(caminho, { cache: 'no-cache' });
      if (podeGuardar(resposta)) await cache.put(caminho, resposta);
    } catch (erro) {
      /* fica para a primeira visita online */
    }
  }));
}

async function apagarCachesAntigos() {
  const chaves = await caches.keys();
  await Promise.all(
    chaves
      .filter((chave) => chave !== VERSAO)
      .map((chave) => caches.delete(chave))
  );
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(preCachear().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(apagarCachesAntigos().then(() => self.clients.claim()));
});

self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'pular-espera') self.skipWaiting();
});

/* Push (modo nuvem, docs/NUVEM.md): o Cloud Messaging entrega um JSON com
   `notification` e `data`; sem este handler o navegador mostra um aviso
   genérico. O app nativo (Capacitor) não passa por aqui. */
function lerPush(evento) {
  if (!evento.data) return {};
  try { return evento.data.json() || {}; } catch (erro) {
    let texto = '';
    try { texto = evento.data.text(); } catch (e) { /* vazio */ }
    return { notification: { body: texto } };
  }
}

self.addEventListener('push', (evento) => {
  const carga = lerPush(evento);
  const n = carga.notification || {};
  const d = carga.data || {};
  const titulo = n.title || d.titulo || 'Green Agenda';
  const link = d.link || (carga.fcmOptions && carga.fcmOptions.link) || '#/notificacoes';
  const opcoes = {
    body: n.body || d.texto || '',
    icon: './icone-192.png',
    badge: './icone-192.png',
    tag: d.notificacaoId || undefined,
    data: { rota: link }
  };
  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/* Toque na notificação: foca a aba do app e manda a rota; sem aba, abre uma. */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const rota = (evento.notification.data && evento.notification.data.rota) || '#/notificacoes';
  const url = new URL('./' + (String(rota).startsWith('#') ? rota : '#/notificacoes'), self.registration.scope).href;
  evento.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    const aberta = lista.find((c) => c.url.startsWith(self.registration.scope));
    if (aberta) {
      aberta.postMessage({ tipo: 'abrir-rota', rota: String(rota) });
      return aberta.focus();
    }
    return self.clients.openWindow(url);
  }));
});

/* Navegação: rede primeiro; sem rede, o index.html guardado. */
async function responderNavegacao(requisicao) {
  const cache = await caches.open(VERSAO);
  try {
    const resposta = await fetch(requisicao);
    if (podeGuardar(resposta)) cache.put('./index.html', resposta.clone());
    return resposta;
  } catch (erro) {
    const guardada = (await cache.match('./index.html')) || (await cache.match('./'));
    if (guardada) return guardada;
    return new Response('Sem conexão e sem cópia guardada da Green Agenda.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* Em desenvolvimento (localhost) a rede vem primeiro, para a edição de um
   arquivo aparecer na primeira recarga; o cache só serve sem rede. */
const DESENVOLVIMENTO = ['localhost', '127.0.0.1'].includes(self.location.hostname);

/* Assets da própria origem: cache-first com atualização em segundo plano. */
async function responderAsset(requisicao, evento) {
  const cache = await caches.open(VERSAO);
  if (DESENVOLVIMENTO) {
    try {
      const resposta = await fetch(requisicao, { cache: 'no-store' });
      if (podeGuardar(resposta)) cache.put(requisicao, resposta.clone());
      return resposta;
    } catch (erro) {
      const guardada = await cache.match(requisicao);
      if (guardada) return guardada;
      throw erro;
    }
  }
  const guardada = await cache.match(requisicao);
  const atualizacao = fetch(requisicao)
    .then((resposta) => {
      if (podeGuardar(resposta)) cache.put(requisicao, resposta.clone());
      return resposta;
    })
    .catch(() => guardada);
  if (guardada) {
    evento.waitUntil(atualizacao.catch(() => {}));
    return guardada;
  }
  return atualizacao;
}

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== 'GET') return;

  let url;
  try { url = new URL(requisicao.url); } catch (erro) { return; }
  if (!/^https?:$/.test(url.protocol)) return;

  if (requisicao.mode === 'navigate') {
    evento.respondWith(responderNavegacao(requisicao));
    return;
  }
  if (url.origin === self.location.origin) {
    evento.respondWith(responderAsset(requisicao, evento));
  }
});
