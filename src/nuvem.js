/* Green Agenda, módulo dados: src/nuvem.js
   A nuvem: Firebase Authentication (email e senha), Firestore (com
   persistência offline) e a base para push via Cloud Messaging.

   Arquitetura, em uma frase: o app continua "local primeiro". A memória e o
   localStorage de src/dados.js seguem sendo a fonte que as telas leem de forma
   síncrona; a nuvem entra como REPLICAÇÃO nos dois sentidos:
   - para fora: a cada commit local, o repositório enfileira a operação em
     `filaSync` (a fila que já existia) e `sincronizar()` chama `replicar()`
     daqui, que grava no Firestore (setDoc com merge, ou deleteDoc). O que
     falhar por falta de rede fica pendente e reenvia quando a rede volta;
   - para dentro: depois do login, `escutar()` abre um onSnapshot por coleção e
     entrega as mudanças a dados.js, que aplica na base local por id, vencendo
     pelo carimbo `alteradoEm`, e dispara o `dados:alterado` de sempre.
   Ids de documento iguais aos ids locais; coleções com o mesmo nome; um
   documento por item.

   Este módulo NÃO importa src/dados.js (dados.js é quem importa este) e não
   toca em localStorage. O SDK só é carregado por import() dinâmico, e só
   quando `ativo: true` em src/config-nuvem.js: no modo local nada daqui pesa.

   Contas e pessoas (decisão de projeto, ver docs/NUVEM.md, seção "Como o
   login casa com o cadastro"): o id local de uma pessoa ("u7") é referenciado
   em responsaveis, membros, userId, registradoPor e companhia, e só existe um
   uid do Firebase depois de a conta ser criada. Então o documento da pessoa
   fica em usuarios/{id} (id local) e o login é ligado a ela pelo documento
   contas/{uid} = { usuarioId, perfil, email }, que as regras usam para saber
   quem é quem. `vincularConta` e a Cloud Function `aoCriarUsuarioAuth` criam
   esse elo; `criarLogin` cria a conta pelo próprio app, sem console. */

import { configNuvem } from './config-nuvem.js';

/** Nome interno da instância do Firebase (o secundário serve para criar logins sem derrubar a sessão do admin). */
const NOME_APP = 'green-agenda';
const NOME_APP_SECUNDARIO = 'green-agenda-secundaria';

/** Coleções locais que existem também no Firestore, com o mesmo nome. `filaSync`, `meta` e `credenciais` nunca sobem. */
export const COLECOES_REPLICADAS = ['usuarios', 'clientes', 'tipos', 'equipes', 'veiculos', 'indisponibilidades', 'agendamentos', 'assinaturas', 'config', 'presencas', 'notificacoes', 'auditoria'];

/** Coleções que crescem sem parar: a escuta pega só as mais recentes por `ts`, o mesmo limite da poda local. */
export const LIMITES_ESCUTA = { auditoria: 1000, notificacoes: 600 };

/** Tempo máximo de espera por uma gravação antes de deixá-la pendente para a próxima rodada (o Firestore termina sozinho). */
export const TEMPO_GRAVACAO_MS = 20000;
const TEMPO_ESTADO_AUTH_MS = 8000;
const TAMANHO_LOTE = 400;

let sdk = null;
let carregando = null;
let app = null;
let auth = null;
let db = null;
let usuarioAuth = null;
let contaAtual = null;
let iniciado = false;
let iniciando = null;
let assinaturas = [];
let aoMudarSessaoCb = null;
let pararEstadoAuth = null;

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

/** A nuvem está ligada E configurada. Interruptor ligado sem valores é tratado como desligado, com aviso no console. */
export function ativa() {
  const c = configNuvem || {};
  if (!c.ativo) return false;
  const f = c.firebase || {};
  const completa = !!(f.apiKey && f.projectId && f.appId);
  if (!completa && !ativa.avisou) {
    ativa.avisou = true;
    console.warn('config-nuvem.js: ativo é true, mas apiKey, projectId ou appId estão vazios. A nuvem fica desligada.');
  }
  return completa;
}

/** O SDK do Firebase já foi importado nesta sessão? (No modo local tem que ser sempre false.) */
export function sdkCarregado() {
  return !!sdk;
}

/** uid do usuário autenticado no Firebase, ou null. */
export function uidAtual() {
  return usuarioAuth ? usuarioAuth.uid : null;
}

/** Email do usuário autenticado no Firebase, ou ''. */
export function emailAtual() {
  return usuarioAuth && usuarioAuth.email ? String(usuarioAuth.email).toLowerCase() : '';
}

/** O documento contas/{uid} carregado no login ou na restauração ({ usuarioId, perfil, email }), ou null. */
export function contaCarregada() {
  return contaAtual ? Object.assign({}, contaAtual) : null;
}

/** Resumo para telas: ligada, SDK carregado, quem está autenticado e quantas coleções estão em escuta. */
export function estado() {
  return { ativa: ativa(), sdkCarregado: !!sdk, uid: uidAtual(), email: emailAtual(), usuarioId: contaAtual ? contaAtual.usuarioId : null, escutando: assinaturas.length, projeto: (configNuvem.firebase || {}).projectId || '' };
}

/** Registra quem quer saber quando a sessão do Firebase muda por fora do app (token revogado, sessão expirada). */
export function aoMudarSessao(cb) {
  aoMudarSessaoCb = typeof cb === 'function' ? cb : null;
}

/* ------------------------------------------------------------------ */
/* SDK                                                                 */
/* ------------------------------------------------------------------ */

function urlSdk(arquivo) {
  return new URL((configNuvem.pastaSdk || '../vendor/firebase/') + arquivo, import.meta.url).href;
}

/** Importa app, auth e firestore uma vez só. Messaging fica para quando o push pedir. */
async function carregarSdk() {
  if (sdk) return sdk;
  if (!carregando) {
    carregando = Promise.all([import(urlSdk('firebase-app.js')), import(urlSdk('firebase-auth.js')), import(urlSdk('firebase-firestore.js'))])
      .then(([appMod, authMod, fsMod]) => { sdk = { appMod, authMod, fsMod, msgMod: null }; return sdk; })
      .catch((e) => { carregando = null; throw e; });
  }
  return carregando;
}

async function carregarMessaging() {
  const s = await carregarSdk();
  if (!s.msgMod) s.msgMod = await import(urlSdk('firebase-messaging.js'));
  return s.msgMod;
}

/** Garante SDK e instâncias prontas (chama iniciar se ainda não foi). */
async function pronto() {
  if (!ativa()) throw new Error('A nuvem está desligada em src/config-nuvem.js');
  if (!iniciado) await iniciar();
  return sdk;
}

function primeiroEstadoAuth(authMod) {
  return new Promise((resolve) => {
    let feito = false;
    let parar = null;
    let timer = null;
    const terminar = (u) => {
      if (feito) return;
      feito = true;
      if (timer) clearTimeout(timer);
      if (typeof parar === 'function') parar();
      resolve(u || null);
    };
    timer = setTimeout(() => terminar(auth.currentUser || null), TEMPO_ESTADO_AUTH_MS);
    parar = authMod.onAuthStateChanged(auth, (u) => terminar(u), () => terminar(null));
  });
}

/**
 * Carrega o SDK, inicializa app, Auth e Firestore (persistência offline, várias abas) e espera o estado inicial da
 * autenticação. Com usuário autenticado, já traz contas/{uid} e o documento da pessoa.
 * @returns {Promise<{uid:string, email:string, conta:object|null, usuario:object|null}|null>} null com a nuvem desligada ou sem sessão
 */
export async function iniciar() {
  if (!ativa()) return null;
  if (iniciado) return usuarioAuth ? { uid: usuarioAuth.uid, email: emailAtual(), conta: contaAtual, usuario: null } : null;
  if (iniciando) return iniciando;
  iniciando = (async () => {
    const { appMod, authMod, fsMod } = await carregarSdk();
    app = appMod.getApps().find((a) => a.name === NOME_APP) || appMod.initializeApp(configNuvem.firebase, NOME_APP);
    try {
      auth = authMod.initializeAuth(app, { persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence, authMod.inMemoryPersistence] });
    } catch (e) {
      auth = authMod.getAuth(app);
    }
    try {
      db = fsMod.initializeFirestore(app, {
        ignoreUndefinedProperties: true,
        experimentalAutoDetectLongPolling: true,
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
      });
    } catch (e) {
      db = fsMod.getFirestore(app);
    }
    usuarioAuth = await primeiroEstadoAuth(authMod);
    iniciado = true;
    /* Escuta permanente: se o Firebase derrubar a sessão por fora (senha trocada em outro lugar, conta desativada), avisa dados.js. */
    pararEstadoAuth = authMod.onAuthStateChanged(auth, (u) => {
      const antes = usuarioAuth ? usuarioAuth.uid : null;
      usuarioAuth = u || null;
      const depois = u ? u.uid : null;
      if (antes !== depois && aoMudarSessaoCb) {
        try { aoMudarSessaoCb(depois); } catch (e) { console.error(e); }
      }
    });
    let conta = null;
    let usuario = null;
    if (usuarioAuth) {
      try {
        const r = await carregarConta(usuarioAuth.uid);
        conta = r.conta;
        usuario = r.usuario;
      } catch (e) {
        console.warn('Nuvem: não foi possível ler a conta agora', e);
      }
    }
    return usuarioAuth ? { uid: usuarioAuth.uid, email: emailAtual(), conta, usuario } : null;
  })();
  try {
    return await iniciando;
  } finally {
    iniciando = null;
  }
}

/* ------------------------------------------------------------------ */
/* Autenticação                                                        */
/* ------------------------------------------------------------------ */

/**
 * Mensagem em português para um erro do Firebase (códigos de Auth e Firestore). Uma só para toda falha de credencial,
 * como no modo local: o motivo real não vaza para a tela.
 * @param {any} erro @returns {string}
 */
export function mensagemDeErro(erro) {
  const codigo = String((erro && erro.code) || '').replace(/^auth\//, '').replace(/^firestore\//, '');
  const mapa = {
    'invalid-credential': 'Email ou senha incorretos.', 'wrong-password': 'Email ou senha incorretos.', 'user-not-found': 'Email ou senha incorretos.',
    'invalid-email': 'Email ou senha incorretos.', 'missing-password': 'Email ou senha incorretos.', 'invalid-login-credentials': 'Email ou senha incorretos.',
    'user-disabled': 'Este acesso foi desativado.',
    'too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'network-request-failed': 'Sem conexão com a nuvem. Verifique a internet e tente de novo.',
    'email-already-in-use': 'Já existe um login com este email.',
    'weak-password': 'A senha precisa de ao menos 6 caracteres.',
    'requires-recent-login': 'Por segurança, saia e entre de novo antes de trocar a senha.',
    'operation-not-allowed': 'A entrada por email e senha não está ativada no projeto do Firebase.',
    'admin-restricted-operation': 'A criação de logins pelo app está desligada no Firebase. Crie a conta no console.',
    'permission-denied': 'Sem permissão para gravar isto na nuvem.',
    'unavailable': 'Nuvem indisponível no momento. Tentamos de novo em seguida.',
    'tempo-esgotado': 'A nuvem demorou para responder. A alteração fica na fila.',
    'unauthenticated': 'Sua sessão na nuvem expirou. Entre de novo.'
  };
  if (mapa[codigo]) return mapa[codigo];
  const texto = erro && erro.message ? String(erro.message) : String(erro || '');
  return 'Não foi possível falar com a nuvem agora.' + (codigo ? ' (' + codigo + ')' : texto ? ' ' + texto : '');
}

/**
 * Entra com email e senha no Firebase Auth. `lembrar` falso usa persistência de sessão (fecha a aba, acabou), como o
 * sessionStorage do modo local. Não lê o cadastro: quem chama usa carregarConta(uid) em seguida.
 * @param {string} email @param {string} senha @param {boolean} lembrar
 * @returns {Promise<{ok:boolean, uid?:string, email?:string, erro?:string, codigo?:string}>}
 */
export async function entrar(email, senha, lembrar) {
  if (!ativa()) return { ok: false, erro: 'A nuvem está desligada.' };
  const { authMod } = await pronto();
  try {
    await authMod.setPersistence(auth, lembrar ? authMod.indexedDBLocalPersistence : authMod.browserSessionPersistence);
  } catch (e) {
    try { await authMod.setPersistence(auth, lembrar ? authMod.browserLocalPersistence : authMod.browserSessionPersistence); } catch (e2) { /* segue com a padrão */ }
  }
  try {
    const cred = await authMod.signInWithEmailAndPassword(auth, String(email || '').trim().toLowerCase(), String(senha || ''));
    usuarioAuth = cred.user;
    return { ok: true, uid: cred.user.uid, email: String(cred.user.email || email).toLowerCase() };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e), codigo: e && e.code ? String(e.code) : '' };
  }
}

/** Sai do Firebase Auth e para as escutas. Nunca lança. @returns {Promise<void>} */
export async function sair() {
  pararEscuta();
  contaAtual = null;
  if (!sdk || !auth) return;
  try { await sdk.authMod.signOut(auth); } catch (e) { console.warn('Nuvem: falha ao sair', e); }
  usuarioAuth = null;
}

/**
 * Manda o email de redefinição de senha. Email inexistente responde ok também, para não revelar quem tem conta.
 * @param {string} email @returns {Promise<{ok:boolean, erro?:string}>}
 */
export async function redefinirSenha(email) {
  const { authMod } = await pronto();
  try {
    await authMod.sendPasswordResetEmail(auth, String(email || '').trim().toLowerCase());
    return { ok: true };
  } catch (e) {
    const codigo = String((e && e.code) || '');
    if (/user-not-found|invalid-email/.test(codigo)) return { ok: true };
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/** Troca a senha do próprio usuário autenticado. @param {string} senhaNova @returns {Promise<{ok:boolean, erro?:string}>} */
export async function trocarSenha(senhaNova) {
  const { authMod } = await pronto();
  if (!auth.currentUser) return { ok: false, erro: 'Ninguém autenticado na nuvem.' };
  try {
    await authMod.updatePassword(auth.currentUser, String(senhaNova || ''));
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/**
 * Cria um login (conta do Firebase Auth) para outra pessoa SEM derrubar a sessão de quem está logado: usa uma
 * instância secundária do app, cria, sai dela e devolve o uid. Não grava contas/{uid}: quem chama usa vincularConta.
 * Exige "Criar (inscrição)" ligado nas ações de usuário do Authentication (é o padrão).
 * @param {string} email @param {string} senha @returns {Promise<{ok:boolean, uid?:string, erro?:string, codigo?:string}>}
 */
export async function criarLogin(email, senha) {
  const { appMod, authMod } = await pronto();
  const app2 = appMod.getApps().find((a) => a.name === NOME_APP_SECUNDARIO) || appMod.initializeApp(configNuvem.firebase, NOME_APP_SECUNDARIO);
  let auth2;
  try { auth2 = authMod.initializeAuth(app2, { persistence: authMod.inMemoryPersistence }); } catch (e) { auth2 = authMod.getAuth(app2); }
  try {
    const cred = await authMod.createUserWithEmailAndPassword(auth2, String(email || '').trim().toLowerCase(), String(senha || ''));
    const uid = cred.user.uid;
    try { await authMod.signOut(auth2); } catch (e) { /* a instância é descartável */ }
    return { ok: true, uid };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e), codigo: e && e.code ? String(e.code) : '' };
  }
}

/* ------------------------------------------------------------------ */
/* Conta e pessoa                                                      */
/* ------------------------------------------------------------------ */

function docDe(snap) {
  return snap && snap.exists() ? Object.assign({}, snap.data(), { id: snap.id }) : null;
}

/** Lê um documento: servidor primeiro, cache do Firestore sem rede. @param {string} colecao @param {string} id @returns {Promise<object|null>} */
export async function lerDocumento(colecao, id) {
  const { fsMod } = await pronto();
  const snap = await fsMod.getDoc(fsMod.doc(db, colecao, String(id)));
  return docDe(snap);
}

/**
 * contas/{uid} e, a partir dele, usuarios/{usuarioId}. Guarda a conta em memória para salvarTokenPush e para as telas.
 * @param {string} uid @returns {Promise<{conta:object|null, usuario:object|null}>}
 */
export async function carregarConta(uid) {
  const conta = uid ? await lerDocumento('contas', uid) : null;
  contaAtual = conta ? { uid, usuarioId: conta.usuarioId || null, perfil: conta.perfil || null, email: String(conta.email || '').toLowerCase() } : null;
  const usuario = conta && conta.usuarioId ? await lerDocumento('usuarios', conta.usuarioId) : null;
  return { conta: contaAtual, usuario };
}

/**
 * Liga um login (uid do Firebase Auth) a uma pessoa do cadastro: grava contas/{uid} e o campo `uid` em
 * usuarios/{usuarioId}, numa gravação atômica. Só admin passa nas regras.
 * @param {string} usuarioId @param {string} uid @param {{perfil:string, email:string}} dadosConta
 * @returns {Promise<{ok:boolean, erro?:string}>}
 */
export async function vincularConta(usuarioId, uid, dadosConta) {
  const { fsMod } = await pronto();
  if (!usuarioId || !uid) return { ok: false, erro: 'Pessoa e uid são obrigatórios.' };
  const agora = Date.now();
  try {
    const lote = fsMod.writeBatch(db);
    lote.set(fsMod.doc(db, 'contas', String(uid)), {
      id: String(uid), uid: String(uid), usuarioId: String(usuarioId), perfil: String((dadosConta && dadosConta.perfil) || ''),
      email: String((dadosConta && dadosConta.email) || '').toLowerCase(), alteradoEm: agora
    }, { merge: true });
    lote.set(fsMod.doc(db, 'usuarios', String(usuarioId)), { id: String(usuarioId), uid: String(uid), alteradoEm: agora }, { merge: true });
    await lote.commit();
    if (contaAtual && contaAtual.uid === uid) contaAtual.usuarioId = String(usuarioId);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Replicação: para fora                                               */
/* ------------------------------------------------------------------ */

/** Cópia limpa para o Firestore: sem undefined, sem funções, sem referências compartilhadas com a memória viva. */
function limpar(doc) {
  return JSON.parse(JSON.stringify(doc));
}

function comTempo(promessa, ms) {
  return new Promise((resolver, rejeitar) => {
    const timer = setTimeout(() => { const e = new Error('Tempo esgotado'); e.code = 'tempo-esgotado'; rejeitar(e); }, ms);
    promessa.then((v) => { clearTimeout(timer); resolver(v); }, (e) => { clearTimeout(timer); rejeitar(e); });
  });
}

/**
 * Grava uma operação da fila no Firestore. 'remover' apaga; 'criar' e 'atualizar' fazem setDoc com merge do documento
 * inteiro (o payload da fila é sempre o documento completo). Resolve quando o servidor confirma; rejeita com
 * code 'tempo-esgotado' se demorar mais que TEMPO_GRAVACAO_MS (o Firestore conclui sozinho depois; reenviar é inócuo).
 * @param {string} colecao @param {'criar'|'atualizar'|'remover'} op @param {object} payload documento ou { id }
 * @returns {Promise<void>}
 */
export async function replicar(colecao, op, payload) {
  const { fsMod } = await pronto();
  const id = payload && payload.id != null ? String(payload.id) : '';
  if (!id) throw new Error('Documento sem id em ' + colecao);
  const ref = fsMod.doc(db, colecao, id);
  if (op === 'remover') return comTempo(fsMod.deleteDoc(ref), TEMPO_GRAVACAO_MS);
  return comTempo(fsMod.setDoc(ref, limpar(payload), { merge: true }), TEMPO_GRAVACAO_MS);
}

/**
 * Sobe coleções inteiras em lotes de 400 (o limite do Firestore é 500 por lote). É o "Enviar tudo para a nuvem".
 * @param {Object<string, object[]>} mapa colecao para lista de documentos
 * @param {(feitos:number, total:number, colecao:string) => void} [aoProgredir]
 * @returns {Promise<{enviados:number, colecoes:number}>}
 */
export async function enviarTudo(mapa, aoProgredir) {
  const { fsMod } = await pronto();
  const entradas = Object.keys(mapa || {}).filter((c) => COLECOES_REPLICADAS.includes(c) && Array.isArray(mapa[c]) && mapa[c].length);
  const total = entradas.reduce((n, c) => n + mapa[c].length, 0);
  let enviados = 0;
  for (const colecao of entradas) {
    const docs = mapa[colecao].filter((d) => d && d.id != null);
    for (let i = 0; i < docs.length; i += TAMANHO_LOTE) {
      const lote = fsMod.writeBatch(db);
      const fatia = docs.slice(i, i + TAMANHO_LOTE);
      for (const d of fatia) lote.set(fsMod.doc(db, colecao, String(d.id)), limpar(d), { merge: true });
      await lote.commit();
      enviados += fatia.length;
      if (aoProgredir) { try { aoProgredir(enviados, total, colecao); } catch (e) { /* progresso é cortesia */ } }
    }
  }
  return { enviados, colecoes: entradas.length };
}

/* ------------------------------------------------------------------ */
/* Replicação: para dentro                                             */
/* ------------------------------------------------------------------ */

function consultaDe(fsMod, colecao) {
  const ref = fsMod.collection(db, colecao);
  const limite = LIMITES_ESCUTA[colecao];
  return limite ? fsMod.query(ref, fsMod.orderBy('ts', 'desc'), fsMod.limit(limite)) : ref;
}

/**
 * Abre um onSnapshot por coleção e entrega cada lote de mudanças a `hooks.aplicarLote(colecao, itens)`, onde cada
 * item é { tipo: 'added'|'modified'|'removed', id, doc (null em removed), pendente (gravação local ainda não
 * confirmada) }. Quem aplica decide quem vence (dados.js, pelo alteradoEm). Erros vão para `hooks.erro(colecao, erro)`.
 * Chamar de novo reinicia as escutas.
 * @param {string[]} [colecoes] COLECOES_REPLICADAS por padrão
 * @param {{aplicarLote:Function, erro?:Function}} hooks
 * @returns {Promise<number>} quantas coleções ficaram em escuta
 */
export async function escutar(colecoes, hooks) {
  const { fsMod } = await pronto();
  pararEscuta();
  const lista = Array.isArray(colecoes) && colecoes.length ? colecoes : COLECOES_REPLICADAS;
  for (const colecao of lista) {
    const parar = fsMod.onSnapshot(consultaDe(fsMod, colecao), { includeMetadataChanges: false }, (snap) => {
      const itens = snap.docChanges().map((m) => ({
        tipo: m.type,
        id: m.doc.id,
        doc: m.type === 'removed' ? null : Object.assign({}, m.doc.data(), { id: m.doc.id }),
        pendente: !!(m.doc.metadata && m.doc.metadata.hasPendingWrites)
      }));
      if (!itens.length) return;
      try { hooks.aplicarLote(colecao, itens, { doCache: !!(snap.metadata && snap.metadata.fromCache) }); } catch (e) { console.error('Nuvem: falha ao aplicar ' + colecao, e); }
    }, (erro) => {
      console.warn('Nuvem: escuta de ' + colecao + ' falhou', erro);
      if (hooks.erro) { try { hooks.erro(colecao, erro); } catch (e) { /* ignora */ } }
    });
    assinaturas.push(parar);
  }
  return assinaturas.length;
}

/** Fecha todas as escutas. */
export function pararEscuta() {
  for (const parar of assinaturas) { try { parar(); } catch (e) { /* ignora */ } }
  assinaturas = [];
}

/** Espera as gravações pendentes do Firestore serem confirmadas (útil antes de sair). @returns {Promise<void>} */
export async function esperarGravacoes() {
  if (!sdk || !db) return;
  try { await sdk.fsMod.waitForPendingWrites(db); } catch (e) { /* sem rede: fica para depois */ }
}

/* ------------------------------------------------------------------ */
/* Push: tokens do aparelho                                            */
/* ------------------------------------------------------------------ */

/* O id de pessoa aceito é o local ("u7"); por conveniência o uid do Firebase de quem está logado também é aceito e
   traduzido pela conta carregada. Os tokens moram em usuarios/{usuarioId}/tokens/{token}, que é onde a Cloud Function
   `aoCriarNotificacao` (functions/index.js) os procura. */
function usuarioIdDe(uidOuId) {
  const chave = String(uidOuId || '');
  if (contaAtual && chave === contaAtual.uid && contaAtual.usuarioId) return contaAtual.usuarioId;
  return chave;
}

function idDoToken(token) {
  return String(token || '').replace(/\//g, '_').slice(0, 1400);
}

/**
 * Guarda o token de push deste aparelho na pessoa. Chamado pelo módulo nativo (Capacitor) e pelo push da Web.
 * @param {string} uidOuId uid do Firebase de quem está logado, ou id local da pessoa
 * @param {string} token token do FCM (Android e Web) ou APNs via FCM (iOS)
 * @param {'android'|'ios'|'web'|string} plataforma
 * @returns {Promise<{ok:boolean, erro?:string}>}
 */
export async function salvarTokenPush(uidOuId, token, plataforma) {
  if (!token) return { ok: false, erro: 'Token vazio.' };
  const { fsMod } = await pronto();
  const usuarioId = usuarioIdDe(uidOuId);
  if (!usuarioId) return { ok: false, erro: 'Sem pessoa para guardar o token.' };
  try {
    const aparelho = typeof navigator !== 'undefined' && navigator.userAgent ? String(navigator.userAgent).slice(0, 200) : '';
    await fsMod.setDoc(fsMod.doc(db, 'usuarios', String(usuarioId), 'tokens', idDoToken(token)), {
      token: String(token), plataforma: String(plataforma || 'web'), uid: uidAtual() || null, aparelho,
      atualizadoEm: fsMod.serverTimestamp(), ativo: true
    }, { merge: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/**
 * Remove o token deste aparelho (ao sair da conta ou ao desligar o push).
 * @param {string} uidOuId @param {string} token @returns {Promise<{ok:boolean, erro?:string}>}
 */
export async function removerTokenPush(uidOuId, token) {
  if (!token) return { ok: true };
  const { fsMod } = await pronto();
  const usuarioId = usuarioIdDe(uidOuId);
  if (!usuarioId) return { ok: true };
  try {
    await fsMod.deleteDoc(fsMod.doc(db, 'usuarios', String(usuarioId), 'tokens', idDoToken(token)));
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/**
 * Push no navegador (PWA): pede permissão, obtém o token do FCM com a chave VAPID e o registro do service worker do
 * app (./sw.js, que já trata os eventos push e notificationclick) e guarda em usuarios/{usuarioId}/tokens.
 * @param {string} uidOuId @returns {Promise<{ok:boolean, token?:string, erro?:string}>}
 */
export async function pedirTokenPushWeb(uidOuId) {
  if (!configNuvem.vapidKey) return { ok: false, erro: 'Sem chave VAPID em src/config-nuvem.js.' };
  if (typeof Notification === 'undefined' || typeof navigator === 'undefined' || !navigator.serviceWorker) return { ok: false, erro: 'Este navegador não recebe notificações push.' };
  const msgMod = await carregarMessaging();
  await pronto();
  try {
    if (!(await msgMod.isSupported())) return { ok: false, erro: 'Este navegador não recebe notificações push.' };
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return { ok: false, erro: 'Permissão de notificação negada.' };
    const registro = await navigator.serviceWorker.ready;
    const messaging = msgMod.getMessaging(app);
    const token = await msgMod.getToken(messaging, { vapidKey: configNuvem.vapidKey, serviceWorkerRegistration: registro });
    if (!token) return { ok: false, erro: 'O navegador não devolveu token.' };
    const r = await salvarTokenPush(uidOuId, token, 'web');
    return r.ok ? { ok: true, token } : r;
  } catch (e) {
    return { ok: false, erro: mensagemDeErro(e) };
  }
}

/**
 * Mensagem push recebida com o app aberto no navegador (em primeiro plano o navegador não mostra sozinho).
 * @param {(mensagem:{titulo:string, texto:string, link:string}) => void} cb @returns {Promise<Function>} função para parar
 */
export async function aoReceberPushWeb(cb) {
  const msgMod = await carregarMessaging();
  await pronto();
  if (!(await msgMod.isSupported())) return () => {};
  const messaging = msgMod.getMessaging(app);
  return msgMod.onMessage(messaging, (payload) => {
    const n = (payload && payload.notification) || {};
    const d = (payload && payload.data) || {};
    cb({ titulo: n.title || d.titulo || 'Green Agenda', texto: n.body || d.texto || '', link: d.link || '' });
  });
}

/** Fecha escutas, sessão de Auth e Firestore (testes e troca de projeto). Nunca lança. */
export async function encerrar() {
  pararEscuta();
  if (typeof pararEstadoAuth === 'function') { try { pararEstadoAuth(); } catch (e) { /* ignora */ } }
  pararEstadoAuth = null;
  if (sdk && db) { try { await sdk.fsMod.terminate(db); } catch (e) { /* ignora */ } }
  if (sdk && app) { try { await sdk.appMod.deleteApp(app); } catch (e) { /* ignora */ } }
  app = null; auth = null; db = null; usuarioAuth = null; contaAtual = null; iniciado = false;
}
