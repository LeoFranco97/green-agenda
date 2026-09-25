/* Green Agenda, módulo nativo: src/nativo.js
   Tudo que só existe dentro do app empacotado pelo Capacitor (Android e
   iOS): barra de status, splash, botão voltar do Android, push do Firebase
   Cloud Messaging e os lembretes locais de véspera. No navegador comum este
   arquivo nem é carregado: src/app.js só o importa (import() dinâmico)
   quando window.Capacitor.isNativePlatform() é verdadeiro, e iniciar()
   devolve false fora do aparelho.

   Sem bundler, os pacotes @capacitor/* não são importados: o bridge nativo
   injeta a lista de plugins em window.Capacitor.PluginHeaders e o runtime
   copiado em vendor/capacitor/core.js (registerPlugin) transforma cada nome
   em objeto chamável. Ver vendor/capacitor/LEIA-ME.md.

   O que este módulo faz, e quando:
   - iniciar(): barra de status clara sobre o oliva, botão voltar, ouvintes,
     esconde a splash depois do primeiro render (app.js chama depois do
     roteador montar a primeira tela);
   - ao entrar (sessão restaurada ou login): pede permissão de notificação,
     registra o push, cria o canal "agenda" no Android e agenda os lembretes;
   - em 'dados:alterado' com agendamentos: reagenda os lembretes de véspera
     dos serviços da própria pessoa (gravar agenda, cancelar cancela);
   - ao sair: cancela os lembretes e tira o token do push da pessoa (nuvem);
   - push recebido com o app aberto: toast com botão "Abrir"; toque na
     notificação com o app fechado: navega para a rota que veio no data.link.

   Token do push e nuvem: só grava em usuarios/{id}/tokens quando a nuvem
   está ligada (src/config-nuvem.js) e há alguém logado; no modo local o
   token fica em memória e nada sai do aparelho. No iOS o token que o plugin
   entrega é o do APNs; para o Cloud Messaging entregar no iPhone é preciso
   o SDK do Firebase no projeto Xcode (docs/LOJAS.md, seção 10).

   Convenções: nenhum hex aqui, a cor da barra vem do token --oliva lido do
   CSS; nenhum texto de notificação sai sem passar por String(); ids de
   notificação local são inteiros derivados do id do agendamento. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as ui from './ui.js';
import * as nuvem from './nuvem.js';
import { Capacitor, registerPlugin } from '../vendor/capacitor/core.js';

/* Lembrete de véspera: às 18:00 do dia anterior, para os serviços dos
   próximos 14 dias em que a pessoa é responsável. O iOS guarda no máximo 64
   notificações pendentes por app, então há um teto abaixo disso. */
const HORA_VESPERA = '18:00';
const DIAS_A_FRENTE = 14;
const MAXIMO_LEMBRETES = 40;
const CANAL_ANDROID = { id: 'agenda', name: 'Agenda', description: 'Serviços, lembretes de véspera e avisos da gerência', importance: 4, visibility: 1, vibration: true };
const ORIGEM_LEMBRETE = 'vespera';
const ESPERA_REAGENDAR_MS = 1500;

let plugins = null;
let plataforma = 'web';
let opcoesApp = {};
let tokenPush = '';
let pessoaDoToken = null;
let timerReagendar = null;
let reagendando = false;
let reagendarDeNovo = false;

/* ------------------------------------------------------------------ */
/* Detecção                                                            */
/* ------------------------------------------------------------------ */

/** Verdadeiro dentro do app Capacitor (Android ou iOS). @returns {boolean} */
export function nativo() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

/** 'android', 'ios' ou 'web'. @returns {string} */
export function plataformaAtual() {
  return plataforma;
}

/** Token de push deste aparelho nesta sessão, ou ''. Para a tela Conta. @returns {string} */
export function tokenAtual() {
  return tokenPush;
}

function disponivel(nome) {
  try { return Capacitor.isPluginAvailable(nome); } catch (e) { return false; }
}

function carregarPlugins() {
  plugins = {};
  for (const nome of ['App', 'StatusBar', 'SplashScreen', 'PushNotifications', 'LocalNotifications']) {
    plugins[nome] = disponivel(nome) ? registerPlugin(nome) : null;
    if (!plugins[nome]) console.warn('nativo: plugin ' + nome + ' não está no projeto nativo; rode npx cap sync.');
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/**
 * Liga o lado nativo. Chamado por src/app.js depois da primeira tela montada, e só no aparelho.
 * @param {{telaInicial?:()=>string, rotaLogin?:string}} [opcoes] telaInicial diz qual é a raiz de quem está logado, para o botão voltar do Android
 * @returns {Promise<boolean>} false fora do Capacitor ou se já estava ligado
 */
export async function iniciar(opcoes) {
  if (!nativo() || iniciar.ligado) return false;
  iniciar.ligado = true;
  opcoesApp = opcoes || {};
  plataforma = Capacitor.getPlatform();
  document.documentElement.setAttribute('data-plataforma', plataforma);
  carregarPlugins();

  await ajustarBarraDeStatus();
  ligarBotaoVoltar();
  ligarCicloDeVida();
  ligarOuvintesDePush();
  ligarOuvintesLocais();
  document.addEventListener('sessao:alterada', aoAlterarSessao);
  document.addEventListener('dados:alterado', aoAlterarDados);

  await esconderSplash();
  if (dados.sessao.usuario()) aoEntrar().catch((e) => console.warn('nativo: ' + mensagem(e)));
  return true;
}

function mensagem(erro) {
  return String(erro && erro.message ? erro.message : erro);
}

/* Cor da barra: o token --oliva do CSS, para não existir hex fora de css/tokens.css. */
function corDaBarra() {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--oliva').trim(); } catch (e) { return ''; }
}

async function ajustarBarraDeStatus() {
  const SB = plugins.StatusBar;
  if (!SB) return;
  try {
    /* Texto claro sobre o oliva. 'LIGHT' no plugin quer dizer "barra clara", texto escuro; 'DARK' é a barra
       escura com texto claro. O oliva é escuro, então DARK. */
    await SB.setStyle({ style: 'DARK' });
    const cor = corDaBarra();
    if (cor && plataforma === 'android') await SB.setBackgroundColor({ color: cor });
    if (plataforma === 'ios') await SB.setOverlaysWebView({ overlay: false });
  } catch (e) {
    console.warn('nativo: barra de status: ' + mensagem(e));
  }
}

/** Esconde a splash. Espera um quadro para a primeira tela já estar pintada. @returns {Promise<void>} */
export async function esconderSplash() {
  const SS = plugins && plugins.SplashScreen;
  if (!SS) return;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { await SS.hide({ fadeOutDuration: 200 }); } catch (e) { /* já escondida */ }
}

/* ------------------------------------------------------------------ */
/* Botão voltar do Android e ciclo de vida                             */
/* ------------------------------------------------------------------ */

function rotaBase(hash) {
  return String(hash || '').split('?')[0];
}

function naRaiz() {
  const atual = rotaBase(location.hash);
  const raiz = typeof opcoesApp.telaInicial === 'function' ? rotaBase(opcoesApp.telaInicial()) : '';
  const login = rotaBase(opcoesApp.rotaLogin || '#/entrar');
  return !atual || atual === '#/' || atual === raiz || atual === login;
}

function modalAberto() {
  const camada = document.getElementById('camada-modal');
  return !!(camada && !camada.hidden);
}

function ligarBotaoVoltar() {
  const App = plugins.App;
  if (!App || plataforma !== 'android') return;
  App.addListener('backButton', () => {
    /* Uma camada por vez, na ordem em que cobrem a tela: modal, sheet, rota. */
    if (modalAberto()) { ui.fecharModal(); return; }
    if (ui.sheetAberto()) { ui.fecharSheet(); return; }
    if (naRaiz()) {
      /* Na raiz o voltar leva para a tela inicial do aparelho, com o app vivo em segundo plano. */
      App.minimizeApp().catch(() => App.exitApp());
      return;
    }
    ui.voltar();
  }).catch((e) => console.warn('nativo: backButton: ' + mensagem(e)));
}

function ligarCicloDeVida() {
  const App = plugins.App;
  if (!App) return;
  /* Voltou do segundo plano: o dia pode ter virado, então os lembretes de véspera são refeitos. */
  App.addListener('resume', () => { agendarReagendamento(); }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

function aoAlterarSessao(ev) {
  const logado = !!(ev && ev.detail && ev.detail.usuario);
  if (logado) aoEntrar().catch((e) => console.warn('nativo: ' + mensagem(e)));
  else aoSair().catch((e) => console.warn('nativo: ' + mensagem(e)));
}

async function aoEntrar() {
  const u = dados.sessao.usuario();
  if (!u) return;
  pessoaDoToken = { usuarioId: u.id, uid: nuvem.ativa() ? nuvem.uidAtual() : null };
  const permitido = await pedirPermissao();
  if (permitido) {
    await registrarPush();
    await guardarToken();
  }
  agendarReagendamento();
}

async function aoSair() {
  const anterior = pessoaDoToken;
  pessoaDoToken = null;
  agendarReagendamento();
  if (anterior && tokenPush && nuvem.ativa()) {
    /* Melhor esforço: o logout do Firebase já está em curso, então a remoção pode chegar tarde.
       A Cloud Function apaga o token quando o envio devolve "não registrado". */
    const r = await nuvem.removerTokenPush(anterior.uid || anterior.usuarioId, tokenPush);
    if (!r.ok) console.warn('nativo: token não removido: ' + r.erro);
  }
}

/* ------------------------------------------------------------------ */
/* Permissão e push                                                    */
/* ------------------------------------------------------------------ */

/* Android 13+ e iOS usam a mesma permissão para push e local; pedir uma vez basta. */
async function pedirPermissao() {
  const PN = plugins.PushNotifications;
  const LN = plugins.LocalNotifications;
  const alvo = PN || LN;
  if (!alvo) return false;
  try {
    let estado = await alvo.checkPermissions();
    const chave = PN ? 'receive' : 'display';
    if (estado[chave] === 'prompt' || estado[chave] === 'prompt-with-rationale') estado = await alvo.requestPermissions();
    const ok = estado[chave] === 'granted';
    if (ok && LN && plataforma === 'android') await LN.createChannel(CANAL_ANDROID).catch(() => {});
    if (ok && PN && plataforma === 'android') await PN.createChannel(CANAL_ANDROID).catch(() => {});
    return ok;
  } catch (e) {
    console.warn('nativo: permissão de notificação: ' + mensagem(e));
    return false;
  }
}

async function registrarPush() {
  const PN = plugins.PushNotifications;
  if (!PN) return;
  try { await PN.register(); } catch (e) { console.warn('nativo: push: ' + mensagem(e)); }
}

async function guardarToken() {
  if (!tokenPush || !pessoaDoToken || !nuvem.ativa()) return;
  const r = await nuvem.salvarTokenPush(pessoaDoToken.uid || pessoaDoToken.usuarioId, tokenPush, plataforma);
  if (!r.ok) console.warn('nativo: token não guardado: ' + r.erro);
}

function rotaValida(rota) {
  const r = String(rota || '');
  return r.startsWith('#/') && r !== (opcoesApp.rotaLogin || '#/entrar');
}

function abrirRota(rota) {
  if (!rotaValida(rota) || !dados.sessao.usuario()) return;
  ui.irPara(String(rota));
}

function ligarOuvintesDePush() {
  const PN = plugins.PushNotifications;
  if (!PN) return;
  PN.addListener('registration', (token) => {
    tokenPush = token && token.value ? String(token.value) : '';
    guardarToken().catch((e) => console.warn('nativo: ' + mensagem(e)));
  }).catch(() => {});
  PN.addListener('registrationError', (erro) => {
    console.warn('nativo: registro do push falhou: ' + String((erro && erro.error) || ''));
  }).catch(() => {});
  /* Com o app aberto o sistema não mostra o push (Android) ou mostra por cima (iOS, presentationOptions);
     nos dois casos a pessoa vê o toast, com o botão para ir à rota. */
  PN.addListener('pushNotificationReceived', (n) => {
    const d = (n && n.data) || {};
    const titulo = String((n && n.title) || d.titulo || 'Green Agenda');
    const texto = String((n && n.body) || d.texto || '');
    const rota = String(d.link || '');
    const msg = texto ? titulo + ': ' + texto : titulo;
    if (rotaValida(rota)) ui.toastAcao(msg, { rotulo: 'Abrir', aoClicar: () => abrirRota(rota), ms: 7000 });
    else ui.toast(msg, 'info', 6000);
  }).catch(() => {});
  PN.addListener('pushNotificationActionPerformed', (acao) => {
    const n = (acao && acao.notification) || {};
    const d = n.data || {};
    abrirRota(d.link || '');
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Lembretes locais de véspera                                         */
/* ------------------------------------------------------------------ */

/* Inteiro positivo de 31 bits a partir do id do agendamento (djb2). */
function idNumerico(texto) {
  let h = 5381;
  const s = String(texto || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647 || 1;
}

function quandoDoServico(a) {
  if (a.periodo === 'manha') return 'de manhã';
  if (a.periodo === 'tarde') return 'à tarde';
  if (a.periodo === 'dia') return 'o dia todo';
  if (a.horaInicio) return (a.horaAproximada ? 'por volta das ' : 'às ') + String(a.horaInicio);
  return '';
}

function textoDoLembrete(a) {
  const partes = [];
  const quando = quandoDoServico(a);
  if (quando) partes.push(quando);
  const cliente = dados.nomeDoCliente(a);
  if (cliente) partes.push(cliente);
  const local = dados.localDe(a);
  if (local) partes.push(local);
  return partes.join(', ') || 'Confira os detalhes no app.';
}

/** Os serviços da pessoa logada que ganham lembrete: amanhã até DIAS_A_FRENTE, status ativo, ela como responsável. */
export function servicosComLembrete(usuario, hojeISO) {
  const u = usuario || dados.sessao.usuario();
  if (!u) return [];
  const hoje = hojeISO || util.hojeISO();
  return dados.agendamentosEntre(util.addDias(hoje, 1), util.addDias(hoje, DIAS_A_FRENTE))
    .filter((a) => Array.isArray(a.responsaveis) && a.responsaveis.includes(u.id) && dados.STATUS_ATIVOS.includes(a.status))
    .slice(0, MAXIMO_LEMBRETES);
}

function lembreteDe(a) {
  const quando = util.msDe(util.addDias(a.data, -1), HORA_VESPERA);
  if (quando <= Date.now()) return null;
  return {
    id: idNumerico(a.id),
    title: 'Amanhã: ' + String(dados.nomeDoServico(a)),
    body: textoDoLembrete(a),
    schedule: { at: new Date(quando), allowWhileIdle: true },
    isExactNotification: false,
    channelId: CANAL_ANDROID.id,
    extra: { origem: ORIGEM_LEMBRETE, servicoId: String(a.id), rota: '#/servico/' + String(a.id), quando }
  };
}

function agendarReagendamento() {
  clearTimeout(timerReagendar);
  timerReagendar = setTimeout(() => {
    reagendarLembretes().catch((e) => console.warn('nativo: lembretes: ' + mensagem(e)));
  }, ESPERA_REAGENDAR_MS);
}

function aoAlterarDados(ev) {
  const colecoes = (ev && ev.detail && Array.isArray(ev.detail.colecoes)) ? ev.detail.colecoes : [];
  if (colecoes.includes('agendamentos') || colecoes.includes('tipos') || colecoes.includes('clientes')) agendarReagendamento();
}

/**
 * Refaz os lembretes de véspera: cancela os que este módulo agendou e agenda de novo o conjunto atual.
 * Chamadas simultâneas são enfileiradas numa só.
 * @returns {Promise<{agendados:number, cancelados:number}>}
 */
export async function reagendarLembretes() {
  const LN = plugins && plugins.LocalNotifications;
  if (!LN) return { agendados: 0, cancelados: 0 };
  if (reagendando) { reagendarDeNovo = true; return { agendados: 0, cancelados: 0 }; }
  reagendando = true;
  let cancelados = 0;
  let agendados = 0;
  try {
    const pendentes = await LN.getPending();
    const nossos = ((pendentes && pendentes.notifications) || []).filter((n) => n.extra && n.extra.origem === ORIGEM_LEMBRETE);
    if (nossos.length) {
      await LN.cancel({ notifications: nossos.map((n) => ({ id: n.id })) });
      cancelados = nossos.length;
    }
    const u = dados.sessao.usuario();
    if (u) {
      const lista = servicosComLembrete(u).map(lembreteDe).filter(Boolean);
      if (lista.length) {
        await LN.schedule({ notifications: lista });
        agendados = lista.length;
      }
    }
  } finally {
    reagendando = false;
    if (reagendarDeNovo) { reagendarDeNovo = false; agendarReagendamento(); }
  }
  return { agendados, cancelados };
}

function ligarOuvintesLocais() {
  const LN = plugins.LocalNotifications;
  if (!LN) return;
  LN.addListener('localNotificationActionPerformed', (acao) => {
    const n = (acao && acao.notification) || {};
    const extra = n.extra || {};
    if (extra.servicoId && !dados.agendamentoPorId(String(extra.servicoId))) { abrirRota('#/hoje'); return; }
    abrirRota(extra.rota || '#/hoje');
  }).catch(() => {});
}
