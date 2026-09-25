/* Green Agenda, módulo agendamento: src/agendamento.js
   Tudo o que é de um serviço: formulário (novo, editar) com disponibilidade
   e conflito ao vivo, detalhe, cartão de serviço, status com verbos e
   desfazer, checklist, reagendar, cancelar, não realizado, concluir, avisar
   atraso, duplicar, liberação de conflito, trocar carro, ordem de rota,
   compartilhar, rota, ligar, WhatsApp e copiar endereço.
   Direção 2 (docs/redesign/DIRECAO-2.md, seção 3): a tela "Registrar" é a
   única porta de criação. Quatro blocos numa tela só (quando, o que vou
   fazer, para quem e onde, carro), período em vez de hora obrigatória,
   "Mais opções" no mesmo cartão e a ponte com o grupo AGENDA GREEN nos dois
   sentidos ("Colar do WhatsApp" e "Copiar para o grupo", src/whatsapp.js).
   O fluxo antigo de quatro passos (#/agendar) foi aposentado e redireciona
   para #/registrar; #/servico/novo continua vivo para editar e despachar.
   Toda gravação de serviço passa por dados.repo dentro de repo.transacao,
   com auditoria e notificação; toda mudança de status passa por
   regras.podeTransitar. Exceção: o cliente rápido criado de dentro do
   formulário (salvarClienteNovo) é gravação simples em repo.criar, sem
   auditoria nem notificação, porque não existe ação de auditoria para
   cliente (ESPECIFICACAO.md, 6.12).
   Referência no v1 (app/index.html): TELAS.agendamento 3133 a 3167,
   checklistServicoHTML 3168 a 3178, acoesStatusHTML 3218, formAgendamento
   3361 a 3396, gravarAgendamento 3483 a 3515, abrirRotaCompleta 2148 a 2156.
   Ver ESPECIFICACAO.md, seções 6.2, 6.7, 7.10 e 8.

   Convenções internas:
   - As telas ligam eventos por delegação em data-acao; os campos de
     formulário usam data-campo e são lidos por delegação de input e change.
   - O estado do formulário vive em memória (formAtivo) para sobreviver ao
     rerender disparado por dados:alterado sem perder o que foi digitado. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as regras from './regras.js';
import * as ui from './ui.js';
/* A ponte com o grupo AGENDA GREEN (src/whatsapp.js). O apelido é `ponte` porque este módulo já exporta
   uma função chamada whatsapp (o link de conversa com o cliente). */
import * as ponte from './whatsapp.js';
import { icone } from './icones.js';

const { esc, plural, unicos, difere, classeCarro } = util;
const { repo } = dados;
const { abrirJanela } = ui;

const CAMPOS_SERVICO = ['tipoId', 'tipoLivre', 'setorId', 'data', 'horaInicio', 'horaFim', 'periodo', 'horaAproximada', 'clienteId', 'clienteNome',
  'endereco', 'enderecoAConfirmar', 'localTexto', 'responsaveis', 'responsavelTexto', 'equipeId', 'veiculoId', 'veiculoTexto', 'semCarroConfirmado', 'obs'];
const CAMPOS_HORARIO = ['data', 'horaInicio', 'horaFim'];
const CAMPOS_RECURSOS = ['responsaveis', 'equipeId', 'veiculoId'];
const ATRASOS_RAPIDOS = [15, 30, 45];
const MAX_PARADAS_MAPS = 9;

/* ================================================================== */
/* Apoio                                                               */
/* ================================================================== */

const usuarioAtual = () => dados.sessao.usuario();
const servico = (id) => (id ? dados.agendamentoPorId(id) : null);
const tipoDe = (a) => (a && a.tipoId ? dados.tipoPorId(a.tipoId) : null);
const clienteDe = (a) => (a && a.clienteId ? dados.clientePorId(a.clienteId) : null);
const veiculoDe = (a) => (a && a.veiculoId ? dados.veiculoPorId(a.veiculoId) : null);
const equipeDe = (a) => (a && a.equipeId ? dados.equipePorId(a.equipeId) : null);
/* Os pares id mais texto (DIRECAO-2 2.2): o id vence quando existe, o texto livre é o que aparece quando não existe id.
   Toda tela deste arquivo passa por estas duas funções, nunca por tipoPorId(a.tipoId).nome. */
const nomeTipo = (a) => dados.nomeDoServico(a);
const nomeCliente = (a) => dados.nomeDoCliente(a);
/** Hora ou período, como a interface mostra: "14:00" em hora exata, "Tarde" no registro aproximado. */
const rotuloQuando = (a) => dados.rotuloPeriodo(a) || a.horaInicio || '';
/** Mapa status interno para chave simples, no formato que src/whatsapp.js espera em ctx.statusSimples. */
function mapaStatusSimples() {
  const mapa = {};
  for (const chave of Object.keys(dados.STATUS_SIMPLES)) {
    for (const interno of dados.STATUS_SIMPLES[chave].inclui) mapa[interno] = chave;
  }
  return mapa;
}
const nomeUsuario = (id) => { const u = dados.usuarioPorId(id); return u ? u.nome : ''; };
const pessoasDe = (a) => Array.from(regras.expandirPessoas(a));
const ehCampo = (u) => !!u && u.perfil === 'campo';
const celular = () => !ui.ehDesktop();
const agora = () => Date.now();
const min = (hora) => util.horaParaMin(hora);

const nomeCurtoDe = util.nomeCurto;
const nomeCurto = (id) => nomeCurtoDe(nomeUsuario(id));
const nomesCurtos = (ids) => ids.map(nomeCurto).filter(Boolean);

/** "Ryan e Daniela", "Ryan, Daniela e Vilson". */
function listarNomes(nomes) {
  if (!nomes.length) return '';
  if (nomes.length === 1) return nomes[0];
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

/** "Entrega, Tatiane Moraes". */
const tituloServico = (a) => [nomeTipo(a), nomeCliente(a)].filter(Boolean).join(', ');
/** Rótulo da auditoria: "Entrega, Tatiane Moraes, 08/09 08:30". */
const rotuloAuditoria = (a) => tituloServico(a) + ', ' + util.fmtData(a.data).slice(0, 5) + ' ' + rotuloQuando(a);
/** Texto das notificações: "Entrega, Tatiane Moraes, ter, 8 de set, 08:30 às 10:00". */
const descricaoNotif = (a) => tituloServico(a) + ', ' + util.fmtDataMedia(a.data) + ', ' +
  (a.horaAproximada ? rotuloQuando(a).toLowerCase() : util.fmtIntervalo(a.horaInicio, a.horaFim));

const gestores = () => dados.gestoresIds();
const supervisores = (a) => dados.supervisoresDoSetor(a.setorId);

function avisar(tipo, titulo, texto, para, a, acoes) {
  dados.notificar({ tipo, titulo, texto, para: unicos(para), link: '#/servico/' + a.id, acoes: acoes || [] });
}

function auditarServico(a, acao, extra = {}) {
  dados.auditar(Object.assign({ acao, entidade: 'agendamento', entidadeId: a.id, rotulo: rotuloAuditoria(a), campos: null, motivo: null, setorId: a.setorId }, extra));
}

function textoMotivo(motivo, lista) {
  if (!motivo || !motivo.opcao) return null;
  const item = (lista || []).find((m) => m.id === motivo.opcao);
  const rotulo = item ? item.rotulo : motivo.opcao;
  return motivo.texto ? rotulo + ': ' + motivo.texto : rotulo;
}

function rotuloMotivo(opcao, lista) {
  const item = (lista || []).find((m) => m.id === opcao);
  return item ? item.rotulo : String(opcao || '');
}

function checklistDoTipo(tipo) {
  return ((tipo && tipo.checklist) || []).map((texto) => ({ id: util.uid('k'), texto, feito: false, por: null, quando: null, obs: '' }));
}

function snapshotEndereco(endereco) {
  if (!endereco) return null;
  return {
    id: endereco.id || '', rotulo: endereco.rotulo || '', logradouro: endereco.logradouro || '', complemento: endereco.complemento || '',
    bairro: endereco.bairro || '', cidade: endereco.cidade || '', referencia: endereco.referencia || ''
  };
}

/**
 * Copia para a área de transferência, com recuo para o textarea escondido quando não há permissão.
 * Exportada porque o cartão de tipo de serviço mora em recursos.js e precisa dela (DIRECAO 4.8).
 * @param {string} texto @returns {Promise<boolean>}
 */
export async function copiarTexto(texto) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(texto); return true; }
  } catch (e) { /* cai no fallback */ }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (e) { return false; }
}

function telaErro(alvo, titulo, texto) {
  ui.montarCabecalho({ voltar: true, titulo });
  ui.renderizar(alvo, '<div class="tela-erro">' + ui.estadoVazio({ icone: 'alerta', titulo, texto, acao: { rotulo: 'Voltar', acao: 'ui:voltar' } }) + '</div>');
}

/* ================================================================== */
/* Registro de rotas                                                   */
/* ================================================================== */

/**
 * Registra #/registrar (a única porta de criação, DIRECAO-2 3), #/agendar e #/agendar/:tipo (redirecionamento
 * permanente para ela, 3.6), mais #/servico/novo (modo avançado), #/servico/:id (camada), #/servico/:id/editar
 * (camada) e #/servico/:id/reagendar (camada). Quem chama: app.iniciar.
 */
export function registrarTelasServico() {
  ui.registrarRota('#/registrar', { render: telaRegistrar, titulo: 'Registrar', requer: ['criarServico'] });
  ui.registrarRota('#/agendar', { render: redirecionarParaRegistrar, titulo: 'Registrar', requer: ['criarServico'] });
  ui.registrarRota('#/agendar/:tipo', { render: redirecionarParaRegistrar, titulo: 'Registrar', requer: ['criarServico'] });
  ui.registrarRota('#/servico/novo', { render: telaFormulario, titulo: 'Novo serviço', camada: true, requer: ['criarServico'] });
  ui.registrarRota('#/servico/:id', { render: telaDetalhe, titulo: 'Serviço', camada: true });
  ui.registrarRota('#/servico/:id/editar', { render: telaFormulario, titulo: 'Editar serviço', camada: true, requer: ['editarServico'] });
  ui.registrarRota('#/servico/:id/reagendar', { render: telaReagendarRota, titulo: 'Reagendar', camada: true, requer: ['reagendar'] });
  document.addEventListener('rota:alterada', (ev) => {
    const rota = ev.detail && ev.detail.rota;
    if (rota !== '#/servico/novo' && rota !== '#/servico/:id/editar') formAtivo = null;
    if (rota !== '#/registrar') registrarAtivo = null;
  });
}

/* ================================================================== */
/* Cartão de serviço (7.10)                                            */
/* ================================================================== */

const ROTULOS_ACAO = {
  abrir: 'Abrir', confirmar: 'Confirmar', reagendar: 'Reagendar', naoRealizado: 'Não realizado', duplicar: 'Duplicar',
  avisarAtraso: 'Avisar atraso', trocarCarro: 'Trocar carro', cancelar: 'Cancelar', concluir: 'Concluir', editar: 'Editar'
};
const ICONES_ACAO = {
  abrir: 'direita', confirmar: 'check', reagendar: 'sincronizar', naoRealizado: 'alerta', duplicar: 'duplicar',
  avisarAtraso: 'relogio', trocarCarro: 'caminhao', cancelar: 'ban', concluir: 'checkduplo', editar: 'editar'
};

function chipAtraso(a) {
  const atraso = regras.atrasoDe(a);
  if (atraso) return ui.chipStatus(a.status, { atraso });
  if (a.atrasoAvisado && regras.statusAtivo(a.status) && a.data === util.hojeISO()) {
    return '<span class="chip cor-alerta">' + icone('relogio', 16) + '<span>Atraso avisado ' + util.fmtDuracao(a.atrasoAvisado.minutos) + '</span></span>';
  }
  return ui.chipStatus(a.status);
}

/* Desde a v4 o cartão diz quem vai pelo mesmo texto do detalhe (DIRECAO-3 4.2), com o " e " antes do
   último e o "(não cadastrado)" de quem só existe em texto. */
function chipQuem(a) {
  const equipe = equipeDe(a);
  if (equipe) return ui.chip(equipe.apelido || equipe.nome, '', 'usuarios');
  const nomes = dados.nomeDosResponsaveis(a);
  return nomes ? ui.chip(nomes, '', 'usuario') : '';
}

function ariaCartao(a, veiculo, extras = {}) {
  const partes = [tituloServico(a), util.fmtDataMedia(a.data),
    a.horaAproximada ? rotuloQuando(a).toLowerCase() : util.fmtIntervalo(a.horaInicio, a.horaFim)];
  if (veiculo) partes.push(veiculo.apelido || veiculo.nome);
  const s = dados.STATUS[a.status];
  partes.push(s ? s.rotulo.toLowerCase() : a.status);
  if (extras.checklist) partes.push('checklist ' + extras.checklist.feitos + ' de ' + extras.checklist.total);
  if (extras.pendente) partes.push('pendente de envio');
  return partes.join(', ');
}

/**
 * O serviço já começou. O botão de "não realizado" só aparece depois da hora de início, não só
 * depois do dia (DIRECAO 4.10): a regra de data do motor continua valendo, esta só aperta mais.
 */
function jaComecou(a) {
  return regras.jaComecou(a);
}

/** Ações do serviço. A regra de hora de início de 4.10 já vive em regras.podeTransitar (regras.jaComecou). */
function acoesDoServico(a, u) {
  const acoes = regras.acoesDisponiveis(a, u);
  if (acoes.naoRealizado && !jaComecou(a)) acoes.naoRealizado = false;
  return acoes;
}

/** Ações de atenção que o usuário da sessão pode executar neste serviço; 'abrir' é sempre permitida. */
function acoesAtencaoPermitidas(a, lista) {
  if (!lista || !lista.length) return [];
  const u = usuarioAtual();
  const pode = acoesDoServico(a, u);
  return lista.filter((acao) => acao === 'abrir' || pode[acao] === true);
}

function acoesCartaoHTML(a, op) {
  const id = esc(a.id);
  const partes = [];
  if (op.variante === 'rota') {
    const total = (a.checklist || []).length;
    const feitos = (a.checklist || []).filter((k) => k.feito).length;
    if (op.reordenar) {
      partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="subir" data-id="' + id + '" aria-label="Mover para cima">' + icone('cima', 16) + '<span>Subir</span></button>');
      partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="descer" data-id="' + id + '" aria-label="Mover para baixo">' + icone('baixo', 16) + '<span>Descer</span></button>');
    } else {
      partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="checklist" data-id="' + id + '">' + icone('check', 16) + '<span>Checklist' + (total ? ' ' + feitos + ' de ' + total : '') + '</span></button>');
      partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="rota" data-id="' + id + '"' + (a.enderecoAConfirmar ? ' disabled title="Endereço a confirmar"' : '') + '>' + icone('mapa', 16) + '<span>Rota</span></button>');
      partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="ligar" data-id="' + id + '">' + icone('telefone', 16) + '<span>Ligar</span></button>');
    }
  }
  for (const acao of acoesAtencaoPermitidas(a, op.acoesAtencao)) {
    if (!ROTULOS_ACAO[acao]) continue;
    partes.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="' + esc(acao) + '" data-id="' + id + '">' + icone(ICONES_ACAO[acao] || 'direita', 16) + '<span>' + esc(ROTULOS_ACAO[acao]) + '</span></button>');
  }
  return partes.join('');
}

/**
 * Cartão de serviço (7.10).
 * @param {object} a @param {{variante:'lista'|'rota', numero?:number|null, mostrarData?:boolean, reordenar?:boolean, acoesAtencao?:string[]}} [opcoes]
 * @returns {string} HTML; ações via data-acao: abrir, checklist, rota, ligar, subir, descer, e as de acoesAtencao (confirmar, reagendar, naoRealizado, duplicar, avisarAtraso, trocarCarro)
 */
export function cartaoServico(a, opcoes = { variante: 'lista' }) {
  const op = Object.assign({ variante: 'lista', numero: null, mostrarData: false, reordenar: false, acoesAtencao: [] }, opcoes || {});
  const veiculo = veiculoDe(a);
  const final = regras.statusFinal(a.status);
  const classes = ['cartao-servico', 'setor-' + esc(a.setorId || '')];
  if (final) classes.push('cartao-servico-final');
  if (a.status === 'cancelado') classes.push('cartao-servico-cancelado');
  if (a.status === 'nao_realizado') classes.push('status-nao-realizado');
  const numero = op.variante === 'rota' && !final && op.numero != null
    ? '<span class="parada-num ' + (veiculo ? classeCarro(veiculo) : '') + '" aria-hidden="true">' + Number(op.numero) + '</span>' : '';
  /* Registro por período mostra o período em cima e a faixa de horas embaixo: o dado guarda 13:30 às 18:30,
     a interface diz "Tarde" (DIRECAO-2 2.2). */
  const hora = '<div class="cartao-servico-hora">' + numero + '<strong>' + esc(a.horaAproximada ? rotuloQuando(a) : a.horaInicio) + '</strong>' +
    '<span class="cartao-servico-hora-fim">' + esc(a.horaAproximada ? a.horaInicio : a.horaFim) + '</span></div>';
  const local = dados.localDe(a);
  const endereco = local
    ? esc(local)
    : (a.origem && a.origem !== 'loja'
      ? '<span class="mudo">Sem local</span>'
      : '<span class="a-confirmar">Endereço a confirmar</span>');
  const sub = (op.mostrarData ? esc(util.rotuloDia(a.data)) + '\u00a0· ' : '') + endereco;
  const meta = [ui.chipSetor(a.setorId), ui.chipCarro(veiculo, { pequeno: true }), chipQuem(a), chipAtraso(a)];
  if (a.sucessorId) {
    const suc = servico(a.sucessorId);
    if (suc) meta.push(ui.chip('Reagendado para ' + util.fmtDataMedia(suc.data), 'cor-info', 'sincronizar'));
  }
  const total = (a.checklist || []).length;
  const feitos = (a.checklist || []).filter((k) => k.feito).length;
  const mostrarProgresso = op.variante === 'rota' && total > 0 && !final;
  const progresso = mostrarProgresso ? '<div aria-hidden="true">' + ui.progresso(feitos, total) + '</div>' : '';
  const corpo = '<div class="cartao-servico-corpo">' +
    '<div class="cartao-servico-titulo">' + esc(tituloServico(a)) + '</div>' +
    '<div class="cartao-servico-sub">' + sub + '</div>' +
    '<div class="cartao-servico-meta">' + meta.filter(Boolean).join('') + '</div>' + progresso + '</div>';
  const pendenteSync = dados.pendenteSync('agendamentos', a.id);
  const pendente = pendenteSync ? '<span class="ponto-sync" title="Pendente de envio" aria-hidden="true"></span>' : '';
  const aria = ariaCartao(a, veiculo, { checklist: mostrarProgresso ? { feitos, total } : null, pendente: pendenteSync });
  const botao = '<button type="button" class="' + classes.join(' ') + '" data-acao="abrir" data-id="' + esc(a.id) + '" aria-label="' + esc(aria) + '">' + hora + corpo + pendente + '</button>';
  const acoes = acoesCartaoHTML(a, op);
  if (!acoes) return botao;
  return '<div class="cartao-servico-envolto mb2" data-servico="' + esc(a.id) + '">' + botao + '<div class="cartao-servico-acoes">' + acoes + '</div></div>';
}

/* ================================================================== */
/* Checklist (8.4 item 6)                                              */
/* ================================================================== */

/** HTML do checklist. @param {object} a @param {{editavel:boolean}} opcoes @returns {string} */
export function checklistHTML(a, opcoes = { editavel: false }) {
  const editavel = !!(opcoes && opcoes.editavel);
  const itens = a.checklist || [];
  const feitos = itens.filter((k) => k.feito).length;
  const linhas = itens.map((k) => {
    const meta = k.feito && k.por ? '<div class="check-meta">' + esc(nomeCurto(k.por)) + (k.quando ? ', ' + esc(util.fmtDataHora(k.quando)) : '') + '</div>' : '';
    const obs = k.obs ? '<div class="check-obs">' + esc(k.obs) + '</div>' : '';
    return '<button type="button" class="check-linha" role="checkbox" aria-checked="' + (k.feito ? 'true' : 'false') + '"' + (k.feito ? ' data-feito' : '') +
      (editavel ? ' data-acao="alternar-check" data-id="' + esc(k.id) + '"' : ' aria-disabled="true" disabled') + '>' +
      '<span class="check-caixa" aria-hidden="true">' + icone('check', 18) + '</span>' +
      '<span class="check-corpo"><span class="check-texto">' + esc(k.texto) + '</span>' + meta + obs + '</span></button>';
  }).join('');
  const vazio = !itens.length ? '<p class="secao-nota">Este serviço não tem checklist.</p>' : '';
  const acoes = editavel
    ? '<div class="checklist-acoes">' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="novo-item-check" data-id="' + esc(a.id) + '">' + icone('mais', 16) + '<span>Item</span></button>' +
      (itens.length ? '<button type="button" class="btn btn-secundario btn-pq" data-acao="obs-check" data-id="' + esc(a.id) + '">' + icone('nota', 16) + '<span>Observação</span></button>' : '') +
      '</div>'
    : '';
  return '<div class="checklist" data-checklist="' + esc(a.id) + '">' +
    '<div class="checklist-cab"><span class="checklist-contagem">' + feitos + ' de ' + itens.length + '</span>' +
    (editavel ? '' : '<span class="turno-texto">Somente leitura</span>') + '</div>' +
    (itens.length ? ui.progresso(feitos, itens.length) : '') + linhas + vazio + acoes + '</div>';
}

function sheetObsChecklist(a) {
  return new Promise((resolver) => {
    let decidido = false;
    const opcoes = (a.checklist || []).map((k) => '<option value="' + esc(k.id) + '">' + esc(k.texto) + '</option>').join('');
    const { el, fechar } = ui.abrirSheet({
      titulo: 'Observação no checklist',
      corpo: '<div class="campo"><label class="campo-rotulo" for="obs-check-item">Item</label><select class="selecao" id="obs-check-item">' + opcoes + '</select></div>' +
        '<div class="campo"><label class="campo-rotulo" for="obs-check-texto">Observação</label><textarea class="areatexto" id="obs-check-texto" rows="3" placeholder="Ex.: cliente pediu para deixar a embalagem"></textarea>' +
        '<p class="msg-erro-campo" id="obs-check-erro" hidden>Escreva a observação.</p></div>',
      rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
        '<button type="button" class="btn btn-primario" data-acao="salvar-obs">Salvar</button>',
      aoFechar: () => { if (!decidido) { decidido = true; resolver(null); } }
    });
    ui.delegar(el, '[data-acao="salvar-obs"]', 'click', () => {
      const itemId = el.querySelector('#obs-check-item').value;
      const texto = el.querySelector('#obs-check-texto').value.trim();
      if (!texto) { el.querySelector('#obs-check-erro').hidden = false; return; }
      decidido = true;
      fechar();
      resolver({ itemId, texto });
    });
  });
}

/** Liga as ações do checklist dentro de raiz; aoMudar roda depois de cada gravação (e depois de fluxos com sheet própria). */
function ligarChecklist(raiz, id, aoMudar) {
  ui.delegar(raiz, '[data-acao="alternar-check"], [data-acao="novo-item-check"], [data-acao="obs-check"]', 'click', async (acao, el) => {
    const a = servico(id);
    if (!a) return;
    if (acao === 'alternar-check') {
      alternarChecklist(id, el.getAttribute('data-id'));
    } else if (acao === 'novo-item-check') {
      const texto = await ui.pedirTexto({ titulo: 'Novo item do checklist', rotulo: 'Descrição do item', obrigatorio: true, rotuloOk: 'Adicionar' });
      if (texto) novoItemChecklist(id, texto);
    } else if (acao === 'obs-check') {
      const r = await sheetObsChecklist(a);
      if (r) obsChecklist(id, r.itemId, r.texto);
    }
    if (typeof aoMudar === 'function') aoMudar(acao);
  });
}

/* ================================================================== */
/* Detalhe do serviço (8.4)                                            */
/* ================================================================== */

function chipsDetalhe(a) {
  const partes = [chipAtraso(a)];
  if (regras.atrasoDe(a) && a.atrasoAvisado) partes.push('<span class="chip cor-alerta">' + icone('relogio', 16) + '<span>Atraso avisado ' + util.fmtDuracao(a.atrasoAvisado.minutos) + '</span></span>');
  if (dados.pendenteSync('agendamentos', a.id)) partes.push('<span class="chip"><span class="ponto-sync" aria-hidden="true"></span><span>Pendente de envio</span></span>');
  partes.push(ui.chipSetor(a.setorId));
  partes.push(ui.chipCarro(veiculoDe(a)));
  return '<div class="detalhe-chips">' + partes.filter(Boolean).join('') + '</div>';
}

/** Texto de um conflito: "Fiorino ocupada: Entrega, Tatiane Moraes, 08:30 às 10:00", "Domingo: loja fechada", "Ryan de folga". */
function textoConflito(c) {
  if (c.motivo === 'sobreposicao') return c.rotulo + (c.recurso === 'pessoa' ? ' ocupado: ' : ' ocupada: ') + c.comTexto;
  if (c.motivo === 'indisponivel') return c.rotulo + ' indisponível: ' + c.comTexto;
  if (c.recurso === 'horario' && c.motivo === 'fora_horario') return 'Fora do horário. ' + c.comTexto;
  if (c.motivo === 'sem_folga_deslocamento') return c.rotulo + ': ' + c.comTexto;
  if (c.recurso === 'horario') return c.comTexto;
  return c.comTexto;
}

function linhaConflitoHTML(c, acoesHTML) {
  const ic = c.severidade === 'bloqueio' ? 'cadeado' : c.severidade === 'aviso' ? 'info' : 'alerta';
  return '<div class="conflito-linha" data-severidade="' + esc(c.severidade) + '">' + icone(ic, 18) +
    '<div class="conflito-linha-corpo"><div class="conflito-linha-rotulo">' + esc(textoConflito(c)) + '</div>' +
    (acoesHTML ? '<div class="conflito-acoes">' + acoesHTML + '</div>' : '') + '</div></div>';
}

function faixaDetalhe(a, u, acoes) {
  const graves = (regras.conflitosDoDia(a.data).get(a.id) || []).filter((c) => c.recurso !== 'liberacao');
  const pendente = !!(a.liberacao && a.liberacao.estado === 'pendente');
  if (!graves.length && !pendente) return '';
  const sev = regras.severidadeMaxima(graves) || 'conflito';
  let html = '<section class="faixa-conflito faixa-liberacao" data-severidade="' + esc(sev) + '" tabindex="-1" aria-label="' + (pendente ? 'Liberação pendente' : 'Conflito') + '">';
  html += '<div class="faixa-conflito-titulo">' + icone(pendente ? 'cadeado' : 'alerta', 18) + '<span>' + (pendente ? 'Liberação pendente' : 'Em conflito') + '</span></div>';
  if (pendente) {
    html += '<p class="conflito-linha-texto">Pedido de ' + esc(nomeCurto(a.liberacao.pedidoPor)) + (a.liberacao.pedidoEm ? ', ' + esc(util.tempoRelativo(a.liberacao.pedidoEm)) : '') +
      (a.liberacao.texto ? ': ' + esc(a.liberacao.texto) : '') + '</p>';
  }
  html += graves.map((c) => linhaConflitoHTML(c)).join('');
  if (pendente && acoes.liberar) {
    html += '<div class="btn-grupo">' +
      '<button type="button" class="btn btn-primario btn-pq" data-acao="liberar" data-id="' + esc(a.id) + '">Liberar</button>' +
      (acoes.editar ? '<button type="button" class="btn btn-secundario btn-pq" data-acao="remanejar" data-id="' + esc(a.id) + '">Remanejar</button>' : '') +
      (acoes.cancelar ? '<button type="button" class="btn btn-fantasma btn-pq" data-acao="cancelar" data-id="' + esc(a.id) + '">Cancelar</button>' : '') +
      '</div>';
  } else if (pendente) {
    html += '<p class="faixa-conflito-espera">Aguardando liberação da gerência</p>';
  } else if (acoes.editar) {
    html += '<div class="btn-grupo"><button type="button" class="btn btn-secundario btn-pq" data-acao="remanejar" data-id="' + esc(a.id) + '">Remanejar</button></div>';
  }
  return html + '</section>';
}

/**
 * Linha do "quando" no detalhe (DIRECAO-2 2.2 e critério 2 do lote 2): o registro por período mostra o período
 * em 16 px e, em texto menor, a faixa de horas que ficou gravada. Hora exata não repete nada.
 */
function linhaQuandoHTML(a) {
  if (!a.horaAproximada) return '';
  return '<div class="registrar-quando-detalhe">' +
    '<span class="registrar-quando-rotulo">' + esc(rotuloQuando(a)) + '</span>' +
    '<span class="registrar-quando-horas">das ' + esc(a.horaInicio || '') + ' às ' + esc(a.horaFim || '') + '</span></div>';
}

/**
 * Cartão do cliente. Com cliente cadastrado é o de sempre, com telefone, endereço e os quatro contatos.
 * No registro do colaborador (DIRECAO-2 2.2), cliente e local são texto livre e podem estar vazios: aí o cartão
 * encolhe para o que existe, e some de vez quando não existe nada.
 */
function cartaoClienteHTML(a) {
  const cadastrado = clienteDe(a);
  if (!cadastrado) return cartaoClienteLivreHTML(a);
  const c = cadastrado;
  const semEndereco = a.enderecoAConfirmar || !a.endereco;
  const endereco = semEndereco
    ? '<div class="detalhe-endereco" data-pendente>' + icone('mapa', 16) + ' Endereço a confirmar com o cliente</div>'
    : '<button type="button" class="detalhe-endereco" data-acao="copiar-endereco" data-id="' + esc(a.id) + '" title="Tocar para copiar">' + esc(util.enderecoTexto(a.endereco)) +
      (a.endereco.referencia ? '<span class="mudo"> (' + esc(a.endereco.referencia) + ')</span>' : '') + '</button>';
  const botao = (acao, ic, rotulo, desativado, titulo) =>
    '<button type="button" class="btn" data-acao="' + acao + '" data-id="' + esc(a.id) + '"' + (desativado ? ' disabled title="' + esc(titulo || '') + '" aria-disabled="true"' : '') + '>' + icone(ic, 22) + '<span>' + rotulo + '</span></button>';
  return '<div class="cartao detalhe-cliente">' +
    '<div class="detalhe-cliente-nome">' + esc(c.nome) + '</div>' +
    (c.telefone ? '<div class="detalhe-cliente-tel">' + esc(util.telFmt(c.telefone)) + '</div>' : '') +
    endereco +
    (a.obs ? '<div class="detalhe-obs">' + esc(a.obs) + '</div>' : '') +
    '<div class="grid-contato">' +
    botao('rota', 'mapa', 'Rota', semEndereco, 'Endereço a confirmar') +
    botao('ligar', 'telefone', 'Ligar', !c.telefone, 'Sem telefone') +
    botao('whatsapp', 'whatsapp', 'WhatsApp', !c.telefone, 'Sem telefone') +
    botao('compartilhar', 'compartilhar', 'Compartilhar') +
    '</div>' +
    /* Mensagem pronta ao cliente (DIRECAO 4.9): confirmação, lembrete de véspera e as outras. */
    (c.telefone ? '<button type="button" class="agendar-link" data-acao="mensagens" data-id="' + esc(a.id) + '">' +
      icone('nota', 18) + '<span>Mensagem pronta ao cliente</span></button>' : '') +
    '</div>';
}

/** Cartão do registro sem cliente cadastrado: nome solto, local solto e observação, sem botões de contato. */
function cartaoClienteLivreHTML(a) {
  const nome = a.clienteId ? 'Cliente removido' : dados.nomeDoCliente(a);
  const local = String(a.localTexto || '').trim();
  if (!nome && !local && !a.obs) return '';
  return '<div class="cartao detalhe-cliente">' +
    (nome ? '<div class="detalhe-cliente-nome">' + esc(nome) + '</div>' : '') +
    (local ? '<div class="detalhe-endereco" data-livre>' + icone('mapa', 16) + ' ' + esc(local) + '</div>' : '') +
    (a.obs ? '<div class="detalhe-obs">' + esc(a.obs) + '</div>' : '') +
    '</div>';
}

function quemVaiHTML(a, acoes) {
  const equipe = equipeDe(a);
  const veiculo = veiculoDe(a);
  const tipo = tipoDe(a);
  const chips = [];
  for (const id of pessoasDe(a)) {
    const u = dados.usuarioPorId(id);
    if (!u) continue;
    chips.push('<span class="chip">' + ui.avatar(u, { tamanho: 'pq' }) + '<span>' + esc(nomeCurtoDe(u.nome)) + '</span></span>');
  }
  const semCadastro = String(a.responsavelTexto || '').trim();
  if (semCadastro) chips.push(ui.chip(semCadastro + ' (não cadastrado)', '', 'usuario'));
  if (equipe) chips.push(ui.chip(equipe.nome || equipe.apelido, '', 'usuarios'));
  if (veiculo) {
    chips.push('<span class="chip chip-carro ' + classeCarro(veiculo) + '"><span class="inicial">' + esc(String(veiculo.inicial || '?').toUpperCase()) + '</span><span>' + esc(veiculo.apelido || veiculo.nome) + (veiculo.placa ? ', ' + esc(veiculo.placa) : '') + '</span></span>');
  } else {
    const precisa = tipo && tipo.precisaVeiculo === 'sim';
    chips.push(ui.chip(precisa && !a.semCarroConfirmado ? 'Precisa de carro' : 'Sem carro', precisa && !a.semCarroConfirmado ? 'cor-alerta' : '', 'caminhao'));
  }
  const trocar = acoes.trocarCarro ? '<button type="button" class="btn btn-secundario btn-pq" data-acao="editar" data-id="' + esc(a.id) + '">Trocar</button>' : '';
  return '<section class="secao"><div class="secao-titulo">Quem vai</div><div class="detalhe-quem">' + chips.join('') + trocar + '</div></section>';
}

function cartaoMotivo(rotulo, texto, meta) {
  return '<div class="cartao"><div class="detalhe-motivo-rotulo">' + esc(rotulo) + '</div><div class="detalhe-motivo-texto">' + texto + '</div>' +
    (meta ? '<div class="detalhe-motivo-meta">' + esc(meta) + '</div>' : '') + '</div>';
}

function motivosHTML(a) {
  const cartoes = [];
  const quem = (m) => (m && m.por ? nomeCurto(m.por) + (m.quando ? ', ' + util.fmtDataHora(m.quando) : '') : '');
  if (a.justificativaConflito) cartoes.push(cartaoMotivo('Justificativa de conflito', esc(a.justificativaConflito), a.liberacao && a.liberacao.estado === 'liberada' ? 'Liberado por ' + nomeCurto(a.liberacao.decididoPor) + (a.liberacao.decididoEm ? ', ' + util.fmtDataHora(a.liberacao.decididoEm) : '') : ''));
  if (a.motivoCancelamento) cartoes.push(cartaoMotivo('Motivo do cancelamento', esc(textoMotivo(a.motivoCancelamento, dados.MOTIVOS_CANCELAMENTO)), quem(a.motivoCancelamento)));
  if (a.motivoNaoRealizado) cartoes.push(cartaoMotivo('Motivo do não realizado', esc(textoMotivo(a.motivoNaoRealizado, dados.MOTIVOS_NAO_REALIZADO)), quem(a.motivoNaoRealizado)));
  if ((a.reagendamentos || []).length) {
    const linhas = a.reagendamentos.map((r) =>
      '<div class="reagendamento-linha"><span class="de">' + esc(util.fmtDataMedia(r.de.data) + ' ' + util.fmtIntervalo(r.de.horaInicio, r.de.horaFim)) + '</span>' +
      '<span class="depois">' + esc(util.fmtDataMedia(r.para.data) + ' ' + util.fmtIntervalo(r.para.horaInicio, r.para.horaFim)) + '</span>' +
      '<span class="mudo">' + esc(textoMotivo(r.motivo, dados.MOTIVOS_REAGENDAMENTO) || '') + (r.por ? ', ' + esc(nomeCurto(r.por)) : '') + '</span></div>'
    ).join('');
    cartoes.push(cartaoMotivo('Reagendamentos', linhas));
  }
  if (a.status === 'concluido') {
    const assinatura = a.assinaturaId ? dados.repo.obter('assinaturas', a.assinaturaId) : null;
    const linhas = [];
    if (a.obsConclusao) linhas.push(esc(a.obsConclusao));
    linhas.push(a.clienteAprovou ? 'Cliente aprovou o serviço' : 'Sem aprovação registrada do cliente');
    if (a.pendenciasConclusao) linhas.push('<span class="cor-alerta">Pendências: ' + esc(a.pendenciasConclusao) + '</span>');
    if (assinatura && assinatura.dataUrl) linhas.push('<img class="assinatura-mini" src="' + esc(assinatura.dataUrl) + '" alt="Assinatura do cliente">');
    cartoes.push(cartaoMotivo('Conclusão', linhas.join('<br>'), a.concluidoEm ? 'Concluído em ' + util.fmtDataHora(a.concluidoEm) : ''));
  }
  if (a.sucessorId) {
    const s = servico(a.sucessorId);
    if (s) cartoes.push(cartaoMotivo('Reagendado para', '<button type="button" class="btn btn-secundario btn-pq" data-acao="abrir" data-id="' + esc(s.id) + '">' + icone('direita', 16) + '<span>' + esc(util.fmtDataMedia(s.data) + ', ' + s.horaInicio) + '</span></button>'));
  }
  if (a.origemId) {
    const o = servico(a.origemId);
    if (o) cartoes.push(cartaoMotivo('Duplicado de', '<button type="button" class="btn btn-secundario btn-pq" data-acao="abrir" data-id="' + esc(o.id) + '">' + icone('voltar', 16) + '<span>' + esc(util.fmtDataMedia(o.data) + ', ' + (dados.STATUS[o.status] || {}).rotulo) + '</span></button>'));
  }
  return cartoes.length ? '<section class="secao detalhe-motivos"><div class="secao-titulo">Registros</div>' + cartoes.join('') + '</section>' : '';
}

/**
 * Nota interna (DIRECAO 4.11): recado de escritório, separado de `obs`, que é instrução para quem vai ao serviço.
 * Não aparece para o perfil campo e não entra no texto de compartilhamento.
 */
function notaInternaHTML(a, u) {
  if (ehCampo(u)) return '';
  return '<section class="secao"><div class="secao-titulo">Nota interna</div>' +
    ui.campo({ id: 'nota-interna', rotulo: 'Só a loja vê esta nota', multilinha: true, valor: a.notaInterna || '', atributos: 'data-campo="notaInterna" rows="3" placeholder="Combinado com o cliente, cobrança, pendência de escritório"' }) +
    '<div class="btn-grupo"><button type="button" class="btn btn-secundario btn-pq" data-acao="salvar-nota" data-id="' + esc(a.id) + '">Salvar nota</button></div></section>';
}

/** Bloco "Deste cliente" (DIRECAO 4.15): três passados e três futuros, sem criar tela de clientes. */
function historicoClienteHTML(a) {
  if (!a.clienteId) return '';
  const todos = repo.listar('agendamentos', (x) => x.clienteId === a.clienteId && x.id !== a.id)
    .sort((x, y) => util.compararISO(x.data, y.data) || String(x.horaInicio).localeCompare(String(y.horaInicio)));
  const hoje = util.hojeISO();
  const passados = todos.filter((x) => x.data < hoje).slice(-3);
  const futuros = todos.filter((x) => x.data >= hoje).slice(0, 3);
  const lista = passados.concat(futuros);
  if (!lista.length) return '';
  const linhas = lista.map((x) => {
    const s = dados.STATUS[x.status] || {};
    return '<button type="button" class="cliente-historico-linha" data-acao="abrir" data-id="' + esc(x.id) + '">' +
      '<span class="cliente-historico-data">' + esc(util.fmtDataMedia(x.data)) + '</span>' +
      '<span class="cliente-historico-texto">' + esc(nomeTipo(x) + ' · ' + (s.rotulo || x.status)) + '</span>' +
      icone('direita', 16) + '</button>';
  }).join('');
  return '<section class="secao"><div class="secao-titulo">Deste cliente</div><div class="cliente-historico">' + linhas + '</div></section>';
}

const TOM_AUDITORIA = {
  servico_cancelado: 'erro', servico_nao_realizado: 'erro', servico_concluido: 'ok', liberacao_concedida: 'ok',
  conflito_justificado: 'alerta', liberacao_pedida: 'alerta', atraso_avisado: 'alerta', servico_reagendado: 'alerta', status_desfeito: 'alerta'
};

function historicoHTML(a) {
  const registros = dados.auditoriaDe('agendamento', a.id).sort(dados.compararAuditoria);
  if (!registros.length) return '';
  const itens = registros.map((l) => {
    const campos = (l.campos || []).map((c) => '<span>' + esc((c.rotulo || dados.rotuloCampo(c.campo)) + ': ' + (c.antes || 'vazio') + ' para ' + (c.depois || 'vazio')) + '</span>').join('');
    return '<div class="timeline-item"' + (TOM_AUDITORIA[l.acao] ? ' data-tom="' + TOM_AUDITORIA[l.acao] + '"' : '') + '>' +
      '<div class="timeline-quando">' + esc(util.fmtDataHora(l.ts)) + '</div>' +
      '<div class="timeline-texto">' + esc((dados.ACOES_AUDITORIA[l.acao] || l.acao) + (l.userId ? ', ' + nomeCurto(l.userId) : '')) + (l.origem === 'fila' ? ' <span class="mudo">(offline)</span>' : '') + '</div>' +
      (campos ? '<div class="timeline-campos">' + campos + '</div>' : '') +
      (l.motivo ? '<div class="timeline-motivo">' + esc(l.motivo) + '</div>' : '') + '</div>';
  }).join('');
  return '<section class="secao"><div class="secao-titulo">Histórico</div><div class="timeline">' + itens + '</div></section>';
}

function rodapeDetalheHTML(a, u, passo, acoes) {
  const temMenu = ['editar', 'reagendar', 'cancelar', 'naoRealizado', 'duplicar', 'avisarAtraso', 'reabrir', 'trocarCarro', 'liberar'].some((k) => acoes[k]);
  const menu = temMenu ? '<button type="button" class="btn-icone" data-acao="menu" data-id="' + esc(a.id) + '" aria-label="Mais ações">' + icone('pontos', 22) + '</button>' : '';
  let principal;
  if (passo) {
    principal = '<button type="button" class="btn btn-primario btn-grande" data-acao="passo" data-id="' + esc(a.id) + '" data-valor="' + esc(passo.para) + '">' + esc(passo.rotulo) + '</button>';
  } else if (ehCampo(u) && (a.status === 'aguardando_conf' || a.status === 'reagendado')) {
    principal = '<div class="rodape-status">' + icone('relogio', 18) + '<span>Aguardando confirmação da loja</span></div>';
  } else {
    principal = '<div class="rodape-status">' + chipAtraso(a) + '</div>';
  }
  return '<div class="rodape-acoes">' + principal + menu + '</div>';
}

/** Detalhe (8.4). Trata inexistente e fora do setor. @param {{params:{id:string}, query:{foco?:string}, alvo:HTMLElement, usuario:object}} ctx */
export function telaDetalhe(ctx) {
  const { params, alvo } = ctx;
  const query = ctx.query || {};
  const u = ctx.usuario || usuarioAtual();
  const a = servico(params.id);
  if (!a) { telaErro(alvo, 'Serviço não encontrado', 'Ele pode ter sido removido ou o endereço está errado.'); return; }
  if (!u || !dados.visivel(a, u)) { telaErro(alvo, 'Serviço fora do seu setor', 'Você só vê os serviços dos seus setores ou em que está alocado.'); return; }
  const acoes = regras.acoesDisponiveis(a, u);
  const passo = regras.proximoPasso(a, u);
  // Data e horário viram um bloco só (espaços fixos): no celular o subtítulo
  // quebra em duas linhas logo depois do " · " e a hora nunca some nem parte no meio.
  // O espaço antes do ponto também é fixo, para o separador nunca ficar sozinho no fim da linha.
  const quando = (util.fmtDataMedia(a.data) + ', ' +
    (a.horaAproximada ? rotuloQuando(a).toLowerCase() : util.fmtIntervalo(a.horaInicio, a.horaFim))).replace(/ /g, '\u00a0');
  const cab = ui.montarCabecalho({
    voltar: true, grande: true, titulo: nomeTipo(a),
    /* Registro sem cliente não começa o subtítulo com o separador solto. */
    subtitulo: [nomeCliente(a), quando].filter(Boolean).join('\u00a0· '),
    acoes: '<button type="button" class="btn-icone" data-acao="menu" data-id="' + esc(a.id) + '" aria-label="Mais ações">' + icone('pontos', 22) + '</button>'
  });
  if (cab) ui.delegar(cab, '[data-acao="menu"]', 'click', () => abrirMenuAcoes(a.id));
  const html = '<div class="detalhe">' + chipsDetalhe(a) + linhaQuandoHTML(a) + faixaDetalhe(a, u, acoes) + cartaoClienteHTML(a) + quemVaiHTML(a, acoes) +
    '<section class="secao"><div class="secao-titulo">Checklist</div>' + checklistHTML(a, { editavel: acoes.checklist }) + '</section>' +
    notaInternaHTML(a, u) + historicoClienteHTML(a) +
    motivosHTML(a) + historicoHTML(a) + '</div>' + rodapeDetalheHTML(a, u, passo, acoes);
  ui.renderizar(alvo, html, (raiz) => {
    ligarChecklist(raiz, a.id);
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (['alternar-check', 'novo-item-check', 'obs-check'].includes(acao)) return;
      if (acao === 'salvar-nota') {
        const campo = raiz.querySelector('[data-campo="notaInterna"]');
        const r = salvarNotaInterna(a.id, campo ? campo.value : '');
        ui.toast(r.ok ? (r.mudou ? 'Nota salva' : 'Nada mudou') : r.erro, r.ok ? (r.mudou ? 'ok' : 'info') : 'erro');
        return;
      }
      executarAcao(acao, el.getAttribute('data-id') || a.id, { para: el.getAttribute('data-valor') });
    });
    if (query.foco === 'conflito') {
      const faixa = raiz.querySelector('.faixa-conflito');
      if (faixa) { faixa.scrollIntoView({ block: 'center' }); try { faixa.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
    }
  });
}

function itemMenu(acao, id, ic, rotulo, perigo) {
  return '<button type="button" class="item' + (perigo ? ' item-perigo' : '') + '" data-acao="' + esc(acao) + '" data-id="' + esc(id) + '">' +
    '<span class="item-icone">' + icone(ic, 20) + '</span><span class="item-corpo"><span class="item-titulo">' + esc(rotulo) + '</span></span></button>';
}

function abrirMenuAcoes(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const acoes = acoesDoServico(a, u);
  const itens = [];
  if (acoes.editar) itens.push(itemMenu('editar', id, 'editar', 'Editar'));
  if (acoes.reagendar) itens.push(itemMenu('reagendar', id, 'sincronizar', 'Reagendar'));
  if (acoes.reagendar) itens.push(itemMenu('sugestoes', id, 'relogio', 'Sugerir horários ao cliente'));
  if (acoes.trocarCarro) itens.push(itemMenu('trocarCarro', id, 'caminhao', 'Trocar carro'));
  if (acoes.duplicar) itens.push(itemMenu('duplicar', id, 'duplicar', 'Duplicar para outra data'));
  if (acoes.avisarAtraso) itens.push(itemMenu('avisarAtraso', id, 'relogio', 'Avisar atraso'));
  if (acoes.liberar) itens.push(itemMenu('liberar', id, 'cadeado', 'Liberar conflito'));
  itens.push(itemMenu('copiar-grupo', id, 'copiar', 'Copiar para o grupo'));
  if (acoes.editar || regras.podeTransitar(a, 'em_andamento', u).ok) itens.push(itemMenu('colar-grupo', id, 'nota', 'Colar status do grupo'));
  itens.push(itemMenu('mensagens', id, 'whatsapp', 'Mensagem ao cliente'));
  itens.push(itemMenu('compartilhar', id, 'compartilhar', 'Compartilhar'));
  if (acoes.reabrir) itens.push(itemMenu('reabrir', id, 'historico', 'Reabrir'));
  if (acoes.cancelar) itens.push(itemMenu('cancelar', id, 'ban', 'Cancelar', true));
  if (acoes.naoRealizado) itens.push(itemMenu('naoRealizado', id, 'alerta', 'Não realizado', true));
  const { el, fechar } = ui.abrirSheet({ titulo: tituloServico(a), corpo: '<div class="lista sheet-lista-acoes menu-acoes">' + itens.join('') + '</div>' });
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao.startsWith('ui:')) return;
    fechar();
    executarAcao(acao, alvo.getAttribute('data-id') || id);
  });
}

async function pedirJustificativaLiberacao(id) {
  const texto = await ui.pedirTexto({ titulo: 'Liberar conflito', rotulo: 'Justificativa da liberação', obrigatorio: true, multilinha: true, rotuloOk: 'Liberar' });
  if (!texto) return;
  const r = liberarConflito(id, texto);
  if (!r.ok) ui.toast(r.erro, 'erro');
}

async function reabrir(id) {
  const motivo = await ui.pedirMotivo({ titulo: 'Reabrir serviço', opcoes: [{ id: 'ajuste', rotulo: 'Ajuste no registro' }, { id: 'nao_terminou', rotulo: 'Serviço não tinha terminado' }, { id: 'outro', rotulo: 'Outro' }], rotuloOk: 'Reabrir', textoObrigatorio: true });
  if (!motivo) return;
  const r = mudarStatus(id, 'em_andamento', { motivo, semDesfazer: true });
  if (!r.ok) ui.toast(r.erro, 'erro');
}

function executarPasso(id, para) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const destino = para || (regras.proximoPasso(a, u) || {}).para;
  if (!destino) return;
  if (destino === 'concluido') { abrirConcluir(id); return; }
  statusDeCampo(id, destino);
}

/**
 * "A caminho" e "Em andamento" são passos de campo: num serviço de outro dia quase sempre é toque errado,
 * então o app pergunta antes. É aviso, não bloqueio (o dono pode ter antecipado a visita).
 */
async function statusDeCampo(id, para) {
  const a = servico(id);
  if (a && a.data > util.hojeISO() && (para === 'a_caminho' || para === 'em_andamento')) {
    const ok = await ui.confirmar({
      titulo: 'Este serviço é de ' + util.fmtDataMedia(a.data),
      texto: 'Marcar "' + (para === 'a_caminho' ? 'A caminho' : 'Em andamento') + '" agora avisa a gestão como se a equipe já tivesse saído. Se a data mudou, prefira reagendar.',
      rotuloOk: 'Marcar assim mesmo', rotuloCancelar: 'Voltar'
    });
    if (!ok) return;
  }
  const r = mudarStatus(id, para);
  if (!r.ok) ui.toast(r.erro, 'erro');
}

/**
 * Executa uma ação de cartão, menu ou rodapé pelo nome do data-acao (extra ao contrato; agenda e recursos podem delegar aqui).
 * @param {string} acao @param {string} id @param {{para?:string}} [opcoes] @returns {boolean} true quando a ação foi reconhecida
 */
export function executarAcao(acao, id, opcoes = {}) {
  switch (acao) {
    case 'abrir': ui.irPara('#/servico/' + id); return true;
    case 'editar': case 'trocar': ui.irPara('#/servico/' + id + '/editar'); return true;
    case 'remanejar': ui.irPara('#/servico/' + id + '/editar?foco=conflito'); return true;
    case 'reagendar': abrirReagendar(id); return true;
    case 'cancelar': abrirCancelar(id); return true;
    case 'naoRealizado': abrirNaoRealizado(id); return true;
    case 'concluir': abrirConcluir(id); return true;
    case 'confirmar': { const r = mudarStatus(id, 'confirmado'); if (!r.ok) ui.toast(r.erro, 'erro'); return true; }
    case 'aCaminho': statusDeCampo(id, 'a_caminho'); return true;
    case 'iniciar': statusDeCampo(id, 'em_andamento'); return true;
    case 'passo': executarPasso(id, opcoes.para); return true;
    case 'duplicar': duplicar(id); return true;
    case 'avisarAtraso': abrirAvisarAtraso(id); return true;
    case 'trocarCarro': abrirTrocarCarro(id); return true;
    case 'checklist': abrirChecklist(id); return true;
    case 'compartilhar': compartilhar(id); return true;
    case 'copiar-grupo': case 'copiarGrupo': copiarParaGrupo(id); return true;
    case 'colar-grupo': abrirColarDoWhatsApp({ servicoId: id }); return true;
    case 'mensagens': abrirMensagens(id); return true;
    case 'sugestoes': abrirSugestoes(id); return true;
    case 'rota': abrirRota(id); return true;
    case 'ligar': ligar(id); return true;
    case 'whatsapp': whatsapp(id); return true;
    case 'copiar-endereco': case 'copiarEndereco': copiarEndereco(id); return true;
    case 'reabrir': reabrir(id); return true;
    case 'liberar': pedirJustificativaLiberacao(id); return true;
    case 'menu': abrirMenuAcoes(id); return true;
    default: return false;
  }
}

/* ================================================================== */
/* Gravação (8.3) e status (6.2)                                       */
/* ================================================================== */

/* Origem do documento (DIRECAO-2 2.1): 'loja' é o despacho, com tudo obrigatório; 'app' e 'whatsapp' são o registro
   do colaborador, em que só data e "o que vou fazer" são obrigatórios. Documento sem origem é despacho, como na v2. */
const ORIGEM_PADRAO = 'loja';
const ehDespacho = (origem) => (origem || ORIGEM_PADRAO) === 'loja';

function normalizarCandidato(candidato, original) {
  const base = original || {};
  const c = Object.assign({}, base, candidato || {});
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  const enderecoAConfirmar = !!c.enderecoAConfirmar;
  const periodo = dados.PERIODOS[c.periodo] ? c.periodo : 'hora';
  return {
    tipoId: c.tipoId || null,
    tipoLivre: String(c.tipoLivre || '').trim(),
    setorId: c.setorId || (tipo ? tipo.setorPadrao : null),
    data: c.data || '',
    horaInicio: c.horaInicio || '',
    horaFim: c.horaFim || '',
    periodo,
    horaAproximada: periodo !== 'hora',
    clienteId: c.clienteId || null,
    clienteNome: c.clienteId ? '' : String(c.clienteNome || '').trim(),
    endereco: enderecoAConfirmar ? null : snapshotEndereco(c.endereco),
    enderecoAConfirmar,
    localTexto: String(c.localTexto || '').trim(),
    responsaveis: unicos(c.responsaveis || []),
    /* Quem vai e não está no cadastro (DIRECAO-3 4.2): texto livre ao lado dos ids, nunca no lugar deles. */
    responsavelTexto: String(c.responsavelTexto || '').trim(),
    equipeId: c.equipeId || null,
    veiculoId: c.veiculoId || null,
    veiculoTexto: c.veiculoId ? '' : String(c.veiculoTexto || '').trim(),
    semCarroConfirmado: !!c.semCarroConfirmado && !c.veiculoId,
    obs: String(c.obs || '').trim(),
    origem: c.origem || ORIGEM_PADRAO,
    autorTexto: String(c.autorTexto || '').trim(),
    mensagemOriginal: String(c.mensagemOriginal || ''),
    criadoPor: c.criadoPor || null,
    origemId: c.origemId || null
  };
}

/** Algum agendamento em choque já tem pedido de liberação pendente. */
function pedidoPendenteEmChoque(conflitos) {
  return (conflitos || []).some((c) => {
    if (c.severidade !== 'conflito' || !c.comId) return false;
    const outro = servico(c.comId);
    return !!(outro && outro.liberacao && outro.liberacao.estado === 'pendente');
  });
}

/** Em edição, conflito já coberto por justificativa ou liberação anterior quando horário e recursos não mudaram. */
function conflitoJaCoberto(original, c) {
  if (!original) return false;
  const coberto = !!original.justificativaConflito || !!(original.liberacao && original.liberacao.estado === 'liberada');
  if (!coberto) return false;
  return !CAMPOS_HORARIO.concat(CAMPOS_RECURSOS).some((k) => difere(original[k], c[k]));
}

/**
 * Decide como gravar diante dos conflitos: normal, justificar, pedir ou bloqueado, com a mensagem de erro quando não dá.
 * Usada pelo formulário, pelo reagendar e pelo trocar carro.
 * @returns {{modo:string, erro:string|null, pedidoPendente:boolean}}
 */
function decidirGravacao(conflitos, usuario, textos = {}, original = null, c = null) {
  const sev = regras.severidadeMaxima(conflitos);
  if (sev === 'bloqueio') return { modo: 'bloqueado', erro: 'Carro indisponível: escolha outro carro ou horário', pedidoPendente: false };
  if (sev !== 'conflito' || conflitoJaCoberto(original, c)) return { modo: 'normal', erro: null, pedidoPendente: false };
  const justificativa = String(textos.justificativa || '').trim();
  const pedido = String(textos.pedido || '').trim();
  const podeJustificar = !!dados.pode('justificarConflito', usuario);
  const podePedir = !!dados.pode('pedirLiberacao', usuario);
  const pedidoPendente = podePedir && !podeJustificar && pedidoPendenteEmChoque(conflitos);
  if (podeJustificar) return justificativa ? { modo: 'justificar', erro: null, pedidoPendente } : { modo: 'justificar', erro: 'Escreva a justificativa para salvar em conflito', pedidoPendente };
  if (podePedir) {
    if (pedidoPendente) return { modo: 'pedir', erro: 'Já existe um pedido pendente para este recurso neste horário', pedidoPendente };
    return pedido ? { modo: 'pedir', erro: null, pedidoPendente } : { modo: 'pedir', erro: 'Escreva o motivo do pedido de liberação', pedidoPendente };
  }
  return { modo: 'bloqueado', erro: 'Há conflito neste horário: escolha outro horário ou recurso', pedidoPendente };
}

function novaLiberacao(u, texto) {
  return { estado: 'pendente', pedidoPor: u.id, pedidoEm: agora(), texto: String(texto || '').trim(), decididoPor: null, decididoEm: null };
}

/** Auditoria e notificação da justificativa ou do pedido, dentro da transação de quem grava. */
function registrarConflito(a, modo, textos, u) {
  if (modo === 'justificar') {
    auditarServico(a, 'conflito_justificado', { motivo: String(textos.justificativa || '').trim() });
    avisar('conflito', 'Conflito justificado', nomeCurtoDe(u.nome) + ' gravou em conflito: ' + descricaoNotif(a), gestores(), a);
  } else if (modo === 'pedir') {
    auditarServico(a, 'liberacao_pedida', { motivo: String(textos.pedido || '').trim() });
    avisar('conflito', 'Liberação pedida', nomeCurtoDe(u.nome) + ' pediu liberação: ' + descricaoNotif(a), gestores(), a, [{ rotulo: 'Abrir serviço', rota: '#/servico/' + a.id }]);
  }
}

function gravarNovo(c, u, tipo, opcoes) {
  /* O registro do colaborador nasce confirmado: ele está avisando o que vai fazer, não pedindo autorização, e o
     perfil campo não tem a capacidade de confirmar depois (DIRECAO-2 2.5 e 6.2). O despacho continua aguardando. */
  const statusInicial = opcoes.status || (ehDespacho(c.origem) ? 'aguardando_conf' : 'confirmado');
  const doc = Object.assign({}, c, {
    status: statusInicial, checklist: checklistDoTipo(tipo), criadoPor: c.criadoPor || u.id,
    justificativaConflito: opcoes.modo === 'justificar' ? String(opcoes.justificativa).trim() : null,
    liberacao: opcoes.modo === 'pedir' ? novaLiberacao(u, opcoes.pedido) : null,
    /* O registro colado do grupo já nasce no status que a mensagem trazia; o "não realizado" vem com o motivo
       escolhido na conferência, porque o grupo perde exatamente essa informação (DIRECAO-2 D6). */
    motivoCancelamento: null, motivoNaoRealizado: opcoes.motivoNaoRealizado || null, reagendamentos: [], atrasoAvisado: null,
    obsConclusao: null, pendenciasConclusao: null, clienteAprovou: null, assinaturaId: null, concluidoEm: null,
    ordemRota: null, sucessorId: null
  });
  return repo.transacao(() => {
    const novo = repo.criar('agendamentos', doc);
    auditarServico(novo, opcoes.acaoAuditoria || 'servico_criado', opcoes.motivoAuditoria ? { motivo: opcoes.motivoAuditoria } : {});
    if (novo.origemId) {
      const origem = servico(novo.origemId);
      if (origem) {
        repo.atualizar('agendamentos', origem.id, { sucessorId: novo.id });
        auditarServico(origem, 'servico_duplicado', { motivo: 'Duplicado para ' + util.fmtDataMedia(novo.data) + ', ' + novo.horaInicio });
        auditarServico(novo, 'servico_duplicado', { motivo: 'Duplicado de ' + util.fmtDataMedia(origem.data) + ', ' + origem.horaInicio });
      }
    }
    registrarConflito(novo, opcoes.modo, opcoes, u);
    avisar('agenda', 'Novo serviço', descricaoNotif(novo), pessoasDe(novo).concat(gestores(), supervisores(novo)), novo);
    return novo;
  });
}

function gravarEdicao(original, c, u, tipo, opcoes) {
  const mudancas = {};
  for (const k of CAMPOS_SERVICO) if (difere(original[k], c[k])) mudancas[k] = c[k];
  if (opcoes.regenerarChecklist && mudancas.tipoId && !(original.checklist || []).some((k) => k.feito)) mudancas.checklist = checklistDoTipo(tipo);
  if (opcoes.modo === 'justificar') mudancas.justificativaConflito = String(opcoes.justificativa).trim();
  if (opcoes.modo === 'pedir') mudancas.liberacao = novaLiberacao(u, opcoes.pedido);
  const grave = (opcoes.conflitos || []).some((k) => k.severidade !== 'aviso');
  if (opcoes.modo === 'normal' && !grave && original.liberacao && original.liberacao.estado === 'pendente') mudancas.liberacao = null;
  if (!Object.keys(mudancas).length) return original;
  return repo.transacao(() => {
    const depois = repo.atualizar('agendamentos', original.id, mudancas);
    const campos = dados.diffCampos(original, depois, Object.keys(mudancas).filter((k) => !['checklist', 'liberacao'].includes(k)));
    auditarServico(depois, 'servico_editado', { campos: campos.length ? campos : null, motivo: mudancas.liberacao === null ? 'Remanejado, liberação encerrada' : null });
    registrarConflito(depois, opcoes.modo, opcoes, u);
    const mudouHorario = CAMPOS_HORARIO.some((k) => k in mudancas);
    const mudouRecursos = CAMPOS_RECURSOS.some((k) => k in mudancas);
    if (mudouHorario || mudouRecursos) {
      const para = pessoasDe(original).concat(pessoasDe(depois), gestores());
      avisar('agenda', mudouHorario ? 'Horário alterado' : 'Equipe ou carro alterado', descricaoNotif(depois), para, depois);
    }
    return depois;
  });
}

/** O tipo "Loja" do cadastro, por id ou por nome, como dados.js reconhece ao recriar o seed. */
function ehTipoLoja(tipo) {
  return !!tipo && (tipo.id === 't_loja' || util.normalizar(tipo.nome) === 'loja');
}

/**
 * Regra de mão única da DIRECAO-3 2.2: gravar um registro do tipo "Loja" grava presença `loja` para cada
 * responsável, no dia do registro, com origem `automatico` e o `servicoId` apontando de volta. O contrário não
 * vale: marcar presença nunca cria serviço, senão a agenda enche de registro vazio.
 * A presença é efeito colateral e nunca derruba a gravação do serviço: erro de permissão vira só a linha de log.
 */
function marcarPresencaDeLoja(a, tipo) {
  if (!a || !ehTipoLoja(tipo) || !/^\d{4}-\d{2}-\d{2}$/.test(a.data || '')) return 0;
  const desde = a.horaAproximada ? '' : String(a.horaInicio || '');
  let marcadas = 0;
  for (const id of pessoasDe(a)) {
    try {
      dados.marcarPresenca(id, a.data, { lugar: 'loja', origem: 'automatico', servicoId: a.id, desde });
      marcadas += 1;
    } catch (erro) {
      /* Pessoa apagada, lugar inválido ou falta de permissão: o serviço já está gravado e é o que importa. */
    }
  }
  return marcadas;
}

/**
 * Valida (8.2), detecta conflitos, grava (8.3) com auditoria e notificação em uma transação.
 * Desde a v3 o que é obrigatório depende de `candidato.origem` (DIRECAO-2 2.1): 'loja' exige cliente, endereço,
 * responsáveis, hora exata e carro conforme o tipo; 'app' e 'whatsapp' exigem só data e tipo (cadastrado ou livre).
 * @param {object} candidato campos de 4.8 mais os da v3 (origem, periodo, tipoLivre, clienteNome, localTexto, veiculoTexto)
 * @param {{id?:string|null, justificativa?:string|null, pedirLiberacao?:string|null, regenerarChecklist?:boolean,
 *   status?:string|null, acaoAuditoria?:string|null, motivoAuditoria?:string|null}} [opcoes] pedirLiberacao é o texto do pedido;
 *   status, acaoAuditoria e motivoAuditoria só valem na criação (registro colado do grupo)
 * @returns {{ok:boolean, agendamento?:object, erros?:{campo:string, mensagem:string}[], conflitos?:object[]}}
 */
export function salvarServico(candidato, opcoes = {}) {
  const u = usuarioAtual();
  const id = opcoes.id || null;
  const original = id ? servico(id) : null;
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u) return { ok: false, erros: [{ campo: 'sessao', mensagem: 'Entre para gravar' }], conflitos: [] };
  if (id && !original) return { ok: false, erros: [{ campo: 'id', mensagem: 'Serviço não encontrado' }], conflitos: [] };
  const c = normalizarCandidato(candidato, original);
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;

  /* O que é obrigatório depende da origem (DIRECAO-2 2.1): no despacho, tudo; no registro do colaborador,
     só a data e "o que vou fazer". Bloquear quem está avisando é o erro de origem. */
  const despacho = ehDespacho(c.origem);
  const cap = dados.pode('criarServico', u);
  if (!id && !cap) erro('capacidade', 'Você não pode criar serviços');
  if (!id && cap === 'proprios') {
    /* O modificador 'proprios' (perfil campo): só registro próprio, nunca despacho da loja. */
    if (despacho) erro('capacidade', 'Você registra o que você mesmo vai fazer; o despacho é da loja');
    if (!pessoasDe(c).includes(u.id)) erro('responsaveis', 'Você precisa estar neste registro');
  }
  if (c.setorId && !setorPermitido(c.setorId, u, original)) erro('setorId', 'Você só pode agendar nos seus setores');
  if (original) {
    if (!regras.acoesDisponiveis(original, u).editar) erro('capacidade', regras.statusAtivo(original.status) ? 'Você não pode editar este serviço' : 'Serviço encerrado não pode ser editado');
    if (CAMPOS_RECURSOS.some((k) => difere(original[k], c[k])) && !dados.pode('alocarRecursos', u)) erro('capacidade', 'Você não pode alterar pessoas, equipe ou carro');
  }
  if (despacho) {
    if (!tipo) erro('tipoId', 'Escolha o tipo de serviço');
    if (!c.clienteId || !dados.clientePorId(c.clienteId)) erro('clienteId', 'Escolha o cliente');
    if (!c.enderecoAConfirmar && !(c.endereco && c.endereco.logradouro)) erro('endereco', 'Falta o endereço');
    if (!pessoasDe(c).length) erro('responsaveis', 'Escolha ao menos uma pessoa ou uma equipe');
    if (tipo && tipo.precisaVeiculo === 'sim' && !c.veiculoId && !c.semCarroConfirmado) erro('veiculoId', 'Este serviço precisa de carro');
  } else if (!tipo && !c.tipoLivre) {
    erro('tipoId', 'Escreva o que vai ser feito');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.data)) erro('data', 'Escolha a data');
  if (!c.horaInicio || !c.horaFim) erro('horario', 'Escolha o horário');
  else if (min(c.horaFim) <= min(c.horaInicio)) erro('horario', 'O término precisa ser depois do início');

  const horarioValido = !erros.some((e) => e.campo === 'data' || e.campo === 'horario');
  const conflitos = horarioValido ? regras.detectarConflitos(c, { ignorarId: id }) : [];
  /* Conflito nunca barra o registro do colaborador (DIRECAO-2 1.3 e 3.4): ele está contando o que vai fazer ou o
     que já fez, e o grupo nunca impediu ninguém de escrever. O conflito continua detectado, visível no detalhe e
     na tela Hoje, e quem despacha é que resolve. No despacho da loja a regra antiga vale inteira. */
  const decisao = despacho
    ? decidirGravacao(conflitos, u, { justificativa: opcoes.justificativa, pedido: opcoes.pedirLiberacao }, original, c)
    : { modo: 'normal', erro: null, pedidoPendente: false };
  if (decisao.erro) erro('conflito', decisao.erro);
  if (erros.length) return { ok: false, erros, conflitos };

  const extras = {
    modo: decisao.modo, justificativa: opcoes.justificativa || '', pedido: opcoes.pedirLiberacao || '', conflitos,
    regenerarChecklist: !!opcoes.regenerarChecklist, status: opcoes.status || null,
    acaoAuditoria: opcoes.acaoAuditoria || null, motivoAuditoria: opcoes.motivoAuditoria || null,
    motivoNaoRealizado: opcoes.motivoNaoRealizado || null
  };
  const gravado = original ? gravarEdicao(original, c, u, tipo, extras) : gravarNovo(c, u, tipo, extras);
  /* Edição que não mudou nada devolve o próprio original: aí não há o que marcar de novo. */
  if (!original || gravado !== original) marcarPresencaDeLoja(gravado, tipo);
  return { ok: true, agendamento: gravado, conflitos };
}

const MENSAGEM_STATUS = {
  confirmado: 'Serviço confirmado', a_caminho: 'A caminho', em_andamento: 'Serviço em andamento',
  concluido: 'Serviço concluído', cancelado: 'Serviço cancelado', nao_realizado: 'Marcado como não realizado', reagendado: 'Serviço reagendado'
};

function acaoAuditoriaStatus(antes, para) {
  if (para === 'cancelado') return 'servico_cancelado';
  if (para === 'nao_realizado') return 'servico_nao_realizado';
  if (para === 'concluido') return 'servico_concluido';
  if (antes === 'concluido' && para === 'em_andamento') return 'servico_reaberto';
  return 'status_alterado';
}

function notificarStatus(a, antes, u) {
  const quem = nomeCurtoDe(u.nome);
  const texto = descricaoNotif(a);
  switch (a.status) {
    case 'confirmado':
      avisar('agenda', 'Serviço confirmado', texto, pessoasDe(a), a);
      break;
    case 'a_caminho':
      avisar('status', 'A caminho', quem + ' saiu para ' + texto, gestores().concat(a.criadoPor), a);
      break;
    case 'em_andamento':
      if (antes === 'concluido') avisar('status', 'Serviço reaberto', quem + ' reabriu ' + texto, gestores().concat(a.criadoPor), a);
      else avisar('status', 'Serviço iniciado', quem + ' começou ' + texto, gestores().concat(a.criadoPor), a);
      break;
    case 'cancelado':
      avisar('agenda', 'Serviço cancelado', texto + (a.motivoCancelamento ? '. ' + textoMotivo(a.motivoCancelamento, dados.MOTIVOS_CANCELAMENTO) : ''), pessoasDe(a).concat(gestores(), a.criadoPor), a);
      break;
    case 'nao_realizado':
      avisar('status', 'Não realizado', texto + (a.motivoNaoRealizado ? '. ' + textoMotivo(a.motivoNaoRealizado, dados.MOTIVOS_NAO_REALIZADO) : ''), gestores().concat(a.criadoPor, supervisores(a)), a);
      break;
    case 'concluido':
      avisar('status', 'Serviço concluído', quem + ' concluiu ' + texto, gestores().concat(a.criadoPor, supervisores(a)), a);
      break;
    default:
      break;
  }
}

/**
 * Muda o status (6.2): valida com regras.podeTransitar, grava, audita status_alterado; notifica após a janela de desfazer.
 * @param {string} id @param {string} para @param {{motivo?:{opcao:string, texto:string}, semDesfazer?:boolean}} [opcoes]
 * @returns {{ok:boolean, erro?:string}}
 */
export function mudarStatus(id, para, opcoes = {}) {
  const u = usuarioAtual();
  const a = servico(id);
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado' };
  const r = regras.podeTransitar(a, para, u);
  if (!r.ok) return { ok: false, erro: r.motivo };
  if (r.exige === 'reagendar') return { ok: false, erro: 'Use a ação Reagendar' };
  if (r.exige === 'concluir' && !opcoes.semDesfazer) return { ok: false, erro: 'Use a ação Concluir' };
  const motivo = opcoes.motivo && opcoes.motivo.opcao ? { opcao: opcoes.motivo.opcao, texto: String(opcoes.motivo.texto || '').trim() } : null;
  if ((r.exige === 'motivo' || r.exige === 'dataAteHoje') && !motivo) return { ok: false, erro: 'Informe o motivo' };
  const antes = a.status;
  const mudancas = { status: para };
  const carimbo = { por: u.id, quando: agora() };
  if (para === 'cancelado') mudancas.motivoCancelamento = Object.assign({}, motivo, carimbo);
  if (para === 'nao_realizado') mudancas.motivoNaoRealizado = Object.assign({}, motivo, carimbo);
  const listaMotivos = para === 'cancelado' ? dados.MOTIVOS_CANCELAMENTO : para === 'nao_realizado' ? dados.MOTIVOS_NAO_REALIZADO : [];
  const depois = repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, mudancas);
    auditarServico(novo, acaoAuditoriaStatus(antes, para), { campos: dados.diffCampos(a, novo, ['status']), motivo: motivo ? textoMotivo(motivo, listaMotivos) || motivo.texto : null });
    return novo;
  });
  const mensagem = antes === 'concluido' && para === 'em_andamento' ? 'Serviço reaberto' : (MENSAGEM_STATUS[para] || 'Status alterado');
  const notificarAgora = () => notificarStatus(depois, antes, u);
  const comDesfazer = !opcoes.semDesfazer && !['concluido', 'nao_realizado'].includes(para) && antes !== 'concluido';
  if (comDesfazer) {
    const extra = para === 'cancelado' && temTelefoneCliente(depois) ? { rotulo: 'Avisar cliente', aoClicar: () => abrirMensagens(id, 'cancelamento') } : null;
    ui.toastDesfazer(mensagem, { ms: para === 'cancelado' ? 8000 : 5000, aoDesfazer: () => desfazerStatus(id, antes), aoConfirmar: notificarAgora, extra });
  } else {
    ui.toast(mensagem);
    notificarAgora();
  }
  return { ok: true };
}

/** Transição inversa direta dentro da janela; audita status_desfeito. @param {string} id @param {string} statusAnterior */
export function desfazerStatus(id, statusAnterior) {
  const a = servico(id);
  if (!a || !statusAnterior || a.status === statusAnterior) return;
  const mudancas = { status: statusAnterior };
  if (a.status === 'cancelado') mudancas.motivoCancelamento = null;
  if (a.status === 'nao_realizado') mudancas.motivoNaoRealizado = null;
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, mudancas);
    auditarServico(novo, 'status_desfeito', { campos: dados.diffCampos(a, novo, ['status']) });
  });
  ui.toast('Status desfeito', 'info');
}

/** Gestor libera conflito pendente (6.7). @param {string} id @param {string} justificativa @returns {{ok:boolean, erro?:string}} */
export function liberarConflito(id, justificativa) {
  const u = usuarioAtual();
  const a = servico(id);
  const texto = String(justificativa || '').trim();
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado' };
  if (!regras.acoesDisponiveis(a, u).liberar) return { ok: false, erro: 'Você não pode liberar este conflito' };
  if (!texto) return { ok: false, erro: 'Escreva a justificativa' };
  const liberacao = Object.assign({}, a.liberacao, { estado: 'liberada', decididoPor: u.id, decididoEm: agora() });
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, { liberacao, justificativaConflito: texto });
    auditarServico(novo, 'liberacao_concedida', { motivo: texto });
    avisar('conflito', 'Liberação concedida', nomeCurtoDe(u.nome) + ' liberou ' + descricaoNotif(novo), [a.liberacao && a.liberacao.pedidoPor].concat(pessoasDe(novo)), novo);
  });
  ui.toast('Conflito liberado');
  return { ok: true };
}

/**
 * Grava a nota interna (DIRECAO 4.11). Separada de `obs`: `obs` é instrução que o campo lê,
 * a nota é recado de escritório e não aparece para o perfil campo.
 * @param {string} id @param {string} texto @returns {{ok:boolean, mudou?:boolean, erro?:string}}
 */
export function salvarNotaInterna(id, texto) {
  const u = usuarioAtual();
  const a = servico(id);
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado' };
  if (ehCampo(u)) return { ok: false, erro: 'A nota interna é só da loja' };
  if (!dados.visivel(a, u)) return { ok: false, erro: 'Serviço fora do seu setor' };
  const nova = String(texto || '').trim();
  if (nova === String(a.notaInterna || '')) return { ok: true, mudou: false };
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, { notaInterna: nova });
    auditarServico(novo, 'servico_editado', { campos: dados.diffCampos(a, novo, ['notaInterna']) });
  });
  return { ok: true, mudou: true };
}

/* ================================================================== */
/* Componentes de "Quando": calendário do mês, coluna de horários,     */
/* controles e nota. Compartilhados pelo fluxo Agendar (DIRECAO 3.4),  */
/* pelo formulário avançado (8.1) e pela sheet de reagendar (8.5).     */
/* A fita de 14 datas e a régua de slots saíram no redesenho de        */
/* 18/09/2026 (DIRECAO 5.3): seis controles para escolher uma hora     */
/* viraram dois, o calendário do mês e a lista de horários livres.     */
/* ================================================================== */

const cfg = () => Object.assign({ duracaoPadraoMin: 90, horaCorteAmanha: '17:00', slotMin: 30 }, repo.config() || {});
/** Duração de registro sem tipo cadastrado (DIRECAO-2 5.3), a mesma de whatsapp.js. */
const DURACAO_SEM_TIPO_MIN = 60;

/** Duração do candidato: o intervalo escolhido, senão a padrão do tipo, senão a da config. */
function duracaoDe(c) {
  if (c.horaInicio && c.horaFim && min(c.horaFim) > min(c.horaInicio)) return min(c.horaFim) - min(c.horaInicio);
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  if (tipo && tipo.duracaoPadraoMin) return tipo.duracaoPadraoMin;
  /* Registro sem tipo cadastrado dura 60 min (DIRECAO-2 5.3), igual ao leitor do WhatsApp; a duração da config
     continua valendo para o despacho de loja. */
  if (!tipo && c.origem && c.origem !== 'loja') return DURACAO_SEM_TIPO_MIN;
  return cfg().duracaoPadraoMin;
}

function fimPorDuracao(horaInicio, duracaoMin) {
  return util.minParaHora(Math.min(min(horaInicio) + duracaoMin, 23 * 60 + 59));
}

function escolhidosDe(c) {
  return { responsaveis: c.responsaveis || [], equipeId: c.equipeId || null, veiculoId: c.veiculoId || null, tipoId: c.tipoId || null, setorId: c.setorId || null };
}

/** Data padrão de um serviço novo: hoje, ou amanhã depois da hora de corte. */
function dataPadrao() {
  const hoje = util.hojeISO();
  return util.agoraMin() >= min(cfg().horaCorteAmanha || '17:00') ? util.addDias(hoje, 1) : hoje;
}

/** Primeiro slot livre do dia para os recursos escolhidos (hoje: a partir de agora), senão a abertura. */
function inicioPadrao(c) {
  const dur = duracaoDe(c);
  const slots = regras.reguaSlots(c.data, escolhidosDe(c), dur, { ignorarId: c.id || null });
  const apartir = c.data === util.hojeISO() ? util.arredondarMin(util.agoraMin(), cfg().slotMin || 30, 'cima') : 0;
  const aberto = slots.filter((s) => s.estado !== 'fechado' && min(s.hora) >= apartir);
  const livre = aberto.find((s) => s.estado === 'livre') || aberto.find((s) => s.estado === 'parcial');
  if (livre) return livre.hora;
  const horario = regras.horarioDoDia(c.data, c.setorId);
  return horario ? horario.de : '08:00';
}

/* ---- Calendário do mês (DIRECAO 3.4) ---- */

/** Duração em vigor: a escolhida entre as do tipo (4.14), senão a do intervalo ou a padrão. */
function duracaoEmVigor(c, estado) {
  const pedida = estado && Number(estado.duracaoMin);
  return pedida > 0 ? pedida : duracaoDe(c);
}

/** Candidato mínimo para regras.horariosLivres e regras.diasComVaga: o que já está fixo, e o rodízio escolhe o resto. */
function candidatoDeConsulta(c, estado) {
  return {
    id: c.id || null, tipoId: c.tipoId || null, setorId: c.setorId || null,
    veiculoId: c.veiculoId || null, equipeId: c.equipeId || null,
    responsaveis: (c.responsaveis || []).slice(), semCarroConfirmado: !!c.semCarroConfirmado,
    duracaoMin: duracaoEmVigor(c, estado)
  };
}

function opcoesDeConsulta(c, estado) {
  return { ignorarId: c.id || null, duracaoMin: duracaoEmVigor(c, estado), mostrarAssimMesmo: !!(estado && estado.mostrarAssimMesmo) };
}

const ROTULO_DIA = {
  vaga: 'com horário livre', sem_vaga: 'sem horário livre', fechado: 'fechado',
  passado: 'data passada', fora_janela: 'fora da janela de agendamento'
};

/** O mês que o calendário mostra: o guardado no estado, senão o da data escolhida, senão o de hoje. */
function mesDoEstado(c, estado) {
  const base = (estado && estado.mes) || c.data || util.hojeISO();
  return util.inicioMes(util.dataValida(base) ? base : util.hojeISO());
}

/**
 * Calendário do mês com os dias que têm vaga (3.4). Dia com vaga: tinta leve, número no acento e ponto.
 * Dia sem vaga, fechado, passado ou além da janela: só o número, sem círculo e sem clique, com o motivo no title.
 */
function calendarioMesHTML(c, estado) {
  const mes = mesDoEstado(c, estado);
  /* Registro por período (manhã, tarde, dia todo) nunca disputa vaga: qualquer dia que não passou pode ser escolhido,
     inclusive dia fechado, que só avisa (DIRECAO-2 2.3). Só a hora exata precisa de horário livre. */
  const porPeriodo = !!(c.periodo && c.periodo !== 'hora');
  const dias = regras.diasComVaga(mes, candidatoDeConsulta(c, estado), opcoesDeConsulta(c, estado)).map((item) => {
    if (!porPeriodo || item.estado === 'passado') return item;
    return Object.assign({}, item, { estado: 'vaga', motivo: item.estado === 'fechado' ? 'Dia marcado como fechado, o registro avisa' : null });
  });
  const hoje = util.hojeISO();
  const d = util.dataDe(mes);
  const rotulo = util.MESES[d.getMonth()] + ' de ' + d.getFullYear();
  const janela = regras.janelaDe(c.tipoId);
  const semAnterior = mes <= util.inicioMes(hoje);
  const semSeguinte = !(estado && estado.mostrarAssimMesmo) && util.addMeses(mes, 1) > util.inicioMes(janela.limite);
  const cabecalho = '<div class="cal-mes-cab">' +
    '<button type="button" class="btn-icone" data-acao="mes-anterior" aria-label="Mês anterior"' + (semAnterior ? ' disabled' : '') + '>' + icone('voltar', 20) + '</button>' +
    '<span class="cal-mes-rotulo" aria-live="polite">' + esc(rotulo) + '</span>' +
    '<button type="button" class="btn-icone" data-acao="mes-seguinte" aria-label="Mês seguinte"' + (semSeguinte ? ' disabled' : '') + '>' + icone('direita', 20) + '</button>' +
    '</div>';
  const semana = '<div class="cal-semana" aria-hidden="true">' + util.DIAS_ABR.slice(1).concat(util.DIAS_ABR[0]).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>';
  let celulas = '';
  /* Semana começa na segunda, igual ao Calendário (Mês e Semana). */
  for (let i = 0; i < (util.diaSemana(mes) + 6) % 7; i++) celulas += '<div class="cal-celula"></div>';
  for (const item of dias) {
    const vaga = item.estado === 'vaga';
    const numero = util.dataDe(item.data).getDate();
    const aria = util.fmtDataExtensa(item.data) + ', ' + (item.motivo || ROTULO_DIA[item.estado] || '');
    const attrs = ['type="button"', 'class="cal-dia"', 'data-acao="escolher-dia"', 'data-valor="' + item.data + '"', 'data-estado="' + esc(item.estado) + '"'];
    if (!vaga) attrs.push('disabled');
    if (item.data === hoje) attrs.push('data-hoje');
    if (item.data === c.data) attrs.push('data-escolhido');
    if (vaga) attrs.push('aria-pressed="' + (item.data === c.data ? 'true' : 'false') + '"');
    if (item.data === hoje) attrs.push('aria-current="date"');
    if (item.motivo) attrs.push('title="' + esc(item.motivo) + '"');
    attrs.push('aria-label="' + esc(aria) + '"');
    celulas += '<div class="cal-celula"><button ' + attrs.join(' ') + '>' + numero + '</button></div>';
  }
  /* Mês inteiro sem vaga: em vez de uma grade morta, a saída para o mês seguinte (DIRECAO-2, seção 7). */
  const semVaga = dias.length > 0 && !dias.some((item) => item.estado === 'vaga');
  const seguinte = util.dataDe(util.addMeses(mes, 1));
  const saida = semVaga && !semSeguinte
    ? '<div class="cal-sem-vaga"><p class="agendar-nota">' + esc('Nenhum horário livre em ' + util.MESES[d.getMonth()] + '.') + '</p>' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="mes-seguinte">' + esc('Ver ' + util.MESES[seguinte.getMonth()]) + '</button></div>'
    : '';
  return '<div class="cal-mes">' + cabecalho + semana + '<div class="cal-dias" role="group" aria-label="Dias de ' + esc(rotulo) + '">' + celulas + '</div>' + saida + '</div>';
}

/* ---- Coluna de horários livres (DIRECAO 3.4 e 4.1) ---- */

/* Horários que já passaram não viram linha: em vez de encher a coluna de caixas mortas,
   viram uma nota única no fim. Todo o resto (ocupado, fora do horário, antecedência,
   janela, limite do dia) aparece com o motivo escrito do lado, que é o que o despacho usa. */
const CODIGO_SILENCIOSO = new Set(['data_passada']);

/**
 * Botão de horário livre. Com o gesto de confirmar (fluxo Agendar), o escolhido encolhe para 48,5 %
 * e o "Confirmar" desliza para o espaço aberto. Sem o gesto (formulário avançado e reagendar), o
 * toque já aplica a hora e o botão só fica marcado.
 */
function horarioLivreHTML(item, escolhido, acao, comGesto) {
  const hora = esc(item.hora);
  const aria = item.hora + ' às ' + item.horaFim;
  const dividido = escolhido && comGesto;
  let html = '<div class="horario-item"' + (dividido ? ' data-escolhido' : '') + '>' +
    '<button type="button" class="horario-livre" data-acao="' + esc(acao) + '" data-valor="' + hora + '"' +
    ' aria-pressed="' + (escolhido ? 'true' : 'false') + '" aria-label="' + esc(aria) + '">' + hora + '</button>';
  if (dividido) {
    html += '<button type="button" class="horario-confirmar" data-acao="confirmar-horario" data-valor="' + hora + '"' +
      ' aria-label="' + esc('Confirmar ' + aria) + '">' + icone('check', 18) + '<span>Confirmar</span></button>';
  }
  return html + '</div>';
}

function horarioFechadoHTML(item) {
  return '<div class="horario-fechado" data-codigo="' + esc(item.codigo || '') + '">' +
    '<span class="horario-fechado-hora">' + esc(item.hora) + '</span>' +
    '<span class="horario-fechado-motivo">' + esc(item.motivo || 'Indisponível') + '</span></div>';
}

function colunaVaziaHTML(titulo, texto, acoes) {
  return '<div class="horarios-vazio"><div class="horarios-vazio-titulo">' + esc(titulo) + '</div>' +
    '<p>' + esc(texto) + '</p>' + (acoes ? '<div class="horarios-acoes">' + acoes + '</div>' : '') + '</div>';
}

/**
 * Lista de horários do dia escolhido. Livre vira botão; indisponível vira caixa tracejada com o motivo do lado.
 * @param {object} c candidato @param {object} estado guarda horaProvisoria, duracaoMin e mostrarAssimMesmo
 * @param {{acao?:string, comGesto?:boolean}} [opcoes] acao é o data-acao do botão de horário livre
 */
function colunaHorariosHTML(c, estado, opcoes = {}) {
  const acao = opcoes.acao || 'escolher-slot';
  const comGesto = !!opcoes.comGesto;
  if (!c.data) return colunaVaziaHTML('Escolha o dia', 'Os horários livres aparecem aqui assim que você escolher um dia no calendário.');
  const fechado = regras.motivoDiaFechado(c.data, c.setorId);
  if (fechado) return colunaVaziaHTML(fechado.rotulo, fechado.texto);
  const lista = regras.horariosLivres(c.data, candidatoDeConsulta(c, estado), opcoesDeConsulta(c, estado));
  const visiveis = lista.filter((x) => !CODIGO_SILENCIOSO.has(x.codigo));
  const livres = lista.filter((x) => x.estado === 'livre');
  const passados = lista.length - visiveis.length;
  const escolhida = (estado && estado.horaProvisoria) || (comGesto ? '' : c.horaInicio);
  if (!visiveis.length) {
    const texto = passados ? 'Todos os horários deste dia já passaram.' : 'Nenhum horário para este dia.';
    return colunaVaziaHTML('Sem horário', texto);
  }
  const itens = visiveis.map((item) => (item.estado === 'livre'
    ? horarioLivreHTML(item, comGesto ? item.hora === escolhida : ehInicioEscolhido(c, item), acao, comGesto)
    : horarioFechadoHTML(item))).join('');
  const travados = visiveis.some((x) => x.codigo === 'antecedencia' || x.codigo === 'fora_janela');
  const notas = [];
  if (!livres.length) notas.push('Nenhum horário livre neste dia. Os motivos estão ao lado de cada horário.');
  if (passados) notas.push(plural(passados, 'horário já passou', 'horários já passaram') + ' e não aparecem na lista.');
  const rodape = travados && !(estado && estado.mostrarAssimMesmo)
    ? '<div class="horarios-acoes"><button type="button" class="btn btn-secundario btn-pq" data-acao="mostrar-assim-mesmo">Mostrar assim mesmo</button></div>'
    : '';
  /* No desktop a coluna rola por dentro, para o dia inteiro não empurrar a página; no celular a
     coluna é a tela, e uma rolagem dentro da outra atrapalha. */
  const rolagem = visiveis.length > 12 && !celular() ? ' data-rolagem' : '';
  return '<div class="horarios-lista" role="group" aria-label="Horários do dia"' + rolagem + '>' + itens + '</div>' +
    notas.map((n) => '<p class="agendar-nota">' + esc(n) + '</p>').join('') + rodape;
}

/** O horário livre é o início já escolhido no candidato (usado fora do gesto de confirmar). */
function ehInicioEscolhido(c, item) {
  return !!c.horaInicio && c.horaInicio === item.hora;
}

/** Rola a coluna de horários até o escolhido, sem mover a página. */
function rolarHorarios(raiz) {
  if (!raiz) return;
  const lista = raiz.querySelector('.horarios-lista');
  const item = lista ? lista.querySelector('.horario-item[data-escolhido], .horario-livre[aria-pressed="true"]') : null;
  if (!lista || !item || !lista.hasAttribute('data-rolagem')) return;
  lista.scrollTop = Math.max(0, item.offsetTop - lista.clientHeight / 2);
}

/** Aplica a data escolhida no candidato, completando início e término quando ainda não existirem. */
function aplicarData(c, iso, estado) {
  c.data = iso;
  if (estado) { estado.horaProvisoria = ''; estado.mes = util.inicioMes(iso); }
  if (!c.horaInicio) c.horaInicio = inicioPadrao(c);
  if (!c.horaFim) c.horaFim = fimPorDuracao(c.horaInicio, duracaoEmVigor(c, estado));
}

/**
 * Calendário do mês numa folha, por onde o formulário avançado troca a data (DIRECAO 5.3).
 * Não serve para quem já está dentro de uma folha: só existe uma por vez.
 * @param {object} c candidato @param {object} estado @param {() => void} aoEscolher chamado depois de aplicar a data
 */
function abrirCalendarioMes(c, estado, aoEscolher) {
  const { el, fechar } = ui.abrirSheet({ titulo: 'Escolher a data', corpo: '<div data-parte="calendario">' + calendarioMesHTML(c, estado) + '</div>' });
  const atualizar = () => {
    const caixa = el.querySelector('[data-parte="calendario"]');
    if (caixa) caixa.innerHTML = calendarioMesHTML(c, estado);
  };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'mes-anterior' || acao === 'mes-seguinte') { tratarAcaoQuando(acao, alvo, c, estado); atualizar(); return; }
    if (acao !== 'escolher-dia') return;
    tratarAcaoQuando(acao, alvo, c, estado);
    fechar();
    if (typeof aoEscolher === 'function') aoEscolher();
  });
}

function controlesHorarioHTML(c, prefixo) {
  return '<div class="horario-controles">' +
    ui.campo({ id: prefixo + '-hini', rotulo: 'Início', tipo: 'time', valor: c.horaInicio || '', atributos: 'data-campo="horaInicio" step="300"' }) +
    ui.campo({ id: prefixo + '-hfim', rotulo: 'Término', tipo: 'time', valor: c.horaFim || '', atributos: 'data-campo="horaFim" step="300"' }) +
    '<button type="button" class="btn btn-secundario" data-acao="ajustar-fim" data-valor="-30" aria-label="Encurtar 30 minutos">-30</button>' +
    '<button type="button" class="btn btn-secundario" data-acao="ajustar-fim" data-valor="30" aria-label="Alongar 30 minutos">+30</button>' +
    '<button type="button" class="btn btn-secundario" data-acao="primeiro-livre">' + icone('relogio', 16) + '<span>Primeiro horário livre</span></button>' +
    '</div>';
}

function notaHorarioHTML(c) {
  if (!c.data) return '';
  const fechado = regras.motivoDiaFechado(c.data, c.setorId);
  if (fechado) return '<p class="horario-nota" data-tom="alerta">' + esc(fechado.texto) + '</p>';
  /* Duas faixas no mesmo dia querem dizer que o vão entre elas é o almoço (DIRECAO 5.2). */
  const faixas = regras.faixasDoDia(c.data, c.setorId);
  const texto = faixas.map((f) => f.de + ' às ' + f.ate).join(' e das ');
  const cabe = !c.horaInicio || !c.horaFim || faixas.some((f) => min(c.horaInicio) >= min(f.de) && min(c.horaFim) <= min(f.ate));
  return '<p class="horario-nota"' + (cabe ? '' : ' data-tom="alerta"') + '>Loja aberta das ' + esc(texto) +
    (cabe ? '' : '. O horário escolhido fica fora do funcionamento') + '</p>';
}

/** Aviso de duração muito acima ou abaixo do padrão do tipo (8.2). */
function avisoDuracao(c) {
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  if (!tipo || !tipo.duracaoPadraoMin || !c.horaInicio || !c.horaFim) return '';
  const dur = min(c.horaFim) - min(c.horaInicio);
  if (dur <= 0) return '';
  if (dur > tipo.duracaoPadraoMin * 2 || dur < tipo.duracaoPadraoMin / 2) {
    return 'Duração de ' + util.fmtDuracao(dur) + '. O padrão de ' + tipo.nome + ' é ' + util.fmtDuracao(tipo.duracaoPadraoMin);
  }
  return '';
}

/**
 * Escolher hora na coluna, no relógio ou pelo "primeiro livre" quer dizer hora exata: o registro deixa de ser
 * aproximado e passa a valer para o conflito (DIRECAO-2 2.2). Vale para o formulário avançado e para o Registrar.
 */
function marcarHoraExata(c) {
  if (!c) return;
  c.periodo = 'hora';
  c.horaAproximada = false;
}

/**
 * Ações comuns de data e horário. Devolve true quando tratou; quem chama re-renderiza.
 * @param {string} acao @param {HTMLElement} el @param {object} c candidato @param {object} [estado] guarda mês, hora provisória e "mostrar assim mesmo"
 */
function tratarAcaoQuando(acao, el, c, estado) {
  const valor = el.getAttribute('data-valor');
  const dur = duracaoEmVigor(c, estado);
  switch (acao) {
    case 'escolher-data':
    case 'escolher-dia':
      aplicarData(c, valor, estado);
      return true;
    case 'mes-anterior':
      if (estado) estado.mes = util.addMeses(mesDoEstado(c, estado), -1);
      return true;
    case 'mes-seguinte':
      if (estado) estado.mes = util.addMeses(mesDoEstado(c, estado), 1);
      return true;
    case 'mostrar-assim-mesmo':
      if (estado) estado.mostrarAssimMesmo = true;
      return true;
    case 'escolher-slot':
      c.horaInicio = valor;
      c.horaFim = fimPorDuracao(valor, dur);
      marcarHoraExata(c);
      return true;
    case 'ajustar-fim': {
      const minimo = min(c.horaInicio || '00:00') + 15;
      c.horaFim = util.minParaHora(util.clamp(min(c.horaFim || c.horaInicio) + Number(valor), minimo, 23 * 60 + 59));
      marcarHoraExata(c);
      return true;
    }
    case 'primeiro-livre': {
      const s = regras.sugerirHorarios(c, { maxOpcoes: 1, ignorarId: c.id || null })[0];
      if (!s) { ui.toast('Sem horário livre nos próximos 7 dias para esses recursos', 'info'); return true; }
      c.data = s.data; c.horaInicio = s.horaInicio; c.horaFim = s.horaFim;
      marcarHoraExata(c);
      return true;
    }
    default:
      return false;
  }
}

/** Campos comuns de data e horário (evento change). Devolve true quando tratou. */
function tratarCampoQuando(campo, valor, c) {
  if (campo === 'dataCalendario') {
    if (!valor) return false;
    c.data = valor;
    if (!c.horaInicio) c.horaInicio = inicioPadrao(c);
    if (!c.horaFim) c.horaFim = fimPorDuracao(c.horaInicio, duracaoDe(c));
    return true;
  }
  if (campo === 'horaInicio') {
    if (!valor) return false;
    const dur = duracaoDe(c);
    c.horaInicio = valor;
    c.horaFim = fimPorDuracao(valor, dur);
    marcarHoraExata(c);
    return true;
  }
  if (campo === 'horaFim') {
    if (!valor) return false;
    c.horaFim = valor;
    marcarHoraExata(c);
    return true;
  }
  return false;
}

function atualizarInputsHorario(raiz, c) {
  const ini = raiz.querySelector('[data-campo="horaInicio"]');
  const fim = raiz.querySelector('[data-campo="horaFim"]');
  if (ini && ini.value !== c.horaInicio) ini.value = c.horaInicio || '';
  if (fim && fim.value !== c.horaFim) fim.value = c.horaFim || '';
}

/* ================================================================== */
/* Faixa de conflito (8.1), compartilhada                              */
/* ================================================================== */

/**
 * Calcula conflitos, alternativas e a decisão de gravação de um candidato.
 * @returns {{conflitos:object[], alternativas:object[], sev:string|null, decisao:object, coberto:boolean}}
 */
function analisarConflitos(c, u, textos, original) {
  const valido = c.data && c.horaInicio && c.horaFim && min(c.horaFim) > min(c.horaInicio);
  const conflitos = valido ? regras.detectarConflitos(c, { ignorarId: c.id || null }) : [];
  const alternativas = conflitos.length ? regras.alternativas(c, conflitos) : [];
  const decisao = decidirGravacao(conflitos, u, textos, original, c);
  const sev = regras.severidadeMaxima(conflitos);
  return { conflitos, alternativas, sev, decisao, coberto: sev === 'conflito' && conflitoJaCoberto(original, c) };
}

function faixaConflitoHTML(analise, u, textos) {
  const { conflitos, alternativas, sev, decisao, coberto } = analise;
  if (!conflitos.length) return '';
  const titulo = sev === 'bloqueio' ? 'Carro indisponível' : sev === 'conflito' ? 'Conflito neste horário' : 'Atenção';
  const linhas = conflitos.map((c, i) => {
    const chips = alternativas.filter((alt) => alt.conflitoIndice === i)
      .map((alt) => '<button type="button" class="chip chip-escolha" data-acao="aplicar-alternativa" data-valor="' + esc(alt.id) + '">' + esc(alt.rotulo) + '</button>').join('');
    return linhaConflitoHTML(c, chips);
  }).join('');
  let campo = '';
  if (sev === 'conflito' && !coberto) {
    if (decisao.modo === 'justificar') {
      campo = ui.campo({ id: 'conflito-justificativa', rotulo: 'Justificativa', multilinha: true, valor: textos.justificativa || '', atributos: 'data-campo="justificativa" rows="2" placeholder="Por que gravar mesmo em conflito"' });
    } else if (decisao.modo === 'pedir' && decisao.pedidoPendente) {
      campo = '<p class="faixa-conflito-espera">Já existe um pedido pendente para este recurso neste horário</p>';
    } else if (decisao.modo === 'pedir') {
      campo = ui.campo({ id: 'conflito-pedido', rotulo: 'Motivo do pedido', multilinha: true, valor: textos.pedido || '', atributos: 'data-campo="pedido" rows="2" placeholder="Explique à gerência por que precisa deste horário"' });
    } else {
      campo = '<p class="faixa-conflito-espera">Escolha outro horário ou recurso, ou peça à gestão para gravar</p>';
    }
  } else if (coberto) {
    campo = '<p class="faixa-conflito-espera">Conflito já justificado ou liberado anteriormente</p>';
  }
  return '<section class="faixa-conflito" data-severidade="' + esc(sev) + '" tabindex="-1" aria-label="' + esc(titulo) + '">' +
    '<div class="faixa-conflito-titulo">' + icone(sev === 'aviso' ? 'info' : 'alerta', 18) + '<span>' + esc(titulo) + '</span></div>' + linhas + campo + '</section>';
}

/** Troca o conteúdo do contêiner da faixa com a transição de saída de 200 ms. */
function trocarFaixa(container, html) {
  if (!container) return;
  if (!html) {
    const atual = container.querySelector('.faixa-conflito');
    if (!atual) { container.innerHTML = ''; return; }
    atual.classList.add('saindo');
    setTimeout(() => { if (atual.parentNode === container) container.innerHTML = ''; }, 200);
    return;
  }
  const foco = document.activeElement && container.contains(document.activeElement) ? document.activeElement.getAttribute('data-campo') : null;
  container.innerHTML = html;
  if (foco) {
    const de = container.querySelector('[data-campo="' + foco + '"]');
    if (de) { de.focus(); try { de.setSelectionRange(de.value.length, de.value.length); } catch (e) { /* ignora */ } }
  }
}

/** Resumo de um conflito para o rodapé: "Fiorino ocupada neste horário". */
function resumoConflito(conflitos) {
  const grave = conflitos.find((c) => c.severidade === 'conflito') || conflitos[0];
  if (!grave) return '';
  if (grave.recurso === 'horario') return grave.comTexto;
  return grave.rotulo + (grave.recurso === 'pessoa' ? ' ocupado' : ' ocupada') + ' neste horário';
}

/* ================================================================== */
/* Formulário de serviço (8.1 a 8.3, 8.6)                              */
/* ================================================================== */

let formAtivo = null;

function criarEstadoForm(original, query, chave) {
  const origem = !original && query.origem ? servico(query.origem) : null;
  const base = original || origem;
  const c = {
    id: original ? original.id : null,
    tipoId: base ? base.tipoId : (query.tipo || null),
    /* Campos da v3 (DIRECAO-2 2.2). O formulário avançado não os edita, mas precisa carregá-los para não
       apagá-los ao salvar um registro que veio do Registrar ou do grupo. */
    tipoLivre: base ? base.tipoLivre || '' : '',
    periodo: base && dados.PERIODOS[base.periodo] ? base.periodo : 'hora',
    clienteNome: base ? base.clienteNome || '' : '',
    localTexto: base ? base.localTexto || '' : '',
    veiculoTexto: base ? base.veiculoTexto || '' : '',
    origem: base ? base.origem || ORIGEM_PADRAO : ORIGEM_PADRAO,
    setorId: base ? base.setorId : null,
    data: original ? original.data : (origem ? (query.data || '') : (query.data || dataPadrao())),
    horaInicio: original ? original.horaInicio : (query.inicio || ''),
    horaFim: original ? original.horaFim : (query.fim || ''),
    clienteId: base ? base.clienteId : (query.cliente || null),
    endereco: base ? snapshotEndereco(base.endereco) : null,
    enderecoAConfirmar: base ? !!base.enderecoAConfirmar : false,
    responsaveis: base ? (base.responsaveis || []).slice() : (query.resp ? [query.resp] : []),
    equipeId: base ? base.equipeId || null : (query.equipe || null),
    veiculoId: base ? base.veiculoId || null : (query.veiculo || null),
    semCarroConfirmado: base ? !!base.semCarroConfirmado : false,
    obs: base ? base.obs || '' : '',
    origemId: origem ? origem.id : null
  };
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  if (!tipo) c.tipoId = null;
  if (tipo && !c.setorId) c.setorId = tipo.setorPadrao;
  if (!original && c.clienteId) {
    const cli = dados.clientePorId(c.clienteId);
    if (!cli) c.clienteId = null;
    else if (!c.endereco && cli.enderecos && cli.enderecos[0]) c.endereco = snapshotEndereco(cli.enderecos[0]);
  }
  if (!original && !origem && c.equipeId) {
    const eq = dados.equipePorId(c.equipeId);
    if (eq) c.responsaveis = unicos(c.responsaveis.concat(eq.membros || []));
    else c.equipeId = null;
  }
  if (!original && c.data && !c.horaInicio) c.horaInicio = inicioPadrao(c);
  if (c.horaInicio && !c.horaFim) c.horaFim = fimPorDuracao(c.horaInicio, duracaoDe({ tipoId: c.tipoId }));
  return {
    chave, editando: !!original, original, cand: c, tipoRecolhido: !!c.tipoId, carroAberto: !!c.veiculoId, maisPessoas: false,
    buscaCliente: '', criandoCliente: null, buscaPessoa: '', justificativa: '', pedido: '', erros: {}, alterado: false,
    focarData: !!origem, ultimasAlternativas: [],
    /* Estado dos componentes de "Quando" (mês visível, hora em confirmação, liberar antecedência e janela). */
    mes: util.inicioMes(c.data || util.hojeISO()), horaProvisoria: '', mostrarAssimMesmo: false, duracaoMin: 0
  };
}

function erroCampoHTML(f, campo) {
  const msg = f.erros[campo];
  return msg ? '<p class="msg-erro-campo" role="alert">' + icone('alerta', 14) + '<span>' + esc(msg) + '</span></p>' : '';
}

function avisoHTML(texto) {
  return texto ? '<p class="campo-aviso">' + icone('alerta', 14) + '<span>' + esc(texto) + '</span></p>' : '';
}

/* ---- Bloco 1: O quê ---- */

/** Setores em que o usuário pode agendar (2.3): todos com verTudo, senão os dele. */
const setoresDoUsuario = (u) => dados.setoresVisiveis(u).map((s) => s.id);

/** Quem não tem verTudo só grava nos seus setores; ao editar, o setor original em que já está alocado continua valendo. */
function setorPermitido(setorId, u, original) {
  if (!u || dados.pode('verTudo', u)) return true;
  if (original && original.setorId === setorId) return true;
  return setoresDoUsuario(u).includes(setorId);
}

/** Tipos ativos oferecidos no formulário: sem verTudo, só os do setor do usuário (mais o tipo já gravado, ao editar). */
function gruposDeTipos(u, tipoAtualId) {
  const restrito = !!u && !dados.pode('verTudo', u);
  const permitidos = restrito ? new Set(setoresDoUsuario(u)) : null;
  /* Tipo sem setor ("Loja", DIRECAO-2 2.5) é interno, não secreto: aparece para todo mundo que pode criar. */
  let tipos = dados.tiposAtivos().filter((t) => !permitidos || !t.setorPadrao || permitidos.has(t.setorPadrao));
  if (tipoAtualId && !tipos.some((t) => t.id === tipoAtualId)) {
    const atual = dados.tipoPorId(tipoAtualId);
    if (atual) tipos = tipos.concat(atual);
  }
  const meus = new Set((u && u.setores) || []);
  const ordem = dados.SETORES.map((s) => s.id).sort((x, y) => Number(meus.has(y)) - Number(meus.has(x)));
  const grupos = [];
  for (const setorId of ordem) {
    const lista = tipos.filter((t) => t.setorPadrao === setorId);
    if (lista.length) grupos.push([setorId, lista]);
  }
  const semSetor = tipos.filter((t) => !ordem.includes(t.setorPadrao));
  if (semSetor.length) grupos.push(['outros', semSetor]);
  return grupos;
}

function blocoTipoHTML(f, u) {
  const c = f.cand;
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  let corpo;
  if (f.tipoRecolhido && tipo) {
    corpo = '<div class="form-bloco-recolhido">' + icone(tipo.icone, 22) + '<span>' + esc(tipo.nome) + '</span>' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="trocar-tipo">Trocar</button></div>';
  } else {
    const grupos = gruposDeTipos(u, c.tipoId);
    if (!grupos.length) {
      corpo = avisoHTML('Nenhum tipo de serviço disponível nos seus setores. Fale com a gestão.');
    } else corpo = '<div class="chips-tipo" role="group" aria-label="Tipo de serviço">' + grupos.map(([setorId, lista]) =>
      '<div class="chips-grupo-titulo">' + esc(setorId === 'outros' ? 'Outros' : dados.setorPorId(setorId).nome) + '</div>' +
      lista.map((t) => {
        const ativo = c.tipoId === t.id;
        return '<button type="button" class="chip-escolha" data-acao="escolher-tipo" data-valor="' + esc(t.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + '>' +
          icone(t.icone, 18) + '<span>' + esc(t.nome) + '</span></button>';
      }).join('')
    ).join('') + '</div>';
  }
  let setor = '';
  if (c.tipoId || c.setorId) {
    const setorObj = c.setorId ? dados.setorPorId(c.setorId) : null;
    setor = dados.pode('verTudo', u)
      ? ui.campo({ id: 'f-setor', rotulo: 'Setor', valor: c.setorId || '', opcoes: dados.SETORES.map((s) => ({ valor: s.id, rotulo: s.nome })), atributos: 'data-campo="setorId"' })
      : '<div class="form-setor-texto">Setor: ' + esc(setorObj ? setorObj.nome : 'a definir') + '</div>';
    if (c.setorId && !setorPermitido(c.setorId, u, f.original)) setor += avisoHTML('Este setor está fora da sua visão. O serviço não apareceria na sua agenda.');
  }
  return '<div class="form-bloco-titulo"><span>O quê</span></div>' + corpo + erroCampoHTML(f, 'tipoId') + (setor ? '<div class="mt3">' + setor + erroCampoHTML(f, 'setorId') + '</div>' : '');
}

/* ---- Bloco 2: Para quem ---- */

function itemClienteHTML(cli) {
  const end = cli.enderecos && cli.enderecos[0] ? util.enderecoCurto(cli.enderecos[0]) : '';
  return '<button type="button" class="item item-toque" data-acao="escolher-cliente" data-id="' + esc(cli.id) + '">' +
    '<span class="item-icone">' + icone('usuario', 18) + '</span>' +
    '<span class="item-corpo"><span class="item-titulo">' + esc(cli.nome) + '</span><span class="item-sub">' + esc(util.telFmt(cli.telefone)) + (end ? ', ' + esc(end) : '') + '</span></span></button>';
}

function clienteNovoHTML(f) {
  const n = f.criandoCliente;
  return '<div class="cliente-novo">' +
    '<div class="campo-rotulo">Novo cliente</div>' +
    ui.campo({ id: 'f-novo-nome', rotulo: 'Nome', valor: n.nome, obrigatorio: true, atributos: 'data-campo="novo-nome" autocomplete="off"' }) +
    ui.campo({ id: 'f-novo-tel', rotulo: 'Telefone', tipo: 'tel', valor: n.telefone, obrigatorio: true, atributos: 'data-campo="novo-telefone" autocomplete="off" inputmode="tel"' }) +
    ui.campo({ id: 'f-novo-log', rotulo: 'Endereço', valor: n.logradouro, ajuda: 'Rua e número', atributos: 'data-campo="novo-logradouro" autocomplete="off"' }) +
    '<div class="linha-campos">' +
    ui.campo({ id: 'f-novo-bairro', rotulo: 'Bairro', valor: n.bairro, atributos: 'data-campo="novo-bairro" autocomplete="off"' }) +
    ui.campo({ id: 'f-novo-cidade', rotulo: 'Cidade', valor: n.cidade, atributos: 'data-campo="novo-cidade" autocomplete="off"' }) +
    '</div>' + erroCampoHTML(f, 'novoCliente') +
    '<div class="btn-grupo mt3"><button type="button" class="btn btn-primario btn-pq" data-acao="salvar-cliente">Salvar cliente</button>' +
    '<button type="button" class="btn btn-fantasma btn-pq" data-acao="cancelar-cliente-novo">Cancelar</button></div></div>';
}

function resultadosClienteHTML(f) {
  if (f.criandoCliente) return clienteNovoHTML(f);
  const texto = f.buscaCliente.trim();
  if (texto.length < 2) return '';
  const lista = dados.clientesPorTexto(texto, 8);
  const criar = '<button type="button" class="item item-toque item-criar" data-acao="criar-cliente">' +
    '<span class="item-icone">' + icone('mais', 18) + '</span><span class="item-corpo"><span class="item-titulo">Criar cliente: ' + esc(texto) + '</span></span></button>';
  return '<div class="busca-cliente-resultados">' + (lista.length ? lista.map(itemClienteHTML).join('') + criar : criar) + '</div>';
}

function enderecoHTML(f, cli) {
  const c = f.cand;
  const ends = cli.enderecos || [];
  const end = c.endereco || {};
  const chips = ends.length > 1
    ? '<div class="endereco-chips linha-chips" role="group" aria-label="Endereços do cliente">' + ends.map((e) => {
      const ativo = !!(c.endereco && c.endereco.id === e.id);
      return '<button type="button" class="chip-escolha" data-acao="escolher-endereco" data-id="' + esc(e.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + '>' +
        '<span class="chip-rotulo">' + esc(e.rotulo || 'Endereço') + '</span><span class="chip-motivo">' + esc(util.enderecoCurto(e)) + '</span></button>';
    }).join('') + '</div>'
    : '';
  const campos = '<div class="endereco-campos"' + (c.enderecoAConfirmar ? ' hidden' : '') + '>' +
    ui.campo({ id: 'f-end-log', rotulo: 'Endereço', valor: end.logradouro || '', ajuda: 'Rua e número', atributos: 'data-campo="end-logradouro" autocomplete="off"' }) +
    '<div class="linha-campos">' +
    ui.campo({ id: 'f-end-comp', rotulo: 'Complemento', valor: end.complemento || '', atributos: 'data-campo="end-complemento" autocomplete="off"' }) +
    ui.campo({ id: 'f-end-bairro', rotulo: 'Bairro', valor: end.bairro || '', atributos: 'data-campo="end-bairro" autocomplete="off"' }) +
    '</div><div class="linha-campos">' +
    ui.campo({ id: 'f-end-cidade', rotulo: 'Cidade', valor: end.cidade || '', atributos: 'data-campo="end-cidade" autocomplete="off"' }) +
    ui.campo({ id: 'f-end-ref', rotulo: 'Referência', valor: end.referencia || '', atributos: 'data-campo="end-referencia" autocomplete="off"' }) +
    '</div></div>';
  const marcar = '<label class="marcar"><input type="checkbox" data-campo="enderecoAConfirmar"' + (c.enderecoAConfirmar ? ' checked' : '') + '>' +
    '<span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span><span>Confirmar endereço com o cliente depois</span></label>';
  const aviso = c.enderecoAConfirmar ? avisoHTML('O serviço nasce com endereço pendente e a rota fica desativada') : '';
  return '<div class="mt3">' + chips + campos + marcar + aviso + erroCampoHTML(f, 'endereco') + '</div>';
}

function blocoClienteHTML(f) {
  const c = f.cand;
  const cli = c.clienteId ? dados.clientePorId(c.clienteId) : null;
  let corpo;
  if (cli) {
    corpo = '<div class="busca-cliente-escolhido"><span class="item-icone">' + icone('usuario', 20) + '</span>' +
      '<div class="item-corpo"><div class="item-titulo">' + esc(cli.nome) + '</div><div class="item-sub">' + esc(util.telFmt(cli.telefone)) + '</div></div>' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="trocar-cliente">Trocar</button></div>' + enderecoHTML(f, cli);
  } else {
    corpo = '<div class="busca-cliente"><div class="busca">' + icone('busca', 20, 'busca-icone') +
      '<input class="entrada" type="search" data-campo="busca-cliente" value="' + esc(f.buscaCliente) + '" placeholder="Nome ou telefone" autocomplete="off" aria-label="Buscar cliente por nome ou telefone" enterkeyhint="search"></div>' +
      '<div data-parte="resultados-cliente">' + resultadosClienteHTML(f) + '</div></div>' + erroCampoHTML(f, 'clienteId');
  }
  return '<div class="form-bloco-titulo"><span>Para quem</span></div>' + corpo;
}

/* ---- Bloco 3: Quando ---- */

/* A parte "regua" guarda o nome antigo da chave por onde atualizarForm troca o
   pedaço; o que ela desenha agora é a coluna de horários livres (DIRECAO 5.3). */
function horariosParteHTML(f) {
  const c = f.cand;
  return colunaHorariosHTML(c, f) + notaHorarioHTML(c) + avisoHTML(avisoDuracao(c));
}

function botaoDataHTML(c) {
  const rotulo = c.data ? util.fmtDataExtensa(c.data) : 'Escolher a data';
  return '<button type="button" class="btn btn-secundario" data-acao="abrir-mes" aria-label="' + esc('Data: ' + rotulo) + '">' +
    icone('calendario', 18) + '<span>' + esc(rotulo) + '</span></button>';
}

function blocoQuandoHTML(f) {
  const c = f.cand;
  const passada = c.data && c.data < util.hojeISO() ? avisoHTML('Data no passado') : '';
  const horario = c.data
    ? '<div class="campo-rotulo mt3">Horário</div><div data-parte="regua">' + horariosParteHTML(f) + '</div>' + controlesHorarioHTML(c, 'f') + erroCampoHTML(f, 'horario')
    : '<p class="form-bloco-espera">Escolha a data para ver os horários livres</p>';
  return '<div class="form-bloco-titulo"><span>Quando</span></div>' + botaoDataHTML(c) + erroCampoHTML(f, 'data') + passada + horario;
}

/* ---- Bloco 4: Quem vai e com o quê ---- */

function disponibilidadeDe(c) {
  return regras.disponibilidadeRecursos(c.data, c.horaInicio, c.horaFim, { ignorarId: c.id || null });
}

function equipesHTML(f, disp) {
  const c = f.cand;
  const chips = dados.equipesAtivas().map((e) => {
    const d = disp.equipes[e.id] || { estado: 'livre', comTexto: 'Livre' };
    const ativo = c.equipeId === e.id;
    const estadoTexto = d.estado === 'livre' ? 'Livre' : d.estado === 'ocupado' ? 'Ocupada: ' + d.comTexto : d.comTexto;
    return '<button type="button" class="chip-escolha" data-acao="escolher-equipe" data-id="' + esc(e.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' +
      (ativo ? ' data-ativo' : '') + (d.estado !== 'livre' ? ' data-estado="' + esc(d.estado) + '"' : '') + '>' +
      '<span class="chip-rotulo">' + icone('usuarios', 16) + esc(e.apelido || e.nome) + '</span>' +
      '<span class="chip-motivo">' + esc(nomesCurtos(e.membros || []).join(', ')) + '. ' + esc(estadoTexto) + '</span></button>';
  }).join('');
  const equipe = c.equipeId ? dados.equipePorId(c.equipeId) : null;
  let sugestao = '';
  const notas = [];
  if (equipe) {
    const padrao = equipe.veiculoPadraoId ? dados.veiculoPorId(equipe.veiculoPadraoId) : null;
    if (padrao && padrao.ativo && c.veiculoId !== padrao.id) {
      if (!c.veiculoId) sugestao = '<button type="button" class="chip-escolha chip-sugerido" data-acao="aplicar-carro-sugerido" data-id="' + esc(padrao.id) + '">' + icone('caminhao', 16) + '<span>Sugerido: ' + esc(padrao.apelido || padrao.nome) + '</span></button>';
      notas.push('A ' + (padrao.apelido || padrao.nome) + ' costuma sair com a ' + (equipe.nome || equipe.apelido));
    }
    const fora = (equipe.membros || []).filter((m) => !(c.responsaveis || []).includes(m));
    if (fora.length) notas.push((equipe.nome || equipe.apelido) + ' sem ' + listarNomes(nomesCurtos(fora)));
  }
  return '<div class="campo"><span class="campo-rotulo">Equipe <span class="opcional">(opcional)</span></span>' +
    '<div class="chips-recurso" role="group" aria-label="Equipe">' + chips + sugestao + '</div>' +
    notas.map((n) => '<p class="form-nota">' + icone('info', 14) + '<span>' + esc(n) + '</span></p>').join('') + '</div>';
}

function linhaPessoaHTML(u, c, disp) {
  const d = disp.pessoas[u.id] || { estado: 'livre', comTexto: '' };
  const ativo = (c.responsaveis || []).includes(u.id);
  const turno = regras.estaDeServico(u, c.data, c.horaInicio) ? 'turno' : d.estado === 'folga' || regras.emFolga(u, c.data) ? 'folga' : 'fora';
  const turnoTexto = turno === 'turno' ? 'em turno' : turno === 'folga' ? 'folga' : 'fora de escala';
  const motivo = d.estado === 'ocupado' ? '<div class="pessoa-motivo">Ocupado: ' + esc(d.comTexto) + '</div>' : '';
  return '<button type="button" data-acao="alternar-pessoa" data-id="' + esc(u.id) + '" role="checkbox" aria-checked="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + '>' +
    ui.avatar(u) + '<div class="pessoa-corpo"><div class="pessoa-nome"><span>' + esc(u.nome) + '</span><span class="ponto-turno" data-turno="' + turno + '" aria-hidden="true"></span><span class="turno-texto">' + turnoTexto + '</span></div>' +
    '<div class="pessoa-cargo">' + esc(u.cargo || '') + '</div>' + motivo + '</div>' +
    '<span class="caixa-marcar"' + (ativo ? ' data-ativo' : '') + ' aria-hidden="true">' + icone('check', 16) + '</span></button>';
}

function listaPessoasHTML(f) {
  const c = f.cand;
  const disp = disponibilidadeDe(c);
  const todos = dados.usuariosAtivos();
  const campo = todos.filter((u) => u.campo);
  const doSetor = campo.filter((u) => (u.setores || []).includes(c.setorId));
  const outrosCampo = campo.filter((u) => !doSetor.includes(u));
  const demais = todos.filter((u) => !u.campo);
  const filtro = util.normalizar(f.buscaPessoa.trim());
  const filtrar = (lista) => (filtro ? lista.filter((u) => util.normalizar(u.nome).includes(filtro)) : lista);
  const grupo = (titulo, lista) => (lista.length ? '<div class="chips-grupo-titulo">' + esc(titulo) + '</div><div class="lista-pessoas">' + lista.map((u) => linhaPessoaHTML(u, c, disp)).join('') + '</div>' : '');
  const busca = campo.length > 8
    ? '<div class="busca">' + icone('busca', 20, 'busca-icone') + '<input class="entrada" type="search" data-campo="busca-pessoa" value="' + esc(f.buscaPessoa) + '" placeholder="Buscar pessoa" aria-label="Buscar pessoa" autocomplete="off"></div>'
    : '';
  const maisLista = f.maisPessoas ? filtrar(demais) : demais.filter((u) => (c.responsaveis || []).includes(u.id));
  const botaoMais = demais.length
    ? '<button type="button" class="btn btn-fantasma btn-pq lista-pessoas-mais" data-acao="mais-pessoas" aria-expanded="' + (f.maisPessoas ? 'true' : 'false') + '">' +
      icone(f.maisPessoas ? 'cima' : 'baixo', 16) + '<span>' + (f.maisPessoas ? 'Menos pessoas' : 'Mais pessoas') + '</span></button>'
    : '';
  return '<div class="campo"><span class="campo-rotulo">Responsáveis</span>' + busca +
    grupo(dados.setorPorId(c.setorId).nome, filtrar(doSetor)) + grupo('Outras pessoas de campo', filtrar(outrosCampo)) + grupo('Mais pessoas', maisLista) +
    botaoMais + erroCampoHTML(f, 'responsaveis') + '</div>';
}

function cartaoCarroHTML(v, d, ativo, acao) {
  const indisp = d.estado === 'indisponivel';
  let estado;
  if (d.estado === 'livre') estado = 'Livre';
  else if (d.estado === 'ocupado') estado = 'Ocupada: ' + d.comTexto + (d.livreApartirDe ? '. Livre a partir das ' + d.livreApartirDe : '');
  else if (indisp) estado = 'Indisponível: ' + d.comTexto;
  else estado = d.comTexto;
  return '<button type="button" class="cartao-carro ' + classeCarro(v) + '" data-acao="' + esc(acao) + '" data-id="' + esc(v.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' +
    (ativo ? ' data-ativo' : '') + ' data-estado="' + esc(d.estado) + '"' + (indisp ? ' disabled aria-disabled="true"' : '') + '>' +
    '<span class="inicial">' + esc(String(v.inicial || '?').toUpperCase()) + '</span>' +
    '<div class="cartao-carro-corpo"><div class="cartao-carro-nome">' + esc(v.nome) + '</div>' +
    '<div class="cartao-carro-placa">' + esc(v.placa || '') + (v.tipo ? ', ' + esc(v.tipo) : '') + '</div>' +
    '<div class="cartao-carro-estado">' + esc(estado) + '</div></div></button>';
}

function carroHTML(f) {
  const c = f.cand;
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  const precisa = tipo ? tipo.precisaVeiculo : 'opcional';
  if (precisa !== 'sim' && !f.carroAberto && !c.veiculoId) {
    return '<div class="campo"><span class="campo-rotulo">Carro</span><div class="form-linha-carro"><span class="mudo">Sem carro</span>' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="abrir-carros">Escolher carro</button></div></div>';
  }
  const disp = disponibilidadeDe(c);
  const cartoes = dados.veiculosAtivos().map((v) => cartaoCarroHTML(v, disp.veiculos[v.id] || { estado: 'livre', comTexto: 'Livre' }, c.veiculoId === v.id, 'escolher-carro')).join('');
  const aviso = precisa === 'sim' ? '<div class="form-aviso-carro">Este serviço precisa de carro</div>' : '';
  const semCarro = precisa === 'sim'
    ? '<label class="marcar"><input type="checkbox" data-campo="semCarroConfirmado"' + (c.semCarroConfirmado ? ' checked' : '') + '><span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span><span>Sem carro desta vez</span></label>'
    : '<p class="campo-ajuda">Tocar no carro escolhido de novo tira o carro.</p>';
  return '<div class="campo"><span class="campo-rotulo">Carro</span>' + aviso + '<div role="group" aria-label="Carro">' + cartoes + '</div>' + semCarro + erroCampoHTML(f, 'veiculoId') + '</div>';
}

function blocoQuemHTML(f) {
  const c = f.cand;
  const titulo = '<div class="form-bloco-titulo"><span>Quem vai e com o quê</span></div>';
  if (!c.data || !c.horaInicio || !c.horaFim) return titulo + '<p class="form-bloco-espera">Escolha a data e o horário para ver quem está livre</p>';
  const disp = disponibilidadeDe(c);
  return titulo + equipesHTML(f, disp) + '<div data-parte="lista-pessoas">' + listaPessoasHTML(f) + '</div><div data-parte="carro">' + carroHTML(f) + '</div>';
}

/* ---- Bloco 5, faixa e rodapé ---- */

function blocoObsHTML(f) {
  return '<div class="form-bloco-titulo"><span>Observações</span></div>' +
    ui.campo({ id: 'f-obs', rotulo: 'Acesso, elevador, portaria, produto', multilinha: true, valor: f.cand.obs, atributos: 'data-campo="obs" rows="3"' });
}

function avisosForm(f, analise) {
  const c = f.cand;
  const avisos = analise.conflitos.filter((k) => k.severidade === 'aviso').map((k) => textoConflito(k));
  if (c.enderecoAConfirmar) avisos.push('Endereço a confirmar');
  const dur = avisoDuracao(c);
  if (dur) avisos.push(dur);
  const equipe = c.equipeId ? dados.equipePorId(c.equipeId) : null;
  if (equipe && equipe.veiculoPadraoId && c.veiculoId && c.veiculoId !== equipe.veiculoPadraoId) {
    const padrao = dados.veiculoPorId(equipe.veiculoPadraoId);
    if (padrao) avisos.push('A ' + (padrao.apelido || padrao.nome) + ' costuma sair com a ' + (equipe.nome || equipe.apelido));
  }
  return unicos(avisos);
}

function resumoGravacao(c) {
  const d = util.dataDe(c.data);
  const quando = c.periodo && c.periodo !== 'hora' && dados.PERIODOS[c.periodo]
    ? dados.PERIODOS[c.periodo].curto
    : util.fmtIntervalo(c.horaInicio, c.horaFim);
  const partes = [dados.nomeDoServico(c), util.DIAS_ABR[d.getDay()] + ' ' + d.getDate(), quando];
  const veiculo = c.veiculoId ? dados.veiculoPorId(c.veiculoId) : null;
  if (veiculo) partes.push(veiculo.apelido || veiculo.nome);
  else if (c.semCarroConfirmado) partes.push('sem carro');
  const nomes = listarNomes(nomesCurtos(pessoasDe(c)));
  if (nomes) partes.push(nomes);
  return partes.join(', ');
}

function calcularForm(f, u) {
  const c = f.cand;
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  const faltas = [];
  /* Mesma regra de salvarServico: o registro do colaborador (origem 'app' ou 'whatsapp') não exige cliente,
     endereço, responsáveis nem carro, então editá-lo aqui também não pode exigir (DIRECAO-2 2.1). */
  const despacho = ehDespacho(c.origem);
  if (despacho) {
    if (!tipo) faltas.push('Escolha o tipo de serviço');
    if (!c.clienteId) faltas.push('Escolha o cliente');
    else if (!c.enderecoAConfirmar && !(c.endereco && String(c.endereco.logradouro || '').trim())) faltas.push('Falta o endereço');
  } else if (!tipo && !String(c.tipoLivre || '').trim()) {
    faltas.push('Escreva o que vai ser feito');
  }
  if (!c.data) faltas.push('Escolha a data');
  if (!c.horaInicio || !c.horaFim) faltas.push('Escolha o horário');
  else if (min(c.horaFim) <= min(c.horaInicio)) faltas.push('O término precisa ser depois do início');
  if (despacho && !pessoasDe(c).length) faltas.push('Escolha ao menos uma pessoa');
  if (despacho && tipo && tipo.precisaVeiculo === 'sim' && !c.veiculoId && !c.semCarroConfirmado) faltas.push('Escolha o carro ou marque sem carro');
  const analise = analisarConflitos(c, u, { justificativa: f.justificativa, pedido: f.pedido }, f.original);
  const avisos = avisosForm(f, analise);
  let rotulo = f.editando ? 'Salvar' : 'Agendar';
  if (analise.sev === 'conflito' && !analise.coberto) {
    if (analise.decisao.modo === 'justificar') rotulo = 'Salvar com justificativa';
    else if (analise.decisao.modo === 'pedir') rotulo = 'Pedir liberação';
  }
  let resumo;
  let tom = '';
  if (faltas.length) { resumo = faltas[0]; }
  else if (analise.sev === 'bloqueio') { resumo = 'Carro indisponível: escolha outro carro ou horário'; tom = 'erro'; }
  else if (analise.sev === 'conflito' && !analise.coberto) { resumo = resumoConflito(analise.conflitos); tom = 'erro'; }
  else if (f.erros.conflito || f.erros.capacidade) { resumo = f.erros.conflito || f.erros.capacidade; tom = 'erro'; }
  else if (avisos.length) { resumo = avisos.join('. '); tom = 'aviso'; }
  else { resumo = resumoGravacao(c); tom = 'ok'; }
  const desativado = faltas.length > 0 || !!analise.decisao.erro;
  return Object.assign({ faltas, avisos, rotulo, resumo, tom, desativado }, analise);
}

function rodapeFormHTML(f, calc) {
  return '<div class="rodape-resumo"' + (calc.tom ? ' data-tom="' + calc.tom + '"' : '') + ' aria-live="polite">' + esc(calc.resumo) + '</div>' +
    '<button type="button" class="btn btn-fantasma" data-acao="cancelar-form">Cancelar</button>' +
    '<button type="button" class="btn btn-primario" data-acao="salvar-form"' + (calc.desativado ? ' disabled' : '') + '>' + esc(calc.rotulo) + '</button>';
}

function formHTML(f, u) {
  const calc = calcularForm(f, u);
  f.ultimasAlternativas = calc.alternativas;
  return '<div class="form-servico">' +
    '<section class="form-bloco" data-bloco="tipo">' + blocoTipoHTML(f, u) + '</section>' +
    '<section class="form-bloco" data-bloco="cliente">' + blocoClienteHTML(f) + '</section>' +
    '<section class="form-bloco" data-bloco="quando">' + blocoQuandoHTML(f) + '</section>' +
    '<section class="form-bloco" data-bloco="quem">' + blocoQuemHTML(f) + '</section>' +
    '<section class="form-bloco" data-bloco="obs">' + blocoObsHTML(f) + '</section>' +
    '<div data-bloco="faixa">' + faixaConflitoHTML(calc, u, f) + '</div>' +
    '</div><div class="rodape-form" data-bloco="rodape">' + rodapeFormHTML(f, calc) + '</div>';
}

/** Re-renderiza só as partes indicadas do formulário. */
function atualizarForm(raiz, f, u, partes) {
  const calc = calcularForm(f, u);
  f.ultimasAlternativas = calc.alternativas;
  const bloco = (nome) => raiz.querySelector('[data-bloco="' + nome + '"]');
  const parte = (nome) => raiz.querySelector('[data-parte="' + nome + '"]');
  const definir = (el, html) => { if (el) el.innerHTML = html; };
  const conjunto = new Set(partes);
  if (conjunto.has('tipo')) definir(bloco('tipo'), blocoTipoHTML(f, u));
  if (conjunto.has('cliente')) definir(bloco('cliente'), blocoClienteHTML(f));
  if (conjunto.has('resultados-cliente')) definir(parte('resultados-cliente'), resultadosClienteHTML(f));
  if (conjunto.has('quando')) { definir(bloco('quando'), blocoQuandoHTML(f)); rolarHorarios(raiz); }
  else if (conjunto.has('regua')) { definir(parte('regua'), horariosParteHTML(f)); rolarHorarios(raiz); }
  if (conjunto.has('horario')) atualizarInputsHorario(raiz, f.cand);
  if (conjunto.has('quem')) definir(bloco('quem'), blocoQuemHTML(f));
  else {
    if (conjunto.has('lista-pessoas')) definir(parte('lista-pessoas'), listaPessoasHTML(f));
    if (conjunto.has('carro')) definir(parte('carro'), carroHTML(f));
  }
  if (conjunto.has('faixa')) trocarFaixa(bloco('faixa'), faixaConflitoHTML(calc, u, f));
  if (conjunto.has('rodape')) definir(bloco('rodape'), rodapeFormHTML(f, calc));
}

const TUDO_DEPOIS_DO_HORARIO = ['regua', 'horario', 'quem', 'faixa', 'rodape'];

function alternarEquipe(c, id) {
  const eq = dados.equipePorId(id);
  const membros = eq ? eq.membros || [] : [];
  if (c.equipeId === id) {
    c.equipeId = null;
    c.responsaveis = (c.responsaveis || []).filter((r) => !membros.includes(r));
  } else {
    c.equipeId = id;
    c.responsaveis = unicos((c.responsaveis || []).concat(membros));
  }
}

function salvarClienteNovo(f, raiz, u) {
  const n = f.criandoCliente;
  const nome = String(n.nome || '').trim();
  const telefone = String(n.telefone || '').trim();
  if (!nome) { f.erros.novoCliente = 'Informe o nome do cliente'; atualizarForm(raiz, f, u, ['cliente']); return; }
  if (util.telDigitos(telefone).length < 8) { f.erros.novoCliente = 'Informe um telefone válido'; atualizarForm(raiz, f, u, ['cliente']); return; }
  const endereco = String(n.logradouro || '').trim()
    ? { id: util.uid('end'), rotulo: 'Principal', logradouro: n.logradouro.trim(), complemento: '', bairro: String(n.bairro || '').trim(), cidade: String(n.cidade || '').trim(), referencia: '' }
    : null;
  const cliente = repo.criar('clientes', { nome, telefone, enderecos: endereco ? [endereco] : [], obs: '', ativo: true });
  f.cand.clienteId = cliente.id;
  f.cand.endereco = endereco ? snapshotEndereco(endereco) : null;
  f.criandoCliente = null;
  f.buscaCliente = '';
  delete f.erros.novoCliente;
  f.alterado = true;
  ui.toast('Cliente criado');
  atualizarForm(raiz, f, u, ['cliente', 'rodape']);
  const foco = raiz.querySelector('[data-campo="end-logradouro"]');
  if (foco && !endereco) foco.focus();
}

function acaoForm(acao, el, f, u, raiz) {
  const c = f.cand;
  const id = el.getAttribute('data-id');
  const valor = el.getAttribute('data-valor');
  const mudou = () => { f.alterado = true; f.erros = {}; };
  if (acao === 'abrir-mes') {
    /* O formulário não é uma folha, então o calendário do mês pode abrir por cima dele (DIRECAO 5.3). */
    abrirCalendarioMes(c, f, () => { mudou(); atualizarForm(raiz, f, u, ['quando', 'quem', 'faixa', 'rodape']); });
    return;
  }
  if (tratarAcaoQuando(acao, el, c, f)) {
    mudou();
    atualizarForm(raiz, f, u, acao === 'escolher-slot' || acao === 'ajustar-fim' ? TUDO_DEPOIS_DO_HORARIO : ['quando', 'quem', 'faixa', 'rodape']);
    return;
  }
  switch (acao) {
    case 'escolher-tipo': {
      c.tipoId = valor;
      const tipo = dados.tipoPorId(valor);
      if (tipo) {
        c.setorId = tipo.setorPadrao;
        if (c.horaInicio) c.horaFim = fimPorDuracao(c.horaInicio, tipo.duracaoPadraoMin || cfg().duracaoPadraoMin);
        if (tipo.precisaVeiculo === 'sim') f.carroAberto = true;
      }
      f.tipoRecolhido = true;
      mudou();
      atualizarForm(raiz, f, u, ['tipo', 'quando', 'quem', 'faixa', 'rodape']);
      break;
    }
    case 'trocar-tipo':
      f.tipoRecolhido = false;
      atualizarForm(raiz, f, u, ['tipo']);
      { const primeiro = raiz.querySelector('[data-acao="escolher-tipo"][data-ativo]') || raiz.querySelector('[data-acao="escolher-tipo"]'); if (primeiro) primeiro.focus(); }
      break;
    case 'escolher-cliente': {
      const cli = dados.clientePorId(id);
      if (!cli) break;
      c.clienteId = cli.id;
      c.endereco = cli.enderecos && cli.enderecos[0] ? snapshotEndereco(cli.enderecos[0]) : null;
      f.buscaCliente = '';
      mudou();
      atualizarForm(raiz, f, u, ['cliente', 'rodape']);
      break;
    }
    case 'trocar-cliente':
      c.clienteId = null; c.endereco = null; f.criandoCliente = null; f.buscaCliente = '';
      mudou();
      atualizarForm(raiz, f, u, ['cliente', 'rodape']);
      { const busca = raiz.querySelector('[data-campo="busca-cliente"]'); if (busca) busca.focus(); }
      break;
    case 'criar-cliente': {
      const texto = f.buscaCliente.trim();
      const ehTelefone = util.telDigitos(texto).length >= 8 && !/[a-zA-ZÀ-ÿ]/.test(texto);
      f.criandoCliente = { nome: ehTelefone ? '' : texto, telefone: ehTelefone ? texto : '', logradouro: '', bairro: '', cidade: 'Itapema, SC' };
      atualizarForm(raiz, f, u, ['resultados-cliente']);
      { const foco = raiz.querySelector('[data-campo="' + (ehTelefone ? 'novo-nome' : 'novo-telefone') + '"]'); if (foco) foco.focus(); }
      break;
    }
    case 'cancelar-cliente-novo':
      f.criandoCliente = null;
      delete f.erros.novoCliente;
      atualizarForm(raiz, f, u, ['resultados-cliente']);
      break;
    case 'salvar-cliente':
      salvarClienteNovo(f, raiz, u);
      break;
    case 'escolher-endereco': {
      const cli = dados.clientePorId(c.clienteId);
      const end = cli ? (cli.enderecos || []).find((e) => e.id === id) : null;
      if (!end) break;
      c.endereco = snapshotEndereco(end);
      c.enderecoAConfirmar = false;
      mudou();
      atualizarForm(raiz, f, u, ['cliente', 'rodape']);
      break;
    }
    case 'escolher-equipe':
      alternarEquipe(c, id);
      mudou();
      atualizarForm(raiz, f, u, ['quem', 'faixa', 'rodape']);
      break;
    case 'aplicar-carro-sugerido':
      c.veiculoId = id; c.semCarroConfirmado = false; f.carroAberto = true;
      mudou();
      atualizarForm(raiz, f, u, ['quem', 'faixa', 'rodape']);
      break;
    case 'alternar-pessoa':
      c.responsaveis = (c.responsaveis || []).includes(id) ? c.responsaveis.filter((r) => r !== id) : unicos((c.responsaveis || []).concat(id));
      mudou();
      atualizarForm(raiz, f, u, ['quem', 'faixa', 'rodape']);
      break;
    case 'mais-pessoas':
      f.maisPessoas = !f.maisPessoas;
      atualizarForm(raiz, f, u, ['lista-pessoas']);
      break;
    case 'abrir-carros':
      f.carroAberto = true;
      atualizarForm(raiz, f, u, ['carro']);
      break;
    case 'escolher-carro':
      c.veiculoId = c.veiculoId === id ? null : id;
      if (c.veiculoId) c.semCarroConfirmado = false;
      mudou();
      atualizarForm(raiz, f, u, ['quem', 'faixa', 'rodape']);
      break;
    case 'aplicar-alternativa': {
      const alt = (f.ultimasAlternativas || []).find((x) => x.id === valor);
      if (!alt) break;
      Object.assign(c, alt.mudancas);
      if (alt.mudancas.veiculoId !== undefined) f.carroAberto = true;
      mudou();
      atualizarForm(raiz, f, u, ['quando', 'quem', 'faixa', 'rodape']);
      break;
    }
    case 'cancelar-form':
      cancelarForm(f);
      break;
    case 'salvar-form':
      salvarForm(f, u, raiz);
      break;
    default:
      break;
  }
}

const CAMPOS_DE_MUDANCA = new Set(['setorId', 'enderecoAConfirmar', 'dataCalendario', 'horaInicio', 'horaFim', 'semCarroConfirmado']);
const CAMPOS_ENDERECO = { 'end-logradouro': 'logradouro', 'end-complemento': 'complemento', 'end-bairro': 'bairro', 'end-cidade': 'cidade', 'end-referencia': 'referencia' };
const CAMPOS_NOVO_CLIENTE = { 'novo-nome': 'nome', 'novo-telefone': 'telefone', 'novo-logradouro': 'logradouro', 'novo-bairro': 'bairro', 'novo-cidade': 'cidade' };

function campoForm(el, evento, f, u, raiz) {
  const campo = el.getAttribute('data-campo');
  const ehMudanca = CAMPOS_DE_MUDANCA.has(campo);
  if (ehMudanca !== (evento === 'change')) return;
  const c = f.cand;
  const valor = el.type === 'checkbox' ? el.checked : el.value;
  const mudou = () => { f.alterado = true; f.erros = {}; };
  if (tratarCampoQuando(campo, valor, c)) {
    mudou();
    atualizarForm(raiz, f, u, campo === 'dataCalendario' ? ['quando', 'quem', 'faixa', 'rodape'] : ['regua', 'quem', 'faixa', 'rodape']);
    return;
  }
  if (CAMPOS_ENDERECO[campo]) {
    if (!c.endereco) c.endereco = snapshotEndereco({});
    c.endereco[CAMPOS_ENDERECO[campo]] = valor;
    f.alterado = true;
    f.recalcular(['rodape']);
    return;
  }
  if (CAMPOS_NOVO_CLIENTE[campo]) {
    if (f.criandoCliente) f.criandoCliente[CAMPOS_NOVO_CLIENTE[campo]] = valor;
    return;
  }
  switch (campo) {
    case 'setorId':
      c.setorId = valor; mudou();
      atualizarForm(raiz, f, u, ['regua', 'quem', 'faixa', 'rodape']);
      break;
    case 'busca-cliente':
      f.buscaCliente = valor;
      atualizarForm(raiz, f, u, ['resultados-cliente']);
      break;
    case 'enderecoAConfirmar':
      c.enderecoAConfirmar = !!valor; mudou();
      atualizarForm(raiz, f, u, ['cliente', 'rodape']);
      break;
    case 'busca-pessoa':
      f.buscaPessoa = valor;
      atualizarForm(raiz, f, u, ['lista-pessoas']);
      { const busca = raiz.querySelector('[data-campo="busca-pessoa"]'); if (busca) { busca.focus(); busca.setSelectionRange(valor.length, valor.length); } }
      break;
    case 'semCarroConfirmado':
      c.semCarroConfirmado = !!valor;
      if (valor) c.veiculoId = null;
      mudou();
      atualizarForm(raiz, f, u, ['quem', 'faixa', 'rodape']);
      break;
    case 'obs':
      c.obs = valor; f.alterado = true;
      break;
    case 'justificativa':
      f.justificativa = valor; f.recalcular(['rodape']);
      break;
    case 'pedido':
      f.pedido = valor; f.recalcular(['rodape']);
      break;
    default:
      break;
  }
}

async function cancelarForm(f) {
  if (f.alterado) {
    const ok = await ui.confirmar({ titulo: 'Descartar alterações?', texto: 'O que você preencheu neste serviço será perdido.', rotuloOk: 'Descartar', rotuloCancelar: 'Continuar editando', perigo: true });
    if (!ok) return;
  }
  formAtivo = null;
  ui.voltar();
}

async function salvarForm(f, u, raiz) {
  const calc = calcularForm(f, u);
  if (calc.desativado) { ui.toast(calc.resumo, 'erro'); return; }
  const c = f.cand;
  let regenerar = false;
  if (f.editando && c.tipoId !== f.original.tipoId) {
    const tipo = dados.tipoPorId(c.tipoId);
    const algumFeito = (f.original.checklist || []).some((k) => k.feito);
    if (tipo && !algumFeito && (tipo.checklist || []).length) {
      regenerar = await ui.confirmar({ titulo: 'Trocar o checklist?', texto: 'O tipo mudou para ' + tipo.nome + '. Quer substituir o checklist pelo modelo desse tipo?', rotuloOk: 'Substituir', rotuloCancelar: 'Manter' });
    }
  }
  const r = salvarServico(c, { id: c.id, justificativa: f.justificativa, pedirLiberacao: f.pedido, regenerarChecklist: regenerar });
  if (!r.ok) {
    f.erros = {};
    for (const e of r.erros) if (!f.erros[e.campo]) f.erros[e.campo] = e.mensagem;
    atualizarForm(raiz, f, u, ['tipo', 'cliente', 'quando', 'quem', 'faixa', 'rodape']);
    ui.toast(r.erros[0].mensagem, 'erro');
    return;
  }
  formAtivo = null;
  f.alterado = false;
  const modo = calc.decisao.modo;
  ui.toast(f.editando ? 'Serviço salvo' : modo === 'pedir' ? 'Agendado. Liberação pedida à gerência' : modo === 'justificar' ? 'Agendado com justificativa' : 'Serviço agendado');
  ui.irPara('#/servico/' + r.agendamento.id, { substituir: true });
}

/**
 * Formulário de serviço (8.1). Modo novo com pré-preenchimento pela query (3.1) ou edição por params.id.
 * @param {{params:{id?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaFormulario(ctx) {
  const { params, alvo } = ctx;
  const query = ctx.query || {};
  const u = ctx.usuario || usuarioAtual();
  const original = params.id ? servico(params.id) : null;
  if (params.id && !original) { telaErro(alvo, 'Serviço não encontrado', 'Ele pode ter sido removido ou o endereço está errado.'); return; }
  if (original && !dados.visivel(original, u)) { telaErro(alvo, 'Serviço fora do seu setor', 'Você só vê os serviços dos seus setores ou em que está alocado.'); return; }
  if (original) {
    const acoes = regras.acoesDisponiveis(original, u);
    if (!acoes.editar) { telaErro(alvo, 'Este serviço não pode ser editado', regras.statusAtivo(original.status) ? 'Você não tem permissão para editar este serviço neste status.' : 'Serviço encerrado. Use "Duplicar para outra data".'); return; }
  } else if (!dados.pode('criarServico', u)) {
    telaErro(alvo, 'Você não pode criar serviços', 'Peça a um atendente ou à gestão.');
    return;
  }
  const chave = original ? 'editar:' + original.id + ':' + original.versao : 'novo:' + JSON.stringify(query);
  if (!formAtivo || formAtivo.chave !== chave) formAtivo = criarEstadoForm(original, query, chave);
  const f = formAtivo;
  ui.montarCabecalho({ voltar: true, titulo: f.editando ? 'Editar serviço' : 'Novo serviço', subtitulo: f.editando ? tituloServico(original) : undefined });
  ui.renderizar(alvo, formHTML(f, u), (raiz) => {
    f.recalcular = util.debounce((partes) => atualizarForm(raiz, f, u, partes), 200);
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      acaoForm(acao, el, f, u, raiz);
    });
    ui.delegar(raiz, '[data-campo]', 'input', (acao, el) => campoForm(el, 'input', f, u, raiz));
    ui.delegar(raiz, '[data-campo]', 'change', (acao, el) => campoForm(el, 'change', f, u, raiz));
    rolarHorarios(raiz);
    if (query.foco === 'conflito') {
      const faixa = raiz.querySelector('.faixa-conflito');
      if (faixa) { faixa.scrollIntoView({ block: 'center' }); try { faixa.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
    } else if (f.focarData) {
      f.focarData = false;
      const botao = raiz.querySelector('[data-acao="abrir-mes"]');
      if (botao) { try { botao.focus({ preventScroll: true }); } catch (e) { /* ignora */ } }
    }
  });
}

/* ================================================================== */
/* Peças de escolha reaproveitadas (DIRECAO-2 3.3 e 3.5)               */
/* A grade de cartões de tipo, o rodízio de carro e equipe e a folha   */
/* de troca vieram do fluxo de quatro passos, que foi aposentado em    */
/* 22/09/2026: agora abrem sob demanda dentro da tela Registrar.       */
/* ================================================================== */

const ROTULO_CARRO_TIPO = { sim: 'precisa de carro', nao: 'sem carro', opcional: 'carro opcional' };

/** Resumo de um tipo para o cartão: "1 h 30, precisa de carro". */
function metaDoTipo(t) {
  return util.fmtDuracao(t.duracaoPadraoMin) + ', ' + (ROTULO_CARRO_TIPO[t.precisaVeiculo] || ROTULO_CARRO_TIPO.opcional);
}

/**
 * Cartão de tipo de serviço (DIRECAO 3.4 passo 1 e 3.6): faixa de 4 px na cor do setor no topo,
 * ícone, nome, duração e exigência de carro, e quantos itens tem o checklist.
 * Com `acao` vira botão de escolha; sem ela, um cartão com rodapé de ações (a tela Tipos).
 * @param {object} tipo @param {{acao?:string, ativo?:boolean, rodape?:string, interruptor?:string}} [opcoes]
 * @returns {string}
 */
export function cartaoTipoHTML(tipo, opcoes = {}) {
  const t = tipo || {};
  const cor = t.cor || t.setorPadrao || '';
  const classes = ['cartao-tipo'];
  if (cor) classes.push('setor-' + esc(cor));
  const itens = (t.checklist || []).length;
  const corpo = '<span class="cartao-tipo-icone">' + icone(t.icone || 'caixa', 24) + '</span>' +
    '<span class="cartao-tipo-nome">' + esc(t.nome || 'Serviço') + '</span>' +
    '<span class="cartao-tipo-meta">' + esc(metaDoTipo(t)) + '</span>' +
    '<span class="cartao-tipo-check">' + esc(itens ? plural(itens, 'item no checklist', 'itens no checklist') : 'Sem checklist') + '</span>';
  const attrs = ['class="' + classes.join(' ') + '"'];
  if (t.ativo === false) attrs.push('data-inativo');
  if (opcoes.ativo) attrs.push('data-ativo');
  if (opcoes.acao) {
    return '<button type="button" ' + attrs.join(' ') + ' data-acao="' + esc(opcoes.acao) + '" data-id="' + esc(t.id) + '"' +
      ' aria-pressed="' + (opcoes.ativo ? 'true' : 'false') + '">' + corpo + '</button>';
  }
  return '<div ' + attrs.join(' ') + '>' + (opcoes.interruptor || '') + corpo + (opcoes.rodape || '') + '</div>';
}

/**
 * Link interno do tipo, para colar no WhatsApp da equipe (DIRECAO 4.8). Desde a Direção 2 ele aponta para
 * #/registrar com o tipo já escolhido; os links antigos (#/agendar/:tipo) continuam valendo por redirecionamento.
 * @param {string} tipoId @returns {string}
 */
export function linkDoTipo(tipoId) {
  return location.origin + location.pathname + '#/registrar' + ui.montarQuery({ tipo: tipoId || '' });
}

/** "Fiorino e Entrega 01" a partir de uma escolha de recurso. */
function textoRecurso(escolha) {
  if (!escolha) return '';
  const veiculo = escolha.veiculoId ? dados.veiculoPorId(escolha.veiculoId) : null;
  const equipe = escolha.equipeId ? dados.equipePorId(escolha.equipeId) : null;
  const partes = [];
  if (veiculo) partes.push(veiculo.apelido || veiculo.nome);
  else if (escolha.semCarroConfirmado) partes.push('sem carro');
  if (equipe) partes.push(equipe.apelido || equipe.nome);
  else {
    const nomes = listarNomes(nomesCurtos(escolha.responsaveis || []));
    if (nomes) partes.push(nomes);
  }
  return listarNomes(partes);
}

/**
 * Linha do recurso alocado, acima da lista de horários (DIRECAO 3.4 e 4.7).
 * Só aparece quando há um horário em confirmação: é dele que o rodízio tira carro e equipe.
 */
function recursoEscolhidoHTML(e) {
  if (!e.cand.data) return '';
  if (!e.horaProvisoria) {
    return '<p class="agendar-nota">Carro e equipe entram pelo rodízio, com quem tiver menos serviços no dia escolhido.</p>';
  }
  const texto = textoRecurso(e.recursoSugerido) || 'a definir';
  return '<div class="agendar-recurso">' + icone('caminhao', 18) +
    '<span>Vai com <span class="agendar-recurso-nome">' + esc(texto) + '</span></span>' +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="trocar-recurso">Trocar</button></div>';
}

/** Chips de duração quando o tipo oferece mais de uma (DIRECAO 4.14). */
function duracoesHTML(e) {
  const lista = regras.duracoesDoTipo(e.cand.tipoId);
  if (lista.length < 2) return '';
  const atual = duracaoEmVigor(e.cand, e);
  return '<div class="agendar-duracoes" role="group" aria-label="Duração">' + lista.map((d) => {
    const ativo = d === atual;
    return '<button type="button" class="chip chip-escolha" data-acao="escolher-duracao" data-valor="' + d + '"' + (ativo ? ' data-ativo' : '') +
      ' aria-pressed="' + (ativo ? 'true' : 'false') + '">' + esc(util.fmtDuracao(d)) + '</button>';
  }).join('') + '</div>';
}

/** O intervalo em confirmação: dia escolhido mais a hora provisória. */
function intervaloProvisorio(e) {
  const c = e.cand;
  const hora = e.horaProvisoria || c.horaInicio;
  if (!c.data || !hora) return null;
  return { data: c.data, horaInicio: hora, horaFim: fimPorDuracao(hora, duracaoEmVigor(c, e)) };
}

/**
 * Escolhe carro e gente para o horário em confirmação (DIRECAO 4.7). O resultado fica em
 * `e.recursoSugerido` e só entra no candidato ao confirmar: enquanto isso, a coluna de horários
 * continua valendo para qualquer recurso livre, não só para o que o rodízio pegou.
 */
function aplicarRodizio(e) {
  const intervalo = intervaloProvisorio(e);
  if (!intervalo) { e.recursoSugerido = null; return; }
  if (e.recursoManual && e.recursoSugerido) return;
  const base = Object.assign({}, e.cand, intervalo, { veiculoId: null, equipeId: null, responsaveis: [], semCarroConfirmado: false });
  e.recursoSugerido = regras.escolherRecurso(base, {});
}

/** Passa a escolha de recurso para o candidato, na hora de confirmar o horário. */
function fixarRecurso(e) {
  const c = e.cand;
  const escolha = e.recursoSugerido;
  if (!escolha) return;
  c.veiculoId = escolha.veiculoId || null;
  c.equipeId = escolha.equipeId || null;
  c.responsaveis = (escolha.responsaveis || []).slice();
  c.semCarroConfirmado = !!escolha.semCarroConfirmado;
}

/** Volta o candidato ao estado sem recurso, para a coluna de horários não ficar presa a um carro. */
function soltarRecurso(e) {
  const c = e.cand;
  if (e.recursoManual) return;
  c.veiculoId = null;
  c.equipeId = null;
  c.responsaveis = [];
  c.semCarroConfirmado = false;
}

/** Folha de escolha manual de carro e equipe, aberta pelo botão "Trocar" do passo 2. */
function abrirTrocarRecurso(e, aoFechar) {
  const intervalo = intervaloProvisorio(e);
  if (!intervalo) return;
  const c = Object.assign({}, e.cand, intervalo, e.recursoSugerido || {});
  const corpo = () => {
    const disp = disponibilidadeDe(c);
    const carros = dados.veiculosAtivos()
      .map((v) => cartaoCarroHTML(v, disp.veiculos[v.id] || { estado: 'livre', comTexto: 'Livre' }, c.veiculoId === v.id, 'escolher-carro')).join('');
    /* Só as equipes do setor do tipo (uma Entrega não lista Decoração); a já escolhida nunca some. */
    const doSetor = (eq) => !c.setorId || !Array.isArray(eq.setores) || !eq.setores.length || eq.setores.includes(c.setorId) || eq.id === c.equipeId;
    const equipes = dados.equipesAtivas().filter(doSetor).map((eq) => {
      const d = disp.equipes[eq.id] || { estado: 'livre', comTexto: 'Livre' };
      const ativo = c.equipeId === eq.id;
      return '<button type="button" class="chip-escolha" data-acao="escolher-equipe" data-id="' + esc(eq.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' +
        (ativo ? ' data-ativo' : '') + (d.estado !== 'livre' ? ' data-estado="' + esc(d.estado) + '"' : '') + '>' +
        '<span class="chip-rotulo">' + icone('usuarios', 16) + esc(eq.apelido || eq.nome) + '</span>' +
        '<span class="chip-motivo">' + esc(d.estado === 'livre' ? 'Livre' : d.comTexto) + '</span></button>';
    }).join('');
    return '<div class="campo"><span class="campo-rotulo">Carro</span><div role="group" aria-label="Carro">' + carros + '</div></div>' +
      '<div class="campo"><span class="campo-rotulo">Equipe</span><div class="chips-recurso" role="group" aria-label="Equipe">' + equipes + '</div></div>' +
      '<p class="msg-nota">Sem escolha manual, o rodízio pega quem tem menos serviços no dia.</p>';
  };
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Trocar carro e equipe',
    corpo: '<div data-parte="recursos">' + corpo() + '</div>',
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="voltar-rodizio">Deixar o rodízio escolher</button>' +
      '<button type="button" class="btn btn-primario" data-acao="aplicar-recurso">Usar estes</button>'
  });
  const atualizar = () => { const caixa = el.querySelector('[data-parte="recursos"]'); if (caixa) caixa.innerHTML = corpo(); };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    const id = alvo.getAttribute('data-id');
    if (acao === 'escolher-carro') {
      c.veiculoId = c.veiculoId === id ? null : id;
      if (c.veiculoId) c.semCarroConfirmado = false;
      atualizar();
    } else if (acao === 'escolher-equipe') {
      alternarEquipe(c, id);
      atualizar();
    } else if (acao === 'voltar-rodizio') {
      e.recursoManual = false;
      aplicarRodizio(e);
      fechar();
      if (typeof aoFechar === 'function') aoFechar();
    } else if (acao === 'aplicar-recurso') {
      e.recursoManual = true;
      e.recursoSugerido = {
        veiculoId: c.veiculoId || null, equipeId: c.equipeId || null,
        responsaveis: (c.responsaveis || []).slice(), semCarroConfirmado: !!c.semCarroConfirmado
      };
      fechar();
      if (typeof aoFechar === 'function') aoFechar();
    }
  });
}

/* ================================================================== */
/* Registrar (DIRECAO-2, seção 3)                                      */
/* A única porta de criação: uma tela, quatro blocos e um rodapé que   */
/* não sai da vista. "Amanhã à tarde estou na loja" em cinco toques,   */
/* sem teclado. Obrigatório só a data e "o que vou fazer"; cliente,    */
/* local e carro são texto livre e opcionais, como no grupo. O que era */
/* o fluxo de quatro passos virou folha que abre sob demanda, e o      */
/* formulário avançado continua em #/servico/novo para editar e para   */
/* o despacho da loja.                                                 */
/* ================================================================== */

let registrarAtivo = null;

/** Ordem dos chips de período. "Hora exata" abre a coluna de horários livres. */
const PERIODOS_CHIP = ['manha', 'tarde', 'dia', 'hora'];
/** Quantos tipos mais usados entram nos chips, além dos tipos sem setor, que vêm sempre primeiro. */
const MAX_TIPOS_CHIP = 5;
const DIAS_DE_HISTORICO = 60;
const MAX_SUGESTOES_CLIENTE = 3;

/* ---- Preferências e rascunho (3.7) ---- */

function prefsRegistrar(u) {
  const p = u ? dados.prefs(u.id) : {};
  return Object.assign({ maisOpcoes: false, rascunho: null }, (p && p.registrar) || {});
}

/** Grava só dentro da seção `registrar` das preferências; nenhum outro lote escreve aqui (seção 0, regra 7). */
function salvarPrefRegistrar(u, mudancas) {
  if (!u) return;
  dados.salvarPrefs(u.id, { registrar: mudancas });
}

function rascunhoDe(e) {
  const c = e.cand;
  return {
    data: c.data, periodo: c.periodo, horaInicio: c.horaInicio, horaFim: c.horaFim,
    tipoId: c.tipoId || null, tipoTexto: e.tipoTexto || '',
    clienteId: c.clienteId || null, clienteTexto: e.clienteTexto || '', localTexto: e.localTexto || '',
    veiculoId: c.veiculoId || null, semCarroConfirmado: !!c.semCarroConfirmado, obs: c.obs || '', salvoEm: agora()
  };
}

/* Telefone que tranca no meio do preenchimento é a regra em quem registra de pé, então o rascunho é gravado a
   cada alteração e restaurado ao voltar. Rascunho de dia que já passou não volta: viraria registro errado. */
function guardarRascunho(e, u) {
  if (!u || e.fim) return;
  salvarPrefRegistrar(u, { rascunho: rascunhoDe(e) });
}

function limparRascunho(u) {
  salvarPrefRegistrar(u, { rascunho: null });
}

/* Só data e período não são rascunho: são dois toques que se refazem em menos tempo do que se lê "Rascunho
   restaurado", e o aviso mais o "Começar do zero" quebravam a meta dos cinco toques. */
function rascunhoTemSubstancia(r) {
  if (!r) return false;
  return !!(r.tipoId || (r.tipoTexto || '').trim() || r.clienteId || (r.clienteTexto || '').trim() ||
    (r.localTexto || '').trim() || r.veiculoId || r.semCarroConfirmado || (r.obs || '').trim());
}

function aplicarRascunho(e, r) {
  if (!r || !r.data || r.data < util.hojeISO()) return false;
  const c = e.cand;
  c.data = r.data;
  c.periodo = dados.PERIODOS[r.periodo] ? r.periodo : 'hora';
  if (r.horaInicio) c.horaInicio = r.horaInicio;
  if (r.horaFim) c.horaFim = r.horaFim;
  const tipo = r.tipoId ? dados.tipoPorId(r.tipoId) : null;
  c.tipoId = tipo ? tipo.id : null;
  if (tipo) c.setorId = tipo.setorPadrao;
  e.tipoTexto = r.tipoTexto || (tipo ? tipo.nome : '');
  const cli = r.clienteId ? dados.clientePorId(r.clienteId) : null;
  c.clienteId = cli ? cli.id : null;
  if (cli && cli.enderecos && cli.enderecos[0]) c.endereco = snapshotEndereco(cli.enderecos[0]);
  e.clienteTexto = r.clienteTexto || (cli ? cli.nome : '');
  e.localTexto = r.localTexto || '';
  const veiculo = r.veiculoId ? dados.veiculoPorId(r.veiculoId) : null;
  c.veiculoId = veiculo ? veiculo.id : null;
  c.semCarroConfirmado = !!r.semCarroConfirmado && !c.veiculoId;
  c.obs = r.obs || '';
  return true;
}

/* ---- Estado ---- */

/**
 * Estado da tela. Reusa o estado do formulário avançado (mesmo candidato, mesmas listas de pessoas e equipes) e
 * acrescenta o que é só daqui: período, o texto do "o que vou fazer", o texto de cliente e local, as gavetas do
 * calendário e dos horários, o "Mais opções" e a confirmação.
 */
function criarEstadoRegistrar(query, chave, u) {
  const e = criarEstadoForm(null, query || {}, chave);
  const c = e.cand;
  c.origem = 'app';
  c.criadoPor = u ? u.id : null;
  /* O autor nunca é perguntado: quem escreve é quem faz (DIRECAO-2 D1). */
  if (u && !c.responsaveis.length) c.responsaveis = [u.id];
  if (!c.data) c.data = dataPadrao();
  c.periodo = query && query.inicio ? 'hora' : 'dia';
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  const cli = c.clienteId ? dados.clientePorId(c.clienteId) : null;
  e.tipoTexto = tipo ? tipo.nome : '';
  e.clienteTexto = cli ? cli.nome : '';
  e.localTexto = c.endereco ? util.enderecoTexto(c.endereco) : '';
  e.calendario = false;
  e.horas = false;
  e.horaProvisoria = c.horaInicio || '';
  e.recursoManual = false;
  e.recursoSugerido = null;
  e.criadoId = null;
  e.fim = false;
  e.avisoGravacao = '';
  e.restaurado = false;
  /* "Escrever como no grupo" (DIRECAO-3 5.4): mora no estado da tela, não no rascunho; o que vale como rascunho
     é o que já virou campo. */
  e.textoGrupo = '';
  e.quemBusca = '';
  if (c.responsavelTexto == null) c.responsavelTexto = '';
  const prefs = prefsRegistrar(u);
  e.maisOpcoes = !!prefs.maisOpcoes;
  /* O FAB manda sempre a data do dia em que se tocou, então "só data" ainda é entrada em branco e o rascunho
     volta; o dia pedido pelo link é que vence. Link com tipo, cliente ou hora abre limpo, porque ali o pedido é outro. */
  const chaves = Object.keys(query || {});
  const soData = !chaves.length || (chaves.length === 1 && chaves[0] === 'data');
  if (soData && rascunhoTemSubstancia(prefs.rascunho) && aplicarRascunho(e, prefs.rascunho)) {
    e.restaurado = true;
    if (query && query.data) c.data = query.data;
  }
  aplicarPeriodo(e);
  return e;
}

/**
 * Período vira hora sem mentir (DIRECAO-2 2.3): a interface mostra "Tarde", o dado guarda 13:30 às 18:30 e
 * `horaAproximada`, que faz o conflito avisar em vez de bloquear.
 * @returns {{horaInicio:string, horaFim:string, fechado:boolean}|null}
 */
function aplicarPeriodo(e) {
  const c = e.cand;
  if (c.periodo === 'hora') {
    /* As horas de um período (08:00 às 18:30 do "dia todo") não valem como duração da hora exata: sem isso a
       coluna procurava vaga de dez horas e não achava nenhuma. A duração volta a ser a do tipo ou a da config. */
    if (c.horaAproximada) c.horaFim = '';
    c.horaAproximada = false;
    if (!c.horaInicio) c.horaInicio = inicioPadrao(c);
    c.horaFim = fimPorDuracao(c.horaInicio, duracaoEmVigor(c, e));
    return null;
  }
  const horas = regras.horasDoPeriodo(c.data, c.periodo, c.setorId);
  if (horas) { c.horaInicio = horas.horaInicio; c.horaFim = horas.horaFim; }
  c.horaAproximada = true;
  return horas;
}

/* ---- Blocos ---- */

function rotuloBlocoHTML(texto, opcional) {
  return '<div class="registrar-rotulo">' + esc(texto) +
    (opcional ? '<span class="registrar-opcional">opcional</span>' : '') + '</div>';
}

function chipRegistrarHTML(rotulo, acao, valor, ativo, conteudo) {
  return '<button type="button" class="chip-registrar" data-acao="' + esc(acao) + '"' +
    (valor == null ? '' : ' data-valor="' + esc(valor) + '"') +
    (ativo ? ' data-ativo' : '') + ' aria-pressed="' + (ativo ? 'true' : 'false') + '">' +
    (conteudo || '') + '<span>' + esc(rotulo) + '</span></button>';
}

function blocoQuandoRegistrarHTML(e) {
  const c = e.cand;
  const hoje = util.hojeISO();
  const amanha = util.addDias(hoje, 1);
  const outroDia = !!c.data && c.data !== hoje && c.data !== amanha;
  const chipsData = [
    chipRegistrarHTML('Hoje', 'reg-dia', hoje, c.data === hoje),
    chipRegistrarHTML('Amanhã', 'reg-dia', amanha, c.data === amanha),
    chipRegistrarHTML(outroDia ? util.fmtDataMedia(c.data) : 'Outro dia', 'reg-calendario', '', outroDia || e.calendario)
  ].join('');
  const calendario = e.calendario
    ? '<div class="registrar-gaveta" data-parte="calendario" aria-label="Calendário do mês">' + calendarioMesHTML(c, e) + '</div>'
    : '';
  const chipsPeriodo = PERIODOS_CHIP.map((p) => {
    const ativo = c.periodo === p;
    const rotulo = p === 'hora' && ativo && c.horaInicio && !e.horas ? c.horaInicio : dados.PERIODOS[p].rotulo;
    return chipRegistrarHTML(rotulo, p === 'hora' ? 'reg-hora-exata' : 'reg-periodo', p, ativo);
  }).join('');
  const horarios = e.horas
    ? '<div class="registrar-gaveta" data-parte="horarios">' + duracoesHTML(e) +
      colunaHorariosHTML(c, e, { acao: 'reg-horario', comGesto: true }) + '</div>'
    : '';
  return '<section class="registrar-bloco">' + rotuloBlocoHTML('Quando') +
    '<div class="registrar-chips" role="group" aria-label="Dia">' + chipsData + '</div>' + calendario +
    '<div class="registrar-chips" role="group" aria-label="Período">' + chipsPeriodo + '</div>' + horarios +
    traducaoHTML(e) + '</section>';
}

/** A linha que diz o que vai ser gravado, para não haver surpresa depois na grade (DIRECAO-2 3.3). */
function traducaoHTML(e) {
  const c = e.cand;
  if (!c.data) return '<p class="registrar-traducao" data-parte="traducao">Escolha o dia</p>';
  const partes = [util.fmtDataExtensa(c.data)];
  if (c.periodo === 'hora') partes.push(util.fmtIntervalo(c.horaInicio, c.horaFim));
  else partes.push(dados.PERIODOS[c.periodo].curto, 'das ' + c.horaInicio + ' às ' + c.horaFim);
  const fechado = regras.motivoDiaFechado(c.data, c.setorId);
  const aviso = fechado ? '<span class="registrar-traducao-aviso">' + esc(fechado.texto) + '</span>' : '';
  return '<p class="registrar-traducao" data-parte="traducao" aria-live="polite">' + esc(partes.join(', ')) + aviso + '</p>';
}

/** Quantas vezes esta pessoa usou cada tipo nos últimos 60 dias, para ordenar os chips (DIRECAO-2 3.3). */
function usoDosTipos(u) {
  const mapa = {};
  if (!u) return mapa;
  const desde = util.addDias(util.hojeISO(), -DIAS_DE_HISTORICO);
  for (const a of repo.listar('agendamentos', (x) => x.tipoId && x.criadoPor === u.id && x.data >= desde)) {
    mapa[a.tipoId] = (mapa[a.tipoId] || 0) + 1;
  }
  return mapa;
}

function tiposDosChips(e, u) {
  const lista = [];
  for (const [, tipos] of gruposDeTipos(u, e.cand.tipoId)) for (const t of tipos) lista.push(t);
  /* Até a v3 o tipo sem setor ("Loja") vinha sempre primeiro. Desde a DIRECAO-3 2.2 não vem mais: a faixa
     "Onde estou" resolve o caso comum em um toque, o chip virou o caso raro e o cadastro já o pôs em `ordem: 13`.
     A ordem agora é uso nos últimos 60 dias e depois a ordem do cadastro, para todo mundo igual; o tipo sem setor
     que não entrar no corte fecha a lista, para nunca sumir da tela. */
  const uso = usoDosTipos(u);
  const ordenados = lista.slice()
    .sort((x, y) => (uso[y.id] || 0) - (uso[x.id] || 0) || (Number(x.ordem) || 0) - (Number(y.ordem) || 0));
  const saida = ordenados.slice(0, MAX_TIPOS_CHIP);
  for (const t of ordenados) if (!t.setorPadrao && !saida.some((s) => s.id === t.id)) saida.push(t);
  const escolhido = e.cand.tipoId ? lista.find((t) => t.id === e.cand.tipoId) : null;
  if (escolhido && !saida.some((t) => t.id === escolhido.id)) saida.push(escolhido);
  return saida;
}

function blocoOQueHTML(e, u) {
  const c = e.cand;
  const chips = tiposDosChips(e, u)
    .map((t) => chipRegistrarHTML(t.nome, 'reg-tipo', t.id, c.tipoId === t.id, icone(t.icone || 'caixa', 18)))
    .join('') + chipRegistrarHTML('Outro tipo', 'reg-outro-tipo', '', false, icone('mais', 18));
  const campo = '<div class="campo registrar-campo">' +
    '<label class="campo-rotulo" for="reg-tipo-texto">O que vou fazer</label>' +
    '<input class="entrada" id="reg-tipo-texto" name="reg-tipo-texto" type="text" data-campo="reg-tipo-texto" autocomplete="off" enterkeyhint="done"' +
    ' value="' + esc(e.tipoTexto || '') + '" placeholder="Medidas, loja, entrega, visita"></div>';
  return '<section class="registrar-bloco">' + rotuloBlocoHTML('O que vou fazer') +
    '<div class="registrar-chips" role="group" aria-label="Tipo de serviço">' + chips + '</div>' + campo + '</section>';
}

/* ---- "Escrever como no grupo" (DIRECAO-3 5.4) ---- */

/**
 * A caixa do topo de Registrar, para quem digita mais rápido do que toca e já tem o texto do grupo na cabeça.
 * Ela não grava nada: roda o mesmo `whatsapp.lerMensagens` do "Colar do WhatsApp" e abre a mesma conferência.
 * Em #/hoje esta caixa não entra: lá o topo é a faixa "Onde estou", e duas entradas na tela inicial confundem.
 */
function blocoGrupoHTML(e) {
  const texto = String(e.textoGrupo || '');
  const linhas = Math.min(4, Math.max(1, texto.split('\n').length));
  return '<section class="registrar-bloco registrar-grupo">' + rotuloBlocoHTML('Escrever como no grupo', true) +
    '<label class="campo-rotulo visualmente-oculto" for="reg-grupo">Escreva como no grupo</label>' +
    '<textarea class="areatexto registrar-grupo-campo" id="reg-grupo" name="reg-grupo" rows="' + linhas + '"' +
    ' data-campo="reg-grupo" aria-describedby="reg-grupo-ajuda" autocomplete="off" placeholder="galpão">' + esc(texto) + '</textarea>' +
    '<div class="registrar-grupo-linha">' +
    '<p class="campo-ajuda" id="reg-grupo-ajuda">Exemplo: galpão, ou 24/09 Andry decoração itapema centro</p>' +
    '<button type="button" class="btn btn-secundario btn-pq registrar-grupo-ler" data-acao="reg-ler-grupo">Ler</button>' +
    '</div></section>';
}

/** Abre a conferência com o que está na caixa. Guarda contra abrir duas vezes: o `change` do campo vem antes do clique. */
function lerComoNoGrupo(e, u) {
  const texto = String(e.textoGrupo || '').trim();
  if (!texto) { ui.toast('Escreva o que você mandaria no grupo', 'erro'); return; }
  if (ui.sheetAberto()) return;
  abrirColarDoWhatsApp({
    texto, lerJa: true, titulo: 'Escrever como no grupo', origem: 'app',
    rotuloTexto: 'Escreva como você mandaria no grupo',
    aoGravar: () => { registrarAtivo = null; }
  });
}

/* ---- "Quem vai" (DIRECAO-3 4.2) ---- */

/** Os pedaços de `responsavelTexto`: quem vai e não está no cadastro, um por vírgula. */
function pedacosSemCadastro(texto) {
  return String(texto || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function chipPessoaHTML(conteudo, rotulo, acaoRemover, valor, classe) {
  const remover = acaoRemover
    ? '<button type="button" class="chip-x" data-acao="' + esc(acaoRemover) + '" data-valor="' + esc(valor) + '"' +
      ' aria-label="Tirar ' + esc(rotulo) + '">' + icone('x', 16) + '</button>'
    : '';
  return '<span class="chip chip-pessoa' + (classe ? ' ' + classe : '') + '">' + conteudo +
    '<span class="chip-pessoa-nome">' + esc(rotulo) + '</span>' + remover + '</span>';
}

/**
 * O bloco "Quem vai": chips de quem já está, mais o botão que abre a folha de busca. Dupla é a regra no grupo
 * (seis assinaturas de dupla em vinte e duas mensagens), então acrescentar gente precisa estar na tela, não
 * escondido em "Mais opções". Quem tem `criarServico: 'proprios'` não pode se tirar: a validação de salvarServico
 * exige a própria pessoa em `responsaveis`, e a tela respeita a mesma regra em vez de deixar errar.
 */
function blocoQuemVaiHTML(e, u) {
  const c = e.cand;
  const travado = dados.pode('criarServico', u) === 'proprios' && u ? u.id : '';
  const chips = (c.responsaveis || []).map((id) => {
    const p = dados.usuarioPorId(id);
    if (!p) return '';
    const nome = nomeCurtoDe(p.nome);
    return chipPessoaHTML(ui.avatar(p, { tamanho: 'pq' }), nome, id === travado ? '' : 'reg-tirar-pessoa', id, '');
  }).join('');
  const livres = pedacosSemCadastro(c.responsavelTexto)
    .map((t) => chipPessoaHTML(icone('usuario', 16), t, 'reg-tirar-texto', t, 'chip-pessoa-livre')).join('');
  const equipe = c.equipeId ? dados.equipePorId(c.equipeId) : null;
  const chipEquipe = equipe ? chipPessoaHTML(icone('usuarios', 16), equipe.apelido || equipe.nome, '', '', '') : '';
  const mais = '<button type="button" class="chip-registrar registrar-quem-mais" data-acao="reg-quem">' +
    icone('mais', 18) + '<span>Alguém</span></button>';
  return '<section class="registrar-bloco">' + rotuloBlocoHTML('Quem vai') +
    '<div class="registrar-quem" role="group" aria-label="Quem vai">' + chips + livres + chipEquipe + mais + '</div>' +
    (travado ? '<p class="registrar-nota registrar-quem-nota">' + esc('Você fica no registro: é o seu.') + '</p>' : '') +
    '</section>';
}

/** Casa a busca por nome inteiro, primeiro nome e apelido, tudo sem acento (a mesma régua de whatsapp.js). */
function pessoaCasaBusca(p, filtro) {
  if (!filtro) return true;
  const formas = [p.nome, util.primeiroNome(p.nome)].concat(Array.isArray(p.apelidos) ? p.apelidos : []);
  return formas.some((f) => util.normalizar(f).includes(filtro));
}

/**
 * A folha de "Quem vai": busca por nome, primeiro nome e apelido, com quem é do setor do tipo escolhido em cima,
 * e o escape "Não achei quem eu quero" no fim, que grava em `responsavelTexto`. Conta compartilhada não aparece:
 * ela não é pessoa e nunca é responsável sozinha (DIRECAO-3 6.2).
 */
function abrirFolhaQuemVai(e, u, aoMudar) {
  const c = e.cand;
  const travado = dados.pode('criarServico', u) === 'proprios' && u ? u.id : '';
  const estado = { busca: '', livre: false, texto: '' };
  const linha = (p) => {
    const ativo = (c.responsaveis || []).includes(p.id);
    const fixo = p.id === travado;
    const apelidos = (Array.isArray(p.apelidos) ? p.apelidos : []).join(', ');
    return '<button type="button" data-acao="quem-alternar" data-id="' + esc(p.id) + '" role="checkbox"' +
      ' aria-checked="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + (fixo ? ' disabled' : '') + '>' +
      ui.avatar(p) + '<div class="pessoa-corpo"><div class="pessoa-nome"><span>' + esc(p.nome) + '</span></div>' +
      '<div class="pessoa-cargo">' + esc([p.cargo || '', apelidos].filter(Boolean).join(', ')) + '</div></div>' +
      '<span class="caixa-marcar"' + (ativo ? ' data-ativo' : '') + ' aria-hidden="true">' + icone('check', 16) + '</span></button>';
  };
  const corpo = () => {
    const filtro = util.normalizar(String(estado.busca || '').trim());
    const todos = dados.usuariosAtivos().filter((p) => !p.contaCompartilhada);
    const campo = todos.filter((p) => p.campo);
    const doSetor = c.setorId ? campo.filter((p) => (p.setores || []).includes(c.setorId)) : [];
    const outros = campo.filter((p) => !doSetor.includes(p));
    const demais = todos.filter((p) => !p.campo);
    const filtrar = (lista) => lista.filter((p) => pessoaCasaBusca(p, filtro));
    const grupo = (titulo, lista) => (lista.length
      ? '<div class="chips-grupo-titulo">' + esc(titulo) + '</div><div class="lista-pessoas">' + lista.map(linha).join('') + '</div>'
      : '');
    const listas = grupo(c.setorId ? dados.setorPorId(c.setorId).nome : '', filtrar(doSetor)) +
      grupo('Pessoas de campo', filtrar(outros)) + grupo('Mais pessoas', filtrar(demais));
    const nada = listas ? '' : '<p class="registrar-nota">Ninguém com esse nome. Use o campo de baixo.</p>';
    const escape = estado.livre
      ? '<div class="campo registrar-campo"><label class="campo-rotulo" for="quem-livre">Quem vai, em texto</label>' +
        '<input class="entrada" id="quem-livre" name="quem-livre" type="text" data-campo="quem-livre" autocomplete="off"' +
        ' value="' + esc(estado.texto) + '" placeholder="Marcelo"></div>' +
        '<button type="button" class="btn btn-secundario" data-acao="quem-gravar-livre">Acrescentar</button>'
      : '<button type="button" class="registrar-mais-link" data-acao="quem-livre">' + icone('mais', 16) +
        '<span>Não achei quem eu quero</span></button>';
    return '<div class="busca">' + icone('busca', 20, 'busca-icone') +
      '<input class="entrada" type="search" data-campo="quem-busca" value="' + esc(estado.busca) + '"' +
      ' placeholder="Buscar por nome ou apelido" aria-label="Buscar pessoa" autocomplete="off"></div>' +
      listas + nada + '<div class="registrar-quem-escape">' + escape + '</div>';
  };
  const { el } = ui.abrirSheet({ titulo: 'Quem vai', corpo: '<div data-parte="quem">' + corpo() + '</div>' });
  const pintar = (focoBusca) => {
    const caixa = el.querySelector('[data-parte="quem"]');
    if (!caixa) return;
    caixa.innerHTML = corpo();
    if (!focoBusca) return;
    const campo = caixa.querySelector('[data-campo="quem-busca"]');
    if (campo) { campo.focus(); try { campo.setSelectionRange(estado.busca.length, estado.busca.length); } catch (erro) { /* ignora */ } }
  };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'quem-alternar') {
      const id = alvo.getAttribute('data-id');
      if (!id || id === travado) return;
      c.responsaveis = (c.responsaveis || []).includes(id)
        ? (c.responsaveis || []).filter((x) => x !== id)
        : unicos((c.responsaveis || []).concat(id));
      garantirAutor(e, u);
      pintar(false);
      if (typeof aoMudar === 'function') aoMudar();
    } else if (acao === 'quem-livre') {
      estado.livre = true;
      pintar(false);
      const campo = el.querySelector('[data-campo="quem-livre"]');
      if (campo) campo.focus();
    } else if (acao === 'quem-gravar-livre') {
      const texto = String(estado.texto || '').trim();
      if (!texto) return;
      c.responsavelTexto = pedacosSemCadastro(c.responsavelTexto).concat(texto).join(', ');
      estado.texto = '';
      estado.livre = false;
      pintar(false);
      if (typeof aoMudar === 'function') aoMudar();
    }
  });
  ui.delegar(el, '[data-campo]', 'input', (acao, alvo) => {
    const campo = alvo.getAttribute('data-campo');
    if (campo === 'quem-busca') { estado.busca = alvo.value; pintar(true); }
    if (campo === 'quem-livre') { estado.texto = alvo.value; }
  });
}

function sugestoesClienteHTML(e) {
  const c = e.cand;
  if (c.clienteId) {
    const cli = dados.clientePorId(c.clienteId);
    if (!cli) return '';
    return '<div class="registrar-vinculo">' + icone('usuario', 16) +
      '<span>Vinculado a ' + esc(cli.nome) + (c.endereco ? ', ' + esc(util.enderecoCurto(c.endereco)) : '') + '</span>' +
      '<button type="button" class="btn btn-fantasma btn-pq" data-acao="reg-soltar-cliente">Desvincular</button></div>';
  }
  const texto = String(e.clienteTexto || '').trim();
  if (texto.length < 2) return '';
  const achados = dados.clientesPorTexto(texto, MAX_SUGESTOES_CLIENTE);
  if (!achados.length) return '';
  return '<div class="registrar-sugestoes">' + achados.map((cli) => {
    const end = (cli.enderecos || [])[0];
    const onde = end ? ', ' + util.enderecoCurto(end) : '';
    return '<button type="button" class="registrar-sugestao" data-acao="reg-vincular-cliente" data-id="' + esc(cli.id) + '">' +
      icone('usuario', 16) + '<span>Vincular a ' + esc(cli.nome + onde) + '</span></button>';
  }).join('') + '</div>';
}

function blocoQuemOndeHTML(e) {
  const cliente = '<div class="campo registrar-campo">' +
    '<label class="campo-rotulo" for="reg-cliente">Cliente</label>' +
    '<input class="entrada" id="reg-cliente" name="reg-cliente" type="text" data-campo="reg-cliente" autocomplete="off"' +
    ' value="' + esc(e.clienteTexto || '') + '" placeholder="Nome de quem vai receber"' + (e.cand.clienteId ? ' readonly' : '') + '>' +
    '<div data-parte="sugestoes-cliente">' + sugestoesClienteHTML(e) + '</div></div>';
  const local = '<div class="campo registrar-campo">' +
    '<label class="campo-rotulo" for="reg-local">Local</label>' +
    '<input class="entrada" id="reg-local" name="reg-local" type="text" data-campo="reg-local" autocomplete="off"' +
    ' value="' + esc(e.localTexto || '') + '" placeholder="Endereço, bairro ou referência"></div>';
  return '<section class="registrar-bloco">' + rotuloBlocoHTML('Para quem e onde', true) + cliente + local + '</section>';
}

function blocoCarroHTML(e) {
  const c = e.cand;
  const chips = dados.veiculosAtivos().map((v) => {
    const bolinha = '<span class="registrar-bolinha ' + classeCarro(v) + '" aria-hidden="true"></span>';
    return chipRegistrarHTML(v.apelido || v.nome, 'reg-carro', v.id, c.veiculoId === v.id, bolinha);
  }).join('') + chipRegistrarHTML('Sem carro', 'reg-sem-carro', '', !c.veiculoId && !!c.semCarroConfirmado);
  return '<section class="registrar-bloco">' + rotuloBlocoHTML('Carro', true) +
    '<div class="registrar-chips" role="group" aria-label="Carro">' + chips + '</div></section>';
}

/* ---- Mais opções (3.5) ---- */

function linhaRecursoHTML(e) {
  const c = e.cand;
  const texto = textoRecurso({
    veiculoId: c.veiculoId, equipeId: c.equipeId, responsaveis: c.responsaveis, semCarroConfirmado: c.semCarroConfirmado
  }) || 'a definir';
  return '<div class="agendar-recurso">' + icone('caminhao', 18) +
    '<span>Vai com <span class="agendar-recurso-nome">' + esc(texto) + '</span></span>' +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="reg-trocar-recurso">Trocar</button></div>';
}

function maisOpcoesHTML(e, u) {
  if (!e.maisOpcoes) return '<div data-parte="mais"></div>';
  const c = e.cand;
  const proprios = dados.pode('criarServico', u) === 'proprios';
  const bruta = analisarConflitos(c, u, { justificativa: e.justificativa, pedido: e.pedido }, null);
  /* No registro do colaborador o conflito nunca bloqueia nem pede justificativa (3.4), então a faixa entra com
     severidade de aviso: as linhas e as alternativas em um toque continuam, o pedágio sai. */
  const analise = Object.assign({}, bruta, { sev: bruta.sev ? 'aviso' : bruta.sev });
  e.ultimasAlternativas = analise.alternativas;
  /* Desde a v4 quem vai é o bloco "Quem vai" da própria tela (DIRECAO-3 4.2). Aqui fica só a equipe, que é
     escala e não pessoa; repetir a lista de gente nos dois lugares seria a mesma informação duas vezes. */
  const quem = proprios ? '' : equipesHTML(e, disponibilidadeDe(c));
  const obs = '<div class="campo registrar-campo">' +
    '<label class="campo-rotulo" for="reg-obs">Observações</label>' +
    '<textarea class="areatexto" id="reg-obs" name="reg-obs" rows="3" data-campo="reg-obs"' +
    ' placeholder="Acesso, elevador, portaria, produto">' + esc(c.obs || '') + '</textarea></div>';
  const link = '<button type="button" class="agendar-link" data-acao="reg-formulario">' + icone('direita', 18) +
    '<span>Abrir no formulário completo</span></button>';
  return '<div data-parte="mais"><section class="registrar-bloco registrar-mais-bloco">' + rotuloBlocoHTML('Mais opções') +
    linhaRecursoHTML(e) + (e.horas ? '' : duracoesHTML(e)) + quem + obs + link + '</section>' +
    '<div data-parte="faixa">' + faixaConflitoHTML(analise, u, e) + '</div></div>';
}

/* ---- Rodapé e gravação ---- */

/** Só data e "o que vou fazer" seguram o botão. Nada mais bloqueia quem está avisando (DIRECAO-2 3.4). */
function faltasRegistrar(e) {
  const c = e.cand;
  const faltas = [];
  if (!c.data) faltas.push('Escolha o dia');
  if (!c.tipoId && !String(e.tipoTexto || '').trim()) faltas.push('Escreva o que vai fazer');
  return faltas;
}

function resumoRegistrarHTML(e) {
  const c = e.cand;
  const faltas = faltasRegistrar(e);
  if (faltas.length) return { texto: faltas[0], tom: '' };
  const partes = [util.rotuloDia(c.data).toLowerCase()];
  partes.push(c.periodo === 'hora' ? 'às ' + c.horaInicio : dados.PERIODOS[c.periodo].curto);
  partes.push(dados.nomeDoServico({ tipoId: c.tipoId, tipoLivre: e.tipoTexto }));
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  if (tipo && tipo.precisaVeiculo === 'sim' && !c.veiculoId) partes.push('sem carro definido');
  return { texto: partes.join(', '), tom: 'ok' };
}

function rodapeRegistrarHTML(e) {
  const faltas = faltasRegistrar(e);
  const resumo = resumoRegistrarHTML(e);
  return '<button type="button" class="registrar-mais-link" data-acao="reg-mais" aria-expanded="' + (e.maisOpcoes ? 'true' : 'false') + '">' +
    icone(e.maisOpcoes ? 'cima' : 'baixo', 16) + '<span>' + (e.maisOpcoes ? 'Menos opções' : 'Mais opções') + '</span></button>' +
    '<span class="registrar-motivo"' + (resumo.tom ? ' data-tom="' + resumo.tom + '"' : '') + ' aria-live="polite">' + esc(resumo.texto) + '</span>' +
    '<button type="button" class="btn btn-primario registrar-gravar" data-acao="reg-gravar"' + (faltas.length ? ' disabled' : '') + '>Registrar</button>';
}

/* ---- Confirmação no lugar (3.7) ---- */

function confirmacaoHTML(e) {
  const a = servico(e.criadoId);
  if (!a) return avisoHTML('O registro não foi encontrado depois de gravar.');
  const quando = util.rotuloDia(a.data) + ', ' + (a.horaAproximada ? rotuloQuando(a).toLowerCase() : util.fmtIntervalo(a.horaInicio, a.horaFim));
  const linha = [quando, dados.nomeDoServico(a), dados.nomeDoCliente(a)].filter(Boolean).join(', ');
  const temHoje = ui.rotaRegistrada('#/hoje');
  const links = [
    '<button type="button" class="agendar-link" data-acao="reg-copiar-grupo">' + icone('copiar', 18) + '<span>Copiar para o grupo</span></button>',
    '<button type="button" class="agendar-link" data-acao="reg-outro">' + icone('mais', 18) + '<span>Registrar outro</span></button>',
    '<button type="button" class="agendar-link" data-acao="reg-ver">' + icone('direita', 18) +
      '<span>' + (temHoje ? 'Ver em Hoje' : 'Ver o registro') + '</span></button>'
  ].join('');
  return '<div class="registrar-fim">' +
    '<div class="registrar-fim-marca">' + icone('check', 24) + '</div>' +
    '<div class="registrar-fim-titulo">Registrado</div>' +
    '<p class="registrar-fim-linha">' + esc(linha) + '</p>' +
    '<div class="agendar-links">' + links + '</div></div>';
}

/* ---- Tela ---- */

function registrarHTML(e, u) {
  if (e.fim) return '<div class="registrar"><div class="registrar-cartao">' + confirmacaoHTML(e) + '</div></div>';
  const largo = e.calendario || e.horas;
  const restaurado = e.restaurado
    ? '<p class="registrar-nota registrar-rascunho">Rascunho restaurado. ' +
      '<button type="button" class="registrar-mais-link" data-acao="reg-limpar">Começar do zero</button></p>'
    : '';
  return '<div class="registrar"' + (largo ? ' data-largo' : '') + '><div class="registrar-cartao">' +
    '<div class="registrar-corpo">' + restaurado +
    blocoGrupoHTML(e) + blocoQuandoRegistrarHTML(e) + blocoOQueHTML(e, u) + blocoQuemVaiHTML(e, u) +
    blocoQuemOndeHTML(e) + blocoCarroHTML(e) + maisOpcoesHTML(e, u) +
    (e.avisoGravacao ? avisoHTML(e.avisoGravacao) : '') +
    '</div>' +
    '<div class="registrar-rodape" data-parte="rodape">' + rodapeRegistrarHTML(e) + '</div>' +
    '</div></div>';
}

function renderRegistrar(raiz, e, u) {
  const caixa = raiz.querySelector('[data-parte="registrar"]');
  if (caixa) caixa.innerHTML = registrarHTML(e, u);
  rolarHorarios(raiz);
}

/** Atualiza só o rodapé: usado enquanto a pessoa digita, para o foco e o cursor não saltarem. */
function atualizarRodapeRegistrar(raiz, e) {
  const rodape = raiz.querySelector('[data-parte="rodape"]');
  if (rodape) rodape.innerHTML = rodapeRegistrarHTML(e);
  const traducao = raiz.querySelector('[data-parte="traducao"]');
  if (traducao) traducao.outerHTML = traducaoHTML(e);
}

/** Candidato pronto para salvarServico: os pares id mais texto resolvidos como manda a DIRECAO-2 2.2. */
function candidatoRegistrar(e) {
  const c = e.cand;
  const tipo = c.tipoId ? dados.tipoPorId(c.tipoId) : null;
  const texto = String(e.tipoTexto || '').trim();
  const local = String(e.localTexto || '').trim();
  /* O endereço do cliente vinculado só continua valendo enquanto a pessoa não reescreve o local à mão. */
  const enderecoVale = !!c.endereco && local === util.enderecoTexto(c.endereco);
  return Object.assign({}, c, {
    tipoId: tipo ? tipo.id : null,
    tipoLivre: tipo && texto === tipo.nome ? '' : texto,
    clienteNome: c.clienteId ? '' : String(e.clienteTexto || '').trim(),
    endereco: enderecoVale ? c.endereco : null,
    enderecoAConfirmar: false,
    localTexto: enderecoVale ? '' : local,
    origem: 'app'
  });
}

function gravarRegistro(e, u, raiz) {
  const r = salvarServico(candidatoRegistrar(e), { acaoAuditoria: 'registro_rapido' });
  if (!r.ok) {
    e.erros = {};
    for (const x of r.erros) if (!e.erros[x.campo]) e.erros[x.campo] = x.mensagem;
    e.avisoGravacao = r.erros[0].mensagem;
    ui.toast(r.erros[0].mensagem, 'erro');
    renderRegistrar(raiz, e, u);
    return;
  }
  e.criadoId = r.agendamento.id;
  e.avisoGravacao = '';
  e.fim = true;
  e.restaurado = false;
  limparRascunho(u);
  renderRegistrar(raiz, e, u);
  ui.toastDesfazer('Registrado', { ms: 5000, aoDesfazer: () => desfazerRegistro(r.agendamento.id) });
}

/**
 * Desfaz um registro recém-criado: remove o documento e os avisos que ele gerou, e deixa a linha na auditoria.
 * Só vale na janela de 5 segundos do toast, e só para quem acabou de criar.
 */
function desfazerRegistro(id) {
  const a = servico(id);
  if (!a) return;
  repo.transacao(() => {
    auditarServico(a, 'status_desfeito', { motivo: 'Registro desfeito e removido' });
    for (const n of repo.listar('notificacoes', (x) => x.link === '#/servico/' + id)) repo.remover('notificacoes', n.id);
    repo.remover('agendamentos', id);
  });
  ui.toast('Registro desfeito');
  if (registrarAtivo && registrarAtivo.criadoId === id) {
    registrarAtivo.criadoId = null;
    registrarAtivo.fim = false;
    ui.rerender();
  }
}

/** Ações da tela Registrar. Devolve true quando tratou. */
function acaoRegistrar(acao, el, e, u, raiz) {
  const c = e.cand;
  const valor = el.getAttribute('data-valor');
  const id = el.getAttribute('data-id');
  const feito = () => { e.avisoGravacao = ''; guardarRascunho(e, u); renderRegistrar(raiz, e, u); };
  /* Calendário e coluna de horários: as mesmas ações do formulário avançado (escolher-dia, mês, mostrar assim mesmo). */
  if (tratarAcaoQuando(acao, el, c, e)) {
    if (acao === 'escolher-dia') { e.calendario = false; e.horas = c.periodo === 'hora'; anunciarDia(c, e); }
    aplicarPeriodo(e);
    feito();
    return true;
  }
  switch (acao) {
    case 'reg-dia':
      c.data = valor;
      e.mes = util.inicioMes(valor);
      e.calendario = false;
      e.horaProvisoria = '';
      if (c.periodo === 'hora') { c.horaInicio = ''; c.horaFim = ''; }
      aplicarPeriodo(e);
      feito();
      return true;
    case 'reg-calendario':
      e.calendario = !e.calendario;
      if (e.calendario) e.horas = false;
      feito();
      return true;
    case 'reg-periodo':
      c.periodo = valor;
      e.horas = false;
      aplicarPeriodo(e);
      feito();
      return true;
    case 'reg-hora-exata':
      /* Vindo de um período, a hora começa no primeiro horário livre do dia, não no início da faixa. */
      if (c.periodo !== 'hora') { c.horaInicio = ''; c.horaFim = ''; c.periodo = 'hora'; e.horas = true; } else { e.horas = !e.horas; }
      e.calendario = false;
      aplicarPeriodo(e);
      e.horaProvisoria = '';
      feito();
      return true;
    case 'reg-horario':
      e.horaProvisoria = e.horaProvisoria === valor ? '' : valor;
      renderRegistrar(raiz, e, u);
      return true;
    case 'confirmar-horario': {
      const duracao = duracaoEmVigor(c, e);
      c.horaInicio = valor;
      c.horaFim = fimPorDuracao(valor, duracao);
      marcarHoraExata(c);
      e.horaProvisoria = '';
      e.horas = false;
      feito();
      return true;
    }
    case 'escolher-duracao':
      e.duracaoMin = Number(valor) || 0;
      aplicarPeriodo(e);
      feito();
      return true;
    case 'reg-tipo': {
      const tipo = dados.tipoPorId(valor);
      if (!tipo) return true;
      const mesmo = c.tipoId === tipo.id;
      c.tipoId = mesmo ? null : tipo.id;
      c.setorId = mesmo ? null : tipo.setorPadrao;
      e.tipoTexto = mesmo ? '' : tipo.nome;
      e.duracaoMin = 0;
      aplicarPeriodo(e);
      feito();
      return true;
    }
    case 'reg-outro-tipo':
      abrirFolhaTipos(e, u, () => feito());
      return true;
    case 'reg-ler-grupo': {
      const area = raiz.querySelector('[data-campo="reg-grupo"]');
      if (area) e.textoGrupo = area.value;
      lerComoNoGrupo(e, u);
      return true;
    }
    case 'reg-quem':
      abrirFolhaQuemVai(e, u, () => feito());
      return true;
    case 'reg-tirar-pessoa': {
      const alvo = valor || id;
      if (dados.pode('criarServico', u) === 'proprios' && u && alvo === u.id) {
        ui.toast('Você precisa estar neste registro', 'erro');
        return true;
      }
      c.responsaveis = (c.responsaveis || []).filter((x) => x !== alvo);
      feito();
      return true;
    }
    case 'reg-tirar-texto':
      c.responsavelTexto = pedacosSemCadastro(c.responsavelTexto).filter((x) => x !== valor).join(', ');
      feito();
      return true;
    case 'reg-vincular-cliente': {
      const cli = dados.clientePorId(id);
      if (!cli) return true;
      c.clienteId = cli.id;
      e.clienteTexto = cli.nome;
      const end = (cli.enderecos || [])[0];
      if (end && !String(e.localTexto || '').trim()) {
        c.endereco = snapshotEndereco(end);
        e.localTexto = util.enderecoTexto(c.endereco);
      }
      feito();
      return true;
    }
    case 'reg-soltar-cliente':
      c.clienteId = null;
      c.endereco = null;
      feito();
      return true;
    case 'reg-carro':
      c.veiculoId = c.veiculoId === valor ? null : valor;
      if (c.veiculoId) c.semCarroConfirmado = false;
      feito();
      return true;
    case 'reg-sem-carro':
      c.semCarroConfirmado = !c.semCarroConfirmado || !!c.veiculoId;
      if (c.semCarroConfirmado) c.veiculoId = null;
      feito();
      return true;
    case 'reg-gravar':
      gravarRegistro(e, u, raiz);
      return true;
    case 'reg-mais':
      e.maisOpcoes = !e.maisOpcoes;
      salvarPrefRegistrar(u, { maisOpcoes: e.maisOpcoes });
      renderRegistrar(raiz, e, u);
      return true;
    case 'reg-trocar-recurso':
      abrirTrocarRecurso(e, () => { fixarRecurso(e); garantirAutor(e, u); feito(); });
      return true;
    case 'escolher-equipe':
      alternarEquipe(c, id);
      garantirAutor(e, u);
      feito();
      return true;
    case 'alternar-pessoa':
      c.responsaveis = (c.responsaveis || []).includes(id) ? c.responsaveis.filter((x) => x !== id) : unicos((c.responsaveis || []).concat(id));
      garantirAutor(e, u);
      feito();
      return true;
    case 'mais-pessoas': {
      e.maisPessoas = !e.maisPessoas;
      const lista = raiz.querySelector('[data-parte="lista-pessoas"]');
      if (lista) lista.innerHTML = listaPessoasHTML(e); else renderRegistrar(raiz, e, u);
      return true;
    }
    case 'escolher-carro':
    case 'aplicar-carro-sugerido':
      c.veiculoId = c.veiculoId === id ? null : id;
      if (c.veiculoId) c.semCarroConfirmado = false;
      feito();
      return true;
    case 'aplicar-alternativa': {
      const alt = (e.ultimasAlternativas || []).find((x) => x.id === valor);
      if (!alt) return true;
      Object.assign(c, alt.mudancas);
      if (alt.mudancas.horaInicio) marcarHoraExata(c);
      feito();
      return true;
    }
    case 'reg-formulario': {
      const query = ui.montarQuery({
        tipo: c.tipoId, data: c.data, inicio: c.horaInicio, fim: c.horaFim,
        cliente: c.clienteId, veiculo: c.veiculoId, equipe: c.equipeId
      });
      ui.irPara('#/servico/novo' + query);
      return true;
    }
    case 'reg-limpar':
      limparRascunho(u);
      registrarAtivo = null;
      ui.irPara('#/registrar', { substituir: true });
      return true;
    case 'reg-copiar-grupo':
      copiarParaGrupo(e.criadoId);
      return true;
    case 'reg-outro':
      limparRascunho(u);
      registrarAtivo = null;
      ui.irPara('#/registrar', { substituir: true });
      return true;
    case 'reg-ver':
      ui.irPara(ui.rotaRegistrada('#/hoje') ? '#/hoje' : '#/servico/' + e.criadoId);
      return true;
    case 'colar-grupo':
      abrirColarDoWhatsApp({ aoGravar: () => { registrarAtivo = null; } });
      return true;
    default:
      return false;
  }
}

/** Anúncio do dia escolhido para quem usa leitor de tela (DIRECAO-2, seção 7): a data por extenso e quantos horários livres. */
function anunciarDia(c, e) {
  if (!c.data) return;
  const livres = regras.horariosLivres(c.data, candidatoDeConsulta(c, e), opcoesDeConsulta(c, e)).filter((x) => x.estado === 'livre').length;
  ui.anunciar(util.fmtDataExtensa(c.data) + ', ' + plural(livres, 'horário livre', 'horários livres'));
}

/** Quem tem 'proprios' nunca sai do próprio registro: a regra de 2.5 é validada na gravação, então a tela a respeita. */
function garantirAutor(e, u) {
  if (!u || dados.pode('criarServico', u) !== 'proprios') return;
  if (!(e.cand.responsaveis || []).includes(u.id)) e.cand.responsaveis = unicos((e.cand.responsaveis || []).concat(u.id));
}

/** Campos de texto da tela. Atualiza só o que precisa, para o cursor não saltar. */
function campoRegistrar(el, evento, e, u, raiz) {
  const campo = el.getAttribute('data-campo');
  const valor = el.value;
  if (evento !== 'input') return;
  switch (campo) {
    case 'reg-tipo-texto':
      e.tipoTexto = valor;
      /* Digitar por cima desfaz o vínculo com o tipo cadastrado: o que ficar vai em tipoLivre. */
      if (e.cand.tipoId && valor !== (dados.tipoPorId(e.cand.tipoId) || {}).nome) { e.cand.tipoId = null; e.cand.setorId = null; }
      atualizarRodapeRegistrar(raiz, e);
      guardarRascunho(e, u);
      break;
    case 'reg-cliente': {
      e.clienteTexto = valor;
      if (e.cand.clienteId) e.cand.clienteId = null;
      const caixa = raiz.querySelector('[data-parte="sugestoes-cliente"]');
      if (caixa) caixa.innerHTML = sugestoesClienteHTML(e);
      guardarRascunho(e, u);
      break;
    }
    case 'reg-local':
      e.localTexto = valor;
      guardarRascunho(e, u);
      break;
    case 'reg-grupo':
      /* A caixa nasce com uma linha e cresce até quatro, sem rerender: rerender aqui tiraria o cursor do lugar. */
      e.textoGrupo = valor;
      el.rows = Math.min(4, Math.max(1, valor.split('\n').length));
      break;
    case 'reg-obs':
      e.cand.obs = valor;
      guardarRascunho(e, u);
      break;
    case 'busca-pessoa': {
      e.buscaPessoa = valor;
      const lista = raiz.querySelector('[data-parte="lista-pessoas"]');
      if (lista) {
        lista.innerHTML = listaPessoasHTML(e);
        const busca = lista.querySelector('[data-campo="busca-pessoa"]');
        if (busca) { busca.focus(); try { busca.setSelectionRange(valor.length, valor.length); } catch (erro) { /* ignora */ } }
      }
      break;
    }
    case 'justificativa':
      e.justificativa = valor;
      atualizarRodapeRegistrar(raiz, e);
      break;
    case 'pedido':
      e.pedido = valor;
      atualizarRodapeRegistrar(raiz, e);
      break;
    default:
      break;
  }
}

/** Folha com a grade de tipos, a mesma do fluxo antigo, com o filtro de setor em chips (DIRECAO-2 3.3). */
function abrirFolhaTipos(e, u, aoEscolher) {
  const estado = { setor: '' };
  const grupos = gruposDeTipos(u, e.cand.tipoId);
  const corpo = () => {
    const chips = grupos.length > 1
      ? '<div class="tipos-filtro" role="group" aria-label="Filtrar por setor">' +
        '<button type="button" class="chip chip-escolha" data-acao="filtrar-setor" data-valor=""' + (estado.setor ? '' : ' data-ativo') +
        ' aria-pressed="' + (estado.setor ? 'false' : 'true') + '">Todos</button>' +
        grupos.map(([setorId]) => {
          const ativo = estado.setor === setorId;
          const nome = setorId === 'outros' ? 'Outros' : dados.setorPorId(setorId).nome;
          return '<button type="button" class="chip chip-escolha" data-acao="filtrar-setor" data-valor="' + esc(setorId) + '"' +
            (ativo ? ' data-ativo' : '') + ' aria-pressed="' + (ativo ? 'true' : 'false') + '">' + esc(nome) + '</button>';
        }).join('') + '</div>'
      : '';
    const lista = [];
    for (const [setorId, tipos] of grupos) {
      if (estado.setor && setorId !== estado.setor) continue;
      for (const t of tipos) lista.push(t);
    }
    return chips + (lista.length
      ? '<div class="tipos-grade">' + lista.map((t) => cartaoTipoHTML(t, { acao: 'escolher-tipo-folha', ativo: e.cand.tipoId === t.id })).join('') + '</div>'
      : '<p class="agendar-nota">Nenhum tipo neste setor.</p>');
  };
  const { el, fechar } = ui.abrirSheet({ titulo: 'Escolher o tipo', corpo: '<div data-parte="tipos">' + corpo() + '</div>' });
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'filtrar-setor') {
      estado.setor = alvo.getAttribute('data-valor') || '';
      const caixa = el.querySelector('[data-parte="tipos"]');
      if (caixa) caixa.innerHTML = corpo();
      return;
    }
    if (acao !== 'escolher-tipo-folha') return;
    const tipo = dados.tipoPorId(alvo.getAttribute('data-id'));
    if (!tipo) return;
    e.cand.tipoId = tipo.id;
    e.cand.setorId = tipo.setorPadrao;
    e.tipoTexto = tipo.nome;
    e.duracaoMin = 0;
    aplicarPeriodo(e);
    fechar();
    if (typeof aoEscolher === 'function') aoEscolher();
  });
}

/**
 * A tela Registrar (DIRECAO-2 3). Aceita os mesmos parâmetros de consulta de #/servico/novo:
 * data, inicio, tipo, cliente, veiculo, equipe e resp.
 * @param {{params:object, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaRegistrar(ctx) {
  const { alvo } = ctx;
  const query = ctx.query || {};
  const u = ctx.usuario || usuarioAtual();
  if (!u || !dados.pode('criarServico', u)) {
    telaErro(alvo, 'Você não pode registrar serviços', 'Peça a um atendente ou à gestão.');
    return;
  }
  const chave = 'registrar:' + u.id + ':' + JSON.stringify(query);
  if (!registrarAtivo || registrarAtivo.chave !== chave) registrarAtivo = criarEstadoRegistrar(query, chave, u);
  const e = registrarAtivo;
  const cab = ui.montarCabecalho({
    voltar: true, titulo: 'Registrar',
    acoes: '<button type="button" class="btn-icone registrar-colar" data-acao="colar-grupo" aria-label="Colar do WhatsApp">' +
      icone('nota', 22) + '<span class="registrar-colar-rotulo">Colar do WhatsApp</span></button>'
  });
  if (cab) ui.delegar(cab, '[data-acao="colar-grupo"]', 'click', () => abrirColarDoWhatsApp({ aoGravar: () => { registrarAtivo = null; } }));
  ui.renderizar(alvo, '<div data-parte="registrar">' + registrarHTML(e, u) + '</div>', (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      acaoRegistrar(acao, el, e, u, raiz);
    });
    ui.delegar(raiz, '[data-campo]', 'input', (acao, el) => campoRegistrar(el, 'input', e, u, raiz));
    /* Sair da caixa com conteúdo lê sozinho (DIRECAO-3 5.4); o clique em "Ler" que vier logo depois encontra a
       folha já aberta e não repete. */
    ui.delegar(raiz, '[data-campo="reg-grupo"]', 'change', (acao, el) => {
      e.textoGrupo = el.value;
      if (String(e.textoGrupo || '').trim()) lerComoNoGrupo(e, u);
    });
    ligarTecladoCalendario(raiz);
    rolarHorarios(raiz);
  });
}

/**
 * Teclado no calendário do mês (DIRECAO-2, seção 7): setas andam nos dias, Enter escolhe, Esc fecha a gaveta.
 * O anúncio do dia escolhido sai pelo aria-live da linha de tradução.
 */
function ligarTecladoCalendario(raiz) {
  /* Por ui.delegar, que guarda o ouvinte para a próxima renderização limpar; addEventListener solto aqui
     empilharia um ouvinte por render. */
  ui.delegar(raiz, '.cal-dia', 'keydown', (acao, alvo, ev) => {
    if (ev.key === 'Escape') {
      const botao = raiz.querySelector('[data-acao="reg-calendario"]');
      ev.preventDefault();
      if (botao) botao.click();
      return;
    }
    const passo = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[ev.key];
    if (!passo) return;
    ev.preventDefault();
    const dias = Array.from(raiz.querySelectorAll('.cal-dia'));
    const atual = dias.indexOf(alvo);
    for (let i = atual + passo; i >= 0 && i < dias.length; i += (passo > 0 ? 1 : -1)) {
      if (!dias[i].disabled) { dias[i].focus(); return; }
    }
  });
}

/** #/agendar e #/agendar/:tipo viram #/registrar, preservando o tipo e a consulta (DIRECAO-2 3.6). */
function redirecionarParaRegistrar(ctx) {
  const query = Object.assign({}, ctx.query || {});
  if (ctx.params && ctx.params.tipo) query.tipo = ctx.params.tipo;
  ui.irPara('#/registrar' + ui.montarQuery(query), { substituir: true });
}

/* ================================================================== */
/* A ponte com o grupo AGENDA GREEN (DIRECAO-2, seção 5)               */
/* ================================================================== */

/** Contexto de mensagemDoServico: os textos já resolvidos pelos pares id mais texto de 2.2. */
function contextoDaMensagem(a) {
  /* Quem posta é quem faz (F8): assina o primeiro responsável, e só sem responsável quem cadastrou. */
  const autor = ((a.responsaveis || []).map((id) => dados.usuarioPorId(id)).find(Boolean)) || (a.criadoPor ? dados.usuarioPorId(a.criadoPor) : null);
  return {
    nomeServico: dados.nomeDoServico(a),
    nomeCliente: dados.nomeDoCliente(a),
    nomeCarro: dados.nomeDoCarro(a),
    local: dados.localDe(a),
    assinatura: autor ? nomeCurtoDe(autor.nome) : String(a.autorTexto || ''),
    statusSimples: mapaStatusSimples()
  };
}

/**
 * "Copiar para o grupo" (5.1): o registro no formato exato da mensagem fixada, com o pino no título, como o time
 * reconhece. O app copia e avisa; não abre o WhatsApp e não manda nada sozinho.
 * @param {string} id @returns {Promise<boolean>}
 */
export async function copiarParaGrupo(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return false;
  const texto = ponte.mensagemDoServico(a, contextoDaMensagem(a));
  const ok = await copiarTexto(texto);
  if (!ok) { ui.toast('Não consegui copiar. Copie o texto à mão.', 'erro'); return false; }
  repo.transacao(() => auditarServico(a, 'mensagem_copiada'));
  ui.toast('Mensagem copiada. Cole no grupo AGENDA GREEN');
  return true;
}

/** Contexto de lerMensagens: tudo que o analisador precisa saber, sem ele importar dados.js. */
function contextoDaLeitura(u) {
  return {
    hoje: util.hojeISO(),
    tipos: dados.tiposAtivos(),
    veiculos: dados.veiculosAtivos(),
    /* Com as contas compartilhadas juntas (DIRECAO-3 6.2): sem elas "Rafa" casaria sozinho com a Rafaela e a
       ambiguidade nunca apareceria. Quem não pode ser responsável é barrado depois, no próprio leitor. */
    usuarios: dados.usuariosParaAssinatura(),
    clientes: repo.listar('clientes', (c) => c.ativo !== false),
    usuario: u ? { id: u.id, perfil: u.perfil } : null,
    criarServico: dados.pode('criarServico', u),
    /* A tabela de lugares (DIRECAO-3 2.1) para o check-in de uma palavra casar também pelo rótulo. */
    lugares: dados.LUGARES,
    horasDoPeriodo: (iso, periodo, setorId) => regras.horasDoPeriodo(iso, periodo, setorId)
  };
}

/* ---- Conferência (DIRECAO-3 5.3): edita, divide, junta, resolve ambiguidade e grava presença junto ---- */

/** O aviso do cartão que nasceu de "Dividir"; sai sozinho quando a pessoa escreve o que vai ser feito. */
const AVISO_DIVIDIDO = 'Escreva o que vai ser feito neste segundo registro';

/** "rafa" no texto colado vira "Quem é Rafa?": a pergunta é da interface, e a interface começa com maiúscula. */
const maiusculaInicial = (texto) => { const t = String(texto || ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };

/** As três tarjas de confiança do topo do cartão, na régua de 5.3 item 4. */
const TARJAS_CONFIANCA = {
  alta: { rotulo: 'Li do modelo', tom: 'alta' },
  media: { rotulo: 'Li de uma lista', tom: 'media' },
  baixa: { rotulo: 'Li por conta própria, confira', tom: 'baixa' }
};

/** O que o seletor de status oferece na conferência: os quatro do grupo, sem o cancelado. */
const STATUS_CONFERENCIA = [
  { valor: 'confirmado', rotulo: 'Agendado' },
  { valor: 'em_andamento', rotulo: 'Em andamento' },
  { valor: 'concluido', rotulo: 'Concluído' },
  { valor: 'nao_realizado', rotulo: 'Não realizado' }
];

/** Cópia rasa e segura do que veio do leitor: a conferência edita à vontade sem tocar no resultado da leitura. */
function itemDaLeitura(r) {
  return {
    campos: Object.assign({}, r.campos),
    avisos: (r.avisos || []).slice(),
    suposicoes: (r.suposicoes || []).slice(),
    clienteSugerido: r.clienteSugerido || null,
    assinatura: r.assinatura || '',
    confianca: r.confianca || 'alta',
    ambiguos: (r.ambiguos || []).map((x) => ({ pedaco: x.pedaco, candidatos: (x.candidatos || []).slice(), escolhido: '', resolvido: false })),
    vincular: false, usar: true, motivo: '', editando: false
  };
}

/**
 * O check-in lido vira um cartão de presença. Sem remetente nenhum no texto (é o caso de quem digita "galpão" em
 * "Escrever como no grupo"), a presença é de quem está na frente do app; com remetente que não casou, ninguém é
 * escolhido no chute e o seletor pergunta.
 */
function presencaDaLeitura(p, u) {
  const semAssinatura = !String(p.assinatura || '').trim();
  return {
    userId: p.userId || (semAssinatura && u ? u.id : ''),
    assinatura: p.assinatura || '',
    lugar: p.lugar, lugarTexto: p.lugarTexto || '', hora: p.hora || '',
    confianca: p.confianca || 'alta', mensagemOriginal: p.mensagemOriginal || '',
    usar: true
  };
}

function clonarItemConferencia(item) {
  const copia = itemDaLeitura(item);
  copia.motivo = item.motivo;
  copia.vincular = item.vincular;
  copia.usar = item.usar;
  copia.ambiguos = item.ambiguos.map((x) => Object.assign({}, x, { candidatos: x.candidatos.slice() }));
  return copia;
}

/** "O que vou fazer" como texto, venha do tipo cadastrado ou do texto livre. */
function textoDoQue(campos) {
  const tipo = campos.tipoId ? dados.tipoPorId(campos.tipoId) : null;
  return tipo ? tipo.nome : String(campos.tipoLivre || '');
}

/** Refaz as horas depois de mexer na data ou no período, com a mesma régua da tela Registrar. */
function ajustarHorasConferencia(campos) {
  const periodo = dados.PERIODOS[campos.periodo] ? campos.periodo : 'dia';
  campos.periodo = periodo;
  if (periodo === 'hora') {
    campos.horaAproximada = false;
    if (!campos.horaInicio) campos.horaInicio = '09:00';
    campos.horaFim = fimPorDuracao(campos.horaInicio, duracaoDe(campos));
    return;
  }
  const horas = regras.horasDoPeriodo(campos.data || util.hojeISO(), periodo, campos.setorId);
  if (horas) { campos.horaInicio = horas.horaInicio; campos.horaFim = horas.horaFim; }
  campos.horaAproximada = true;
}

function quandoDaConferencia(campos) {
  const periodo = dados.PERIODOS[campos.periodo] || dados.PERIODOS.dia;
  const quando = campos.periodo === 'hora'
    ? util.fmtIntervalo(campos.horaInicio, campos.horaFim)
    : periodo.rotulo + ', das ' + campos.horaInicio + ' às ' + campos.horaFim;
  return (campos.data ? util.fmtDataExtensa(campos.data) : 'sem data') + ', ' + quando;
}

function linhaConferenciaHTML(rotulo, valor, tom) {
  return '<div class="conferencia-linha"' + (tom ? ' data-tom="' + esc(tom) + '"' : '') + '>' +
    '<span class="conferencia-rotulo">' + esc(rotulo) + '</span>' +
    '<span class="conferencia-valor">' + esc(valor) + '</span></div>';
}

/* "Ryan, assinado por Rafa": quem cola confere quem assinou antes de gravar. A assinatura casada com usuário
   (Dani para Daniela) também aparece, porque é a prova de que o casamento foi o certo. */
function quemRegistrouConferencia(usuario, item) {
  const quem = usuario ? nomeCurtoDe(usuario.nome) : 'você';
  const assinado = String((item.campos && item.campos.autorTexto) || item.assinatura || '').trim();
  if (!assinado || util.normalizar(assinado) === util.normalizar(quem)) return quem;
  return quem + ', assinado por ' + assinado;
}

/** Um campo de seleção da conferência, com rótulo próprio e o índice do cartão no dataset. */
function selecaoConferenciaHTML(rotulo, campo, indice, opcoes, valor) {
  const id = campo + '-' + indice;
  return '<div class="campo conferencia-campo"><label class="campo-rotulo" for="' + esc(id) + '">' + esc(rotulo) + '</label>' +
    '<select class="selecao" id="' + esc(id) + '" name="' + esc(id) + '" data-campo="' + esc(campo) + '" data-indice="' + indice + '">' +
    opcoes.map((o) => '<option value="' + esc(o.valor) + '"' + (String(o.valor) === String(valor == null ? '' : valor) ? ' selected' : '') + '>' +
      esc(o.rotulo) + '</option>').join('') + '</select></div>';
}

function entradaConferenciaHTML(rotulo, campo, indice, valor, tipo, atributos) {
  const id = campo + '-' + indice;
  return '<div class="campo conferencia-campo"><label class="campo-rotulo" for="' + esc(id) + '">' + esc(rotulo) + '</label>' +
    '<input class="entrada" id="' + esc(id) + '" name="' + esc(id) + '" type="' + esc(tipo || 'text') + '"' +
    ' data-campo="' + esc(campo) + '" data-indice="' + indice + '" autocomplete="off" value="' + esc(valor == null ? '' : valor) + '"' +
    (atributos ? ' ' + atributos : '') + '></div>';
}

/** Os chips de "Quem vai" dentro do cartão, com o texto livre ao lado de quem está no cadastro. */
function quemConferenciaHTML(campos, indice, editando) {
  const chips = (campos.responsaveis || []).map((id) => {
    const p = dados.usuarioPorId(id);
    if (!p) return '';
    const nome = nomeCurtoDe(p.nome);
    return chipPessoaHTML(ui.avatar(p, { tamanho: 'pq' }), nome, editando ? 'conf-tirar-pessoa' : '', id, '');
  }).join('');
  const livres = pedacosSemCadastro(campos.responsavelTexto)
    .map((t) => chipPessoaHTML(icone('usuario', 16), t, editando ? 'conf-tirar-texto' : '', t, 'chip-pessoa-livre')).join('');
  if (!editando) return (chips + livres) || '<span class="conferencia-vazio">a definir</span>';
  const fora = dados.usuariosAtivos().filter((p) => !p.contaCompartilhada && !(campos.responsaveis || []).includes(p.id));
  const opcoes = [{ valor: '', rotulo: 'Acrescentar quem vai' }].concat(fora.map((p) => ({ valor: p.id, rotulo: p.nome })));
  return '<div class="conferencia-quem">' + chips + livres + '</div>' +
    selecaoConferenciaHTML('Acrescentar quem vai', 'conf-quem-add', indice, opcoes, '') +
    entradaConferenciaHTML('Quem vai e não está no cadastro', 'conf-quem-texto', indice, campos.responsavelTexto || '');
}

/**
 * O seletor de ambiguidade (DIRECAO-3 4.3 passo 5): "Rafa" casa com a Rafaela e com a conta de Natal, e errar de
 * pessoa em agenda de operação é pior do que perguntar. Nada é gravado com ambiguidade aberta.
 */
function ambiguidadeHTML(item, indice) {
  if (!item.ambiguos.length) return '';
  return item.ambiguos.map((amb, pos) => {
    const botoes = amb.candidatos.map((id) => {
      const p = dados.usuarioPorId(id);
      /* A conta do grupo aparece dita como conta, para ninguém achar que é gente (DIRECAO-3 6.2). */
      const rotulo = p ? p.nome + (p.contaCompartilhada ? ', conta do grupo' : '') : id;
      const ativo = amb.resolvido && amb.escolhido === id;
      return '<button type="button" class="chip chip-escolha" data-acao="conf-ambiguo" data-indice="' + indice + '"' +
        ' data-pos="' + pos + '" data-id="' + esc(id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' +
        (ativo ? ' data-ativo' : '') + '>' + esc(rotulo) + '</button>';
    }).join('');
    const nenhum = '<button type="button" class="chip chip-escolha" data-acao="conf-ambiguo" data-indice="' + indice + '"' +
      ' data-pos="' + pos + '" data-id="" aria-pressed="' + (amb.resolvido && !amb.escolhido ? 'true' : 'false') + '"' +
      (amb.resolvido && !amb.escolhido ? ' data-ativo' : '') + '>Nenhum, deixar em texto</button>';
    return '<div class="conferencia-ambiguo"' + (amb.resolvido ? ' data-resolvido' : '') + '>' +
      '<span class="conferencia-ambiguo-pergunta">' + esc('Quem é ' + maiusculaInicial(amb.pedaco) + '?') + '</span>' +
      '<div class="chips-escolha">' + botoes + nenhum + '</div></div>';
  }).join('');
}

function tarjaConfiancaHTML(item) {
  const tarja = TARJAS_CONFIANCA[item.confianca] || TARJAS_CONFIANCA.alta;
  return '<span class="conferencia-tarja" data-tom="' + esc(tarja.tom) + '">' + esc(tarja.rotulo) + '</span>';
}

function edicaoConferenciaHTML(item, indice) {
  const campos = item.campos;
  const carros = [{ valor: '', rotulo: campos.veiculoTexto ? campos.veiculoTexto + ' (não casou)' : 'Sem carro' }]
    .concat(dados.veiculosAtivos().map((v) => ({ valor: v.id, rotulo: v.apelido || v.nome })));
  const periodos = Object.keys(dados.PERIODOS).map((k) => ({ valor: k, rotulo: dados.PERIODOS[k].rotulo }));
  const hora = campos.periodo === 'hora'
    ? entradaConferenciaHTML('Hora de início', 'conf-hora', indice, campos.horaInicio || '', 'time')
    : '';
  return '<div class="conferencia-edicao">' +
    entradaConferenciaHTML('Data', 'conf-data', indice, campos.data || '', 'date') +
    selecaoConferenciaHTML('Período', 'conf-periodo', indice, periodos, campos.periodo) + hora +
    entradaConferenciaHTML('O que vai ser feito', 'conf-que', indice, textoDoQue(campos)) +
    entradaConferenciaHTML('Cliente', 'conf-cliente', indice, campos.clienteNome || '') +
    entradaConferenciaHTML('Local', 'conf-local', indice, campos.localTexto || '') +
    selecaoConferenciaHTML('Carro', 'conf-carro', indice, carros, campos.veiculoId || '') +
    selecaoConferenciaHTML('Status', 'conf-status', indice, STATUS_CONFERENCIA, campos.status) +
    '<div class="campo conferencia-campo"><span class="campo-rotulo">Quem vai</span>' + quemConferenciaHTML(campos, indice, true) + '</div>' +
    '</div>';
}

function leituraConferenciaHTML(item, indice) {
  const campos = item.campos;
  const usuario = campos.criadoPor ? dados.usuarioPorId(campos.criadoPor) : null;
  const carro = campos.veiculoId ? dados.veiculoPorId(campos.veiculoId) : null;
  return [
    linhaConferenciaHTML('Quando', quandoDaConferencia(campos), campos.data ? '' : 'falta'),
    linhaConferenciaHTML('O que', dados.nomeDoServico(campos) || 'sem tipo', textoDoQue(campos) ? '' : 'falta'),
    linhaConferenciaHTML('Cliente', campos.clienteNome || 'vazio'),
    linhaConferenciaHTML('Local', campos.localTexto || 'vazio'),
    linhaConferenciaHTML('Carro', carro ? (carro.apelido || carro.nome) : (campos.veiculoTexto || 'vazio')),
    '<div class="conferencia-linha"><span class="conferencia-rotulo">Quem vai</span>' +
      '<span class="conferencia-valor conferencia-quem">' + quemConferenciaHTML(campos, indice, false) + '</span></div>',
    linhaConferenciaHTML('Quem registrou', quemRegistrouConferencia(usuario, item)),
    linhaConferenciaHTML('Status', dados.rotuloSimples(campos.status))
  ].join('');
}

function cartaoConferenciaHTML(item, indice) {
  const campos = item.campos;
  const vinculo = item.clienteSugerido
    ? '<label class="marcar"><input type="checkbox" data-campo="col-vincular" data-indice="' + indice + '"' + (item.vincular ? ' checked' : '') + '>' +
      '<span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span>' +
      '<span>' + esc('Vincular a ' + item.clienteSugerido.nome) + '</span></label>'
    : '';
  const motivo = campos.status === 'nao_realizado'
    ? '<div class="campo"><span class="campo-rotulo">Motivo do não realizado</span>' +
      chipsMotivoHTML(dados.MOTIVOS_NAO_REALIZADO, item.motivo).replace(/data-acao="escolher-opcao"/g, 'data-acao="col-motivo" data-indice="' + indice + '"') + '</div>'
    : '';
  /* A mesma frase costuma vir nos dois arrays do leitor; a suposição é a forma mais calma de dizer, e fica só ela. */
  const avisos = (item.avisos || []).filter((x) => !(item.suposicoes || []).includes(x))
    .map((x) => '<p class="conferencia-aviso">' + icone('alerta', 14) + '<span>' + esc(x) + '</span></p>').join('');
  const suposicoes = (item.suposicoes || []).map((x) => '<p class="conferencia-suposicao">' + icone('info', 14) + '<span>' + esc(x) + '</span></p>').join('');
  const acoes = '<div class="conferencia-acoes">' +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="conf-editar" data-indice="' + indice + '">' +
    icone(item.editando ? 'check' : 'editar', 16) + '<span>' + (item.editando ? 'Pronto' : 'Editar') + '</span></button>' +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="conf-dividir" data-indice="' + indice + '">' +
    icone('mais', 16) + '<span>Dividir</span></button>' +
    (indice > 0
      ? '<button type="button" class="btn btn-secundario btn-pq" data-acao="conf-juntar" data-indice="' + indice + '">' +
        icone('cima', 16) + '<span>Juntar com o de cima</span></button>'
      : '') + '</div>';
  return '<div class="conferencia-cartao"' + (item.usar ? '' : ' data-fora') + '>' +
    '<div class="conferencia-topo">' +
    '<label class="marcar"><input type="checkbox" data-campo="col-usar" data-indice="' + indice + '"' + (item.usar ? ' checked' : '') + '>' +
    '<span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span>' +
    '<span>' + esc('Registro ' + (indice + 1)) + '</span></label>' + tarjaConfiancaHTML(item) + '</div>' +
    (item.editando ? edicaoConferenciaHTML(item, indice) : leituraConferenciaHTML(item, indice)) +
    ambiguidadeHTML(item, indice) + vinculo + motivo + suposicoes + avisos + acoes + '</div>';
}

/** Um cartão por check-in lido (DIRECAO-3 5.3 item 5): a pessoa, o lugar em chip e a hora. */
function cartaoPresencaHTML(p, indice) {
  const lugar = dados.lugarPorId(p.lugar);
  const pessoa = p.userId ? dados.usuarioPorId(p.userId) : null;
  const opcoes = [{ valor: '', rotulo: p.assinatura ? 'Quem é ' + maiusculaInicial(p.assinatura) + '?' : 'Quem avisou?' }]
    .concat(dados.usuariosAtivos().filter((x) => !x.contaCompartilhada).map((x) => ({ valor: x.id, rotulo: x.nome })));
  const quem = pessoa
    ? '<span class="conferencia-presenca-quem">' + ui.avatar(pessoa, { tamanho: 'pq' }) + '<span>' + esc(pessoa.nome) + '</span></span>'
    : '';
  const seletor = selecaoConferenciaHTML(pessoa ? 'Trocar quem avisou' : 'Quem avisou', 'conf-presenca-quem', indice, opcoes, p.userId || '');
  /* A cor do lugar entra por data-lugar, não por classe de setor: quem manda na cor é css/registrar.css, e o
     token do lugar mora em css/tokens.css. */
  const chip = '<span class="chip conferencia-chip-lugar" data-lugar="' + esc(lugar.id) + '">' +
    icone(lugar.icone || 'info', 16) + '<span>' + esc(dados.nomeDoLugar(p)) + '</span></span>';
  const hora = '<span class="conferencia-presenca-hora">' + esc(p.hora ? 'desde ' + p.hora : 'desde agora') + '</span>';
  const aviso = !p.userId && p.usar
    ? '<p class="conferencia-aviso">' + icone('alerta', 14) + '<span>Diga quem avisou antes de gravar</span></p>'
    : '';
  return '<div class="conferencia-cartao conferencia-presenca"' + (p.usar ? '' : ' data-fora') + '>' +
    '<div class="conferencia-topo">' +
    '<label class="marcar"><input type="checkbox" data-campo="conf-presenca-usar" data-indice="' + indice + '"' + (p.usar ? ' checked' : '') + '>' +
    '<span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span>' +
    '<span>' + esc('Presença ' + (indice + 1)) + '</span></label>' +
    '<span class="conferencia-tarja" data-tom="' + (p.confianca === 'alta' ? 'alta' : 'media') + '">' +
    esc(p.confianca === 'alta' ? 'Li o lugar' : 'Li por conta própria, confira') + '</span></div>' +
    '<div class="conferencia-presenca-linha">' + quem + chip + hora + '</div>' + seletor + aviso + '</div>';
}

/** O que segura o botão de gravar: ambiguidade aberta e presença sem dono. */
function pendenciaConferencia(estado) {
  const itens = (estado.itens || []).filter((x) => x.usar);
  const amb = itens.find((x) => x.ambiguos.some((a) => !a.resolvido));
  if (amb) {
    const aberto = amb.ambiguos.find((a) => !a.resolvido);
    return 'Diga quem é ' + maiusculaInicial(aberto.pedaco) + ' antes de gravar';
  }
  if ((estado.presencas || []).some((p) => p.usar && !p.userId)) return 'Diga quem avisou antes de gravar';
  return '';
}

function conferenciaHTML(estado) {
  const itens = estado.itens || [];
  const presencas = estado.presencas || [];
  const avisos = (estado.avisos || []).map((x) => '<p class="conferencia-aviso">' + icone('alerta', 14) + '<span>' + esc(x) + '</span></p>').join('');
  if (!itens.length && !presencas.length) {
    return avisos + ui.estadoVazio({ icone: 'info', titulo: 'Nenhuma mensagem entendida', texto: 'Cole a mensagem inteira do grupo, com o título e a data.' });
  }
  const lista = itens.length ? '<div class="conferencia">' + itens.map(cartaoConferenciaHTML).join('') + '</div>' : '';
  const blocoPresencas = presencas.length
    ? '<div class="conferencia-secao">Presenças lidas</div><div class="conferencia">' + presencas.map(cartaoPresencaHTML).join('') + '</div>'
    : '';
  const pendencia = pendenciaConferencia(estado);
  const nota = pendencia ? '<p class="conferencia-aviso">' + icone('alerta', 14) + '<span>' + esc(pendencia) + '</span></p>' : '';
  return avisos + lista + blocoPresencas + nota;
}

function caixaDeColarHTML(estado) {
  return '<div class="campo">' +
    '<label class="campo-rotulo" for="col-texto">' + esc(estado.rotuloTexto || 'Cole aqui uma ou várias mensagens do grupo') + '</label>' +
    '<textarea class="areatexto" id="col-texto" name="col-texto" rows="8" data-campo="col-texto" placeholder="' +
    esc(ponte.TITULO) + '">' + esc(estado.texto || '') + '</textarea></div>' +
    '<p class="msg-nota">Nada é gravado agora: o app lê, mostra o que entendeu e só grava depois que você confere.</p>';
}

/** O rótulo do botão diz exatamente o que vai ser gravado, em unidades separadas: registro é serviço, presença é pessoa. */
function rotuloGravarHTML(estado) {
  const registros = (estado.itens || []).filter((x) => x.usar).length;
  const presencas = (estado.presencas || []).filter((x) => x.usar).length;
  if (!registros && !presencas) return 'Nada para gravar';
  const partes = [];
  if (registros) partes.push(plural(registros, 'registro', 'registros'));
  if (presencas) partes.push(plural(presencas, 'presença', 'presenças'));
  return 'Gravar ' + partes.join(' e ');
}

function rodapeColarHTML(estado) {
  if (!estado.leu) {
    return '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Fechar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="col-ler">Ler as mensagens</button>';
  }
  const temAlgo = (estado.itens || []).some((x) => x.usar) || (estado.presencas || []).some((x) => x.usar);
  const travado = !temAlgo || !!pendenciaConferencia(estado);
  return '<button type="button" class="btn btn-fantasma" data-acao="col-voltar">Voltar ao texto</button>' +
    '<button type="button" class="btn btn-primario" data-acao="col-gravar"' + (travado ? ' disabled' : '') + '>' +
    esc(rotuloGravarHTML(estado)) + '</button>';
}

/**
 * Resolve um pedaço ambíguo da assinatura: a pessoa escolhida entra em responsáveis e o "nenhum" vira texto livre.
 * Conta compartilhada escolhida não entra como responsável (DIRECAO-3 6.2): ela não é pessoa, então fica o nome da
 * conta em `responsavelTexto` até alguém dizer quem foi.
 */
function resolverAmbiguidade(item, pos, id) {
  const amb = item.ambiguos[pos];
  if (!amb) return;
  const campos = item.campos;
  const escolhido = id ? dados.usuarioPorId(id) : null;
  const anterior = amb.resolvido && amb.escolhido ? dados.usuarioPorId(amb.escolhido) : null;
  if (amb.resolvido && amb.escolhido) campos.responsaveis = (campos.responsaveis || []).filter((x) => x !== amb.escolhido);
  const tirar = [amb.pedaco].concat(anterior ? [anterior.nome] : []);
  let livres = pedacosSemCadastro(campos.responsavelTexto).filter((x) => !tirar.includes(x));
  if (escolhido && escolhido.contaCompartilhada) livres = livres.concat(escolhido.nome);
  else if (escolhido) campos.responsaveis = unicos((campos.responsaveis || []).concat(escolhido.id));
  else livres = livres.concat(amb.pedaco);
  campos.responsavelTexto = livres.join(', ');
  amb.escolhido = escolhido ? escolhido.id : '';
  amb.resolvido = true;
}

/** Os campos editados em linha. Devolve true quando a mudança pede redesenho do cartão. */
function campoConferencia(estado, alvo, evento) {
  const campo = alvo.getAttribute('data-campo');
  const indice = Number(alvo.getAttribute('data-indice'));
  const valor = alvo.type === 'checkbox' ? alvo.checked : alvo.value;
  if (campo === 'col-texto') { estado.texto = alvo.value; return false; }
  if (campo === 'conf-presenca-usar') {
    const p = estado.presencas[indice];
    if (p) p.usar = !!valor;
    return true;
  }
  if (campo === 'conf-presenca-quem') {
    const p = estado.presencas[indice];
    if (p) p.userId = String(valor || '');
    return true;
  }
  const item = estado.itens[indice];
  if (!item) return false;
  const campos = item.campos;
  switch (campo) {
    case 'col-usar': item.usar = !!valor; return true;
    case 'col-vincular': item.vincular = !!valor; return false;
    case 'conf-data':
      campos.data = /^\d{4}-\d{2}-\d{2}$/.test(String(valor)) ? String(valor) : null;
      if (evento === 'change') { ajustarHorasConferencia(campos); return true; }
      return false;
    case 'conf-periodo':
      campos.periodo = String(valor);
      ajustarHorasConferencia(campos);
      return true;
    case 'conf-hora':
      campos.horaInicio = String(valor || '');
      if (evento === 'change') { ajustarHorasConferencia(campos); return true; }
      return false;
    case 'conf-que': {
      const tipo = campos.tipoId ? dados.tipoPorId(campos.tipoId) : null;
      if (tipo && String(valor) !== tipo.nome) { campos.tipoId = null; campos.setorId = null; }
      campos.tipoLivre = String(valor);
      if (String(valor).trim()) item.avisos = item.avisos.filter((x) => x !== AVISO_DIVIDIDO);
      return false;
    }
    case 'conf-cliente':
      campos.clienteNome = String(valor);
      campos.clienteId = null;
      item.vincular = item.vincular && !!item.clienteSugerido && String(valor) === '';
      return false;
    case 'conf-local': campos.localTexto = String(valor); return false;
    case 'conf-carro':
      campos.veiculoId = String(valor) || null;
      if (campos.veiculoId) campos.veiculoTexto = '';
      return true;
    case 'conf-status':
      campos.status = String(valor);
      if (campos.status !== 'nao_realizado') item.motivo = '';
      return true;
    case 'conf-quem-add':
      if (valor) campos.responsaveis = unicos((campos.responsaveis || []).concat(String(valor)));
      return true;
    case 'conf-quem-texto':
      campos.responsavelTexto = String(valor);
      return false;
    default:
      return false;
  }
}

/**
 * "Colar do WhatsApp" (DIRECAO-2 5.2) e "Escrever como no grupo" (DIRECAO-3 5.4): a mesma caixa de texto, a mesma
 * leitura tolerante de src/whatsapp.js e a mesma conferência, que agora edita, divide, junta, resolve ambiguidade
 * e grava as presenças junto com os registros. Nada entra sem revisão, e nada é gravado sem o toque no botão.
 * @param {{servicoId?:string, aoGravar?:()=>void, texto?:string, lerJa?:boolean, titulo?:string, rotuloTexto?:string, origem?:string}} [opcoes]
 *   servicoId: bloco só de status atualiza aquele registro (DIRECAO-2 5.3, entrada C); texto e lerJa abrem já lido;
 *   rotuloTexto é o rótulo da caixa quando a pessoa volta ao texto; origem é a da presença gravada ('whatsapp' por
 *   padrão, 'app' quando o texto nasceu dentro do app, em "Escrever como no grupo").
 */
export function abrirColarDoWhatsApp(opcoes = {}) {
  const u = usuarioAtual();
  if (!u || !dados.pode('criarServico', u)) { ui.toast('Você não pode criar registros', 'erro'); return; }
  const origemPresenca = opcoes.origem === 'app' ? 'app' : 'whatsapp';
  const estado = {
    texto: String(opcoes.texto || ''), leu: false, itens: [], presencas: [], avisos: [], statusSolto: null,
    rotuloTexto: opcoes.rotuloTexto || '', origemPresenca
  };
  const { el, fechar } = ui.abrirSheet({
    titulo: opcoes.titulo || 'Colar do WhatsApp',
    corpo: '<div data-parte="colar">' + caixaDeColarHTML(estado) + '</div>',
    rodape: '<div class="sheet-rodape-linha" data-parte="colar-rodape">' + rodapeColarHTML(estado) + '</div>'
  });
  const pintar = () => {
    const corpo = el.querySelector('[data-parte="colar"]');
    if (corpo) corpo.innerHTML = estado.leu ? conferenciaHTML(estado) : caixaDeColarHTML(estado);
    const rodape = el.querySelector('[data-parte="colar-rodape"]');
    if (rodape) rodape.innerHTML = rodapeColarHTML(estado);
  };
  const ler = () => {
    const leitura = ponte.lerMensagens(estado.texto, contextoDaLeitura(u));
    estado.itens = leitura.registros.map(itemDaLeitura);
    estado.presencas = (leitura.presencas || []).map((p) => presencaDaLeitura(p, u));
    estado.avisos = leitura.avisos || [];
    estado.statusSolto = leitura.statusSolto || null;
    estado.leu = true;
    if (!estado.itens.length && !estado.presencas.length && estado.statusSolto && opcoes.servicoId) {
      estado.avisos = estado.avisos.concat('Toque em "Gravar" para aplicar só o status a este serviço.');
    }
    pintar();
  };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    const indice = Number(alvo.getAttribute('data-indice'));
    const item = estado.itens[indice];
    if (acao === 'col-ler') {
      const area = el.querySelector('[data-campo="col-texto"]');
      estado.texto = area ? area.value : '';
      ler();
    } else if (acao === 'col-voltar') {
      estado.leu = false;
      pintar();
    } else if (acao === 'col-motivo') {
      if (item) { item.motivo = alvo.getAttribute('data-valor') || ''; pintar(); }
    } else if (acao === 'conf-editar') {
      if (item) { item.editando = !item.editando; pintar(); }
    } else if (acao === 'conf-dividir') {
      if (!item) return;
      /* Dividir copia tudo e deixa o "o que vou fazer" em branco, para a pessoa terminar (5.3 item 2). */
      const novo = clonarItemConferencia(item);
      novo.campos.tipoId = null;
      novo.campos.tipoLivre = '';
      novo.avisos = [AVISO_DIVIDIDO];
      novo.suposicoes = [];
      novo.editando = true;
      estado.itens.splice(indice + 1, 0, novo);
      pintar();
    } else if (acao === 'conf-juntar') {
      if (!item || indice < 1) return;
      const antes = estado.itens[indice - 1];
      const textos = [textoDoQue(antes.campos), textoDoQue(item.campos)].map((x) => String(x || '').trim()).filter(Boolean);
      antes.campos.tipoLivre = textos.join(' e ');
      antes.campos.tipoId = textos.length > 1 ? null : antes.campos.tipoId;
      if (antes.campos.tipoId) antes.campos.tipoLivre = '';
      antes.campos.obs = [antes.campos.obs, item.campos.obs].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
      antes.campos.responsaveis = unicos((antes.campos.responsaveis || []).concat(item.campos.responsaveis || []));
      antes.campos.clienteNome = antes.campos.clienteNome || item.campos.clienteNome;
      antes.campos.localTexto = antes.campos.localTexto || item.campos.localTexto;
      /* O aviso de "escreva o que vai ser feito" era do cartão dividido, e juntar é desfazer a divisão: ele sai. */
      antes.avisos = unicos(antes.avisos.concat(item.avisos)).filter((x) => x !== AVISO_DIVIDIDO || !textos.length);
      estado.itens.splice(indice, 1);
      pintar();
    } else if (acao === 'conf-ambiguo') {
      if (item) { resolverAmbiguidade(item, Number(alvo.getAttribute('data-pos')), alvo.getAttribute('data-id') || ''); pintar(); }
    } else if (acao === 'conf-tirar-pessoa') {
      if (item) {
        const alvoId = alvo.getAttribute('data-valor');
        item.campos.responsaveis = (item.campos.responsaveis || []).filter((x) => x !== alvoId);
        pintar();
      }
    } else if (acao === 'conf-tirar-texto') {
      if (item) {
        const texto = alvo.getAttribute('data-valor');
        item.campos.responsavelTexto = pedacosSemCadastro(item.campos.responsavelTexto).filter((x) => x !== texto).join(', ');
        pintar();
      }
    } else if (acao === 'col-gravar') {
      /* Bloco só de caixas que marca "não realizado": o motivo é obrigatório, então vai pela folha que já existe. */
      if (!(estado.itens || []).some((x) => x.usar) && !(estado.presencas || []).some((x) => x.usar) &&
        estado.statusSolto === 'nao_realizado' && opcoes.servicoId) {
        fechar();
        abrirNaoRealizado(opcoes.servicoId);
        return;
      }
      const r = gravarColados(estado, u, opcoes);
      if (!r.ok) { ui.toast(r.erro, 'erro'); return; }
      fechar();
      ui.toast(r.mensagem);
      if (typeof opcoes.aoGravar === 'function') opcoes.aoGravar();
      ui.rerender();
    }
  });
  ui.delegar(el, '[data-campo]', 'change', (acao, alvo) => { if (campoConferencia(estado, alvo, 'change')) pintar(); });
  ui.delegar(el, '[data-campo]', 'input', (acao, alvo) => {
    /* Digitar não redesenha: o cursor precisa ficar onde está. O rodapé é o único que acompanha. */
    campoConferencia(estado, alvo, 'input');
    const rodape = el.querySelector('[data-parte="colar-rodape"]');
    if (rodape && estado.leu) rodape.innerHTML = rodapeColarHTML(estado);
  });
  if (opcoes.lerJa && estado.texto.trim()) ler();
}

/** Grava em lote o que a conferência aprovou: os registros e, junto, as presenças lidas. Devolve o que dizer no toast. */
function gravarColados(estado, u, opcoes) {
  const escolhidos = (estado.itens || []).filter((x) => x.usar);
  const presencas = (estado.presencas || []).filter((x) => x.usar && x.userId);
  if (!escolhidos.length && !presencas.length) {
    if (estado.statusSolto && opcoes.servicoId) {
      const r = mudarStatus(opcoes.servicoId, estado.statusSolto, { semDesfazer: estado.statusSolto === 'nao_realizado' });
      return r.ok ? { ok: true, mensagem: 'Status atualizado' } : { ok: false, erro: r.erro };
    }
    return { ok: false, erro: 'Nenhum registro para gravar' };
  }
  const pendencia = pendenciaConferencia(estado);
  if (pendencia) return { ok: false, erro: pendencia };
  const semMotivo = escolhidos.some((x) => x.campos.status === 'nao_realizado' && !x.motivo);
  if (semMotivo) return { ok: false, erro: 'Escolha o motivo do não realizado' };
  let gravados = 0;
  const erros = [];
  for (const item of escolhidos) {
    const campos = Object.assign({}, item.campos);
    if (item.vincular && item.clienteSugerido) {
      campos.clienteId = item.clienteSugerido.id;
      campos.clienteNome = '';
      if (item.clienteSugerido.endereco && !campos.localTexto) campos.endereco = snapshotEndereco(item.clienteSugerido.endereco);
    }
    const motivo = item.campos.status === 'nao_realizado' && item.motivo
      ? { opcao: item.motivo, texto: '', por: u.id, quando: agora() }
      : null;
    const r = salvarServico(campos, {
      status: campos.status, acaoAuditoria: 'registro_colado', motivoNaoRealizado: motivo,
      motivoAuditoria: campos.autorTexto ? 'Assinado por ' + campos.autorTexto : null
    });
    if (r.ok) gravados++;
    else erros.push(r.erros[0].mensagem);
  }
  /* Presença é fato sobre a pessoa e vai pela porta de dados.marcarPresenca, nunca como serviço (DIRECAO-3 2.2).
     O dia é hoje: o check-in do grupo fala do dia em que foi escrito, e o leitor só traz a hora. A origem é a da
     caixa: o que foi colado do grupo é 'whatsapp' e guarda a mensagem; o que foi digitado em "Escrever como no
     grupo" nasceu no app, é 'app' e não tem mensagem do grupo para guardar. */
  const hoje = util.hojeISO();
  const origem = estado.origemPresenca === 'app' ? 'app' : 'whatsapp';
  let marcadas = 0;
  for (const p of presencas) {
    try {
      dados.marcarPresenca(p.userId, hoje, {
        lugar: p.lugar, lugarTexto: p.lugarTexto, desde: p.hora || '', origem,
        mensagemOriginal: origem === 'whatsapp' ? p.mensagemOriginal : ''
      });
      marcadas++;
    } catch (erro) {
      erros.push(erro && erro.message ? erro.message : 'Não consegui gravar a presença');
    }
  }
  if (!gravados && !marcadas) return { ok: false, erro: erros[0] || 'Nada foi gravado' };
  const partes = [];
  if (gravados) partes.push(plural(gravados, 'registro gravado', 'registros gravados'));
  if (marcadas) partes.push(plural(marcadas, 'presença gravada', 'presenças gravadas'));
  const sobra = erros.length ? ', ' + plural(erros.length, 'item ficou de fora', 'itens ficaram de fora') : '';
  return { ok: true, mensagem: partes.join(' e ') + sobra };
}

/* ================================================================== */
/* Mensagens ao cliente (DIRECAO 4.9)                                  */
/* ================================================================== */

const MODELOS_MENSAGEM = [
  { chave: 'confirmacao', rotulo: 'Confirmação' },
  { chave: 'lembrete', rotulo: 'Lembrete de véspera' },
  { chave: 'reagendamento', rotulo: 'Reagendamento' },
  { chave: 'cancelamento', rotulo: 'Cancelamento' },
  { chave: 'pos', rotulo: 'Depois do serviço' }
];

const ROTULO_MENSAGEM = MODELOS_MENSAGEM.reduce((mapa, m) => Object.assign(mapa, { [m.chave]: m.rotulo }), {});

/**
 * Texto de um modelo de mensagem com as variáveis trocadas (4.9).
 * @param {string} id @param {'confirmacao'|'lembrete'|'reagendamento'|'cancelamento'|'pos'} chave
 * @returns {string} vazio quando o serviço não existe
 */
export function mensagemCliente(id, chave) {
  const a = servico(id);
  if (!a) return '';
  const config = repo.config() || {};
  const modelos = Object.assign({}, dados.MENSAGENS_PADRAO, config.mensagens || {});
  for (const k of Object.keys(dados.MENSAGENS_ANTIGAS)) if (modelos[k] === dados.MENSAGENS_ANTIGAS[k]) modelos[k] = dados.MENSAGENS_PADRAO[k];
  const modelo = modelos[chave] || modelos.confirmacao || '';
  const cliente = clienteDe(a);
  const veiculo = veiculoDe(a);
  const equipe = equipeDe(a);
  const valores = {
    cliente: cliente ? util.primeiroNome(cliente.nome) : '',
    tipo: nomeTipo(a),
    data: util.fmtDataExtensa(a.data),
    hora: a.horaInicio || '',
    carro: veiculo ? (veiculo.apelido || veiculo.nome) : 'sem carro',
    equipe: equipe ? (equipe.apelido || equipe.nome) : (listarNomes(nomesCurtos(a.responsaveis || [])) || 'a equipe'),
    loja: (config.loja && config.loja.nome) || 'Green Decor'
  };
  return String(modelo).replace(/\{(\w+)\}/g, (achado, chaveVar) => (valores[chaveVar] != null ? valores[chaveVar] : achado));
}

/* Registra o rascunho aberto. É "mensagem preparada", não enviada: sem servidor,
   não há como saber se a pessoa apertou enviar no WhatsApp (4.9). */
function registrarMensagemPreparada(a, chave, u) {
  const registro = { chave, por: u.id, quando: agora() };
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', a.id, { mensagensEnviadas: (a.mensagensEnviadas || []).concat(registro) });
    auditarServico(novo, 'mensagem_preparada', { motivo: ROTULO_MENSAGEM[chave] || chave });
  });
}

/** Monta o texto, registra o preparo e abre o WhatsApp do cliente. @param {string} id @param {string} chave @returns {boolean} */
function prepararMensagem(id, chave) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return false;
  const cliente = clienteDe(a);
  if (!cliente || !util.telDigitos(cliente.telefone)) { ui.toast('Cliente sem telefone', 'erro'); return false; }
  const texto = mensagemCliente(id, chave);
  registrarMensagemPreparada(a, chave, u);
  whatsapp(id, texto);
  return true;
}

/** Cliente com telefone: só então vale oferecer a mensagem depois de reagendar ou cancelar (4.9). */
function temTelefoneCliente(a) {
  const cliente = a ? clienteDe(a) : null;
  return !!(cliente && util.telDigitos(cliente.telefone));
}

/** Modelos que fazem sentido no status atual: lembrete de véspera não vale para serviço encerrado (4.10). */
function modelosDoServico(a) {
  return MODELOS_MENSAGEM.filter((m) => {
    if (m.chave === 'lembrete') return regras.statusAtivo(a.status);
    if (m.chave === 'pos') return a.status === 'concluido' || a.status === 'em_andamento';
    if (m.chave === 'cancelamento') return a.status === 'cancelado' || regras.statusAtivo(a.status);
    return true;
  });
}

/**
 * Folha de mensagens ao cliente (4.9): escolher o modelo, ler o texto e abrir o WhatsApp já preenchido.
 * Nada sai sozinho: quem aperta enviar é a pessoa.
 * @param {string} id
 */
export function abrirMensagens(id, chaveInicial) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const modelos = modelosDoServico(a);
  if (!modelos.length) return;
  let escolhida = modelos.some((m) => m.chave === chaveInicial) ? chaveInicial : modelos[0].chave;
  const preparadas = (a.mensagensEnviadas || []).slice(-3).reverse()
    .map((m) => (ROTULO_MENSAGEM[m.chave] || m.chave) + ', ' + nomeCurto(m.por) + ', ' + util.fmtDataHora(m.quando));
  const corpo = () =>
    '<div class="msg-modelos"><div class="chips-escolha" role="group" aria-label="Modelo">' +
      modelos.map((m) => '<button type="button" class="chip chip-escolha" data-acao="escolher-modelo" data-valor="' + esc(m.chave) + '"' +
        (m.chave === escolhida ? ' data-ativo' : '') + ' aria-pressed="' + (m.chave === escolhida ? 'true' : 'false') + '">' + esc(m.rotulo) + '</button>').join('') +
    '</div></div>' +
    '<div class="msg-previa" data-parte="previa">' + esc(mensagemCliente(id, escolhida)) + '</div>' +
    '<p class="msg-nota">Abre o WhatsApp com a mensagem pronta. Você confere e envia.</p>' +
    (preparadas.length ? '<div class="msg-historico">Já preparadas: ' + esc(preparadas.join('; ')) + '</div>' : '');
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Mensagem ao cliente',
    corpo: '<div data-parte="msg">' + corpo() + '</div>',
    rodape: '<button type="button" class="btn btn-secundario" data-acao="copiar-mensagem">Copiar texto</button>' +
      '<button type="button" class="btn btn-primario" data-acao="abrir-whatsapp">Abrir WhatsApp</button>'
  });
  ui.delegar(el, '[data-acao]', 'click', async (acao, alvo) => {
    if (acao === 'escolher-modelo') {
      escolhida = alvo.getAttribute('data-valor');
      marcarChipEscolhido(el, '[data-acao="escolher-modelo"]', escolhida);
      const previa = el.querySelector('[data-parte="previa"]');
      if (previa) previa.textContent = mensagemCliente(id, escolhida);
    } else if (acao === 'copiar-mensagem') {
      const ok = await copiarTexto(mensagemCliente(id, escolhida));
      ui.toast(ok ? 'Mensagem copiada' : 'Não foi possível copiar', ok ? 'ok' : 'erro');
    } else if (acao === 'abrir-whatsapp') {
      if (prepararMensagem(id, escolhida)) fechar();
    }
  });
}

/**
 * Folha de sugestão de horários (4.13): até três janelas livres com rótulo pronto, para copiar e mandar ao cliente.
 * @param {string} id
 */
export function abrirSugestoes(id) {
  const a = servico(id);
  if (!a) return;
  const opcoes = regras.sugerirHorarios(candidatoDe(a), { ignorarId: a.id });
  const texto = opcoes.map((s) => s.rotulo).join('\n');
  const corpo = opcoes.length
    ? '<p class="mudo">Três janelas livres para os mesmos recursos deste serviço.</p>' +
      '<div class="msg-previa">' + esc(texto) + '</div>' +
      '<p class="msg-nota">Copie e mande ao cliente para ele escolher. Reagendar continua sendo um passo à parte.</p>'
    : ui.estadoVazio({ icone: 'relogio', titulo: 'Sem janela livre nos próximos dias', texto: 'Tente trocar o carro ou a equipe do serviço.' });
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Sugerir horários',
    corpo,
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Fechar</button>' +
      (opcoes.length ? '<button type="button" class="btn btn-primario" data-acao="copiar-sugestoes">Copiar as três</button>' : '')
  });
  ui.delegar(el, '[data-acao]', 'click', async (acao) => {
    if (acao !== 'copiar-sugestoes') return;
    const ok = await copiarTexto(texto);
    ui.toast(ok ? 'Horários copiados' : 'Não foi possível copiar', ok ? 'ok' : 'erro');
    if (ok) fechar();
  });
}

/** Copia o link interno do tipo, com toast. @param {string} tipoId @returns {Promise<void>} */
export async function copiarLinkDoTipo(tipoId) {
  if (!tipoId) return;
  const ok = await copiarTexto(linkDoTipo(tipoId));
  ui.toast(ok ? 'Link copiado' : 'Não foi possível copiar', ok ? 'ok' : 'erro');
}

/* ================================================================== */
/* Sheets do serviço (8.5)                                             */
/* ================================================================== */

function chipsMotivoHTML(lista, escolhida) {
  return '<div class="chips-escolha" role="group" aria-label="Motivo">' + lista.map((m) =>
    '<button type="button" class="chip chip-escolha" data-acao="escolher-opcao" data-valor="' + esc(m.id) + '" aria-pressed="' + (escolhida === m.id ? 'true' : 'false') + '"' + (escolhida === m.id ? ' data-ativo' : '') + '>' + esc(m.rotulo) + '</button>'
  ).join('') + '</div>';
}

function marcarChipEscolhido(raiz, seletor, valor) {
  raiz.querySelectorAll(seletor).forEach((chip) => {
    const ativo = chip.getAttribute('data-valor') === valor;
    chip.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    if (ativo) chip.setAttribute('data-ativo', ''); else chip.removeAttribute('data-ativo');
  });
}

function mostrarErroSheet(el, seletor, msg) {
  const p = el.querySelector(seletor);
  if (!p) return;
  p.textContent = msg || '';
  p.hidden = !msg;
}

function candidatoDe(a) {
  return {
    id: a.id, tipoId: a.tipoId, setorId: a.setorId, data: a.data, horaInicio: a.horaInicio, horaFim: a.horaFim,
    periodo: a.periodo || 'hora', horaAproximada: !!a.horaAproximada, origem: a.origem || 'loja',
    responsaveis: (a.responsaveis || []).slice(), equipeId: a.equipeId || null, veiculoId: a.veiculoId || null, semCarroConfirmado: !!a.semCarroConfirmado
  };
}

/* ---- Reagendar ---- */

function gravarReagendamento(a, c, motivo, analise, textos, u) {
  const mudancas = { status: 'reagendado' };
  for (const k of CAMPOS_HORARIO.concat(CAMPOS_RECURSOS, 'semCarroConfirmado')) if (difere(a[k], c[k])) mudancas[k] = c[k];
  /* Escolher um horário na coluna faz o registro aproximado virar hora exata; escolher um período mantém
     (ou devolve) a hora aproximada, e o dado guarda as horas derivadas do período (DIRECAO-2 2.2 e 2.3). */
  const periodoNovo = c.periodo || 'hora';
  const aproximadoNovo = periodoNovo !== 'hora' && !!c.horaAproximada;
  if ((a.periodo || 'hora') !== periodoNovo) mudancas.periodo = periodoNovo;
  if (!!a.horaAproximada !== aproximadoNovo) mudancas.horaAproximada = aproximadoNovo;
  const registro = { de: { data: a.data, horaInicio: a.horaInicio, horaFim: a.horaFim }, para: { data: c.data, horaInicio: c.horaInicio, horaFim: c.horaFim }, motivo: { opcao: motivo.opcao, texto: motivo.texto }, por: u.id, quando: agora() };
  mudancas.reagendamentos = (a.reagendamentos || []).concat(registro);
  if (analise.decisao.modo === 'justificar') mudancas.justificativaConflito = textos.justificativa.trim();
  if (analise.decisao.modo === 'pedir') mudancas.liberacao = novaLiberacao(u, textos.pedido);
  const grave = analise.conflitos.some((k) => k.severidade !== 'aviso');
  if (!grave && a.liberacao && a.liberacao.estado === 'pendente') mudancas.liberacao = null;
  return repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', a.id, mudancas);
    auditarServico(novo, 'servico_reagendado', { campos: dados.diffCampos(a, novo, Object.keys(mudancas).filter((k) => !['reagendamentos', 'liberacao'].includes(k))), motivo: textoMotivo(motivo, dados.MOTIVOS_REAGENDAMENTO) });
    registrarConflito(novo, analise.decisao.modo, textos, u);
    avisar('agenda', 'Serviço reagendado', descricaoNotif(novo) + ' (era ' + util.fmtDataMedia(a.data) + ', ' + a.horaInicio + ')', pessoasDe(a).concat(pessoasDe(novo), gestores(), a.criadoPor), novo);
    return novo;
  });
}

/**
 * Sheet de reagendar (8.5): calendário do mês, coluna de horários livres, conflitos e motivo; grava status reagendado.
 * O calendário fica embutido, não em folha por cima: só existe uma folha por vez.
 * @param {string} id @param {{aoFechar?:()=>void}} [opcoes]
 */
export function abrirReagendar(id, opcoes = {}) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const permissao = regras.podeTransitar(a, 'reagendado', u);
  if (!permissao.ok) { ui.toast(permissao.motivo, 'erro'); return; }
  const c = candidatoDe(a);
  const r = {
    motivo: { opcao: '', texto: '' }, justificativa: '', pedido: '', alternativas: [],
    mes: util.inicioMes(a.data), horaProvisoria: '', mostrarAssimMesmo: false, duracaoMin: 0
  };
  /* Registro por período: as cinco horas da tarde não são duração, são a faixa do dia. A coluna de horários e os
     dias com vaga usam a duração do tipo (ou os 60 min de registro sem tipo), senão nenhum dia tinha vaga. */
  if (a.horaAproximada) r.duracaoMin = duracaoDe(Object.assign({}, c, { horaInicio: '', horaFim: '' }));
  let gravou = false;
  const rotuloPeriodo = (obj) => (obj.horaAproximada && dados.PERIODOS[obj.periodo] && obj.periodo !== 'hora'
    ? dados.PERIODOS[obj.periodo].rotulo + ', das ' + obj.horaInicio + ' às ' + obj.horaFim
    : util.fmtIntervalo(obj.horaInicio, obj.horaFim));
  /* Quem registrou "tarde" pode reagendar para "manhã" sem inventar hora exata: os chips de período ficam
     acima do par calendário mais horários, e a coluna continua sendo o caminho para a hora exata. */
  const periodoHTML = () => (!a.horaAproximada ? '' :
    '<div class="campo mt3" data-parte="periodo"><span class="campo-rotulo">Período</span><div class="chips-escolha" role="group" aria-label="Período">' +
    ['manha', 'tarde', 'dia'].map((chave) => {
      const ativo = !!c.horaAproximada && c.periodo === chave;
      return '<button type="button" class="chip chip-escolha" data-acao="reagendar-periodo" data-valor="' + chave + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + '>' + esc(dados.PERIODOS[chave].rotulo) + '</button>';
    }).join('') +
    '</div><p class="msg-nota">' + esc(c.horaAproximada ? 'Fica como período, das ' + c.horaInicio + ' às ' + c.horaFim + '. Escolher um horário na coluna troca por hora exata.' : 'Hora exata, ' + util.fmtIntervalo(c.horaInicio, c.horaFim) + '. Um período devolve a hora aproximada.') + '</p></div>');
  /* DIRECAO 4.7: ao reagendar, manter a mesma equipe (padrão) ou realocar quem estiver livre.
     Em "realocar" a coluna de horários é calculada sem recurso fixo, e o rodízio escolhe carro e equipe do horário. */
  const recursoMantido = { veiculoId: a.veiculoId || null, equipeId: a.equipeId || null, responsaveis: (a.responsaveis || []).slice(), semCarroConfirmado: !!a.semCarroConfirmado };
  const SEM_RECURSO = { veiculoId: null, equipeId: null, responsaveis: [], semCarroConfirmado: false };
  r.recurso = 'manter';
  r.semLivre = false;
  const aplicarRecurso = () => {
    r.semLivre = false;
    if (r.recurso !== 'realocar') { Object.assign(c, recursoMantido, { responsaveis: recursoMantido.responsaveis.slice() }); return; }
    const escolha = c.data && c.horaInicio && c.horaFim ? regras.escolherRecurso(Object.assign({}, c, SEM_RECURSO, { responsaveis: [] }), { ignorarId: a.id }) : null;
    if (escolha) Object.assign(c, { veiculoId: escolha.veiculoId || null, equipeId: escolha.equipeId || null, responsaveis: (escolha.responsaveis || []).slice(), semCarroConfirmado: !!escolha.semCarroConfirmado });
    else { Object.assign(c, recursoMantido, { responsaveis: recursoMantido.responsaveis.slice() }); r.semLivre = true; }
  };
  const cConsulta = () => (r.recurso === 'realocar' ? Object.assign({}, c, SEM_RECURSO, { responsaveis: [] }) : c);
  const recursoHTML = () =>
    '<div class="campo mt3" data-parte="recurso"><span class="campo-rotulo">Carro e equipe</span><div class="chips-escolha" role="group" aria-label="Carro e equipe">' +
    [['manter', 'Manter a mesma equipe'], ['realocar', 'Realocar quem estiver livre']].map(([valor, rotulo]) =>
      '<button type="button" class="chip chip-escolha" data-acao="escolher-recurso-reag" data-valor="' + valor + '" aria-pressed="' + (r.recurso === valor ? 'true' : 'false') + '"' + (r.recurso === valor ? ' data-ativo' : '') + '>' + rotulo + '</button>').join('') +
    '</div><p class="msg-nota">' + esc(r.semLivre ? 'Ninguém livre nesse horário. Fica com ' + (textoRecurso(recursoMantido) || 'a equipe atual') + '.' : 'Vai com ' + (textoRecurso(c) || 'equipe a definir') + '.') + '</p></div>';
  const analisar = () => {
    const analise = analisarConflitos(c, u, r, a);
    r.alternativas = analise.alternativas;
    return analise;
  };
  const corpo = () =>
    '<p class="mudo">Hoje marcado para <strong>' + esc(util.fmtDataMedia(a.data) + ', ' + rotuloPeriodo(a)) + '</strong></p>' +
    periodoHTML() +
    '<div class="agendar-duo mt3"><div class="agendar-duo-calendario"><span class="campo-rotulo">Nova data</span>' + calendarioMesHTML(cConsulta(), r) + '</div>' +
    '<div class="agendar-duo-horarios"><span class="campo-rotulo">Horário</span><div data-parte="regua">' + colunaHorariosHTML(cConsulta(), r) + notaHorarioHTML(c) + '</div></div></div>' +
    controlesHorarioHTML(c, 'rg') +
    recursoHTML() +
    '<div data-parte="faixa" class="mt3">' + faixaConflitoHTML(analisar(), u, r) + '</div>' +
    '<div class="campo mt4"><span class="campo-rotulo">Motivo</span>' + chipsMotivoHTML(dados.MOTIVOS_REAGENDAMENTO, r.motivo.opcao) + '</div>' +
    '<div class="campo"><label class="campo-rotulo" for="rg-texto">Detalhes <span class="opcional">(obrigatório em Outro)</span></label>' +
    '<textarea class="areatexto" id="rg-texto" rows="2" data-campo="motivo-texto">' + esc(r.motivo.texto) + '</textarea></div>' +
    '<p class="msg-erro-campo" data-erro hidden></p>';
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Reagendar',
    corpo: corpo(),
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="confirmar-reagendar">Reagendar</button>',
    aoFechar: () => { if (typeof opcoes.aoFechar === 'function') opcoes.aoFechar(gravou); }
  });
  const corpoEl = el.querySelector('.sheet-corpo');
  const rerenderQuando = (tudo) => {
    if (tudo) { corpoEl.innerHTML = corpo(); }
    else {
      corpoEl.querySelector('[data-parte="regua"]').innerHTML = colunaHorariosHTML(cConsulta(), r) + notaHorarioHTML(c);
      const caixaRecurso = corpoEl.querySelector('[data-parte="recurso"]');
      if (caixaRecurso) caixaRecurso.outerHTML = recursoHTML();
      atualizarInputsHorario(corpoEl, c);
      trocarFaixa(corpoEl.querySelector('[data-parte="faixa"]'), faixaConflitoHTML(analisar(), u, r));
    }
    rolarHorarios(corpoEl);
    mostrarErroSheet(el, '[data-erro]', '');
  };
  const TROCA_TUDO = new Set(['escolher-data', 'escolher-dia', 'mes-anterior', 'mes-seguinte', 'primeiro-livre', 'mostrar-assim-mesmo']);
  rolarHorarios(corpoEl);
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao.startsWith('ui:')) return;
    if (tratarAcaoQuando(acao, alvo, c, r)) {
      /* Dia novo com período mantido: as horas derivadas seguem a faixa do dia escolhido (sábado tem faixa única). */
      if (c.horaAproximada && (acao === 'escolher-dia' || acao === 'escolher-data')) {
        const horas = regras.horasDoPeriodo(c.data, c.periodo, c.setorId);
        if (horas) { c.horaInicio = horas.horaInicio; c.horaFim = horas.horaFim; }
      }
      aplicarRecurso();
      rerenderQuando(TROCA_TUDO.has(acao));
      return;
    }
    if (acao === 'escolher-recurso-reag') {
      r.recurso = alvo.getAttribute('data-valor') === 'realocar' ? 'realocar' : 'manter';
      aplicarRecurso();
      rerenderQuando(true);
      return;
    }
    if (acao === 'reagendar-periodo') {
      const chave = alvo.getAttribute('data-valor');
      const horas = dados.PERIODOS[chave] ? regras.horasDoPeriodo(c.data, chave, c.setorId) : null;
      if (!horas) return;
      c.periodo = chave;
      c.horaInicio = horas.horaInicio;
      c.horaFim = horas.horaFim;
      c.horaAproximada = true;
      r.horaProvisoria = '';
      aplicarRecurso();
      rerenderQuando(true);
      return;
    }
    if (acao === 'escolher-opcao') {
      r.motivo.opcao = alvo.getAttribute('data-valor');
      marcarChipEscolhido(el, '[data-acao="escolher-opcao"]', r.motivo.opcao);
      mostrarErroSheet(el, '[data-erro]', '');
      if (r.motivo.opcao === 'outro') el.querySelector('#rg-texto').focus();
      return;
    }
    if (acao === 'aplicar-alternativa') {
      const alt = r.alternativas.find((x) => x.id === alvo.getAttribute('data-valor'));
      if (alt) {
        Object.assign(c, alt.mudancas);
        /* A alternativa pode trocar carro ou equipe: passa a ser o recurso mantido, senão a próxima troca de horário desfazia. */
        if (r.recurso === 'manter') Object.assign(recursoMantido, { veiculoId: c.veiculoId || null, equipeId: c.equipeId || null, responsaveis: (c.responsaveis || []).slice(), semCarroConfirmado: !!c.semCarroConfirmado });
        rerenderQuando(true);
      }
      return;
    }
    if (acao === 'confirmar-reagendar') {
      const analise = analisar();
      const mudouHorario = CAMPOS_HORARIO.some((k) => a[k] !== c[k]);
      if (!mudouHorario) { mostrarErroSheet(el, '[data-erro]', 'Escolha uma nova data ou um novo horário.'); return; }
      if (min(c.horaFim) <= min(c.horaInicio)) { mostrarErroSheet(el, '[data-erro]', 'O término precisa ser depois do início.'); return; }
      if (!r.motivo.opcao) { mostrarErroSheet(el, '[data-erro]', 'Escolha o motivo.'); return; }
      if (r.motivo.opcao === 'outro' && !r.motivo.texto.trim()) { mostrarErroSheet(el, '[data-erro]', 'Descreva o motivo.'); return; }
      if (analise.decisao.erro) { mostrarErroSheet(el, '[data-erro]', analise.decisao.erro); return; }
      const atual = servico(id);
      const permite = regras.podeTransitar(atual, 'reagendado', u);
      if (!permite.ok) { mostrarErroSheet(el, '[data-erro]', permite.motivo); return; }
      gravarReagendamento(atual, c, r.motivo, analise, r, u);
      gravou = true;
      const textoToast = 'Reagendado para ' + util.fmtDataMedia(c.data) + ', ' + (c.horaAproximada && dados.PERIODOS[c.periodo] && c.periodo !== 'hora' ? dados.PERIODOS[c.periodo].curto : c.horaInicio);
      fechar();
      if (temTelefoneCliente(atual)) ui.toastAcao(textoToast, { rotulo: 'Avisar cliente', aoClicar: () => abrirMensagens(id, 'reagendamento') });
      else ui.toast(textoToast);
    }
  });
  ui.delegar(el, '[data-campo]', 'change', (acao, alvo) => {
    if (tratarCampoQuando(alvo.getAttribute('data-campo'), alvo.value, c)) { aplicarRecurso(); rerenderQuando(alvo.getAttribute('data-campo') === 'dataCalendario'); }
  });
  ui.delegar(el, '[data-campo]', 'input', (acao, alvo) => {
    const campo = alvo.getAttribute('data-campo');
    if (campo === 'motivo-texto') r.motivo.texto = alvo.value;
    else if (campo === 'justificativa') r.justificativa = alvo.value;
    else if (campo === 'pedido') r.pedido = alvo.value;
  });
}

/** Rota #/servico/:id/reagendar: detalhe por baixo e a sheet por cima; fechar volta ao detalhe. */
function telaReagendarRota(ctx) {
  telaDetalhe(ctx);
  const id = ctx.params.id;
  const a = servico(id);
  if (!a || !dados.visivel(a, ctx.usuario || usuarioAtual())) return;
  abrirReagendar(id, {
    aoFechar: () => {
      if ((location.hash || '').startsWith('#/servico/' + id + '/reagendar')) ui.irPara('#/servico/' + id, { substituir: true });
    }
  });
}

/* ---- Cancelar ---- */

/** Sheet de cancelar com motivo; toast com desfazer de 8 s. @param {string} id */
export async function abrirCancelar(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const permissao = regras.podeTransitar(a, 'cancelado', u);
  if (!permissao.ok) { ui.toast(permissao.motivo, 'erro'); return; }
  const motivo = await ui.pedirMotivo({ titulo: 'Cancelar serviço', opcoes: dados.MOTIVOS_CANCELAMENTO, rotuloOk: 'Cancelar serviço', perigo: true, ajuda: tituloServico(a) + ', ' + util.fmtDataMedia(a.data) });
  if (!motivo) return;
  const r = mudarStatus(id, 'cancelado', { motivo });
  if (!r.ok) ui.toast(r.erro, 'erro');
}

/* ---- Não realizado ---- */

/**
 * Sheet de não realizado com motivo; oferece "Reagendar agora" (duplicar).
 * Só depois da hora de início, não só depois do dia (DIRECAO 4.10).
 * @param {string} id
 */
export function abrirNaoRealizado(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  /* A menor cadeia permitida (DIRECAO-2 6.2): a partir de aguardando confirmação o app confirma e marca na
     mesma transação, como já faz de Agendado para Em andamento. A hora de início (4.10) é checada pelo motor. */
  const caminho = regras.caminhoSimples(a, u, 'nao_realizado');
  if (!caminho.ok) { ui.toast(caminho.atual ? 'Já está marcado como não realizado' : caminho.motivo, 'erro'); return; }
  const m = { opcao: '', texto: '' };
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Não realizado',
    corpo: '<p class="mudo">' + esc(tituloServico(a) + ', ' + util.fmtDataMedia(a.data) + ', ' + a.horaInicio) + '</p>' +
      '<div class="campo mt3"><span class="campo-rotulo">Motivo</span>' + chipsMotivoHTML(dados.MOTIVOS_NAO_REALIZADO, '') + '</div>' +
      '<div class="campo"><label class="campo-rotulo" for="nr-texto">Detalhes <span class="opcional">(obrigatório em Outro)</span></label><textarea class="areatexto" id="nr-texto" rows="2"></textarea></div>' +
      '<p class="msg-erro-campo" data-erro hidden></p>',
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-perigo" data-acao="confirmar-nao-realizado">Marcar não realizado</button>'
  });
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'escolher-opcao') {
      m.opcao = alvo.getAttribute('data-valor');
      marcarChipEscolhido(el, '[data-acao="escolher-opcao"]', m.opcao);
      mostrarErroSheet(el, '[data-erro]', '');
      if (m.opcao === 'outro') el.querySelector('#nr-texto').focus();
    } else if (acao === 'confirmar-nao-realizado') {
      m.texto = el.querySelector('#nr-texto').value.trim();
      if (!m.opcao) { mostrarErroSheet(el, '[data-erro]', 'Escolha o motivo.'); return; }
      if (m.opcao === 'outro' && !m.texto) { mostrarErroSheet(el, '[data-erro]', 'Descreva o motivo.'); return; }
      const r = regras.aplicarStatusSimples(id, 'nao_realizado', u, { motivo: m });
      if (!r.ok) { mostrarErroSheet(el, '[data-erro]', r.erro); return; }
      ui.toast(MENSAGEM_STATUS.nao_realizado);
      r.notificar();
      /* A folha continua aberta (oferece "Reagendar agora") e o rerender global fica adiado enquanto há sheet:
         a tela de trás é atualizada agora, para o feed de Hoje não mostrar "Agendado" com o dado já gravado. */
      ui.rerender();
      el.querySelector('.sheet-corpo').innerHTML = ui.estadoVazio({ icone: 'alerta', titulo: 'Registrado como não realizado', texto: 'A gestão e quem criou o serviço foram avisados. Quer já marcar uma nova data?' });
      el.querySelector('.sheet-rodape').innerHTML = '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Fechar</button>' +
        '<button type="button" class="btn btn-primario" data-acao="reagendar-agora">Reagendar agora</button>';
    } else if (acao === 'reagendar-agora') {
      fechar();
      duplicar(id);
    }
  });
}

/* ---- Concluir ---- */

function iniciarAssinatura(canvas, estado) {
  const dpr = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth || 320;
  const altura = canvas.clientHeight || 160;
  canvas.width = Math.round(largura * dpr);
  canvas.height = Math.round(altura * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--texto').trim();
  let desenhando = false;
  const ponto = (ev) => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (ev) => {
    desenhando = true;
    canvas.setPointerCapture(ev.pointerId);
    const p = ponto(ev);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ev.preventDefault();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!desenhando) return;
    const p = ponto(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    estado.assinou = true;
    const dica = canvas.parentElement.querySelector('[data-dica]');
    if (dica) dica.hidden = true;
    ev.preventDefault();
  });
  const soltar = () => { desenhando = false; };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', soltar);
  canvas.addEventListener('pointerleave', soltar);
  estado.limpar = () => {
    ctx.clearRect(0, 0, largura, altura);
    estado.assinou = false;
    const dica = canvas.parentElement.querySelector('[data-dica]');
    if (dica) dica.hidden = false;
  };
  estado.exportar = () => {
    const maior = Math.max(canvas.width, canvas.height);
    const fator = maior > 600 ? 600 / maior : 1;
    const saida = document.createElement('canvas');
    saida.width = Math.round(canvas.width * fator);
    saida.height = Math.round(canvas.height * fator);
    const sctx = saida.getContext('2d');
    const fundo = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    if (fundo) { sctx.fillStyle = fundo; sctx.fillRect(0, 0, saida.width, saida.height); }
    sctx.drawImage(canvas, 0, 0, saida.width, saida.height);
    return saida.toDataURL('image/png');
  };
}

function gravarConclusao(a, u, dadosConclusao) {
  const { marcados, obs, aprovou, pendencias, horaConclusao, dataUrl } = dadosConclusao;
  const quando = agora();
  const checklist = (a.checklist || []).map((k) => (marcados.has(k.id) && !k.feito ? Object.assign({}, k, { feito: true, por: u.id, quando }) : k));
  const abertos = checklist.filter((k) => !k.feito).length;
  const inicioMs = util.msDe(a.data, a.horaInicio);
  const concluidoEm = util.clamp(util.msDe(a.data, horaConclusao || a.horaFim), inicioMs, Math.max(inicioMs, quando));
  return repo.transacao(() => {
    let assinaturaId = null;
    if (dataUrl) assinaturaId = repo.criar('assinaturas', { agendamentoId: a.id, dataUrl, por: u.id, quando }).id;
    const novo = repo.atualizar('agendamentos', a.id, {
      status: 'concluido', concluidoEm, obsConclusao: obs || null, pendenciasConclusao: abertos ? pendencias : null,
      clienteAprovou: !!aprovou, assinaturaId, checklist
    });
    // Itens marcados na sheet foram feitos antes da conclusão: entram no histórico antes do registro Concluído.
    for (const k of checklist) if (marcados.has(k.id) && !(a.checklist || []).find((x) => x.id === k.id).feito) auditarServico(novo, 'checklist_alterado', { motivo: 'Concluído: ' + k.texto });
    auditarServico(novo, 'servico_concluido', { campos: dados.diffCampos(a, novo, ['status', 'clienteAprovou']), motivo: abertos ? plural(abertos, 'pendência', 'pendências') + ': ' + pendencias : (obs || null) });
    avisar('status', 'Serviço concluído', nomeCurtoDe(u.nome) + ' concluiu ' + descricaoNotif(novo) + (abertos ? ', com ' + plural(abertos, 'pendência', 'pendências') : ''), gestores().concat(a.criadoPor, supervisores(a)), novo);
    return novo;
  });
}

/** Sheet de concluir (6.7): pendências, obs, cliente aprovou, assinatura se o tipo pede, hora de conclusão. @param {string} id */
export function abrirConcluir(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const permissao = regras.podeTransitar(a, 'concluido', u);
  if (!permissao.ok) { ui.toast(permissao.motivo, 'erro'); return; }
  const tipo = tipoDe(a);
  const pedeAssinatura = !!(tipo && tipo.pedeAssinatura);
  const abertos = (a.checklist || []).filter((k) => !k.feito);
  const marcados = new Set();
  const assinatura = { assinou: false, pular: false, limpar: null, exportar: null };
  const hoje = util.hojeISO();
  const horaMax = a.data === hoje ? util.minParaHora(util.agoraMin()) : '23:59';
  const horaPadrao = a.data === hoje ? util.minParaHora(Math.max(min(a.horaInicio), util.agoraMin())) : a.horaFim;
  const contarAbertos = () => abertos.filter((k) => !marcados.has(k.id)).length;
  const rotuloBotao = () => { const n = contarAbertos(); return n ? 'Concluir com ' + plural(n, 'pendência', 'pendências') : 'Concluir'; };
  const itens = abertos.length
    ? '<div class="campo"><span class="campo-rotulo">Itens em aberto</span><div class="checklist">' + abertos.map((k) =>
      '<button type="button" class="check-linha" role="checkbox" aria-checked="false" data-acao="marcar-item" data-id="' + esc(k.id) + '"><span class="check-caixa" aria-hidden="true">' + icone('check', 18) + '</span><span class="check-corpo"><span class="check-texto">' + esc(k.texto) + '</span></span></button>'
    ).join('') + '</div></div>'
    : '<p class="mudo">Checklist completo.</p>';
  const corpo = itens +
    '<div data-parte="pendencias">' + (abertos.length ? ui.campo({ id: 'cc-pend', rotulo: 'Pendências', ajuda: 'Explique em uma linha o que ficou aberto', atributos: 'data-campo="pendencias"' }) : '') + '</div>' +
    ui.campo({ id: 'cc-obs', rotulo: 'Observações da conclusão', multilinha: true, atributos: 'data-campo="obs" rows="2" placeholder="Como foi o serviço, orientações deixadas ao cliente"' }) +
    '<label class="marcar"><input type="checkbox" data-campo="aprovou" checked><span class="caixa-marcar" aria-hidden="true">' + icone('check', 16) + '</span><span>Cliente aprovou o serviço</span></label>' +
    (pedeAssinatura
      ? '<div class="campo mt3"><span class="campo-rotulo">Assinatura do cliente</span>' +
        '<div data-parte="assinatura" style="position:relative"><canvas data-canvas style="display:block;width:100%;height:160px;border:1px solid var(--borda-forte);border-radius:var(--r-s);background:var(--card);touch-action:none" aria-label="Área de assinatura"></canvas>' +
        '<span data-dica class="mudo" style="position:absolute;left:12px;top:12px;pointer-events:none">Assine aqui</span></div>' +
        '<div class="btn-grupo mt2"><button type="button" class="btn btn-fantasma btn-pq" data-acao="limpar-assinatura">Limpar</button>' +
        '<button type="button" class="btn btn-fantasma btn-pq" data-acao="pular-assinatura" aria-pressed="false">Pular assinatura</button></div></div>'
      : '') +
    ui.campo({ id: 'cc-hora', rotulo: 'Horário de conclusão', tipo: 'time', valor: horaPadrao, atributos: 'data-campo="hora" min="' + esc(a.horaInicio) + '" max="' + esc(horaMax) + '"' }) +
    '<p class="msg-erro-campo" data-erro hidden></p>';
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Concluir serviço',
    corpo,
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="confirmar-concluir">' + esc(rotuloBotao()) + '</button>'
  });
  const canvas = el.querySelector('[data-canvas]');
  if (canvas) requestAnimationFrame(() => iniciarAssinatura(canvas, assinatura));
  const atualizarPendencias = () => {
    el.querySelector('[data-acao="confirmar-concluir"]').textContent = rotuloBotao();
    const parte = el.querySelector('[data-parte="pendencias"]');
    if (parte) parte.hidden = contarAbertos() === 0;
  };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'marcar-item') {
      const itemId = alvo.getAttribute('data-id');
      if (marcados.has(itemId)) marcados.delete(itemId); else marcados.add(itemId);
      const ativo = marcados.has(itemId);
      alvo.setAttribute('aria-checked', ativo ? 'true' : 'false');
      if (ativo) alvo.setAttribute('data-feito', ''); else alvo.removeAttribute('data-feito');
      atualizarPendencias();
    } else if (acao === 'limpar-assinatura') {
      if (assinatura.limpar) assinatura.limpar();
    } else if (acao === 'pular-assinatura') {
      assinatura.pular = !assinatura.pular;
      alvo.setAttribute('aria-pressed', assinatura.pular ? 'true' : 'false');
      const parte = el.querySelector('[data-parte="assinatura"]');
      if (parte) parte.hidden = assinatura.pular;
    } else if (acao === 'confirmar-concluir') {
      const pendencias = (el.querySelector('[data-campo="pendencias"]') || {}).value || '';
      const obs = (el.querySelector('[data-campo="obs"]') || {}).value || '';
      const aprovou = !!(el.querySelector('[data-campo="aprovou"]') || {}).checked;
      const hora = (el.querySelector('[data-campo="hora"]') || {}).value || horaPadrao;
      if (contarAbertos() > 0 && !pendencias.trim()) { mostrarErroSheet(el, '[data-erro]', 'Explique as pendências para concluir.'); el.querySelector('[data-campo="pendencias"]').focus(); return; }
      if (min(hora) < min(a.horaInicio)) { mostrarErroSheet(el, '[data-erro]', 'A conclusão não pode ser antes do início (' + a.horaInicio + ').'); return; }
      if (pedeAssinatura && !assinatura.pular && !assinatura.assinou) { mostrarErroSheet(el, '[data-erro]', 'Colha a assinatura do cliente ou toque em "Pular assinatura".'); return; }
      const atual = servico(id);
      const permite = regras.podeTransitar(atual, 'concluido', u);
      if (!permite.ok) { mostrarErroSheet(el, '[data-erro]', permite.motivo); return; }
      const dataUrl = pedeAssinatura && !assinatura.pular && assinatura.assinou && assinatura.exportar ? assinatura.exportar() : null;
      gravarConclusao(atual, u, { marcados, obs: obs.trim(), aprovou, pendencias: pendencias.trim(), horaConclusao: hora, dataUrl });
      ui.toast('Serviço concluído');
      fechar();
    }
  });
}

/* ---- Avisar atraso ---- */

/** Sheet de avisar atraso: 15, 30, 45 ou hora; grava, audita, notifica e abre o WhatsApp. @param {string} id */
export function abrirAvisarAtraso(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  if (!regras.acoesDisponiveis(a, u).avisarAtraso) { ui.toast('Você não pode avisar atraso neste serviço', 'erro'); return; }
  const cliente = clienteDe(a);
  const estado = { minutos: 15 };
  const novaHora = (m) => util.minParaHora(Math.min(min(a.horaInicio) + m, 23 * 60 + 59));
  const chips = '<div class="chips-escolha" role="group" aria-label="Atraso">' + ATRASOS_RAPIDOS.map((m) =>
    '<button type="button" class="chip chip-escolha" data-acao="escolher-atraso" data-valor="' + m + '" aria-pressed="' + (m === estado.minutos ? 'true' : 'false') + '"' + (m === estado.minutos ? ' data-ativo' : '') + '>' + m + ' min</button>'
  ).join('') + '</div>';
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Avisar atraso',
    corpo: '<p class="mudo">' + esc(tituloServico(a) + ', marcado para ' + a.horaInicio) + (cliente && cliente.telefone ? '. O WhatsApp abre com a mensagem pronta.' : '') + '</p>' +
      '<div class="campo mt3"><span class="campo-rotulo">Quanto</span>' + chips + '</div>' +
      ui.campo({ id: 'at-hora', rotulo: 'Novo horário previsto', tipo: 'time', valor: novaHora(estado.minutos), atributos: 'data-campo="novaHora"' }) +
      '<p class="msg-erro-campo" data-erro hidden></p>',
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="confirmar-atraso">Avisar' + (cliente && cliente.telefone ? ' e abrir WhatsApp' : '') + '</button>'
  });
  const inputHora = el.querySelector('[data-campo="novaHora"]');
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'escolher-atraso') {
      estado.minutos = Number(alvo.getAttribute('data-valor'));
      marcarChipEscolhido(el, '[data-acao="escolher-atraso"]', String(estado.minutos));
      inputHora.value = novaHora(estado.minutos);
    } else if (acao === 'confirmar-atraso') {
      const hora = inputHora.value || null;
      const minutos = hora ? Math.max(1, min(hora) - min(a.horaInicio)) : estado.minutos;
      if (!minutos || minutos < 1) { mostrarErroSheet(el, '[data-erro]', 'Escolha um atraso ou um novo horário depois do início.'); return; }
      const atrasoAvisado = { minutos, novaHora: hora, por: u.id, quando: agora() };
      const texto = 'Olá, sou da Green Decor. Vamos atrasar cerca de ' + minutos + ' minutos para a ' + nomeTipo(a) + ' das ' + a.horaInicio + '. Obrigado pela compreensão.';
      repo.transacao(() => {
        const novo = repo.atualizar('agendamentos', id, { atrasoAvisado });
        auditarServico(novo, 'atraso_avisado', { motivo: minutos + ' min' + (hora ? ', novo horário ' + hora : '') });
        avisar('atraso', 'Atraso avisado', nomeCurtoDe(u.nome) + ' avisou atraso de ' + minutos + ' min: ' + descricaoNotif(novo), gestores().concat(a.criadoPor), novo);
      });
      fechar();
      ui.toast('Atraso registrado');
      if (cliente && cliente.telefone) whatsapp(id, texto);
    }
  });
  inputHora.addEventListener('change', () => { marcarChipEscolhido(el, '[data-acao="escolher-atraso"]', ''); });
}

/* ---- Checklist em sheet, menu rápido, mais blocos ---- */

/** Checklist em sheet (a partir do cartão de Meu dia). @param {string} id */
export function abrirChecklist(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const editavel = regras.acoesDisponiveis(a, u).checklist;
  const { el } = ui.abrirSheet({
    titulo: 'Checklist',
    corpo: '<p class="mudo">' + esc(tituloServico(a)) + '</p><div class="mt3" data-parte="checklist">' + checklistHTML(a, { editavel }) + '</div>',
    rodape: '<button type="button" class="btn btn-secundario" data-acao="ui:fechar-sheet">Fechar</button>'
  });
  ligarChecklist(el, id, (acao) => {
    if (acao === 'alternar-check') {
      const atual = servico(id);
      const parte = el.querySelector('[data-parte="checklist"]');
      if (atual && parte) parte.innerHTML = checklistHTML(atual, { editavel });
    } else if (!ui.sheetAberto()) {
      abrirChecklist(id);
    }
  });
}

/** Menu rápido do bloco (7.3): abrir, reagendar ou mover para, ligar, rota, compartilhar, próximo passo. @param {string} id */
export function abrirMenuRapido(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  const acoes = regras.acoesDisponiveis(a, u);
  const passo = regras.proximoPasso(a, u);
  const itens = [itemMenu('abrir', id, 'direita', 'Abrir')];
  if (passo) itens.push(itemMenu('passo', id, dados.STATUS[passo.para] ? dados.STATUS[passo.para].icone : 'check', passo.rotulo));
  if (acoes.reagendar) itens.push(itemMenu('reagendar', id, 'sincronizar', 'Reagendar'));
  itens.push(itemMenu('ligar', id, 'telefone', 'Ligar'));
  if (!a.enderecoAConfirmar && a.endereco) itens.push(itemMenu('rota', id, 'mapa', 'Rota'));
  itens.push(itemMenu('compartilhar', id, 'compartilhar', 'Compartilhar'));
  const { el, fechar } = ui.abrirSheet({
    titulo: tituloServico(a),
    corpo: '<p class="mudo">' + esc(util.fmtDataMedia(a.data) + ', ' + util.fmtIntervalo(a.horaInicio, a.horaFim)) + '</p><div class="lista sheet-lista-acoes menu-acoes mt2">' + itens.join('') + '</div>'
  });
  ui.delegar(el, '[data-acao]', 'click', (acao) => {
    if (acao.startsWith('ui:')) return;
    fechar();
    executarAcao(acao, id, { para: passo ? passo.para : null });
  });
}

/** Sheet "+N" com a lista de cartões de um cluster. @param {string[]} ids */
export function abrirMaisBlocos(ids) {
  const u = usuarioAtual();
  const lista = (ids || []).map(servico).filter((a) => a && dados.visivel(a, u));
  if (!lista.length) return;
  const { el, fechar } = ui.abrirSheet({
    titulo: plural(lista.length, 'serviço neste horário', 'serviços neste horário'),
    corpo: lista.map((a) => cartaoServico(a, { variante: 'lista' })).join('')
  });
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao.startsWith('ui:')) return;
    fechar();
    executarAcao(acao, alvo.getAttribute('data-id'));
  });
}

/* ---- Trocar carro ---- */

/** Sheet de trocar carro (9.1): outros veículos com estado no intervalo; aplica como edição com conflito. @param {string} id */
export function abrirTrocarCarro(id) {
  const a = servico(id);
  const u = usuarioAtual();
  if (!a || !u) return;
  if (!regras.acoesDisponiveis(a, u).trocarCarro) { ui.toast('Você não pode trocar o carro deste serviço', 'erro'); return; }
  const tipo = tipoDe(a);
  const c = candidatoDe(a);
  const t = { escolhido: false, justificativa: '', pedido: '' };
  const disp = disponibilidadeDe(c);
  const atual = veiculoDe(a);
  const cartoes = dados.veiculosAtivos().filter((v) => v.id !== a.veiculoId).map((v) => cartaoCarroHTML(v, disp.veiculos[v.id] || { estado: 'livre', comTexto: 'Livre' }, false, 'trocar-para')).join('');
  const semCarro = a.veiculoId && (!tipo || tipo.precisaVeiculo !== 'sim')
    ? '<button type="button" class="cartao-carro" data-acao="trocar-para" data-id="" aria-pressed="false"><span class="item-icone">' + icone('x', 18) + '</span><div class="cartao-carro-corpo"><div class="cartao-carro-nome">Sem carro</div><div class="cartao-carro-estado">Este serviço pode sair sem carro</div></div></button>'
    : '';
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Trocar carro',
    corpo: '<p class="mudo">' + esc(tituloServico(a) + ', ' + util.fmtDataMedia(a.data) + ', ' + util.fmtIntervalo(a.horaInicio, a.horaFim)) + (atual ? '. Hoje com a ' + esc(atual.apelido || atual.nome) : '. Hoje sem carro') + '</p>' +
      '<div class="trocar-carro-lista mt3" role="group" aria-label="Carro">' + cartoes + semCarro + '</div>' +
      '<div data-parte="faixa" class="mt3"></div><p class="msg-erro-campo" data-erro hidden></p>',
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="confirmar-troca" disabled>Trocar</button>'
  });
  const botao = el.querySelector('[data-acao="confirmar-troca"]');
  const analisar = () => analisarConflitos(c, u, t, a);
  const atualizarFaixa = () => {
    const analise = analisar();
    trocarFaixa(el.querySelector('[data-parte="faixa"]'), faixaConflitoHTML(analise, u, t));
    botao.disabled = !t.escolhido || !!analise.decisao.erro;
    botao.textContent = analise.decisao.modo === 'justificar' && !analise.coberto ? 'Trocar com justificativa' : analise.decisao.modo === 'pedir' && !analise.coberto ? 'Pedir liberação' : 'Trocar';
    mostrarErroSheet(el, '[data-erro]', '');
  };
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'trocar-para') {
      const novoId = alvo.getAttribute('data-id') || null;
      c.veiculoId = novoId;
      c.semCarroConfirmado = !novoId;
      t.escolhido = true;
      el.querySelectorAll('[data-acao="trocar-para"]').forEach((k) => {
        const ativo = k === alvo;
        k.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        if (ativo) k.setAttribute('data-ativo', ''); else k.removeAttribute('data-ativo');
      });
      atualizarFaixa();
    } else if (acao === 'aplicar-alternativa') {
      const analise = analisar();
      const alt = analise.alternativas.find((x) => x.id === alvo.getAttribute('data-valor'));
      if (alt && alt.mudancas.veiculoId !== undefined && Object.keys(alt.mudancas).every((k) => k === 'veiculoId' || k === 'semCarroConfirmado')) {
        Object.assign(c, alt.mudancas);
        t.escolhido = true;
        el.querySelectorAll('[data-acao="trocar-para"]').forEach((k) => {
          const ativo = (k.getAttribute('data-id') || null) === (c.veiculoId || null);
          k.setAttribute('aria-pressed', ativo ? 'true' : 'false');
          if (ativo) k.setAttribute('data-ativo', ''); else k.removeAttribute('data-ativo');
        });
        atualizarFaixa();
      } else {
        ui.toast('Essa alternativa muda horário ou equipe: use Editar', 'info');
      }
    } else if (acao === 'confirmar-troca') {
      const r = salvarServico(Object.assign({}, servico(id), { veiculoId: c.veiculoId, semCarroConfirmado: c.semCarroConfirmado }), { id, justificativa: t.justificativa, pedirLiberacao: t.pedido });
      if (!r.ok) { mostrarErroSheet(el, '[data-erro]', r.erros[0].mensagem); return; }
      const v = c.veiculoId ? dados.veiculoPorId(c.veiculoId) : null;
      ui.toast(v ? 'Trocado para a ' + (v.apelido || v.nome) : 'Serviço sem carro');
      fechar();
    }
  });
  ui.delegar(el, '[data-campo]', 'input', (acao, alvo) => {
    const campo = alvo.getAttribute('data-campo');
    if (campo === 'justificativa') t.justificativa = alvo.value;
    if (campo === 'pedido') t.pedido = alvo.value;
    const analise = analisar();
    botao.disabled = !t.escolhido || !!analise.decisao.erro;
  });
}

/** Abre #/servico/novo?origem=id com os campos copiados (6.7). @param {string} id @param {{data?:string}} [opcoes] */
export function duplicar(id, opcoes = {}) {
  const a = servico(id);
  if (!a) return;
  if (!dados.pode('criarServico')) { ui.toast('Você não pode criar serviços', 'erro'); return; }
  ui.irPara('#/servico/novo' + ui.montarQuery({ origem: id, data: opcoes.data || '' }));
}

/* ================================================================== */
/* Checklist e ordem de rota (6.7)                                     */
/* ================================================================== */

function alternarItem(id, itemId, comDesfazer) {
  const u = usuarioAtual();
  const a = servico(id);
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado' };
  if (!regras.acoesDisponiveis(a, u).checklist) return { ok: false, erro: 'Você não pode alterar este checklist' };
  const item = (a.checklist || []).find((k) => k.id === itemId);
  if (!item) return { ok: false, erro: 'Item não encontrado' };
  const feito = !item.feito;
  const checklist = a.checklist.map((k) => (k.id === itemId ? Object.assign({}, k, feito ? { feito: true, por: u.id, quando: agora() } : { feito: false, por: null, quando: null }) : k));
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, { checklist });
    auditarServico(novo, 'checklist_alterado', { motivo: (feito ? 'Concluído: ' : 'Reaberto: ') + item.texto });
  });
  if (comDesfazer && feito) {
    ui.toastDesfazer('Item concluído', { ms: 5000, aoDesfazer: () => alternarItem(id, itemId, false) });
  } else {
    ui.anunciar(feito ? 'Item concluído' : 'Item reaberto');
  }
  return { ok: true };
}

/** Alterna item; grava por e quando ao marcar, limpa ao desmarcar; audita; toast com desfazer 5 s. @param {string} id @param {string} itemId */
export function alternarChecklist(id, itemId) {
  const r = alternarItem(id, itemId, true);
  if (!r.ok) ui.toast(r.erro, 'erro');
  return r;
}

/** @param {string} id @param {string} texto Efeitos: grava item avulso, audita. */
export function novoItemChecklist(id, texto) {
  const u = usuarioAtual();
  const a = servico(id);
  const t = String(texto || '').trim();
  if (!a || !u || !t) return { ok: false, erro: 'Descreva o item' };
  if (!regras.acoesDisponiveis(a, u).checklist) { ui.toast('Você não pode alterar este checklist', 'erro'); return { ok: false, erro: 'Sem permissão' }; }
  const item = { id: util.uid('k'), texto: t, feito: false, por: null, quando: null, obs: '' };
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, { checklist: (a.checklist || []).concat(item) });
    auditarServico(novo, 'checklist_alterado', { motivo: 'Item adicionado: ' + t });
  });
  ui.toast('Item adicionado');
  return { ok: true, item };
}

/** @param {string} id @param {string} itemId @param {string} obs Efeitos: grava, audita. */
export function obsChecklist(id, itemId, obs) {
  const u = usuarioAtual();
  const a = servico(id);
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado' };
  if (!regras.acoesDisponiveis(a, u).checklist) { ui.toast('Você não pode alterar este checklist', 'erro'); return { ok: false, erro: 'Sem permissão' }; }
  const item = (a.checklist || []).find((k) => k.id === itemId);
  if (!item) return { ok: false, erro: 'Item não encontrado' };
  const texto = String(obs || '').trim();
  repo.transacao(() => {
    const novo = repo.atualizar('agendamentos', id, { checklist: a.checklist.map((k) => (k.id === itemId ? Object.assign({}, k, { obs: texto }) : k)) });
    auditarServico(novo, 'checklist_alterado', { motivo: 'Observação em "' + item.texto + '": ' + texto });
  });
  ui.toast('Observação salva');
  return { ok: true };
}

/** Grava ordemRota = índice + 1 na lista dada; audita rota_reordenada uma vez. @param {string[]} ids na nova ordem */
export function definirOrdemRota(ids) {
  const u = usuarioAtual();
  if (!u || !ids || !ids.length) return { ok: false, erro: 'Nada para ordenar' };
  const permitidos = [];
  ids.forEach((id, i) => {
    const a = servico(id);
    if (a && regras.acoesDisponiveis(a, u).reordenarRota) permitidos.push({ a, ordem: i + 1 });
  });
  if (!permitidos.length) return { ok: false, erro: 'Você não pode reordenar esta rota' };
  const mudados = permitidos.filter((p) => p.a.ordemRota !== p.ordem);
  if (!mudados.length) return { ok: true, alterados: 0 };
  repo.transacao(() => {
    for (const p of mudados) repo.atualizar('agendamentos', p.a.id, { ordemRota: p.ordem });
    const primeiro = permitidos[0].a;
    dados.auditar({
      acao: 'rota_reordenada', entidade: 'agendamento', entidadeId: primeiro.id,
      rotulo: 'Rota de ' + util.fmtData(primeiro.data).slice(0, 5) + ': ' + permitidos.map((p) => p.ordem + '. ' + tituloServico(p.a)).join('; '),
      campos: null, motivo: null, setorId: primeiro.setorId
    });
  });
  return { ok: true, alterados: mudados.length };
}

/* ================================================================== */
/* Contato e rota (8.7 a 8.9)                                          */
/* ================================================================== */

/** Texto de compartilhamento (8.7). @param {string} id @returns {string} */
export function textoCompartilhamento(id) {
  const a = servico(id);
  if (!a) return '';
  const cliente = clienteDe(a);
  const veiculo = veiculoDe(a);
  const equipe = equipeDe(a);
  const partes = [nomeTipo(a) + ', ' + util.fmtDataExtensa(a.data) + ', ' + util.fmtIntervalo(a.horaInicio, a.horaFim) + '.'];
  if (cliente) partes.push('Cliente: ' + cliente.nome + (cliente.telefone ? ', ' + util.telFmt(cliente.telefone) : '') + '.');
  partes.push('Endereço: ' + (a.enderecoAConfirmar || !a.endereco ? 'a confirmar' : util.enderecoTexto(a.endereco)) + '.');
  if (veiculo) partes.push('Carro: ' + veiculo.nome + (veiculo.placa ? ' (' + veiculo.placa + ')' : '') + '.');
  if (equipe) partes.push('Equipe: ' + (equipe.apelido || equipe.nome) + '.');
  const nomes = nomesCurtos(a.responsaveis || []);
  if (nomes.length) partes.push('Responsáveis: ' + nomes.join(', ') + '.');
  if (a.obs) partes.push('Obs: ' + a.obs);
  const base = String(location.href || '').split('#')[0];
  partes.push('Abrir no app: ' + base + '#/servico/' + a.id);
  return partes.join(' ');
}

/** navigator.share ou área de transferência com toast. @param {string} id @returns {Promise<void>} */
export async function compartilhar(id) {
  const a = servico(id);
  if (!a) return;
  const texto = textoCompartilhamento(id);
  if (navigator.share) {
    try { await navigator.share({ title: tituloServico(a), text: texto }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const ok = await copiarTexto(texto);
  ui.toast(ok ? 'Copiado' : 'Não foi possível copiar', ok ? 'ok' : 'erro');
}

/** Google Maps em modo direções (8.9). @param {string} id */
export function abrirRota(id) {
  const a = servico(id);
  if (!a) return;
  if (a.enderecoAConfirmar || !a.endereco || !a.endereco.logradouro) { ui.toast('Endereço a confirmar com o cliente', 'erro'); return; }
  abrirJanela('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(util.enderecoTexto(a.endereco)) + '&travelmode=driving');
}

/** tel: normalizado (8.8). @param {string} id */
export function ligar(id) {
  const a = servico(id);
  const cliente = clienteDe(a);
  if (!cliente || !util.telDigitos(cliente.telefone)) { ui.toast('Cliente sem telefone', 'erro'); return; }
  location.href = util.telHref(cliente.telefone);
}

/** wa.me com mensagem padrão ou a informada (8.8). @param {string} id @param {string} [mensagem] */
export function whatsapp(id, mensagem) {
  const a = servico(id);
  const cliente = clienteDe(a);
  if (!cliente || !util.telDigitos(cliente.telefone)) { ui.toast('Cliente sem telefone', 'erro'); return; }
  const texto = mensagem || ('Olá, sou da Green Decor. Estou a caminho para a ' + nomeTipo(a) + ' das ' + a.horaInicio + '.');
  abrirJanela(util.waHref(cliente.telefone, texto));
}

/** Copia o endereço completo e mostra toast. @param {string} id @returns {Promise<void>} */
export async function copiarEndereco(id) {
  const a = servico(id);
  if (!a) return;
  if (a.enderecoAConfirmar || !a.endereco) { ui.toast('Endereço a confirmar com o cliente', 'info'); return; }
  const ok = await copiarTexto(util.enderecoTexto(a.endereco));
  ui.toast(ok ? 'Endereço copiado' : 'Não foi possível copiar', ok ? 'ok' : 'erro');
}

/**
 * URL da rota do dia (8.9): origem na loja, paradas ativas com endereço na ordem de rota, até 9.
 * @param {object[]} lista agendamentos do dia @returns {{url:string, paradas:number, cortadas:number}}
 */
export function urlRotaDoDia(lista) {
  const ordem = (x, y) => {
    const ox = x.ordemRota == null ? Infinity : x.ordemRota;
    const oy = y.ordemRota == null ? Infinity : y.ordemRota;
    return ox - oy || String(x.horaInicio || '').localeCompare(String(y.horaInicio || ''));
  };
  const paradas = (lista || [])
    .filter((a) => a && regras.statusAtivo(a.status) && !a.enderecoAConfirmar && a.endereco && a.endereco.logradouro)
    .sort(ordem);
  const usadas = paradas.slice(0, MAX_PARADAS_MAPS);
  if (!usadas.length) return { url: '', paradas: 0, cortadas: 0 };
  const loja = (repo.config().loja || {}).endereco || '';
  const enderecos = usadas.map((a) => util.enderecoTexto(a.endereco));
  const destino = enderecos[enderecos.length - 1];
  const intermediarias = enderecos.slice(0, -1);
  let url = 'https://www.google.com/maps/dir/?api=1';
  if (loja) url += '&origin=' + encodeURIComponent(loja);
  url += '&destination=' + encodeURIComponent(destino);
  if (intermediarias.length) url += '&waypoints=' + intermediarias.map(encodeURIComponent).join('%7C');
  url += '&travelmode=driving';
  return { url, paradas: usadas.length, cortadas: paradas.length - usadas.length };
}
