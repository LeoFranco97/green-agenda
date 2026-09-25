/* Green Agenda, módulo app: src/app.js
   Ponto de entrada: boot na ordem da seção 14.2, tela de login, sessão na
   interface, tela inicial por perfil, conexão (online, offline, faixa de
   estado), relógio de 60 s, tema inicial, PWA (registro do service worker,
   beforeinstallprompt), registro de todas as telas e eventos globais.
   Referência no v1 (app/index.html): TELAS.login 1730 a 1762, fazerLogin
   1791 a 1815, entrarComo 1816 a 1823, sairDaConta 1824 a 1829,
   alternarConexao 1865, iniciarPWA 5228 a 5254, iniciarApp 5739 a 5758.
   Ver ESPECIFICACAO.md, seções 3.3, 3.4, 5.3, 13 e 14.

   Convenções internas deste módulo:
   - O app nunca toca localStorage: sessão, prefs e aparelho vêm de dados.
   - A guarda de rotas é a única que decide redirecionamento por sessão e
     capacidade; as telas ainda checam capacidade antes de gravar.
   - O relógio re-renderiza só telas que declararam relogio: true e nunca
     enquanto há sheet aberta, campo em edição ou formulário na camada. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as ui from './ui.js';
import { icone } from './icones.js';
import { logoMarca } from './logo.js';
import * as agenda from './agenda.js';
import * as agendamento from './agendamento.js';
import * as recursos from './recursos.js';
import { atualizarLinhaAgora } from './grade.js';

const { esc } = util;
const $ = (seletor) => document.querySelector(seletor);

/** Versão mostrada em Conta e usada no título do documento. */
export const VERSAO_APP = '1.0';

const NOME_APP = 'Green Agenda';
const ROTA_LOGIN = '#/entrar';
/* Telas em que a pessoa está preenchendo alguma coisa: o relógio de 60 s não
   re-renderiza nenhuma delas, senão o chip escolhido, o horário marcado e o
   texto meio digitado somem debaixo da mão.
   #/registrar entrou em 22/09/2026 (DIRECAO-2 8.1 e lote 4, item 4): é a única
   porta de criação, e é onde a pessoa passa mais tempo de pé, com o teclado
   aberto. #/agendar e #/agendar/:tipo continuam na lista porque ainda
   respondem, redirecionando para cá, e uma re-renderização no meio do
   redirecionamento é exatamente o que não pode acontecer. */
const ROTAS_FORMULARIO = ['#/registrar', '#/agendar', '#/agendar/:tipo', '#/servico/novo', '#/servico/:id/editar', '#/servico/:id/reagendar'];
const INTERVALO_RELOGIO_MS = 60000;
const DEBOUNCE_RERENDER_MS = 60;
const MENSAGEM_SEM_ACESSO = 'Você não tem acesso a essa tela';

/* Estado do módulo */
let promptInstalacao = null;
let destinoAposLogin = null;
let rerenderTimer = null;
let rerenderPendente = false;
let ultimoOnline = null;
let bootConcluido = false;
const relogioPorRota = new Map();

/* ================================================================== */
/* Boot (14.2)                                                         */
/* ================================================================== */

/**
 * Boot (14.2): tema, repo.iniciar, registro de telas, conexão, sessão, roteador, PWA, relógio, eventos globais.
 * @returns {Promise<void>} Quem chama: este próprio arquivo, ao final.
 */
export async function iniciar() {
  ui.tema.iniciar();
  await dados.repo.iniciar();

  agenda.registrarTelasAgenda();
  agendamento.registrarTelasServico();
  recursos.registrarTelasRecursos();
  registrarTelasApp();

  iniciarConexao();
  iniciarEventosGlobais();

  const usuario = dados.sessao.restaurar();
  ui.montarNav(usuario);
  prepararRotaInicial(usuario);

  ui.iniciarRoteador({
    antesDeCada: guardaDeRota,
    telaInicial: () => rotaInicialDaSessao()
  });

  iniciarPWA();
  iniciarRelogio();
  bootConcluido = true;
  iniciarNativo();
}

/* ================================================================== */
/* App nativo (Capacitor)                                              */
/* ================================================================== */

function ehNativo() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

/**
 * Dentro do app Android ou iOS, carrega src/nativo.js (barra de status, splash, botão voltar, push e lembretes)
 * depois da primeira tela montada. No navegador comum não importa nada e nada muda.
 * @returns {void}
 */
function iniciarNativo() {
  if (!ehNativo() || iniciarNativo.chamado) return;
  iniciarNativo.chamado = true;
  import('./nativo.js')
    .then((nativo) => nativo.iniciar({
      telaInicial: () => telaInicialPara(dados.sessao.usuario(), window.innerWidth),
      rotaLogin: ROTA_LOGIN
    }))
    .catch((erro) => console.error('nativo: ' + String(erro && erro.message ? erro.message : erro)));
}

/** Registra as rotas próprias do app: login sem casca. */
function registrarTelasApp() {
  ui.registrarRota(ROTA_LOGIN, { render: telaLogin, titulo: 'Entrar', semCasca: true });
}

/** Sem sessão vai para o login guardando a rota pedida; com sessão e sem hash vai para a tela inicial. */
function prepararRotaInicial(usuario) {
  const hash = hashAtual();
  if (!usuario) {
    if (!ehRotaLogin(hash)) ui.irPara(rotaLoginCom(hash), { substituir: true });
    return;
  }
  if (!hash || ehRotaLogin(hash)) ui.irPara(telaInicialPara(usuario, window.innerWidth), { substituir: true });
}

function rotaInicialDaSessao() {
  const u = dados.sessao.usuario();
  return u ? telaInicialPara(u, window.innerWidth) : ROTA_LOGIN;
}

/* ================================================================== */
/* Utilidades de rota                                                  */
/* ================================================================== */

function hashAtual() {
  const h = location.hash || '';
  return h.length > 1 ? h : '';
}

function ehRotaLogin(hash) {
  const caminho = String(hash || '').split('?')[0];
  return caminho === ROTA_LOGIN;
}

/** Rota de login com ?depois= apontando para a rota pedida (quando faz sentido guardar). */
function rotaLoginCom(depois) {
  const alvo = destinoValido(depois) ? depois : '';
  return ROTA_LOGIN + ui.montarQuery({ depois: alvo });
}

/** Só aceita rotas internas por hash e nunca o próprio login. */
function destinoValido(rota) {
  const r = String(rota || '');
  return r.startsWith('#/') && !ehRotaLogin(r);
}

/* ================================================================== */
/* Tela inicial por perfil (3.3)                                       */
/* ================================================================== */

/**
 * Tela inicial de todo perfil (DIRECAO-2 4.1 e 8.2): #/hoje, o feed do dia.
 * A agenda real da empresa é um grupo de conversa, e quem abre o app está
 * fazendo o que fazia no grupo: ver o que está acontecendo hoje, e só depois
 * registrar. Serviços agendados continua sendo a lista dos outros dias, e
 * #/registrar é o destino do botão primário, do FAB e do atalho N, os três por
 * ui.rotaRegistrar. Enquanto #/hoje não estiver registrada, o recuo é o
 * endereço anterior, que redireciona para cá de qualquer forma.
 * @param {object} usuario @param {number} [largura] sem uso, mantido pela assinatura @returns {string} rota
 */
export function telaInicialPara(usuario, largura) {
  if (ui.rotaRegistrada('#/hoje')) return '#/hoje';
  return ui.rotaRegistrada('#/meu-dia') ? '#/meu-dia' : '#/servicos/proximos';
}

/* ================================================================== */
/* Guarda de rotas (3.4)                                               */
/* ================================================================== */

/** Guarda de rotas (3.4): sessão, capacidades e restrições do perfil campo. @param {{rota:string, params:object, query:object, tela:object}} destino @returns {string|null} rota de redirecionamento ou null */
export function guardaDeRota(destino) {
  const d = destino || {};
  const tela = d.tela || {};
  relogioPorRota.set(d.rota, !!tela.relogio);

  const usuario = dados.sessao.usuario();
  if (d.rota === ROTA_LOGIN) return usuario ? telaInicialPara(usuario, window.innerWidth) : null;
  if (!usuario) return rotaLoginCom(hashAtual());

  /* Modos da Agenda vedados ao campo voltam para Dia sem alarde (3.3). */
  const paraDia = redirecionamentoDoPerfilCampo(d, usuario);
  if (paraDia) return paraDia;

  const semAcesso = faltaCapacidade(tela, usuario) || faltaRegraEspecial(d, usuario);
  if (semAcesso) {
    ui.toast(MENSAGEM_SEM_ACESSO, 'erro');
    return telaInicialPara(usuario, window.innerWidth);
  }
  return null;
}

/** Toda capacidade listada em tela.requer precisa estar no perfil. */
function faltaCapacidade(tela, usuario) {
  const requer = Array.isArray(tela.requer) ? tela.requer : [];
  return requer.some((cap) => !dados.pode(cap, usuario));
}

/** Regras que a tabela de rotas exige além do requer genérico. */
function faltaRegraEspecial(destino, usuario) {
  const rota = destino.rota;
  if (rota === '#/cadastros') return !dados.pode('cadastros', usuario) && !dados.pode('usuarios', usuario);
  if (rota.startsWith('#/cadastros/')) return !dados.pode('cadastros', usuario) && !dados.pode('usuarios', usuario);
  if (ehFormularioDeRecurso(rota)) return dados.pode('editarRecursos', usuario) !== true;
  return false;
}

/** Formulários de veículo e equipe: editarRecursos pleno (supervisor só marca indisponibilidade). */
function ehFormularioDeRecurso(rota) {
  return /^#\/recursos\/(veiculos|equipes)\/(novo|:id\/editar)$/.test(rota);
}

/** Perfil campo só vê Dia e Semana na Agenda (3.3); o resto volta para Dia. */
function redirecionamentoDoPerfilCampo(destino, usuario) {
  if (usuario.perfil !== 'campo') return null;
  const params = destino.params || {};
  const data = util.dataValida(params.data) ? params.data : util.hojeISO();
  if (destino.rota === '#/agenda/recursos/:data/:eixo') return '#/agenda/dia/' + data;
  if (destino.rota === '#/agenda/:modo/:data' && !['dia', 'semana'].includes(params.modo)) return '#/agenda/dia/' + data;
  return null;
}

/* ================================================================== */
/* Login (11.7)                                                        */
/* ================================================================== */

/* Conta pré-preenchida na tela de entrar, para demonstração. No modo nuvem
   (src/config-nuvem.js com ativo: true) os campos nascem vazios sozinhos:
   lá as contas são reais, do Firebase Auth. */
const CONTA_DEMO = dados.nuvemAtiva() ? { email: '', senha: '' } : { email: 'monica@greendecor.com.br', senha: 'demo123' };

function htmlLateralLogin() {
  return '<aside class="login-lateral" aria-hidden="true">' +
      '<div class="login-logo">' + logoMarca(180) + '</div>' +
      '<p class="login-frase">Agenda de operação</p>' +
      '<p class="login-lateral-rodape">Green Decor, Grupo Green. Itapema, Santa Catarina.</p>' +
    '</aside>';
}

function htmlCampoEmail() {
  return '<div class="campo">' +
      '<label class="campo-rotulo" for="login-email">Email</label>' +
      '<input class="entrada" id="login-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="nome@greendecor.com.br" value="' + esc(CONTA_DEMO.email) + '" required>' +
    '</div>';
}

function htmlCampoSenha() {
  return '<div class="campo">' +
      '<label class="campo-rotulo" for="login-senha">Senha</label>' +
      '<div class="campo-senha">' +
        '<input class="entrada" id="login-senha" name="senha" type="password" autocomplete="current-password" placeholder="Sua senha" value="' + esc(CONTA_DEMO.senha) + '" required>' +
        '<button type="button" class="btn-icone" data-acao="alternar-senha" aria-label="Mostrar senha" aria-pressed="false">' + icone('olho', 22) + '</button>' +
      '</div>' +
    '</div>';
}

/* Seletor de conta (modo local, demonstração): as pessoas ativas do seed agrupadas por perfil. Um toque preenche
   email e senha e entra. Em modo nuvem dados.contasDemo() vem vazia e o bloco não existe. */
const GRUPOS_CONTA = [
  { id: 'gestao', titulo: 'Direção e gestão', perfis: ['admin', 'diretor', 'gerente', 'supervisor'] },
  { id: 'vendas', titulo: 'Vendas e atendimento', perfis: ['atendente'] },
  { id: 'financeiro', titulo: 'Financeiro', perfis: ['financeiro'] },
  { id: 'campo', titulo: 'Campo', perfis: ['campo'] }
];
const CONTAS_COM_BUSCA = 8;

function htmlLinhaConta(conta) {
  const u = conta.usuario;
  const cargo = u.cargo || '';
  return '<button type="button" class="login-conta" data-acao="entrar-como" data-email="' + esc(u.email) + '" data-busca="' + esc(util.normalizar(u.nome + ' ' + cargo)) + '" aria-label="Entrar como ' + esc(u.nome) + (cargo ? ', ' + esc(cargo) : '') + '">' +
      ui.avatar(u) +
      '<span class="login-conta-corpo"><span class="login-conta-nome">' + esc(u.nome) + '</span><span class="login-conta-cargo">' + esc(cargo) + '</span></span>' +
      ui.chip(dados.rotuloPerfil(u.perfil), 'chip-pq login-conta-perfil') +
    '</button>';
}

function htmlContasDemo() {
  const contas = dados.contasDemo();
  if (!contas.length) return '';
  const grupos = GRUPOS_CONTA.map((g) => ({ g, contas: contas.filter((c) => g.perfis.includes(c.usuario.perfil)) })).filter((x) => x.contas.length);
  const outros = contas.filter((c) => !GRUPOS_CONTA.some((g) => g.perfis.includes(c.usuario.perfil)));
  if (outros.length) grupos.push({ g: { id: 'outros', titulo: 'Outros' }, contas: outros });
  return '<section class="login-contas" aria-labelledby="login-contas-titulo">' +
      '<h2 class="login-contas-titulo" id="login-contas-titulo">Ou entre como</h2>' +
      '<p class="login-contas-sub">Demonstração: um toque preenche email e senha e entra.</p>' +
      (contas.length > CONTAS_COM_BUSCA
        ? '<div class="busca login-contas-busca">' + icone('busca', 18) + '<input class="entrada" type="search" id="login-contas-busca" placeholder="Buscar pessoa" aria-label="Buscar pessoa" autocomplete="off" autocorrect="off" spellcheck="false"></div>'
        : '') +
      '<div class="login-contas-lista">' +
        grupos.map((x) => '<div class="login-contas-grupo" data-grupo="' + esc(x.g.id) + '"><h3 class="login-contas-grupo-titulo">' + esc(x.g.titulo) + '</h3>' + x.contas.map(htmlLinhaConta).join('') + '</div>').join('') +
        '<p class="login-contas-vazio" hidden>Ninguém com esse nome.</p>' +
      '</div>' +
    '</section>';
}

function filtrarContas(raiz, texto) {
  const alvo = util.normalizar(String(texto || '').trim()).replace(/\s+/g, ' ');
  let visiveis = 0;
  raiz.querySelectorAll('.login-contas-grupo').forEach((grupo) => {
    let noGrupo = 0;
    grupo.querySelectorAll('.login-conta').forEach((botao) => {
      const casa = !alvo || String(botao.getAttribute('data-busca') || '').includes(alvo);
      botao.hidden = !casa;
      if (casa) noGrupo++;
    });
    grupo.hidden = !noGrupo;
    visiveis += noGrupo;
  });
  const vazio = raiz.querySelector('.login-contas-vazio');
  if (vazio) vazio.hidden = visiveis > 0;
}

/** Um toque numa pessoa da lista: preenche o formulário com a conta dela e submete. */
function entrarComo(raiz, botao, depois) {
  const email = String(botao.getAttribute('data-email') || '').toLowerCase();
  const conta = dados.contasDemo().find((c) => String(c.usuario.email || '').toLowerCase() === email);
  const form = raiz.querySelector('form.login-form');
  if (!conta || !form) return;
  const campoEmail = form.querySelector('#login-email');
  const campoSenha = form.querySelector('#login-senha');
  if (campoEmail) campoEmail.value = conta.usuario.email;
  if (campoSenha) campoSenha.value = conta.senha;
  submeterLogin(raiz, form, depois);
}

function htmlFormularioLogin() {
  return '<form class="login-form" novalidate aria-labelledby="login-titulo">' +
      '<div class="login-logo">' + logoMarca(120) + '</div>' +
      '<h1 class="login-titulo" id="login-titulo">' + esc(NOME_APP) + '</h1>' +
      '<p class="login-sub">Entre com o seu email da Green Decor.</p>' +
      '<div class="login-erro" id="login-erro" role="alert" aria-live="assertive"></div>' +
      htmlCampoEmail() +
      htmlCampoSenha() +
      '<div class="login-opcoes">' +
        '<label class="marcar"><input type="checkbox" id="login-lembrar" name="lembrar" checked>' +
          '<span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span><span>Lembrar neste aparelho</span></label>' +
        /* Só a nuvem manda email de redefinição; no modo local a senha é trocada em Cadastros, Pessoas. */
        (dados.nuvemAtiva() ? '<button type="button" class="btn btn-fantasma btn-pq" data-acao="esqueci-senha">Esqueci a senha</button>' : '') +
      '</div>' +
      '<button type="submit" class="btn btn-primario btn-grande btn-cheio" data-acao="entrar">Entrar</button>' +
      '<p class="login-rodape">Acesso restrito à equipe da Green Decor. Cada entrada fica registrada na auditoria.</p>' +
    '</form>';
}

/** Tela #/entrar (11.7), sem casca. @param {{params:object, query:{depois?:string}, alvo:HTMLElement, usuario:object|null}} ctx */
export function telaLogin(ctx) {
  const alvo = ctx.alvo;
  const depois = destinoValido(ctx.query && ctx.query.depois) ? ctx.query.depois : null;
  if (alvo && alvo.id === 'conteudo') alvo.classList.add('sem-margem', 'sem-margem-base');
  document.title = 'Entrar, ' + NOME_APP;

  ui.renderizar(alvo, '<div class="login">' + htmlLateralLogin() + '<div class="login-principal">' + htmlFormularioLogin() + htmlContasDemo() + '</div></div>', (raiz) => {
    ui.delegar(raiz, '[data-acao="alternar-senha"]', 'click', (acao, botao) => alternarSenha(raiz, botao));
    ui.delegar(raiz, '[data-acao="entrar-como"]', 'click', (acao, botao) => entrarComo(raiz, botao, depois));
    const busca = raiz.querySelector('#login-contas-busca');
    if (busca) busca.addEventListener('input', () => filtrarContas(raiz, busca.value));
    ui.delegar(raiz, '[data-acao="esqueci-senha"]', 'click', () => esqueciSenha(raiz));
    ui.delegar(raiz, 'form.login-form', 'submit', (acao, form, ev) => {
      ev.preventDefault();
      submeterLogin(raiz, form, depois);
    });
    const email = raiz.querySelector('#login-email');
    if (email) requestAnimationFrame(() => { try { email.focus({ preventScroll: true }); } catch (e) { /* ignora */ } });
  });
}

function alternarSenha(raiz, botao) {
  const campo = raiz.querySelector('#login-senha');
  if (!campo) return;
  const mostrar = campo.type === 'password';
  campo.type = mostrar ? 'text' : 'password';
  botao.innerHTML = icone(mostrar ? 'olhooff' : 'olho', 22);
  botao.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
  botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  campo.focus();
}

/** "Esqueci a senha" (modo nuvem): manda o email de redefinição para o endereço digitado. A resposta é a mesma exista a conta ou não. */
async function esqueciSenha(raiz) {
  const campo = raiz.querySelector('#login-email');
  const email = String((campo || {}).value || '').trim().toLowerCase();
  mostrarErroLogin(raiz, '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    mostrarErroLogin(raiz, 'Digite o seu email para receber o link de redefinição.');
    if (campo) campo.focus();
    return;
  }
  const botao = raiz.querySelector('[data-acao="esqueci-senha"]');
  if (botao) botao.disabled = true;
  let r;
  try {
    r = await dados.sessao.redefinirSenha(email);
  } catch (erro) {
    r = { ok: false, erro: 'Não foi possível pedir a redefinição agora. Tente de novo.' };
  }
  if (botao && document.contains(botao)) botao.disabled = false;
  if (r && r.ok) ui.toast('Se existir uma conta com esse email, o link para redefinir a senha já foi enviado.', 'info', 5000);
  else mostrarErroLogin(raiz, (r && r.erro) || 'Não foi possível pedir a redefinição agora.');
}

function mostrarErroLogin(raiz, mensagem) {
  const caixa = raiz.querySelector('#login-erro');
  if (!caixa) return;
  caixa.innerHTML = mensagem ? icone('alerta', 18) + '<span>' + esc(mensagem) + '</span>' : '';
  raiz.querySelectorAll('#login-email, #login-senha').forEach((el) => {
    if (mensagem) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  });
  if (mensagem) ui.anunciar(mensagem);
}

function definirOcupado(raiz, ocupado) {
  const botao = raiz.querySelector('[data-acao="entrar"]');
  if (!botao) return;
  botao.disabled = !!ocupado;
  botao.setAttribute('aria-busy', ocupado ? 'true' : 'false');
  botao.innerHTML = ocupado ? icone('sincronizar', 18, 'girando') + '<span>Entrando</span>' : 'Entrar';
}

async function submeterLogin(raiz, form, depois) {
  const email = String((form.querySelector('#login-email') || {}).value || '').trim().toLowerCase();
  const senha = String((form.querySelector('#login-senha') || {}).value || '');
  const lembrar = !!(form.querySelector('#login-lembrar') || {}).checked;
  mostrarErroLogin(raiz, '');
  if (!email || !senha) {
    mostrarErroLogin(raiz, 'Preencha email e senha para continuar.');
    (email ? form.querySelector('#login-senha') : form.querySelector('#login-email')).focus();
    return;
  }
  definirOcupado(raiz, true);
  const ok = await entrar(email, senha, lembrar, depois);
  if (!ok && document.contains(raiz)) {
    definirOcupado(raiz, false);
    const campoSenha = form.querySelector('#login-senha');
    if (campoSenha) { campoSenha.value = ''; campoSenha.focus(); }
  }
}

/**
 * Submete o login: chama dados.sessao.entrar, mostra erro inline, monta a nav e navega para `depois` ou para a tela inicial.
 * @param {string} email @param {string} senha @param {boolean} lembrar @param {string|null} depois @returns {Promise<boolean>}
 */
export async function entrar(email, senha, lembrar, depois) {
  destinoAposLogin = destinoValido(depois) ? depois : null;
  let resultado;
  try {
    resultado = await dados.sessao.entrar(email, senha, !!lembrar);
  } catch (erro) {
    console.error('Falha ao entrar', erro);
    resultado = { ok: false, erro: 'Não foi possível entrar agora. Tente de novo.' };
  }
  if (!resultado || !resultado.ok) {
    destinoAposLogin = null;
    const raiz = $('#conteudo');
    if (raiz && raiz.querySelector('.login')) mostrarErroLogin(raiz, (resultado && resultado.erro) || 'Email ou senha incorretos.');
    return false;
  }
  /* 'sessao:alterada' já montou a nav e navegou (14.2, passo 9). */
  ui.toast(saudacao() + ', ' + util.primeiroNome(resultado.usuario.nome) + '.', 'ok', 2200);
  return true;
}

function saudacao() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Confirma, chama dados.sessao.sair e vai para #/entrar. @returns {Promise<void>} */
export async function sair() {
  const usuario = dados.sessao.usuario();
  if (!usuario) { ui.irPara(ROTA_LOGIN, { substituir: true }); return; }
  const pendentes = dados.pendentesSync().length;
  const texto = pendentes
    ? pendentes + (pendentes === 1 ? ' alteração ainda aguarda' : ' alterações ainda aguardam') + ' envio. Elas ficam guardadas no aparelho.'
    : 'Você volta para a tela de entrada.';
  const ok = await ui.confirmar({ titulo: 'Sair da conta?', texto, rotuloOk: 'Sair', perigo: true });
  if (!ok) return;
  dados.sessao.sair();
}

/* ================================================================== */
/* Sessão na interface                                                 */
/* ================================================================== */

function aoAlterarSessao(ev) {
  const usuario = (ev && ev.detail && ev.detail.usuario) ? dados.sessao.usuario() : null;
  ui.montarNav(usuario);
  if (usuario) {
    const destino = destinoAposLogin || telaInicialPara(usuario, window.innerWidth);
    destinoAposLogin = null;
    ui.irPara(destino, { substituir: true });
    return;
  }
  ui.atalhos.remover(['N']);
  /* Adiado: quem chamou sair() pode já estar navegando para o login. */
  setTimeout(() => {
    if (!dados.sessao.usuario() && !ehRotaLogin(hashAtual())) ui.irPara(ROTA_LOGIN, { substituir: true });
  }, 0);
}

/* ================================================================== */
/* Conexão e faixa de estado (5.4, 9.11, 13)                           */
/* ================================================================== */

function estadoConexao(detalhe) {
  const d = detalhe || {};
  return {
    online: typeof d.online === 'boolean' ? d.online : dados.conexao.online,
    pendentes: typeof d.pendentes === 'number' ? d.pendentes : dados.pendentesSync().length,
    sincronizando: typeof d.sincronizando === 'boolean' ? d.sincronizando : !!dados.conexao.sincronizando
  };
}

function avisarMudancaDeConexao(online) {
  if (ultimoOnline === null || ultimoOnline === online) { ultimoOnline = online; return; }
  ultimoOnline = online;
  if (!bootConcluido) return;
  ui.toast(online ? 'Conexão restabelecida.' : 'Sem conexão. As alterações ficam guardadas no aparelho.', 'info', 3000);
}

/** Escuta online e offline, aplica dados.conexao.definirOnline e monta a faixa de estado a cada 'conexao:alterada'. */
export function iniciarConexao() {
  if (!iniciarConexao.ligado) {
    iniciarConexao.ligado = true;
    window.addEventListener('online', () => dados.conexao.definirOnline(true));
    window.addEventListener('offline', () => dados.conexao.definirOnline(false));
    document.addEventListener('conexao:alterada', (ev) => {
      const estado = estadoConexao(ev.detail);
      ui.montarFaixaEstado(estado);
      avisarMudancaDeConexao(estado.online);
    });
  }
  dados.conexao.definirOnline(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  ui.montarFaixaEstado(estadoConexao());
}

/* ================================================================== */
/* PWA (13)                                                            */
/* ================================================================== */

function podeRegistrarSW() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);
}

function avisarNovaVersao(registro) {
  const novo = registro.installing;
  if (!novo) return;
  novo.addEventListener('statechange', () => {
    if (novo.state === 'installed' && navigator.serviceWorker.controller) {
      ui.toast('Nova versão da Green Agenda pronta. Recarregue para atualizar.', 'info', 5000);
    }
  });
}

function registrarServiceWorker() {
  if (!podeRegistrarSW()) return;
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => { registro.addEventListener('updatefound', () => avisarNovaVersao(registro)); })
    .catch((erro) => { console.warn('Service worker não registrado', erro); });
}

/** Registra ./sw.js (só em http e https), captura beforeinstallprompt e expõe instalar() para a tela Conta. */
export function iniciarPWA() {
  if (iniciarPWA.ligado) return;
  iniciarPWA.ligado = true;
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    promptInstalacao = ev;
  });
  window.addEventListener('appinstalled', () => {
    promptInstalacao = null;
    ui.toast('Green Agenda instalada. Procure o ícone na tela inicial.');
  });
  registrarServiceWorker();
}

/** Dispara o prompt de instalação capturado, se houver. @returns {Promise<boolean>} */
export async function instalar() {
  if (!promptInstalacao) return false;
  const evento = promptInstalacao;
  try {
    evento.prompt();
    const escolha = await evento.userChoice;
    const aceitou = !!(escolha && escolha.outcome === 'accepted');
    if (aceitou) promptInstalacao = null;
    return aceitou;
  } catch (erro) {
    console.warn('Instalação não concluída', erro);
    return false;
  }
}

/* ================================================================== */
/* Relógio (14.2, passo 7)                                             */
/* ================================================================== */

function ehCampoDeEdicao(el) {
  if (!el || el.disabled || el.readOnly) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true;
}

function focoEmEdicao() {
  return ehCampoDeEdicao(document.activeElement);
}

/* Campo em edição dentro de uma tela ou painel: um rerender reescreveria o campo e derrubaria o foco. */
function focoEmCampoDeTela() {
  const el = document.activeElement;
  if (!ehCampoDeEdicao(el) || !el.closest) return false;
  return !!el.closest('#conteudo, #camada-painel');
}

function telaAtualTemRelogio() {
  const atual = ui.rotaAtual();
  if (relogioPorRota.get(atual.rota)) return true;
  return !!(atual.base && relogioPorRota.get(atual.base.rota));
}

function formularioAberto() {
  const atual = ui.rotaAtual();
  return ROTAS_FORMULARIO.includes(atual.rota);
}

function podeRerenderPeloRelogio() {
  if (!dados.sessao.usuario() || ehRotaLogin(hashAtual())) return false;
  if (ui.sheetAberto() || focoEmEdicao() || formularioAberto()) return false;
  return telaAtualTemRelogio();
}

function baterRelogio() {
  if (document.visibilityState === 'hidden') return;
  document.querySelectorAll('.grade').forEach((grade) => {
    try { atualizarLinhaAgora(grade); } catch (erro) { console.warn('Linha de agora', erro); }
  });
  if (podeRerenderPeloRelogio()) ui.rerender();
  else ui.atualizarBadges();
}

/** A cada 60 s: atualiza a linha de agora da grade visível e re-renderiza telas com relogio: true. */
export function iniciarRelogio() {
  if (iniciarRelogio.ligado) return;
  iniciarRelogio.ligado = true;
  setInterval(baterRelogio, INTERVALO_RELOGIO_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') baterRelogio();
  });
}

/* ================================================================== */
/* Eventos globais (14.2, passos 8 e 9; 14.4)                          */
/* ================================================================== */

function cancelarRerenderAgendado() {
  clearTimeout(rerenderTimer);
  rerenderTimer = null;
}

function executarRerender() {
  cancelarRerenderAgendado();
  if (!dados.sessao.usuario() || ehRotaLogin(hashAtual())) { rerenderPendente = false; return; }
  /* Sheet aberta ou pessoa digitando num campo da tela: fica pendente e volta no fechar da sheet ou no focusout. */
  if (ui.sheetAberto() || focoEmCampoDeTela()) { rerenderPendente = true; return; }
  rerenderPendente = false;
  ui.rerender();
}

/** Rerender com debounce de 60 ms; fica pendente enquanto há sheet aberta ou campo em edição na tela. */
function agendarRerender() {
  cancelarRerenderAgendado();
  rerenderTimer = setTimeout(executarRerender, DEBOUNCE_RERENDER_MS);
}

function aoAlterarDados(ev) {
  const colecoes = (ev && ev.detail && Array.isArray(ev.detail.colecoes)) ? ev.detail.colecoes : [];
  if (colecoes.includes('notificacoes') || colecoes.includes('filaSync')) ui.atualizarBadges();
  if (colecoes.includes('filaSync')) ui.montarFaixaEstado(estadoConexao());
  agendarRerender();
}

function aoFecharSheet() {
  if (rerenderPendente) agendarRerender();
}

/* O foco saiu de um campo: se havia rerender adiado, tenta de novo (executarRerender volta a adiar se o foco pousou em outro campo). */
function aoSairDeCampo(ev) {
  if (!rerenderPendente || !ehCampoDeEdicao(ev && ev.target)) return;
  agendarRerender();
}

function aoAlterarRota(ev) {
  const titulo = ev && ev.detail && ev.detail.titulo ? String(ev.detail.titulo) : '';
  document.title = titulo ? titulo + ', ' + NOME_APP : NOME_APP;
  /* A tela acabou de ser montada com dados frescos: um rerender agendado seria repetição. */
  cancelarRerenderAgendado();
  rerenderPendente = false;
}

/* Nuvem (src/nuvem.js): avisos de senha e login vindos de dados.js, e erros de escuta do Firestore, um toast a cada 30 s no máximo. */
let ultimoErroNuvemTs = 0;
const INTERVALO_ERRO_NUVEM_MS = 30000;

function aoAvisoDaNuvem(ev) {
  const d = (ev && ev.detail) || {};
  if (d.mensagem) ui.toast(String(d.mensagem), d.tipo === 'erro' ? 'erro' : 'info', 5000);
}

function aoErroDaNuvem(ev) {
  const d = (ev && ev.detail) || {};
  const ts = Date.now();
  if (ts - ultimoErroNuvemTs < INTERVALO_ERRO_NUVEM_MS) return;
  ultimoErroNuvemTs = ts;
  ui.toast('Nuvem: ' + (d.mensagem || 'falha na sincronização') + (d.colecao ? ' (' + d.colecao + ')' : ''), 'erro', 5000);
}

/* Toque numa notificação push (sw.js manda { tipo: 'abrir-rota', rota }): a aba já aberta navega para a rota. */
function aoMensagemDoServiceWorker(ev) {
  const d = (ev && ev.data) || {};
  if (d.tipo !== 'abrir-rota' || !destinoValido(d.rota)) return;
  if (dados.sessao.usuario()) ui.irPara(d.rota);
}

/** Liga 'dados:alterado' (rerender com debounce, adiado com sheet aberta ou campo em edição), 'sessao:alterada', 'ui:sheet-fechado', 'focusout' (retoma rerender adiado), 'rota:alterada' (título do documento), 'nuvem:aviso' e 'nuvem:erro' (toasts) e a mensagem do service worker ao tocar num push. */
export function iniciarEventosGlobais() {
  if (iniciarEventosGlobais.ligado) return;
  iniciarEventosGlobais.ligado = true;
  document.addEventListener('dados:alterado', aoAlterarDados);
  document.addEventListener('sessao:alterada', aoAlterarSessao);
  document.addEventListener('ui:sheet-fechado', aoFecharSheet);
  document.addEventListener('focusout', aoSairDeCampo);
  document.addEventListener('rota:alterada', aoAlterarRota);
  document.addEventListener('nuvem:aviso', aoAvisoDaNuvem);
  document.addEventListener('nuvem:erro', aoErroDaNuvem);
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', aoMensagemDoServiceWorker);
}

/* ================================================================== */
/* Falha de boot                                                       */
/* ================================================================== */

function mostrarFalhaDeBoot(erro) {
  const conteudo = $('#conteudo');
  if (!conteudo) return;
  const mensagem = String(erro && erro.message ? erro.message : erro);
  conteudo.innerHTML =
    '<div class="vazio">' +
      '<div class="vazio-icone">' + icone('alerta', 28) + '</div>' +
      '<p class="vazio-titulo">Não foi possível abrir a Green Agenda</p>' +
      '<p class="vazio-texto">' + esc(mensagem) + '</p>' +
      '<div class="vazio-acao"><button type="button" class="btn btn-secundario" data-acao="recarregar">Tentar de novo</button></div>' +
    '</div>';
  const botao = conteudo.querySelector('[data-acao="recarregar"]');
  if (botao) botao.addEventListener('click', () => location.reload());
}

iniciar().catch((erro) => {
  mostrarFalhaDeBoot(erro);
  console.error(erro);
  /* No aparelho a splash não some sozinha (launchAutoHide: false); sem isto a tela de falha ficaria escondida. */
  iniciarNativo();
});
