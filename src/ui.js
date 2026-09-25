/* Green Agenda, módulo ui: src/ui.js
   Componentes de interface e infraestrutura de tela: toast com desfazer,
   sheet, modal, confirmar, pedir motivo, roteador por hash com camada de
   detalhe, cabeçalho, navegação (inferior e lateral), FAB, faixa de estado,
   estados vazios, avatar e chips, renderização com delegação de eventos,
   tema e densidade, atalhos de teclado, gestos (deslizar, toque longo),
   seletor de mês. Nunca importa telas.
   Referência no v1 (app/index.html): toast 1540 a 1547, abrirSheet e
   fecharSheet 1548 a 1565, abrirModal/confirmar 1566 a 1581, listener Escape
   1582 a 1584, NAV_PRINCIPAL 1589 a 1600, irPara/voltar 1601 a 1615,
   montarCabecalho 1620 a 1632, botaoNotifs 1633 a 1637, montarNav 1642 a
   1655, badgesNav 1662 a 1669, atualizarFaixaEstado 1676 a 1686, renderTela
   1690 a 1699, estadoVazio 1712 a 1714, chipStatusAgenda 1721, avatarHTML
   1723 a 1725, iniciarGestos 5256 (pull-to-refresh e swipe).
   Ver ESPECIFICACAO.md, seções 3, 11.5, 12 e 14.3 a 14.5.

   Redesenho de 18/09/2026 (docs/redesign/DIRECAO.md, lote 2): o cabeçalho virou
   uma faixa única de 56 px com acoesSecundarias (3.1) e a variante `grande`
   saiu; a navegação passou a ter os destinos da seção 3.1, com a barra lateral
   de 240 px aberta a partir de 1024 px e quatro destinos na barra inferior.

   Direção 2 de 22/09/2026 (docs/redesign/DIRECAO-2.md, lote 4): Meu dia saiu
   da navegação e Hoje ocupa o lugar dele (8.1 e 8.2); o botão primário da
   lateral e o atalho N passaram a se chamar "Registrar" e vão para
   #/registrar, a única porta de criação (3.6), inclusive para o perfil campo,
   que ganhou criarServico: 'proprios'.

   Convenções internas deste módulo:
   - Ações próprias da casca usam data-acao com prefixo "ui:" (ui:voltar,
     ui:notificacoes, ui:nav, ui:registrar, ui:agendar, ui:fechar-sheet,
     ui:fechar-modal, ui:sincronizar) e são tratadas por uma única delegação
     no document. As telas ignoram.
   - Um sheet por vez: abrir outro substitui o anterior.
   - Delegações feitas com delegar() em um elemento são removidas quando esse
     elemento é renderizado de novo por renderizar() ou montarCabecalho(). */

import * as util from './util.js';
import * as dados from './dados.js';
import { icone } from './icones.js';
import { logoMarca } from './logo.js';

const { esc } = util;
const $ = (seletor) => document.querySelector(seletor);

const LARGURA_CAMADA = 1200;
/** Ponto de corte do desktop em px; abaixo disso a interface é a de celular ou tablet. */
export const LARGURA_DESKTOP = 1024;
/** Largura atual é de desktop. @returns {boolean} */
export const ehDesktop = () => window.innerWidth >= LARGURA_DESKTOP;
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let contadorIds = 0;
const novoId = (prefixo) => prefixo + '-' + (++contadorIds);

const emitir = (nome, detail) => document.dispatchEvent(new CustomEvent(nome, { detail: detail || {} }));

/* ================================================================== */
/* Delegação de eventos e renderização                                 */
/* ================================================================== */

const delegacoesPorRaiz = new WeakMap();

/**
 * Delegação de eventos. O handler recebe (valor de data-acao, elemento que casou, evento).
 * @param {HTMLElement} raiz @param {string} seletor ex. '[data-acao]' @param {string} evento @param {(acao:string, el:HTMLElement, ev:Event)=>void} handler
 * @returns {() => void} remover
 */
export function delegar(raiz, seletor, evento, handler) {
  if (!raiz) return () => {};
  const ouvinte = (ev) => {
    const origem = ev.target instanceof Element ? ev.target : null;
    if (!origem) return;
    const el = origem.closest(seletor);
    if (!el || !raiz.contains(el)) return;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;
    handler(el.getAttribute('data-acao') || '', el, ev);
  };
  raiz.addEventListener(evento, ouvinte);
  const remover = () => raiz.removeEventListener(evento, ouvinte);
  if (!delegacoesPorRaiz.has(raiz)) delegacoesPorRaiz.set(raiz, []);
  delegacoesPorRaiz.get(raiz).push(remover);
  return remover;
}

function limparDelegacoes(raiz) {
  const lista = delegacoesPorRaiz.get(raiz);
  if (!lista) return;
  lista.forEach((remover) => remover());
  delegacoesPorRaiz.set(raiz, []);
}

let rerenderizando = false;

/**
 * Substitui o innerHTML do alvo e chama aoMontar(alvo).
 * @param {HTMLElement} alvo @param {string} html @param {(alvo:HTMLElement)=>void} [aoMontar] @param {{manterRolagem?:boolean}} [opcoes]
 */
export function renderizar(alvo, html, aoMontar, opcoes = {}) {
  if (!alvo) return;
  const manter = opcoes.manterRolagem != null ? !!opcoes.manterRolagem : rerenderizando;
  const rolagem = alvo.scrollTop;
  limparDelegacoes(alvo);
  alvo.innerHTML = html == null ? '' : String(html);
  alvo.scrollTop = manter ? rolagem : 0;
  if (typeof aoMontar === 'function') aoMontar(alvo);
}

/* ================================================================== */
/* Toasts e anúncios                                                   */
/* ================================================================== */

const TOASTS_MAX = 2;
let desfazerPendente = null;

/** Escreve em #anuncios (aria-live) para leitores de tela. @param {string} texto */
export function anunciar(texto) {
  const el = $('#anuncios');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = String(texto || ''); }, 30);
}

function inserirToast(el) {
  const caixa = $('#toasts');
  if (!caixa) return;
  while (caixa.children.length >= TOASTS_MAX) {
    const antigo = caixa.firstElementChild;
    if (antigo && antigo.__desfazer) antigo.__desfazer.confirmar();
    else if (antigo) antigo.remove();
  }
  caixa.appendChild(el);
}

function removerToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('saindo');
  setTimeout(() => el.remove(), 200);
}

/**
 * Toast simples (máximo 2 empilhados; o terceiro substitui o mais antigo). Também chama anunciar(msg).
 * @param {string} msg @param {'ok'|'erro'|'info'} [tipo='ok'] @param {number} [ms=2600]
 * @returns {void} Quem chama: todos.
 */
export function toast(msg, tipo = 'ok', ms = 2600) {
  const t = ['ok', 'erro', 'info'].includes(tipo) ? tipo : 'ok';
  const ic = t === 'erro' ? 'alerta' : t === 'info' ? 'info' : 'check';
  const el = document.createElement('div');
  el.className = 'toast toast-' + t;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = icone(ic, 20) + '<span class="toast-texto">' + esc(msg) + '</span>';
  inserirToast(el);
  anunciar(msg);
  setTimeout(() => removerToast(el), ms);
}

/**
 * Toast com um botão de ação que não desfaz nada (ex.: "Avisar cliente" depois de reagendar, DIRECAO 4.9).
 * @param {string} msg @param {{rotulo:string, aoClicar:()=>void, ms?:number}} opcoes @returns {void}
 */
export function toastAcao(msg, opcoes) {
  const op = opcoes || {};
  const el = document.createElement('div');
  el.className = 'toast toast-ok toast-acao';
  el.innerHTML = icone('check', 20) + '<span class="toast-texto" aria-hidden="true">' + esc(msg) + '</span>' +
    '<button type="button" class="btn btn-fantasma btn-pq" data-acao="ui:toast-extra">' + esc(op.rotulo || 'Abrir') + '</button>';
  el.querySelector('button').addEventListener('click', () => { removerToast(el); if (typeof op.aoClicar === 'function') op.aoClicar(); });
  inserirToast(el);
  anunciar(msg);
  setTimeout(() => removerToast(el), op.ms || 8000);
}

/**
 * Toast com botão "Desfazer" (6.2). aoConfirmar roda quando a janela expira sem desfazer,
 * ou imediatamente em pagehide, ou quando outro toastDesfazer é aberto; aoDesfazer roda no clique.
 * @param {string} msg @param {{ms?:number, aoDesfazer:()=>void, aoConfirmar?:()=>void}} opcoes
 * @returns {{fechar:()=>void}}
 */
export function toastDesfazer(msg, opcoes) {
  const op = opcoes || {};
  if (desfazerPendente) desfazerPendente.confirmar();
  const el = document.createElement('div');
  el.className = 'toast toast-ok toast-acao';
  /* Sem role="status": a mensagem já sai por #anuncios. O texto fica oculto ao leitor
     para não ler duas vezes; o botão permanece exposto com nome completo (WCAG 4.1.2). */
  el.innerHTML = icone('check', 20) + '<span class="toast-texto" aria-hidden="true">' + esc(msg) + '</span>' +
    (op.extra && op.extra.rotulo ? '<button type="button" class="btn btn-fantasma btn-pq" data-acao="ui:toast-extra">' + esc(op.extra.rotulo) + '</button>' : '') +
    '<button type="button" class="btn btn-fantasma btn-pq" data-acao="ui:desfazer" aria-label="Desfazer: ' + esc(msg) + '">Desfazer</button>';
  let encerrado = false;
  const controle = {
    confirmar() {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      if (desfazerPendente === controle) desfazerPendente = null;
      removerToast(el);
      if (typeof op.aoConfirmar === 'function') op.aoConfirmar();
    },
    desfazer() {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      if (desfazerPendente === controle) desfazerPendente = null;
      removerToast(el);
      if (typeof op.aoDesfazer === 'function') op.aoDesfazer();
      anunciar('Desfeito');
    }
  };
  el.__desfazer = controle;
  el.querySelector('[data-acao="ui:desfazer"]').addEventListener('click', controle.desfazer);
  /* Ação extra (ex.: "Avisar cliente" depois de cancelar): vale como confirmar, e só então roda. */
  const botaoExtra = el.querySelector('[data-acao="ui:toast-extra"]');
  if (botaoExtra) botaoExtra.addEventListener('click', () => { controle.confirmar(); if (typeof op.extra.aoClicar === 'function') op.extra.aoClicar(); });
  const timer = setTimeout(controle.confirmar, op.ms || 5000);
  desfazerPendente = controle;
  inserirToast(el);
  anunciar(msg + '. Desfazer disponível.');
  return { fechar: controle.confirmar };
}

/* ================================================================== */
/* Sheet                                                               */
/* ================================================================== */

let sheetAtual = null;
let sheetTimerLimpeza = null;

function primeiroFocavel(raiz) {
  const lista = Array.from(raiz.querySelectorAll(FOCAVEIS)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  return lista[0] || null;
}

function prenderTab(raiz, ev) {
  const lista = Array.from(raiz.querySelectorAll(FOCAVEIS)).filter((el) => el.offsetParent !== null);
  if (!lista.length) { ev.preventDefault(); raiz.focus(); return; }
  const primeiro = lista[0];
  const ultimo = lista[lista.length - 1];
  if (ev.shiftKey && (document.activeElement === primeiro || !raiz.contains(document.activeElement))) {
    ev.preventDefault(); ultimo.focus();
  } else if (!ev.shiftKey && document.activeElement === ultimo) {
    ev.preventDefault(); primeiro.focus();
  }
}

function focarDentro(raiz) {
  requestAnimationFrame(() => {
    const corpo = raiz.querySelector('.sheet-corpo, .modal-corpo');
    const rodape = raiz.querySelector('.sheet-rodape, .modal-acoes');
    const alvo = (corpo && primeiroFocavel(corpo)) || (rodape && primeiroFocavel(rodape)) || raiz;
    try { alvo.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
  });
}

function devolverFoco(el) {
  if (el && typeof el.focus === 'function' && document.contains(el)) {
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignora */ }
  }
}

/**
 * Abre a folha inferior (diálogo central no desktop pelo CSS). role=dialog, foco preso, Esc fecha, devolve o foco ao fechar.
 * @param {{titulo:string, corpo:string, rodape?:string, aoFechar?:()=>void, classe?:string}} opcoes
 * @returns {{el:HTMLElement, fechar:()=>void}} el é .sheet-painel, para ligar eventos com delegar()
 */
export function abrirSheet(opcoes) {
  const op = opcoes || {};
  const camada = $('#camada-sheet');
  if (!camada) return { el: document.createElement('div'), fechar() {} };
  if (sheetAtual) encerrarSheet(sheetAtual, { imediato: true });
  clearTimeout(sheetTimerLimpeza);
  const idTitulo = novoId('sheet-titulo');
  camada.innerHTML =
    '<div class="sheet' + (op.classe ? ' ' + esc(op.classe) : '') + '">' +
      '<div class="sheet-fundo" data-acao="ui:fechar-sheet"></div>' +
      '<div class="sheet-painel" role="dialog" aria-modal="true" aria-labelledby="' + idTitulo + '" tabindex="-1">' +
        '<div class="sheet-alca" aria-hidden="true"></div>' +
        '<div class="sheet-cab"><h2 class="sheet-titulo" id="' + idTitulo + '">' + esc(op.titulo || '') + '</h2>' +
          '<button type="button" class="btn-icone" data-acao="ui:fechar-sheet" aria-label="Fechar">' + icone('x', 22) + '</button></div>' +
        '<div class="sheet-corpo">' + (op.corpo || '') + '</div>' +
        (op.rodape ? '<div class="sheet-rodape">' + op.rodape + '</div>' : '') +
      '</div>' +
    '</div>';
  camada.hidden = false;
  const painel = camada.querySelector('.sheet-painel');
  const registro = { el: painel, aoFechar: op.aoFechar, focoAnterior: document.activeElement, fechado: false };
  sheetAtual = registro;
  focarDentro(painel);
  return { el: painel, fechar: () => { if (sheetAtual === registro) fecharSheet(); } };
}

function encerrarSheet(registro, opcoes = {}) {
  if (!registro || registro.fechado) return;
  registro.fechado = true;
  const camada = $('#camada-sheet');
  const raiz = camada ? camada.querySelector('.sheet') : null;
  if (sheetAtual === registro) sheetAtual = null;
  const limpar = () => { if (!sheetAtual && camada) { camada.innerHTML = ''; camada.hidden = true; } };
  if (opcoes.imediato || !raiz) limpar();
  else { raiz.classList.add('saindo'); sheetTimerLimpeza = setTimeout(limpar, 190); }
  if (typeof registro.aoFechar === 'function') registro.aoFechar();
  devolverFoco(registro.focoAnterior);
  emitir('ui:sheet-fechado', {});
}

/** Fecha a sheet aberta, se houver; emite 'ui:sheet-fechado'. */
export function fecharSheet() {
  if (sheetAtual) encerrarSheet(sheetAtual);
}

/** @returns {boolean} */
export function sheetAberto() {
  return !!sheetAtual;
}

/* ================================================================== */
/* Modal e confirmações                                                */
/* ================================================================== */

let modalAtual = null;

/** Modal central (role alertdialog). @param {{titulo:string, corpo:string, rodape?:string}} opcoes @returns {{el:HTMLElement, fechar:()=>void}} */
export function abrirModal(opcoes) {
  const op = opcoes || {};
  const camada = $('#camada-modal');
  if (!camada) return { el: document.createElement('div'), fechar() {} };
  if (modalAtual) fecharModal();
  const idTitulo = novoId('modal-titulo');
  camada.innerHTML =
    '<div class="modal">' +
      '<div class="modal-fundo" data-acao="ui:fechar-modal"></div>' +
      '<div class="modal-caixa" role="alertdialog" aria-modal="true" aria-labelledby="' + idTitulo + '" tabindex="-1">' +
        '<h2 class="modal-titulo" id="' + idTitulo + '">' + esc(op.titulo || '') + '</h2>' +
        '<div class="modal-corpo">' + (op.corpo || '') + '</div>' +
        (op.rodape ? '<div class="modal-acoes">' + op.rodape + '</div>' : '') +
      '</div>' +
    '</div>';
  camada.hidden = false;
  const caixa = camada.querySelector('.modal-caixa');
  const registro = { el: caixa, focoAnterior: document.activeElement, aoFechar: op.aoFechar };
  modalAtual = registro;
  focarDentro(caixa);
  return { el: caixa, fechar: () => { if (modalAtual === registro) fecharModal(); } };
}

/** Fecha o modal aberto. */
export function fecharModal() {
  const registro = modalAtual;
  if (!registro) return;
  modalAtual = null;
  const camada = $('#camada-modal');
  if (camada) { camada.innerHTML = ''; camada.hidden = true; }
  if (typeof registro.aoFechar === 'function') registro.aoFechar();
  devolverFoco(registro.focoAnterior);
}

/**
 * Confirmação em modal.
 * @param {{titulo:string, texto:string, rotuloOk?:string, rotuloCancelar?:string, perigo?:boolean, digitar?:string}} opcoes digitar exige que o usuário digite o texto (ex. 'LIMPAR') para habilitar OK
 * @returns {Promise<boolean>}
 */
export function confirmar(opcoes) {
  const op = opcoes || {};
  return new Promise((resolver) => {
    let decidido = false;
    const idCampo = novoId('confirmar-digitar');
    const corpo = '<p class="modal-texto">' + esc(op.texto || '') + '</p>' +
      (op.digitar
        ? '<div class="campo"><label class="campo-rotulo" for="' + idCampo + '">Digite <strong>' + esc(op.digitar) + '</strong> para confirmar</label>' +
          '<input class="entrada" id="' + idCampo + '" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>'
        : '');
    const rodape =
      '<button type="button" class="btn btn-fantasma" data-acao="ui:modal-cancelar">' + esc(op.rotuloCancelar || 'Voltar') + '</button>' +
      '<button type="button" class="btn ' + (op.perigo ? 'btn-perigo' : 'btn-primario') + '" data-acao="ui:modal-ok"' + (op.digitar ? ' disabled' : '') + '>' + esc(op.rotuloOk || 'Confirmar') + '</button>';
    const { el, fechar } = abrirModal({
      titulo: op.titulo || 'Confirmar',
      corpo,
      rodape,
      aoFechar: () => { if (!decidido) { decidido = true; resolver(false); } }
    });
    const botaoOk = el.querySelector('[data-acao="ui:modal-ok"]');
    if (op.digitar) {
      const campo = el.querySelector('#' + idCampo);
      campo.addEventListener('input', () => { botaoOk.disabled = campo.value.trim() !== op.digitar; });
      campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !botaoOk.disabled) botaoOk.click(); });
    }
    delegar(el, '[data-acao]', 'click', (acao) => {
      if (acao === 'ui:modal-ok') { decidido = true; fechar(); resolver(true); }
      else if (acao === 'ui:modal-cancelar') { decidido = true; fechar(); resolver(false); }
    });
  });
}

function chipsOpcoes(lista, nomeGrupo) {
  return '<div class="chips-escolha" role="group" aria-label="' + esc(nomeGrupo) + '">' +
    (lista || []).map((o) =>
      '<button type="button" class="chip chip-escolha" data-acao="escolher-opcao" data-valor="' + esc(o.id) + '" aria-pressed="false">' + esc(o.rotulo) + '</button>'
    ).join('') + '</div>';
}

/**
 * Sheet de motivo: chips de opções mais texto (obrigatório em 'outro' ou quando textoObrigatorio).
 * @param {{titulo:string, opcoes:{id:string, rotulo:string}[], rotuloOk:string, perigo?:boolean, textoObrigatorio?:boolean, ajuda?:string}} opcoes
 * @returns {Promise<{opcao:string, texto:string}|null>} null se cancelou
 */
export function pedirMotivo(opcoes) {
  const op = opcoes || {};
  return new Promise((resolver) => {
    let decidido = false;
    let escolhida = '';
    const idTexto = novoId('motivo-texto');
    const idErro = novoId('motivo-erro');
    const corpo =
      '<div class="campo"><span class="campo-rotulo">Motivo</span>' + chipsOpcoes(op.opcoes, 'Motivo') +
        '<p class="msg-erro-campo" id="' + idErro + '" hidden></p></div>' +
      '<div class="campo"><label class="campo-rotulo" for="' + idTexto + '">Detalhes' +
        (op.textoObrigatorio ? '' : ' <span class="opcional">(obrigatório em Outro)</span>') + '</label>' +
        '<textarea class="areatexto" id="' + idTexto + '" rows="3" placeholder="Escreva em uma linha o que aconteceu"></textarea>' +
        (op.ajuda ? '<p class="campo-ajuda">' + esc(op.ajuda) + '</p>' : '') + '</div>';
    const rodape =
      '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn ' + (op.perigo ? 'btn-perigo' : 'btn-primario') + '" data-acao="confirmar-motivo">' + esc(op.rotuloOk || 'Confirmar') + '</button>';
    const { el, fechar } = abrirSheet({
      titulo: op.titulo || 'Motivo',
      corpo,
      rodape,
      aoFechar: () => { if (!decidido) { decidido = true; resolver(null); } }
    });
    const erro = el.querySelector('#' + idErro);
    const area = el.querySelector('#' + idTexto);
    const mostrarErro = (msg) => { erro.textContent = msg; erro.hidden = !msg; };
    delegar(el, '[data-acao]', 'click', (acao, alvo) => {
      if (acao === 'escolher-opcao') {
        escolhida = alvo.getAttribute('data-valor') || '';
        el.querySelectorAll('[data-acao="escolher-opcao"]').forEach((c) => {
          const ativo = c === alvo;
          c.setAttribute('aria-pressed', ativo ? 'true' : 'false');
          if (ativo) c.setAttribute('data-ativo', ''); else c.removeAttribute('data-ativo');
        });
        mostrarErro('');
        if (escolhida === 'outro') area.focus();
      } else if (acao === 'confirmar-motivo') {
        const texto = area.value.trim();
        if (!escolhida) { mostrarErro('Escolha um motivo.'); return; }
        if (!texto && (escolhida === 'outro' || op.textoObrigatorio)) {
          mostrarErro('Descreva o motivo.');
          area.setAttribute('aria-invalid', 'true');
          area.focus();
          return;
        }
        decidido = true;
        fechar();
        resolver({ opcao: escolhida, texto });
      }
    });
  });
}

/** Sheet com um campo de texto. @param {{titulo:string, rotulo:string, valor?:string, obrigatorio?:boolean, multilinha?:boolean, rotuloOk?:string}} opcoes @returns {Promise<string|null>} */
export function pedirTexto(opcoes) {
  const op = opcoes || {};
  return new Promise((resolver) => {
    let decidido = false;
    const idCampo = novoId('texto');
    const idErro = novoId('texto-erro');
    const controle = op.multilinha
      ? '<textarea class="areatexto" id="' + idCampo + '" rows="3">' + esc(op.valor || '') + '</textarea>'
      : '<input class="entrada" id="' + idCampo + '" type="text" value="' + esc(op.valor || '') + '">';
    const corpo = '<div class="campo"><label class="campo-rotulo" for="' + idCampo + '">' + esc(op.rotulo || 'Texto') + '</label>' + controle +
      '<p class="msg-erro-campo" id="' + idErro + '" hidden>Preencha este campo.</p></div>';
    const rodape =
      '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="confirmar-texto">' + esc(op.rotuloOk || 'Salvar') + '</button>';
    const { el, fechar } = abrirSheet({
      titulo: op.titulo || 'Texto',
      corpo,
      rodape,
      aoFechar: () => { if (!decidido) { decidido = true; resolver(null); } }
    });
    const campoEl = el.querySelector('#' + idCampo);
    const erro = el.querySelector('#' + idErro);
    const confirmarTexto = () => {
      const valor = campoEl.value.trim();
      if (op.obrigatorio && !valor) { erro.hidden = false; campoEl.setAttribute('aria-invalid', 'true'); campoEl.focus(); return; }
      decidido = true;
      fechar();
      resolver(valor);
    };
    campoEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !op.multilinha) { ev.preventDefault(); confirmarTexto(); } });
    delegar(el, '[data-acao="confirmar-texto"]', 'click', confirmarTexto);
  });
}

/* ================================================================== */
/* Roteador                                                            */
/* ================================================================== */

const rotas = [];
let ordemRegistro = 0;
let roteadorConfig = null;
let estadoRota = null;      /* {rota, hash, params, query, tela} da rota corrente (camada ou base) */
let estadoBase = null;      /* mesma forma; só quando a camada está aberta */
let camadaAberta = false;
let alvoAtual = null;       /* elemento onde a tela corrente está sendo renderizada */
let pilhaHashes = [];
let navUsuario = null;
let faixaLargura = null;
const focoPorHash = new Map(); /* hash da tela deixada -> {el, seletor} do controle que disparou a navegação */
const FOCO_MAX = 60;
let voltando = false;          /* a próxima rota vem de voltar() ou do botão voltar do navegador */

function segmentosDe(caminho) {
  return String(caminho || '').replace(/^#/, '').split('/').filter(Boolean);
}

/**
 * Registra uma rota (14.3, 14.5). Padrões com mais segmentos literais casam antes
 * (#/servico/novo vence #/servico/:id; #/agenda/recursos/:data/:eixo vence #/agenda/:modo/:data).
 * @param {string} padrao ex. '#/agenda/:modo/:data'
 * @param {{render:(ctx:{params:object, query:object, alvo:HTMLElement, usuario:object|null})=>void, titulo?:string, camada?:boolean, requer?:string[], relogio?:boolean, semCasca?:boolean}} tela
 */
export function registrarRota(padrao, tela) {
  const segmentos = segmentosDe(padrao);
  const literais = segmentos.filter((s) => !s.startsWith(':')).length;
  const existente = rotas.findIndex((r) => r.padrao === padrao);
  const registro = { padrao, segmentos, literais, tela: tela || {}, ordem: ordemRegistro++ };
  if (existente >= 0) rotas[existente] = registro; else rotas.push(registro);
  rotas.sort((a, b) => b.literais - a.literais || b.segmentos.length - a.segmentos.length || a.ordem - b.ordem);
}

/** @param {object} obj @returns {string} '?a=1&b=2' codificado, ou '' */
export function montarQuery(obj) {
  const p = new URLSearchParams();
  Object.keys(obj || {}).forEach((chave) => {
    const v = obj[chave];
    if (v == null || v === '' || v === false) return;
    p.set(chave, String(v));
  });
  const texto = p.toString();
  return texto ? '?' + texto : '';
}

/** @param {string} texto trecho após '?' @returns {object} */
export function lerQuery(texto) {
  const saida = {};
  const limpo = String(texto || '').replace(/^\?/, '');
  if (!limpo) return saida;
  new URLSearchParams(limpo).forEach((valor, chave) => { saida[chave] = valor; });
  return saida;
}

function separarHash(hash) {
  const bruto = String(hash || '').replace(/^#/, '');
  const i = bruto.indexOf('?');
  const caminho = i >= 0 ? bruto.slice(0, i) : bruto;
  const query = i >= 0 ? bruto.slice(i + 1) : '';
  return { caminho: '#' + (caminho.startsWith('/') ? caminho : '/' + caminho), query };
}

function casar(hash) {
  const { caminho, query } = separarHash(hash);
  const segs = segmentosDe(caminho);
  for (const r of rotas) {
    if (r.segmentos.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const p = r.segmentos[i];
      if (p.startsWith(':')) {
        try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch (e) { params[p.slice(1)] = segs[i]; }
      } else if (p !== segs[i]) { ok = false; break; }
    }
    if (ok) return { rota: r.padrao, hash: caminho + (query ? '?' + query : ''), params, query: lerQuery(query), tela: r.tela };
  }
  return null;
}

/** @returns {{rota:string, params:object, query:object, base:{rota:string, params:object, query:object}|null}} */
export function rotaAtual() {
  const r = estadoRota || { rota: '', params: {}, query: {} };
  return {
    rota: r.rota,
    params: Object.assign({}, r.params),
    query: Object.assign({}, r.query),
    base: camadaAberta && estadoBase ? { rota: estadoBase.rota, params: Object.assign({}, estadoBase.params), query: Object.assign({}, estadoBase.query) } : null
  };
}

const usaCamada = (tela) => !!(tela && tela.camada) && window.innerWidth >= LARGURA_CAMADA;

function hashCorrente() {
  const h = location.hash || '';
  return h.length > 1 ? h : '';
}

/** Navega. @param {string} rota hash completo @param {{substituir?:boolean}} [opcoes] substituir usa history.replaceState */
export function irPara(rota, opcoes = {}) {
  const alvo = String(rota || '').startsWith('#') ? rota : '#' + rota;
  if (opcoes && opcoes.substituir) {
    history.replaceState(null, '', location.pathname + location.search + alvo);
    if (pilhaHashes.length) pilhaHashes[pilhaHashes.length - 1] = alvo; else pilhaHashes.push(alvo);
    tratarRota();
    return;
  }
  if (hashCorrente() === alvo) { tratarRota(); return; }
  guardarFocoOrigem();
  voltando = false;
  pilhaHashes.push(alvo);
  if (pilhaHashes.length > 60) pilhaHashes.shift();
  location.hash = alvo;
}

/* Lembra o controle em foco na tela que está sendo deixada, para devolver o foco a ele ao voltar (12). */
function guardarFocoOrigem() {
  const origem = hashCorrente();
  const el = document.activeElement;
  if (!origem || !el || el === document.body || el === document.documentElement) return;
  const attr = (v) => String(v).replace(/["\\]/g, '\\$&');
  let seletor = null;
  if (el.id) seletor = '#' + attr(el.id).replace(/([^\w-])/g, '\\$1');
  else if (el.getAttribute('data-acao')) {
    /* A tela é re-renderizada ao voltar, então o elemento morre; o seletor acha o controle equivalente. */
    seletor = '[data-acao="' + attr(el.getAttribute('data-acao')) + '"]';
    const chave = ['data-id', 'data-rota', 'data-valor', 'data-campo', 'data-data'].find((a) => el.getAttribute(a));
    if (chave) seletor += '[' + chave + '="' + attr(el.getAttribute(chave)) + '"]';
  }
  focoPorHash.delete(origem);
  focoPorHash.set(origem, { el, seletor });
  while (focoPorHash.size > FOCO_MAX) focoPorHash.delete(focoPorHash.keys().next().value);
}

/* Depois de renderizar uma rota nova: foco no controle de origem (ao voltar) ou na tela, e anúncio do título. */
function posicionarFoco(destino) {
  const alvo = camadaAberta ? $('#camada-painel .painel-corpo') : $('#conteudo');
  const guardado = voltando ? focoPorHash.get(destino.hash) : null;
  voltando = false;
  if (guardado) focoPorHash.delete(destino.hash);
  const ativo = document.activeElement;
  const jaNaTela = !!(ativo && ativo !== document.body && alvo && ativo !== alvo && alvo.contains(ativo));
  if (!jaNaTela) {
    let el = guardado && guardado.el && document.contains(guardado.el) ? guardado.el : null;
    if (!el && guardado && guardado.seletor) {
      try { el = document.querySelector(guardado.seletor); } catch (e) { el = null; }
    }
    if (el && el.closest('[hidden]')) el = null;
    devolverFoco(el || alvo);
  }
  anunciar(destino.tela && destino.tela.titulo ? destino.tela.titulo : '');
}

/** Fecha a camada se aberta; senão history.back(); sem histórico, vai para a tela inicial informada em iniciarRoteador. */
export function voltar() {
  if (sheetAtual) fecharSheet();
  if (modalAtual) fecharModal();
  voltando = true;
  if (camadaAberta && estadoBase) {
    const anterior = pilhaHashes.length > 1 ? pilhaHashes[pilhaHashes.length - 2] : null;
    if (anterior && anterior === estadoBase.hash) { history.back(); return; }
    irPara(estadoBase.hash, { substituir: true });
    return;
  }
  if (pilhaHashes.length > 1) { history.back(); return; }
  const inicial = roteadorConfig && roteadorConfig.telaInicial ? roteadorConfig.telaInicial() : '#/';
  irPara(inicial || '#/', { substituir: true });
}

let ultimoHashTratado = null;

function aoMudarHash() {
  const atual = hashCorrente();
  const topo = pilhaHashes[pilhaHashes.length - 1];
  if (topo !== atual) {
    if (pilhaHashes.length > 1 && pilhaHashes[pilhaHashes.length - 2] === atual) { pilhaHashes.pop(); voltando = true; }
    else pilhaHashes.push(atual);
  }
  if (atual === ultimoHashTratado) return;
  tratarRota();
}

/* Resolve a rota de base seguindo os redirecionamentos da guarda (até 5). */
function resolverRota(hashInicial) {
  let hash = hashInicial;
  for (let i = 0; i < 5; i++) {
    const d = casar(hash);
    if (!d) return null;
    const r = typeof roteadorConfig.antesDeCada === 'function'
      ? roteadorConfig.antesDeCada({ rota: d.rota, params: d.params, query: d.query, tela: d.tela })
      : null;
    if (!r || r === hash) return d;
    hash = r;
  }
  return null;
}

function prepararConteudo() {
  const conteudo = $('#conteudo');
  if (conteudo) conteudo.className = '';
  esconderFab();
  return conteudo;
}

function abrirCamada() {
  const painel = $('#camada-painel');
  if (!painel) return null;
  if (!camadaAberta || !painel.querySelector('.painel-corpo')) {
    painel.innerHTML = '<div id="cabecalho-painel"></div><div class="painel-lateral painel-corpo" tabindex="-1"></div>';
  }
  painel.hidden = false;
  camadaAberta = true;
  return painel.querySelector('.painel-corpo');
}

function fecharCamada() {
  const painel = $('#camada-painel');
  if (painel) { limparDelegacoes(painel); painel.innerHTML = ''; painel.hidden = true; }
  camadaAberta = false;
  estadoBase = null;
}

function executarRender(destino, alvo, usuario) {
  const anterior = alvoAtual;
  alvoAtual = alvo;
  try {
    if (destino.tela && typeof destino.tela.render === 'function') {
      destino.tela.render({ params: destino.params, query: destino.query, alvo, usuario });
    }
  } catch (erro) {
    console.error('Erro ao renderizar ' + destino.rota, erro);
    renderizar(alvo, estadoVazio({ icone: 'alerta', titulo: 'Não foi possível abrir esta tela', texto: String(erro && erro.message ? erro.message : erro) }));
  } finally {
    alvoAtual = anterior;
  }
}

function aplicarCasca(destino) {
  const semCasca = !!(destino.tela && destino.tela.semCasca);
  const navInferior = $('#nav-inferior');
  const navLateral = $('#nav-lateral');
  const cabecalho = $('#cabecalho');
  if (semCasca) {
    if (navInferior) navInferior.hidden = true;
    if (navLateral) navLateral.hidden = true;
    if (cabecalho) { limparDelegacoes(cabecalho); cabecalho.innerHTML = ''; }
    esconderFab();
  } else if (navUsuario) {
    if (navInferior) navInferior.hidden = false;
    if (navLateral) navLateral.hidden = false;
  }
}

function marcarNavAtual() {
  const atual = estadoBase && camadaAberta ? estadoBase : estadoRota;
  /* O hash real (não o padrão da rota) distingue #/agenda/lista das outras visões. */
  let chave = chaveNavDe(atual ? (atual.hash || atual.rota) : '');
  /* Perfil campo não tem Calendário na barra: a agenda dele é o destino de Serviços. */
  if (chave === 'agenda' && ehPerfilCampo(navUsuario)) chave = 'servicos';
  document.querySelectorAll('#nav-inferior .nav-item, #nav-lateral .nav-item').forEach((el) => {
    if (el.getAttribute('data-chave') === chave) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

function chaveNavDe(rota) {
  const r = String(rota || '');
  /* Hoje ocupou o lugar de Meu dia (DIRECAO-2 4.6): #/meu-dia ainda responde, redirecionando, e marca o mesmo item. */
  if (r.startsWith('#/hoje') || r.startsWith('#/meu-dia')) return 'hoje';
  if (r.startsWith('#/servicos') || r.startsWith('#/servico')) return 'servicos';
  /* #/registrar não marca item nenhum: ele é o botão primário, não um destino da lista. */
  /* A lista antiga da agenda continua marcando Serviços, que é onde ela virou tela própria. */
  if (r.startsWith('#/agenda/lista')) return 'servicos';
  if (r.startsWith('#/agenda/') || r === '#/agenda') return 'agenda';
  if (r.startsWith('#/disponibilidade') || r.startsWith('#/cadastros/horarios')) return 'disponibilidade';
  if (r.startsWith('#/cadastros/tipos')) return 'tipos';
  if (r.startsWith('#/recursos')) return 'recursos';
  if (r.startsWith('#/notificacoes')) return 'notificacoes';
  if (r.startsWith('#/auditoria')) return 'auditoria';
  if (r.startsWith('#/cadastros')) return 'cadastros';
  if (r.startsWith('#/conta') || r.startsWith('#/sincronizacao')) return 'conta';
  return '';
}

let redirecionamentos = 0;

function tratarRota() {
  if (!roteadorConfig) return;
  const hash = hashCorrente();
  const inicial = () => (roteadorConfig.telaInicial ? roteadorConfig.telaInicial() : '#/') || '#/';
  if (!hash) { irPara(inicial(), { substituir: true }); return; }
  const destino = casar(hash);
  if (!destino) {
    if (redirecionamentos++ > 5) { console.warn('Rota desconhecida sem tela inicial válida: ' + hash); redirecionamentos = 0; return; }
    irPara(inicial(), { substituir: true });
    return;
  }
  const redirecionar = typeof roteadorConfig.antesDeCada === 'function'
    ? roteadorConfig.antesDeCada({ rota: destino.rota, params: destino.params, query: destino.query, tela: destino.tela })
    : null;
  if (redirecionar && redirecionar !== hash) {
    if (redirecionamentos++ > 5) { console.warn('Laço de redirecionamento em ' + hash); redirecionamentos = 0; return; }
    irPara(redirecionar, { substituir: true });
    return;
  }
  redirecionamentos = 0;
  if (sheetAtual) fecharSheet();
  if (modalAtual) fecharModal();
  const novaTela = hash !== ultimoHashTratado;
  const usuario = dados.sessao.usuario();
  aplicarCasca(destino);

  if (usaCamada(destino.tela)) {
    if (!camadaAberta || !estadoBase) {
      /* A base é a tela que já está em #conteudo; sem ela (recarga direta), a tela inicial. */
      let base = estadoRota && !usaCamada(estadoRota.tela) ? estadoRota : null;
      if (!base) {
        base = resolverRota(inicial());
        if (base) {
          const conteudo = prepararConteudo();
          if (conteudo) executarRender(base, conteudo, usuario);
        }
      }
      estadoBase = base;
    }
    const corpo = abrirCamada();
    if (corpo) { corpo.scrollTop = 0; executarRender(destino, corpo, usuario); }
    estadoRota = destino;
  } else {
    const mesmaBase = camadaAberta && estadoBase && estadoBase.hash === destino.hash;
    if (camadaAberta) fecharCamada();
    if (!mesmaBase) {
      const conteudo = prepararConteudo();
      if (conteudo) executarRender(destino, conteudo, usuario);
    }
    /* A tela redirecionou de dentro do próprio render (#/agenda/lista/:data vira
       #/servicos/periodo): a rota de dentro já tratou tudo, inclusive o título. */
    if (hashCorrente() !== hash) return;
    estadoRota = destino;
  }
  ultimoHashTratado = hash;
  marcarNavAtual();
  atualizarBadges();
  if (novaTela) posicionarFoco(destino);
  else voltando = false;
  emitir('rota:alterada', { rota: destino.rota, params: destino.params, query: destino.query, titulo: destino.tela.titulo || '' });
}

/** Abre url em nova aba; avisa em toast quando o navegador bloqueia. @param {string} url */
export function abrirJanela(url) {
  const w = window.open(url, '_blank', 'noopener');
  if (!w) toast('O navegador bloqueou a abertura. Permita janelas para este site.', 'erro');
}

function larguraFaixa() {
  const l = window.innerWidth;
  return l >= LARGURA_CAMADA ? 'camada' : l >= LARGURA_DESKTOP ? 'desktop' : 'movel';
}

/**
 * Liga hashchange, aplica a guarda e renderiza a rota atual.
 * @param {{antesDeCada:(rota:{rota:string, params:object, query:object, tela:object})=>string|null, telaInicial:()=>string}} opcoes antesDeCada devolve uma rota de redirecionamento ou null
 */
export function iniciarRoteador(opcoes) {
  roteadorConfig = opcoes || {};
  if (!iniciarRoteador.ligado) {
    iniciarRoteador.ligado = true;
    window.addEventListener('hashchange', aoMudarHash);
    faixaLargura = larguraFaixa();
    window.addEventListener('resize', util.debounce(() => {
      const nova = larguraFaixa();
      if (nova === faixaLargura) return;
      faixaLargura = nova;
      if (navUsuario) montarNav(navUsuario);
      tratarRota();
    }, 150));
  }
  const atual = hashCorrente();
  pilhaHashes = atual ? [atual] : [];
  tratarRota();
}

/** Re-renderiza a rota atual (base e camada) preservando a rolagem. Quem chama: app (dados:alterado, relógio). */
export function rerender() {
  if (!estadoRota) return;
  const usuario = dados.sessao.usuario();
  rerenderizando = true;
  try {
    if (camadaAberta && estadoBase) {
      const conteudo = $('#conteudo');
      if (conteudo) executarRender(estadoBase, conteudo, usuario);
      const corpo = $('#camada-painel .painel-corpo');
      if (corpo) executarRender(estadoRota, corpo, usuario);
    } else {
      const conteudo = $('#conteudo');
      if (conteudo) executarRender(estadoRota, conteudo, usuario);
    }
  } finally {
    rerenderizando = false;
  }
  marcarNavAtual();
  atualizarBadges();
}

/* ================================================================== */
/* Casca: cabeçalho, navegação, badges, faixa de estado, FAB           */
/* ================================================================== */

function contenedorCabecalho() {
  if (alvoAtual && alvoAtual.closest && alvoAtual.closest('#camada-painel')) {
    return $('#camada-painel #cabecalho-painel');
  }
  return $('#cabecalho');
}

function botaoSino() {
  const u = dados.sessao.usuario();
  const n = u ? dados.naoLidas(u.id) : 0;
  const rotulo = 'Notificações' + (n ? ', ' + n + (n === 1 ? ' não lida' : ' não lidas') : '');
  return '<button type="button" class="btn-icone" data-acao="ui:notificacoes" aria-label="' + esc(rotulo) + '">' +
    icone('sino', 22) + '<span class="badge" data-badge="sino">' + (n ? (n > 9 ? '9+' : n) : '') + '</span></button>';
}

/**
 * Monta #cabecalho como a faixa única de 56 px da seção 3.1 da DIRECAO.md:
 * título à esquerda, controles da tela no meio, ações à direita.
 * acoes é HTML de botões (.btn-icone com aria-label) e inclui o sino por padrão.
 * acoesSecundarias é HTML dos controles da própria tela (seletor de visão,
 * navegação de data, "Filtros 2", "4 avisos"); ele fica colado ao título, e a
 * tela pode centralizá-lo somando a classe .cab-secundarias-centro ao que passar.
 * @param {{titulo:string, subtitulo?:string, voltar?:boolean, acoes?:string, acoesSecundarias?:string, semSino?:boolean, compacto?:boolean, extra?:string}} opcoes
 * @returns {HTMLElement|null} o elemento do cabeçalho, para ligar eventos com delegar()
 *
 * A variante `grande` saiu no redesenho de 18/09/2026: o título de tela tem um
 * tamanho só (28 px, ou 20 px quando há subtítulo, para a faixa continuar com
 * 56 px). Quem ainda passa `grande: true` não quebra, a opção é ignorada.
 * `extra` também é transitório: ele existe enquanto a Agenda empilha abas,
 * navegação de data e filtros abaixo da faixa; o lote 4 move tudo isso para
 * acoesSecundarias e então `extra` sai.
 */
export function montarCabecalho(opcoes) {
  const op = opcoes || {};
  const el = contenedorCabecalho();
  if (!el) return null;
  limparDelegacoes(el);
  const emCamada = el.id === 'cabecalho-painel';
  const sino = op.semSino || emCamada ? '' : botaoSino();
  const acoes = (op.acoes || '') + sino;
  el.innerHTML =
    '<div class="cab-tela' + (op.compacto ? ' cab-compacto' : '') + '">' +
      (op.voltar ? '<button type="button" class="btn-icone cab-voltar" data-acao="ui:voltar" aria-label="Voltar">' + icone('voltar', 24) + '</button>' : '') +
      '<div class="cab-corpo">' +
        '<h1 class="cab-titulo">' + esc(op.titulo || '') + '</h1>' +
        (op.subtitulo ? '<span class="cab-sub">' + esc(op.subtitulo) + '</span>' : '') +
      '</div>' +
      (op.acoesSecundarias ? '<div class="cab-secundarias">' + op.acoesSecundarias + '</div>' : '') +
      (acoes ? '<div class="cab-acoes">' + acoes + '</div>' : '') +
    '</div>' +
    (op.extra || '');
  return el;
}

/* Destinos da navegação (DIRECAO.md 3.1, revistos na DIRECAO-2 8.2). `rota` é
   o destino final. `alternativa` é o endereço anterior, usado só enquanto a
   rota nova não estiver registrada, para a barra nunca levar a uma tela de rota
   desconhecida. Hoje entrou no lugar de Meu dia; #/registrar não mora aqui,
   porque é o botão primário, não um destino da lista. */
const ITENS_NAV = {
  hoje: { rotulo: 'Hoje', icone: 'casa', rota: '#/hoje', alternativa: '#/meu-dia' },
  servicos: { rotulo: 'Serviços agendados', curto: 'Serviços', icone: 'lista', rota: '#/servicos/proximos', alternativa: () => '#/agenda/lista/' + util.hojeISO() },
  agenda: { rotulo: 'Calendário', icone: 'calendario', rota: '#/agenda' },
  disponibilidade: { rotulo: 'Disponibilidade', icone: 'relogio', rota: '#/disponibilidade', alternativa: () => '#/cadastros/horarios' },
  tipos: { rotulo: 'Tipos de serviço', icone: 'prancheta', rota: '#/cadastros/tipos' },
  recursos: { rotulo: 'Recursos', icone: 'caminhao', rota: '#/recursos' },
  conta: { rotulo: 'Conta', icone: 'usuario', rota: '#/conta' },
  notificacoes: { rotulo: 'Notificações', icone: 'sino', rota: '#/notificacoes' },
  auditoria: { rotulo: 'Auditoria', icone: 'historico', rota: '#/auditoria' },
  cadastros: { rotulo: 'Cadastros', icone: 'engrenagem', rota: '#/cadastros' }
};

/* A única porta de criação (DIRECAO-2 3 e 8.2): o botão primário da lateral, o
   FAB e o atalho N vão para #/registrar. O recuo para #/servico/novo continua
   valendo se a rota nova não estiver registrada, para nunca cair em tela em
   branco. */
const DESTINO_REGISTRAR = { rota: '#/registrar', alternativa: '#/servico/novo' };

/** A rota já tem tela registrada. @param {string} hash @returns {boolean} */
export function rotaRegistrada(hash) {
  return !!casar(hash);
}

function resolverDestino(rota, alternativa) {
  if (rotaRegistrada(rota)) return rota;
  const alt = typeof alternativa === 'function' ? alternativa() : alternativa;
  return alt && rotaRegistrada(alt) ? alt : rota;
}

/** Destino do "Registrar": #/registrar quando existir, senão o formulário avançado. @returns {string} */
export function rotaRegistrar() {
  return resolverDestino(DESTINO_REGISTRAR.rota, DESTINO_REGISTRAR.alternativa);
}

/** Apelido de rotaRegistrar, mantido para quem já chamava por este nome. @returns {string} */
export function rotaAgendar() {
  return rotaRegistrar();
}

/** Destino de um item da navegação, já resolvido. @param {string} chave @returns {string} */
export function rotaDeNav(chave) {
  const item = ITENS_NAV[chave];
  if (!item) return '#/';
  /* Calendário abre numa visão de grade enquanto #/servicos/:aba não existir,
     para os dois itens da barra não caírem na mesma tela. */
  if (chave === 'agenda' && !ehPerfilCampo(navUsuario) && !rotaRegistrada('#/servicos/proximos')) {
    const largura = typeof window !== 'undefined' ? window.innerWidth : 0;
    const direta = '#/agenda/' + (largura >= LARGURA_DESKTOP ? 'semana' : 'dia') + '/' + util.hojeISO();
    if (rotaRegistrada(direta)) return direta;
  }
  return resolverDestino(item.rota, item.alternativa);
}

function itemNavHTML(chave, opcoes = {}) {
  const item = ITENS_NAV[chave];
  if (!item) return '';
  const curto = !!opcoes.curto;
  const rotulo = curto && item.curto ? item.curto : item.rotulo;
  return '<button type="button" class="nav-item" data-acao="ui:nav" data-chave="' + chave + '" data-rota="' + esc(rotaDeNav(chave)) + '" aria-label="' + esc(item.rotulo) + '">' +
    icone(item.icone, curto ? 22 : 20) + '<span class="nav-rotulo">' + esc(rotulo) + '</span><span class="badge" data-badge="' + chave + '"></span></button>';
}

const ehPerfilCampo = (usuario) => !!usuario && usuario.perfil === 'campo';

/** Quatro destinos na barra inferior (DIRECAO-2 8.2); o perfil campo fica com três. */
function itensPrincipais(usuario) {
  if (ehPerfilCampo(usuario)) return ['hoje', 'servicos', 'conta'];
  return ['hoje', 'servicos', 'agenda', 'conta'];
}

/** Itens da barra lateral, na ordem da seção 8.2; Conta mora no rodapé dela. */
function itensLaterais(usuario) {
  if (ehPerfilCampo(usuario)) return ['hoje', 'servicos'];
  const lista = ['hoje', 'servicos', 'agenda'];
  if (dados.pode('cadastros', usuario)) lista.push('disponibilidade', 'tipos');
  if (dados.pode('verRecursos', usuario)) lista.push('recursos');
  return lista;
}

function itensSecundarios(usuario) {
  const lista = ['notificacoes'];
  if (dados.pode('auditoria', usuario)) lista.push('auditoria');
  if (dados.pode('cadastros', usuario) || dados.pode('usuarios', usuario)) lista.push('cadastros');
  return lista;
}

function rodapeLateralHTML(usuario) {
  return '<div class="nav-rodape">' +
      '<button type="button" class="nav-item nav-conta" data-acao="ui:nav" data-chave="conta" data-rota="' + esc(rotaDeNav('conta')) + '" aria-label="Conta de ' + esc(usuario.nome) + '">' +
        avatar(usuario, { tamanho: 'pq' }) +
        '<span class="nav-rotulo nav-usuario">' + esc(usuario.nome) + '</span>' +
        '<span class="badge" data-badge="conta"></span>' +
      '</button>' +
      '<span class="nav-conexao" data-conexao></span>' +
    '</div>';
}

/** Monta #nav-inferior e #nav-lateral conforme o perfil (3.1 e 3.2); esconde ambos sem usuário. @param {object|null} usuario */
export function montarNav(usuario) {
  navUsuario = usuario || null;
  const inferior = $('#nav-inferior');
  const lateral = $('#nav-lateral');
  if (!usuario) {
    if (inferior) { inferior.innerHTML = ''; inferior.hidden = true; }
    if (lateral) { lateral.innerHTML = ''; lateral.hidden = true; }
    return;
  }
  if (inferior) {
    inferior.innerHTML = itensPrincipais(usuario).map((chave) => itemNavHTML(chave, { curto: true })).join('');
    inferior.hidden = false;
  }
  if (lateral) {
    lateral.innerHTML =
      '<div class="nav-topo">' + logoMarca(48, 'logo-pequeno') + '</div>' +
      (dados.pode('criarServico', usuario)
        ? '<div class="nav-novo"><button type="button" class="btn btn-primario" data-acao="ui:registrar" title="Registrar (N)">' +
          icone('mais', 20) + '<span class="nav-rotulo">Registrar</span></button></div>'
        : '') +
      '<div class="nav-grupo">' + itensLaterais(usuario).map((chave) => itemNavHTML(chave)).join('') + '</div>' +
      '<div class="nav-separador" role="separator"></div>' +
      '<div class="nav-grupo">' + itensSecundarios(usuario).map((chave) => itemNavHTML(chave)).join('') + '</div>' +
      rodapeLateralHTML(usuario);
    lateral.hidden = false;
  }
  /* O atalho N (Registrar) vale em qualquer tela para quem pode criar, inclusive o perfil campo (DIRECAO-2 8.2). */
  if (dados.pode('criarServico', usuario)) atalhos.registrar({ N: { descricao: 'Registrar serviço', acao: () => irPara(rotaRegistrar()) } });
  else atalhos.remover(['N']);
  marcarNavAtual();
  atualizarBadges();
}

function textoBadge(n) {
  return n > 0 ? (n > 9 ? '9+' : String(n)) : '';
}

/** Atualiza badges do sino, da nav e o contador de fila. */
export function atualizarBadges() {
  const u = dados.sessao.usuario();
  const naoLidas = u ? dados.naoLidas(u.id) : 0;
  const pendentes = dados.pendentesSync().length;
  document.querySelectorAll('[data-badge="sino"], [data-badge="notificacoes"]').forEach((el) => { el.textContent = textoBadge(naoLidas); });
  document.querySelectorAll('[data-acao="ui:notificacoes"]').forEach((el) => {
    el.setAttribute('aria-label', 'Notificações' + (naoLidas ? ', ' + naoLidas + (naoLidas === 1 ? ' não lida' : ' não lidas') : ''));
  });
  document.querySelectorAll('#nav-inferior [data-badge="conta"], #nav-lateral [data-badge="conta"]').forEach((el) => {
    el.className = 'badge badge-neutro';
    el.textContent = textoBadge(pendentes);
  });
  document.querySelectorAll('[data-conexao]').forEach((el) => {
    const online = dados.conexao.online;
    const texto = online ? 'Online' : 'Sem conexão';
    const fila = pendentes ? ', ' + pendentes + ' na fila' : '';
    el.innerHTML = icone(online ? 'wifi' : 'wifioff', 16) + '<span class="nav-conexao-texto">' + esc(texto + fila) + '</span>';
    el.setAttribute('title', texto + fila);
  });
}

/** Monta #faixa-estado (9.11). @param {{online:boolean, pendentes:number, sincronizando?:boolean}} estado */
export function montarFaixaEstado(estado) {
  const faixa = $('#faixa-estado');
  if (!faixa) return;
  limparDelegacoes(faixa);
  const e = estado || { online: true, pendentes: 0 };
  const n = Number(e.pendentes) || 0;
  if (!e.online) {
    faixa.innerHTML = '<div class="faixa-estado faixa-estado-offline">' + icone('wifioff', 16) +
      '<span>Sem conexão.' + (n ? ' ' + util.plural(n, 'alteração guardada', 'alterações guardadas') + ' no aparelho.' : ' As alterações ficam guardadas no aparelho.') + '</span>' +
      (n ? '<button type="button" class="btn btn-fantasma" data-acao="ui:ver-fila">Ver fila</button>' : '') + '</div>';
  } else if (e.sincronizando) {
    faixa.innerHTML = '<div class="faixa-estado faixa-estado-sync">' + icone('sincronizar', 16, 'girando') +
      '<span>Sincronizando' + (n ? ' ' + util.plural(n, 'alteração', 'alterações') : '') + '</span></div>';
  } else if (n > 0) {
    faixa.innerHTML = '<div class="faixa-estado faixa-estado-sync">' + icone('sincronizar', 16) +
      '<span>' + util.plural(n, 'alteração aguardando', 'alterações aguardando') + ' envio</span>' +
      '<button type="button" class="btn btn-fantasma" data-acao="ui:sincronizar">Sincronizar</button></div>';
  } else {
    faixa.innerHTML = '';
  }
}

let fabAoClicar = null;

/** Mostra o FAB em #camada-fab. @param {{rotulo:string, icone?:string, aoClicar:()=>void}} opcoes */
export function montarFab(opcoes) {
  const camada = $('#camada-fab');
  if (!camada) return;
  const op = opcoes || {};
  fabAoClicar = typeof op.aoClicar === 'function' ? op.aoClicar : null;
  camada.innerHTML = '<button type="button" class="fab" data-acao="ui:fab" aria-label="' + esc(op.rotulo || 'Novo serviço') + '" title="' + esc(op.rotulo || 'Novo serviço') + '">' +
    icone(op.icone || 'mais', 24) + '<span class="fab-rotulo">' + esc(op.rotulo || 'Novo serviço') + '</span></button>';
}

/** Remove o FAB. */
export function esconderFab() {
  const camada = $('#camada-fab');
  if (camada) camada.innerHTML = '';
  fabAoClicar = null;
}

/* ================================================================== */
/* Componentes (devolvem HTML)                                          */
/* ================================================================== */

/** @param {{icone:string, titulo:string, texto?:string, acao?:{rotulo:string, acao:string, valor?:string}}} opcoes @returns {string} */
export function estadoVazio(opcoes) {
  const op = opcoes || {};
  return '<div class="vazio">' +
    '<div class="vazio-icone">' + icone(op.icone || 'info', 28) + '</div>' +
    '<p class="vazio-titulo">' + esc(op.titulo || '') + '</p>' +
    (op.texto ? '<p class="vazio-texto">' + esc(op.texto) + '</p>' : '') +
    (op.acao ? '<div class="vazio-acao">' + botao({ rotulo: op.acao.rotulo, acao: op.acao.acao, valor: op.acao.valor, cls: 'btn-secundario' }) + '</div>' : '') +
    '</div>';
}

/** Índice de cor do avatar (4.1): soma dos códigos do id módulo 8, mais 1. @param {string} id @returns {number} */
function indiceAvatar(id) {
  let soma = 0;
  const texto = String(id || '');
  for (let i = 0; i < texto.length; i++) soma += texto.charCodeAt(i);
  return (soma % 8) + 1;
}

/** Círculo com iniciais e classe avatar-N derivada do id (4.1). @param {object} usuario @param {{tamanho?:'pq'|'m'|'g', status?:boolean}} [opcoes] @returns {string} */
export function avatar(usuario, opcoes = {}) {
  const u = usuario || {};
  const cls = ['avatar', 'avatar-' + indiceAvatar(u.id)];
  if (opcoes.tamanho === 'pq') cls.push('avatar-pq');
  if (opcoes.tamanho === 'g') cls.push('avatar-g');
  const status = opcoes.status && u.status ? '<span class="avatar-status" data-status="' + esc(u.status) + '"></span>' : '';
  return '<span class="' + cls.join(' ') + '" aria-hidden="true" title="' + esc(u.nome || '') + '">' + esc(util.iniciais(u.nome)) + status + '</span>';
}

/** @param {string} texto @param {string} [cls] @param {string} [iconeNome] @returns {string} */
export function chip(texto, cls = '', iconeNome = '') {
  return '<span class="chip' + (cls ? ' ' + esc(cls) : '') + '">' + (iconeNome ? icone(iconeNome, 16) : '') + '<span>' + esc(texto) + '</span></span>';
}

/** Chip de status ou de atraso. @param {string} status @param {{atraso?:{minutos:number, tipo:string}|null}} [opcoes] @returns {string} */
export function chipStatus(status, opcoes = {}) {
  if (opcoes.atraso && opcoes.atraso.minutos > 0) {
    return '<span class="chip chip-status status-atrasado">' + icone('alerta', 16) + '<span>Atrasado ' + util.fmtDuracao(opcoes.atraso.minutos) + '</span></span>';
  }
  const s = dados.STATUS[status] || dados.STATUS.aguardando_conf;
  return '<span class="chip chip-status ' + esc(s.classe) + '">' + icone(s.icone, 16) + '<span>' + esc(s.rotulo) + '</span></span>';
}

/** @param {string} setorId @returns {string} */
export function chipSetor(setorId) {
  const s = dados.setorPorId(setorId);
  return '<span class="chip chip-setor setor-' + esc(s.id) + '">' + icone(s.icone, 16) + '<span>' + esc(s.nome) + '</span></span>';
}

/** Inicial no círculo com a cor do carro mais apelido. @param {object|null} veiculo @param {{pequeno?:boolean}} [opcoes] @returns {string} '' sem veículo */
export function chipCarro(veiculo, opcoes = {}) {
  if (!veiculo) return '';
  const indice = Number(veiculo.indiceCor) >= 1 && Number(veiculo.indiceCor) <= 5 ? Number(veiculo.indiceCor) : 1;
  return '<span class="chip chip-carro carro-' + indice + (opcoes.pequeno ? ' chip-pq' : '') + '" title="' + esc(veiculo.nome || veiculo.apelido || '') + '">' +
    '<span class="inicial">' + esc(String(veiculo.inicial || (veiculo.apelido || '?')[0]).toUpperCase()) + '</span>' +
    '<span>' + esc(veiculo.apelido || veiculo.nome || '') + '</span></span>';
}

/**
 * Campo de formulário com rótulo, ajuda e erro.
 * @param {{id:string, rotulo:string, tipo?:string, valor?:string, ajuda?:string, erro?:string, aviso?:string, obrigatorio?:boolean, atributos?:string, opcoes?:{valor:string, rotulo:string}[], multilinha?:boolean}} opcoes
 * @returns {string}
 */
export function campo(opcoes) {
  const op = opcoes || {};
  const id = esc(op.id || novoId('campo'));
  const descricoes = [];
  if (op.ajuda) descricoes.push(id + '-ajuda');
  if (op.aviso) descricoes.push(id + '-aviso');
  if (op.erro) descricoes.push(id + '-erro');
  const aria = (descricoes.length ? ' aria-describedby="' + descricoes.join(' ') + '"' : '') + (op.erro ? ' aria-invalid="true"' : '');
  const comuns = ' id="' + id + '" name="' + id + '"' + aria + (op.obrigatorio ? ' required' : '') + (op.atributos ? ' ' + op.atributos : '');
  let controle;
  if (Array.isArray(op.opcoes)) {
    controle = '<select class="selecao"' + comuns + '>' + op.opcoes.map((o) =>
      '<option value="' + esc(o.valor) + '"' + (String(o.valor) === String(op.valor == null ? '' : op.valor) ? ' selected' : '') + '>' + esc(o.rotulo) + '</option>'
    ).join('') + '</select>';
  } else if (op.multilinha || op.tipo === 'textarea') {
    controle = '<textarea class="areatexto"' + comuns + '>' + esc(op.valor || '') + '</textarea>';
  } else {
    controle = '<input class="entrada" type="' + esc(op.tipo || 'text') + '" value="' + esc(op.valor == null ? '' : op.valor) + '"' + comuns + '>';
  }
  return '<div class="campo' + (op.erro ? ' campo-erro' : '') + '">' +
    '<label class="campo-rotulo" for="' + id + '">' + esc(op.rotulo || '') + '</label>' +
    controle +
    (op.ajuda ? '<p class="campo-ajuda" id="' + id + '-ajuda">' + esc(op.ajuda) + '</p>' : '') +
    (op.aviso ? '<p class="campo-aviso" id="' + id + '-aviso">' + icone('alerta', 14) + '<span>' + esc(op.aviso) + '</span></p>' : '') +
    (op.erro ? '<p class="msg-erro-campo" id="' + id + '-erro">' + icone('alerta', 14) + '<span>' + esc(op.erro) + '</span></p>' : '') +
    '</div>';
}

/** @param {{rotulo:string, acao:string, valor?:string, cls?:string, icone?:string, desativado?:boolean, ariaLabel?:string}} opcoes @returns {string} */
export function botao(opcoes) {
  const op = opcoes || {};
  const cls = op.cls ? String(op.cls) : 'btn-secundario';
  const soIcone = cls.split(/\s+/).includes('btn-icone');
  return '<button type="button" class="' + (soIcone ? esc(cls) : 'btn ' + esc(cls)) + '"' +
    (op.acao ? ' data-acao="' + esc(op.acao) + '"' : '') +
    (op.valor != null ? ' data-valor="' + esc(op.valor) + '" data-id="' + esc(op.valor) + '"' : '') +
    (op.desativado ? ' disabled' : '') +
    (op.ariaLabel ? ' aria-label="' + esc(op.ariaLabel) + '"' : '') + '>' +
    (op.icone ? icone(op.icone, 18) : '') +
    (soIcone ? '' : '<span>' + esc(op.rotulo || '') + '</span>') +
    '</button>';
}

/** Barra de progresso. @param {number} feito @param {number} total @returns {string} */
export function progresso(feito, total) {
  const t = Math.max(0, Number(total) || 0);
  const f = Math.min(t, Math.max(0, Number(feito) || 0));
  const pct = t ? Math.round((f / t) * 100) : 0;
  return '<div class="progresso" role="progressbar" aria-valuemin="0" aria-valuemax="' + t + '" aria-valuenow="' + f + '" aria-label="' + f + ' de ' + t + '"' + (t && f === t ? ' data-completo' : '') + '>' +
    '<div class="progresso-barra" style="width:' + pct + '%"></div></div>';
}

/** Esqueleto de cartões. @param {number} [qtd=3] @returns {string} */
export function esqueleto(qtd = 3) {
  let html = '<div aria-hidden="true">';
  for (let i = 0; i < Math.max(1, qtd); i++) html += '<div class="esqueleto esqueleto-cartao"></div>';
  return html + '</div>';
}

/* ================================================================== */
/* Tema e densidade                                                    */
/* ================================================================== */

const consultaEscuro = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function aplicarTemaNoDocumento(nome) {
  const efetivo = nome === 'auto' ? (consultaEscuro && consultaEscuro.matches ? 'escuro' : 'claro') : nome;
  document.documentElement.setAttribute('data-tema', efetivo === 'escuro' ? 'escuro' : 'claro');
}

function aplicarDensidadeNoDocumento(nome) {
  document.documentElement.setAttribute('data-densidade', nome === 'compacta' ? 'compacta' : 'confortavel');
}

/** Tema por aparelho (11.1). Quem chama: app (boot), recursos (Conta). */
export const tema = {
  /** Aplica data-tema e data-densidade a partir de dados.aparelho() e prefers-color-scheme. */
  iniciar() {
    const ap = dados.aparelho();
    aplicarTemaNoDocumento(ap.tema || 'auto');
    aplicarDensidadeNoDocumento(ap.densidade || 'confortavel');
    if (consultaEscuro && !tema.ouvindo) {
      tema.ouvindo = true;
      const reagir = () => { if (tema.atual() === 'auto') aplicarTemaNoDocumento('auto'); };
      if (consultaEscuro.addEventListener) consultaEscuro.addEventListener('change', reagir);
      else if (consultaEscuro.addListener) consultaEscuro.addListener(reagir);
    }
  },
  /** @param {'claro'|'escuro'|'auto'} nome Efeitos: aplica e grava em aparelho. */
  aplicar(nome) {
    const valido = ['claro', 'escuro', 'auto'].includes(nome) ? nome : 'auto';
    dados.salvarAparelho({ tema: valido });
    aplicarTemaNoDocumento(valido);
  },
  /** @returns {'claro'|'escuro'|'auto'} */
  atual() {
    const t = dados.aparelho().tema;
    return ['claro', 'escuro', 'auto'].includes(t) ? t : 'auto';
  },
  /** @param {'confortavel'|'compacta'} nome */
  densidade(nome) {
    const valido = nome === 'compacta' ? 'compacta' : 'confortavel';
    dados.salvarAparelho({ densidade: valido });
    aplicarDensidadeNoDocumento(valido);
  }
};

/* ================================================================== */
/* Atalhos de teclado                                                  */
/* ================================================================== */

const mapaAtalhos = {};

function normalizarTecla(tecla) {
  const t = String(tecla || '');
  if (t.length === 1) return t.toUpperCase();
  const alias = { esc: 'Escape', escape: 'Escape', esquerda: 'ArrowLeft', direita: 'ArrowRight', cima: 'ArrowUp', baixo: 'ArrowDown' };
  return alias[t.toLowerCase()] || t;
}

function rotuloTecla(tecla) {
  const rotulos = { Escape: 'Esc', ArrowLeft: 'Seta esquerda', ArrowRight: 'Seta direita', ArrowUp: 'Seta cima', ArrowDown: 'Seta baixo' };
  return rotulos[tecla] || tecla;
}

function focoEmEdicao() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Atalhos de teclado do desktop (7.2). Quem chama: agenda, app. */
export const atalhos = {
  /** @param {Object<string, {descricao:string, acao:()=>void}>} mapa tecla para ação; ignora quando o foco está em input */
  registrar(mapa) {
    Object.keys(mapa || {}).forEach((tecla) => {
      const item = mapa[tecla];
      if (!item || typeof item.acao !== 'function') return;
      mapaAtalhos[normalizarTecla(tecla)] = { descricao: item.descricao || '', acao: item.acao };
    });
  },
  /** @param {string[]} teclas */
  remover(teclas) {
    (teclas || []).forEach((t) => { delete mapaAtalhos[normalizarTecla(t)]; });
  },
  /** Atalhos de uma tecla ligados neste aparelho (WCAG 2.1.4). @returns {boolean} */
  ativos() {
    return dados.aparelho().atalhos !== false;
  },
  /** Liga ou desliga os atalhos de uma tecla neste aparelho; Esc e Tab continuam valendo. @param {boolean} ligado */
  ativar(ligado) {
    dados.salvarAparelho({ atalhos: !!ligado });
  },
  /** @returns {{tecla:string, descricao:string}[]} */
  listar() {
    const lista = Object.keys(mapaAtalhos).map((t) => ({ tecla: rotuloTecla(t), descricao: mapaAtalhos[t].descricao }));
    lista.push({ tecla: 'Esc', descricao: 'Fechar sheet, diálogo ou painel' });
    lista.push({ tecla: '?', descricao: 'Mostrar esta lista' });
    return lista;
  },
  /** Abre a sheet com a lista de atalhos. */
  mostrar() {
    const linhas = atalhos.listar().map((a) =>
      '<kbd class="tecla">' + esc(a.tecla) + '</kbd><span>' + esc(a.descricao) + '</span>'
    ).join('');
    abrirSheet({
      titulo: 'Atalhos de teclado',
      corpo: '<div class="atalhos-lista">' + linhas + '</div><p class="campo-ajuda mt4">' +
        (atalhos.ativos() ? 'Os atalhos valem quando nenhum campo de texto está em foco.' : 'Os atalhos de uma tecla estão desligados neste aparelho. Ligue em Conta, na seção Atalhos de teclado.') + '</p>',
      rodape: '<button type="button" class="btn btn-secundario" data-acao="ui:fechar-sheet">Fechar</button>'
    });
  }
};

function aoTeclar(ev) {
  if (ev.key === 'Escape') {
    if (modalAtual) { ev.preventDefault(); fecharModal(); return; }
    if (sheetAtual) { ev.preventDefault(); fecharSheet(); return; }
    if (camadaAberta) { ev.preventDefault(); voltar(); return; }
    return;
  }
  if (ev.key === 'Tab') {
    if (modalAtual) prenderTab(modalAtual.el, ev);
    else if (sheetAtual) prenderTab(sheetAtual.el, ev);
    return;
  }
  if (!atalhos.ativos()) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (focoEmEdicao() || modalAtual || sheetAtual) return;
  if (ev.key === '?') { ev.preventDefault(); atalhos.mostrar(); return; }
  const item = mapaAtalhos[normalizarTecla(ev.key)];
  if (!item) return;
  ev.preventDefault();
  item.acao();
}

/* ================================================================== */
/* Gestos                                                              */
/* ================================================================== */

/**
 * Deslizar horizontal com limiar de 60 px e eixo x dominante; dispara ao soltar.
 * @param {HTMLElement} el @param {{aoEsquerda:()=>void, aoDireita:()=>void}} handlers @returns {() => void} remover
 */
export function gestoDeslizar(el, handlers) {
  if (!el) return () => {};
  const h = handlers || {};
  let inicio = null;
  const aoIniciar = (ev) => {
    const t = ev.touches && ev.touches[0];
    inicio = t ? { x: t.clientX, y: t.clientY, toques: ev.touches.length } : null;
  };
  const aoSoltar = (ev) => {
    if (!inicio || inicio.toques !== 1) { inicio = null; return; }
    const t = ev.changedTouches && ev.changedTouches[0];
    if (!t) { inicio = null; return; }
    const dx = t.clientX - inicio.x;
    const dy = t.clientY - inicio.y;
    inicio = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0 && typeof h.aoEsquerda === 'function') h.aoEsquerda();
    if (dx > 0 && typeof h.aoDireita === 'function') h.aoDireita();
  };
  const aoCancelar = () => { inicio = null; };
  el.addEventListener('touchstart', aoIniciar, { passive: true });
  el.addEventListener('touchend', aoSoltar, { passive: true });
  el.addEventListener('touchcancel', aoCancelar, { passive: true });
  return () => {
    el.removeEventListener('touchstart', aoIniciar);
    el.removeEventListener('touchend', aoSoltar);
    el.removeEventListener('touchcancel', aoCancelar);
  };
}

/**
 * Toque longo (450 ms) e clique com botão direito em elementos que casam o seletor.
 * @param {HTMLElement} raiz @param {string} seletor @param {(el:HTMLElement, ev:Event)=>void} handler @returns {() => void} remover
 */
export function toqueLongo(raiz, seletor, handler) {
  if (!raiz) return () => {};
  let timer = null;
  let alvo = null;
  let origem = null;
  let disparado = false;
  const cancelar = () => { clearTimeout(timer); timer = null; alvo = null; origem = null; };
  const aoIniciar = (ev) => {
    const t = ev.touches && ev.touches[0];
    const el = ev.target instanceof Element ? ev.target.closest(seletor) : null;
    if (!t || !el || !raiz.contains(el) || ev.touches.length !== 1) return;
    alvo = el;
    origem = { x: t.clientX, y: t.clientY };
    disparado = false;
    timer = setTimeout(() => {
      disparado = true;
      timer = null;
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* ignora */ } }
      handler(el, ev);
    }, 450);
  };
  const aoMover = (ev) => {
    if (!timer || !origem) return;
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - origem.x) > 10 || Math.abs(t.clientY - origem.y) > 10) cancelar();
  };
  const aoTerminar = (ev) => {
    if (disparado) { if (ev.cancelable) ev.preventDefault(); }
    cancelar();
  };
  const aoClicar = (ev) => {
    if (!disparado) return;
    ev.stopPropagation();
    ev.preventDefault();
    disparado = false;
  };
  const aoMenu = (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest(seletor) : null;
    if (!el || !raiz.contains(el)) return;
    ev.preventDefault();
    handler(el, ev);
  };
  raiz.addEventListener('touchstart', aoIniciar, { passive: true });
  raiz.addEventListener('touchmove', aoMover, { passive: true });
  raiz.addEventListener('touchend', aoTerminar);
  raiz.addEventListener('touchcancel', cancelar);
  raiz.addEventListener('click', aoClicar, true);
  raiz.addEventListener('contextmenu', aoMenu);
  return () => {
    cancelar();
    raiz.removeEventListener('touchstart', aoIniciar);
    raiz.removeEventListener('touchmove', aoMover);
    raiz.removeEventListener('touchend', aoTerminar);
    raiz.removeEventListener('touchcancel', cancelar);
    raiz.removeEventListener('click', aoClicar, true);
    raiz.removeEventListener('contextmenu', aoMenu);
  };
}

/* ================================================================== */
/* Seletor de mês                                                      */
/* ================================================================== */

function diaFechadoSimples(iso) {
  let config = null;
  try { config = dados.repo.config(); } catch (e) { config = null; }
  if (!config) return util.diaSemana(iso) === 0;
  if ((config.feriados || []).some((f) => f && f.data === iso)) return true;
  const chaves = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const h = config.horario || {};
  return !h[chaves[util.diaSemana(iso)]];
}

function gradeMesHTML(isoMes, isoEscolhido) {
  const hoje = util.hojeISO();
  const primeiro = util.inicioMes(isoMes);
  const inicio = util.inicioSemana(primeiro);
  const totalDias = util.diasNoMes(isoMes);
  const ultimo = util.addDias(primeiro, totalDias - 1);
  const semanas = Math.ceil((totalDias + (util.diaSemana(primeiro) === 0 ? 6 : util.diaSemana(primeiro) - 1)) / 7);
  const cab = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => '<div class="mes-cab" aria-hidden="true">' + d + '</div>').join('');
  let dias = '';
  for (let i = 0; i < semanas * 7; i++) {
    const iso = util.addDias(inicio, i);
    const fora = iso < primeiro || iso > ultimo;
    const d = util.dataDe(iso);
    const attrs = [
      'data-acao="escolher-dia"', 'data-valor="' + iso + '"',
      iso === hoje ? 'data-hoje' : '', iso === isoEscolhido ? 'data-ativo aria-pressed="true"' : 'aria-pressed="false"',
      diaFechadoSimples(iso) ? 'data-fechado' : '', fora ? 'tabindex="-1"' : ''
    ].filter(Boolean).join(' ');
    dias += '<button type="button" class="mes-dia' + (fora ? ' mes-fora' : '') + '" ' + attrs + ' aria-label="' + esc(util.fmtDataExtensa(iso)) + '">' +
      '<span class="mes-dia-num">' + d.getDate() + '</span></button>';
  }
  const dMes = util.dataDe(primeiro);
  return '<div class="mes-grade" role="group" aria-label="' + esc(util.MESES[dMes.getMonth()] + ' de ' + dMes.getFullYear()) + '">' + cab + dias + '</div>';
}

/**
 * Sheet com um mês navegável para pular de data.
 * @param {string} isoAtual @param {(iso:string)=>void} aoEscolher
 */
export function seletorMes(isoAtual, aoEscolher) {
  const escolhido = /^\d{4}-\d{2}-\d{2}$/.test(String(isoAtual || '')) ? isoAtual : util.hojeISO();
  let mes = util.inicioMes(escolhido);
  const rotuloMes = () => {
    const d = util.dataDe(mes);
    return util.MESES[d.getMonth()] + ' de ' + d.getFullYear();
  };
  const corpo = () =>
    '<div class="nav-datas">' +
      '<button type="button" class="btn-icone" data-acao="mes-anterior" aria-label="Mês anterior">' + icone('voltar', 22) + '</button>' +
      '<span class="nav-datas-rotulo" data-rotulo-mes aria-live="polite">' + esc(rotuloMes()) + '</span>' +
      '<button type="button" class="btn-icone" data-acao="mes-seguinte" aria-label="Mês seguinte">' + icone('direita', 22) + '</button>' +
      '<button type="button" class="btn-hoje" data-acao="escolher-dia" data-valor="' + util.hojeISO() + '">Hoje</button>' +
    '</div>' +
    '<div data-grade-mes>' + gradeMesHTML(mes, escolhido) + '</div>';
  const { el, fechar } = abrirSheet({ titulo: 'Ir para uma data', corpo: corpo() });
  const atualizar = () => {
    el.querySelector('[data-rotulo-mes]').textContent = rotuloMes();
    el.querySelector('[data-grade-mes]').innerHTML = gradeMesHTML(mes, escolhido);
  };
  delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'mes-anterior') { mes = util.addMeses(mes, -1); atualizar(); }
    else if (acao === 'mes-seguinte') { mes = util.addMeses(mes, 1); atualizar(); }
    else if (acao === 'escolher-dia') {
      const iso = alvo.getAttribute('data-valor');
      fechar();
      if (typeof aoEscolher === 'function' && iso) aoEscolher(iso);
    }
  });
  gestoDeslizar(el, {
    aoEsquerda: () => { mes = util.addMeses(mes, 1); atualizar(); },
    aoDireita: () => { mes = util.addMeses(mes, -1); atualizar(); }
  });
}

/* ================================================================== */
/* Ações globais da casca (uma delegação no document)                  */
/* ================================================================== */

function acaoGlobal(acao, el, ev) {
  switch (acao) {
    case 'ui:voltar':
      voltar();
      break;
    case 'ui:fechar-sheet':
      fecharSheet();
      break;
    case 'ui:fechar-modal':
      fecharModal();
      break;
    case 'ui:notificacoes': {
      const pedido = new CustomEvent('ui:sino', { cancelable: true, detail: { ancora: el } });
      document.dispatchEvent(pedido);
      if (!pedido.defaultPrevented) irPara('#/notificacoes');
      break;
    }
    case 'ui:nav': {
      /* A chave resolve o destino na hora do clique: se a rota nova do
         redesenho já estiver registrada, vai nela; senão, no equivalente atual. */
      const chave = el.getAttribute('data-chave');
      irPara((chave && ITENS_NAV[chave] ? rotaDeNav(chave) : el.getAttribute('data-rota')) || '#/');
      break;
    }
    case 'ui:registrar':
    case 'ui:agendar':
      irPara(rotaRegistrar());
      break;
    case 'ui:novo-servico':
      irPara('#/servico/novo');
      break;
    case 'ui:fab':
      if (fabAoClicar) fabAoClicar(ev);
      break;
    case 'ui:sincronizar':
      dados.sincronizar().then((r) => {
        if (r && r.enviadas > 0) toast(r.enviadas + (r.enviadas === 1 ? ' alteração sincronizada' : ' alterações sincronizadas'));
      });
      break;
    case 'ui:ver-fila':
      irPara('#/sincronizacao');
      break;
    default:
      break;
  }
}

function ligarGlobais() {
  if (typeof document === 'undefined' || ligarGlobais.feito) return;
  ligarGlobais.feito = true;
  document.addEventListener('click', (ev) => {
    const origem = ev.target instanceof Element ? ev.target : null;
    const el = origem ? origem.closest('[data-acao^="ui:"]') : null;
    if (!el || el.hasAttribute('disabled')) return;
    acaoGlobal(el.getAttribute('data-acao'), el, ev);
  });
  document.addEventListener('keydown', aoTeclar);
  document.addEventListener('conexao:alterada', () => atualizarBadges());
  window.addEventListener('pagehide', () => { if (desfazerPendente) desfazerPendente.confirmar(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && desfazerPendente) desfazerPendente.confirmar();
  });
}

ligarGlobais();
