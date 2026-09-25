/* Green Agenda, módulo regras: src/regras.js
   Regras de negócio puras: transições de status, conflitos, disponibilidade,
   régua de slots, sugestões e alternativas, horário de funcionamento,
   escala, estado derivado de veículo e equipe, atraso, alertas de operação,
   "Precisa de atenção" e lanes da grade. Lê dados pelo módulo dados; nunca
   toca o DOM. Só grava numa função, aplicarStatusSimples (DIRECAO-2 6.2),
   que resolve a menor cadeia de transições numa transação e audita cada
   passo; todo o resto é leitura.
   Esquema v4 (docs/redesign/DIRECAO-3.md, 2.2 e 3.4): presença efetiva de
   uma pessoa no dia com precedência (serviço agora, check-in, folga, nada),
   pessoas de turno e quem ainda não avisou.
   Esquema v3 (docs/redesign/DIRECAO-2.md, 2.3 e 6.2): período vira hora pelas
   faixas do dia (horasDoPeriodo), registro com hora aproximada nunca bloqueia
   (o conflito dele cai para aviso), status enxuto com um toque.
   Esquema v2 (docs/redesign/DIRECAO.md, 4.1 a 4.7 e 5.2): faixas de horário
   por dia com exceções por data, folga antes e depois para carro, pessoa e
   equipe, antecedência mínima, janela de agendamento, limite por dia,
   horários livres calculados, dias com vaga e rodízio de recursos.
   Referência no v1 (app/index.html): acoesStatusHTML 3218 a 3231 (fluxo de
   status), detectarConflitos 3410 a 3421, sugerirHorario 3422 a 3429,
   conflitosAtivos 1950 a 1962, servicosAtrasados 1935, faixaHorasDia 2896 a
   2903, lanesDe 2904 a 2919, escalaDe/estaDeServico 5143 a 5153,
   horarioDoSetorOuGeral 5158 a 5161, agendaDoRecurso 4352.
   Ver ESPECIFICACAO.md, seção 6 inteira e 7.3. */

import * as util from './util.js';
import * as dados from './dados.js';

/* ---------------- Apoio interno ---------------- */

const DIAS_CHAVE = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ESCALA_PADRAO = { seg_sex: { de: '08:00', ate: '18:00' }, sab: { de: '08:30', ate: '12:30' }, dom: null, folgas: [] };
const PESO_SEVERIDADE = { bloqueio: 3, conflito: 2, aviso: 1 };
const STATUS_RESERVA = ['aguardando_conf', 'confirmado', 'reagendado'];
const STATUS_ATRASO_INICIO = ['aguardando_conf', 'confirmado', 'reagendado', 'a_caminho'];
const STATUS_ATE_CONFIRMADO = ['aguardando_conf', 'confirmado', 'reagendado'];
const MINUTOS_DIA = 24 * 60;

/* Motivos que nasceram na v2. A régua do formulário da v1 não os considera, para continuar como era. */
const MOTIVOS_V2 = new Set(['antecedencia', 'fora_janela', 'limite_dia', 'veiculo_fora_horario']);
/* Avisos que, mesmo sem ser conflito, tiram o horário da lista de livres (DIRECAO 4.1, 4.2 e 4.5). */
const AVISOS_QUE_OCUPAM = new Set(['sem_folga_deslocamento', 'limite_dia', 'folga', 'fora_escala', 'veiculo_fora_horario', 'fora_horario']);

/** Config viva com padrões para nunca falhar antes do seed. */
function cfg() {
  return Object.assign({
    horario: {}, horariosSetor: {}, feriados: [], excecoes: [], folgaDeslocamentoMin: 30,
    folgaAntesMin: null, folgaDepoisMin: null, antecedenciaMinMin: 120, janelaDias: 90, rodizio: 'menos_servicos',
    slotMin: 30, passoSugestaoMin: 15, duracaoPadraoMin: 90, atrasoInicioMin: 20, atrasoFimMin: 30
  }, dados.repo.config() || {});
}

const numeroOu = (...valores) => { for (const v of valores) if (typeof v === 'number' && !Number.isNaN(v) && v >= 0) return v; return 0; };
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

const min = (hora) => util.horaParaMin(hora);
const nomeUsuario = (id) => { const u = dados.usuarioPorId(id); return u ? u.nome : String(id || ''); };
const { nomeCurto, unicos } = util;
const primeiroNomeDe = (id) => nomeCurto(nomeUsuario(id));
const apelidoEquipe = (id) => { const e = dados.equipePorId(id); return e ? (e.nome || e.apelido) : String(id || ''); };
const apelidoVeiculo = (id) => { const v = dados.veiculoPorId(id); return v ? (v.apelido || v.nome) : String(id || ''); };
/* Os pares id mais texto (DIRECAO-2 2.2): tipo cadastrado ou texto livre, cliente cadastrado ou nome solto. */
const nomeTipo = (a) => dados.nomeDoServico(a);
const nomeCliente = (a) => dados.nomeDoCliente(a);
const membrosDe = (equipeId) => { const e = equipeId ? dados.equipePorId(equipeId) : null; return e ? (e.membros || []).slice() : []; };
const aproximado = (a) => !!(a && a.horaAproximada);

/** "Entrega, Tatiane Moraes, 08:30 às 10:00"; com hora aproximada, "Loja, tarde". Usado em comTexto e nos motivos de disponibilidade. */
export function descricaoCurta(a) {
  const periodo = aproximado(a) && dados.PERIODOS[a.periodo] && a.periodo !== 'hora' ? dados.PERIODOS[a.periodo].curto : null;
  const partes = [nomeTipo(a), nomeCliente(a), periodo || util.fmtIntervalo(a.horaInicio, a.horaFim)];
  return partes.filter(Boolean).join(', ');
}

function rotuloMotivoIndisponibilidade(i) {
  const m = dados.MOTIVOS_INDISPONIBILIDADE.find((x) => x.id === i.motivo);
  return i.detalhe || (m ? m.rotulo : 'Indisponível');
}

function ativosDoDia(iso, ignorarId) {
  return dados.agendamentosDoDia(iso).filter((a) => statusAtivo(a.status) && a.id !== ignorarId);
}

function indisponibilidadesCruzando(veiculoId, data, horaInicio, horaFim) {
  if (!veiculoId) return [];
  const ini = util.isoHora(data, horaInicio);
  const fim = util.isoHora(data, horaFim);
  return dados.indisponibilidadesDoVeiculo(veiculoId, data, data).filter((i) => i.de < fim && ini < i.ate);
}

function indisponibilidadeNoInstante(veiculoId, iso, hora) {
  const marca = util.isoHora(iso, hora);
  return dados.indisponibilidadesDoVeiculo(veiculoId, iso, iso).find((i) => i.de <= marca && marca < i.ate) || null;
}

function capitalizar(texto) {
  return texto ? texto[0].toUpperCase() + texto.slice(1) : '';
}

/* ---------------- Status ---------------- */

/**
 * Tabela de transições (6.2): { de: [{para, cap, exige:'motivo'|'reagendar'|'concluir'|'dataAteHoje'|null}] }.
 * 'dataAteHoje' implica motivo obrigatório e data <= hoje (6.7): vale para toda ida a nao_realizado.
 * Preenchida aqui porque é contrato.
 */
export const TRANSICOES = {
  aguardando_conf: [
    { para: 'confirmado', cap: 'confirmar', exige: null },
    { para: 'cancelado', cap: 'cancelar', exige: 'motivo' },
    { para: 'reagendado', cap: 'reagendar', exige: 'reagendar' }
  ],
  confirmado: [
    { para: 'a_caminho', cap: 'statusCampo', exige: null },
    { para: 'em_andamento', cap: 'statusCampo', exige: null },
    { para: 'cancelado', cap: 'cancelar', exige: 'motivo' },
    { para: 'reagendado', cap: 'reagendar', exige: 'reagendar' },
    { para: 'nao_realizado', cap: 'statusCampo', exige: 'dataAteHoje' }
  ],
  a_caminho: [
    { para: 'em_andamento', cap: 'statusCampo', exige: null },
    { para: 'nao_realizado', cap: 'statusCampo', exige: 'dataAteHoje' },
    { para: 'reagendado', cap: 'reagendar', exige: 'reagendar' }
  ],
  em_andamento: [
    { para: 'concluido', cap: 'statusCampo', exige: 'concluir' },
    { para: 'nao_realizado', cap: 'statusCampo', exige: 'dataAteHoje' }
  ],
  reagendado: [
    { para: 'confirmado', cap: 'confirmar', exige: null },
    { para: 'cancelado', cap: 'cancelar', exige: 'motivo' },
    { para: 'reagendado', cap: 'reagendar', exige: 'reagendar' }
  ],
  concluido: [
    { para: 'em_andamento', cap: 'reabrir', exige: 'motivo' }
  ],
  cancelado: [],
  nao_realizado: []
};

/** Próximo passo natural a partir de cada status (o botão primário). */
const PROXIMO = { aguardando_conf: 'confirmado', confirmado: 'a_caminho', a_caminho: 'em_andamento', em_andamento: 'concluido', reagendado: 'confirmado' };

/** @param {string} status @returns {boolean} está em STATUS_ATIVOS */
export function statusAtivo(status) {
  return dados.STATUS_ATIVOS.includes(status);
}

/** @param {string} status @returns {boolean} está em STATUS_FINAIS */
export function statusFinal(status) {
  return dados.STATUS_FINAIS.includes(status);
}

/** A pessoa é responsável ou membro da equipe alocada. */
function pessoaNoServico(agendamento, usuario) {
  return !!usuario && expandirPessoas(agendamento).has(usuario.id);
}

/**
 * Capacidade no serviço, aplicando os modificadores: 'meus', 'propria' e 'proprios' exigem a pessoa no serviço,
 * 'ateConfirmado' exige status aguardando_conf, confirmado ou reagendado. Sempre exige visibilidade.
 * @returns {{ok:boolean, motivo?:string}}
 */
function capNoServico(cap, agendamento, usuario) {
  const valor = dados.pode(cap, usuario);
  if (!valor) return { ok: false, motivo: 'Você não tem permissão para esta ação' };
  if (!dados.visivel(agendamento, usuario)) return { ok: false, motivo: 'Serviço fora do seu setor' };
  if ((valor === 'meus' || valor === 'propria' || valor === 'proprios') && !pessoaNoServico(agendamento, usuario)) {
    return { ok: false, motivo: 'Só nos serviços em que você está alocado' };
  }
  if (valor === 'ateConfirmado' && !STATUS_ATE_CONFIRMADO.includes(agendamento.status)) {
    return { ok: false, motivo: 'Depois de sair para o serviço, só a gestão altera' };
  }
  return { ok: true };
}

/**
 * Verifica tabela, capacidade (com modificadores 'meus', 'ateConfirmado') e a regra data <= hoje.
 * @param {object} agendamento @param {string} para @param {object} usuario
 * @returns {{ok:boolean, motivo?:string, exige?:string|null}}
 */
export function podeTransitar(agendamento, para, usuario) {
  if (!agendamento || !usuario) return { ok: false, motivo: 'Serviço ou usuário ausente' };
  const regra = (TRANSICOES[agendamento.status] || []).find((t) => t.para === para);
  if (!regra) return { ok: false, motivo: 'Transição não permitida a partir de ' + ((dados.STATUS[agendamento.status] || {}).rotulo || agendamento.status).toLowerCase() };
  const cap = capNoServico(regra.cap, agendamento, usuario);
  if (!cap.ok) return { ok: false, motivo: cap.motivo, exige: regra.exige };
  if ((regra.exige === 'dataAteHoje' || para === 'nao_realizado') && agendamento.data > util.hojeISO()) {
    return { ok: false, motivo: 'Só é possível marcar como não realizado a partir da data do serviço', exige: regra.exige };
  }
  if (para === 'nao_realizado' && !jaComecou(agendamento)) {
    return { ok: false, motivo: 'Só depois da hora de início, às ' + (agendamento.horaInicio || '00:00'), exige: regra.exige };
  }
  return { ok: true, exige: regra.exige };
}

/**
 * O serviço já começou (DIRECAO 4.10): não realizado só depois da hora de início, não só depois do dia.
 * Registro por período (horaAproximada) vale o dia inteiro, porque 13:30 é hora derivada, não combinada.
 * Não olha o status de propósito: as buscas de cadeia simulam status intermediários (a_caminho) e um
 * "já saiu" lido dali abriria a porta antes da hora.
 * @param {object} a @returns {boolean}
 */
export function jaComecou(a) {
  if (!a || !a.data) return false;
  const hoje = util.hojeISO();
  if (a.data < hoje) return true;
  if (a.data > hoje) return false;
  if (a.horaAproximada) return true;
  return util.agoraMin() >= util.horaParaMin(a.horaInicio || '00:00');
}

/** Rótulo do botão de uma transição: verbo do campo para o perfil campo, rótulo de ação para os demais. */
function rotuloTransicao(agendamento, para, usuario) {
  const ehCampo = !!usuario && usuario.perfil === 'campo';
  const de = dados.STATUS[agendamento.status] || {};
  if (PROXIMO[agendamento.status] === para) return (ehCampo && de.verboCampo) || de.rotuloAcao || (dados.STATUS[para] || {}).rotulo || para;
  if (agendamento.status === 'confirmado' && para === 'em_andamento') return ehCampo ? 'Cheguei, comecei' : 'Iniciar';
  if (agendamento.status === 'concluido' && para === 'em_andamento') return 'Reabrir';
  return { cancelado: 'Cancelar', reagendado: 'Reagendar', nao_realizado: 'Não realizado', concluido: ehCampo ? 'Terminei' : 'Concluir' }[para]
    || (dados.STATUS[para] || {}).rotulo || para;
}

/** Transições permitidas ao usuário a partir do status atual. @param {object} agendamento @param {object} usuario @returns {{para:string, rotulo:string, exige:string|null}[]} */
export function transicoesDe(agendamento, usuario) {
  if (!agendamento) return [];
  return (TRANSICOES[agendamento.status] || [])
    .filter((t) => podeTransitar(agendamento, t.para, usuario).ok)
    .map((t) => ({ para: t.para, rotulo: rotuloTransicao(agendamento, t.para, usuario), exige: t.exige }));
}

/**
 * O único botão primário: próximo passo natural (confirmar, a_caminho, em_andamento, concluido) permitido ao usuário.
 * @param {object} agendamento @param {object} usuario @returns {{para:string, rotulo:string, exige:string|null}|null} rótulo = verboCampo para perfil campo, rotuloAcao para os demais
 */
export function proximoPasso(agendamento, usuario) {
  if (!agendamento) return null;
  const para = PROXIMO[agendamento.status];
  if (!para) return null;
  const r = podeTransitar(agendamento, para, usuario);
  if (!r.ok) return null;
  return { para, rotulo: rotuloTransicao(agendamento, para, usuario), exige: r.exige || null };
}

/* ---------------- Status enxuto com um toque (DIRECAO-2 6.2) ---------------- */

/**
 * Concluir precisa da folha de conclusão (checklist, observação, assinatura) quando o registro é despacho de loja,
 * o tipo pede assinatura ou há item de checklist por fazer. Registro rápido sem nada disso conclui direto.
 * @param {object} a @returns {boolean}
 */
export function exigeFolhaDeConclusao(a) {
  if (!a) return false;
  if (a.origem === 'loja') return true;
  const t = a.tipoId ? dados.tipoPorId(a.tipoId) : null;
  if (t && t.pedeAssinatura) return true;
  return (a.checklist || []).some((k) => !k.feito);
}

const ACAO_AUDITORIA_STATUS = (antes, para) => {
  if (para === 'cancelado') return 'servico_cancelado';
  if (para === 'nao_realizado') return 'servico_nao_realizado';
  if (para === 'concluido') return 'servico_concluido';
  if (antes === 'concluido' && para === 'em_andamento') return 'servico_reaberto';
  return 'status_alterado';
};

/* O status interno em que cada estado simples "pousa" com um toque: Comecei vai a em_andamento (a_caminho é passagem),
   Agendado a confirmado. */
const POUSO_SIMPLES = { agendado: 'confirmado', em_andamento: 'em_andamento', concluido: 'concluido', nao_realizado: 'nao_realizado', cancelado: 'cancelado' };

/**
 * A menor cadeia de transições permitidas do status atual até um dos `alvos`. Busca em largura, nível a nível, sobre
 * TRANSICOES; entre alvos alcançados no mesmo nível vence `preferido`. Devolve `exigido` quando o único caminho pede
 * folha de conclusão ou motivo que não veio.
 */
function menorCadeia(a, alvos, preferido, usuario, opcoes) {
  const aceita = (regra) => {
    if (!regra.exige) return true;
    if (regra.exige === 'concluir') return !exigeFolhaDeConclusao(a) || !!opcoes.folhaPreenchida;
    if (regra.exige === 'motivo' || regra.exige === 'dataAteHoje') return !!(opcoes.motivo && opcoes.motivo.opcao);
    return false;
  };
  let nivel = [[a.status]];
  const vistos = new Set([a.status]);
  let exigido = null;
  while (nivel.length) {
    const proximo = [];
    const chegaram = [];
    for (const caminho of nivel) {
      const atual = caminho[caminho.length - 1];
      for (const regra of TRANSICOES[atual] || []) {
        if (vistos.has(regra.para)) continue;
        const simulado = Object.assign({}, a, { status: atual });
        if (!podeTransitar(simulado, regra.para, usuario).ok) continue;
        if (!aceita(regra)) { if (alvos.includes(regra.para) && !exigido) exigido = regra.exige; continue; }
        const novo = caminho.concat(regra.para);
        if (alvos.includes(regra.para)) { chegaram.push(novo); continue; }
        vistos.add(regra.para);
        proximo.push(novo);
      }
    }
    if (chegaram.length) {
      const escolhido = chegaram.find((c) => c[c.length - 1] === preferido) || chegaram[0];
      return { passos: escolhido.slice(1), exigido: null };
    }
    nivel = proximo;
  }
  return { passos: null, exigido };
}

/**
 * Existe cadeia permitida do status atual até o estado enxuto pedido, sem aplicar nada (DIRECAO-2 4.4). Serve para
 * habilitar ou desabilitar a opção do seletor e do botão de próximo passo, e para explicar o motivo em `title`, o que
 * aplicarStatusSimples só saberia depois de tentar. Passagem intermediária só por transição que não pede nada
 * (confirmar e iniciar na mesma transação, como 6.2 autoriza); reagendar e cancelar nunca são atalho.
 * @param {object} a @param {object} u @param {string} chave chave de dados.STATUS_SIMPLES
 * @returns {{ok:boolean, atual:boolean, exige:string|null, motivo:string}}
 */
export function caminhoSimples(a, u, chave) {
  if (!a || !u) return { ok: false, atual: false, exige: null, motivo: 'Serviço ou usuário ausente' };
  if (dados.statusSimples(a.status) === chave) return { ok: false, atual: true, exige: null, motivo: '' };
  const alvos = (dados.STATUS_SIMPLES[chave] || {}).inclui || [];
  const vistos = new Set([a.status]);
  let nivel = [a.status];
  let motivo = '';
  for (let passo = 0; passo < 3 && nivel.length; passo++) {
    const proximo = [];
    for (const de of nivel) {
      for (const regra of TRANSICOES[de] || []) {
        if (vistos.has(regra.para)) continue;
        const r = podeTransitar(Object.assign({}, a, { status: de }), regra.para, u);
        if (!r.ok) { if (alvos.includes(regra.para) && !motivo) motivo = r.motivo || ''; continue; }
        if (alvos.includes(regra.para)) return { ok: true, atual: false, exige: regra.exige || null, motivo: '' };
        if (regra.exige) continue;
        vistos.add(regra.para);
        proximo.push(regra.para);
      }
    }
    nivel = proximo;
  }
  return { ok: false, atual: false, exige: null, motivo: motivo || 'Não é possível a partir de ' + dados.rotuloSimples(a.status).toLowerCase() };
}

/**
 * Troca de status com um toque (DIRECAO-2 6.2): resolve a menor cadeia permitida por TRANSICOES até o status simples
 * pedido, grava tudo numa transação e audita cada passo. Agendado para Em andamento a partir de aguardando_conf ou
 * reagendado confirma e inicia na mesma transação; Em andamento para Concluído é direto quando exigeFolhaDeConclusao é
 * falso; Não realizado sempre precisa de motivo. Nada muda na tabela TRANSICOES e tudo passa por podeTransitar.
 * Não notifica nem mostra toast: devolve `notificar` para o chamador disparar depois da janela de desfazer, e
 * `antes` para agendamento.desfazerStatus.
 * @param {string} id
 * @param {string} destino chave de dados.STATUS_SIMPLES ('agendado', 'em_andamento', 'concluido', 'nao_realizado') ou um status interno
 * @param {object} [usuario] padrão: sessão
 * @param {{motivo?:{opcao:string, texto?:string}, folhaPreenchida?:boolean}} [opcoes] motivo para nao_realizado (e cancelado)
 * @returns {{ok:boolean, erro?:string, exige?:string|null, passos:{de:string, para:string}[], antes:string|null, agendamento:object|null, notificar:Function}}
 *   exige 'concluir' quando a folha de conclusão precisa abrir; 'motivo' quando falta o motivo
 */
export function aplicarStatusSimples(id, destino, usuario, opcoes = {}) {
  const u = usuario || dados.sessao.usuario();
  const a = dados.agendamentoPorId(id);
  const nada = () => {};
  if (!a || !u) return { ok: false, erro: 'Serviço não encontrado', exige: null, passos: [], antes: null, agendamento: null, notificar: nada };
  const simples = dados.STATUS_SIMPLES[destino];
  const alvos = simples ? simples.inclui : (dados.STATUS[destino] ? [destino] : null);
  if (!alvos) return { ok: false, erro: 'Status desconhecido', exige: null, passos: [], antes: a.status, agendamento: a, notificar: nada };
  if (alvos.includes(a.status)) return { ok: true, passos: [], antes: a.status, agendamento: a, exige: null, notificar: nada };
  const op = opcoes || {};
  const preferido = simples ? POUSO_SIMPLES[destino] : destino;
  const { passos, exigido } = menorCadeia(a, alvos, preferido, u, op);
  if (!passos) {
    if (exigido) {
      const erro = exigido === 'concluir' ? 'Este serviço conclui pela folha de conclusão' : exigido === 'reagendar' ? 'Use a ação Reagendar' : 'Informe o motivo';
      return { ok: false, erro, exige: exigido === 'dataAteHoje' ? 'motivo' : exigido, passos: [], antes: a.status, agendamento: a, notificar: nada };
    }
    const direto = podeTransitar(a, alvos[alvos.length - 1], u);
    return { ok: false, erro: direto.motivo || 'Transição não permitida', exige: null, passos: [], antes: a.status, agendamento: a, notificar: nada };
  }
  const motivo = op.motivo && op.motivo.opcao ? { opcao: op.motivo.opcao, texto: String(op.motivo.texto || '').trim() } : null;
  const rotuloMotivo = (lista) => {
    if (!motivo) return null;
    const item = lista.find((m) => m.id === motivo.opcao);
    const rotulo = item ? item.rotulo : motivo.opcao;
    return motivo.texto ? rotulo + ': ' + motivo.texto : rotulo;
  };
  const feitos = [];
  const depois = dados.repo.transacao(() => {
    let atual = a;
    for (const para of passos) {
      const agoraMs = Date.now();
      const mudancas = { status: para };
      let motivoTexto = null;
      if (para === 'nao_realizado') { mudancas.motivoNaoRealizado = Object.assign({}, motivo, { por: u.id, quando: agoraMs }); motivoTexto = rotuloMotivo(dados.MOTIVOS_NAO_REALIZADO); }
      if (para === 'cancelado') { mudancas.motivoCancelamento = Object.assign({}, motivo, { por: u.id, quando: agoraMs }); motivoTexto = rotuloMotivo(dados.MOTIVOS_CANCELAMENTO); }
      if (para === 'concluido') mudancas.concluidoEm = Math.max(util.msDe(atual.data, atual.horaInicio), Math.min(agoraMs, util.msDe(atual.data, '23:59')));
      if (atual.status === 'concluido' && para === 'em_andamento') { mudancas.concluidoEm = null; motivoTexto = rotuloMotivo(dados.MOTIVOS_REAGENDAMENTO) || (motivo && motivo.texto) || null; }
      const novo = dados.repo.atualizar('agendamentos', id, mudancas);
      dados.auditar({
        acao: ACAO_AUDITORIA_STATUS(atual.status, para), entidade: 'agendamento', entidadeId: id, userId: u.id,
        rotulo: descricaoCurta(novo), campos: dados.diffCampos(atual, novo, ['status']), motivo: motivoTexto, setorId: novo.setorId || null
      });
      feitos.push({ de: atual.status, para });
      atual = novo;
    }
    return atual;
  });
  const quem = nomeCurto(u.nome);
  const texto = descricaoCurta(depois);
  const notificar = () => {
    const destinatarios = dados.gestoresIds().concat(depois.criadoPor, depois.setorId ? dados.supervisoresDoSetor(depois.setorId) : []);
    const link = '#/servico/' + id;
    if (depois.status === 'em_andamento') dados.notificar({ tipo: 'status', titulo: a.status === 'concluido' ? 'Serviço reaberto' : 'Serviço iniciado', texto: quem + (a.status === 'concluido' ? ' reabriu ' : ' começou ') + texto, para: destinatarios, link });
    else if (depois.status === 'concluido') dados.notificar({ tipo: 'status', titulo: 'Serviço concluído', texto: quem + ' concluiu ' + texto, para: destinatarios, link });
    else if (depois.status === 'nao_realizado') dados.notificar({ tipo: 'status', titulo: 'Não realizado', texto: texto + (rotuloMotivo(dados.MOTIVOS_NAO_REALIZADO) ? '. ' + rotuloMotivo(dados.MOTIVOS_NAO_REALIZADO) : ''), para: destinatarios, link });
    else if (depois.status === 'confirmado') dados.notificar({ tipo: 'agenda', titulo: 'Serviço confirmado', texto, para: Array.from(expandirPessoas(depois)), link });
    else if (depois.status === 'cancelado') dados.notificar({ tipo: 'agenda', titulo: 'Serviço cancelado', texto, para: Array.from(expandirPessoas(depois)).concat(destinatarios), link });
  };
  return { ok: true, passos: feitos, antes: a.status, agendamento: depois, exige: null, notificar };
}

/**
 * Ações do menu "..." e dos cartões (8.4): editar, reagendar, cancelar, naoRealizado, concluir, duplicar, avisarAtraso, reabrir, liberar, trocarCarro, checklist.
 * @param {object} agendamento @param {object} usuario @returns {Object<string, boolean>}
 */
export function acoesDisponiveis(agendamento, usuario) {
  const vazio = { editar: false, reagendar: false, cancelar: false, naoRealizado: false, concluir: false, confirmar: false, duplicar: false, avisarAtraso: false, reabrir: false, liberar: false, trocarCarro: false, checklist: false, reordenarRota: false };
  if (!agendamento || !usuario) return vazio;
  const ativo = statusAtivo(agendamento.status);
  const editar = ativo && capNoServico('editarServico', agendamento, usuario).ok;
  const pendente = !!(agendamento.liberacao && agendamento.liberacao.estado === 'pendente');
  return {
    editar,
    reagendar: podeTransitar(agendamento, 'reagendado', usuario).ok,
    cancelar: podeTransitar(agendamento, 'cancelado', usuario).ok,
    naoRealizado: podeTransitar(agendamento, 'nao_realizado', usuario).ok,
    concluir: podeTransitar(agendamento, 'concluido', usuario).ok,
    confirmar: podeTransitar(agendamento, 'confirmado', usuario).ok,
    duplicar: statusFinal(agendamento.status) && !!dados.pode('criarServico', usuario) && dados.visivel(agendamento, usuario),
    avisarAtraso: ativo && capNoServico('avisarAtraso', agendamento, usuario).ok,
    reabrir: agendamento.status === 'concluido' && podeTransitar(agendamento, 'em_andamento', usuario).ok,
    liberar: pendente && ativo && !!dados.pode('liberarConflito', usuario) && dados.visivel(agendamento, usuario),
    trocarCarro: editar && !!dados.pode('alocarRecursos', usuario),
    checklist: ativo && capNoServico('checklist', agendamento, usuario).ok,
    reordenarRota: capNoServico('reordenarRota', agendamento, usuario).ok
  };
}

/* ---------------- Conflitos ---------------- */

/** Sobreposição estrita em minutos: ini1 < fim2 && ini2 < fim1. @param {number} ini1 @param {number} fim1 @param {number} ini2 @param {number} fim2 @returns {boolean} */
export function sobrepoe(ini1, fim1, ini2, fim2) {
  return ini1 < fim2 && ini2 < fim1;
}

/** Sobreposição entre dois agendamentos (ou candidatos) pelas horas. */
function sobrepoeAg(a, b) {
  return sobrepoe(min(a.horaInicio), min(a.horaFim), min(b.horaInicio), min(b.horaFim));
}

/** responsaveis união membros da equipe. @param {{responsaveis:string[], equipeId?:string|null}} a @returns {Set<string>} */
export function expandirPessoas(a) {
  const conjunto = new Set();
  if (!a) return conjunto;
  for (const id of a.responsaveis || []) if (id) conjunto.add(id);
  for (const id of membrosDe(a.equipeId)) conjunto.add(id);
  return conjunto;
}

function conflitoPessoa(id, outro) {
  return { recurso: 'pessoa', id, rotulo: primeiroNomeDe(id), motivo: 'sobreposicao', comId: outro.id, comTexto: descricaoCurta(outro), severidade: 'conflito' };
}

/** Regras 1 e 2: pessoas, equipe e veículo contra os agendamentos ativos sobrepostos. */
function conflitosDeSobreposicao(candidato, sobrepostos) {
  const lista = [];
  const pessoas = expandirPessoas(candidato);
  const membrosCand = new Set(membrosDe(candidato.equipeId));
  for (const outro of sobrepostos) {
    const mesmaEquipe = !!candidato.equipeId && outro.equipeId === candidato.equipeId;
    if (mesmaEquipe) {
      lista.push({ recurso: 'equipe', id: candidato.equipeId, rotulo: apelidoEquipe(candidato.equipeId), motivo: 'sobreposicao', comId: outro.id, comTexto: descricaoCurta(outro), severidade: 'conflito' });
    }
    const pessoasOutro = expandirPessoas(outro);
    for (const id of pessoas) {
      if (mesmaEquipe && membrosCand.has(id)) continue;
      if (pessoasOutro.has(id)) lista.push(conflitoPessoa(id, outro));
    }
  }
  for (const outro of sobrepostos) {
    if (candidato.veiculoId && outro.veiculoId === candidato.veiculoId) {
      lista.push({ recurso: 'veiculo', id: candidato.veiculoId, rotulo: apelidoVeiculo(candidato.veiculoId), motivo: 'sobreposicao', comId: outro.id, comTexto: descricaoCurta(outro), severidade: 'conflito' });
    }
  }
  return lista;
}

/** Regra 3: indisponibilidade do veículo cruzando o intervalo (bloqueio). */
function conflitosDeIndisponibilidade(candidato) {
  return indisponibilidadesCruzando(candidato.veiculoId, candidato.data, candidato.horaInicio, candidato.horaFim).map((i) => ({
    recurso: 'veiculo', id: candidato.veiculoId, rotulo: apelidoVeiculo(candidato.veiculoId), motivo: 'indisponivel',
    comId: i.id, comTexto: rotuloMotivoIndisponibilidade(i), severidade: 'bloqueio'
  }));
}

/** Regra 5: folga e escala de cada pessoa expandida (avisos). */
function conflitosDeEscala(candidato) {
  const lista = [];
  for (const id of expandirPessoas(candidato)) {
    const u = dados.usuarioPorId(id);
    if (!u) continue;
    const rotulo = nomeCurto(u.nome);
    if (emFolga(u, candidato.data)) {
      lista.push({ recurso: 'pessoa', id, rotulo, motivo: 'folga', comId: null, comTexto: rotulo + ' de folga', severidade: 'aviso' });
      continue;
    }
    const faixa = escalaDoDia(u, candidato.data);
    const dentro = faixa && min(candidato.horaInicio) >= min(faixa.de) && min(candidato.horaFim) <= min(faixa.ate);
    if (!dentro) {
      const texto = faixa ? rotulo + ' fora do turno (' + faixa.de + ' às ' + faixa.ate + ')' : rotulo + ' sem turno neste dia';
      lista.push({ recurso: 'pessoa', id, rotulo, motivo: 'fora_escala', comId: null, comTexto: texto, severidade: 'aviso' });
    }
  }
  return lista;
}

/** Regras 6 e 7: dia fechado (conflito) e fora do horário (aviso). */
function conflitosDeHorario(candidato) {
  const horario = horarioDoDia(candidato.data, candidato.setorId);
  if (!horario) {
    const fechado = motivoDiaFechado(candidato.data, candidato.setorId) || { rotulo: 'Dia fechado', texto: 'Loja fechada' };
    return [{ recurso: 'horario', id: null, rotulo: fechado.rotulo, motivo: 'dia_fechado', comId: null, comTexto: fechado.texto, severidade: 'conflito' }];
  }
  if (min(candidato.horaInicio) < min(horario.de) || min(candidato.horaFim) > min(horario.ate)) {
    return [{ recurso: 'horario', id: null, rotulo: 'Horário', motivo: 'fora_horario', comId: null, comTexto: 'Loja aberta das ' + horario.de + ' às ' + horario.ate, severidade: 'aviso' }];
  }
  return [];
}

/** Texto do aviso de folga curta: "só 10 min depois da Entrega da Tatiane (termina 12:00)". */
function textoFolgaCurta(outro, intervalo, outroVemAntes) {
  const quem = nomeTipo(outro) + (nomeCliente(outro) ? ' da ' + util.primeiroNome(nomeCliente(outro)) : '');
  if (intervalo === 0) {
    return outroVemAntes
      ? 'encosta na ' + quem + ', que termina às ' + outro.horaFim
      : 'encosta na ' + quem + ', que começa às ' + outro.horaInicio;
  }
  return outroVemAntes
    ? 'só ' + intervalo + ' min depois da ' + quem + ' (termina ' + outro.horaFim + ')'
    : 'só ' + intervalo + ' min antes da ' + quem + ' (começa ' + outro.horaInicio + ')';
}

/** Folga em minutos de um tipo, com recuo para a config: {antes, depois}. `c` é a config já lida. */
function folgaInterna(c, tipoId) {
  const t = tipoId ? dados.tipoPorId(tipoId) : null;
  return {
    antes: numeroOu(t && t.folgaAntesMin, c.folgaAntesMin, 0),
    depois: numeroOu(t && t.folgaDepoisMin, c.folgaDepoisMin, c.folgaDeslocamentoMin, 30)
  };
}

/**
 * Folga antes e depois de um serviço (DIRECAO 4.2): valor do tipo, com recuo para config.folgaAntesMin e
 * config.folgaDepoisMin (e, por último, para a folgaDeslocamentoMin da v1).
 * @param {string|object|null} tipoOuCandidato id do tipo, tipo, agendamento ou candidato (usa tipoId)
 * @returns {{antes:number, depois:number}} minutos
 */
export function folgaDe(tipoOuCandidato) {
  let tipoId = null;
  if (typeof tipoOuCandidato === 'string') tipoId = tipoOuCandidato;
  else if (tipoOuCandidato && tipoOuCandidato.tipoId) tipoId = tipoOuCandidato.tipoId;
  else if (tipoOuCandidato && tipoOuCandidato.id) tipoId = tipoOuCandidato.id;
  return folgaInterna(cfg(), tipoId);
}

/** Intervalo exigido entre dois serviços que dividem recurso: a folga depois de quem vem antes mais a folga antes de quem vem depois. */
function folgaExigida(folgaDoPrimeiro, folgaDoSegundo) {
  return folgaDoPrimeiro.depois + folgaDoSegundo.antes;
}

/**
 * Regra 8 (DIRECAO 4.2): outro serviço colado demais no mesmo carro, na mesma equipe ou com a mesma pessoa (aviso).
 * Um aviso por serviço vizinho, no recurso mais forte que os dois dividem (carro, depois equipe, depois pessoa).
 */
function conflitosDeDeslocamento(candidato, ativos, c) {
  const config = c || cfg();
  const pessoas = expandirPessoas(candidato);
  if (!candidato.veiculoId && !candidato.equipeId && !pessoas.size) return [];
  const lista = [];
  const ini = min(candidato.horaInicio);
  const fim = min(candidato.horaFim);
  const folgaCand = folgaInterna(config, candidato.tipoId);
  for (const outro of ativos) {
    if (sobrepoeAg(candidato, outro)) continue;
    let recurso = null;
    if (candidato.veiculoId && outro.veiculoId === candidato.veiculoId) {
      recurso = { recurso: 'veiculo', id: candidato.veiculoId, rotulo: apelidoVeiculo(candidato.veiculoId) };
    } else if (candidato.equipeId && outro.equipeId === candidato.equipeId) {
      recurso = { recurso: 'equipe', id: candidato.equipeId, rotulo: apelidoEquipe(candidato.equipeId) };
    } else if (pessoas.size) {
      const doOutro = expandirPessoas(outro);
      for (const id of pessoas) if (doOutro.has(id)) { recurso = { recurso: 'pessoa', id, rotulo: primeiroNomeDe(id) }; break; }
    }
    if (!recurso) continue;
    const oIni = min(outro.horaInicio);
    const oFim = min(outro.horaFim);
    const outroVemAntes = oFim <= ini;
    const intervalo = outroVemAntes ? ini - oFim : fim <= oIni ? oIni - fim : null;
    if (intervalo == null) continue;
    const folgaOutro = folgaInterna(config, outro.tipoId);
    const exigido = outroVemAntes ? folgaExigida(folgaOutro, folgaCand) : folgaExigida(folgaCand, folgaOutro);
    if (intervalo >= exigido) continue;
    lista.push(Object.assign(recurso, { motivo: 'sem_folga_deslocamento', comId: outro.id, comTexto: textoFolgaCurta(outro, intervalo, outroVemAntes), severidade: 'aviso' }));
  }
  return lista;
}

/** Regra 9: data no passado ou fim já passado hoje (aviso). */
function conflitosDePassado(candidato) {
  const hoje = util.hojeISO();
  if (candidato.data < hoje) {
    return [{ recurso: 'horario', id: null, rotulo: 'Data', motivo: 'data_passada', comId: null, comTexto: 'Data no passado', severidade: 'aviso' }];
  }
  if (candidato.data === hoje && min(candidato.horaFim) <= util.agoraMin()) {
    return [{ recurso: 'horario', id: null, rotulo: 'Horário', motivo: 'data_passada', comId: null, comTexto: 'Horário já passou', severidade: 'aviso' }];
  }
  return [];
}

/** O serviço já existe e continua no mesmo dia e hora: as regras de antecedência e de janela não voltam a avisar. */
function horarioInalterado(c) {
  if (!c.id) return false;
  const gravado = dados.agendamentoPorId(c.id);
  return !!gravado && gravado.data === c.data && gravado.horaInicio === c.horaInicio;
}

/** Regra 10 (DIRECAO 4.3): início a menos da antecedência mínima (aviso, nunca bloqueio). */
function conflitosDeAntecedencia(c, config) {
  if (horarioInalterado(c)) return [];
  const r = antecedenciaInterna(config, c.data, c.horaInicio, c.tipoId, Date.now());
  if (r.ok) return [];
  return [{ recurso: 'horario', id: null, rotulo: 'Antecedência', motivo: 'antecedencia', comId: null, comTexto: r.texto, severidade: 'aviso' }];
}

/** Regra 11 (DIRECAO 4.4): data além da janela de agendamento (aviso). */
function conflitosDeJanela(c, config) {
  if (horarioInalterado(c)) return [];
  const j = janelaInterna(config, c.tipoId, util.hojeISO());
  if (c.data <= j.limite) return [];
  return [{ recurso: 'horario', id: null, rotulo: 'Janela', motivo: 'fora_janela', comId: null, comTexto: j.texto, severidade: 'aviso' }];
}

/** Regra 12 (DIRECAO 4.5): tipo, carro ou equipe já no teto do dia (aviso). */
function conflitosDeLimite(c, outros) {
  const teto = limiteInterno(c, outros);
  if (!teto) return [];
  return [{ recurso: teto.recurso, id: teto.id, rotulo: teto.rotulo, motivo: 'limite_dia', comId: null, comTexto: teto.texto, severidade: 'aviso' }];
}

/** Regra 13: carro com horário próprio (veiculo.horario) que não sai naquele dia ou naquela hora (aviso). */
function conflitosDeHorarioDoCarro(c) {
  if (!c.veiculoId) return [];
  const v = dados.veiculoPorId(c.veiculoId);
  const faixas = faixasDoVeiculo(v, c.data);
  if (!faixas || cabeEmFaixas(faixas, min(c.horaInicio), min(c.horaFim))) return [];
  const rotulo = apelidoVeiculo(c.veiculoId);
  const texto = faixas.length ? rotulo + ' só sai das ' + faixas.map((f) => util.fmtIntervalo(f.de, f.ate)).join(' e das ') : rotulo + ' não sai neste dia';
  return [{ recurso: 'veiculo', id: c.veiculoId, rotulo, motivo: 'veiculo_fora_horario', comId: null, comTexto: texto, severidade: 'aviso' }];
}

/**
 * Registro com hora aproximada nunca bloqueia (DIRECAO-2 2.2 e D2): todo conflito em que um dos lados tem
 * `horaAproximada` cai para severidade de aviso, marcado com `aproximado: true` para a tela explicar.
 */
function rebaixarAproximados(lista, c, outros) {
  if (!lista.length) return lista;
  const candidatoAprox = aproximado(c);
  const idsAprox = new Set(outros.filter(aproximado).map((o) => o.id));
  return lista.map((k) => (k.severidade !== 'aviso' && (candidatoAprox || (k.comId && idsAprox.has(k.comId)))
    ? Object.assign({}, k, { severidade: 'aviso', aproximado: true })
    : k));
}

/** Detecção com a lista de ativos do dia já carregada (reaproveitada pela régua, pelos horários livres e pelo dia). */
function detectarCom(candidato, ativos) {
  const c = Object.assign({ responsaveis: [], equipeId: null, veiculoId: null }, candidato);
  if (!c.data || !c.horaInicio || !c.horaFim) return [];
  const config = cfg();
  const outros = ativos.filter((o) => o.id !== c.id);
  const sobrepostos = outros.filter((o) => sobrepoeAg(c, o));
  return rebaixarAproximados([].concat(
    conflitosDeSobreposicao(c, sobrepostos),
    conflitosDeIndisponibilidade(c),
    conflitosDeEscala(c),
    conflitosDeHorario(c),
    conflitosDeDeslocamento(c, outros, config),
    conflitosDePassado(c),
    conflitosDeAntecedencia(c, config),
    conflitosDeJanela(c, config),
    conflitosDeLimite(c, outros),
    conflitosDeHorarioDoCarro(c)
  ), c, outros);
}

/**
 * Detecção completa (6.4). Lista vazia significa livre.
 * @param {{data:string, horaInicio:string, horaFim:string, responsaveis:string[], equipeId:string|null, veiculoId:string|null, tipoId:string, setorId:string}} candidato
 * @param {{ignorarId?:string|null}} [opcoes]
 * @returns {{recurso:string, id:string|null, rotulo:string, motivo:string, comId:string|null, comTexto:string, severidade:'bloqueio'|'conflito'|'aviso'}[]}
 */
export function detectarConflitos(candidato, opcoes = {}) {
  if (!candidato || !candidato.data) return [];
  const ignorar = opcoes.ignorarId || candidato.id || null;
  return detectarCom(candidato, ativosDoDia(candidato.data, ignorar));
}

/** @param {object[]} conflitos @returns {'bloqueio'|'conflito'|'aviso'|null} */
export function severidadeMaxima(conflitos) {
  let maior = null;
  for (const c of conflitos || []) {
    if (!maior || PESO_SEVERIDADE[c.severidade] > PESO_SEVERIDADE[maior]) maior = c.severidade;
  }
  return maior;
}

const ehGrave = (c) => c.severidade === 'conflito' || c.severidade === 'bloqueio';
const liberacaoPendente = (a) => !!(a && a.liberacao && a.liberacao.estado === 'pendente');

/**
 * Mapa de agendamentos em conflito no dia (só severidade conflito ou bloqueio), incluindo liberação pendente.
 * @param {string} iso @param {object[]} [lista] padrão: agendamentosDoDia(iso) ativos
 * @returns {Map<string, object[]>}
 */
export function conflitosDoDia(iso, lista) {
  const ativos = (lista || dados.agendamentosDoDia(iso)).filter((a) => statusAtivo(a.status));
  const mapa = new Map();
  for (const a of ativos) {
    const graves = detectarCom(a, ativos).filter(ehGrave);
    if (liberacaoPendente(a)) {
      graves.push({ recurso: 'liberacao', id: null, rotulo: 'Liberação pendente', motivo: 'liberacao_pendente', comId: a.id, comTexto: a.liberacao.texto || 'Aguardando liberação da gerência', severidade: 'conflito' });
    }
    if (graves.length) mapa.set(a.id, graves);
  }
  return mapa;
}

/** @param {object} agendamento @returns {boolean} */
export function emConflito(agendamento) {
  if (!agendamento || !statusAtivo(agendamento.status)) return false;
  return conflitosDoDia(agendamento.data).has(agendamento.id);
}

/* ---------------- Disponibilidade e sugestões ---------------- */

/**
 * Primeiro minuto em que o veículo fica livre depois de `apartir`, respeitando a folga:
 * parte do fim dos serviços que cruzam [apartir, ate) e encadeia os que ficarem colados.
 */
function livreApartirDe(veiculoId, data, apartir, ate, ativos, folgaMin) {
  const doCarro = ativos.filter((a) => a.veiculoId === veiculoId);
  let t = apartir;
  for (const a of doCarro) {
    if (sobrepoe(apartir, ate, min(a.horaInicio), min(a.horaFim))) t = Math.max(t, min(a.horaFim) + folgaMin);
  }
  let mexeu = true;
  let voltas = 0;
  while (mexeu && voltas < 50) {
    mexeu = false;
    voltas += 1;
    for (const a of doCarro) {
      if (min(a.horaInicio) - folgaMin < t && t < min(a.horaFim) + folgaMin) {
        t = min(a.horaFim) + folgaMin;
        mexeu = true;
      }
    }
    for (const i of dados.indisponibilidadesDoVeiculo(veiculoId, data, data)) {
      const marca = util.isoHora(data, util.minParaHora(Math.min(t, MINUTOS_DIA - 1)));
      if (i.de <= marca && marca < i.ate) {
        const fim = util.partesIsoHora(i.ate);
        t = fim.data === data ? min(fim.hora) : MINUTOS_DIA;
        mexeu = true;
      }
    }
  }
  return t >= MINUTOS_DIA ? null : util.minParaHora(t);
}

function estadoPessoa(u, data, hi, hf, sobrepostos) {
  const ocupado = sobrepostos.find((a) => expandirPessoas(a).has(u.id));
  if (ocupado) return { estado: 'ocupado', motivo: 'sobreposicao', comTexto: descricaoCurta(ocupado), comId: ocupado.id };
  if (emFolga(u, data)) return { estado: 'folga', motivo: 'folga', comTexto: nomeCurto(u.nome) + ' de folga', comId: null };
  const faixa = escalaDoDia(u, data);
  if (!faixa || min(hi) < min(faixa.de) || min(hf) > min(faixa.ate)) {
    return { estado: 'fora_escala', motivo: 'fora_escala', comTexto: faixa ? 'Turno das ' + faixa.de + ' às ' + faixa.ate : 'Sem turno neste dia', comId: null };
  }
  return { estado: 'livre', motivo: null, comTexto: 'Livre', comId: null };
}

function estadoEquipeNoIntervalo(e, pessoas, sobrepostos) {
  const direto = sobrepostos.find((a) => a.equipeId === e.id);
  if (direto) return { estado: 'ocupado', motivo: 'sobreposicao', comTexto: descricaoCurta(direto), comId: direto.id };
  for (const chave of ['ocupado', 'folga', 'fora_escala']) {
    for (const id of e.membros || []) {
      const p = pessoas[id];
      if (p && p.estado === chave) {
        const nome = primeiroNomeDe(id);
        const texto = chave === 'ocupado' ? nome + ': ' + p.comTexto : chave === 'folga' ? nome + ' de folga' : nome + ' fora do turno';
        return { estado: chave, motivo: p.motivo, comTexto: texto, comId: p.comId || null };
      }
    }
  }
  return { estado: 'livre', motivo: null, comTexto: 'Livre', comId: null };
}

function estadoVeiculoNoIntervalo(v, data, hi, hf, ativos, sobrepostos, folgaMin, config) {
  const indisp = indisponibilidadesCruzando(v.id, data, hi, hf)[0];
  if (indisp) {
    const fim = util.partesIsoHora(indisp.ate);
    return { estado: 'indisponivel', motivo: 'indisponivel', comTexto: rotuloMotivoIndisponibilidade(indisp), comId: indisp.id, livreApartirDe: fim.data === data && min(fim.hora) > min(hi) ? fim.hora : null };
  }
  const ocupado = sobrepostos.find((a) => a.veiculoId === v.id);
  if (ocupado) {
    return { estado: 'ocupado', motivo: 'sobreposicao', comTexto: descricaoCurta(ocupado), comId: ocupado.id, livreApartirDe: livreApartirDe(v.id, data, min(hi), min(hf), ativos, folgaMin) };
  }
  const colado = conflitosDeDeslocamento({ veiculoId: v.id, horaInicio: hi, horaFim: hf }, ativos, config)[0];
  if (colado) {
    return { estado: 'folga_deslocamento', motivo: 'sem_folga_deslocamento', comTexto: capitalizar(colado.comTexto), comId: colado.comId, livreApartirDe: livreApartirDe(v.id, data, min(hi), min(hf), ativos, folgaMin) };
  }
  return { estado: 'livre', motivo: null, comTexto: 'Livre', comId: null, livreApartirDe: null };
}

/**
 * Estado de cada pessoa, equipe e veículo no intervalo (6.5).
 * @param {string} data @param {string} horaInicio @param {string} horaFim @param {{ignorarId?:string|null}} [opcoes]
 * @returns {{pessoas:Object<string,{estado:string, motivo:string|null, comTexto:string}>, equipes:Object<string,object>, veiculos:Object<string,{estado:string, motivo:string|null, comTexto:string, livreApartirDe:string|null}>}}
 */
export function disponibilidadeRecursos(data, horaInicio, horaFim, opcoes = {}) {
  const ativos = ativosDoDia(data, opcoes.ignorarId || null);
  const alvo = { horaInicio, horaFim };
  const sobrepostos = ativos.filter((a) => sobrepoeAg(alvo, a));
  const config = cfg();
  const folgaPadrao = folgaInterna(config, null);
  const folgaMin = folgaPadrao.antes + folgaPadrao.depois;
  const pessoas = {};
  for (const u of dados.usuariosAtivos()) pessoas[u.id] = estadoPessoa(u, data, horaInicio, horaFim, sobrepostos);
  const equipes = {};
  for (const e of dados.equipesAtivas()) equipes[e.id] = estadoEquipeNoIntervalo(e, pessoas, sobrepostos);
  const veiculos = {};
  for (const v of dados.veiculosAtivos()) veiculos[v.id] = estadoVeiculoNoIntervalo(v, data, horaInicio, horaFim, ativos, sobrepostos, folgaMin, config);
  return { pessoas, equipes, veiculos };
}

/** Carros ativos livres no intervalo (sem sobreposição e sem indisponibilidade). */
function carrosLivres(data, hi, hf, ativos) {
  const alvo = { horaInicio: hi, horaFim: hf };
  return dados.veiculosAtivos().filter((v) => {
    if (indisponibilidadesCruzando(v.id, data, hi, hf).length) return false;
    return !ativos.some((a) => a.veiculoId === v.id && sobrepoeAg(alvo, a));
  });
}

function setorDoCandidato(escolhidos) {
  if (escolhidos.setorId) return escolhidos.setorId;
  const t = escolhidos.tipoId ? dados.tipoPorId(escolhidos.tipoId) : null;
  return t ? t.setorPadrao : undefined;
}

/**
 * Slots da régua (6.5), um por config.slotMin.
 * @param {string} data @param {{responsaveis:string[], equipeId:string|null, veiculoId:string|null, tipoId:string|null}} escolhidos @param {number} duracaoMin @param {{ignorarId?:string|null}} [opcoes]
 * @returns {{hora:string, estado:'livre'|'parcial'|'ocupado'|'fechado'}[]}
 */
export function reguaSlots(data, escolhidos, duracaoMin, opcoes = {}) {
  const c = cfg();
  const esc = Object.assign({ responsaveis: [], equipeId: null, veiculoId: null, tipoId: null }, escolhidos || {});
  const setorId = setorDoCandidato(esc);
  const horario = horarioDoDia(data, setorId);
  const passo = c.slotMin || 30;
  const dur = Math.max(passo, Number(duracaoMin) || c.duracaoPadraoMin);
  const ini = horario ? Math.max(0, min(horario.de) - 60) : 7 * 60;
  const fim = horario ? Math.min(MINUTOS_DIA, min(horario.ate) + 60) : 19 * 60;
  const ativos = ativosDoDia(data, opcoes.ignorarId || null);
  const tipo = esc.tipoId ? dados.tipoPorId(esc.tipoId) : null;
  const exigeCarro = !!tipo && tipo.precisaVeiculo === 'sim';
  const semRecursos = !esc.responsaveis.length && !esc.equipeId && !esc.veiculoId;
  const totalCarros = dados.veiculosAtivos().length;
  const slots = [];
  for (let m = ini; m < fim; m += passo) {
    const hora = util.minParaHora(m);
    if (!horario || m < min(horario.de) || m >= min(horario.ate)) { slots.push({ hora, estado: 'fechado' }); continue; }
    const horaFim = util.minParaHora(Math.min(m + dur, MINUTOS_DIA - 1));
    let estado = 'livre';
    if (!semRecursos) {
      /* A régua é do formulário da v1 e sai no lote 5: os motivos da v2 ficam de fora para ela continuar igual. */
      const sev = severidadeMaxima(detectarCom(Object.assign({ data, horaInicio: hora, horaFim, setorId }, esc), ativos).filter((k) => !MOTIVOS_V2.has(k.motivo)));
      estado = sev === 'bloqueio' || sev === 'conflito' ? 'ocupado' : sev === 'aviso' ? 'parcial' : 'livre';
    }
    if (exigeCarro && !esc.veiculoId && estado !== 'ocupado') {
      const livres = carrosLivres(data, hora, horaFim, ativos).length;
      if (!livres) estado = 'ocupado';
      else if (livres < totalCarros) estado = 'parcial';
    }
    slots.push({ hora, estado });
  }
  return slots;
}

/** Rótulo de sugestão: "Hoje 10:30 às 12:00", "Amanhã 08:00 às 09:30", "Qui 11, 08:00 às 09:30". */
function rotuloSugestao(data, hi, hf, sufixo) {
  const hoje = util.hojeISO();
  const intervalo = util.fmtIntervalo(hi, hf);
  let dia;
  if (data === hoje) dia = 'Hoje ';
  else if (data === util.addDias(hoje, 1)) dia = 'Amanhã ';
  else dia = capitalizar(util.DIAS_ABR[util.diaSemana(data)]) + ' ' + util.dataDe(data).getDate() + ', ';
  return dia + intervalo + (sufixo ? ' (' + sufixo + ')' : '');
}

/** O minuto cai num vão entre duas faixas do dia (o almoço da loja). */
function noIntervaloDoDia(faixas, minuto) {
  for (let i = 0; i + 1 < faixas.length; i++) if (minuto >= min(faixas[i].ate) && minuto < min(faixas[i + 1].de)) return true;
  return false;
}

/** Janela aceitável para sugestão: sem conflito, bloqueio, folga curta, antecedência curta, nem no passado; início fora do almoço. */
function janelaAceitavel(base, data, ini, dur, ativosPorDia) {
  const chaveFaixas = 'faixas:' + data;
  if (!ativosPorDia.has(chaveFaixas)) ativosPorDia.set(chaveFaixas, faixasDoDia(data));
  if (noIntervaloDoDia(ativosPorDia.get(chaveFaixas), ini)) return false;
  if (data === util.hojeISO() && ini < util.agoraMin()) return false;
  const teste = Object.assign({}, base, { data, horaInicio: util.minParaHora(ini), horaFim: util.minParaHora(ini + dur) });
  if (!ativosPorDia.has(data)) ativosPorDia.set(data, ativosDoDia(data, base.id || null));
  const conflitos = detectarCom(teste, ativosPorDia.get(data));
  return !conflitos.some((c) => ehGrave(c) || c.motivo === 'sem_folga_deslocamento' || c.motivo === 'data_passada' || c.motivo === 'antecedencia');
}

/**
 * Até maxOpcoes janelas livres (6.6): mesmo dia à frente, mesmo dia atrás, próximos dias abertos.
 * @param {object} candidato @param {{maxOpcoes?:number, diasAdiante?:number, ignorarId?:string|null}} [opcoes]
 * @returns {{data:string, horaInicio:string, horaFim:string, rotulo:string}[]}
 */
export function sugerirHorarios(candidato, opcoes = {}) {
  const c = cfg();
  const maxOpcoes = opcoes.maxOpcoes || 3;
  const diasAdiante = opcoes.diasAdiante == null ? 7 : opcoes.diasAdiante;
  const base = Object.assign({ responsaveis: [], equipeId: null, veiculoId: null }, candidato, { id: opcoes.ignorarId || candidato.id || null });
  const dur = duracaoMin(base) || c.duracaoPadraoMin;
  const passo = c.passoSugestaoMin || 15;
  const ativosPorDia = new Map();
  const saida = [];
  const vistos = new Set();
  const empurrar = (data, ini, sufixo) => {
    const chave = data + 'T' + ini;
    if (vistos.has(chave) || saida.length >= maxOpcoes) return;
    vistos.add(chave);
    const hi = util.minParaHora(ini);
    const hf = util.minParaHora(ini + dur);
    saida.push({ data, horaInicio: hi, horaFim: hf, rotulo: rotuloSugestao(data, hi, hf, sufixo) });
  };
  /* Uma opção por fase (à frente, antes, cada dia seguinte), para as opções serem diferentes entre si. */
  const primeiraJanela = (data, de, ate, passoAssinado) => {
    for (let m = de; passoAssinado > 0 ? m <= ate : m >= ate; m += passoAssinado) {
      if (janelaAceitavel(base, data, m, dur, ativosPorDia)) return m;
    }
    return null;
  };
  const horarioBase = horarioDoDia(base.data, base.setorId);
  if (horarioBase) {
    const de = min(horarioBase.de);
    const ate = min(horarioBase.ate) - dur;
    const inicio = util.arredondarMin(min(base.horaInicio), passo, 'cima');
    const frente = primeiraJanela(base.data, Math.max(inicio, de), ate, passo);
    if (frente != null) empurrar(base.data, frente, null);
    const atras = primeiraJanela(base.data, Math.min(inicio - passo, ate), de, -passo);
    if (atras != null) empurrar(base.data, atras, 'antes');
  }
  for (let d = 1; d <= diasAdiante && saida.length < maxOpcoes; d++) {
    const data = util.addDias(base.data, d);
    const horario = horarioDoDia(data, base.setorId);
    if (!horario) continue;
    const m = primeiraJanela(data, min(horario.de), min(horario.ate) - dur, passo);
    if (m != null) empurrar(data, m, null);
  }
  return saida;
}

/** Responsáveis resultantes ao tirar uma pessoa: se ela só entrava pela equipe, a equipe é desfeita em membros. */
function semPessoa(candidato, id) {
  const resp = (candidato.responsaveis || []).filter((r) => r !== id);
  if (candidato.equipeId && membrosDe(candidato.equipeId).includes(id)) {
    return { equipeId: null, responsaveis: unicos(resp.concat(membrosDe(candidato.equipeId).filter((m) => m !== id))) };
  }
  return { responsaveis: resp };
}

function alternativasPessoa(candidato, conflito, disp, indice, ids) {
  const saida = [];
  const jaNoServico = expandirPessoas(candidato);
  const livre = (u) => !jaNoServico.has(u.id) && disp.pessoas[u.id] && disp.pessoas[u.id].estado === 'livre';
  const campo = dados.usuariosCampo();
  let opcoes = campo.filter((u) => (u.setores || []).includes(candidato.setorId) && livre(u));
  if (!opcoes.length) opcoes = campo.filter(livre);
  for (const u of opcoes.slice(0, 3)) {
    const base = semPessoa(candidato, conflito.id);
    saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Trocar ' + conflito.rotulo + ' por ' + nomeCurto(u.nome), mudancas: Object.assign({}, base, { responsaveis: unicos(base.responsaveis.concat([u.id])) }) });
  }
  const restantes = new Set(jaNoServico);
  restantes.delete(conflito.id);
  if (restantes.size) saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Tirar ' + conflito.rotulo, mudancas: semPessoa(candidato, conflito.id) });
  return saida;
}

function alternativasEquipe(candidato, conflito, disp, indice, ids) {
  const saida = [];
  const atual = dados.equipePorId(conflito.id);
  const membrosAtuais = membrosDe(conflito.id);
  const setoresRef = new Set(((atual && atual.setores) || []).concat(candidato.setorId ? [candidato.setorId] : []));
  const foraDaEquipe = (candidato.responsaveis || []).filter((r) => !membrosAtuais.includes(r));
  for (const e of dados.equipesAtivas()) {
    if (e.id === conflito.id) continue;
    if (!(e.setores || []).some((s) => setoresRef.has(s))) continue;
    if (!disp.equipes[e.id] || disp.equipes[e.id].estado !== 'livre') continue;
    saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Trocar pela ' + (e.nome || e.apelido), mudancas: { equipeId: e.id, responsaveis: unicos(foraDaEquipe.concat(e.membros || [])) } });
  }
  const livres = membrosAtuais.filter((m) => disp.pessoas[m] && disp.pessoas[m].estado === 'livre');
  if (livres.length) saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Só os membros livres', mudancas: { equipeId: null, responsaveis: unicos(foraDaEquipe.concat(livres)) } });
  return saida;
}

function alternativasVeiculo(candidato, conflito, disp, indice, ids) {
  const saida = [];
  for (const v of dados.veiculosAtivos()) {
    if (v.id === conflito.id) continue;
    if (!disp.veiculos[v.id] || disp.veiculos[v.id].estado !== 'livre') continue;
    saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Usar a ' + (v.apelido || v.nome), mudancas: { veiculoId: v.id } });
  }
  const tipo = candidato.tipoId ? dados.tipoPorId(candidato.tipoId) : null;
  if (!tipo || tipo.precisaVeiculo !== 'sim') {
    saida.push({ id: ids(), conflitoIndice: indice, rotulo: 'Sem carro desta vez', mudancas: { veiculoId: null, semCarroConfirmado: true } });
  }
  return saida;
}

/**
 * Alternativas aplicáveis em um toque para cada conflito (6.6).
 * @param {object} candidato @param {object[]} conflitos
 * @returns {{id:string, conflitoIndice:number, rotulo:string, mudancas:object}[]} mudancas aplicáveis com Object.assign(candidato, mudancas)
 */
export function alternativas(candidato, conflitos) {
  if (!candidato || !conflitos || !conflitos.length) return [];
  let n = 0;
  const ids = () => 'alt_' + (++n);
  const disp = disponibilidadeRecursos(candidato.data, candidato.horaInicio, candidato.horaFim, { ignorarId: candidato.id || null });
  let sugestoes = null;
  const saida = [];
  /* Sugestões de horário aparecem uma vez só: se algum conflito de horário já as carrega, o bloqueio de carro não repete. */
  const horarioJaSugerido = conflitos.some((c) => c.recurso === 'horario' || c.motivo === 'sem_folga_deslocamento');
  conflitos.forEach((c, indice) => {
    if (c.recurso === 'pessoa' && (c.motivo === 'sobreposicao' || c.motivo === 'folga')) {
      saida.push(...alternativasPessoa(candidato, c, disp, indice, ids));
    } else if (c.recurso === 'equipe' && c.motivo === 'sobreposicao') {
      saida.push(...alternativasEquipe(candidato, c, disp, indice, ids));
    } else if (c.recurso === 'veiculo' && (c.motivo === 'sobreposicao' || c.motivo === 'indisponivel')) {
      saida.push(...alternativasVeiculo(candidato, c, disp, indice, ids));
      if (c.motivo === 'indisponivel' && !horarioJaSugerido) {
        /* Bloqueio (6.7): além de outro carro, os próximos horários em que o carro escolhido fica livre
           (à frente e antes no mesmo dia, depois o próximo dia aberto). */
        if (!sugestoes) sugestoes = sugerirHorarios(candidato, { ignorarId: candidato.id || null });
        for (const s of sugestoes) {
          saida.push({ id: ids(), conflitoIndice: indice, rotulo: s.rotulo, mudancas: { data: s.data, horaInicio: s.horaInicio, horaFim: s.horaFim } });
        }
      }
    } else if (c.recurso === 'horario' || c.motivo === 'sem_folga_deslocamento') {
      if (!sugestoes) sugestoes = sugerirHorarios(candidato, { ignorarId: candidato.id || null });
      for (const s of sugestoes) {
        saida.push({ id: ids(), conflitoIndice: indice, rotulo: s.rotulo, mudancas: { data: s.data, horaInicio: s.horaInicio, horaFim: s.horaFim } });
      }
    }
  });
  return saida;
}

/* ---------------- Antecedência, janela e limite por dia (DIRECAO 4.3 a 4.5) ---------------- */

function tipoDe(tipoOuId) {
  if (!tipoOuId) return null;
  return typeof tipoOuId === 'string' ? dados.tipoPorId(tipoOuId) : tipoOuId;
}

function antecedenciaInterna(config, data, horaInicio, tipoOuId, agoraMs) {
  const t = tipoDe(tipoOuId);
  const minimoMin = numeroOu(t && t.antecedenciaMinMin, config.antecedenciaMinMin, 0);
  const faltamMin = Math.floor((util.msDe(data, horaInicio) - agoraMs) / 60000);
  /* Início que já passou é assunto de data_passada e de atraso, não de antecedência. */
  const ok = !minimoMin || faltamMin < 0 || faltamMin >= minimoMin;
  let texto = '';
  if (!ok) {
    const falta = faltamMin === 0 ? 'Começa agora' : (faltamMin === 1 || (faltamMin >= 60 && faltamMin < 120) ? 'Falta ' : 'Faltam ') + util.fmtDuracao(faltamMin) + ' para o início';
    texto = falta + ', o mínimo combinado é ' + util.fmtDuracao(minimoMin);
  }
  return { ok, faltamMin, minimoMin, texto };
}

/**
 * Detalhe da antecedência mínima (DIRECAO 4.3): config.antecedenciaMinMin, sobrescrita por tipo.antecedenciaMinMin.
 * @param {string} data @param {string} horaInicio @param {string|object|null} [tipoOuId] @param {number} [agoraMs]
 * @returns {{ok:boolean, faltamMin:number, minimoMin:number, texto:string}} texto ex. "Faltam 40 min para o início, o mínimo combinado é 2 h"
 */
export function antecedenciaDe(data, horaInicio, tipoOuId, agoraMs) {
  return antecedenciaInterna(cfg(), data, horaInicio, tipoOuId, agoraMs == null ? Date.now() : agoraMs);
}

/** O início respeita a antecedência mínima. Sempre booleano; o texto sai de antecedenciaDe. @returns {boolean} */
export function antecedenciaOk(data, horaInicio, tipoOuId, agoraMs) {
  return antecedenciaDe(data, horaInicio, tipoOuId, agoraMs).ok;
}

function janelaInterna(config, tipoOuId, hoje) {
  const t = tipoDe(tipoOuId);
  const dias = numeroOu(t && t.janelaDias, config.janelaDias, 90) || 90;
  const limite = util.addDias(hoje, dias);
  return { dias, limite, texto: 'Data além da janela de ' + plural(dias, 'dia', 'dias') + ', que vai até ' + util.fmtData(limite) };
}

/**
 * Janela de agendamento (DIRECAO 4.4): config.janelaDias, sobrescrita por tipo.janelaDias.
 * @param {string|object|null} [tipoOuId] @param {string} [hoje] ISO; padrão hoje
 * @returns {{dias:number, limite:string, texto:string}} limite é a última data dentro da janela
 */
export function janelaDe(tipoOuId, hoje) {
  return janelaInterna(cfg(), tipoOuId, hoje || util.hojeISO());
}

/** A data está dentro da janela de agendamento. Sempre booleano; passado não é assunto desta regra. @returns {boolean} */
export function dentroDaJanela(data, tipoOuId, hoje) {
  return !!data && data <= janelaDe(tipoOuId, hoje).limite;
}

const usaEquipe = (a, equipe) => a.equipeId === equipe.id
  || ((equipe.membros || []).length > 0 && (equipe.membros || []).every((m) => (a.responsaveis || []).includes(m)));

/** Primeiro teto estourado entre tipo, carro e equipe, contra os outros serviços ativos do dia. */
function limiteInterno(candidato, outros) {
  const estouro = (recurso, id, rotulo, limite, total) => (typeof limite === 'number' && limite > 0 && total >= limite
    ? { recurso, id, rotulo, limite, total, texto: rotulo + ' já tem ' + plural(total, 'serviço', 'serviços') + ' neste dia' } : null);
  const t = candidato.tipoId ? dados.tipoPorId(candidato.tipoId) : null;
  if (t) {
    const e = estouro('tipo', t.id, t.nome, t.limiteDia, outros.filter((a) => a.tipoId === t.id).length);
    if (e) return e;
  }
  const v = candidato.veiculoId ? dados.veiculoPorId(candidato.veiculoId) : null;
  if (v) {
    const e = estouro('veiculo', v.id, v.apelido || v.nome, v.limiteDia, outros.filter((a) => a.veiculoId === v.id).length);
    if (e) return e;
  }
  const eq = candidato.equipeId ? dados.equipePorId(candidato.equipeId) : null;
  if (eq) {
    const e = estouro('equipe', eq.id, eq.apelido || eq.nome, eq.limiteDia, outros.filter((a) => usaEquipe(a, eq)).length);
    if (e) return e;
  }
  return null;
}

/**
 * Limite por dia (DIRECAO 4.5). Três tetos, o primeiro que estourar fecha: tipo.limiteDia, veiculo.limiteDia, equipe.limiteDia.
 * Conta os serviços ativos do dia, sem o próprio candidato. null quando cabe.
 * @param {string} data @param {{id?:string, tipoId?:string, veiculoId?:string|null, equipeId?:string|null}} candidato @param {{ignorarId?:string|null}} [opcoes]
 * @returns {{recurso:'tipo'|'veiculo'|'equipe', id:string, rotulo:string, limite:number, total:number, texto:string}|null} texto ex. "Fiorino já tem 5 serviços neste dia"
 */
export function limiteDoDia(data, candidato, opcoes = {}) {
  if (!data || !candidato) return null;
  const ignorar = opcoes.ignorarId || candidato.id || null;
  return limiteInterno(candidato, ativosDoDia(data, ignorar));
}

/* ---------------- Rodízio, horários livres e dias com vaga (DIRECAO 4.1, 4.6 e 4.7) ---------------- */

/** Cadastros lidos uma vez só por consulta (um mês inteiro usa a mesma base). */
function baseDeRecursos() {
  return { config: cfg(), hoje: util.hojeISO(), veiculos: dados.veiculosAtivos(), equipes: dados.equipesAtivas(), usuarios: dados.usuariosAtivos(), folgas: new Map() };
}

function folgaDaBase(base, tipoId) {
  const chave = tipoId || '';
  if (!base.folgas.has(chave)) base.folgas.set(chave, folgaInterna(base.config, tipoId));
  return base.folgas.get(chave);
}

/** Tudo que depende só do dia, calculado uma vez: serviços ativos em minutos, indisponibilidades e faixas de cada carro, turno de cada pessoa. */
function contextoDoDia(base, data, ignorarId) {
  const ativos = ativosDoDia(data, ignorarId || null);
  const itens = ativos.map((a) => ({ a, ini: min(a.horaInicio), fim: min(a.horaFim), pessoas: expandirPessoas(a), folga: folgaDaBase(base, a.tipoId) }));
  const carros = new Map();
  for (const v of base.veiculos) carros.set(v.id, { indisps: dados.indisponibilidadesDoVeiculo(v.id, data, data), faixas: faixasDoVeiculo(v, data) });
  const pessoas = new Map();
  for (const u of base.usuarios) pessoas.set(u.id, { folga: emFolga(u, data), turno: escalaDoDia(u, data) });
  return { base, data, ativos, itens, carros, pessoas };
}

/** Primeiro serviço do dia que impede o recurso em [ini, fim], por sobreposição ou por folga curta (DIRECAO 4.2). null se livre. */
function impedimento(ctx, usa, ini, fim, folgaCand) {
  let folgaCurta = null;
  for (const item of ctx.itens) {
    if (!usa(item)) continue;
    if (sobrepoe(ini, fim, item.ini, item.fim)) return { motivo: 'sobreposicao', item };
    if (folgaCurta) continue;
    if (item.fim <= ini && ini - item.fim < folgaExigida(item.folga, folgaCand)) folgaCurta = { motivo: 'sem_folga_deslocamento', item, intervalo: ini - item.fim, outroVemAntes: true };
    else if (fim <= item.ini && item.ini - fim < folgaExigida(folgaCand, item.folga)) folgaCurta = { motivo: 'sem_folga_deslocamento', item, intervalo: item.ini - fim, outroVemAntes: false };
  }
  return folgaCurta;
}

function textoImpedimento(rotulo, imp) {
  if (imp.motivo === 'sobreposicao') return rotulo + ' em outro serviço até ' + imp.item.a.horaFim;
  return rotulo + ': ' + textoFolgaCurta(imp.item.a, imp.intervalo, imp.outroVemAntes);
}

const contarUso = (ctx, usa) => ctx.itens.reduce((n, item) => n + (usa(item) ? 1 : 0), 0);
/** Fim do último serviço do recurso antes de `ini` (-1 se ainda não saiu no dia): quanto menor, mais tempo parado. */
const ultimoFimAntes = (ctx, usa, ini) => ctx.itens.reduce((m, item) => (usa(item) && item.fim <= ini ? Math.max(m, item.fim) : m), -1);

/** Por que o carro não serve em [ini, fim]; null se serve. */
function motivoDoCarro(ctx, v, ini, fim, folgaCand) {
  const rotulo = v.apelido || v.nome;
  const info = ctx.carros.get(v.id) || { indisps: dados.indisponibilidadesDoVeiculo(v.id, ctx.data, ctx.data), faixas: faixasDoVeiculo(v, ctx.data) };
  const de = util.isoHora(ctx.data, util.minParaHora(ini));
  const ate = util.isoHora(ctx.data, util.minParaHora(Math.min(fim, MINUTOS_DIA - 1)));
  const indisp = info.indisps.find((i) => i.de < ate && de < i.ate);
  if (indisp) return { codigo: 'indisponivel', texto: rotulo + ' indisponível: ' + rotuloMotivoIndisponibilidade(indisp) };
  if (info.faixas && !cabeEmFaixas(info.faixas, ini, fim)) return { codigo: 'veiculo_fora_horario', texto: rotulo + (info.faixas.length ? ' não sai neste horário' : ' não sai neste dia') };
  const usa = (item) => item.a.veiculoId === v.id;
  const imp = impedimento(ctx, usa, ini, fim, folgaCand);
  if (imp) return { codigo: imp.motivo, texto: textoImpedimento(rotulo, imp) };
  const total = contarUso(ctx, usa);
  if (typeof v.limiteDia === 'number' && v.limiteDia > 0 && total >= v.limiteDia) return { codigo: 'limite_dia', texto: rotulo + ' já tem ' + plural(total, 'serviço', 'serviços') + ' neste dia' };
  return null;
}

/** Por que a pessoa não serve em [ini, fim]; null se serve. */
function motivoDaPessoa(ctx, u, ini, fim, folgaCand) {
  const rotulo = nomeCurto(u.nome);
  const info = ctx.pessoas.get(u.id) || { folga: emFolga(u, ctx.data), turno: escalaDoDia(u, ctx.data) };
  if (info.folga) return { codigo: 'folga', texto: rotulo + ' de folga' };
  if (!info.turno) return { codigo: 'fora_escala', texto: rotulo + ' sem turno neste dia' };
  if (ini < min(info.turno.de) || fim > min(info.turno.ate)) return { codigo: 'fora_escala', texto: rotulo + ' fora do turno (' + util.fmtIntervalo(info.turno.de, info.turno.ate) + ')' };
  const imp = impedimento(ctx, (item) => item.pessoas.has(u.id), ini, fim, folgaCand);
  return imp ? { codigo: imp.motivo, texto: textoImpedimento(rotulo, imp) } : null;
}

/** Por que a equipe não serve em [ini, fim]; null se serve (todos os membros livres, equipe fora de outro serviço, teto do dia respeitado). */
function motivoDaEquipe(ctx, e, ini, fim, folgaCand) {
  const rotulo = e.apelido || e.nome;
  const usa = (item) => usaEquipe(item.a, e);
  const imp = impedimento(ctx, usa, ini, fim, folgaCand);
  if (imp) return { codigo: imp.motivo, texto: textoImpedimento(rotulo, imp) };
  const membros = (e.membros || []).map((id) => ctx.base.usuarios.find((u) => u.id === id)).filter(Boolean);
  if (!membros.length) return { codigo: 'sem_membros', texto: rotulo + ' sem membros ativos' };
  for (const u of membros) {
    const m = motivoDaPessoa(ctx, u, ini, fim, folgaCand);
    if (m) return m;
  }
  const total = contarUso(ctx, usa);
  if (typeof e.limiteDia === 'number' && e.limiteDia > 0 && total >= e.limiteDia) return { codigo: 'limite_dia', texto: rotulo + ' já tem ' + plural(total, 'serviço', 'serviços') + ' neste dia' };
  return null;
}

function juntarMotivos(titulo, motivos) {
  if (!motivos.length) return { codigo: 'sem_recurso', texto: titulo };
  if (motivos.length === 1) return motivos[0];
  return { codigo: motivos[0].codigo, texto: titulo + ': ' + motivos.slice(0, 3).map((m) => m.texto).join('; ') };
}

/**
 * Escolha de carro e de gente para [ini, fim] num dia já carregado. Respeita o que o candidato já trouxer fixo
 * (veiculoId, equipeId ou responsaveis) e só sorteia o resto.
 * @returns {{escolha:{veiculoId:string|null, equipeId:string|null, responsaveis:string[], semCarroConfirmado:boolean}|null, codigo:string|null, motivo:string|null}}
 */
function escolherNoContexto(ctx, cand, ini, fim) {
  const base = ctx.base;
  const tipo = cand.tipoId ? dados.tipoPorId(cand.tipoId) : null;
  const setorId = cand.setorId || (tipo ? tipo.setorPadrao : null);
  const precisa = tipo ? tipo.precisaVeiculo : 'opcional';
  const folgaCand = folgaDaBase(base, cand.tipoId);
  const porRodizio = (cand.rodizio || base.config.rodizio) !== 'manual';
  const falha = (m) => ({ escolha: null, codigo: m.codigo, motivo: m.texto });

  /* 1. Carro. */
  const carroFixo = cand.veiculoId ? (base.veiculos.find((v) => v.id === cand.veiculoId) || dados.veiculoPorId(cand.veiculoId)) : null;
  const querCarro = !!carroFixo || (precisa !== 'nao' && !cand.semCarroConfirmado);
  const carrosLivresAgora = [];
  const motivosCarro = [];
  if (querCarro) {
    for (const v of (carroFixo ? [carroFixo] : base.veiculos)) {
      const m = motivoDoCarro(ctx, v, ini, fim, folgaCand);
      if (m) motivosCarro.push(m); else carrosLivresAgora.push(v);
    }
    if (!carrosLivresAgora.length && (carroFixo || precisa === 'sim')) return falha(juntarMotivos('Nenhum carro livre', motivosCarro));
  }

  /* 2. Gente: a equipe fixa, as pessoas fixas, ou o que o setor tiver. */
  const opcoes = [];
  const motivosGente = [];
  const equipeFixa = cand.equipeId ? (base.equipes.find((e) => e.id === cand.equipeId) || dados.equipePorId(cand.equipeId)) : null;
  const fixos = (cand.responsaveis || []).filter(Boolean);
  if (equipeFixa || fixos.length) {
    let m = equipeFixa ? motivoDaEquipe(ctx, equipeFixa, ini, fim, folgaCand) : null;
    const membros = equipeFixa ? (equipeFixa.membros || []) : [];
    for (const id of fixos) {
      if (m) break;
      if (membros.includes(id)) continue;
      const u = base.usuarios.find((x) => x.id === id) || dados.usuarioPorId(id);
      if (u) m = motivoDaPessoa(ctx, u, ini, fim, folgaCand);
    }
    if (m) return falha(m);
    opcoes.push({ equipe: equipeFixa, responsaveis: unicos(fixos.concat(membros)), uso: 0 });
  } else {
    const doSetor = (lista) => (setorId ? lista.filter((x) => (x.setores || []).includes(setorId)) : lista);
    let equipes = doSetor(base.equipes);
    const emEquipe = new Set();
    for (const e of equipes) for (const id of e.membros || []) emEquipe.add(id);
    let avulsos = doSetor(base.usuarios.filter((u) => u.campo)).filter((u) => !emEquipe.has(u.id));
    if (!equipes.length && !avulsos.length) { equipes = base.equipes; avulsos = []; }
    for (const e of equipes) {
      const m = motivoDaEquipe(ctx, e, ini, fim, folgaCand);
      if (m) motivosGente.push(m); else opcoes.push({ equipe: e, responsaveis: (e.membros || []).slice(), uso: contarUso(ctx, (item) => usaEquipe(item.a, e)) });
    }
    for (const u of avulsos) {
      const m = motivoDaPessoa(ctx, u, ini, fim, folgaCand);
      if (m) motivosGente.push(m); else opcoes.push({ equipe: null, responsaveis: [u.id], uso: contarUso(ctx, (item) => item.pessoas.has(u.id)) });
    }
    if (!opcoes.length) return falha(juntarMotivos('Ninguém livre no setor', motivosGente));
  }

  /* 3. Desempate: menos serviços no dia; depois afinidade (carro cuja equipe padrão atende o setor, equipe cujo carro padrão
     é o escolhido); depois o carro parado há mais tempo; por fim a ordem do cadastro. Rodízio manual pula a contagem. */
  const afinidadeCarro = (v) => {
    const e = v.equipePadraoId ? base.equipes.find((x) => x.id === v.equipePadraoId) : null;
    return e && setorId && (e.setores || []).includes(setorId) ? 0 : 1;
  };
  let carro = null;
  if (carrosLivresAgora.length) {
    const notas = carrosLivresAgora.map((v, ordem) => {
      const usa = (item) => item.a.veiculoId === v.id;
      return { v, ordem, uso: porRodizio ? contarUso(ctx, usa) : 0, afinidade: afinidadeCarro(v), parado: ultimoFimAntes(ctx, usa, ini) };
    });
    notas.sort((a, b) => a.uso - b.uso || a.afinidade - b.afinidade || a.parado - b.parado || a.ordem - b.ordem);
    carro = notas[0].v;
  }
  const afinidadeGente = (o) => (carro && o.equipe && (o.equipe.veiculoPadraoId === carro.id || carro.equipePadraoId === o.equipe.id) ? 0 : 1);
  const gente = opcoes.map((o, ordem) => ({ o, ordem, uso: porRodizio ? o.uso : 0, afinidade: afinidadeGente(o), avulso: o.equipe ? 0 : 1 }))
    .sort((a, b) => a.uso - b.uso || a.afinidade - b.afinidade || a.avulso - b.avulso || a.ordem - b.ordem)[0].o;

  return {
    escolha: {
      veiculoId: carro ? carro.id : null,
      equipeId: gente.equipe ? gente.equipe.id : null,
      responsaveis: gente.responsaveis.slice(),
      semCarroConfirmado: !carro && (precisa === 'opcional' || !!cand.semCarroConfirmado)
    },
    codigo: null,
    motivo: null
  };
}

/**
 * Atribuição automática do recurso livre, o rodízio (DIRECAO 4.7).
 * 1. carros ativos livres no intervalo (sem sobreposição, sem indisponibilidade, dentro do horário do carro, com a folga de 4.2) e abaixo do teto de 4.5;
 * 2. equipes ativas do setor do tipo com todos os membros livres (ou pessoa de campo do setor, quando o setor não tem equipe);
 * 3. desempate por menos serviços no dia, depois pelo carro parado há mais tempo; config.rodizio 'manual' desliga a contagem;
 * 4. tipo que não exige carro e nenhum livre: equipe sem carro, com semCarroConfirmado true.
 * O que o candidato já trouxer (veiculoId, equipeId, responsaveis) fica como está e só o resto é escolhido.
 * @param {{data:string, horaInicio:string, horaFim:string, tipoId?:string, setorId?:string, veiculoId?:string|null, equipeId?:string|null, responsaveis?:string[], id?:string}} candidato
 * @param {{ignorarId?:string|null, rodizio?:'menos_servicos'|'manual'}} [opcoes]
 * @returns {{veiculoId:string|null, equipeId:string|null, responsaveis:string[], semCarroConfirmado:boolean}|null} null quando não há combinação livre
 */
export function escolherRecurso(candidato, opcoes = {}) {
  if (!candidato || !candidato.data || !candidato.horaInicio || !candidato.horaFim) return null;
  const ctx = contextoDoDia(baseDeRecursos(), candidato.data, opcoes.ignorarId || candidato.id || null);
  const cand = Object.assign({}, candidato, opcoes.rodizio ? { rodizio: opcoes.rodizio } : {});
  return escolherNoContexto(ctx, cand, min(candidato.horaInicio), min(candidato.horaFim)).escolha;
}

/** Frase pronta de um conflito, para o lado do horário indisponível. */
function fraseDoConflito(k, ativos) {
  if (k.motivo === 'sobreposicao') {
    const outro = ativos.find((a) => a.id === k.comId);
    return k.rotulo + ' em outro serviço' + (outro ? ' até ' + outro.horaFim : '');
  }
  if (k.motivo === 'indisponivel') return k.rotulo + ' indisponível: ' + k.comTexto;
  if (k.motivo === 'sem_folga_deslocamento') return k.rotulo + ': ' + k.comTexto;
  if (k.motivo === 'fora_horario') return 'Fora do horário. ' + k.comTexto;
  return k.comTexto;
}

/** Durações oferecidas pelo tipo, a padrão primeiro (DIRECAO 4.14). @param {string|object|null} tipoOuId @returns {number[]} */
export function duracoesDoTipo(tipoOuId) {
  const t = tipoDe(tipoOuId);
  if (!t) return [cfg().duracaoPadraoMin];
  const lista = [t.duracaoPadraoMin].concat(Array.isArray(t.duracoes) ? t.duracoes : []).filter((d) => typeof d === 'number' && d > 0);
  return unicos(lista).slice(0, 4);
}

function duracaoDaConsulta(config, candidato, opcoes, tipo) {
  const pedida = Number(opcoes.duracaoMin || candidato.duracaoMin) || 0;
  if (pedida > 0) return pedida;
  if (candidato.horaInicio && candidato.horaFim && min(candidato.horaFim) > min(candidato.horaInicio)) return min(candidato.horaFim) - min(candidato.horaInicio);
  return (tipo && duracoesDoTipo(tipo)[0]) || config.duracaoPadraoMin || 90;
}

/**
 * Núcleo dos horários livres. `parar` interrompe no primeiro livre (é o que diasComVaga usa).
 * Interseção de três disponibilidades (loja, carro quando o tipo exige, gente do setor), conferida por detectarCom.
 */
function horariosDoContexto(ctx, candidato, opcoes, parar) {
  const base = ctx.base;
  const config = base.config;
  const data = ctx.data;
  const tipo = candidato.tipoId ? dados.tipoPorId(candidato.tipoId) : null;
  const setorId = candidato.setorId || (tipo ? tipo.setorPadrao : undefined);
  const faixas = faixasCom(config, data, setorId);
  if (!faixas.length) return [];
  const dur = duracaoDaConsulta(config, candidato, opcoes, tipo);
  const passo = Math.max(5, numeroOu(Number(opcoes.incrementoMin) || null, tipo && tipo.incrementoMin, config.slotMin, 30) || 30);
  const liberar = !!opcoes.mostrarAssimMesmo;
  const agoraMs = opcoes.agoraMs == null ? Date.now() : opcoes.agoraMs;
  const agora = new Date(agoraMs);
  const hoje = util.isoDe(agora);
  const agoraMinutos = agora.getHours() * 60 + agora.getMinutes();
  const janela = janelaInterna(config, tipo, hoje);
  const foraDaJanela = data > janela.limite && !liberar;
  const tetoDoTipo = limiteInterno({ tipoId: candidato.tipoId }, ctx.ativos);
  const fixo = { id: candidato.id || null, tipoId: candidato.tipoId || null, setorId: setorId || null, veiculoId: candidato.veiculoId || null, equipeId: candidato.equipeId || null, responsaveis: (candidato.responsaveis || []).slice(), semCarroConfirmado: !!candidato.semCarroConfirmado, rodizio: opcoes.rodizio || null };
  const saida = [];
  const item = (hora, horaFim, estado, codigo, motivo, recursos) => ({ hora, horaFim, estado, codigo: codigo || null, motivo: motivo || null, recursos: recursos || null });

  for (let f = 0; f < faixas.length; f++) {
    const abre = min(faixas[f].de);
    const fecha = min(faixas[f].ate);
    for (let m = abre; m < fecha; m += passo) {
      const hora = util.minParaHora(m);
      const horaFim = util.minParaHora(Math.min(m + dur, MINUTOS_DIA - 1));
      if (m + dur > fecha) {
        const proxima = faixas[f + 1];
        saida.push(item(hora, horaFim, 'fora', 'nao_cabe', proxima ? 'Entra no intervalo das ' + util.fmtIntervalo(faixas[f].ate, proxima.de) : 'Passa do fechamento, às ' + faixas[f].ate));
        continue;
      }
      if (data < hoje || (data === hoje && m < agoraMinutos)) { saida.push(item(hora, horaFim, 'fora', 'data_passada', 'Horário já passou')); continue; }
      if (foraDaJanela) { saida.push(item(hora, horaFim, 'fora', 'fora_janela', janela.texto)); continue; }
      if (!liberar) {
        const ant = antecedenciaInterna(config, data, hora, tipo, agoraMs);
        if (!ant.ok) { saida.push(item(hora, horaFim, 'fora', 'antecedencia', ant.texto)); continue; }
      }
      if (tetoDoTipo) { saida.push(item(hora, horaFim, 'ocupado', 'limite_dia', tetoDoTipo.texto)); continue; }
      const r = escolherNoContexto(ctx, fixo, m, m + dur);
      if (!r.escolha) { saida.push(item(hora, horaFim, 'ocupado', r.codigo, r.motivo)); continue; }
      const completo = Object.assign({}, fixo, r.escolha, { data, horaInicio: hora, horaFim });
      const impedem = detectarCom(completo, ctx.ativos).filter((k) => (ehGrave(k) || AVISOS_QUE_OCUPAM.has(k.motivo)));
      if (impedem.length) {
        impedem.sort((a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade]);
        saida.push(item(hora, horaFim, 'ocupado', impedem[0].motivo, fraseDoConflito(impedem[0], ctx.ativos)));
        continue;
      }
      saida.push(item(hora, horaFim, 'livre', null, null, r.escolha));
      if (parar) return saida;
    }
  }
  return saida;
}

/**
 * Horários livres calculados (DIRECAO 4.1): um item por incremento (tipo.incrementoMin, senão config.slotMin), dentro das faixas do dia.
 * Livre quando há janela vazia de folga antes mais duração mais folga depois, com carro (se o tipo exigir) e gente do setor livres;
 * `recursos` traz quem o rodízio escolheu para aquele horário. Em dia fechado devolve lista vazia (ver motivoDiaFechado).
 * Antecedência mínima e janela são aviso, nunca bloqueio: os horários dentro delas saem como 'fora' com o motivo, e
 * opcoes.mostrarAssimMesmo os libera na hora.
 * @param {string} data
 * @param {{tipoId?:string, setorId?:string, duracaoMin?:number, veiculoId?:string|null, equipeId?:string|null, responsaveis?:string[], semCarroConfirmado?:boolean, id?:string}} candidato recurso informado fica fixo; o que faltar o rodízio escolhe
 * @param {{ignorarId?:string|null, duracaoMin?:number, incrementoMin?:number, mostrarAssimMesmo?:boolean, rodizio?:string, agoraMs?:number}} [opcoes]
 * @returns {{hora:string, horaFim:string, estado:'livre'|'ocupado'|'fora', codigo:string|null, motivo:string|null, recursos:{veiculoId:string|null, equipeId:string|null, responsaveis:string[], semCarroConfirmado:boolean}|null}[]}
 *   codigo é o motivo em forma de chave ('sobreposicao', 'indisponivel', 'sem_folga_deslocamento', 'limite_dia', 'folga', 'fora_escala',
 *   'antecedencia', 'fora_janela', 'data_passada', 'nao_cabe'); motivo é a frase pronta ("Fiorino em outro serviço até 10:00").
 */
export function horariosLivres(data, candidato, opcoes = {}) {
  if (!data || !util.dataValida(data)) return [];
  const cand = candidato || {};
  const ctx = contextoDoDia(baseDeRecursos(), data, opcoes.ignorarId || cand.id || null);
  return horariosDoContexto(ctx, cand, opcoes, false);
}

/* Memo por dia de diasComVaga. Qualquer gravação esvazia; hoje também muda com o relógio, por isso a chave leva o quarto de hora. */
const memoVaga = new Map();
const MEMO_VAGA_MAX = 400;
dados.repo.assinar('*', () => memoVaga.clear());

function chaveDaVaga(data, candidato, opcoes, hoje, agoraMinutos) {
  return [data, hoje, data === hoje ? Math.floor(agoraMinutos / 15) : '', candidato.tipoId || '', candidato.setorId || '',
    candidato.veiculoId || '', candidato.equipeId || '', (candidato.responsaveis || []).join('+'), candidato.semCarroConfirmado ? 1 : 0,
    candidato.id || '', opcoes.ignorarId || '', opcoes.duracaoMin || candidato.duracaoMin || '', opcoes.incrementoMin || '',
    opcoes.mostrarAssimMesmo ? 1 : 0, opcoes.rodizio || ''].join('|');
}

/**
 * Dias do mês com ao menos um horário livre, para o calendário do Agendar (DIRECAO 3.4 e 4.4).
 * Trabalho limitado: passado, dia fechado e dia além da janela saem sem cálculo; os outros param no primeiro horário livre;
 * cada dia fica em memo até a próxima gravação.
 * @param {string} isoMes qualquer data do mês @param {object} candidato o mesmo de horariosLivres @param {object} [opcoes] as mesmas de horariosLivres
 * @returns {{data:string, estado:'vaga'|'sem_vaga'|'fechado'|'passado'|'fora_janela', motivo:string|null}[]} um item por dia do mês, em ordem;
 *   em 'fechado' o motivo traz o nome do feriado ou da exceção, para o title da célula
 */
export function diasComVaga(isoMes, candidato, opcoes = {}) {
  /* Aceita '2026-09' além de uma data completa do mês. */
  if (typeof isoMes === 'string' && /^\d{4}-\d{2}$/.test(isoMes)) isoMes += '-01';
  if (!isoMes || !util.dataValida(util.inicioMes(isoMes))) return [];
  const cand = candidato || {};
  const base = baseDeRecursos();
  const agoraMs = opcoes.agoraMs == null ? Date.now() : opcoes.agoraMs;
  const agora = new Date(agoraMs);
  const hoje = util.isoDe(agora);
  const agoraMinutos = agora.getHours() * 60 + agora.getMinutes();
  const tipo = cand.tipoId ? dados.tipoPorId(cand.tipoId) : null;
  const setorId = cand.setorId || (tipo ? tipo.setorPadrao : undefined);
  const janela = janelaInterna(base.config, tipo, hoje);
  const primeiro = util.inicioMes(isoMes);
  const total = util.diasNoMes(primeiro);
  const saida = [];
  for (let d = 0; d < total; d++) {
    const data = util.addDias(primeiro, d);
    if (data < hoje) { saida.push({ data, estado: 'passado', motivo: null }); continue; }
    if (!faixasCom(base.config, data, setorId).length) {
      const fechado = motivoDiaFechado(data, setorId);
      saida.push({ data, estado: 'fechado', motivo: fechado ? (fechado.nome || fechado.texto) : null });
      continue;
    }
    if (data > janela.limite && !opcoes.mostrarAssimMesmo) { saida.push({ data, estado: 'fora_janela', motivo: janela.texto }); continue; }
    const chave = chaveDaVaga(data, cand, opcoes, hoje, agoraMinutos);
    if (!memoVaga.has(chave)) {
      if (memoVaga.size >= MEMO_VAGA_MAX) memoVaga.clear();
      const ctx = contextoDoDia(base, data, opcoes.ignorarId || cand.id || null);
      const lista = horariosDoContexto(ctx, cand, opcoes, true);
      const temVaga = lista.length > 0 && lista[lista.length - 1].estado === 'livre';
      const ocupado = lista.find((x) => x.estado === 'ocupado') || lista.find((x) => x.codigo === 'antecedencia');
      memoVaga.set(chave, { estado: temVaga ? 'vaga' : 'sem_vaga', motivo: temVaga ? null : (ocupado ? ocupado.motivo : 'Sem horário livre neste dia') });
    }
    saida.push(Object.assign({ data }, memoVaga.get(chave)));
  }
  return saida;
}

/* ---------------- Horário de funcionamento e escala ---------------- */

/** Faixas limpas ({de, ate} em ordem, sem sobreposição) de um valor v1 ({de, ate}) ou v2 (array). Sempre array. */
function faixasDe(valor) {
  return dados.normalizarFaixas(valor, null) || [];
}

/** O intervalo [ini, fim] em minutos cabe inteiro dentro de uma das faixas. */
function cabeEmFaixas(faixas, ini, fim) {
  return (faixas || []).some((f) => ini >= min(f.de) && fim <= min(f.ate));
}

function excecaoEm(config, iso) {
  return (config.excecoes || []).find((x) => x && x.data === iso) || null;
}

function feriadoEm(config, iso) {
  return (config.feriados || []).find((f) => f && f.data === iso && f.ativo !== false) || null;
}

/** Faixas do dia com a config já lida (o que faixasDoDia faz, sem reler a config a cada chamada). */
function faixasCom(config, iso, setorId) {
  if (!iso) return [];
  const excecao = excecaoEm(config, iso);
  if (excecao) {
    if (excecao.fechado) return [];
    const proprias = faixasDe(excecao.faixas);
    if (proprias.length) return proprias;
  }
  if (!excecao && feriadoEm(config, iso)) return [];
  const geral = faixasDe((config.horario || {})[DIAS_CHAVE[util.diaSemana(iso)]]);
  if (!geral.length) return [];
  const proprio = setorId && config.horariosSetor ? faixasDe(config.horariosSetor[setorId]) : [];
  return proprio.length ? proprio : geral;
}

/**
 * Exceção por data da loja (DIRECAO 5.2): véspera de Natal, feirão, mutirão, inventário.
 * @param {string} iso @returns {{id:string, data:string, fechado:boolean, faixas:{de:string, ate:string}[], nome:string}|null}
 */
export function excecaoDoDia(iso) {
  const x = excecaoEm(cfg(), iso);
  return x ? Object.assign({}, x, { faixas: faixasDe(x.faixas) }) : null;
}

/**
 * Faixas de funcionamento do dia, em ordem. O almoço é o vão entre duas faixas.
 * Precedência: exceção da data (fechada, ou com faixas próprias, que valem até em domingo e feriado), feriado ativo,
 * horário do dia da semana; em dia aberto comum, o horário próprio do setor substitui o geral.
 * @param {string} iso @param {string} [setorId] @returns {{de:string, ate:string}[]} vazio em dia fechado
 */
export function faixasDoDia(iso, setorId) {
  return faixasCom(cfg(), iso, setorId);
}

/**
 * {de, ate} da união das faixas do dia: abertura da primeira, fechamento da última (compatível com a v1).
 * Feriado, exceção fechada e dia fechado devolvem null. Quem precisa do almoço usa faixasDoDia.
 * @param {string} iso @param {string} [setorId] @returns {{de:string, ate:string}|null}
 */
export function horarioDoDia(iso, setorId) {
  const faixas = faixasDoDia(iso, setorId);
  return faixas.length ? { de: faixas[0].de, ate: faixas[faixas.length - 1].ate } : null;
}

/* Recuo quando nem os sete dias anteriores têm faixa (config vazia antes do seed). */
const FAIXAS_RECUO = [{ de: '08:00', ate: '12:00' }, { de: '13:30', ate: '18:30' }];

/**
 * Período vira hora sem mentir (DIRECAO-2 2.3), a partir das faixas do dia: manhã é a primeira faixa (08:00 às 12:00
 * no seed), tarde é a última (13:30 às 18:30) ou, em dia de faixa única, a metade final dela (sábado 10:30 às 12:30),
 * dia todo vai da abertura ao fechamento. Dia fechado (domingo, feriado, exceção) não bloqueia o registro: usa as faixas
 * do último dia aberto conhecido e devolve `fechado: true` para a tela avisar.
 * @param {string} iso @param {'manha'|'tarde'|'dia'|'hora'} periodo @param {string} [setorId]
 * @returns {{horaInicio:string, horaFim:string, fechado:boolean}|null} null em 'hora' (a hora é a que a pessoa escolheu)
 */
export function horasDoPeriodo(iso, periodo, setorId) {
  if (!iso || !periodo || periodo === 'hora') return null;
  const config = cfg();
  let faixas = faixasCom(config, iso, setorId);
  const fechado = !faixas.length;
  if (fechado) {
    for (let d = 1; d <= 7 && !faixas.length; d++) faixas = faixasCom(config, util.addDias(iso, -d), setorId);
    if (!faixas.length) faixas = FAIXAS_RECUO;
  }
  const primeira = faixas[0];
  const ultima = faixas[faixas.length - 1];
  if (periodo === 'manha') return { horaInicio: primeira.de, horaFim: primeira.ate, fechado };
  if (periodo === 'tarde') {
    if (faixas.length > 1) return { horaInicio: ultima.de, horaFim: ultima.ate, fechado };
    const meio = util.arredondarMin((min(ultima.de) + min(ultima.ate)) / 2, 30, 'perto');
    return { horaInicio: util.minParaHora(meio), horaFim: ultima.ate, fechado };
  }
  return { horaInicio: primeira.de, horaFim: ultima.ate, fechado };
}

/**
 * Por que o dia está fechado, pronto para mostrar. null em dia aberto.
 * @param {string} iso @param {string} [setorId] @returns {{rotulo:string, texto:string, nome:string|null}|null}
 */
export function motivoDiaFechado(iso, setorId) {
  const config = cfg();
  if (faixasCom(config, iso, setorId).length) return null;
  const excecao = excecaoEm(config, iso);
  if (excecao) return { rotulo: 'Fechado', texto: excecao.nome ? 'Fechado: ' + excecao.nome : 'Loja fechada nesta data', nome: excecao.nome || null };
  const feriado = feriadoEm(config, iso);
  if (feriado) return { rotulo: 'Feriado', texto: 'Feriado: ' + feriado.nome, nome: feriado.nome };
  const nomeDia = NOMES_DIA[util.diaSemana(iso)];
  return { rotulo: nomeDia, texto: nomeDia + ': loja fechada', nome: null };
}

/**
 * Faixas em que o carro sai no dia. null quer dizer que o carro segue a loja (veiculo.horario nulo); array vazio, que não sai.
 * @param {object|null} veiculo @param {string} iso @returns {{de:string, ate:string}[]|null}
 */
export function faixasDoVeiculo(veiculo, iso) {
  if (!veiculo || !veiculo.horario || typeof veiculo.horario !== 'object') return null;
  return faixasDe(veiculo.horario[DIAS_CHAVE[util.diaSemana(iso)]]);
}

/** União (menor de, maior ate) dos horários dos setores visíveis; null em dia fechado. */
function horarioUniao(iso, setores) {
  if (!setores || !setores.length) return horarioDoDia(iso);
  let uniao = null;
  for (const s of setores) {
    const h = horarioDoDia(iso, s);
    if (!h) continue;
    if (!uniao) uniao = { de: h.de, ate: h.ate };
    else {
      if (min(h.de) < min(uniao.de)) uniao.de = h.de;
      if (min(h.ate) > min(uniao.ate)) uniao.ate = h.ate;
    }
  }
  return uniao;
}

/** @param {string} iso @returns {boolean} */
export function diaFechado(iso) {
  return horarioDoDia(iso) === null;
}

/** Feriado ativo na data (feriado desligado em Disponibilidade não conta). @param {string} iso @returns {{data:string, nome:string}|null} */
export function ehFeriado(iso) {
  return feriadoEm(cfg(), iso);
}

/** @param {string} iso @param {string} hora @param {string} [setorId] @returns {boolean} */
export function lojaAberta(iso, hora, setorId) {
  const h = horarioDoDia(iso, setorId);
  if (!h) return false;
  const m = min(hora);
  return m >= min(h.de) && m <= min(h.ate);
}

/**
 * Faixa de horas inteiras da grade (7.3): horário do dia (união dos setores), estendida para cobrir a lista, 30 min de folga, mínimo 8 h.
 * @param {string} iso @param {object[]} lista agendamentos a cobrir @param {string[]} [setores] ids visíveis
 * @returns {{hIni:number, hFim:number, fechado:boolean}}
 */
export function faixaGrade(iso, lista, setores) {
  const horario = horarioUniao(iso, setores);
  const itens = (lista || []).filter((a) => a && a.horaInicio && a.horaFim);
  if (!horario && !itens.length) return { hIni: 8, hFim: 12, fechado: true };
  let ini = horario ? min(horario.de) - 30 : 8 * 60;
  let fim = horario ? min(horario.ate) + 30 : 12 * 60;
  for (const a of itens) {
    ini = Math.min(ini, min(a.horaInicio) - 30);
    fim = Math.max(fim, Math.max(min(a.horaFim), min(a.horaInicio) + 30) + 30);
  }
  let hIni = Math.max(0, Math.floor(ini / 60));
  let hFim = Math.min(24, Math.ceil(fim / 60));
  if (hFim - hIni < 8) hFim = Math.min(24, hIni + 8);
  if (hFim - hIni < 8) hIni = Math.max(0, hFim - 8);
  return { hIni, hFim, fechado: !horario };
}

/** 'manha' (< 13:00), 'tarde' (< 18:00) ou 'noite'. @param {string} horaInicio @returns {string} */
export function derivarPeriodo(horaInicio) {
  const m = min(horaInicio);
  if (m < 13 * 60) return 'manha';
  if (m < 18 * 60) return 'tarde';
  return 'noite';
}

/** @param {{horaInicio:string, horaFim:string}} a @returns {number} minutos (mínimo 0) */
export function duracaoMin(a) {
  if (!a) return 0;
  return Math.max(0, min(a.horaFim) - min(a.horaInicio));
}

function excecaoDaEscala(usuario, iso) {
  const e = usuario && usuario.escala;
  return (e && Array.isArray(e.excecoes) ? e.excecoes : []).find((x) => x && x.data === iso) || null;
}

/**
 * Faixas da escala do usuário no dia. Exceção da data com faixas próprias vence; senão o dia da semana
 * (escala.seg a escala.sex quando existirem, com recuo para seg_sex; sab; dom). Aceita {de, ate} ou array de faixas.
 * @param {object} usuario @param {string} iso @returns {{de:string, ate:string}[]} vazio sem turno
 */
export function faixasEscalaDoDia(usuario, iso) {
  if (!usuario || !iso) return [];
  const e = usuario.escala || ESCALA_PADRAO;
  const excecao = excecaoDaEscala(usuario, iso);
  if (excecao) {
    if (excecao.fechado) return [];
    const proprias = faixasDe(excecao.faixas);
    if (proprias.length) return proprias;
  }
  const dow = util.diaSemana(iso);
  const chave = DIAS_CHAVE[dow];
  const valor = dow === 0 ? e.dom : dow === 6 ? e.sab : (e[chave] !== undefined ? e[chave] : e.seg_sex);
  return faixasDe(valor);
}

/** Faixa da escala do usuário no dia (união das faixas) ou null. @param {object} usuario @param {string} iso @returns {{de:string, ate:string}|null} */
export function escalaDoDia(usuario, iso) {
  const faixas = faixasEscalaDoDia(usuario, iso);
  return faixas.length ? { de: faixas[0].de, ate: faixas[faixas.length - 1].ate } : null;
}

/** @param {object} usuario @param {string} iso @returns {boolean} data em escala.folgas ou em exceção fechada da escala */
export function emFolga(usuario, iso) {
  if (!usuario || !usuario.escala) return false;
  if ((usuario.escala.folgas || []).includes(iso)) return true;
  const excecao = excecaoDaEscala(usuario, iso);
  return !!(excecao && excecao.fechado);
}

/** Ativo, não ausente, com faixa no dia, sem folga e hora dentro da faixa. @param {object} usuario @param {string} iso @param {string} hora @returns {boolean} */
export function estaDeServico(usuario, iso, hora) {
  if (!usuario || !usuario.ativo || usuario.status === 'ausente') return false;
  if (emFolga(usuario, iso)) return false;
  const faixa = escalaDoDia(usuario, iso);
  if (!faixa) return false;
  const m = min(hora);
  return m >= min(faixa.de) && m <= min(faixa.ate);
}

/* ---------------- Presença do dia: "Onde estou" (DIRECAO-3, seção 2) ---------------- */

const STATUS_EM_SERVICO = ['em_andamento', 'a_caminho'];

/** Hora em que o status do registro mudou, se foi no próprio dia; senão a hora de início. */
function desdeDoServico(a, iso) {
  if (typeof a.alteradoEm === 'number' && a.alteradoEm > 0) {
    const d = new Date(a.alteradoEm);
    if (util.isoDe(d) === iso) return util.fmtHora(a.alteradoEm);
  }
  return a.horaInicio || '';
}

/** Ativo, não ausente, não é conta compartilhada, sem folga e com faixa de escala no dia: é quem o quadro conta (3.4). */
function deTurno(u, iso) {
  return !!u && u.ativo !== false && !u.contaCompartilhada && u.status !== 'ausente' && !emFolga(u, iso) && !!escalaDoDia(u, iso);
}

/**
 * Onde a pessoa está no dia, com a precedência da 2.2, o primeiro que casar vence:
 * 1. serviço acontecendo agora (responsável ou equipe de um registro `em_andamento` ou `a_caminho` do dia):
 *    `lugar: 'servico'`, `origem: 'automatico'`, `servicoId`, `desde` é a hora em que o status mudou. O check-in gravado
 *    não é apagado: quando o serviço termina, ele volta a valer sozinho;
 * 2. check-in explícito do dia, o documento de `presencas` (`origem` 'app', 'whatsapp' ou 'automatico');
 * 3. folga da escala ou `usuario.status === 'ausente'`: `lugar: 'folga'`, `origem: 'escala'`. É o único lugar em que o
 *    "Meu status" da tela Conta manda;
 * 4. nada: null, e a pessoa cai em "Sem aviso".
 * Pura: tudo pode vir por `ctx` (`usuario`, `agendamentos` do dia, `presenca` ou `presencas` do dia); sem `ctx`, lê de dados.
 * @param {string} userId @param {string} iso @param {number} [agora] instante em ms, só para desempatar dois serviços
 * @param {{usuario?:object, agendamentos?:object[], presenca?:object|null, presencas?:object[]}} [ctx]
 * @returns {{lugar:string, lugarTexto:string, desde:string, origem:string, servicoId:string|null}|null}
 */
export function presencaEfetiva(userId, iso, agora, ctx = {}) {
  if (!userId || !iso) return null;
  const u = ctx.usuario || dados.usuarioPorId(userId);
  if (!u) return null;
  const registros = Array.isArray(ctx.agendamentos) ? ctx.agendamentos : dados.agendamentosDoDia(iso);
  const agoraMin = agora == null ? util.agoraMin() : (agora > MINUTOS_DIA ? instanteEm(agora).minutos : agora);
  const emServico = registros
    .filter((a) => a && a.data === iso && STATUS_EM_SERVICO.includes(a.status) && expandirPessoas(a).has(userId))
    .sort((a, b) => (a.status === 'em_andamento' ? 0 : 1) - (b.status === 'em_andamento' ? 0 : 1)
      || Math.abs(min(a.horaInicio) - agoraMin) - Math.abs(min(b.horaInicio) - agoraMin)
      || String(a.id).localeCompare(String(b.id)));
  if (emServico.length) {
    const a = emServico[0];
    return { lugar: 'servico', lugarTexto: '', desde: desdeDoServico(a, iso), origem: 'automatico', servicoId: a.id };
  }
  let p = ctx.presenca;
  if (p === undefined) p = Array.isArray(ctx.presencas) ? (ctx.presencas.find((x) => x.userId === userId && x.data === iso) || null) : dados.presencaDoDia(userId, iso);
  if (p && p.lugar && p.lugar !== 'servico') {
    return { lugar: p.lugar, lugarTexto: String(p.lugarTexto || ''), desde: String(p.desde || ''), origem: p.origem || 'app', servicoId: p.servicoId || null };
  }
  if (emFolga(u, iso) || u.status === 'ausente') return { lugar: 'folga', lugarTexto: '', desde: '', origem: 'escala', servicoId: null };
  return null;
}

/**
 * Pessoas de campo de turno no dia (ativas, não ausentes, sem folga, com faixa de escala, nunca conta compartilhada).
 * É a unidade dos números grandes do quadro (3.4). @param {string} iso @param {object[]} [pessoas] @returns {object[]}
 */
export function pessoasDeTurno(iso, pessoas) {
  return (pessoas || dados.usuariosCampo()).filter((u) => deTurno(u, iso)).sort(util.porNome);
}

/**
 * De turno hoje, sem registro e sem presença: a mesma conta de semRegistroHoje (agenda.js), que não muda, mais a condição
 * de não ter dito onde está (3.4 e 3.5). Conta compartilhada não entra porque não tem turno (6.2).
 * @param {string} iso @param {object[]} [lista] agendamentos do dia @param {object[]} [presencas] presenças do dia
 * @returns {object[]} ordenadas por nome
 */
export function pessoasSemAviso(iso, lista, presencas) {
  const registros = Array.isArray(lista) ? lista : dados.agendamentosDoDia(iso);
  const pres = Array.isArray(presencas) ? presencas : dados.presencasDoDia(iso);
  const registraram = new Set();
  for (const a of registros) {
    if (!a || a.status === 'cancelado') continue;
    if (a.criadoPor) registraram.add(a.criadoPor);
    for (const id of expandirPessoas(a)) registraram.add(id);
  }
  const avisaram = new Set(pres.filter((p) => p && p.data === iso && p.lugar && p.lugar !== 'servico').map((p) => p.userId));
  return pessoasDeTurno(iso).filter((p) => !registraram.has(p.id) && !avisaram.has(p.id));
}

/**
 * A presença efetiva de cada pessoa de turno no dia, num mapa userId para o resultado de presencaEfetiva (null para
 * "Sem aviso"). Lê os registros e as presenças do dia uma vez só, para o quadro não repetir a leitura por pessoa.
 * @param {string} iso @param {number} [agora] @param {object[]} [pessoas] @returns {Map<string, object|null>}
 */
export function presencasEfetivasDoDia(iso, agora, pessoas) {
  const agendamentos = dados.agendamentosDoDia(iso);
  const presencas = dados.presencasDoDia(iso);
  const mapa = new Map();
  for (const u of pessoas || pessoasDeTurno(iso)) mapa.set(u.id, presencaEfetiva(u.id, iso, agora, { usuario: u, agendamentos, presencas }));
  return mapa;
}

/* ---------------- Estado derivado, atraso, alertas ---------------- */

const ESTADOS_RECURSO = {
  indisponivel: { rotulo: 'Indisponível', classe: 'estado-indisponivel' },
  em_servico: { rotulo: 'Em serviço', classe: 'estado-em-servico' },
  a_caminho: { rotulo: 'A caminho', classe: 'estado-a-caminho' },
  reservado: { rotulo: 'Reservado', classe: 'estado-reservado' },
  livre: { rotulo: 'Livre', classe: 'estado-livre' }
};

function estadoDe(estado, agendamentoId) {
  return Object.assign({ estado, agendamentoId: agendamentoId || null }, ESTADOS_RECURSO[estado]);
}

/** Precedência comum a veículo e equipe sobre os agendamentos ativos do dia que usam o recurso. */
function estadoPorAgendamentos(usaRecurso, iso, agoraMin) {
  const ativos = ativosDoDia(iso, null).filter(usaRecurso);
  const cobre = (a) => min(a.horaInicio) <= agoraMin && agoraMin < min(a.horaFim);
  const emServico = ativos.find((a) => a.status === 'em_andamento') || ativos.find(cobre);
  if (emServico) return estadoDe('em_servico', emServico.id);
  const aCaminho = ativos.find((a) => a.status === 'a_caminho');
  if (aCaminho) return estadoDe('a_caminho', aCaminho.id);
  const reservado = ativos.find((a) => STATUS_RESERVA.includes(a.status) && min(a.horaInicio) >= agoraMin && min(a.horaInicio) - agoraMin <= 30);
  if (reservado) return estadoDe('reservado', reservado.id);
  return estadoDe('livre', null);
}

function instanteEm(instanteMs) {
  const d = new Date(instanteMs == null ? Date.now() : instanteMs);
  return { iso: util.isoDe(d), hora: util.minParaHora(d.getHours() * 60 + d.getMinutes()), minutos: d.getHours() * 60 + d.getMinutes() };
}

/** Precedência: indisponivel, em_servico, a_caminho, reservado (próximos 30 min), livre (6.9). @param {string} veiculoId @param {number} [instanteMs] @returns {{estado:string, rotulo:string, classe:string, agendamentoId:string|null}} */
export function estadoVeiculo(veiculoId, instanteMs) {
  const agora = instanteEm(instanteMs);
  if (indisponibilidadeNoInstante(veiculoId, agora.iso, agora.hora)) return estadoDe('indisponivel', null);
  return estadoPorAgendamentos((a) => a.veiculoId === veiculoId, agora.iso, agora.minutos);
}

/** Igual ao veículo, sem indisponivel. @param {string} equipeId @param {number} [instanteMs] @returns {{estado:string, rotulo:string, classe:string, agendamentoId:string|null}} */
export function estadoEquipe(equipeId, instanteMs) {
  const agora = instanteEm(instanteMs);
  const membros = membrosDe(equipeId);
  const usa = (a) => a.equipeId === equipeId || (membros.length > 0 && membros.every((m) => (a.responsaveis || []).includes(m)));
  return estadoPorAgendamentos(usa, agora.iso, agora.minutos);
}

/** Atraso derivado (6.8). Só serviços de hoje; datas passadas com status ativo são 'passado_aberto' em precisaAtencao, nunca atraso. @param {object} agendamento @param {number} [agoraMs] @returns {{minutos:number, tipo:'inicio'|'fim'}|null} */
export function atrasoDe(agendamento, agoraMs) {
  if (!agendamento) return null;
  const c = cfg();
  const agora = agoraMs == null ? Date.now() : agoraMs;
  const hoje = util.isoDe(new Date(agora));
  if (agendamento.data !== hoje) return null;
  if (STATUS_ATRASO_INICIO.includes(agendamento.status)) {
    /* Registro por período (DIRECAO-2 D2) não prometeu hora de início: "tarde" começando às 14:40 não é atraso. */
    if (aproximado(agendamento)) return null;
    const passados = Math.floor((agora - util.msDe(agendamento.data, agendamento.horaInicio)) / 60000);
    return passados >= c.atrasoInicioMin ? { minutos: passados, tipo: 'inicio' } : null;
  }
  if (agendamento.status === 'em_andamento') {
    const passados = Math.floor((agora - util.msDe(agendamento.data, agendamento.horaFim)) / 60000);
    return passados >= c.atrasoFimMin ? { minutos: passados, tipo: 'fim' } : null;
  }
  return null;
}

function carroIndisponivel(a) {
  return statusAtivo(a.status) && !!a.veiculoId && indisponibilidadesCruzando(a.veiculoId, a.data, a.horaInicio, a.horaFim).length > 0;
}

const ordemDataHora = (a, b) => util.compararISO(a.data, b.data) || (a.horaInicio || '').localeCompare(b.horaInicio || '') || String(a.id).localeCompare(String(b.id));

/**
 * Contadores da faixa de alertas (6.10), sobre os agendamentos visíveis ao usuário.
 * @param {object} usuario @param {string} iso
 * @returns {{conflitos:object[], atrasados:object[], aguardandoAmanha:object[], carroIndisponivelComServico:object[], liberacoesPendentes:object[]}}
 */
export function alertasOperacao(usuario, iso) {
  const hoje = util.hojeISO();
  const base = iso || hoje;
  const visiveis = (lista) => dados.agendamentosVisiveis(lista, usuario);
  const conflitos = [];
  for (let d = 0; d <= 7; d++) {
    const data = util.addDias(base, d);
    const lista = dados.agendamentosDoDia(data);
    if (!lista.length) continue;
    const mapa = conflitosDoDia(data, lista);
    for (const a of visiveis(lista)) if (mapa.has(a.id)) conflitos.push(a);
  }
  const agora = Date.now();
  const atrasados = visiveis(dados.agendamentosDoDia(hoje)).filter((a) => atrasoDe(a, agora));
  const aguardandoAmanha = visiveis(dados.agendamentosDoDia(util.addDias(hoje, 1))).filter((a) => a.status === 'aguardando_conf' || a.status === 'reagendado');
  const carroIndisponivelComServico = visiveis(dados.agendamentosEntre(hoje, util.addDias(hoje, 30))).filter(carroIndisponivel);
  const liberacoesPendentes = visiveis(dados.repo.listar('agendamentos', (a) => statusAtivo(a.status) && liberacaoPendente(a))).sort(ordemDataHora);
  return { conflitos, atrasados, aguardandoAmanha, carroIndisponivelComServico, liberacoesPendentes };
}

const ACOES_ATENCAO = {
  passado_aberto: ['reagendar', 'naoRealizado'],
  atrasado: ['avisarAtraso', 'abrir'],
  nao_realizado_sem_sucessor: ['duplicar'],
  liberacao_pendente: ['abrir'],
  conflito: ['abrir'],
  aguardando_amanha: ['confirmar'],
  carro_indisponivel: ['trocarCarro']
};
const MOTIVOS_ATENDENTE = ['passado_aberto', 'nao_realizado_sem_sucessor', 'aguardando_amanha'];

/**
 * Itens da seção "Precisa de atenção" (6.10), cada agendamento uma vez, no primeiro motivo.
 * @param {object} usuario @returns {{agendamento:object, motivo:string, acoes:string[]}[]}
 */
export function precisaAtencao(usuario) {
  if (!usuario || usuario.perfil === 'campo') return [];
  const hoje = util.hojeISO();
  const alertas = alertasOperacao(usuario, hoje);
  const passados = dados.agendamentosVisiveis(dados.repo.listar('agendamentos', (a) => a.data < hoje), usuario);
  const grupos = [
    ['passado_aberto', passados.filter((a) => statusAtivo(a.status))],
    ['atrasado', alertas.atrasados],
    ['nao_realizado_sem_sucessor', passados.filter((a) => a.status === 'nao_realizado' && !a.sucessorId && a.data >= util.addDias(hoje, -30))],
    ['liberacao_pendente', alertas.liberacoesPendentes],
    ['conflito', alertas.conflitos],
    ['aguardando_amanha', alertas.aguardandoAmanha],
    ['carro_indisponivel', alertas.carroIndisponivelComServico]
  ];
  const permitidos = dados.ehGestao(usuario) ? null : MOTIVOS_ATENDENTE;
  const vistos = new Set();
  const saida = [];
  for (const [motivo, lista] of grupos) {
    if (permitidos && !permitidos.includes(motivo)) continue;
    for (const a of lista.slice().sort(ordemDataHora)) {
      if (vistos.has(a.id)) continue;
      vistos.add(a.id);
      saida.push({ agendamento: a, motivo, acoes: ACOES_ATENCAO[motivo].slice() });
    }
  }
  return saida;
}

/** Carga de um dia para cabeçalhos: total e contagem por veículo. @param {string} iso @param {object[]} [lista] @returns {{total:number, porVeiculo:Object<string,number>, semCarro:number, texto:string}} texto ex. "5 serviços, Fiorino 3, Baú 1" */
export function cargaDoDia(iso, lista) {
  const itens = (lista || dados.agendamentosDoDia(iso)).filter((a) => a.status !== 'cancelado');
  const porVeiculo = {};
  let semCarro = 0;
  for (const a of itens) {
    if (a.veiculoId) porVeiculo[a.veiculoId] = (porVeiculo[a.veiculoId] || 0) + 1;
    else semCarro += 1;
  }
  const total = itens.length;
  const partes = [total === 0 ? 'Sem serviços' : total === 1 ? '1 serviço' : total + ' serviços'];
  for (const v of dados.veiculosAtivos()) if (porVeiculo[v.id]) partes.push((v.apelido || v.nome) + ' ' + porVeiculo[v.id]);
  return { total, porVeiculo, semCarro, texto: partes.join(', ') };
}

/**
 * Lanes por cluster com expansão (6.13).
 * @param {{id:string, horaInicio:string, horaFim:string}[]} lista
 * @returns {Map<string, {lane:number, total:number, span:number}>}
 */
export function lanes(lista) {
  const eventos = (lista || []).map((a) => {
    const ini = min(a.horaInicio);
    let fim = min(a.horaFim);
    if (fim <= ini) fim = ini + 30;
    return { id: a.id, ini, fim, lane: 0 };
  }).sort((a, b) => a.ini - b.ini || (b.fim - b.ini) - (a.fim - a.ini) || String(a.id).localeCompare(String(b.id)));

  const mapa = new Map();
  let ativos = [];
  let cluster = [];
  const fechar = () => {
    if (!cluster.length) return;
    const total = Math.max(...cluster.map((e) => e.lane)) + 1;
    for (const e of cluster) {
      let span = 1;
      for (let l = e.lane + 1; l < total; l++) {
        const ocupada = cluster.some((o) => o.lane === l && sobrepoe(e.ini, e.fim, o.ini, o.fim));
        if (ocupada) break;
        span += 1;
      }
      mapa.set(e.id, { lane: e.lane, total, span });
    }
    cluster = [];
  };

  for (const e of eventos) {
    ativos = ativos.filter((o) => o.fim > e.ini);
    if (!ativos.length) fechar();
    const usadas = new Set(ativos.map((o) => o.lane));
    let lane = 0;
    while (usadas.has(lane)) lane += 1;
    e.lane = lane;
    ativos.push(e);
    cluster.push(e);
  }
  fechar();
  return mapa;
}
