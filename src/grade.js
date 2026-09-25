/* Green Agenda, módulo agenda: src/grade.js
   Componente da grade de horas, usado por Dia, Semana (desktop), Recursos e
   pela ficha do veículo. Recebe colunas, faixa e callbacks; devolve o
   elemento .grade com rolagem própria, gutter sticky, cabeçalhos sticky,
   blocos por minuto, lanes, linha de agora, hachura das horas fechadas,
   bloco fantasma no toque em vão, menu rápido por toque longo e arrasto só
   no desktop.

   Redesenho de 18/09/2026 (docs/redesign/DIRECAO.md, seção 3.3, lote 6):
   - a linha da meia hora saiu; só a hora cheia tem linha, e a meia hora vira
     respiro. A hora da calha continua como estava;
   - o almoço deixou de ser pintura decorativa: o dia tem faixas de horário
     (regras.faixasDoDia) e o vão entre duas faixas é hachurado como fechado,
     que é o que ele é;
   - teto de lanes por coluna, com o excedente colapsado em "+N": três em
     coluna larga, dois na semana e no celular com várias colunas, porque
     quatro blocos de 35 px não são legíveis em tamanho nenhum;
   - coluna única com um ou dois serviços colapsa as horas vazias em uma
     faixa "das 09:30 às 14:00, nenhum serviço" com "Agendar aqui", no lugar
     de cinco horas e meia de pauta em branco.
   Referência no v1 (app/index.html): faixaHorasDia 2896 a 2903, lanesDe
   2904 a 2919, linhasGradeHTML 2920 a 2927, gutterGradeHTML 2928 a 2934,
   agoraGradeHTML 2935 a 2940, blocosColunaHTML 2941 a 2963, tocarGrade 2964
   a 2977, scrollGradeInicial 2978 a 2988, agendaEquipeHTML 3007 a 3046 e o
   CSS tg-* nas linhas 834 a 860.
   Ver ESPECIFICACAO.md, seções 6.13, 7.3, 7.4 e 7.9.

   Convenções internas:
   - O pph é lido de getComputedStyle(.grade) (variável --pph). Como o
     elemento ainda não está no DOM quando é montado, ele é encostado no
     body, invisível, só para a medição, e retirado em seguida.
   - Todos os números de posição ficam em atributos data-* do .grade
     (data-hini, data-hfim, data-pph, data-data) para que atualizarLinhaAgora
     e rolarPara funcionem sem estado em memória.
   - Extras ao contrato, aceitos por montarGrade: `setores` (ids visíveis para
     a união de horários), `destaqueId` (bloco recém-criado), `modo`
     (data-modo no elemento), `aoClicarCabecalho(colunaId)`; e por coluna:
     `data`, `horario`, `fechado`, `hoje`, `neutra`, `cabecalhoHTML`. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as regras from './regras.js';
import * as ui from './ui.js';
import { icone } from './icones.js';

const { esc } = util;

const ALTURA_MINIMA = 28;
const PASSO_ARRASTO_MIN = 15;
const LIMIAR_ARRASTO_PX = 4;
const MS_FANTASMA = 150;
const LARGURA_TELEFONE = 720;
/* Teto de blocos lado a lado numa coluna (DIRECAO 3.3). Acima disso, o
   excedente vira "+N". Três cabe em coluna larga (Dia, ficha, Recursos no
   desktop); na semana, com sete colunas de cerca de 157 px, três blocos dariam
   52 px cada, que é o defeito que a auditoria apontou, então ali o teto é dois. */
const MAX_LANES = 3;
const MAX_LANES_ESTREITO = 2;
/* Colapso das horas vazias (DIRECAO 3.3, último item da grade): só em coluna
   única, só com um ou dois serviços no dia, e só em vão de uma hora e meia
   para cima, senão a faixa apareceria entre dois serviços seguidos. */
const MIN_VAO_MIN = 90;
const MAX_SERVICOS_COLAPSO = 2;
/* A calha só mostra a meia hora quando há altura para ela respirar; em 56 px
   por hora (semana e Recursos) a coluna de horas vira ruído. */
const PPH_MEIA_HORA = 64;
const MINUTOS_DIA = 24 * 60;
const PPH_RESERVA_CELULAR = 64;
const PPH_RESERVA_DESKTOP = 72;

const min = (hora) => util.horaParaMin(hora);
const ehTelefone = () => window.innerWidth < LARGURA_TELEFONE;
const { ehDesktop } = ui;
const px = (n) => Math.round(n * 100) / 100 + 'px';

/* ================================================================== */
/* Apoio                                                               */
/* ================================================================== */

const { nomeCurto } = util;

function configViva() {
  let c = null;
  try { c = dados.repo.config(); } catch (e) { c = null; }
  return Object.assign({ slotMin: 30, duracaoPadraoMin: 90 }, c || {});
}

/** Ordena e funde intervalos {de, ate} em minutos, descartando os vazios. */
function fundirIntervalos(intervalos) {
  const validos = (intervalos || [])
    .map((f) => (f && Number.isFinite(f.de) && Number.isFinite(f.ate) ? { de: f.de, ate: f.ate } : null))
    .filter((f) => f && f.ate > f.de)
    .sort((x, y) => x.de - y.de);
  const uniao = [];
  for (const f of validos) {
    const ultima = uniao[uniao.length - 1];
    if (ultima && f.de <= ultima.ate) ultima.ate = Math.max(ultima.ate, f.ate);
    else uniao.push(f);
  }
  return uniao;
}

/** Aceita null, {de, ate} em HH:MM ou array de faixas; devolve faixas em minutos. */
function faixasDe(valor) {
  if (!valor) return [];
  const lista = Array.isArray(valor) ? valor : [valor];
  return fundirIntervalos(lista.map((f) => (f && f.de && f.ate ? { de: min(f.de), ate: min(f.ate) } : null)));
}

/**
 * Faixas abertas do dia, em minutos, já com a união dos setores visíveis.
 * O vão entre duas faixas é o almoço (DIRECAO 5.2), e a grade o desenha como
 * fechado, não como pintura decorativa. Vazio em dia fechado.
 */
function faixasUniao(iso, setores) {
  const listas = (!setores || !setores.length)
    ? [regras.faixasDoDia(iso)]
    : setores.map((s) => regras.faixasDoDia(iso, s));
  const todas = [];
  for (const lista of listas) for (const f of (lista || [])) if (f && f.de && f.ate) todas.push({ de: min(f.de), ate: min(f.ate) });
  return fundirIntervalos(todas);
}

/** Faixas abertas da coluna: o que a coluna declarou (compatível com {de, ate}) ou a união do dia. */
function faixasDaColuna(c, iso, setores) {
  return c.horario === undefined ? faixasUniao(iso, setores) : faixasDe(c.horario);
}

function normalizarFaixa(faixa) {
  const f = faixa || {};
  let hIni = Number.isFinite(f.hIni) ? Math.max(0, Math.floor(f.hIni)) : 8;
  let hFim = Number.isFinite(f.hFim) ? Math.min(24, Math.ceil(f.hFim)) : 18;
  if (hFim <= hIni) hFim = Math.min(24, hIni + 8);
  if (hFim <= hIni) hIni = Math.max(0, hFim - 8);
  return { hIni, hFim, fechado: !!f.fechado };
}

function normalizarColuna(c, indice) {
  const col = Object.assign({ id: 'col' + indice, tipoRecurso: null, titulo: '', subtitulo: '', agendamentos: [], indisponibilidades: [], folgas: [], vazioTexto: '' }, c || {});
  col.agendamentos = (col.agendamentos || []).filter((a) => a && a.horaInicio && a.horaFim);
  return col;
}

/** Lê --pph do elemento; se ainda não está no DOM, encosta no body só para medir. */
function medirPph(grade) {
  const ler = () => parseFloat(getComputedStyle(grade).getPropertyValue('--pph'));
  let valor = grade.isConnected ? ler() : NaN;
  if (!Number.isFinite(valor) || valor <= 0) {
    const anterior = { position: grade.style.position, visibility: grade.style.visibility, pointerEvents: grade.style.pointerEvents };
    grade.style.position = 'absolute';
    grade.style.visibility = 'hidden';
    grade.style.pointerEvents = 'none';
    document.body.appendChild(grade);
    valor = ler();
    grade.remove();
    grade.style.position = anterior.position;
    grade.style.visibility = anterior.visibility;
    grade.style.pointerEvents = anterior.pointerEvents;
  }
  return Number.isFinite(valor) && valor > 0 ? valor : (ehDesktop() ? PPH_RESERVA_DESKTOP : PPH_RESERVA_CELULAR);
}

/* ================================================================== */
/* Posição e bloco (7.4)                                               */
/* ================================================================== */

/**
 * Posição em px e %, a partir de minutos, faixa, pph e lanes.
 * @param {object} agendamento @param {{hIni:number}} faixa @param {number} pph @param {{lane:number, total:number, span:number}} lane
 * @returns {{top:number, height:number, left:string, width:string}}
 */
export function posicaoBloco(agendamento, faixa, pph, lane) {
  const ini = min(agendamento.horaInicio);
  let fim = min(agendamento.horaFim);
  if (fim <= ini) fim = ini + 30;
  const escala = Number(pph) > 0 ? Number(pph) : PPH_RESERVA_CELULAR;
  const base = ((faixa && Number.isFinite(faixa.hIni)) ? faixa.hIni : 0) * 60;
  const top = ((ini - base) / 60) * escala + 1;
  const height = Math.max(ALTURA_MINIMA, ((fim - ini) / 60) * escala - 2);
  const l = Object.assign({ lane: 0, total: 1, span: 1 }, lane || {});
  const total = Math.max(1, Number(l.total) || 1);
  const esquerda = (Math.max(0, l.lane) / total) * 100;
  const largura = (Math.max(1, l.span) / total) * 100;
  return { top, height, left: 'calc(' + esquerda + '% + 2px)', width: 'calc(' + largura + '% - 4px)' };
}

function textoConflitos(conflitos) {
  return (conflitos || []).map((c) => c.rotulo + (c.comTexto ? ': ' + c.comTexto : '')).join('. ');
}

/**
 * HTML de um bloco (7.4), com conteúdo progressivo pela altura e aria-label completo.
 * Em conflito ou liberação pendente, devolve também o botão .bloco-alerta como
 * irmão do .bloco (button dentro de button é inválido e o leitor de tela não
 * anunciaria a ação), posicionado sobre o canto superior esquerdo do bloco.
 * @param {object} agendamento @param {{top:number, height:number, left:string, width:string}} posicao @param {{conflitos?:object[], liberacao?:boolean, atraso?:object|null, pendente?:boolean, destaque?:boolean}} estado
 * @returns {string}
 */
export function blocoHTML(agendamento, posicao, estado = {}) {
  const a = agendamento;
  const e = estado || {};
  const tipo = dados.tipoPorId(a.tipoId);
  const cliente = a.clienteId ? dados.clientePorId(a.clienteId) : null;
  const veiculo = a.veiculoId ? dados.veiculoPorId(a.veiculoId) : null;
  const st = dados.STATUS[a.status] || dados.STATUS.aguardando_conf;
  const conflitos = e.conflitos || [];
  const atraso = e.atraso && e.atraso.minutos > 0 ? e.atraso : null;
  const ini = min(a.horaInicio);
  let fim = min(a.horaFim);
  const invalido = fim <= ini;
  if (invalido) fim = ini + 30;

  const classes = ['bloco', 'setor-' + esc(a.setorId || ''), st.classe];
  if (a.status === 'aguardando_conf' || a.status === 'reagendado') classes.push('bloco-tentativo');
  if (a.status === 'concluido' || a.status === 'nao_realizado') classes.push('bloco-finalizado');
  if (a.status === 'cancelado') classes.push('bloco-cancelado');
  if (e.liberacao) classes.push('bloco-liberacao');
  else if (conflitos.length) classes.push('bloco-conflito');
  if (atraso) classes.push('bloco-atrasado');
  if (e.pendente) classes.push('bloco-pendente');
  if (e.destaque) classes.push('bloco-destaque');
  if (invalido) classes.push('bloco-invalido');

  /* Pares id mais texto (DIRECAO-2 2.2): o tipo livre e o cliente solto do registro rápido aparecem na grade. */
  const nomeTipo = dados.nomeDoServico(a);
  const nomeCliente = dados.nomeDoCliente(a);
  const textoStatus = atraso ? 'Atrasado ' + util.fmtDuracao(atraso.minutos) : st.rotulo;
  const classeStatus = atraso ? 'status-atrasado' : st.classe;
  const responsaveis = Array.from(regras.expandirPessoas(a))
    .map((id) => { const u = dados.usuarioPorId(id); return u ? nomeCurto(u.nome) : ''; })
    .filter(Boolean).join(', ');
  /* "Endereço a confirmar" é alarme do despacho; no registro rápido, local vazio é normal (F11) e o texto livre vale. */
  const bairro = a.endereco
    ? (a.enderecoAConfirmar ? 'Endereço a confirmar' : (a.endereco.bairro || util.enderecoCurto(a.endereco) || ''))
    : (a.origem === 'loja' || a.enderecoAConfirmar ? 'Endereço a confirmar' : String(a.localTexto || ''));
  const aria = [nomeTipo, nomeCliente, util.fmtIntervalo(a.horaInicio, a.horaFim), veiculo ? (veiculo.apelido || veiculo.nome) : '', textoStatus.toLowerCase()]
    .filter(Boolean).join(', ') + (e.liberacao ? ', liberação pendente' : conflitos.length ? ', em conflito' : '') + (e.pendente ? ', pendente de envio' : '');
  const altura = Number(posicao.height) || ALTURA_MINIMA;
  const dataAlt = altura >= 84 ? 4 : altura >= 60 ? 3 : altura >= 44 ? 2 : 1;
  const estilo = 'top:' + px(posicao.top) + ';height:' + px(altura) + ';left:' + posicao.left + ';width:' + posicao.width;
  /* O alerta é irmão do bloco: mesmo top e left, deslocados pela borda do bloco (1 px em cima, 4 px à esquerda). */
  const alerta = e.liberacao || conflitos.length
    ? '<button type="button" class="bloco-alerta" data-acao="conflito" data-id="' + esc(a.id) + '" style="top:' + px(posicao.top + 1) + ';left:calc(' + posicao.left + ' + 4px)"' +
      ' aria-label="' + esc((e.liberacao ? 'Ver pedido de liberação' : 'Ver conflito') + (nomeCliente ? ', ' + nomeCliente : '') + ', ' + a.horaInicio) + '" title="' + esc(textoConflitos(conflitos) || (e.liberacao ? 'Pedido de liberação pendente' : 'Em conflito')) + '">' +
      icone(e.liberacao ? 'cadeado' : 'alerta', 14) + '</button>'
    : '';

  return '<button type="button" class="' + classes.join(' ') + '" style="' + estilo + '" data-id="' + esc(a.id) + '" data-acao="bloco"' +
    ' data-alt="' + dataAlt + '" data-inicio="' + esc(a.horaInicio) + '" data-dur="' + (fim - ini) + '" aria-label="' + esc(aria) + '" title="' + esc(aria) + '">' +
    '<span class="bloco-linha1"><span class="bloco-hora">' + esc(a.horaInicio) + '</span><span class="bloco-tipo">' + esc(nomeTipo) + '</span></span>' +
    '<span class="bloco-status ' + esc(classeStatus) + '">' + esc(textoStatus) + '</span>' +
    '<span class="bloco-cliente">' + esc(nomeCliente) + '</span>' +
    '<span class="bloco-meta"><span class="truncar">' + esc(bairro) + '</span>' + ui.chipCarro(veiculo, { pequeno: true }) + '</span>' +
    (responsaveis ? '<span class="bloco-resp">' + esc(responsaveis) + '</span>' : '') +
    (e.pendente ? '<span class="ponto-sync" title="Pendente de envio" aria-hidden="true"></span>' : '') +
    '</button>' + alerta;
}

/* ================================================================== */
/* Partes da grade                                                     */
/* ================================================================== */

/* Só a hora cheia tem linha (DIRECAO 3.3). A meia hora virou respiro: com as
   duas no mesmo cinza a grade virava papel pautado. */
function linhasHTML(faixa, pph) {
  let html = '';
  for (let h = faixa.hIni; h <= faixa.hFim; h++) {
    html += '<div class="grade-linha" style="top:' + px((h - faixa.hIni) * pph) + '" aria-hidden="true"></div>';
  }
  return html;
}

function gutterHTML(ctx) {
  const { faixa, pph } = ctx;
  const altura = (faixa.hFim - faixa.hIni) * pph;
  const meias = pph >= PPH_MEIA_HORA;
  let html = '<div class="grade-gutter" style="height:' + px(altura) + '" aria-hidden="true">';
  for (let h = faixa.hIni; h <= faixa.hFim; h++) {
    const y = (h - faixa.hIni) * pph;
    const ultimo = h === faixa.hFim;
    html += '<span class="grade-hora" data-cheia style="top:' + px(y) + (ultimo ? ';transform:translateY(-100%)' : '') + '">' + util.minParaHora(h * 60) + '</span>';
    if (meias && !ultimo) html += '<span class="grade-hora" style="top:' + px(y + pph / 2) + '">' + util.minParaHora(h * 60 + 30) + '</span>';
  }
  return html + '</div>';
}

function cabecalhoColunaHTML(c, ctx) {
  const clicavel = typeof ctx.op.aoClicarCabecalho === 'function';
  const qtd = c.agendamentos.filter((a) => a.status !== 'cancelado').length;
  const conteudo = c.cabecalhoHTML || (
    '<span class="grade-cab-titulo">' + esc(c.titulo || '') + '</span>' +
    (c.subtitulo ? '<span class="grade-cab-sub">' + esc(c.subtitulo) + '</span>' : '') +
    '<span class="grade-cab-qtd">' + (qtd === 0 ? 'Sem serviços' : qtd === 1 ? '1 serviço' : qtd + ' serviços') + '</span>'
  );
  const attrs = ['class="grade-cab-col"', 'data-coluna="' + esc(c.id) + '"'];
  if (clicavel) attrs.push('type="button"', 'data-acao="cabecalho"', 'aria-label="' + esc('Abrir ' + (c.titulo || c.id)) + '"');
  if (c.hoje) attrs.push('data-hoje');
  if (c.fechado) attrs.push('data-fechado');
  if (c.neutra) attrs.push('data-neutra');
  const tag = clicavel ? 'button' : 'div';
  return '<' + tag + ' ' + attrs.join(' ') + '>' + conteudo + '</' + tag + '>';
}

function cabecalhosHTML(ctx) {
  return '<div class="grade-cabs"><div class="grade-cab-canto" aria-hidden="true"></div>' + ctx.colunas.map((c) => cabecalhoColunaHTML(c, ctx)).join('') + '</div>';
}

function trechoFechadoHTML(de, ate, base, pph, rotulo) {
  const altura = ((ate - de) / 60) * pph;
  if (altura <= 0) return '';
  return '<div class="grade-fechado"' + (rotulo && altura >= 36 ? ' data-texto="' + esc(rotulo) + '"' : '') +
    ' style="top:' + px(((de - base) / 60) * pph) + ';height:' + px(altura) + '" aria-hidden="true"></div>';
}

/**
 * Hachura tudo que está fora das faixas abertas do dia, inclusive o vão entre
 * duas faixas, que é o almoço (DIRECAO 5.2).
 * O rótulo só aparece em grade de coluna única: repetido em sete colunas da
 * semana ele vira sete vezes a mesma palavra. O dia inteiro fechado só leva
 * rótulo quando a coluna tem serviço, senão o .grade-vazio já diz o mesmo e as
 * duas frases se sobrepõem.
 */
function fechadoHTML(faixas, faixa, pph, opcoes) {
  const op = opcoes || {};
  const ini = faixa.hIni * 60;
  const fim = faixa.hFim * 60;
  if (!faixas.length) return trechoFechadoHTML(ini, fim, ini, pph, op.rotularDia ? 'Loja fechada' : '');
  const rotulo = op.rotularVao ? 'Fechado' : '';
  let html = '';
  let cursor = ini;
  for (const f of faixas) {
    const de = util.clamp(f.de, ini, fim);
    if (de > cursor) html += trechoFechadoHTML(cursor, de, ini, pph, cursor > ini ? rotulo : '');
    cursor = Math.max(cursor, util.clamp(f.ate, ini, fim));
  }
  if (cursor < fim) html += trechoFechadoHTML(cursor, fim, ini, pph, '');
  return html;
}

/**
 * Vãos vazios de uma coluna única com poucos serviços (DIRECAO 3.3): em vez de
 * cinco horas e meia de pauta em branco, uma faixa dizendo o que há ali e um
 * "Agendar aqui". A geometria da grade não muda: a calha de horas continua
 * verdadeira, o que muda é o que ocupa o vazio.
 */
function vaosHTML(c, ctx, faixas) {
  if (ctx.colunas.length > 1 || !faixas.length) return '';
  const ativos = c.agendamentos.filter((a) => a.horaInicio && a.horaFim);
  if (!ativos.length || ativos.length > MAX_SERVICOS_COLAPSO) return '';
  const base = ctx.faixa.hIni * 60;
  const fimGrade = ctx.faixa.hFim * 60;
  const ocupados = fundirIntervalos(ativos.map((a) => {
    const ini = min(a.horaInicio);
    return { de: ini, ate: Math.max(min(a.horaFim), ini + 30) };
  }));
  const podeAgendar = typeof ctx.op.aoTocarVao === 'function';
  let html = '';
  for (const f of faixas) {
    let cursor = util.clamp(f.de, base, fimGrade);
    const fimFaixa = util.clamp(f.ate, base, fimGrade);
    for (const o of ocupados.concat([{ de: fimFaixa, ate: fimFaixa }])) {
      const ate = util.clamp(o.de, cursor, fimFaixa);
      if (ate - cursor >= MIN_VAO_MIN) html += vaoHTML(cursor, ate, base, ctx.pph, podeAgendar);
      cursor = Math.max(cursor, util.clamp(o.ate, base, fimFaixa));
      if (cursor >= fimFaixa) break;
    }
  }
  return html;
}

/* A faixa em si não recebe o toque (pointer-events: none no CSS): quem toca no
   meio dela continua caindo no vão da coluna e agenda na hora tocada, que é o
   gesto que já existia. O botão de dentro é o caminho de teclado e agenda no
   início do vão. */
function vaoHTML(de, ate, base, pph, podeAgendar) {
  const hora = util.minParaHora(de);
  const texto = 'das ' + hora + ' às ' + util.minParaHora(ate) + ', nenhum serviço';
  const estilo = 'top:' + px(((de - base) / 60) * pph) + ';height:' + px(((ate - de) / 60) * pph);
  const botao = podeAgendar
    ? '<button type="button" class="btn btn-secundario btn-pq grade-vao-acao" data-acao="vao" data-inicio="' + esc(hora) +
      '" aria-label="' + esc('Agendar às ' + hora) + '">Agendar aqui</button>'
    : '';
  return '<div class="grade-vao" style="' + estilo + '" role="note" aria-label="' + esc(texto) + '">' +
    '<span class="grade-vao-texto">' + esc(texto) + '</span>' + botao + '</div>';
}

function indispHTML(item, faixa, pph) {
  if (!item) return '';
  const ini = faixa.hIni * 60;
  const fim = faixa.hFim * 60;
  const de = Math.max(min(item.de), ini);
  const ate = Math.min(item.ate === '23:59' || item.ate === '24:00' ? MINUTOS_DIA : min(item.ate), fim);
  if (ate <= de) return '';
  const texto = item.texto || 'Indisponível';
  return '<div class="bloco-indisp" role="note" style="top:' + px((de - ini) / 60 * pph) + ';height:' + px((ate - de) / 60 * pph) + '" title="' + esc(texto) + '" aria-label="' + esc(texto + ', ' + item.de + ' às ' + item.ate) + '"><span>' + esc(texto) + '</span></div>';
}

function estadoBloco(a, ctx) {
  const mapa = ctx.op.conflitos;
  const conflitos = mapa && typeof mapa.get === 'function' ? (mapa.get(a.id) || []) : [];
  return {
    conflitos,
    liberacao: !!(a.liberacao && a.liberacao.estado === 'pendente' && regras.statusAtivo(a.status)),
    atraso: regras.atrasoDe(a),
    pendente: dados.pendenteSync('agendamentos', a.id),
    destaque: !!ctx.op.destaqueId && ctx.op.destaqueId === a.id
  };
}

/** Clusters de sobreposição (mesma varredura de regras.lanes), para o "+N" do celular. */
function agruparClusters(lista, mapaLanes) {
  const eventos = lista.map((a) => {
    const ini = min(a.horaInicio);
    let fim = min(a.horaFim);
    if (fim <= ini) fim = ini + 30;
    return { a, ini, fim };
  }).sort((x, y) => x.ini - y.ini || (y.fim - y.ini) - (x.fim - x.ini) || String(x.a.id).localeCompare(String(y.a.id)));
  const clusters = [];
  let atual = null;
  let maiorFim = -1;
  for (const e of eventos) {
    if (!atual || e.ini >= maiorFim) {
      atual = { itens: [], total: 1 };
      clusters.push(atual);
      maiorFim = -1;
    }
    atual.itens.push(e);
    maiorFim = Math.max(maiorFim, e.fim);
    const l = mapaLanes.get(e.a.id);
    if (l) atual.total = Math.max(atual.total, l.total);
  }
  return clusters;
}

function maisBlocosHTML(escondidos, ctx, teto) {
  const ini = Math.min(...escondidos.map((e) => e.ini));
  const fim = Math.max(...escondidos.map((e) => e.fim));
  const pos = posicaoBloco({ horaInicio: util.minParaHora(ini), horaFim: util.minParaHora(Math.min(fim, MINUTOS_DIA - 1)) }, ctx.faixa, ctx.pph, { lane: teto - 1, total: teto, span: 1 });
  const ids = escondidos.map((e) => e.a.id);
  const n = ids.length;
  return '<button type="button" class="mais-blocos" data-acao="mais" data-ids="' + esc(ids.join(',')) + '" style="top:' + px(pos.top) + ';height:' + px(pos.height) + ';left:' + pos.left + ';width:' + pos.width + '" aria-label="Mais ' + n + (n === 1 ? ' serviço' : ' serviços') + ' neste horário">+' + n + '</button>';
}

/**
 * Teto de blocos lado a lado nesta grade (DIRECAO 3.3). Coluna única é sempre
 * larga; semana e celular com várias colunas cabem dois.
 */
function tetoDeLanes(ctx) {
  if (ctx.colunas.length <= 1) return MAX_LANES;
  if (String(ctx.op.modo || '') === 'semana' || ctx.telefone) return MAX_LANES_ESTREITO;
  return MAX_LANES;
}

function blocosHTML(c, ctx) {
  const lista = c.agendamentos;
  if (!lista.length) return '';
  const mapaLanes = regras.lanes(lista);
  const teto = ctx.teto;
  let html = '';
  for (const cluster of agruparClusters(lista, mapaLanes)) {
    const reduzir = cluster.total > teto;
    const escondidos = [];
    for (const e of cluster.itens) {
      const l = mapaLanes.get(e.a.id) || { lane: 0, total: 1, span: 1 };
      if (reduzir && l.lane >= teto - 1) { escondidos.push(e); continue; }
      const lane = reduzir ? { lane: l.lane, total: teto, span: Math.max(1, Math.min(l.span, teto - 1 - l.lane)) } : l;
      html += blocoHTML(e.a, posicaoBloco(e.a, ctx.faixa, ctx.pph, lane), estadoBloco(e.a, ctx));
    }
    if (escondidos.length) html += maisBlocosHTML(escondidos, ctx, teto);
  }
  return html;
}

function colunaHTML(c, ctx) {
  const { faixa, pph } = ctx;
  const iso = c.data || ctx.op.data;
  const altura = (faixa.hFim - faixa.hIni) * pph;
  const faixasAbertas = faixasDaColuna(c, iso, ctx.op.setores);
  const semServico = !c.agendamentos.length;
  const partes = [
    linhasHTML(faixa, pph),
    fechadoHTML(faixasAbertas, faixa, pph, { rotularVao: ctx.colunas.length === 1, rotularDia: !semServico }),
    vaosHTML(c, ctx, faixasAbertas),
    (c.indisponibilidades || []).map((i) => indispHTML(i, faixa, pph)).join(''),
    (c.folgas || []).map((i) => indispHTML(i, faixa, pph)).join(''),
    blocosHTML(c, ctx),
    semServico && c.vazioTexto ? '<div class="grade-vazio" aria-hidden="true"><span>' + esc(c.vazioTexto) + '</span></div>' : ''
  ];
  const attrs = [
    'class="grade-col' + (c.neutra ? ' grade-col-neutra' : '') + '"',
    'data-coluna="' + esc(c.id) + '"',
    'data-tipo="' + esc(c.tipoRecurso || '') + '"',
    'data-data="' + esc(iso) + '"',
    'style="height:' + px(altura) + '"',
    'role="group"',
    'aria-label="' + esc(c.titulo || 'Coluna') + '"'
  ];
  if (c.fechado || (!faixasAbertas.length && semServico)) attrs.push('data-fechado');
  if (c.neutra) attrs.push('data-neutra');
  return '<div ' + attrs.join(' ') + '>' + partes.join('') + '</div>';
}

/* ================================================================== */
/* Eventos: toque em vão, bloco, conflito, "+N", toque longo, arrasto  */
/* ================================================================== */

function tocarVao(col, clientY, ctx) {
  const op = ctx.op;
  const rect = col.getBoundingClientRect();
  const y = clientY - rect.top;
  const slot = Number(ctx.cfg.slotMin) || 30;
  const base = ctx.faixa.hIni * 60;
  let minutos = base + Math.floor((y / ctx.pph) * 60);
  minutos = util.arredondarMin(minutos, slot, 'baixo');
  minutos = util.clamp(minutos, base, Math.max(base, ctx.faixa.hFim * 60 - slot));
  const dur = Number(ctx.cfg.duracaoPadraoMin) || 90;
  const fantasma = document.createElement('div');
  fantasma.className = 'bloco-fantasma';
  fantasma.setAttribute('aria-hidden', 'true');
  fantasma.style.top = px(((minutos - base) / 60) * ctx.pph + 1);
  fantasma.style.height = px((dur / 60) * ctx.pph - 2);
  col.appendChild(fantasma);
  const info = {
    colunaId: col.getAttribute('data-coluna'),
    tipoRecurso: col.getAttribute('data-tipo') || null,
    neutra: col.hasAttribute('data-neutra'),
    data: col.getAttribute('data-data'),
    horaInicio: util.minParaHora(minutos)
  };
  setTimeout(() => {
    fantasma.remove();
    if (typeof op.aoTocarVao === 'function') op.aoTocarVao(info);
  }, MS_FANTASMA);
}

/* Uma única sessão de arrasto por vez; Esc cancela pelo ouvinte global abaixo. */
let cancelarArrastoAtivo = null;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && typeof cancelarArrastoAtivo === 'function') cancelarArrastoAtivo();
  });
}

function ligarArrasto(el, ctx, aoTerminar) {
  let s = null;
  const colunas = () => Array.from(el.querySelectorAll('.grade-col'));
  const colunaEm = (x) => colunas().find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; }) || null;

  const restaurar = (sessao) => {
    sessao.bloco.style.top = sessao.topInicial;
    if (sessao.bloco.parentNode !== sessao.colOrigem) sessao.colOrigem.appendChild(sessao.bloco);
    sessao.bloco.classList.remove('bloco-arrastando');
    if (sessao.alerta) sessao.alerta.hidden = false;
    if (sessao.hora) sessao.hora.textContent = sessao.horaInicial;
    el.removeAttribute('data-arrastando');
  };

  const terminar = (cancelado) => {
    if (!s) return;
    const sessao = s;
    s = null;
    cancelarArrastoAtivo = null;
    if (!sessao.movendo) return;
    const destino = sessao.colAtual;
    const mudou = !cancelado && (sessao.minutos !== sessao.minutos0 || destino !== sessao.colOrigem);
    restaurar(sessao);
    aoTerminar();
    if (!mudou || typeof ctx.op.aoSoltar !== 'function') return;
    ctx.op.aoSoltar({
      agendamentoId: sessao.id,
      data: destino.getAttribute('data-data'),
      horaInicio: util.minParaHora(sessao.minutos),
      horaFim: util.minParaHora(Math.min(sessao.minutos + sessao.dur, MINUTOS_DIA - 1)),
      colunaId: destino.getAttribute('data-coluna'),
      tipoRecurso: destino.getAttribute('data-tipo') || null,
      neutra: destino.hasAttribute('data-neutra'),
      colunaOrigemId: sessao.colOrigem.getAttribute('data-coluna')
    });
  };

  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    const t = ev.target instanceof Element ? ev.target : null;
    const bloco = t ? t.closest('.bloco') : null;
    if (!bloco) return;
    const col = bloco.closest('.grade-col');
    if (!col) return;
    const id = bloco.getAttribute('data-id');
    s = {
      id, bloco, colOrigem: col, colAtual: col,
      alerta: Array.from(col.querySelectorAll('.bloco-alerta')).find((b) => b.getAttribute('data-id') === id) || null,
      x0: ev.clientX, y0: ev.clientY, topInicial: bloco.style.top, top0: parseFloat(bloco.style.top) || 0,
      dur: Number(bloco.getAttribute('data-dur')) || 30,
      minutos0: min(bloco.getAttribute('data-inicio')), minutos: min(bloco.getAttribute('data-inicio')),
      hora: bloco.querySelector('.bloco-hora'), horaInicial: bloco.getAttribute('data-inicio'), movendo: false
    };
    cancelarArrastoAtivo = () => { if (s && s.movendo) terminar(true); };
    try { bloco.setPointerCapture(ev.pointerId); } catch (e) { /* sem captura */ }
  });

  el.addEventListener('pointermove', (ev) => {
    if (!s) return;
    const dx = ev.clientX - s.x0;
    const dy = ev.clientY - s.y0;
    if (!s.movendo) {
      if (Math.abs(dx) < LIMIAR_ARRASTO_PX && Math.abs(dy) < LIMIAR_ARRASTO_PX) return;
      s.movendo = true;
      s.bloco.classList.add('bloco-arrastando');
      if (s.alerta) s.alerta.hidden = true;
      el.setAttribute('data-arrastando', '');
    }
    ev.preventDefault();
    const base = ctx.faixa.hIni * 60;
    let minutos = base + Math.round((((s.top0 - 1 + dy) / ctx.pph) * 60) / PASSO_ARRASTO_MIN) * PASSO_ARRASTO_MIN;
    minutos = util.clamp(minutos, base, Math.max(base, ctx.faixa.hFim * 60 - s.dur));
    s.minutos = minutos;
    s.bloco.style.top = px(((minutos - base) / 60) * ctx.pph + 1);
    if (s.hora) s.hora.textContent = util.minParaHora(minutos);
    if (colunas().length > 1) {
      const c = colunaEm(ev.clientX);
      if (c && c !== s.colAtual) { c.appendChild(s.bloco); s.colAtual = c; }
    }
  });

  el.addEventListener('pointerup', () => terminar(false));
  el.addEventListener('pointercancel', () => terminar(true));
}

function ligarEventos(el, ctx) {
  const op = ctx.op;
  let suprimirClique = false;
  const suprimir = () => { suprimirClique = true; setTimeout(() => { suprimirClique = false; }, 0); };

  el.addEventListener('click', (ev) => {
    if (suprimirClique) { ev.stopPropagation(); ev.preventDefault(); return; }
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t) return;
    const alerta = t.closest('.bloco-alerta');
    if (alerta) {
      ev.stopPropagation();
      if (typeof op.aoAbrirConflito === 'function') op.aoAbrirConflito(alerta.getAttribute('data-id'));
      return;
    }
    const bloco = t.closest('.bloco');
    if (bloco) { if (typeof op.aoAbrirBloco === 'function') op.aoAbrirBloco(bloco.getAttribute('data-id')); return; }
    const mais = t.closest('.mais-blocos');
    if (mais) {
      if (typeof op.aoAbrirMais === 'function') op.aoAbrirMais((mais.getAttribute('data-ids') || '').split(',').filter(Boolean));
      return;
    }
    if (t.closest('.bloco-indisp')) return;
    /* O botão do vão vazio já sabe a hora de início; não passa pelo fantasma. */
    const vao = t.closest('[data-acao="vao"]');
    if (vao) {
      const colVao = vao.closest('.grade-col');
      if (colVao && typeof op.aoTocarVao === 'function') {
        op.aoTocarVao({
          colunaId: colVao.getAttribute('data-coluna'),
          tipoRecurso: colVao.getAttribute('data-tipo') || null,
          neutra: colVao.hasAttribute('data-neutra'),
          data: colVao.getAttribute('data-data'),
          horaInicio: vao.getAttribute('data-inicio')
        });
      }
      return;
    }
    const cab = t.closest('.grade-cab-col[data-acao="cabecalho"]');
    if (cab) { if (typeof op.aoClicarCabecalho === 'function') op.aoClicarCabecalho(cab.getAttribute('data-coluna')); return; }
    const col = t.closest('.grade-col');
    if (col && el.contains(col)) tocarVao(col, ev.clientY, ctx);
  });

  /* .bloco-alerta é um button de verdade: Enter e Espaço já disparam o click acima. */

  ui.toqueLongo(el, '.bloco', (bloco) => {
    if (typeof op.aoMenuRapido === 'function') op.aoMenuRapido(bloco.getAttribute('data-id'), bloco);
  });

  if (op.arrastavel && ehDesktop()) ligarArrasto(el, ctx, suprimir);
}

/* ================================================================== */
/* Montagem                                                            */
/* ================================================================== */

/**
 * Monta a grade.
 * @param {{
 *   data:string,
 *   colunas:{id:string, tipoRecurso:'veiculo'|'equipe'|'pessoa'|'dia'|'setor'|null, titulo:string, subtitulo?:string, agendamentos:object[], indisponibilidades?:{de:string, ate:string, texto:string}[], folgas?:{de:string, ate:string, texto:string}[], vazioTexto?:string, neutra?:boolean, data?:string}[],
 *   faixa:{hIni:number, hFim:number, fechado?:boolean},
 *   conflitos:Map<string, object[]>,
 *   mostrarAgora:boolean,
 *   arrastavel:boolean,
 *   aoTocarVao:(info:{colunaId:string, tipoRecurso:string|null, data:string, horaInicio:string})=>void,
 *   aoAbrirBloco:(agendamentoId:string)=>void,
 *   aoAbrirConflito:(agendamentoId:string)=>void,
 *   aoAbrirMais:(agendamentoIds:string[])=>void,
 *   aoMenuRapido:(agendamentoId:string, el:HTMLElement)=>void,
 *   aoSoltar?:(info:{agendamentoId:string, data:string, horaInicio:string, horaFim:string, colunaId:string, tipoRecurso:string|null})=>void
 * }} opcoes
 * @returns {HTMLElement} elemento .grade já com eventos ligados; quem chama insere no DOM e depois chama rolarPara.
 * Efeitos: nenhum além do DOM devolvido. Quem chama: agenda (visões), recursos (ficha do veículo).
 */
export function montarGrade(opcoes) {
  const op = Object.assign({ data: util.hojeISO(), colunas: [], faixa: null, conflitos: new Map(), mostrarAgora: false, arrastavel: false, setores: null, destaqueId: null, modo: '' }, opcoes || {});
  const faixa = normalizarFaixa(op.faixa);
  const colunas = (op.colunas || []).map(normalizarColuna);

  const el = document.createElement('div');
  el.className = 'grade';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Grade de horários');
  el.setAttribute('data-colunas', String(colunas.length));
  if (colunas.length > 4) el.setAttribute('data-colunas-muitas', '');
  if (op.modo) el.setAttribute('data-modo', String(op.modo));
  if (op.arrastavel) el.setAttribute('data-arrastavel', '');
  if (faixa.fechado) el.setAttribute('data-fechado', '');
  el.setAttribute('data-data', op.data || '');
  el.setAttribute('data-hini', String(faixa.hIni));
  el.setAttribute('data-hfim', String(faixa.hFim));
  el.setAttribute('data-mostrar-agora', op.mostrarAgora ? '1' : '0');

  const pph = medirPph(el);
  el.setAttribute('data-pph', String(pph));

  const ctx = { op, faixa, colunas, pph, telefone: ehTelefone(), cfg: configViva() };
  ctx.teto = tetoDeLanes(ctx);
  el.innerHTML =
    '<div class="grade-rolagem">' +
      cabecalhosHTML(ctx) +
      '<div class="grade-corpo">' + gutterHTML(ctx) + '<div class="grade-colunas">' + colunas.map((c) => colunaHTML(c, ctx)).join('') + '</div></div>' +
    '</div>';
  ligarEventos(el, ctx);
  atualizarLinhaAgora(el);
  return el;
}

/* ================================================================== */
/* Linha de agora e rolagem                                            */
/* ================================================================== */

function medidasDe(grade) {
  return {
    hIni: Number(grade.getAttribute('data-hini')) || 0,
    hFim: Number(grade.getAttribute('data-hfim')) || 24,
    pph: Number(grade.getAttribute('data-pph')) || PPH_RESERVA_CELULAR
  };
}

/** Reposiciona só a linha de agora (a cada 60 s). @param {HTMLElement} grade @returns {void} */
export function atualizarLinhaAgora(grade) {
  if (!grade || !grade.querySelector) return;
  const { hIni, hFim, pph } = medidasDe(grade);
  const mostrar = grade.getAttribute('data-mostrar-agora') === '1';
  const hoje = util.hojeISO();
  const agora = util.agoraMin();
  const dentro = agora >= hIni * 60 && agora <= hFim * 60;
  const top = ((agora - hIni * 60) / 60) * pph;
  let algumaHoje = false;
  grade.querySelectorAll('.grade-col').forEach((col) => {
    const ehHoje = mostrar && col.getAttribute('data-data') === hoje;
    let linha = col.querySelector('.grade-agora');
    if (!ehHoje || !dentro) { if (linha) linha.remove(); return; }
    algumaHoje = true;
    if (!linha) {
      linha = document.createElement('div');
      linha.className = 'grade-agora';
      linha.setAttribute('aria-hidden', 'true');
      col.appendChild(linha);
    }
    linha.style.top = px(top);
  });
  const gutter = grade.querySelector('.grade-gutter');
  if (!gutter) return;
  let ponto = gutter.querySelector('.grade-agora-ponto');
  /* A etiqueta da hora atual (17:25) encavalava com a vizinha da calha (17:30): a da calha some
     enquanto a linha do agora estiver a menos de 18 px dela (15 min ou mais, conforme o zoom). */
  gutter.querySelectorAll('.grade-hora').forEach((h) => {
    const perto = algumaHoje && Math.abs((parseFloat(h.style.top) || 0) - top) < 18;
    if (perto) h.setAttribute('data-sob-agora', ''); else h.removeAttribute('data-sob-agora');
  });
  if (!algumaHoje) { if (ponto) ponto.remove(); return; }
  if (!ponto) {
    ponto = document.createElement('span');
    ponto.className = 'grade-agora-ponto';
    gutter.appendChild(ponto);
  }
  ponto.style.top = px(top);
  ponto.textContent = util.minParaHora(agora);
}

/** Rola .grade-rolagem até o minuto (limitado à faixa). @param {HTMLElement} grade @param {number} minutos @param {{suave?:boolean}} [opcoes] */
export function rolarPara(grade, minutos, opcoes = {}) {
  if (!grade) return;
  const rolagem = grade.querySelector('.grade-rolagem');
  if (!rolagem) return;
  const { hIni, hFim, pph } = medidasDe(grade);
  const m = util.clamp(Number(minutos) || 0, hIni * 60, hFim * 60);
  const y = Math.max(0, ((m - hIni * 60) / 60) * pph);
  try {
    rolagem.scrollTo({ top: y, behavior: opcoes && opcoes.suave ? 'smooth' : 'auto' });
  } catch (e) {
    rolagem.scrollTop = y;
  }
}

/** Rola horizontalmente até a coluna. @param {HTMLElement} grade @param {string} colunaId */
export function rolarParaColuna(grade, colunaId) {
  if (!grade) return;
  const rolagem = grade.querySelector('.grade-rolagem');
  const col = Array.from(grade.querySelectorAll('.grade-col')).find((c) => c.getAttribute('data-coluna') === String(colunaId));
  if (!rolagem || !col) return;
  /* .grade-colunas começa depois do gutter fixo, então offsetLeft da coluna já é a posição de rolagem. */
  const x = Math.max(0, col.offsetLeft);
  try {
    rolagem.scrollTo({ left: x, behavior: 'smooth' });
  } catch (e) {
    rolagem.scrollLeft = x;
  }
}
