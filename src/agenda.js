/* Green Agenda, módulo agenda: src/agenda.js
   Telas Hoje (#/hoje, o feed do dia), Serviços agendados
   (#/servicos/:aba) e Calendário (#/agenda/:modo/:data) com as visões Dia,
   Semana, Mês e Recursos, mais os filtros, os avisos de operação, a navegação
   de datas e o estado da agenda por usuário.
   Importa cartaoServico e as ações de src/agendamento.js; nunca o contrário.
   Ver ESPECIFICACAO.md, seções 3.3, 6.10 e 7.

   Redesenho de 18/09/2026 (docs/redesign/DIRECAO.md, lote 4). O que mudou:
   - nasceu #/servicos/:aba (3.2), a tela principal de gestão e atendimento,
     com as abas Próximos, Pendentes, Passados e Período, busca no topo,
     agrupamento por data, linha de 72 px (88 no celular), detalhe que expande
     na própria linha e exportação em CSV (4.12);
   - a visão Lista saiu do Calendário: #/agenda/lista/:data continua
     respondendo e redireciona para #/servicos/periodo com a data como início,
     porque há link antigo para ela;
   - o topo do Calendário virou a faixa única de 56 px (3.3): o seletor de
     visão é um menu, e "Filtros" e "Avisos" são botões com contador, no lugar
     das cinco pílulas, dos chips de filtro e da faixa fixa de alertas;
   - Meu dia (3.7): os contadores em número grande viraram uma linha de texto e
     o bloco "Agora" só aparece quando há alguém em campo.

   Direção 2 de 22/09/2026 (docs/redesign/DIRECAO-2.md, lote 3). O que mudou:
   - nasceu #/hoje, o feed do dia (seção 4), tela inicial de todos os perfis: o
     grupo de WhatsApp virado app, com o agrupamento Por hora e Por pessoa, o
     cartão do registro, o chip de status enxuto e o botão de próximo passo;
   - Meu dia saiu: #/meu-dia redireciona para #/hoje. O que era bom nela
     continua dentro do feed (o grupo "Meus" do perfil campo, a reordenação da
     rota e a linha "Amanhã" no rodapé);
   - a troca de status de um toque passa por regras.aplicarStatusSimples, com
     toast de Desfazer por 5 segundos e folha de motivo só em Não realizado;
   - paridade com o grupo (decisão do dono sobre a dúvida 2 da seção 10): no
     feed, todo perfil vê os registros de todo mundo, com cliente e local
     (dados.visivelNoFeed). A restrição de setor continua valendo para editar,
     para mudar status e para as demais telas;
   - a linha de Serviços agendados e o item do Mês passam a usar
     dados.nomeDoServico, nomeDoCliente e localDe, e mostram o rótulo simples
     de status; o CSV continua exportando o rótulo interno.

   Direção 3 de 24/09/2026 (docs/redesign/DIRECAO-3.md, lote 3). O que mudou:
   - a tela Hoje ganhou a terceira vista, o Quadro (seção 3): pessoas agrupadas
     pelo lugar onde estão, quatro números grandes que contam gente, o bloco
     "Sem aviso" com os dois botões de pedir a agenda e a linha do dia;
   - nasceu a faixa "Onde estou" (2.5), primeira coisa da tela em todas as
     vistas e para todo perfil: um toque grava a presença do dia, e a gerência
     pode marcar por quem avisou por telefone;
   - o padrão da tela passou a ser por perfil (3.1): a gestão abre no Quadro, o
     atendimento e o campo abrem em Por hora, e ?ver=quadro|hora|pessoa vence a
     preferência sem gravá-la;
   - o quadro conta PESSOAS e o feed conta REGISTROS, e a unidade está escrita
     na tela, porque são duas leituras do mesmo dia (2.2).

   Convenções internas:
   - A tela Calendário monta o cabeçalho com montarCabecalho e escreve no alvo
     um envoltório [data-visao] onde a visão do modo é renderizada por
     visaoDia, visaoSemana, visaoMes ou visaoRecursos.
   - O estado que precisa sobreviver ao rerender (busca, páginas, linhas
     expandidas, modo reordenar do feed) vive em `estadoTela`, em memória.
   - Ações de cartão, de linha e de bloco são delegadas a
     agendamento.executarAcao; a agenda só decide rota, data e recurso. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as regras from './regras.js';
import * as ui from './ui.js';
import { icone } from './icones.js';
import * as grade from './grade.js';
import * as agendamento from './agendamento.js';
import * as whatsapp from './whatsapp.js';

const { esc } = util;

const LARGURA_TABLET = 720;
const DIAS_PERIODO = 30;
const PAGINA_SERVICOS = 50;
/* Em Serviços agendados o grupo abre com três linhas; o resto fica atrás de um botão. */
const DECISAO_RESUMIDA = 3;
const MINUTOS_ANTES_AGORA = 45;
/* Feed de Hoje (DIRECAO-2, seção 4). */
const MS_DESFAZER = 5000;
const MAX_NOMES_AUSENTES = 6;

/* As quatro visões do Calendário (3.3). A Lista saiu daqui e virou a tela
   Serviços agendados; MODO_LISTA só sobrevive como rota antiga que redireciona. */
const MODOS = [
  { id: 'dia', rotulo: 'Dia', tecla: 'D', icone: 'calendario' },
  { id: 'semana', rotulo: 'Semana', tecla: 'S', icone: 'grade' },
  { id: 'mes', rotulo: 'Mês', tecla: 'M', icone: 'calendario' },
  { id: 'recursos', rotulo: 'Recursos', tecla: 'R', icone: 'caminhao' }
];
const MODO_LISTA = 'lista';
const MODOS_CAMPO = ['dia', 'semana'];

/* Abas de recorte da tela Serviços agendados (3.2). */
const ABAS_SERVICOS = [
  { id: 'proximos', rotulo: 'Próximos' },
  { id: 'pendentes', rotulo: 'Pendentes' },
  { id: 'passados', rotulo: 'Passados' },
  { id: 'periodo', rotulo: 'Período' }
];
const ABA_SERVICOS_PADRAO = 'proximos';
const EIXOS = [
  { id: 'veiculos', rotulo: 'Veículos' },
  { id: 'equipes', rotulo: 'Equipes' },
  { id: 'pessoas', rotulo: 'Pessoas' }
];
const CHAVES_FILTRO = ['setor', 'tipo', 'status', 'carro', 'equipe', 'pessoa'];
const ROTULOS_FILTRO = { setor: 'Setor', tipo: 'Tipo', status: 'Status', carro: 'Carro', equipe: 'Equipe', pessoa: 'Pessoa' };
const ALERTAS = [
  { chave: 'conflitos', rotulo: 'Conflitos' },
  { chave: 'atrasados', rotulo: 'Atrasados' },
  { chave: 'aguardandoAmanha', rotulo: 'Aguardando confirmação amanhã' },
  { chave: 'carroIndisponivelComServico', rotulo: 'Carro indisponível com serviço' },
  { chave: 'liberacoesPendentes', rotulo: 'Liberações pendentes' }
];
const ROTULO_ATENCAO = {
  passado_aberto: (a) => 'Pendente de ' + util.fmtData(a.data).slice(0, 5),
  atrasado: () => 'Atrasado',
  nao_realizado_sem_sucessor: () => 'Não realizado, sem nova data',
  liberacao_pendente: () => 'Liberação pendente',
  conflito: () => 'Em conflito',
  aguardando_amanha: () => 'Aguardando confirmação para amanhã',
  carro_indisponivel: () => 'Carro indisponível no horário'
};
const PERIODOS = [
  { id: 'manha', rotulo: 'Manhã' },
  { id: 'tarde', rotulo: 'Tarde' },
  { id: 'noite', rotulo: 'Noite' }
];
const ATALHOS_AGENDA = ['ArrowLeft', 'ArrowRight', 'T', 'D', 'S', 'M', 'L', 'R', 'F'];

/** Rótulo e ícone das ações que cabem dentro da linha de serviço (3.2). */
const ACOES_LINHA = {
  abrir: { rotulo: 'Abrir', icone: 'direita' },
  confirmar: { rotulo: 'Confirmar', icone: 'check' },
  reagendar: { rotulo: 'Reagendar', icone: 'sincronizar' },
  naoRealizado: { rotulo: 'Não realizado', icone: 'alerta' },
  duplicar: { rotulo: 'Duplicar', icone: 'duplicar' },
  avisarAtraso: { rotulo: 'Avisar atraso', icone: 'relogio' },
  trocarCarro: { rotulo: 'Trocar carro', icone: 'caminhao' },
  cancelar: { rotulo: 'Cancelar', icone: 'ban' }
};

/** Marca de ordem de byte na frente do CSV: é o que faz o Excel brasileiro abrir o arquivo com acento certo (4.12). */
const BOM_EXCEL = String.fromCharCode(0xfeff);

/** Estado de interface que sobrevive ao rerender disparado por dados:alterado. */
const estadoTela = { busca: '', paginas: 1, abaServicos: null, expandidos: [], decisaoAberta: false, reordenar: false, ordemTemp: [], atalhosLigados: false, ondeTrocar: false };

/* ================================================================== */
/* Apoio                                                               */
/* ================================================================== */

const min = (hora) => util.horaParaMin(hora);
const ehISO = (texto) => util.dataValida(texto);
const largura = () => window.innerWidth;
const ehCelular = () => largura() < LARGURA_TABLET;
const { ehDesktop, abrirJanela } = ui;
const usuarioDe = (ctx) => (ctx && ctx.usuario) || dados.sessao.usuario();
const ehPerfilCampo = (u) => !!u && u.perfil === 'campo';
const { plural, nomeCurto, classeCarro } = util;
const idsSetores = (u) => dados.setoresVisiveis(u).map((s) => s.id);
const naoCancelado = (a) => a.status !== 'cancelado';
const porHora = (x, y) => String(x.horaInicio || '').localeCompare(String(y.horaInicio || '')) || String(x.id).localeCompare(String(y.id));
const porDataHora = (x, y) => util.compararISO(x.data, y.data) || porHora(x, y);

const nomeCurtoDe = (id) => { const u = dados.usuarioPorId(id); return u ? nomeCurto(u.nome) : ''; };

/** "sexta-feira, 18 de setembro" com a inicial maiúscula, para começo de título e de frase. */
const maiusculaInicial = (texto) => { const t = String(texto || ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };

function inicialCarro(veiculo) {
  return String(veiculo.inicial || (veiculo.apelido || veiculo.nome || '?')[0]).toUpperCase();
}

function configViva() {
  let c = null;
  try { c = dados.repo.config(); } catch (e) { c = null; }
  return Object.assign({ slotMin: 30, duracaoPadraoMin: 90, almoco: null }, c || {});
}

/** Lista visível ao usuário no dia, sem cancelados, pela regra de setor de dados.visivel. */
function visiveisDoDia(iso, u) {
  return dados.agendamentosVisiveis(dados.agendamentosDoDia(iso), u).filter(naoCancelado);
}

/** Rota de uma visão do Calendário. */
function rotaDe(modo, data, eixo, query) {
  const base = modo === 'recursos' ? '#/agenda/recursos/' + data + '/' + (eixo || 'veiculos') : '#/agenda/' + modo + '/' + data;
  return base + ui.montarQuery(query || {});
}

/** Rota de uma aba da tela Serviços agendados (3.2). */
function rotaServicos(aba, query) {
  return '#/servicos/' + (ABAS_SERVICOS.some((x) => x.id === aba) ? aba : ABA_SERVICOS_PADRAO) + ui.montarQuery(query || {});
}

/** Move a data em foco conforme o modo (7.2). */
function moverData(modo, data, n) {
  if (modo === 'semana') return util.addDias(data, 7 * n);
  if (modo === 'mes') return util.addMeses(data, n);
  return util.addDias(data, n);
}

function primeiroHorarioLivre(data) {
  const h = regras.horarioDoDia(data);
  if (!h) return null;
  const dur = Number(configViva().duracaoPadraoMin) || 90;
  const candidato = { data, horaInicio: h.de, horaFim: util.minParaHora(min(h.de) + dur), responsaveis: [], equipeId: null, veiculoId: null, tipoId: null, setorId: null };
  try {
    const opcoes = regras.sugerirHorarios(candidato, { maxOpcoes: 1, diasAdiante: 0 });
    if (opcoes.length && opcoes[0].data === data) return opcoes[0].horaInicio;
  } catch (e) { /* cai na abertura */ }
  return h.de;
}

/** Indisponibilidades do veículo recortadas no dia, no formato da grade. */
function indisponibilidadesNoDia(veiculoId, iso) {
  return dados.indisponibilidadesDoVeiculo(veiculoId, iso, iso).map((i) => {
    const de = util.partesIsoHora(i.de);
    const ate = util.partesIsoHora(i.ate);
    const m = dados.MOTIVOS_INDISPONIBILIDADE.find((x) => x.id === i.motivo);
    return {
      id: i.id,
      de: de.data < iso ? '00:00' : de.hora,
      ate: ate.data > iso ? '23:59' : ate.hora,
      texto: i.detalhe || (m ? m.rotulo : 'Indisponível')
    };
  });
}

/** O veículo está indisponível o dia inteiro. */
function indisponivelDiaInteiro(veiculoId, iso) {
  return dados.indisponibilidadesDoVeiculo(veiculoId, iso, iso).some((i) => i.de <= iso + 'T00:00' && i.ate >= iso + 'T23:59');
}

/* ================================================================== */
/* Estado da agenda por usuário (3.3)                                  */
/* ================================================================== */

function normalizarFiltros(filtros) {
  const saida = {};
  for (const chave of CHAVES_FILTRO) {
    const v = filtros && filtros[chave];
    saida[chave] = Array.isArray(v) ? v.filter(Boolean).map(String) : (v ? [String(v)] : []);
  }
  return saida;
}

function qtdFiltros(filtros) {
  return CHAVES_FILTRO.reduce((n, chave) => n + ((filtros[chave] || []).length ? 1 : 0), 0);
}

function semFiltro(chave, filtros) {
  const copia = normalizarFiltros(filtros);
  copia[chave] = [];
  return copia;
}

/**
 * Estado persistido da agenda do usuário (modo, eixo, filtros, alertasRecolhidos) com padrão do perfil (3.3).
 * @param {object} usuario @returns {{modo:string, eixo:string, filtros:object, alertasRecolhidos:boolean, modoSalvo:boolean}}
 */
export function estadoAgenda(usuario) {
  const u = usuario || dados.sessao.usuario();
  const base = u ? (dados.prefs(u.id).agenda || {}) : {};
  let modo = MODOS.some((m) => m.id === base.modo) ? base.modo : 'dia';
  if (ehPerfilCampo(u) && !MODOS_CAMPO.includes(modo)) modo = 'dia';
  if (modo === 'recursos' && !dados.pode('verRecursos', u)) modo = 'dia';
  return {
    modo,
    eixo: EIXOS.some((e) => e.id === base.eixo) ? base.eixo : 'veiculos',
    filtros: ehPerfilCampo(u) ? normalizarFiltros({}) : normalizarFiltros(base.filtros),
    alertasRecolhidos: !!base.alertasRecolhidos,
    modoSalvo: !!base.modoSalvo
  };
}

/** @param {object} usuario @param {object} mudancas Efeitos: dados.salvarPrefs. */
export function salvarEstadoAgenda(usuario, mudancas) {
  const u = usuario || dados.sessao.usuario();
  if (!u) return;
  const m = Object.assign({}, mudancas || {});
  if (m.filtros) m.filtros = normalizarFiltros(m.filtros);
  dados.salvarPrefs(u.id, { agenda: m });
}

/**
 * Tela padrão de abertura por perfil e largura (3.3 e 3.2). Gestão e atendimento
 * abrem em Serviços agendados, que é a tela de trabalho; o campo abre no Dia.
 * @param {object} usuario @param {number} largura @returns {string} rota
 */
export function rotaAgendaPadrao(usuario, larguraTela) {
  const hoje = util.hojeISO();
  const u = usuario || dados.sessao.usuario();
  const desktop = Number(larguraTela) >= ui.LARGURA_DESKTOP;
  const perfil = u ? u.perfil : 'atendente';
  if (perfil === 'campo') return rotaDe('dia', hoje);
  if (perfil === 'atendente' || perfil === 'financeiro' || dados.ehGestao(u)) return rotaServicos(ABA_SERVICOS_PADRAO);
  return desktop ? rotaDe('semana', hoje) : rotaDe('dia', hoje);
}

/**
 * Rota do Calendário ao entrar por #/agenda: o modo guardado do usuário ou uma
 * visão de grade pela largura. Nunca a tela de Serviços, senão o item
 * "Calendário" da barra cairia na tela do item de cima.
 */
function rotaAgendaInicial(usuario) {
  const e = estadoAgenda(usuario);
  const hoje = util.hojeISO();
  if (e.modoSalvo) return rotaDe(e.modo, hoje, e.eixo);
  if (ehPerfilCampo(usuario || dados.sessao.usuario())) return rotaDe('dia', hoje);
  return largura() >= ui.LARGURA_DESKTOP ? rotaDe('semana', hoje) : rotaDe('dia', hoje);
}

/* ================================================================== */
/* Filtros (7.2)                                                       */
/* ================================================================== */

/**
 * Lista visível ao usuário e aprovada pelos filtros (cancelados só com filtro de status).
 * @param {object[]} lista @param {object} usuario @param {object} filtros @returns {object[]}
 */
export function agendamentosFiltrados(lista, usuario, filtros) {
  const u = usuario || dados.sessao.usuario();
  const f = normalizarFiltros(filtros);
  const mostraCancelados = f.status.includes('cancelado');
  return (lista || []).filter((a) => {
    if (!a || !dados.visivel(a, u)) return false;
    if (a.status === 'cancelado' && !mostraCancelados) return false;
    if (f.setor.length && !f.setor.includes(a.setorId)) return false;
    if (f.tipo.length && !f.tipo.includes(a.tipoId)) return false;
    if (f.status.length && !f.status.includes(a.status)) return false;
    if (f.carro.length && !f.carro.includes(a.veiculoId || '')) return false;
    if (f.equipe.length && !f.equipe.includes(a.equipeId || '')) return false;
    if (f.pessoa.length) {
      const pessoas = regras.expandirPessoas(a);
      if (!f.pessoa.some((id) => pessoas.has(id))) return false;
    }
    return true;
  });
}

function pessoasParaFiltro(usuario) {
  const hoje = util.hojeISO();
  const comServico = new Set();
  for (const a of dados.agendamentosEntre(util.addDias(hoje, -30), util.addDias(hoje, 60))) {
    if (!dados.visivel(a, usuario)) continue;
    for (const id of regras.expandirPessoas(a)) comServico.add(id);
  }
  return dados.usuariosAtivos().filter((u) => u.campo || comServico.has(u.id));
}

function rotuloValorFiltro(chave, valor) {
  if (chave === 'setor') return dados.setorPorId(valor).nome;
  if (chave === 'tipo') { const t = dados.tipoPorId(valor); return t ? t.nome : valor; }
  if (chave === 'status') return (dados.STATUS[valor] || {}).rotulo || valor;
  if (chave === 'carro') { const v = dados.veiculoPorId(valor); return v ? (v.apelido || v.nome) : valor; }
  if (chave === 'equipe') { const e = dados.equipePorId(valor); return e ? (e.apelido || e.nome) : valor; }
  if (chave === 'pessoa') return nomeCurtoDe(valor) || valor;
  return valor;
}

const soMeusAtivo = (filtros, u) => !!u && filtros.pessoa.length === 1 && filtros.pessoa[0] === u.id;

/**
 * "Filtros" como botão com contador para o cabeçalho de 56 px (3.1). Os chips de
 * filtro ativo saíram do topo: o número no botão diz quantos recortes estão
 * valendo e a folha mostra quais. O perfil campo não filtra.
 */
function botaoFiltrosHTML(u, filtros) {
  if (ehPerfilCampo(u)) return '';
  const n = qtdFiltros(filtros);
  const resumo = n ? resumoFiltros(filtros, u) : '';
  return '<button type="button" class="botao-contador" data-acao="filtros"' + (n ? ' data-ativo' : '') +
    ' aria-label="' + esc('Filtros' + (n ? ', ' + resumo : ', nenhum ativo')) + '"' + (resumo ? ' title="' + esc(resumo) + '"' : '') + '>' +
    icone('filtro', 18) + '<span class="botao-contador-rotulo">Filtros</span>' +
    (n ? '<span class="botao-contador-num">' + n + '</span>' : '') + '</button>';
}

/** Texto dos filtros ativos, para o title e o aria-label do botão. */
function resumoFiltros(filtros, u) {
  const partes = [];
  if (soMeusAtivo(filtros, u)) partes.push('Só os meus');
  for (const chave of CHAVES_FILTRO) {
    if (chave === 'pessoa' && soMeusAtivo(filtros, u)) continue;
    const valores = (filtros[chave] || []).map((v) => rotuloValorFiltro(chave, v));
    if (valores.length) partes.push(ROTULOS_FILTRO[chave] + ': ' + valores.join(', '));
  }
  return partes.join('. ');
}

function grupoFiltroHTML(chave, rotulo, opcoes, escolhidos) {
  if (!opcoes.length) return '';
  const chips = opcoes.map((o) => {
    const ativo = escolhidos.includes(o.id);
    return '<button type="button" class="chip chip-escolha" data-acao="alternar-filtro" data-chave="' + esc(chave) + '" data-valor="' + esc(o.id) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '"' + (ativo ? ' data-ativo' : '') + '>' +
      '<span class="chip-rotulo">' + esc(o.rotulo) + '</span>' + (o.sub ? '<span class="chip-motivo">' + esc(o.sub) + '</span>' : '') + '</button>';
  }).join('');
  return '<div class="campo"><span class="campo-rotulo">' + esc(rotulo) + '</span><div class="chips-escolha" role="group" aria-label="' + esc(rotulo) + '">' + chips + '</div></div>';
}

/** Sheet de filtros; ao aplicar grava em prefs e re-renderiza. @param {object} usuario @param {object} filtros */
export function abrirFiltros(usuario, filtros) {
  const u = usuario || dados.sessao.usuario();
  if (!u || ehPerfilCampo(u)) return;
  const escolha = normalizarFiltros(filtros);
  const grupos = [
    ['setor', 'Setor', dados.setoresVisiveis(u).map((s) => ({ id: s.id, rotulo: s.nome }))],
    ['tipo', 'Tipo de serviço', dados.tiposAtivos().map((t) => ({ id: t.id, rotulo: t.nome }))],
    ['status', 'Status', Object.values(dados.STATUS).map((s) => ({ id: s.id, rotulo: s.rotulo }))],
    ['carro', 'Carro', dados.veiculosAtivos().map((v) => ({ id: v.id, rotulo: v.apelido || v.nome }))],
    ['equipe', 'Equipe', dados.equipesAtivas().map((e) => ({ id: e.id, rotulo: e.apelido || e.nome }))],
    ['pessoa', 'Pessoa', pessoasParaFiltro(u).map((p) => ({ id: p.id, rotulo: p.nome, sub: p.cargo }))]
  ];
  /* "Só os meus" era um chip do topo; com o cabeçalho de uma linha ele passa a
     morar aqui, como atalho para o filtro de pessoa (3.1). */
  const atalhoMeus = '<div class="campo"><span class="campo-rotulo">Atalho</span><div class="chips-escolha" role="group" aria-label="Atalho">' +
    '<button type="button" class="chip chip-escolha" data-acao="so-meus-sheet" aria-pressed="' + (soMeusAtivo(escolha, u) ? 'true' : 'false') + '"' + (soMeusAtivo(escolha, u) ? ' data-ativo' : '') + '>' +
    '<span class="chip-rotulo">Só os meus serviços</span></button></div></div>';
  const corpo = atalhoMeus + grupos.map(([chave, rotulo, opcoes]) => grupoFiltroHTML(chave, rotulo, opcoes, escolha[chave])).join('') +
    '<p class="campo-ajuda">Os filtros combinam entre si e valem no Calendário e em Serviços agendados. Cancelados só aparecem quando o status Cancelado está marcado.</p>';
  const rodape = '<button type="button" class="btn btn-fantasma" data-acao="limpar-filtros">Limpar</button>' +
    '<button type="button" class="btn btn-primario" data-acao="aplicar-filtros">Aplicar</button>';
  const { el, fechar } = ui.abrirSheet({ titulo: 'Filtrar agenda', corpo, rodape });
  ui.delegar(el, '[data-acao]', 'click', (acao, alvo) => {
    if (acao === 'alternar-filtro') {
      const chave = alvo.getAttribute('data-chave');
      const valor = alvo.getAttribute('data-valor');
      const lista = escolha[chave] || [];
      const i = lista.indexOf(valor);
      if (i >= 0) lista.splice(i, 1); else lista.push(valor);
      escolha[chave] = lista;
      const ativo = i < 0;
      alvo.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      if (ativo) alvo.setAttribute('data-ativo', ''); else alvo.removeAttribute('data-ativo');
      const meus = el.querySelector('[data-acao="so-meus-sheet"]');
      if (meus && chave === 'pessoa') {
        const ligado = soMeusAtivo(escolha, u);
        meus.setAttribute('aria-pressed', ligado ? 'true' : 'false');
        if (ligado) meus.setAttribute('data-ativo', ''); else meus.removeAttribute('data-ativo');
      }
    } else if (acao === 'so-meus-sheet') {
      const ligado = !soMeusAtivo(escolha, u);
      escolha.pessoa = ligado ? [u.id] : [];
      alvo.setAttribute('aria-pressed', ligado ? 'true' : 'false');
      if (ligado) alvo.setAttribute('data-ativo', ''); else alvo.removeAttribute('data-ativo');
      el.querySelectorAll('[data-acao="alternar-filtro"][data-chave="pessoa"]').forEach((botao) => {
        const marcado = escolha.pessoa.includes(botao.getAttribute('data-valor'));
        botao.setAttribute('aria-pressed', marcado ? 'true' : 'false');
        if (marcado) botao.setAttribute('data-ativo', ''); else botao.removeAttribute('data-ativo');
      });
    } else if (acao === 'limpar-filtros') {
      salvarEstadoAgenda(u, { filtros: normalizarFiltros({}) });
      fechar();
      ui.rerender();
    } else if (acao === 'aplicar-filtros') {
      salvarEstadoAgenda(u, { filtros: escolha });
      fechar();
      ui.rerender();
    }
  });
}

/* ================================================================== */
/* Avisos de operação (7.8 e DIRECAO 3.1)                              */
/* ================================================================== */

/** Contagem de cada alerta com serviço, na ordem de ALERTAS. */
function avisosDe(u, iso) {
  if (!u || !dados.ehGestao(u)) return [];
  const alertas = regras.alertasOperacao(u, iso || util.hojeISO());
  return ALERTAS.map((al) => ({ chave: al.chave, rotulo: al.rotulo, qtd: (alertas[al.chave] || []).length })).filter((x) => x.qtd > 0);
}

/**
 * "Avisos" como botão com contador (3.1). A faixa fixa de chips saiu do topo:
 * quatro chips presos em toda visita são imposto sobre o uso normal.
 * @param {object} usuario @param {string} iso @returns {string} '' quando não há aviso
 */
export function botaoAvisosHTML(usuario, iso) {
  const itens = avisosDe(usuario || dados.sessao.usuario(), iso);
  if (!itens.length) return '';
  const total = itens.reduce((n, x) => n + x.qtd, 0);
  return '<button type="button" class="botao-contador" data-tom="alerta" data-acao="avisos" aria-haspopup="dialog" aria-label="' +
    esc(plural(total, 'aviso de operação', 'avisos de operação') + '. Ver a lista') + '">' +
    icone('alerta', 18) + '<span class="botao-contador-rotulo">Avisos</span>' +
    '<span class="botao-contador-num">' + total + '</span></button>';
}

/** Folha com os avisos de operação; cada linha leva à lista daquele aviso. @param {object} usuario @param {string} iso */
export function abrirAvisos(usuario, iso) {
  const u = usuario || dados.sessao.usuario();
  const itens = avisosDe(u, iso);
  if (!itens.length) { ui.toast('Nenhum aviso de operação agora', 'info'); return; }
  const corpo = '<div class="lista sheet-lista-acoes">' + itens.map((x) =>
    '<button type="button" class="item" data-acao="ver-aviso" data-valor="' + esc(x.chave) + '">' +
    '<span class="item-icone">' + icone('alerta', 20) + '</span>' +
    '<span class="item-corpo"><span class="item-titulo">' + esc(x.rotulo) + '</span>' +
    '<span class="item-sub">' + esc(plural(x.qtd, 'serviço', 'serviços')) + '</span></span>' +
    icone('direita', 18) + '</button>'
  ).join('') + '</div>' +
    '<p class="campo-ajuda">Cada aviso abre a lista de serviços correspondente, já recortada.</p>';
  const { el, fechar } = ui.abrirSheet({ titulo: 'Avisos de operação', corpo });
  ui.delegar(el, '[data-acao="ver-aviso"]', 'click', (acao, alvo) => {
    fechar();
    ui.irPara(rotaServicos(ABA_SERVICOS_PADRAO, { atencao: alvo.getAttribute('data-valor') }));
  });
}

/* ================================================================== */
/* Navegação de datas (7.2)                                            */
/* ================================================================== */

function rotuloSemana(iso) {
  const ini = util.inicioSemana(iso);
  const fim = util.addDias(ini, 6);
  const dIni = util.dataDe(ini);
  const dFim = util.dataDe(fim);
  if (dIni.getMonth() === dFim.getMonth()) return dIni.getDate() + ' a ' + dFim.getDate() + ' de ' + util.MESES_ABR[dIni.getMonth()];
  return dIni.getDate() + ' de ' + util.MESES_ABR[dIni.getMonth()] + ' a ' + dFim.getDate() + ' de ' + util.MESES_ABR[dFim.getMonth()];
}

function rotuloNav(modo, data) {
  if (modo === 'semana') return rotuloSemana(data);
  if (modo === 'mes') { const d = util.dataDe(data); return util.MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
  return util.rotuloDia(data);
}

function dataEhHoje(modo, data) {
  const hoje = util.hojeISO();
  if (modo === 'semana') return util.inicioSemana(data) === util.inicioSemana(hoje);
  if (modo === 'mes') return data.slice(0, 7) === hoje.slice(0, 7);
  return data === hoje;
}

/** HTML da navegação de datas (7.2). @param {{modo:string, data:string}} estado @returns {string} */
export function navDatas(estado) {
  const modo = estado && estado.modo ? estado.modo : 'dia';
  const data = estado && ehISO(estado.data) ? estado.data : util.hojeISO();
  const passo = modo === 'semana' ? 'Semana' : modo === 'mes' ? 'Mês' : 'Dia';
  return '<div class="nav-datas">' +
    '<button type="button" class="btn-icone" data-acao="nav-anterior" aria-label="' + esc(passo + ' anterior') + '">' + icone('voltar', 22) + '</button>' +
    '<button type="button" class="nav-datas-rotulo" data-acao="nav-rotulo" aria-label="' + esc(rotuloNav(modo, data) + '. Ir para uma data') + '" title="Ir para uma data">' + esc(rotuloNav(modo, data)) + '</button>' +
    '<button type="button" class="btn-icone" data-acao="nav-seguinte" aria-label="' + esc(passo + ' seguinte') + '">' + icone('direita', 22) + '</button>' +
    '<button type="button" class="btn-hoje" data-acao="nav-hoje"' + (dataEhHoje(modo, data) ? ' data-hoje' : '') + '>Hoje</button>' +
    '</div>';
}

/* ================================================================== */
/* Registro de rotas                                                   */
/* ================================================================== */

/**
 * Registra as rotas #/hoje, #/meu-dia (redirecionamento), #/servicos,
 * #/servicos/:aba, #/agenda, #/agenda/:modo/:data e
 * #/agenda/recursos/:data/:eixo (3.1 e 3.2, mais DIRECAO-2 4.1 e 4.6), com
 * relogio: true onde o tempo muda o que a tela mostra. Quem chama: app.iniciar.
 */
export function registrarTelasAgenda() {
  ui.registrarRota('#/hoje', { render: telaHoje, titulo: 'Hoje', relogio: true });
  ui.registrarRota('#/meu-dia', { render: telaMeuDia, titulo: 'Hoje', relogio: true });
  ui.registrarRota('#/servicos', { render: telaServicosRedirecionar, titulo: 'Serviços agendados' });
  ui.registrarRota('#/servicos/:aba', { render: telaServicos, titulo: 'Serviços agendados', relogio: true });
  ui.registrarRota('#/agenda', { render: telaAgendaRedirecionar, titulo: 'Calendário' });
  ui.registrarRota('#/agenda/:modo/:data', { render: telaAgenda, titulo: 'Calendário', relogio: true });
  ui.registrarRota('#/agenda/recursos/:data/:eixo', { render: telaAgenda, titulo: 'Calendário', relogio: true, requer: ['verRecursos'] });
  if (!registrarTelasAgenda.ligado) {
    registrarTelasAgenda.ligado = true;
    document.addEventListener('rota:alterada', (ev) => {
      const rota = ev.detail && ev.detail.rota ? ev.detail.rota : '';
      if (!rota.startsWith('#/agenda')) desligarAtalhos();
      if (!rota.startsWith('#/servicos')) { estadoTela.busca = ''; estadoTela.paginas = 1; estadoTela.abaServicos = null; estadoTela.expandidos = []; }
      if (rota !== '#/hoje' && rota !== '#/meu-dia') { estadoTela.reordenar = false; estadoTela.ordemTemp = []; }
      /* A faixa "Onde estou" volta ao estado de leitura ao sair da tela: "Trocar" é um gesto do momento, não preferência. */
      if (rota !== '#/hoje' && rota !== '#/meu-dia') estadoTela.ondeTrocar = false;
    });
  }
}

function telaAgendaRedirecionar(ctx) {
  ui.irPara(rotaAgendaInicial(usuarioDe(ctx)), { substituir: true });
}

function telaServicosRedirecionar(ctx) {
  ui.irPara(rotaServicos(ABA_SERVICOS_PADRAO, (ctx && ctx.query) || {}), { substituir: true });
}

/* ================================================================== */
/* Tela Calendário (7.2 e DIRECAO 3.3)                                 */
/* ================================================================== */

/** Visões que o usuário pode abrir, já com o eixo desdobrado em Recursos. */
function visoesDisponiveis(u) {
  const saida = [];
  for (const m of MODOS) {
    if (ehPerfilCampo(u) && !MODOS_CAMPO.includes(m.id)) continue;
    if (m.id === 'recursos') {
      if (!dados.pode('verRecursos', u)) continue;
      for (const e of EIXOS) saida.push({ modo: 'recursos', eixo: e.id, rotulo: 'Recursos, por ' + e.rotulo.toLowerCase(), icone: m.icone });
      continue;
    }
    saida.push({ modo: m.id, eixo: null, rotulo: m.rotulo, icone: m.icone });
  }
  return saida;
}

function rotuloVisao(modo, eixo) {
  if (modo === 'recursos') {
    const e = EIXOS.find((x) => x.id === eixo);
    return 'Recursos' + (e ? ', ' + e.rotulo.toLowerCase() : '');
  }
  const m = MODOS.find((x) => x.id === modo);
  return m ? m.rotulo : 'Dia';
}

/** Seletor de visão: um menu de 40 px ao lado do título, no lugar das cinco pílulas (3.1). */
function seletorVisaoHTML(modo, eixo) {
  const rotulo = rotuloVisao(modo, eixo);
  const m = MODOS.find((x) => x.id === modo);
  /* No celular "Recursos, veículos" virava "Recursos, ve...": o botão mostra só o eixo, e o nome inteiro fica no aria-label. */
  const eixoAtual = modo === 'recursos' ? EIXOS.find((x) => x.id === eixo) : null;
  const rotuloCurto = eixoAtual && !ehDesktop() ? eixoAtual.rotulo : rotulo;
  return '<button type="button" class="botao-contador seletor-visao" data-acao="seletor-visao" aria-haspopup="dialog" aria-label="' +
    esc('Visão ' + rotulo + '. Trocar de visão') + '">' + icone(m ? m.icone : 'calendario', 18) +
    '<span class="seletor-visao-rotulo">' + esc(rotuloCurto) + '</span>' + icone('baixo', 16) + '</button>';
}

/** Folha de troca de visão, com o eixo de Recursos já dentro dela. */
function abrirSeletorVisao(u, estado) {
  const visoes = visoesDisponiveis(u);
  const atual = (v) => v.modo === estado.modo && (v.modo !== 'recursos' || v.eixo === estado.eixo);
  const corpo = '<div class="lista sheet-lista-acoes">' + visoes.map((v) =>
    '<button type="button" class="item" data-acao="ir-visao" data-valor="' + esc(v.modo) + '" data-eixo="' + esc(v.eixo || '') + '"' +
    (atual(v) ? ' aria-current="true" data-ativo' : '') + '>' +
    '<span class="item-icone">' + icone(v.icone, 20) + '</span>' +
    '<span class="item-corpo"><span class="item-titulo">' + esc(v.rotulo) + '</span></span>' +
    (atual(v) ? icone('check', 18) : '') + '</button>'
  ).join('') + '</div>';
  const { el, fechar } = ui.abrirSheet({ titulo: 'Visão do calendário', corpo });
  ui.delegar(el, '[data-acao="ir-visao"]', 'click', (acao, alvo) => {
    fechar();
    ui.irPara(rotaDe(alvo.getAttribute('data-valor'), estado.data, alvo.getAttribute('data-eixo') || estado.eixo));
  });
}

function ligarAtalhos(u, estado) {
  const { modo, data, eixo } = estado;
  const ir = (novoModo, novaData) => ui.irPara(rotaDe(novoModo, novaData || data, eixo));
  const mapa = {
    ArrowLeft: { descricao: 'Período anterior', acao: () => ir(modo, moverData(modo, data, -1)) },
    ArrowRight: { descricao: 'Período seguinte', acao: () => ir(modo, moverData(modo, data, 1)) },
    T: { descricao: 'Hoje', acao: () => ir(modo, util.hojeISO()) },
    D: { descricao: 'Calendário: Dia', acao: () => ir('dia') },
    S: { descricao: 'Calendário: Semana', acao: () => ir('semana') }
  };
  if (!ehPerfilCampo(u)) {
    mapa.M = { descricao: 'Calendário: Mês', acao: () => ir('mes') };
    mapa.L = { descricao: 'Serviços agendados', acao: () => ui.irPara(rotaServicos(ABA_SERVICOS_PADRAO)) };
    mapa.F = { descricao: 'Filtrar', acao: () => abrirFiltros(u, estadoAgenda(u).filtros) };
    if (dados.pode('verRecursos', u)) mapa.R = { descricao: 'Calendário: Recursos', acao: () => ir('recursos') };
  }
  ui.atalhos.remover(ATALHOS_AGENDA);
  ui.atalhos.registrar(mapa);
  estadoTela.atalhosLigados = true;
}

function desligarAtalhos() {
  if (!estadoTela.atalhosLigados) return;
  ui.atalhos.remover(ATALHOS_AGENDA);
  estadoTela.atalhosLigados = false;
}

function montarFabNovo(u, data) {
  /* No desktop (3.1) o botão primário fica no topo da barra lateral e o atalho N vale em qualquer tela;
     o FAB é só de celular e tablet, e o dourado aparece uma vez por tela (11).
     O rótulo virou "Registrar" (DIRECAO-2 4.7 e 8.2) e o FAB passa a aparecer também para o perfil campo,
     que agora tem criarServico: 'proprios'. O destino continua em ui.rotaAgendar(): o lote 4 troca o
     alvo dela para #/registrar, e nada aqui precisa mudar de novo. */
  if (!dados.pode('criarServico', u) || ehDesktop()) { ui.esconderFab(); return; }
  ui.montarFab({ rotulo: 'Registrar', aoClicar: () => ui.irPara(ui.rotaAgendar() + ui.montarQuery({ data })) });
}

/** Resolve modo, data e eixo a partir dos parâmetros da rota; devolve a rota de correção quando algo não vale. */
function resolverParametros(ctx, u) {
  const params = ctx.params || {};
  const dataOk = ehISO(params.data);
  const data = dataOk ? params.data : util.hojeISO();
  let modo = params.eixo ? 'recursos' : String(params.modo || '');
  let eixo = params.eixo ? String(params.eixo) : estadoAgenda(u).eixo;
  if (!EIXOS.some((e) => e.id === eixo)) eixo = 'veiculos';
  /* A visão Lista virou a tela Serviços agendados (3.2), mas #/agenda/lista/:data
     continua respondendo: há link antigo para ela no seed e nas notificações. A
     data vira o início do período, e o recorte de aviso, se houver, é mantido. */
  if (modo === MODO_LISTA) {
    const q = { de: data, ate: util.addDias(data, DIAS_PERIODO - 1) };
    if (ctx.query && ctx.query.atencao) q.atencao = ctx.query.atencao;
    return { redirecionar: rotaServicos('periodo', q) };
  }
  if (!MODOS.some((m) => m.id === modo)) return { redirecionar: rotaAgendaInicial(u) };
  if (ehPerfilCampo(u) && !MODOS_CAMPO.includes(modo)) return { redirecionar: rotaDe('dia', data) };
  if (modo === 'recursos' && !dados.pode('verRecursos', u)) return { redirecionar: rotaDe('dia', data) };
  if (modo === 'recursos' && !params.eixo) return { redirecionar: rotaDe('recursos', data, eixo) };
  if (!dataOk) return { redirecionar: rotaDe(modo, data, eixo, ctx.query) };
  return { modo, data, eixo };
}

/**
 * Tela Calendário: a faixa única de 56 px (3.3) e o despacho para a visão.
 * No desktop o seletor de visão e a navegação de data cabem na mesma faixa do
 * título; abaixo de 1024 px a navegação desce para uma segunda faixa de 48 px,
 * porque em 375 px o título seria comido pelos controles.
 * @param {{params:{modo:string, data:string, eixo?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaAgenda(ctx) {
  const u = usuarioDe(ctx);
  const alvo = ctx.alvo;
  if (!u) { ui.irPara('#/entrar', { substituir: true }); return; }
  const r = resolverParametros(ctx, u);
  if (r.redirecionar) { ui.irPara(r.redirecionar, { substituir: true }); return; }
  const { modo, data, eixo } = r;
  const query = ctx.query || {};
  const estadoSalvo = estadoAgenda(u);
  if (estadoSalvo.modo !== modo || estadoSalvo.eixo !== eixo || !estadoSalvo.modoSalvo) salvarEstadoAgenda(u, { modo, eixo, modoSalvo: true });
  const filtros = estadoSalvo.filtros;
  const comGrade = modo === 'dia' || modo === 'recursos' || (modo === 'semana' && ehDesktop());
  const desktop = ehDesktop();
  const nav = navDatas({ modo, data });

  const cab = ui.montarCabecalho({
    titulo: 'Calendário',
    acoesSecundarias: seletorVisaoHTML(modo, eixo) + (desktop ? nav : ''),
    acoes: botaoFiltrosHTML(u, filtros) + botaoAvisosHTML(u, util.hojeISO()),
    extra: desktop ? '' : '<div class="cab-linha">' + nav + '</div>'
  });
  if (cab) ligarCabecalhoAgenda(cab, u, { modo, data, eixo, filtros, query });

  if (alvo.id === 'conteudo') alvo.classList.toggle('sem-margem', comGrade);
  const html = '<div class="visao-agenda" data-visao data-modo="' + esc(modo) + '"></div>';
  ui.renderizar(alvo, html, (raiz) => {
    const envoltorio = raiz.querySelector('[data-visao]');
    const ctxVisao = { data, usuario: u, filtros, query, eixo, alvo: envoltorio };
    if (modo === 'dia') visaoDia(ctxVisao);
    else if (modo === 'semana') visaoSemana(ctxVisao);
    else if (modo === 'mes') visaoMes(ctxVisao);
    else visaoRecursos(ctxVisao);
    if (modo !== 'recursos') {
      ui.gestoDeslizar(envoltorio, {
        aoEsquerda: () => ui.irPara(rotaDe(modo, moverData(modo, data, 1), eixo)),
        aoDireita: () => ui.irPara(rotaDe(modo, moverData(modo, data, -1), eixo))
      });
    }
  });
  montarFabNovo(u, data);
  if (ehDesktop()) ligarAtalhos(u, { modo, data, eixo });
}

function ligarCabecalhoAgenda(cab, u, estado) {
  const { modo, data, eixo, filtros } = estado;
  const ir = (novoModo, novaData, novoEixo) => ui.irPara(rotaDe(novoModo, novaData, novoEixo || eixo));
  ui.delegar(cab, '[data-acao]', 'click', (acao, el) => {
    if (acao.startsWith('ui:')) return;
    switch (acao) {
      case 'seletor-visao': abrirSeletorVisao(u, { modo, data, eixo }); break;
      case 'nav-anterior': ir(modo, moverData(modo, data, -1)); break;
      case 'nav-seguinte': ir(modo, moverData(modo, data, 1)); break;
      case 'nav-hoje': ir(modo, util.hojeISO()); break;
      case 'nav-rotulo': ui.seletorMes(data, (iso) => ir(modo, iso)); break;
      case 'filtros': abrirFiltros(u, filtros); break;
      case 'avisos': abrirAvisos(u, util.hojeISO()); break;
      default: break;
    }
  });
  const rotulo = cab.querySelector('[data-acao="nav-rotulo"]');
  if (rotulo) rotulo.addEventListener('dblclick', () => ir(modo, util.hojeISO()));
}

/* ================================================================== */
/* Grade compartilhada pelas visões                                    */
/* ================================================================== */

/** Callbacks comuns da grade (7.3): toque em vão, abrir, conflito, +N, menu rápido e arrasto. */
function callbacksGrade(u, eixo) {
  return {
    aoTocarVao: (info) => {
      if (!dados.pode('criarServico', u)) return;
      const query = { data: info.data, inicio: info.horaInicio };
      if (!info.neutra && info.colunaId) {
        if (info.tipoRecurso === 'veiculo') query.veiculo = info.colunaId;
        if (info.tipoRecurso === 'equipe') query.equipe = info.colunaId;
        if (info.tipoRecurso === 'pessoa') query.resp = info.colunaId;
      }
      ui.irPara('#/servico/novo' + ui.montarQuery(query));
    },
    aoAbrirBloco: (id) => ui.irPara('#/servico/' + id),
    aoAbrirConflito: (id) => ui.irPara('#/servico/' + id + '?foco=conflito'),
    aoAbrirMais: (ids) => agendamento.abrirMaisBlocos(ids),
    aoMenuRapido: (id) => agendamento.abrirMenuRapido(id),
    aoSoltar: (info) => { soltarBloco(info, u, eixo); }
  };
}

function descreverConflitos(conflitos) {
  return conflitos.map((c) => c.rotulo + (c.comTexto ? ': ' + c.comTexto : '')).join('. ');
}

/** Mudança de recurso ao arrastar entre colunas (7.3). Devolve {mudancas, descricao} ou {erro}. */
function mudancaDeColuna(a, info) {
  if (!info.tipoRecurso || info.colunaId === info.colunaOrigemId) return { mudancas: {}, descricao: '' };
  if (info.tipoRecurso === 'veiculo') {
    if (info.neutra) return { mudancas: { veiculoId: null, semCarroConfirmado: true }, descricao: ' sem carro' };
    const v = dados.veiculoPorId(info.colunaId);
    return { mudancas: { veiculoId: info.colunaId, semCarroConfirmado: false }, descricao: v ? ' com a ' + (v.apelido || v.nome) : '' };
  }
  if (info.tipoRecurso === 'equipe') {
    if (info.neutra) return { mudancas: { equipeId: null }, descricao: ' sem equipe' };
    const e = dados.equipePorId(info.colunaId);
    return { mudancas: { equipeId: info.colunaId }, descricao: e ? ' com a ' + (e.nome || e.apelido) : '' };
  }
  if (info.tipoRecurso === 'pessoa') {
    const origem = info.colunaOrigemId;
    const destino = info.colunaId;
    if (!(a.responsaveis || []).includes(origem)) return { erro: 'Essa pessoa vai pela equipe. Para trocar, edite o serviço.' };
    const responsaveis = Array.from(new Set((a.responsaveis || []).map((id) => (id === origem ? destino : id))));
    return { mudancas: { responsaveis }, descricao: ' com ' + nomeCurtoDe(destino) };
  }
  return { mudancas: {}, descricao: '' };
}

/** Ao soltar o bloco arrastado (desktop): diálogo com os conflitos e gravação como edição (6.7). */
async function soltarBloco(info, u) {
  const a = dados.agendamentoPorId(info.agendamentoId);
  if (!a) return;
  if (!regras.acoesDisponiveis(a, u).editar) { ui.toast('Você não pode mover este serviço', 'erro'); return; }
  const troca = mudancaDeColuna(a, info);
  if (troca.erro) { ui.toast(troca.erro, 'erro'); return; }
  const candidato = Object.assign({}, a, { data: info.data, horaInicio: info.horaInicio, horaFim: info.horaFim }, troca.mudancas);
  const conflitos = regras.detectarConflitos(candidato, { ignorarId: a.id });
  const severidade = regras.severidadeMaxima(conflitos);
  if (severidade === 'bloqueio') { ui.toast('Carro indisponível nesse horário: escolha outro carro ou horário', 'erro'); return; }
  const quando = (info.data !== a.data ? util.fmtDataMedia(info.data) + ', ' : '') + info.horaInicio + ' às ' + info.horaFim;
  const texto = 'Mover para ' + quando + troca.descricao + '?' + (conflitos.length ? ' ' + descreverConflitos(conflitos) + '.' : '');
  const ok = await ui.confirmar({ titulo: 'Mover serviço', texto, rotuloOk: 'Mover' });
  if (!ok) return;
  let justificativa = null;
  let pedido = null;
  if (severidade === 'conflito') {
    if (dados.pode('justificarConflito', u)) {
      justificativa = await ui.pedirTexto({ titulo: 'Mover com justificativa', rotulo: 'Justificativa do conflito', obrigatorio: true, multilinha: true, rotuloOk: 'Mover' });
      if (!justificativa) return;
    } else if (dados.pode('pedirLiberacao', u)) {
      pedido = await ui.pedirTexto({ titulo: 'Pedir liberação', rotulo: 'Motivo do pedido', obrigatorio: true, multilinha: true, rotuloOk: 'Pedir liberação' });
      if (!pedido) return;
    } else {
      ui.toast('Há conflito nesse horário: escolha outro horário ou recurso', 'erro');
      return;
    }
  }
  const r = agendamento.salvarServico(candidato, { id: a.id, justificativa, pedirLiberacao: pedido });
  if (!r.ok) { ui.toast(r.erros && r.erros[0] ? r.erros[0].mensagem : 'Não foi possível mover', 'erro'); return; }
  ui.toast('Serviço movido para ' + quando);
}

/** Minuto da rolagem inicial (7.3): hoje, 45 min antes de agora; outro dia, o primeiro serviço ou a abertura. */
function minutoInicial(data, lista, setores) {
  if (data === util.hojeISO()) return util.agoraMin() - MINUTOS_ANTES_AGORA;
  const primeiro = (lista || []).filter((a) => a.horaInicio).sort(porHora)[0];
  if (primeiro) return min(primeiro.horaInicio) - 30;
  const h = regras.horarioDoDia(data, setores && setores.length === 1 ? setores[0] : undefined);
  return h ? min(h.de) : 8 * 60;
}

/**
 * Renderiza uma visão com grade: escreve o HTML com um marcador [data-grade], insere o elemento da grade
 * e restaura a rolagem anterior (rerender) ou aplica a rolagem inicial.
 */
function renderizarComGrade(alvo, html, gradeEl, minutosIniciais, aoMontar) {
  const anterior = alvo.querySelector('.grade-rolagem');
  const rolagem = anterior ? { top: anterior.scrollTop, left: anterior.scrollLeft } : null;
  ui.renderizar(alvo, html, (raiz) => {
    const marcador = raiz.querySelector('[data-grade]');
    if (marcador) marcador.replaceWith(gradeEl);
    const nova = gradeEl.querySelector('.grade-rolagem');
    if (rolagem && nova) { nova.scrollTop = rolagem.top; nova.scrollLeft = rolagem.left; }
    else grade.rolarPara(gradeEl, minutosIniciais);
    if (typeof aoMontar === 'function') aoMontar(raiz);
  });
}

/* ================================================================== */
/* Visão Dia (7.5)                                                     */
/* ================================================================== */

function trechoBarra(ini, fim, faixa) {
  const base = faixa.hIni * 60;
  const total = (faixa.hFim - faixa.hIni) * 60 || 1;
  const esq = util.clamp(((ini - base) / total) * 100, 0, 100);
  const larg = util.clamp(((fim - ini) / total) * 100, 0, 100 - esq);
  return 'left:' + esq.toFixed(2) + '%;width:' + larg.toFixed(2) + '%';
}

function barraDiaHTML(itens, faixa, classeCor) {
  const trechos = itens.map((t) =>
    '<span class="barra-trecho ' + (t.tipo === 'indisp' ? '' : classeCor) + '" data-tipo="' + esc(t.tipo) + '" style="' + trechoBarra(t.ini, t.fim, faixa) + '" title="' + esc(t.texto) + '"></span>'
  ).join('');
  return '<div class="barra-dia" aria-hidden="true">' + trechos + '</div>';
}

function linhaOcupacaoHTML(nomeHTML, estado, itens, faixa, classeCor) {
  return '<div class="ocupacao-linha">' +
    '<div class="ocupacao-nome">' + nomeHTML + '</div>' +
    barraDiaHTML(itens, faixa, classeCor) +
    '<div class="ocupacao-estado"><span class="chip chip-estado ' + esc(estado.classe) + '">' + esc(estado.rotulo) + '</span></div>' +
    '</div>';
}

/** Painel de ocupação do Dia no desktop (7.5): veículos e equipes com barra do dia e estado agora. */
function painelOcupacaoHTML(data, lista, faixa) {
  const ativos = lista.filter((a) => regras.statusAtivo(a.status));
  const trecho = (a, tipo) => ({ tipo, ini: min(a.horaInicio), fim: Math.max(min(a.horaFim), min(a.horaInicio) + 15), texto: regras.descricaoCurta(a) });
  /* "Em serviço" e "A caminho" são estado de AGORA: só valem quando o dia olhado é hoje.
     Em outro dia a coluna mostra a carga do dia (quantos serviços, ou livre). */
  const ehHoje = data === util.hojeISO();
  const estadoDoDia = (itens, agoraFn) => {
    if (ehHoje) return agoraFn();
    const servicos = itens.filter((t) => t.tipo === 'servico').length;
    if (servicos) return { classe: 'estado-reservado', rotulo: plural(servicos, 'serviço', 'serviços') };
    if (itens.some((t) => t.tipo === 'indisp')) return { classe: 'estado-indisponivel', rotulo: 'Indisponível' };
    return { classe: 'estado-livre', rotulo: 'Livre' };
  };
  let html = '<aside class="painel-ocupacao" aria-label="Ocupação do dia">';
  html += '<div class="secao-titulo">Carros</div>';
  for (const v of dados.veiculosAtivos()) {
    const itens = ativos.filter((a) => a.veiculoId === v.id).map((a) => trecho(a, 'servico'))
      .concat(indisponibilidadesNoDia(v.id, data).map((i) => ({ tipo: 'indisp', ini: min(i.de), fim: i.ate === '23:59' ? 24 * 60 : min(i.ate), texto: i.texto })));
    html += linhaOcupacaoHTML(ui.chipCarro(v, { pequeno: true }), estadoDoDia(itens, () => regras.estadoVeiculo(v.id)), itens, faixa, classeCarro(v));
  }
  html += '<div class="secao-titulo mt4">Equipes</div>';
  for (const e of dados.equipesAtivas()) {
    const membros = e.membros || [];
    const usa = (a) => a.equipeId === e.id || (membros.length > 0 && membros.every((m) => (a.responsaveis || []).includes(m)));
    const itens = ativos.filter(usa).map((a) => trecho(a, 'servico'));
    html += linhaOcupacaoHTML('<span class="truncar">' + esc(e.apelido || e.nome) + '</span>', estadoDoDia(itens, () => regras.estadoEquipe(e.id)), itens, faixa, '');
  }
  const semCarro = ativos.filter((a) => !a.veiculoId && (dados.tipoPorId(a.tipoId) || {}).precisaVeiculo === 'sim').length;
  if (semCarro) html += '<div class="sem-carro">' + icone('alerta', 16) + ' Sem carro: ' + semCarro + '</div>';
  return html + '</aside>';
}

/** @param {{data:string, usuario:object, filtros:object, alvo:HTMLElement}} ctx Visão Dia (7.5). */
export function visaoDia(ctx) {
  const u = usuarioDe(ctx);
  const { data, alvo } = ctx;
  const query = ctx.query || {};
  const setores = idsSetores(u);
  const lista = agendamentosFiltrados(dados.agendamentosDoDia(data), u, ctx.filtros);
  const faixa = regras.faixaGrade(data, lista, setores);
  const fechado = regras.diaFechado(data);
  const coluna = {
    id: 'dia', tipoRecurso: 'dia', titulo: util.rotuloDia(data), subtitulo: util.fmtDataExtensa(data), data, hoje: data === util.hojeISO(),
    agendamentos: lista, fechado: fechado && !lista.length,
    vazioTexto: fechado ? 'Loja fechada' : (dados.pode('criarServico', u) ? 'Sem serviços. Toque em um horário para agendar.' : 'Sem serviços neste dia.')
  };
  const gradeEl = grade.montarGrade(Object.assign({
    data, colunas: [coluna], faixa, conflitos: regras.conflitosDoDia(data), mostrarAgora: true, modo: 'dia',
    arrastavel: ehDesktop() && !!dados.pode('editarServico', u), setores, destaqueId: query.novo || null
  }, callbacksGrade(u, null)));
  const desktop = ehDesktop();
  const html = '<div class="visao-dia">' +
    (desktop ? '<div class="visao-dia-desktop"><div data-grade></div>' + painelOcupacaoHTML(data, lista, faixa) + '</div>' : '<div data-grade></div>') +
    '</div>';
  renderizarComGrade(alvo, html, gradeEl, minutoInicial(data, lista, setores));
}

/* ================================================================== */
/* Visão Semana (7.6)                                                  */
/* ================================================================== */

/* As marcas de carro (F, B, S) saíram da fita de dias e do Mês no lote 6
   (DIRECAO 3.3). Eram três moedas por dia, sem legenda em lugar nenhum, que no
   celular ocupavam duas linhas e 42 px da fita, e no Mês viravam 105 marcas
   repetidas numa tela com 8 serviços. Quem precisa saber qual carro sai tem a
   visão Recursos, que existe para isso. O texto continua no aria-label do dia,
   para quem usa leitor de tela. */
function textoMarcasCarro(iso, listaDoDia) {
  return dados.veiculosAtivos().map((v) => {
    const saida = listaDoDia.some((a) => a.veiculoId === v.id && naoCancelado(a));
    const indisp = indisponivelDiaInteiro(v.id, iso);
    return (v.apelido || v.nome) + ' ' + (indisp ? 'indisponível' : saida ? 'com saída' : 'livre');
  }).join(', ');
}

function fitaSemanaHTML(inicio, selecionada, listasPorDia) {
  const hoje = util.hojeISO();
  let html = '<div class="fita-semana" role="tablist" aria-label="Dias da semana">';
  for (let i = 0; i < 7; i++) {
    const iso = util.addDias(inicio, i);
    const lista = listasPorDia.get(iso) || [];
    const qtd = lista.filter(naoCancelado).length;
    const d = util.dataDe(iso);
    const attrs = ['type="button"', 'role="tab"', 'class="fita-dia"', 'data-acao="dia"', 'data-valor="' + iso + '"',
      'aria-selected="' + (iso === selecionada ? 'true' : 'false') + '"',
      'aria-label="' + esc(util.fmtDataExtensa(iso) + ', ' + plural(qtd, 'serviço', 'serviços') + (dados.veiculosAtivos().length ? '. ' + textoMarcasCarro(iso, lista) : '')) + '"'];
    if (iso === hoje) attrs.push('data-hoje');
    if (iso === selecionada) attrs.push('data-ativo');
    if (regras.diaFechado(iso)) attrs.push('data-fechado');
    html += '<button ' + attrs.join(' ') + '>' +
      '<span class="fita-dia-abrev">' + esc(util.DIAS_ABR[d.getDay()]) + '</span>' +
      '<span class="fita-dia-num">' + d.getDate() + '</span>' +
      '<span class="fita-dia-qtd">' + (qtd ? qtd : '') + '</span>' +
      '</button>';
  }
  return html + '</div>';
}

function listaPorPeriodoHTML(lista) {
  const grupos = util.agrupar(lista.slice().sort(porHora), (a) => regras.derivarPeriodo(a.horaInicio));
  return PERIODOS.filter((p) => grupos.has(p.id)).map((p) =>
    '<div class="secao-titulo periodo-cab">' + esc(p.rotulo) + '</div>' + grupos.get(p.id).map((a) => agendamento.cartaoServico(a, { variante: 'lista' })).join('')
  ).join('');
}

function vazioDiaSemanaHTML(iso, u) {
  const fechado = regras.diaFechado(iso);
  const feriado = regras.ehFeriado(iso);
  if (fechado) return ui.estadoVazio({ icone: 'calendario', titulo: 'Loja fechada', texto: feriado ? 'Feriado: ' + feriado.nome : 'Sem serviços neste dia.' });
  const hora = primeiroHorarioLivre(iso);
  const podeCriar = dados.pode('criarServico', u) && hora;
  return ui.estadoVazio({
    icone: 'calendario', titulo: 'Nenhum serviço em ' + util.rotuloDia(iso).toLowerCase(),
    texto: podeCriar ? 'O dia está livre.' : 'Escolha outro dia na fita acima.',
    acao: podeCriar ? { rotulo: 'Agendar às ' + hora, acao: 'agendar-em', valor: iso + 'T' + hora } : null
  });
}

/** Carga do dia em forma curta para caber na coluna da semana: "5 serviços · F3 B1 S1" (iniciais das marcas de carro). */
function cargaCurta(carga) {
  const total = carga.total === 0 ? 'Sem serviços' : carga.total === 1 ? '1 serviço' : carga.total + ' serviços';
  const carros = dados.veiculosAtivos().filter((v) => carga.porVeiculo[v.id]).map((v) => inicialCarro(v) + carga.porVeiculo[v.id]);
  return carros.length ? total + '\u00a0· ' + carros.join(' ') : total;
}

/** Cabeçalho de coluna da semana no desktop (7.6): "seg 7" com o número em Playfair e a carga do dia, com o texto completo no title. */
function cabecalhoDiaSemanaHTML(iso, carga) {
  const d = util.dataDe(iso);
  return '<span class="grade-cab-titulo"><span>' + esc(util.DIAS_ABR[d.getDay()]) + '</span> <span class="grade-cab-num">' + d.getDate() + '</span></span>' +
    '<span class="grade-cab-sub" title="' + esc(carga.texto) + '">' + esc(cargaCurta(carga)) + '</span>';
}

function semanaDesktop(ctx, inicio, listasPorDia) {
  const u = usuarioDe(ctx);
  const { data, alvo } = ctx;
  const query = ctx.query || {};
  const setores = idsSetores(u);
  const hoje = util.hojeISO();
  const conflitos = new Map();
  const colunas = [];
  let hIni = 24;
  let hFim = 0;
  let todos = [];
  for (let i = 0; i < 7; i++) {
    const iso = util.addDias(inicio, i);
    const lista = listasPorDia.get(iso) || [];
    todos = todos.concat(lista);
    const faixaDia = regras.faixaGrade(iso, lista, setores);
    hIni = Math.min(hIni, faixaDia.hIni);
    hFim = Math.max(hFim, faixaDia.hFim);
    if (lista.length) for (const [id, c] of regras.conflitosDoDia(iso)) conflitos.set(id, c);
    const fechado = regras.diaFechado(iso);
    const carga = regras.cargaDoDia(iso, lista);
    colunas.push({
      /* O título entra no aria-label do botão da coluna ("Abrir ter 15 set, 5 serviços, Fiorino 3"), então leva a carga completa. */
      id: iso, tipoRecurso: 'dia', titulo: util.fmtDataMedia(iso) + ', ' + carga.texto, data: iso, hoje: iso === hoje, agendamentos: lista,
      fechado: fechado && !lista.length, cabecalhoHTML: cabecalhoDiaSemanaHTML(iso, carga),
      vazioTexto: fechado ? 'Loja fechada' : ''
    });
  }
  const gradeEl = grade.montarGrade(Object.assign({
    data, colunas, faixa: { hIni, hFim }, conflitos, mostrarAgora: true, modo: 'semana',
    arrastavel: !!dados.pode('editarServico', u), setores, destaqueId: query.novo || null,
    aoClicarCabecalho: (iso) => ui.irPara(rotaDe('dia', iso))
  }, callbacksGrade(u, null)));
  const listaFoco = listasPorDia.get(data) || [];
  renderizarComGrade(alvo, '<div class="visao-grade"><div data-grade></div></div>', gradeEl, minutoInicial(data, listaFoco.length ? listaFoco : todos, setores));
}

function semanaCelular(ctx, inicio, listasPorDia) {
  const u = usuarioDe(ctx);
  const { data, alvo } = ctx;
  const lista = listasPorDia.get(data) || [];
  const html = fitaSemanaHTML(inicio, data, listasPorDia) +
    '<div class="secao"><div class="secao-cab"><h2 class="dia-cab"' + (data === util.hojeISO() ? ' data-hoje' : '') + '>' + esc(util.rotuloDia(data)) + ' <small class="dia-cab-qtd">' + esc(plural(lista.length, 'serviço', 'serviços')) + '</small></h2></div>' +
    (lista.length ? listaPorPeriodoHTML(lista) : vazioDiaSemanaHTML(data, u)) + '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      if (acao === 'dia') { ui.irPara(rotaDe('semana', el.getAttribute('data-valor'))); return; }
      if (acao === 'agendar-em') {
        const p = util.partesIsoHora(el.getAttribute('data-valor'));
        ui.irPara('#/servico/novo' + ui.montarQuery({ data: p.data, inicio: p.hora }));
        return;
      }
      agendamento.executarAcao(acao, el.getAttribute('data-id'), { para: el.getAttribute('data-valor') });
    });
  });
}

/** @param {{data:string, usuario:object, filtros:object, alvo:HTMLElement}} ctx Visão Semana (7.6). */
export function visaoSemana(ctx) {
  const u = usuarioDe(ctx);
  const inicio = util.inicioSemana(ctx.data);
  const listasPorDia = new Map();
  for (let i = 0; i < 7; i++) {
    const iso = util.addDias(inicio, i);
    listasPorDia.set(iso, agendamentosFiltrados(dados.agendamentosDoDia(iso), u, ctx.filtros));
  }
  if (ehDesktop()) semanaDesktop(ctx, inicio, listasPorDia);
  else semanaCelular(ctx, inicio, listasPorDia);
}

/* ================================================================== */
/* Visão Mês (7.7)                                                     */
/* ================================================================== */

function itemMesHTML(a) {
  /* Os pares id mais texto (DIRECAO-2 2.2): registro sem tipo e sem cliente cadastrado mostra o que a
     pessoa escreveu, e não "Serviço" com o cliente sumido. */
  const cliente = dados.nomeDoCliente(a);
  const texto = (dados.rotuloPeriodo(a) || a.horaInicio || '') + ' ' + dados.nomeDoServico(a) +
    (cliente ? ', ' + nomeCurto(cliente) : '');
  return '<span class="setor-' + esc(a.setorId || '') + (a.status === 'cancelado' ? ' riscado' : '') + '" title="' + esc(texto) + '">' + esc(texto) + '</span>';
}

function diaMesHTML(iso, primeiro, ultimo, u, filtros) {
  const hoje = util.hojeISO();
  const fora = iso < primeiro || iso > ultimo;
  const d = util.dataDe(iso);
  const lista = fora ? [] : agendamentosFiltrados(dados.agendamentosDoDia(iso), u, filtros);
  const qtd = lista.filter(naoCancelado).length;
  const conflito = !fora && lista.length > 0 && regras.conflitosDoDia(iso).size > 0;
  const fechado = regras.diaFechado(iso);
  const attrs = ['type="button"', 'class="mes-dia' + (fora ? ' mes-fora' : '') + '"', 'data-acao="dia"', 'data-valor="' + iso + '"',
    'aria-label="' + esc(util.fmtDataExtensa(iso) + ', ' + plural(qtd, 'serviço', 'serviços') + (conflito ? ', com conflito' : '') + (fechado ? ', loja fechada' : '')) + '"'];
  if (iso === hoje) attrs.push('data-hoje');
  if (fechado) attrs.push('data-fechado');
  if (fora) attrs.push('disabled', 'tabindex="-1"');
  const ordenada = lista.slice().sort(porHora);
  const visiveis = ordenada.slice(0, 3);
  const resto = ordenada.length - visiveis.length;
  return '<button ' + attrs.join(' ') + '>' +
    '<span class="mes-dia-linha"><span class="mes-dia-num">' + d.getDate() + '</span><span class="mes-dia-qtd">' + (qtd ? qtd : '') + '</span></span>' +
    (conflito ? '<span class="mes-dia-conflito" aria-hidden="true"></span>' : '') +
    (fora ? '' : '<span class="mes-dia-lista">' + visiveis.map(itemMesHTML).join('') + (resto > 0 ? '<span class="mes-dia-mais">+' + resto + '</span>' : '') + '</span>') +
    (fora ? '' : pontosSetorHTML(ordenada)) +
    '</button>';
}

/**
 * Um ponto de 6 px na cor do setor por serviço, até três, e "+N" depois disso
 * (DIRECAO 3.3). Substitui as marcas de carro no Mês, e com elas a legenda do
 * rodapé: se um calendário precisa de legenda, a codificação está errada.
 */
function pontosSetorHTML(ordenada) {
  const ativos = ordenada.filter(naoCancelado);
  if (!ativos.length) return '';
  const visiveis = ativos.slice(0, 3);
  const resto = ativos.length - visiveis.length;
  return '<span class="mes-pontos" aria-hidden="true">' +
    visiveis.map((a) => '<span class="mes-ponto setor-' + esc(a.setorId || '') + '"></span>').join('') +
    (resto > 0 ? '<span class="mes-ponto-mais">+' + resto + '</span>' : '') + '</span>';
}

/** @param {{data:string, usuario:object, filtros:object, alvo:HTMLElement}} ctx Visão Mês (7.7). */
export function visaoMes(ctx) {
  const u = usuarioDe(ctx);
  const { data, alvo } = ctx;
  const primeiro = util.inicioMes(data);
  const totalDias = util.diasNoMes(data);
  const ultimo = util.addDias(primeiro, totalDias - 1);
  const inicioGrade = util.inicioSemana(primeiro);
  const deslocamento = (util.diaSemana(primeiro) + 6) % 7;
  const semanas = Math.ceil((totalDias + deslocamento) / 7);
  const cab = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => '<div class="mes-cab" aria-hidden="true">' + d + '</div>').join('');
  let dias = '';
  for (let i = 0; i < semanas * 7; i++) dias += diaMesHTML(util.addDias(inicioGrade, i), primeiro, ultimo, u, ctx.filtros);
  const html = '<div class="visao-mes"><div class="mes-grade" role="group" aria-label="' + esc(rotuloNav('mes', data)) + '">' + cab + dias + '</div></div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao="dia"]', 'click', (acao, el) => ui.irPara(rotaDe('dia', el.getAttribute('data-valor'))));
  });
}

/* ================================================================== */
/* Serviços agendados (DIRECAO 3.2)                                    */
/* ================================================================== */

function casaBusca(a, termo) {
  if (!termo) return true;
  const t = dados.tipoPorId(a.tipoId);
  const c = dados.clientePorId(a.clienteId);
  const texto = util.normalizar([c ? c.nome : '', util.enderecoTexto(a.endereco), t ? t.nome : '', a.obs || ''].join(' '));
  return texto.includes(termo);
}

function termoBusca() {
  const t = util.normalizar(estadoTela.busca).trim();
  return t.length >= 2 ? t : '';
}

function buscaHTML() {
  return '<div class="busca servicos-busca"><span class="busca-icone" aria-hidden="true">' + icone('busca', 18) + '</span>' +
    '<input class="entrada" type="search" data-busca value="' + esc(estadoTela.busca) + '" placeholder="Buscar cliente, endereço ou tipo" aria-label="Buscar nos serviços" autocomplete="off">' +
    '<button type="button" class="btn-icone busca-limpar" data-acao="limpar-busca" aria-label="Limpar busca"' + (estadoTela.busca ? '' : ' hidden') + '>' + icone('x', 18) + '</button></div>';
}

const estaExpandido = (id) => estadoTela.expandidos.includes(id);

function alternarExpandido(id) {
  const i = estadoTela.expandidos.indexOf(id);
  if (i >= 0) estadoTela.expandidos.splice(i, 1); else estadoTela.expandidos.push(id);
}

/** Período da aba Período: padrão os próximos 30 dias (3.2). */
function periodoDaQuery(query) {
  const q = query || {};
  const de = ehISO(q.de) ? q.de : util.hojeISO();
  const ate = ehISO(q.ate) && q.ate >= de ? q.ate : util.addDias(de, DIAS_PERIODO - 1);
  return { de, ate };
}

/* ------------------------------------------------------------------ */
/* Linha de serviço e detalhe expandido                                */
/* ------------------------------------------------------------------ */

/** Ações permitidas ao usuário neste serviço, entre as pedidas ('abrir' é sempre permitida). */
function acoesPermitidas(a, u, lista) {
  if (!lista || !lista.length) return [];
  const pode = regras.acoesDisponiveis(a, u);
  return lista.filter((acao) => ACOES_LINHA[acao] && (acao === 'abrir' || pode[acao] === true));
}

function botaoAcaoLinhaHTML(acao, id) {
  const def = ACOES_LINHA[acao];
  return '<button type="button" class="btn btn-secundario btn-pq" data-acao="' + esc(acao) + '" data-id="' + esc(id) + '">' +
    icone(def.icone, 16) + '<span>' + esc(def.rotulo) + '</span></button>';
}

/**
 * Linha de serviço da tela Serviços agendados (3.2): bolinha do setor, hora em
 * coluna fixa, cliente e sub, recurso, estado em texto com ponto e o botão que
 * expande o detalhe na própria linha.
 * @param {object} a
 * @param {{expandido?:boolean, decisao?:boolean, motivo?:string, acoes?:string[], mostrarData?:boolean, usuario?:object}} [opcoes]
 * @returns {string}
 */
export function linhaServicoHTML(a, opcoes = {}) {
  const op = Object.assign({ expandido: false, decisao: false, motivo: '', acoes: [], mostrarData: false, usuario: null }, opcoes || {});
  const u = op.usuario || dados.sessao.usuario();
  /* Os pares id mais texto e o rótulo simples de status (DIRECAO-2 2.2 e 6.3): a linha é leitura rápida,
     o rótulo interno completo fica no detalhe expandido e no CSV. */
  const nomeCliente = dados.nomeDoCliente(a);
  const veiculo = a.veiculoId ? dados.veiculoPorId(a.veiculoId) : null;
  const equipe = a.equipeId ? dados.equipePorId(a.equipeId) : null;
  const simples = dados.STATUS_SIMPLES[dados.statusSimples(a.status)];
  const atraso = regras.atrasoDe(a);
  const classes = ['linha-servico', 'setor-' + esc(a.setorId || ''), atraso ? 'status-atrasado' : esc(simples.classe)];

  /* O estado sai calculado antes da sub-linha porque ele manda nela: quando o motivo do grupo
     "Precisa de decisão" repete o estado ("Atrasado" com "Atrasado 5 h 07" logo ao lado), o motivo
     some. Dizer a mesma coisa duas vezes na mesma linha é ruído, e a versão com a duração é a que
     informa (passada de crítica de 22/09/2026, lote 5). */
  const rotuloEstado = atraso ? 'Atrasado ' + util.fmtDuracao(atraso.minutos) : simples.rotulo;
  const motivoRepete = !!op.motivo && util.normalizar(rotuloEstado).startsWith(util.normalizar(op.motivo));

  const partes = [];
  if (op.motivo && !motivoRepete) partes.push('<span class="linha-servico-motivo">' + esc(op.motivo) + '</span>');
  if (op.mostrarData) partes.push(esc(util.rotuloDia(a.data)));
  /* Sem cliente cadastrado nem nome solto, o que a pessoa vai fazer sobe para o título da linha
     (é o caso do registro "Loja" do grupo), e não se repete aqui embaixo. */
  if (nomeCliente) partes.push(esc(dados.nomeDoServico(a)));
  /* Sem endereço e sem local escrito: só o despacho da loja promete endereço, então só ele cobra.
     No registro rápido, local vazio é normal e "Endereço a confirmar" seria alarme falso (DIRECAO-2 1.1, F11). */
  const lugar = a.enderecoAConfirmar ? 'Endereço a confirmar' : (dados.localDe(a) || (a.origem === 'loja' ? 'Endereço a confirmar' : ''));
  if (lugar) partes.push(esc(lugar));

  const recursoPartes = [];
  if (veiculo) {
    recursoPartes.push('<span class="inicial ' + esc(classeCarro(veiculo)) + '" aria-hidden="true">' + esc(inicialCarro(veiculo)) + '</span>' +
      '<span class="visualmente-oculto">' + esc(veiculo.apelido || veiculo.nome) + '</span>');
  }
  const quem = equipe ? (equipe.apelido || equipe.nome) : dados.nomeDosResponsaveis(a);
  if (quem) recursoPartes.push('<span class="linha-servico-quem">' + esc(quem) + '</span>');

  /* Hora aproximada mostra o período, nunca a hora derivada (DIRECAO-2 2.2 e D2): o intervalo exato
     continua no rótulo acessível e no detalhe, que é onde ele explica em vez de mentir precisão. */
  const quandoTexto = a.horaAproximada
    ? dados.rotuloPeriodo(a) + ', das ' + util.fmtIntervalo(a.horaInicio, a.horaFim)
    : util.fmtIntervalo(a.horaInicio, a.horaFim);
  const aria = ['Abrir', dados.nomeDoServico(a), nomeCliente, util.fmtDataMedia(a.data), quandoTexto, rotuloEstado].filter(Boolean).join(', ');
  const idDetalhe = 'detalhe-linha-' + a.id;

  return '<div class="' + classes.join(' ') + '"' + (op.decisao ? ' data-decisao' : '') + (op.expandido ? ' data-ativo' : '') +
    ' data-servico="' + esc(a.id) + '">' +
    '<span class="linha-servico-hora">' + (a.horaAproximada
      ? '<b>' + esc(dados.rotuloPeriodo(a)) + '</b>aproximado'
      : '<b>' + esc(a.horaInicio) + '</b>às ' + esc(a.horaFim)) + '</span>' +
    '<button type="button" class="linha-servico-corpo" data-acao="abrir" data-id="' + esc(a.id) + '" aria-label="' + esc(aria) + '">' +
      '<span class="linha-servico-cliente">' + esc(nomeCliente || dados.nomeDoServico(a)) + '</span>' +
      '<span class="linha-servico-sub">' + partes.join('\u00a0· ') + '</span>' +
    '</button>' +
    (recursoPartes.length ? '<span class="linha-servico-recurso">' + recursoPartes.join('') + '</span>' : '') +
    '<span class="linha-servico-estado">' + esc(rotuloEstado) + '</span>' +
    acoesPermitidas(a, u, op.acoes).map((acao) => botaoAcaoLinhaHTML(acao, a.id)).join('') +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="detalhes" data-id="' + esc(a.id) +
    '" aria-expanded="' + (op.expandido ? 'true' : 'false') + '"' + (op.expandido ? ' aria-controls="' + esc(idDetalhe) + '"' : '') + '>' +
    icone(op.expandido ? 'cima' : 'baixo', 16) + '<span>' + (op.expandido ? 'Fechar' : 'Detalhes') + '</span></button>' +
    '</div>';
}

/**
 * Detalhe que expande dentro da própria linha (3.2), para quem está conferindo
 * quinze serviços em sequência. O painel lateral continua existindo no nome.
 * @param {object} a @param {object} [usuario] @returns {string}
 */
export function detalheExpandidoHTML(a, usuario) {
  const u = usuario || dados.sessao.usuario();
  const acoes = regras.acoesDisponiveis(a, u);
  const cliente = dados.clientePorId(a.clienteId);
  const semEndereco = a.enderecoAConfirmar || !a.endereco;
  const id = esc(a.id);
  const blocos = [];

  /* O rótulo interno completo mora aqui (DIRECAO-2 6.3): a linha mostra o simples, o detalhe mostra
     "Aguardando confirmação", e o registro por período explica a hora que ficou gravada. */
  const estado = dados.STATUS[a.status] || dados.STATUS.aguardando_conf;
  blocos.push('<p class="linha-servico-expandida-texto"><strong>Estado:</strong> ' + esc(estado.rotulo) +
    (a.horaAproximada ? esc('. ' + dados.rotuloPeriodo(a) + ', das ' + util.fmtIntervalo(a.horaInicio, a.horaFim)) : '') + '</p>');

  const localLivre = String(a.localTexto || '').trim();
  blocos.push(semEndereco
    ? '<p class="linha-servico-expandida-texto">' + (localLivre ? esc(localLivre) : (a.origem === 'loja' ? 'Endereço a confirmar com o cliente.' : 'Sem local informado.')) + '</p>'
    : '<button type="button" class="linha-servico-endereco" data-acao="copiar-endereco" data-id="' + id + '" title="Tocar para copiar">' +
      icone('mapa', 16) + '<span>' + esc(util.enderecoTexto(a.endereco)) +
      (a.endereco.referencia ? esc(' (' + a.endereco.referencia + ')') : '') + '</span></button>');

  const contato = [];
  if (cliente && cliente.telefone) contato.push('<span class="linha-servico-tel">' + esc(util.telFmt(cliente.telefone)) + '</span>');
  contato.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="ligar" data-id="' + id + '"' + (cliente && cliente.telefone ? '' : ' disabled') + '>' + icone('telefone', 16) + '<span>Ligar</span></button>');
  contato.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="whatsapp" data-id="' + id + '"' + (cliente && cliente.telefone ? '' : ' disabled') + '>' + icone('whatsapp', 16) + '<span>WhatsApp</span></button>');
  if (!semEndereco) contato.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="rota" data-id="' + id + '">' + icone('mapa', 16) + '<span>Rota</span></button>');
  blocos.push('<div class="linha-servico-expandida-acoes">' + contato.join('') + '</div>');

  if (a.obs) blocos.push('<p class="linha-servico-expandida-texto"><strong>Observações:</strong> ' + esc(a.obs) + '</p>');
  /* A nota interna é recado de escritório e não aparece para o perfil campo (4.11).
     A edição dela mora no detalhe e no painel, que são do lote 5. */
  if (!ehPerfilCampo(u)) {
    /* Editável aqui mesmo (3.2 e 4.11): quem confere quinze serviços em sequência anota sem abrir o detalhe. */
    blocos.push('<div class="linha-servico-nota"><label class="campo-rotulo" for="nota-linha-' + id + '">Nota interna <span class="opcional">(só a loja vê)</span></label>' +
      '<textarea class="areatexto" id="nota-linha-' + id + '" rows="2" data-nota-linha="' + id + '" placeholder="Combinado com o cliente, cobrança, pendência de escritório">' + esc(a.notaInterna || '') + '</textarea>' +
      '<div class="linha-servico-expandida-acoes"><button type="button" class="btn btn-secundario btn-pq" data-acao="salvar-nota-linha" data-id="' + id + '">Salvar nota</button></div></div>');
  }
  if ((a.checklist || []).length) {
    blocos.push('<div class="linha-servico-expandida-checklist"><div class="secao-titulo">Checklist</div>' +
      agendamento.checklistHTML(a, { editavel: false }) + '</div>');
  }

  const barra = [];
  if (acoes.reagendar) barra.push(botaoAcaoLinhaHTML('reagendar', a.id));
  if (acoes.cancelar) barra.push(botaoAcaoLinhaHTML('cancelar', a.id));
  if (acoes.naoRealizado) barra.push(botaoAcaoLinhaHTML('naoRealizado', a.id));
  /* "Mensagens" é do lote 5 (4.9): o botão só nasce quando a função existir. */
  if (typeof agendamento.abrirMensagens === 'function') {
    barra.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="mensagens" data-id="' + id + '">' + icone('whatsapp', 16) + '<span>Mensagens</span></button>');
  }
  barra.push('<button type="button" class="btn btn-secundario btn-pq" data-acao="abrir" data-id="' + id + '">' + icone('direita', 16) + '<span>Abrir o serviço</span></button>');
  blocos.push('<div class="linha-servico-expandida-acoes">' + barra.join('') + '</div>');

  return '<div class="linha-servico-expandida" id="detalhe-linha-' + id + '">' + blocos.join('') + '</div>';
}

/* ------------------------------------------------------------------ */
/* Agrupamento por data                                                */
/* ------------------------------------------------------------------ */

function grupoDataHTML(iso, qtd) {
  const hoje = iso === util.hojeISO();
  return '<h2 class="grupo-data">' + esc(maiusculaInicial(util.fmtDataExtensa(iso))) +
    (hoje ? '<span class="grupo-data-hoje">Hoje</span>' : '') +
    '<span class="grupo-data-qtd">' + esc(plural(qtd, 'serviço', 'serviços')) + '</span></h2>';
}

function linhaComDetalheHTML(a, u, opcoes) {
  const aberto = estaExpandido(a.id);
  return linhaServicoHTML(a, Object.assign({ expandido: aberto, usuario: u }, opcoes || {})) +
    (aberto ? detalheExpandidoHTML(a, u) : '');
}

/** Lista agrupada por data, um cabeçalho por dia, sem cartão individual (3.2). */
function gruposPorDataHTML(lista, u, opcoes) {
  const grupos = util.agrupar(lista, (a) => a.data);
  let html = '';
  for (const [iso, itens] of grupos) {
    html += grupoDataHTML(iso, itens.length) +
      '<div class="servicos-lista">' + itens.map((a) => linhaComDetalheHTML(a, u, opcoes)).join('') + '</div>';
  }
  return html;
}

/** Grupo "Precisa de decisão": mesmo cabeçalho, barra dourada e as ações dentro da linha (3.2). */
function grupoDecisaoHTML(todos, u, opcoes = {}) {
  if (!todos.length) return '';
  /* 19 itens de decisão antes do primeiro grupo de data escondiam a agenda: o grupo mostra três e o botão abre o resto.
     Com busca ativa vem tudo, porque a pessoa está procurando um serviço específico. */
  const resumir = !opcoes.tudo && !estadoTela.decisaoAberta && todos.length > DECISAO_RESUMIDA + 1;
  const itens = resumir ? todos.slice(0, DECISAO_RESUMIDA) : todos;
  const alternar = todos.length > DECISAO_RESUMIDA + 1 && !opcoes.tudo
    ? '<div class="mt2"><button type="button" class="btn btn-fantasma btn-pq" data-acao="alternar-decisao" aria-expanded="' + (resumir ? 'false' : 'true') + '">' +
      icone(resumir ? 'baixo' : 'cima', 16) + '<span>' + (resumir ? 'Mostrar os ' + todos.length + ' que precisam de decisão' : 'Mostrar só os primeiros') + '</span></button></div>'
    : '';
  return '<h2 class="grupo-data grupo-data-decisao">Precisa de decisão' +
    '<span class="grupo-data-qtd">' + esc(plural(todos.length, 'serviço', 'serviços')) + '</span></h2>' +
    '<div class="servicos-lista">' + itens.map((x) => linhaComDetalheHTML(x.agendamento, u, {
      decisao: true, mostrarData: true, acoes: x.acoes,
      /* A data já vem escrita na linha: "Pendente de 15/09" repetiria a mesma informação (3.2). */
      motivo: x.motivo === 'passado_aberto' ? 'Pendente' : (ROTULO_ATENCAO[x.motivo] ? ROTULO_ATENCAO[x.motivo](x.agendamento) : x.motivo)
    })).join('') + '</div>' + alternar;
}

/* ------------------------------------------------------------------ */
/* Recortes das abas                                                   */
/* ------------------------------------------------------------------ */

const ehPendente = (a) => a.status === 'aguardando_conf' || a.status === 'reagendado' || !!(a.liberacao && a.liberacao.estado === 'pendente');

/** Lista completa de uma aba, já visível ao usuário, filtrada e ordenada (3.2). */
function listaDaAba(u, aba, filtros, periodo) {
  const hoje = util.hojeISO();
  if (aba === 'pendentes') {
    return agendamentosFiltrados(dados.repo.listar('agendamentos', ehPendente), u, filtros).sort(porDataHora);
  }
  if (aba === 'passados') {
    const brutos = dados.repo.listar('agendamentos', (a) => a.data < hoje || regras.statusFinal(a.status));
    return agendamentosFiltrados(brutos, u, filtros).sort((x, y) => porDataHora(y, x));
  }
  if (aba === 'periodo') {
    return agendamentosFiltrados(dados.agendamentosEntre(periodo.de, periodo.ate), u, filtros).sort(porDataHora);
  }
  const proximos = dados.agendamentosEntre(hoje, '9999-12-31').filter((a) => regras.statusAtivo(a.status));
  return agendamentosFiltrados(proximos, u, filtros).sort(porDataHora);
}

function abasServicosHTML(aba, contagens) {
  return '<div class="abas-sublinhado" role="tablist" aria-label="Recorte dos serviços">' +
    ABAS_SERVICOS.map((x) => {
      const n = contagens[x.id];
      return '<button type="button" role="tab" class="aba-sublinhado" data-acao="aba" data-valor="' + x.id + '" aria-selected="' + (x.id === aba ? 'true' : 'false') + '">' +
        esc(x.rotulo) + (n ? '<span class="aba-contagem">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
}

function camposPeriodoHTML(periodo) {
  return '<div class="servicos-periodo">' +
    '<div class="campo"><label class="campo-rotulo" for="servicos-de">De</label>' +
    '<input class="entrada" type="date" id="servicos-de" data-periodo="de" value="' + esc(periodo.de) + '"></div>' +
    '<div class="campo"><label class="campo-rotulo" for="servicos-ate">Até</label>' +
    '<input class="entrada" type="date" id="servicos-ate" data-periodo="ate" value="' + esc(periodo.ate) + '"></div>' +
    '</div>';
}

function vazioDaAba(aba, termo, u) {
  if (termo) return ui.estadoVazio({ icone: 'busca', titulo: 'Nada encontrado', texto: 'Tente outro nome, endereço ou tipo.' });
  const textos = {
    proximos: 'Nenhum serviço ativo de hoje em diante.',
    pendentes: 'Nada aguardando confirmação ou liberação.',
    passados: 'Nenhum serviço concluído, cancelado ou anterior a hoje.',
    periodo: 'Nenhum serviço nas datas escolhidas.'
  };
  return ui.estadoVazio({
    icone: aba === 'pendentes' ? 'check' : 'calendario',
    titulo: aba === 'pendentes' ? 'Nada pendente' : 'Sem serviços aqui',
    texto: textos[aba] || textos.proximos,
    acao: dados.pode('criarServico', u) ? { rotulo: 'Registrar', acao: 'agendar' } : null
  });
}

/* ------------------------------------------------------------------ */
/* Exportar CSV (4.12)                                                 */
/* ------------------------------------------------------------------ */

function textoMotivoRegistro(a) {
  const nomeDe = (lista, m) => {
    if (!m) return '';
    const item = lista.find((x) => x.id === m.motivo);
    return [item ? item.rotulo : m.motivo, m.texto || ''].filter(Boolean).join(': ');
  };
  return [nomeDe(dados.MOTIVOS_CANCELAMENTO, a.motivoCancelamento), nomeDe(dados.MOTIVOS_NAO_REALIZADO, a.motivoNaoRealizado)]
    .filter(Boolean).join(' | ');
}

/**
 * Exporta em CSV a lista que está na tela, já filtrada e buscada (4.12).
 * Ponto e vírgula como separador e BOM na frente, que é o que faz o Excel
 * brasileiro abrir com acento certo.
 * @param {object[]} lista @param {{nome?:string}} [opcoes]
 */
export function exportarServicosCSV(lista, opcoes = {}) {
  const itens = (lista || []).slice();
  if (!itens.length) { ui.toast('Nada para exportar', 'info'); return; }
  const linhas = itens.map((a) => {
    const cliente = dados.clientePorId(a.clienteId);
    const equipe = a.equipeId ? dados.equipePorId(a.equipeId) : null;
    const endereco = a.endereco || {};
    const criador = a.criadoPor ? dados.usuarioPorId(a.criadoPor) : null;
    const logradouro = a.enderecoAConfirmar ? 'A confirmar' : [endereco.logradouro, endereco.complemento].filter(Boolean).join(', ');
    return [
      util.fmtData(a.data),
      a.horaInicio || '',
      a.horaFim || '',
      /* Tipo, cliente e carro pelos pares id mais texto (DIRECAO-2 2.2), senão o registro do colaborador
         sairia com três colunas vazias. O Status continua sendo o rótulo interno: relatório não perde
         granularidade (6.3), e a coluna Período diz quando a hora é aproximada. */
      dados.nomeDoServico(a),
      dados.setorPorId(a.setorId).nome,
      dados.nomeDoCliente(a),
      cliente ? util.telFmt(cliente.telefone) : '',
      logradouro || String(a.localTexto || ''),
      endereco.bairro || '',
      endereco.cidade || '',
      dados.nomeDoCarro(a),
      equipe ? (equipe.apelido || equipe.nome) : '',
      (a.responsaveis || []).map((id) => { const p = dados.usuarioPorId(id); return p ? p.nome : ''; }).filter(Boolean).join(', '),
      (dados.STATUS[a.status] || {}).rotulo || a.status,
      a.horaAproximada ? ((dados.PERIODOS[a.periodo] || {}).rotulo || 'Aproximado') : 'Hora exata',
      textoMotivoRegistro(a),
      a.obs || '',
      criador ? criador.nome : '',
      a.criadoEm ? util.fmtDataHora(a.criadoEm) : ''
    ];
  });
  const csv = util.csvDe(['Data', 'Início', 'Fim', 'Tipo', 'Setor', 'Cliente', 'Telefone', 'Endereço', 'Bairro', 'Cidade',
    'Carro', 'Equipe', 'Responsáveis', 'Status', 'Período', 'Motivo', 'Observações', 'Criado por', 'Criado em'], linhas);
  const blob = new Blob([BOM_EXCEL + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (opcoes && opcoes.nome ? opcoes.nome : 'servicos-agendados') + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ui.toast(plural(itens.length, 'serviço exportado', 'serviços exportados'));
}

/* ------------------------------------------------------------------ */
/* A tela                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tela Serviços agendados (3.2): título e ações em 56 px, abas de 48 px, busca
 * de largura cheia e a lista agrupada por data, com o detalhe expandindo na
 * própria linha.
 * @param {{params:{aba:string}, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaServicos(ctx) {
  const u = usuarioDe(ctx);
  const alvo = ctx.alvo;
  if (!u) { ui.irPara('#/entrar', { substituir: true }); return; }
  const params = ctx.params || {};
  const query = ctx.query || {};
  if (!ABAS_SERVICOS.some((x) => x.id === params.aba)) { ui.irPara(rotaServicos(ABA_SERVICOS_PADRAO, query), { substituir: true }); return; }
  const aba = params.aba;
  if (estadoTela.abaServicos !== aba) { estadoTela.abaServicos = aba; estadoTela.paginas = 1; }
  const filtros = estadoAgenda(u).filtros;
  const periodo = periodoDaQuery(query);
  const atencao = query.atencao && ALERTAS.some((x) => x.chave === query.atencao) ? query.atencao : '';
  const alerta = atencao ? ALERTAS.find((x) => x.chave === atencao) : null;

  /* Guarda o que está na tela para o "Exportar CSV" mandar exatamente isto. */
  let naTela = [];

  const corpo = () => {
    const termo = termoBusca();
    if (atencao) {
      const lista = agendamentosFiltrados(regras.alertasOperacao(u, util.hojeISO())[atencao] || [], u, filtros)
        .filter((a) => casaBusca(a, termo)).sort(porDataHora);
      naTela = lista;
      const chip = '<div class="linha-chips servicos-recorte"><span class="chip chip-filtro"><span>' + esc(alerta ? alerta.rotulo : atencao) + '</span>' +
        '<button type="button" class="chip-x" data-acao="remover-atencao" aria-label="Mostrar toda a lista">' + icone('x', 14) + '</button></span></div>';
      if (!lista.length) {
        return chip + ui.estadoVazio({ icone: 'check', titulo: 'Nada neste aviso', texto: 'Os itens já foram resolvidos ou não batem com os filtros.', acao: { rotulo: 'Ver toda a lista', acao: 'remover-atencao' } });
      }
      return chip + gruposPorDataHTML(lista, u, { mostrarData: false });
    }
    const completa = listaDaAba(u, aba, filtros, periodo).filter((a) => casaBusca(a, termo));
    const decisao = aba === 'proximos' ? regras.precisaAtencao(u).filter((x) => casaBusca(x.agendamento, termo)) : [];
    const idsDecisao = new Set(decisao.map((x) => x.agendamento.id));
    const restante = completa.filter((a) => !idsDecisao.has(a.id));
    const visiveis = restante.slice(0, PAGINA_SERVICOS * estadoTela.paginas);
    const faltam = restante.length - visiveis.length;
    naTela = decisao.map((x) => x.agendamento).concat(visiveis);
    if (!naTela.length) return vazioDaAba(aba, termo, u);
    let html = grupoDecisaoHTML(decisao, u, { tudo: !!termo }) + gruposPorDataHTML(visiveis, u, {});
    if (faltam > 0) {
      html += '<div class="mt4"><button type="button" class="btn btn-secundario btn-cheio" data-acao="mais">' + icone('baixo', 18) +
        '<span>Mostrar mais ' + esc(plural(Math.min(faltam, PAGINA_SERVICOS), 'serviço', 'serviços')) + '</span></button></div>';
    }
    return html;
  };

  const corpoHTML = corpo();
  const contagens = {
    proximos: listaDaAba(u, 'proximos', filtros, periodo).length,
    pendentes: listaDaAba(u, 'pendentes', filtros, periodo).length
  };
  const exportar = ehPerfilCampo(u) ? '' :
    '<button type="button" class="btn btn-secundario btn-pq servicos-exportar" data-acao="exportar" aria-label="Exportar CSV da lista na tela">' +
    icone('instalar', 18) + '<span>Exportar CSV</span></button>';
  const cab = ui.montarCabecalho({
    titulo: 'Serviços agendados',
    acoes: exportar + botaoFiltrosHTML(u, filtros),
    extra: '<div class="cab-linha cab-linha-abas">' + abasServicosHTML(aba, contagens) + '</div>'
  });

  const html = '<div class="tela-servicos">' + buscaHTML() +
    (aba === 'periodo' && !atencao ? camposPeriodoHTML(periodo) : '') +
    '<div data-lista>' + corpoHTML + '</div></div>';

  ui.renderizar(alvo, html, (raiz) => {
    const campo = raiz.querySelector('[data-busca]');
    const listaEl = raiz.querySelector('[data-lista]');
    const limpar = raiz.querySelector('[data-acao="limpar-busca"]');
    const redesenhar = () => { listaEl.innerHTML = corpo(); };
    const atualizar = util.debounce(redesenhar, 150);
    if (campo) campo.addEventListener('input', () => { estadoTela.busca = campo.value; if (limpar) limpar.hidden = !campo.value; atualizar(); });
    ui.delegar(raiz, '[data-periodo]', 'change', (acao, el) => {
      const novo = { de: periodo.de, ate: periodo.ate };
      novo[el.getAttribute('data-periodo')] = el.value;
      if (!ehISO(novo.de)) novo.de = periodo.de;
      if (!ehISO(novo.ate) || novo.ate < novo.de) novo.ate = util.addDias(novo.de, DIAS_PERIODO - 1);
      ui.irPara(rotaServicos(aba, novo), { substituir: true });
    });
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      const id = el.getAttribute('data-id');
      if (acao === 'limpar-busca') { estadoTela.busca = ''; if (campo) { campo.value = ''; campo.focus(); } if (limpar) limpar.hidden = true; redesenhar(); return; }
      if (acao === 'mais') { estadoTela.paginas += 1; redesenhar(); return; }
      if (acao === 'alternar-decisao') { estadoTela.decisaoAberta = !estadoTela.decisaoAberta; redesenhar(); return; }
      if (acao === 'remover-atencao') { ui.irPara(rotaServicos(aba)); return; }
      if (acao === 'agendar') { ui.irPara(ui.rotaAgendar()); return; }
      if (acao === 'salvar-nota-linha') {
        const caixa = el.closest('.linha-servico-nota');
        const area = caixa ? caixa.querySelector('textarea') : null;
        const r = agendamento.salvarNotaInterna(id, area ? area.value : '');
        ui.toast(r.ok ? (r.mudou ? 'Nota salva' : 'Nada mudou') : r.erro, r.ok ? (r.mudou ? 'ok' : 'info') : 'erro');
        return;
      }
      if (acao === 'detalhes') {
        alternarExpandido(id);
        redesenhar();
        const volta = listaEl.querySelector('[data-acao="detalhes"][data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
        if (volta) { try { volta.focus({ preventScroll: true }); } catch (e) { volta.focus(); } }
        return;
      }
      if (acao === 'mensagens') { if (typeof agendamento.abrirMensagens === 'function') agendamento.abrirMensagens(id); return; }
      agendamento.executarAcao(acao, id, { para: el.getAttribute('data-valor') });
    });
  });

  if (cab) {
    ui.delegar(cab, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      if (acao === 'aba') { ui.irPara(rotaServicos(el.getAttribute('data-valor'))); return; }
      if (acao === 'filtros') { abrirFiltros(u, filtros); return; }
      if (acao === 'exportar') { exportarServicosCSV(naTela, { nome: 'servicos-' + aba }); return; }
    });
  }
  montarFabNovo(u, util.hojeISO());
}

/* ================================================================== */
/* Visão Recursos (7.9)                                                */
/* ================================================================== */

function cabecalhoVeiculoHTML(v, qtd, data) {
  const estado = data === util.hojeISO() ? regras.estadoVeiculo(v.id) : null;
  return '<span class="grade-cab-titulo"><span class="inicial ' + classeCarro(v) + '" aria-hidden="true">' + esc(inicialCarro(v)) + '</span>' + esc(v.apelido || v.nome) + '</span>' +
    '<span class="grade-cab-sub"><span class="placa">' + esc(v.placa || '') + '</span>' + (estado ? '\u00a0· ' + esc(estado.rotulo) : '') + '</span>' +
    '<span class="grade-cab-qtd">' + (qtd ? plural(qtd, 'serviço', 'serviços') : 'Sem serviços') + '</span>';
}

function cabecalhoEquipeHTML(e, qtd) {
  const membros = (e.membros || []).map(nomeCurtoDe).filter(Boolean).join(', ');
  return '<span class="grade-cab-titulo">' + esc(e.apelido || e.nome) + '</span>' +
    '<span class="grade-cab-sub">' + esc(membros || 'Sem membros') + '</span>' +
    '<span class="grade-cab-qtd">' + (qtd ? plural(qtd, 'serviço', 'serviços') : 'Sem serviços') + '</span>';
}

function cabecalhoPessoaHTML(p, qtd, data) {
  const emTurno = data === util.hojeISO() && regras.estaDeServico(p, data, util.minParaHora(util.agoraMin()));
  return '<span class="grade-cab-titulo">' + ui.avatar(p, { tamanho: 'pq' }) + esc(nomeCurto(p.nome)) + (emTurno ? '<span class="ponto-turno" title="Em turno" aria-label="Em turno"></span>' : '') + '</span>' +
    '<span class="grade-cab-sub">' + esc(p.cargo || '') + '</span>' +
    '<span class="grade-cab-qtd">' + (qtd ? plural(qtd, 'serviço', 'serviços') : 'Sem serviços') + '</span>';
}

function cabecalhoNeutroHTML(titulo, sub, qtd) {
  return '<span class="grade-cab-titulo">' + esc(titulo) + '</span><span class="grade-cab-sub">' + esc(sub) + '</span>' +
    '<span class="grade-cab-qtd">' + (qtd ? plural(qtd, 'serviço', 'serviços') : 'Sem serviços') + '</span>';
}

/** Folga e fora do turno de uma pessoa no dia, como blocos hachurados (7.9). */
function folgasPessoa(p, iso) {
  if (regras.emFolga(p, iso)) return [{ de: '00:00', ate: '23:59', texto: 'Folga' }];
  const faixa = regras.escalaDoDia(p, iso);
  if (!faixa) return [{ de: '00:00', ate: '23:59', texto: 'Fora do turno' }];
  const saida = [];
  if (min(faixa.de) > 0) saida.push({ de: '00:00', ate: faixa.de, texto: 'Fora do turno' });
  if (min(faixa.ate) < 24 * 60 - 1) saida.push({ de: faixa.ate, ate: '23:59', texto: 'Fora do turno' });
  return saida;
}

function colunasVeiculos(data, lista) {
  const colunas = dados.veiculosAtivos().map((v) => {
    const doCarro = lista.filter((a) => a.veiculoId === v.id);
    return {
      id: v.id, tipoRecurso: 'veiculo', titulo: v.apelido || v.nome, subtitulo: v.placa || '', data, agendamentos: doCarro,
      indisponibilidades: indisponibilidadesNoDia(v.id, data), cabecalhoHTML: cabecalhoVeiculoHTML(v, doCarro.filter(naoCancelado).length, data),
      vazioTexto: (v.apelido || v.nome) + ' livre o dia todo'
    };
  });
  const semCarro = lista.filter((a) => !a.veiculoId);
  colunas.push({
    id: 'sem-carro', tipoRecurso: 'veiculo', neutra: true, titulo: 'Sem carro', data, agendamentos: semCarro,
    cabecalhoHTML: cabecalhoNeutroHTML('Sem carro', 'Serviços sem carro', semCarro.filter(naoCancelado).length), vazioTexto: 'Todos com carro'
  });
  return colunas;
}

function colunasEquipes(data, lista) {
  const colunas = dados.equipesAtivas().map((e) => {
    const daEquipe = lista.filter((a) => a.equipeId === e.id);
    return {
      id: e.id, tipoRecurso: 'equipe', titulo: e.apelido || e.nome, data, agendamentos: daEquipe,
      cabecalhoHTML: cabecalhoEquipeHTML(e, daEquipe.filter(naoCancelado).length), vazioTexto: (e.apelido || e.nome) + ' livre o dia todo'
    };
  });
  const avulsos = lista.filter((a) => !a.equipeId);
  colunas.push({
    id: 'avulsos', tipoRecurso: 'equipe', neutra: true, titulo: 'Avulsos', data, agendamentos: avulsos,
    cabecalhoHTML: cabecalhoNeutroHTML('Avulsos', 'Sem equipe', avulsos.filter(naoCancelado).length), vazioTexto: 'Ninguém avulso hoje'
  });
  return colunas;
}

/** Pessoas do eixo (7.9): campo ativos mais quem tem serviço no dia; membros de cada equipe juntos, depois por contagem e nome. */
function pessoasDoEixo(lista) {
  const porId = new Map();
  for (const u of dados.usuariosCampo()) porId.set(u.id, u);
  const contagem = new Map();
  for (const a of lista) {
    for (const id of regras.expandirPessoas(a)) {
      contagem.set(id, (contagem.get(id) || 0) + 1);
      if (!porId.has(id)) { const u = dados.usuarioPorId(id); if (u && u.ativo) porId.set(id, u); }
    }
  }
  const ordenados = [];
  const usados = new Set();
  for (const e of dados.equipesAtivas()) {
    for (const id of e.membros || []) {
      if (porId.has(id) && !usados.has(id)) { usados.add(id); ordenados.push(porId.get(id)); }
    }
  }
  const resto = Array.from(porId.values()).filter((u) => !usados.has(u.id))
    .sort((x, y) => (contagem.get(y.id) || 0) - (contagem.get(x.id) || 0) || util.porNome(x, y));
  return ordenados.concat(resto);
}

function colunasPessoas(data, lista) {
  return pessoasDoEixo(lista).map((p) => {
    const daPessoa = lista.filter((a) => regras.expandirPessoas(a).has(p.id));
    return {
      id: p.id, tipoRecurso: 'pessoa', titulo: nomeCurto(p.nome), subtitulo: p.cargo || '', data, agendamentos: daPessoa,
      folgas: folgasPessoa(p, data), cabecalhoHTML: cabecalhoPessoaHTML(p, daPessoa.filter(naoCancelado).length, data),
      vazioTexto: nomeCurto(p.nome) + ' livre o dia todo'
    };
  });
}

/** Sobreposição na mesma coluna é conflito por definição (7.9); "Sem carro" com tipo que exige carro também. */
function conflitosRecursos(data, colunas, eixo) {
  const mapa = new Map(regras.conflitosDoDia(data));
  const marcar = (a, conflito) => { const atual = mapa.get(a.id) || []; if (!atual.some((c) => c.motivo === conflito.motivo && c.comId === conflito.comId)) mapa.set(a.id, atual.concat(conflito)); };
  for (const col of colunas) {
    const ativos = col.agendamentos.filter((a) => regras.statusAtivo(a.status));
    if (col.id === 'sem-carro' && eixo === 'veiculos') {
      for (const a of ativos) {
        const t = dados.tipoPorId(a.tipoId);
        if (t && t.precisaVeiculo === 'sim') marcar(a, { recurso: 'veiculo', id: null, rotulo: 'Sem carro', motivo: 'sem_carro', comId: null, comTexto: 'Precisa de carro', severidade: 'conflito' });
      }
      continue;
    }
    if (col.neutra) continue;
    for (let i = 0; i < ativos.length; i++) {
      for (let j = i + 1; j < ativos.length; j++) {
        const x = ativos[i];
        const y = ativos[j];
        if (!regras.sobrepoe(min(x.horaInicio), min(x.horaFim), min(y.horaInicio), min(y.horaFim))) continue;
        marcar(x, { recurso: col.tipoRecurso, id: col.id, rotulo: col.titulo, motivo: 'sobreposicao', comId: y.id, comTexto: regras.descricaoCurta(y), severidade: 'conflito' });
        marcar(y, { recurso: col.tipoRecurso, id: col.id, rotulo: col.titulo, motivo: 'sobreposicao', comId: x.id, comTexto: regras.descricaoCurta(x), severidade: 'conflito' });
      }
    }
  }
  return mapa;
}

/* A fileira de chips de salto saiu (DIRECAO 3.3): o cabeçalho de cada coluna já diz o recurso e a contagem. */

/** @param {{data:string, eixo:'veiculos'|'equipes'|'pessoas', usuario:object, filtros:object, alvo:HTMLElement}} ctx Visão Recursos com "Sem carro" e "Avulsos" (7.9). */
export function visaoRecursos(ctx) {
  const u = usuarioDe(ctx);
  const { data, alvo } = ctx;
  const eixo = EIXOS.some((e) => e.id === ctx.eixo) ? ctx.eixo : 'veiculos';
  const query = ctx.query || {};
  const chaveIgnorada = eixo === 'veiculos' ? 'carro' : eixo === 'equipes' ? 'equipe' : 'pessoa';
  const lista = agendamentosFiltrados(dados.agendamentosDoDia(data), u, semFiltro(chaveIgnorada, ctx.filtros));
  const colunas = eixo === 'veiculos' ? colunasVeiculos(data, lista) : eixo === 'equipes' ? colunasEquipes(data, lista) : colunasPessoas(data, lista);
  const setores = idsSetores(u);
  const faixa = regras.faixaGrade(data, lista, setores);
  const gradeEl = grade.montarGrade(Object.assign({
    data, colunas, faixa, conflitos: conflitosRecursos(data, colunas, eixo), mostrarAgora: true, modo: 'recursos',
    arrastavel: ehDesktop() && !!dados.pode('editarServico', u), setores, destaqueId: query.novo || null
  }, callbacksGrade(u, eixo)));
  const html = '<div class="visao-recursos">' +
    (colunas.length ? '<div data-grade></div>' : ui.estadoVazio({ icone: 'usuarios', titulo: 'Nada para mostrar', texto: 'Cadastre ' + (eixo === 'veiculos' ? 'um veículo' : eixo === 'equipes' ? 'uma equipe' : 'pessoas de campo') + ' para usar esta visão.' })) +
    '</div>';
  renderizarComGrade(alvo, html, gradeEl, minutoInicial(data, lista, setores), (raiz) => {
    if (query.coluna) grade.rolarParaColuna(gradeEl, query.coluna);
  });
}

/* ================================================================== */
/* Apoio do feed: rota do dia, resumo e amanhã (7.1 e DIRECAO-2 4.6)   */
/* ================================================================== */

const porOrdemRota = (x, y) => {
  const ox = x.ordemRota == null ? Infinity : Number(x.ordemRota);
  const oy = y.ordemRota == null ? Infinity : Number(y.ordemRota);
  if (ox !== oy) return ox < oy ? -1 : 1;
  return porHora(x, y);
};

/** Ordem da rota: ativos por ordemRota e hora; finais afundam para o fim. */
function ordenarRota(lista) {
  const ativos = lista.filter((a) => !regras.statusFinal(a.status)).sort(porOrdemRota);
  const finais = lista.filter((a) => regras.statusFinal(a.status)).sort(porHora);
  return ativos.concat(finais);
}

/**
 * Uma contagem em texto: "2 serviços hoje" ou "nenhum serviço hoje" (3.7).
 * Dois zeros em número grande no alto da tela principal é péssimo cartão de
 * visita; só o que for maior que zero ganha peso e cor.
 */
function contagemTexto(item) {
  const n = Number(item.valor) || 0;
  if (!n) return esc(item.nenhum);
  return '<strong' + (item.tom ? ' data-tom="' + esc(item.tom) + '"' : '') + '>' + n + '</strong> ' + esc(n === 1 ? item.um : item.muitos);
}

/** A linha de resumo do dia, no lugar do bloco de contadores em número grande (3.7). */
function resumoDiaHTML(data, itens) {
  const partes = itens.filter((x) => x.mostrar !== false).map(contagemTexto);
  return '<p class="dia-resumo"><strong class="dia-resumo-data">' + esc(maiusculaInicial(util.fmtDataExtensa(data))) + '</strong>\u00a0· ' +
    partes.join(', ') + '</p>';
}

function resumoAmanha(u) {
  const amanha = util.addDias(util.hojeISO(), 1);
  const lista = visiveisDoDia(amanha, u).sort(porHora);
  const aguardando = lista.filter((a) => a.status === 'aguardando_conf' || a.status === 'reagendado').length;
  return { data: amanha, total: lista.length, primeiro: lista.length ? lista[0].horaInicio : null, aguardando };
}

function textoAmanha(r) {
  if (!r.total) return 'Amanhã sem serviços';
  return 'Amanhã: ' + plural(r.total, 'serviço', 'serviços') + (r.primeiro ? ', primeiro às ' + r.primeiro : '');
}

function linhaAmanhaHTML(u, rota) {
  const r = resumoAmanha(u);
  return '<a class="amanha-linha" href="' + esc(rota || rotaDe('dia', r.data)) + '">' + icone('calendario', 18) +
    '<span><strong>' + esc(textoAmanha(r)) + '</strong>' + (r.aguardando ? ', ' + esc(plural(r.aguardando, 'aguarda confirmação', 'aguardam confirmação')) : '') + '</span>' + icone('direita', 18) + '</a>';
}

function alternarReordenar(listaHoje) {
  if (estadoTela.reordenar) {
    const r = agendamento.definirOrdemRota(estadoTela.ordemTemp);
    estadoTela.reordenar = false;
    estadoTela.ordemTemp = [];
    if (r.ok) ui.toast(r.alterados ? 'Ordem da rota salva' : 'Ordem mantida');
    else ui.toast(r.erro, 'erro');
    return;
  }
  estadoTela.ordemTemp = ordenarRota(listaHoje).filter((a) => !regras.statusFinal(a.status)).map((a) => a.id);
  estadoTela.reordenar = true;
}

function moverNaOrdem(id, delta) {
  const i = estadoTela.ordemTemp.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= estadoTela.ordemTemp.length) return;
  const lista = estadoTela.ordemTemp.slice();
  [lista[i], lista[j]] = [lista[j], lista[i]];
  estadoTela.ordemTemp = lista;
}


/**
 * Meu dia saiu (DIRECAO-2 4.6 e 8.1): a tela Hoje a substitui para todos os perfis, e três telas
 * parecidas (Meu dia, Hoje, Serviços agendados) seria repetir o erro que a auditoria apontou.
 * A rota continua respondendo porque há link antigo para ela, inclusive em app.telaInicialPara e na
 * barra de navegação, que são do lote 4.
 * @param {{params:object, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaMeuDia(ctx) {
  ui.irPara('#/hoje' + ui.montarQuery((ctx && ctx.query) || {}), { substituir: true });
}

/* ================================================================== */
/* Tela Hoje, o grupo virado app (DIRECAO-2, seção 4)                  */
/* ================================================================== */

/* O segmento do cabeçalho (DIRECAO-2 4.2, mais o Quadro da DIRECAO-3 3.1). O padrão passa a ser por perfil: a
   gestão abre no Quadro, o atendimento e o campo abrem em Por hora. Quem trocar fica trocado, porque a preferência
   continua gravada por usuário em prefs(u.id).hoje.agrupamento. */
const AGRUPAMENTOS_HOJE = [
  { id: 'quadro', rotulo: 'Quadro' },
  { id: 'hora', rotulo: 'Por hora' },
  { id: 'pessoa', rotulo: 'Por pessoa' }
];

/* Os mesmos quatro grupos, na mesma ordem, do resumo que vai para o WhatsApp
   (whatsapp.resumoDoDia): o que a pessoa lê no app e o que ela cola no grupo
   precisam bater linha a linha, senão a ponte perde a graça (4.3 e 5.4). */
const GRUPOS_HORA = [
  { id: 'manha', rotulo: 'Manhã' },
  { id: 'tarde', rotulo: 'Tarde' },
  { id: 'dia', rotulo: 'Dia todo' },
  { id: 'sem_hora', rotulo: 'Sem hora definida' }
];

const MENSAGEM_SIMPLES = {
  agendado: 'Voltou para agendado',
  em_andamento: 'Serviço iniciado',
  concluido: 'Serviço concluído',
  nao_realizado: 'Marcado como não realizado'
};

/**
 * Preferência da tela Hoje por usuário, na seção `hoje` das prefs (regra 7 da seção 0 das duas direções: cada lote
 * escreve só na seção dele, e `dados.salvarPrefs` mescla por seção). O lote 3 grava `agrupamento` e `quadroFoco`.
 * Sem preferência gravada, o padrão é por perfil (DIRECAO-3 3.1).
 * @param {object} [usuario] @returns {{agrupamento:'quadro'|'hora'|'pessoa', quadroFoco:string}}
 */
export function estadoHoje(usuario) {
  const u = usuario || dados.sessao.usuario();
  const base = u ? (dados.prefs(u.id).hoje || {}) : {};
  const foco = String(base.quadroFoco || '');
  return {
    agrupamento: AGRUPAMENTOS_HOJE.some((x) => x.id === base.agrupamento) ? base.agrupamento : agrupamentoPadrao(u),
    quadroFoco: NUMEROS_QUADRO.some((n) => n.id === foco) || foco === 'atrasados' ? foco : ''
  };
}

function salvarEstadoHoje(usuario, mudancas) {
  if (!usuario) return;
  dados.salvarPrefs(usuario.id, { hoje: Object.assign(estadoHoje(usuario), mudancas || {}) });
}

/**
 * A lista do feed. Paridade com o grupo (decisão do dono sobre a dúvida 2 da seção 10): no feed todo
 * perfil vê os registros de todo mundo, com cliente e local, porque é isso que ele já lê no grupo.
 * `dados.visivel` continua mandando em editar, em mudar status e nas demais telas.
 * Cancelado fica de fora, como em whatsapp.resumoDoDia: cancelar é decisão de gestão, não recado do dia.
 */
function listaDoFeed(iso, u) {
  return dados.agendamentosDoDia(iso).filter((a) => naoCancelado(a) && dados.visivelNoFeed(a, u));
}

/** Grupo do agrupamento "Por hora", com a mesma regra do resumo do dia. */
function grupoHoraDe(a) {
  if (a.periodo === 'manha' || a.periodo === 'tarde' || a.periodo === 'dia') return a.periodo;
  if (!a.horaInicio) return 'sem_hora';
  return min(a.horaInicio) < 13 * 60 ? 'manha' : 'tarde';
}

/** Quem faz: o primeiro responsável, senão quem registrou. No grupo, quem posta é quem faz (F8). */
function donoDoRegistro(a) {
  return (a.responsaveis || [])[0] || a.criadoPor || '';
}

/** Nome curto de quem faz, com recuo para a equipe alocada e para o nome assinado na mensagem colada. */
function nomeDoAutor(a) {
  const id = donoDoRegistro(a);
  const p = id ? dados.usuarioPorId(id) : null;
  if (p) return nomeCurto(p.nome);
  const equipe = a.equipeId ? dados.equipePorId(a.equipeId) : null;
  if (equipe) return equipe.apelido || equipe.nome;
  return String(a.autorTexto || '').trim() || 'Equipe';
}

const ehMeu = (a, u) => !!u && (a.criadoPor === u.id || regras.expandirPessoas(a).has(u.id));

/** Os registros do próprio usuário no dia, que viram o grupo "Meus" do perfil campo (4.6). */
function meusDoDia(iso, u) {
  return listaDoFeed(iso, u).filter((a) => ehMeu(a, u));
}

/**
 * O próximo passo de um toque (4.4 e 6.2), já em estado enxuto: de Agendado para Em andamento, de Em
 * andamento para Concluído. O verbo é em primeira pessoa no registro da própria pessoa, que é como o
 * grupo fala; na gestão, que mexe no registro dos outros, vira o verbo neutro.
 */
function passoSimplesDe(a, u) {
  const chave = dados.statusSimples(a.status);
  const meu = ehMeu(a, u);
  if (chave === 'agendado') return { destino: 'em_andamento', rotulo: meu ? 'Comecei' : 'Iniciar' };
  if (chave === 'em_andamento') return { destino: 'concluido', rotulo: meu ? 'Terminei' : 'Concluir' };
  return null;
}

/**
 * Existe cadeia permitida do status atual até o estado enxuto pedido, sem aplicar nada. Serve para
 * habilitar ou desabilitar o botão e para explicar o motivo em `title`, o que regras.aplicarStatusSimples
 * só saberia depois de tentar. Mesma busca em largura do motor, e toda checagem passa por podeTransitar.
 * @returns {{ok:boolean, atual:boolean, exige:string|null, motivo:string}}
 */
function caminhoSimples(a, u, chave) {
  /* A busca em largura mora em regras.caminhoSimples, a mesma que a folha de Não realizado usa. */
  const caminho = regras.caminhoSimples(a, u, chave);
  if (caminho.ok || caminho.atual) return caminho;
  /* Para quem só enxerga os próprios serviços, o motivo que vem de capNoServico ("fora do seu setor")
     descreve a regra errada: no feed o perfil campo vê tudo por paridade com o grupo, e o que o impede
     é não estar no serviço. A frase é a da direção (4.4). */
  if (!dados.visivel(a, u)) return { ok: false, atual: false, exige: null, motivo: 'Só quem está no serviço muda o status' };
  return caminho;
}

/**
 * Aplica o estado enxuto com um toque: toast com Desfazer por 5 s, sem diálogo de confirmação.
 * Não realizado sempre abre a folha de motivo, e Concluído abre a folha de conclusão quando o serviço
 * exige checklist, assinatura ou é despacho da loja (D6 e 6.2).
 */
function aplicarStatusDoFeed(id, destino, u) {
  const a = dados.agendamentoPorId(id);
  if (!a || !u) return;
  if (destino === 'nao_realizado') { agendamento.abrirNaoRealizado(id); return; }
  if (destino === 'concluido' && regras.exigeFolhaDeConclusao(a)) { agendamento.abrirConcluir(id); return; }
  const r = regras.aplicarStatusSimples(id, destino, u);
  if (!r.ok) {
    if (r.exige === 'concluir') { agendamento.abrirConcluir(id); return; }
    if (r.exige === 'motivo') { agendamento.abrirNaoRealizado(id); return; }
    ui.toast(r.erro || 'Não foi possível mudar o status', 'erro');
    return;
  }
  if (!r.passos.length) return;
  ui.toastDesfazer(MENSAGEM_SIMPLES[destino] || 'Status alterado', {
    ms: MS_DESFAZER,
    aoDesfazer: () => agendamento.desfazerStatus(id, r.antes),
    aoConfirmar: r.notificar
  });
}

/** No desktop a folha vira popover de 200 px ancorado no chip (4.4): posição calculada aqui, medida no CSS. */
function ancorarPopover(painel, ancora) {
  if (!painel || !ancora || !window.matchMedia('(min-width: 1024px)').matches) return;
  const r = ancora.getBoundingClientRect();
  const largura = 220;
  const folga = 8;
  const esquerda = Math.max(folga, Math.min(r.right - largura, window.innerWidth - largura - folga));
  painel.style.left = Math.round(esquerda) + 'px';
  requestAnimationFrame(() => {
    const altura = painel.offsetHeight || 260;
    const cabe = r.bottom + 4 + altura <= window.innerHeight - folga;
    painel.style.top = Math.round(cabe ? r.bottom + 4 : Math.max(folga, r.top - 4 - altura)) + 'px';
  });
}

/** Folha com os quatro estados do grupo: ancorada na base no celular, popover ao lado do chip no desktop (4.4). */
function abrirStatusSimples(id, u, ancora) {
  const a = dados.agendamentoPorId(id);
  if (!a || !u) return;
  const linhas = dados.STATUS_SIMPLES_TOQUE.map((chave) => {
    const info = dados.STATUS_SIMPLES[chave];
    const caminho = caminhoSimples(a, u, chave);
    const bloqueado = !caminho.atual && !caminho.ok;
    const sub = caminho.atual ? 'Estado de agora' : (bloqueado ? caminho.motivo : '');
    return '<button type="button" class="item feed-status-opcao" data-acao="definir-status" data-valor="' + esc(chave) + '"' +
      (caminho.atual ? ' aria-current="true"' : '') +
      (bloqueado ? ' disabled title="' + esc(caminho.motivo) + '"' : '') + '>' +
      '<span class="item-icone"><span class="feed-ponto ' + esc(info.classe) + '" aria-hidden="true"></span></span>' +
      '<span class="item-corpo"><span class="item-titulo">' + esc(info.rotulo) + '</span>' +
      (sub ? '<span class="item-sub quebra">' + esc(sub) + '</span>' : '') + '</span>' +
      (caminho.atual ? icone('check', 18) : '') + '</button>';
  }).join('');
  const { el, fechar } = ui.abrirSheet({
    titulo: dados.nomeDoServico(a),
    classe: 'feed-status-popover',
    corpo: '<div class="lista sheet-lista-acoes feed-status-lista">' + linhas + '</div>' +
      '<p class="campo-ajuda">Não realizado pede o motivo, que é o que o grupo perde quando alguém edita a mensagem.</p>'
  });
  ancorarPopover(el, ancora);
  ui.delegar(el, '[data-acao="definir-status"]', 'click', (acao, alvo) => {
    const destino = alvo.getAttribute('data-valor');
    fechar();
    aplicarStatusDoFeed(id, destino, u);
  });
}

/* ---- O cartão do registro (4.3) ---- */

function carroDoCartaoHTML(a) {
  const veiculo = a.veiculoId ? dados.veiculoPorId(a.veiculoId) : null;
  if (veiculo) {
    return '<span class="feed-item-carro"><span class="inicial ' + esc(classeCarro(veiculo)) + '" aria-hidden="true">' +
      esc(inicialCarro(veiculo)) + '</span>' + esc(veiculo.apelido || veiculo.nome) + '</span>';
  }
  const texto = String(a.veiculoTexto || '').trim();
  return texto ? '<span class="feed-item-carro">' + esc(texto) + '</span>' : '';
}

function chipStatusFeedHTML(a, u) {
  const chave = dados.statusSimples(a.status);
  const info = dados.STATUS_SIMPLES[chave];
  const pode = dados.STATUS_SIMPLES_TOQUE.some((outro) => caminhoSimples(a, u, outro).ok);
  /* Concluído é o único que troca o ponto pelos dois vistos (6.1): é o estado que a pessoa procura de
     longe na lista, e o ícone faz esse trabalho melhor que a cor sozinha. */
  const corpo = (chave === 'concluido' ? icone('checkduplo', 14) : '') + esc(info.rotulo);
  const comum = 'class="feed-status ' + esc(info.classe) + '"';
  if (!pode) return '<span ' + comum + '>' + corpo + '</span>';
  return '<button type="button" ' + comum + ' data-acao="feed-status" data-id="' + esc(a.id) +
    '" aria-haspopup="dialog" aria-label="' + esc(info.rotulo + '. Trocar o estado') + '">' + corpo + '</button>';
}

function botaoPassoFeedHTML(a, u) {
  const passo = passoSimplesDe(a, u);
  if (!passo) return '';
  const caminho = caminhoSimples(a, u, passo.destino);
  if (!caminho.ok) {
    return '<button type="button" class="btn btn-secundario feed-item-passo" disabled title="' + esc(caminho.motivo) + '">' +
      esc(passo.rotulo) + '</button>';
  }
  return '<button type="button" class="btn btn-primario feed-item-passo" data-acao="feed-passo" data-id="' + esc(a.id) +
    '" data-valor="' + esc(passo.destino) + '">' + esc(passo.rotulo) + '</button>';
}

/**
 * O cartão do feed: avatar, hora ou período com quem faz, o que faz, e cliente, local e carro embaixo.
 * @param {object} a @param {object} u @param {{porPessoa?:boolean}} [opcoes] @returns {string}
 */
function cartaoFeedHTML(a, u, opcoes = {}) {
  const op = Object.assign({ porPessoa: false }, opcoes || {});
  const pessoa = dados.usuarioPorId(donoDoRegistro(a));
  const quem = nomeDoAutor(a);
  const quando = dados.rotuloPeriodo(a) || 'Sem hora';
  const titulo = dados.nomeDoServico(a);
  const cliente = dados.nomeDoCliente(a);
  const local = dados.localDe(a);
  const info = dados.STATUS_SIMPLES[dados.statusSimples(a.status)];
  const sub = [cliente ? esc(cliente) : '', local ? esc(local) : '', carroDoCartaoHTML(a)].filter(Boolean);
  const aria = ['Abrir', titulo, quem, quando, cliente, info.rotulo].filter(Boolean).join(', ');
  /* No agrupamento por pessoa o avatar sai (o nome já é o cabeçalho do grupo) e entra a barra do setor. */
  const marca = op.porPessoa
    ? '<span class="feed-item-barra" aria-hidden="true"></span>'
    : '<span class="feed-item-avatar">' + (pessoa ? ui.avatar(pessoa) : '<span class="avatar" aria-hidden="true" title="' + esc(quem) + '">' + esc(util.iniciais(quem)) + '</span>') + '</span>';
  return '<article class="feed-item setor-' + esc(a.setorId || '') + ' ' + esc(info.classe) + '" data-servico="' + esc(a.id) + '">' +
    marca +
    '<button type="button" class="feed-item-corpo" data-acao="abrir" data-id="' + esc(a.id) + '" aria-label="' + esc(aria) + '">' +
      '<span class="feed-item-topo"><span class="feed-item-hora">' + esc(quando) + '</span>' +
      '<span class="feed-item-quem">' + esc(quem) + '</span></span>' +
      '<span class="feed-item-titulo">' + esc(titulo) + '</span>' +
      (sub.length ? '<span class="feed-item-sub">' + sub.join(' · ') + '</span>' : '') +
    '</button>' +
    '<div class="feed-item-acoes">' + chipStatusFeedHTML(a, u) + botaoPassoFeedHTML(a, u) + '</div>' +
    '</article>';
}

function grupoFeedHTML(titulo, contagem, corpo) {
  return '<section class="feed-grupo">' +
    '<h2 class="feed-grupo-cab">' + esc(titulo) + (contagem ? '<span class="feed-grupo-qtd">' + esc(contagem) + '</span>' : '') + '</h2>' +
    corpo + '</section>';
}

function listaFeedHTML(itens, u, opcoes) {
  return '<div class="feed-lista">' + itens.map((a) => cartaoFeedHTML(a, u, opcoes)).join('') + '</div>';
}

function gruposPorHoraHTML(lista, u) {
  let html = '';
  for (const grupo of GRUPOS_HORA) {
    const itens = lista.filter((a) => grupoHoraDe(a) === grupo.id).sort(porHora);
    if (!itens.length) continue;
    html += grupoFeedHTML(grupo.rotulo, plural(itens.length, 'registro', 'registros'), listaFeedHTML(itens, u, {}));
  }
  return html;
}

function gruposPorPessoaHTML(lista, u) {
  const grupos = util.agrupar(lista, (a) => donoDoRegistro(a) || 'sem_pessoa');
  const emCampo = (itens) => itens.some((a) => a.status === 'em_andamento' || a.status === 'a_caminho');
  const ordenados = Array.from(grupos).map(([id, itens]) => ({ id, itens: itens.slice().sort(porHora), nome: nomeDoAutor(itens[0]) }))
    .sort((x, y) => (emCampo(y.itens) ? 1 : 0) - (emCampo(x.itens) ? 1 : 0) || x.nome.localeCompare(y.nome, 'pt-BR'));
  return ordenados.map((g) => grupoFeedHTML(g.nome, plural(g.itens.length, 'registro', 'registros'), listaFeedHTML(g.itens, u, { porPessoa: true }))).join('');
}

/** O grupo "Meus" do perfil campo (4.6), com a reordenação da rota que veio do Meu dia. */
function grupoMeusHTML(meus, u) {
  const ordenada = estadoTela.reordenar
    ? estadoTela.ordemTemp.map((id) => meus.find((a) => a.id === id)).filter(Boolean)
      .concat(meus.filter((a) => regras.statusFinal(a.status)).sort(porHora))
    : ordenarRota(meus);
  const ativos = ordenada.filter((a) => !regras.statusFinal(a.status));
  const podeReordenar = ativos.length > 1 && ativos.some((a) => regras.acoesDisponiveis(a, u).reordenarRota);
  const acao = podeReordenar
    ? '<button type="button" class="btn ' + (estadoTela.reordenar ? 'btn-primario' : 'btn-secundario') + ' btn-pq" data-acao="reordenar" aria-pressed="' +
      (estadoTela.reordenar ? 'true' : 'false') + '">' + icone('ordenar', 16) + '<span>' + (estadoTela.reordenar ? 'Concluir ordem' : 'Reordenar') + '</span></button>'
    : '';
  let numero = 0;
  const corpo = estadoTela.reordenar
    ? '<div class="rota-lista">' + ordenada.map((a) => {
      const final = regras.statusFinal(a.status);
      if (!final) numero += 1;
      return agendamento.cartaoServico(a, { variante: 'rota', numero: final ? null : numero, reordenar: !final });
    }).join('') + '</div>'
    : listaFeedHTML(ordenada, u, {});
  return '<section class="feed-grupo feed-grupo-meus">' +
    '<h2 class="feed-grupo-cab">Meus<span class="feed-grupo-qtd">' + esc(plural(ordenada.length, 'registro', 'registros')) + '</span>' + acao + '</h2>' +
    corpo + '</section>';
}

/* ---- O que a gerência vê a mais (4.5) ---- */

/**
 * De turno hoje, sem nenhum registro e sem ter dito onde está: o que o grupo não sabe responder (1.4, item 2).
 * A conta virou a de regras.pessoasSemAviso na v4, a mesma que o quadro usa (3.4): quem marcou presença hoje já
 * avisou, e cobrar de novo quem avisou era o defeito que aparecia na faixa das vistas Por hora e Por pessoa, na
 * cobrança copiada para o grupo e no resumo do dia. As três passam por aqui, então as três ficam iguais ao quadro.
 */
function semRegistroHoje(iso, lista) {
  return regras.pessoasSemAviso(iso, lista);
}

function faixaAusenciasHTML(ausentes) {
  if (!ausentes.length) return '';
  const nomes = ausentes.map((p) => nomeCurto(p.nome));
  const mostrados = nomes.slice(0, MAX_NOMES_AUSENTES);
  const resto = nomes.length - mostrados.length;
  return '<section class="feed-faixa feed-faixa-ausencias" aria-label="Quem ainda não registrou">' +
    '<p class="feed-faixa-texto"><strong>' +
    esc(plural(ausentes.length, 'pessoa de turno ainda não registrou nada hoje', 'pessoas de turno ainda não registraram nada hoje')) +
    ':</strong> ' + esc(mostrados.join(', ')) + (resto > 0 ? esc(' e mais ' + resto) : '') + '</p>' +
    '<button type="button" class="btn btn-secundario btn-pq" data-acao="cobrar">' + icone('copiar', 16) + '<span>Cobrar no grupo</span></button>' +
    '</section>';
}

/** "Fiorino em 2 registros às 14:00", com atalho para a visão Recursos. */
function faixaConflitosHTML(iso, lista, u) {
  const mapa = regras.conflitosDoDia(iso, lista);
  if (!mapa.size) return '';
  const porRecurso = new Map();
  for (const [id, conflitos] of mapa) {
    const a = lista.find((x) => x.id === id);
    for (const c of conflitos) {
      if (!['veiculo', 'equipe', 'pessoa'].includes(c.recurso)) continue;
      const chave = c.recurso + ':' + (c.id || c.rotulo);
      const item = porRecurso.get(chave) || { rotulo: c.rotulo, ids: new Set(), horas: new Set() };
      item.ids.add(id);
      if (c.comId) item.ids.add(c.comId);
      if (a && a.horaInicio && !a.horaAproximada) item.horas.add(a.horaInicio);
      porRecurso.set(chave, item);
    }
  }
  const frases = Array.from(porRecurso.values()).map((item) => {
    const horas = Array.from(item.horas).sort();
    return item.rotulo + ' em ' + plural(item.ids.size, 'registro', 'registros') + (horas.length === 1 ? ' às ' + horas[0] : '');
  });
  const texto = frases.length ? frases.join('. ') : plural(mapa.size, 'registro em conflito hoje', 'registros em conflito hoje');
  const atalho = dados.pode('verRecursos', u)
    ? '<a class="feed-faixa-link" href="' + esc(rotaDe('recursos', iso, 'veiculos')) + '">Ver em Recursos' + icone('direita', 16) + '</a>'
    : '';
  return '<section class="feed-faixa feed-faixa-conflito" aria-label="Conflito de recurso">' +
    '<p class="feed-faixa-texto">' + icone('alerta', 16) + '<span>' + esc(texto) + '</span></p>' + atalho + '</section>';
}

/* ---- As duas mensagens que a gerência copia para o grupo (4.5 e 5.4) ---- */

function contextoDoGrupo(iso, lista) {
  return {
    hoje: util.hojeISO(),
    tipos: dados.repo.listar('tipos'),
    veiculos: dados.repo.listar('veiculos'),
    usuarios: dados.repo.listar('usuarios'),
    clientes: dados.repo.listar('clientes'),
    semRegistro: semRegistroHoje(iso, lista).map((p) => nomeCurto(p.nome))
  };
}

function copiarParaOGrupo(texto, rotuloAuditoria, u) {
  agendamento.copiarTexto(texto).then((ok) => {
    if (!ok) { ui.toast('Não consegui copiar. Selecione e copie à mão', 'erro'); return; }
    ui.toast('Mensagem copiada. Cole no grupo AGENDA GREEN');
    dados.auditar({ acao: 'mensagem_copiada', entidade: 'agendamento', entidadeId: null, rotulo: rotuloAuditoria, userId: u ? u.id : null });
  });
}

function copiarDiaParaGrupo(iso, u) {
  const lista = listaDoFeed(iso, u);
  copiarParaOGrupo(whatsapp.resumoDoDia(lista, iso, contextoDoGrupo(iso, lista)), 'Resumo do dia ' + util.fmtDataMedia(iso), u);
}

/**
 * A cobrança pronta, que a pessoa cola no grupo se quiser. O app não envia nada sozinho, nunca: não
 * existe link de grupo e mandar mensagem sem clique não é coisa que se faça (5.1).
 */
function copiarCobrancaParaGrupo(iso, u) {
  const ausentes = semRegistroHoje(iso, listaDoFeed(iso, u));
  if (!ausentes.length) { ui.toast('Todo mundo de turno já registrou hoje', 'info'); return; }
  const nomes = ausentes.map((p) => nomeCurto(p.nome)).join(', ');
  const texto = ['*AGENDA GREEN*', '',
    'Pessoal, ainda não vi registro de hoje, ' + util.fmtData(iso).slice(0, 5) + ': ' + nomes + '.',
    'Quando der, mandem a mensagem de AGENDAMENTO DE SERVIÇO aqui no grupo, mesmo que seja só loja.'].join('\n');
  copiarParaOGrupo(texto, 'Cobrança de registro em ' + util.fmtDataMedia(iso), u);
}

/* ---- Cabeçalho, resumo e segmento (4.2) ---- */

function segmentoHojeHTML(atual) {
  return '<div class="feed-segmento" role="group" aria-label="Agrupar o feed">' +
    AGRUPAMENTOS_HOJE.map((x) => '<button type="button" class="feed-segmento-opcao" data-acao="agrupar" data-valor="' + esc(x.id) +
      '" aria-pressed="' + (x.id === atual ? 'true' : 'false') + '">' + esc(x.rotulo) + '</button>').join('') +
    '</div>';
}

function resumoDoFeedHTML(iso, lista) {
  const conta = (chave) => lista.filter((a) => dados.statusSimples(a.status) === chave).length;
  const naoRealizados = conta('nao_realizado');
  /* Dia sem registro nenhum fica só com a data e "nenhum registro hoje": repetir três vezes a palavra
     "nenhum" é a versão em texto dos dois zeros grandes que a DIRECAO 3.7 tirou daqui. */
  const algum = lista.length > 0;
  return resumoDiaHTML(iso, [
    { valor: lista.length, um: 'registro hoje', muitos: 'registros hoje', nenhum: 'nenhum registro hoje' },
    { valor: conta('em_andamento'), um: 'em andamento', muitos: 'em andamento', nenhum: 'nenhum em andamento', tom: 'andamento', mostrar: algum },
    { valor: conta('concluido'), um: 'concluído', muitos: 'concluídos', nenhum: 'nenhum concluído', tom: 'ok', mostrar: algum },
    { valor: naoRealizados, um: 'não realizado', muitos: 'não realizados', nenhum: '', tom: 'erro', mostrar: naoRealizados > 0 }
  ]);
}

function botaoCopiarDiaHTML() {
  return '<button type="button" class="btn btn-secundario btn-pq feed-copiar-dia" data-acao="copiar-dia" ' +
    'aria-label="Copiar o dia para o grupo">' + icone('copiar', 16) +
    '<span class="feed-copiar-dia-rotulo">Copiar o dia</span></button>';
}

/* ================================================================== */
/* "Onde estou" e o quadro do dia (DIRECAO-3, seções 2.5 e 3)          */
/* ================================================================== */

/* Unidade declarada, e é o que permite ler a tela sem pensar: os números
   grandes e os grupos do quadro contam PESSOAS; a linha de resumo e o feed
   contam REGISTROS (2.2 e 3.4). São duas leituras do mesmo dia. */

/**
 * Grupos de pessoas do quadro, na ordem da 3.2: estes vêm antes do bloco "Sem aviso" (3.5), e GRUPOS_QUADRO_FIM vem
 * depois dele. "Com agenda, sem lugar" é o grupo de quem já mandou a agenda de hoje mas não disse onde está: não é
 * gente de cobrar, então não pode estar em "Sem aviso", e não tem lugar, então não cabe em nenhum dos lugares.
 * O id "sem_lugar" e o rótulo moram aqui, porque não é lugar de dados.LUGARES.
 */
const GRUPOS_QUADRO = ['servico', 'loja', 'galpao', 'rua', 'outro', 'sem_lugar'];
const GRUPOS_QUADRO_FIM = ['folga'];
const ROTULOS_GRUPO = { sem_aviso: 'Sem aviso', sem_lugar: 'Com agenda, sem lugar' };

/** Os quatro números fixos (3.4). "Atrasados" é o quinto, condicional, e entra só quando é maior que zero. */
const NUMEROS_QUADRO = [
  { id: 'servico', rotulo: 'Em serviço' },
  { id: 'loja', rotulo: 'Na loja' },
  { id: 'galpao', rotulo: 'No galpão' },
  { id: 'sem_aviso', rotulo: 'Sem aviso' }
];

/** Perfis que abrem a tela Hoje no quadro (3.1). Quem trocar de vista fica trocado, porque a preferência grava. */
const PERFIS_QUADRO = ['admin', 'diretor', 'gerente', 'supervisor'];

/* A linha do dia (3.2, item 4): fita de 08:00 às 19:00. */
const FITA_DE_MIN = 8 * 60;
const FITA_ATE_MIN = 19 * 60;
const FITA_FAIXA_MIN = FITA_ATE_MIN - FITA_DE_MIN;
const FITA_DURACAO_PADRAO = 60;
const FITA_DURACAO_MIN = 15;
const MAX_PROXIMAS_HORAS = 5;

const agrupamentoPadrao = (u) => (u && PERFIS_QUADRO.includes(u.perfil) ? 'quadro' : 'hora');

/** Classe de cor do lugar, sempre com o prefixo do lote: o valor mora em css/tokens.css e o mapa em css/quadro.css. */
function classeLugar(id) {
  const l = dados.lugarPorId(id);
  return l.classe ? 'quadro-cor-' + l.classe : '';
}

/**
 * Marcar presença por outra pessoa (2.5). A capacidade `alocarRecursos` sozinha abriria o link para o atendimento,
 * que a tabela de perfis da 7.1 deixa só com a própria faixa; por isso a gestão também é exigida. Quem grava de fato
 * é dados.marcarPresenca, que refaz a checagem e audita quem marcou por quem.
 */
function podeMarcarPorOutro(u) {
  return dados.ehGestao(u) && (dados.pode('alocarRecursos', u) || dados.pode('verTudo', u));
}

/* ---- A faixa "Onde estou" (2.5) ---- */

/**
 * Os cinco botões de 48 px: os quatro lugares graváveis com botão (Na loja, No galpão, Na rua, Folga) e "Outro", que
 * abre o campo de texto e é o escape. O campo nasce escondido e aparece sem re-renderizar, para não perder o foco.
 * @param {string} [pessoaId] quando a gerência marca por outra pessoa @returns {string}
 */
function botoesLugarHTML(pessoaId) {
  const attr = pessoaId ? ' data-pessoa="' + esc(pessoaId) + '"' : '';
  const botao = (l) => '<button type="button" class="onde-botao" data-acao="onde-marcar" data-valor="' + esc(l.id) + '"' + attr + '>' +
    icone(l.icone, 20) + '<span>' + esc(l.rotulo) + '</span></button>';
  const grandes = dados.LUGARES.filter((l) => l.botao && l.gravavel).map(botao).join('');
  const outro = '<button type="button" class="onde-botao onde-botao-outro" data-acao="onde-outro"' + attr +
    ' aria-expanded="false">' + icone('info', 20) + '<span>Outro</span></button>';
  /* Id próprio por pessoa: a folha de "Marcar por outra pessoa" abre com a faixa da própria pessoa ainda na tela,
     e dois campos com o mesmo id fariam o rótulo apontar para o campo errado. */
  const idCampo = 'onde-outro-texto' + (pessoaId ? '-' + pessoaId : '');
  return '<div class="onde-botoes">' + grandes + outro + '</div>' +
    '<div class="onde-outro" hidden>' +
      '<label class="campo-rotulo" for="' + esc(idCampo) + '">Onde, em poucas palavras</label>' +
      '<div class="onde-outro-linha">' +
        '<input class="entrada onde-outro-campo" id="' + esc(idCampo) + '" type="text" autocomplete="off" ' +
        'maxlength="' + dados.LUGAR_TEXTO_MAX + '" placeholder="Fornecedor, banco, obra">' +
        '<button type="button" class="btn btn-primario" data-acao="onde-salvar-outro"' + attr + '>Pronto</button>' +
      '</div>' +
    '</div>';
}

/** "desde 08:28", ou "Entrega, Tatiane Moraes, desde 11:00" quando a presença é derivada de um serviço (2.5). */
function detalheDaPresenca(p) {
  const partes = [];
  if (p.lugar === 'servico' && p.servicoId) {
    const a = dados.agendamentoPorId(p.servicoId);
    if (a) {
      partes.push(dados.nomeDoServico(a));
      const cliente = dados.nomeDoCliente(a);
      if (cliente) partes.push(cliente);
    }
  }
  if (p.desde) partes.push('desde ' + p.desde);
  else if (p.origem === 'escala') partes.push('pela escala');
  return partes.join(', ');
}

/** O bloco de depois do toque: barra de 4 px na cor do lugar, ícone, rótulo, detalhe e o botão "Trocar". */
function blocoPresencaHTML(p) {
  const l = dados.lugarPorId(p.lugar);
  const detalhe = detalheDaPresenca(p);
  return '<div class="onde-atual ' + esc(classeLugar(p.lugar)) + '" data-lugar="' + esc(p.lugar) + '">' +
    '<span class="onde-atual-barra" aria-hidden="true"></span>' +
    '<span class="onde-atual-icone">' + icone(l.icone, 20) + '</span>' +
    '<span class="onde-atual-texto">' +
      '<span class="onde-atual-rotulo">' + esc(dados.nomeDoLugar(p)) + '</span>' +
      (detalhe ? '<span class="onde-atual-detalhe">' + esc(detalhe) + '</span>' : '') +
    '</span>' +
    '<button type="button" class="btn btn-secundario btn-pq onde-trocar" data-acao="onde-trocar">Trocar</button>' +
    '</div>';
}

/**
 * A faixa "Onde estou": a primeira coisa da tela Hoje, em todas as vistas e para todo perfil (2.5).
 * @param {object} u @param {string} iso @returns {string}
 */
function faixaOndeEstouHTML(u, iso) {
  const p = estadoTela.ondeTrocar ? null : regras.presencaEfetiva(u.id, iso);
  const corpo = p ? blocoPresencaHTML(p) : botoesLugarHTML('');
  /* O serviço em andamento vence o check-in (2.2), então quem toca "No galpão" no meio de uma entrega continua
     aparecendo em serviço. Sem uma linha dizendo isso, o toque parece não ter funcionado. */
  const guardado = p && p.lugar === 'servico' ? dados.presencaDoDia(u.id, iso) : null;
  const nota = guardado && guardado.lugar && guardado.lugar !== 'servico'
    ? '<p class="onde-nota">' + esc(dados.nomeDoLugar(guardado) +
      (guardado.desde ? ', que você marcou às ' + guardado.desde + ',' : ', que você marcou,') +
      ' vale de novo quando o serviço terminar.') + '</p>'
    : '';
  const porOutra = podeMarcarPorOutro(u)
    ? '<button type="button" class="onde-link" data-acao="onde-outra-pessoa">' + icone('usuarios', 16) +
      '<span>Marcar por outra pessoa</span></button>'
    : '';
  return '<section class="onde" aria-labelledby="onde-titulo">' +
    '<h2 class="onde-titulo" id="onde-titulo">Onde você está</h2>' +
    corpo + nota + porOutra + '</section>';
}

/** Grava o check-in de um toque. Devolve true quando gravou. Efeitos: dados.marcarPresenca, toast, rerender. */
function marcarOndeEstou(userId, iso, lugar, texto, u) {
  try {
    dados.marcarPresenca(userId, iso, { lugar, lugarTexto: texto || '', origem: 'app' });
  } catch (erro) {
    ui.toast((erro && erro.message) || 'Não consegui gravar onde você está', 'erro');
    return false;
  }
  estadoTela.ondeTrocar = false;
  const alvo = dados.usuarioPorId(userId);
  const prefixo = u && alvo && alvo.id !== u.id ? util.primeiroNome(alvo.nome) + ': ' : '';
  ui.toast(prefixo + dados.nomeDoLugar({ lugar, lugarTexto: texto }));
  ui.rerender();
  return true;
}

/** Abre o campo de "Outro lugar" sem re-renderizar, para o teclado não fechar e o foco não se perder. */
function abrirCampoOutro(botao) {
  const raiz = botao && botao.closest ? botao.closest('.onde, .onde-sheet') : null;
  const caixa = raiz ? raiz.querySelector('.onde-outro') : null;
  if (!caixa) return;
  caixa.hidden = false;
  botao.setAttribute('aria-expanded', 'true');
  const campo = caixa.querySelector('.onde-outro-campo');
  if (campo) campo.focus();
}

/** Lê o texto do campo "Outro lugar" a partir do botão "Pronto". */
function textoDoCampoOutro(botao) {
  const raiz = botao && botao.closest ? botao.closest('.onde, .onde-sheet') : null;
  const campo = raiz ? raiz.querySelector('.onde-outro-campo') : null;
  return campo ? String(campo.value || '').trim() : '';
}

/** Folha com a lista de gente, para a gerência marcar por quem avisou por telefone (2.5). */
function abrirMarcarPorOutra(u, iso) {
  /* Toda pessoa ativa, não só as de campo: a gerência sabe por telefone onde alguém está, e esse alguém pode ser a
     florista ou o atendente. Quem já está no quadro vem primeiro; conta compartilhada não é pessoa (6.2). */
  const doQuadro = new Set(pessoasDoQuadro(iso, u).map((p) => p.id));
  const pessoas = dados.usuariosAtivos()
    .filter((p) => p.id !== u.id && !p.contaCompartilhada)
    .sort((a, b) => (doQuadro.has(b.id) ? 1 : 0) - (doQuadro.has(a.id) ? 1 : 0) || util.porNome(a, b));
  if (!pessoas.length) { ui.toast('Ninguém além de você no cadastro', 'info'); return; }
  const linhas = pessoas.map((p) => {
    const pres = regras.presencaEfetiva(p.id, iso);
    const sub = pres ? dados.nomeDoLugar(pres) + (pres.desde ? ', desde ' + pres.desde : '') : 'Sem aviso';
    return '<button type="button" class="item" data-acao="escolher-pessoa" data-id="' + esc(p.id) + '">' +
      '<span class="item-icone">' + ui.avatar(p, { tamanho: 'pq' }) + '</span>' +
      '<span class="item-corpo"><span class="item-titulo">' + esc(nomeCurto(p.nome)) + '</span>' +
      '<span class="item-sub">' + esc(sub) + '</span></span>' + icone('direita', 18) + '</button>';
  }).join('');
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Marcar por outra pessoa',
    corpo: '<div class="lista sheet-lista-acoes">' + linhas + '</div>' +
      '<p class="campo-ajuda">Fica registrado na auditoria quem marcou por quem.</p>'
  });
  ui.delegar(el, '[data-acao="escolher-pessoa"]', 'click', (acao, alvo) => {
    const id = alvo.getAttribute('data-id');
    fechar();
    abrirLugarDaPessoa(id, iso, u);
  });
}

/** Segundo passo da folha: os mesmos cinco botões da faixa, agora para a pessoa escolhida. */
function abrirLugarDaPessoa(pessoaId, iso, u) {
  const p = dados.usuarioPorId(pessoaId);
  if (!p) return;
  const { el, fechar } = ui.abrirSheet({
    titulo: 'Onde ' + util.primeiroNome(p.nome) + ' está',
    corpo: '<div class="onde onde-sheet">' + botoesLugarHTML(pessoaId) + '</div>'
  });
  ui.delegar(el, '[data-acao^="onde-"]', 'click', (acao, alvo) => {
    if (acao === 'onde-outro') { abrirCampoOutro(alvo); return; }
    if (acao === 'onde-marcar') {
      if (marcarOndeEstou(pessoaId, iso, alvo.getAttribute('data-valor'), '', u)) fechar();
      return;
    }
    if (acao === 'onde-salvar-outro') {
      const texto = textoDoCampoOutro(alvo);
      if (!texto) { ui.toast('Escreva onde a pessoa está', 'erro'); return; }
      if (marcarOndeEstou(pessoaId, iso, 'outro', texto, u)) fechar();
    }
  });
}

/* ---- O quadro do dia (3.2 a 3.6) ---- */

/**
 * As pessoas que o quadro mostra: de turno hoje, mais quem disse onde está hoje (check-in) ou está em serviço agora
 * sem ser pessoa de turno, porque a 3.4 conta em "Na loja" e "No galpão" toda pessoa com presença efetiva, e só o
 * "Sem aviso" se restringe a quem tem turno. É o caso da Leni do seed: ausente no cadastro, mas mandou "Galpão" às
 * 08:28 e a precedência da 2.2 põe o check-in acima da ausência. Conta compartilhada nunca entra (6.2). Supervisor
 * vê só o recorte dos setores dele (7.1).
 */
function pessoasDoQuadro(iso, u) {
  const turno = regras.pessoasDeTurno(iso);
  const ids = new Set(turno.map((p) => p.id));
  const registros = dados.agendamentosDoDia(iso).filter(naoCancelado);
  const presencas = dados.presencasDoDia(iso);
  /* Quem tem registro hoje sem ser pessoa de campo (a florista que monta o Natal da loja, por exemplo) também é
     demanda do dia, e o quadro existe para a gerência enxergar todas as demandas: entra, e cai no grupo que a
     presença efetiva disser. Sem registro e sem check-in, quem não é de turno continua fora. */
  const comRegistro = new Set();
  for (const a of registros) for (const id of regras.expandirPessoas(a)) comRegistro.add(id);
  const avisaram = dados.usuariosAtivos().filter((p) => {
    if (ids.has(p.id) || p.contaCompartilhada) return false;
    if (comRegistro.has(p.id)) return true;
    const pres = regras.presencaEfetiva(p.id, iso, null, { usuario: p, agendamentos: registros, presencas });
    return !!pres && pres.origem !== 'escala';
  });
  const todas = turno.concat(avisaram).sort(util.porNome);
  if (!u || u.perfil !== 'supervisor') return todas;
  const meus = new Set(idsSetores(u));
  return todas.filter((p) => p.id === u.id || (p.setores || []).some((s) => meus.has(s)));
}

/**
 * Uma leitura só do dia, já com tudo o que o quadro precisa por pessoa: onde está, se tem atraso, o próximo
 * compromisso e se é gente de cobrar. Cada pessoa cai em exatamente um grupo. Quem não tem presença efetiva se
 * divide em dois: "Sem aviso" é só quem não mandou nem agenda nem lugar, a mesma lista de regras.pessoasSemAviso
 * que o número grande, o texto de cobrança e o aviso no app usam (3.4 e 3.5), para a gerência nunca ler um número
 * e cobrar outro; quem mandou a agenda mas não disse o lugar vai para "Com agenda, sem lugar".
 * @param {string} iso @param {object} u @returns {{itens:object[], registros:object[], numeros:object[], cobrar:object[]}}
 */
function dadosDoQuadro(iso, u) {
  const registros = dados.agendamentosDoDia(iso).filter(naoCancelado);
  const presencas = dados.presencasDoDia(iso);
  const pessoas = pessoasDoQuadro(iso, u);
  const agoraMs = Date.now();
  const doQuadro = new Set(pessoas.map((p) => p.id));
  /* Quem não mandou nem agenda nem lugar: é esta lista, e só ela, que vai no texto de cobrança (3.5). */
  const cobranca = new Set(regras.pessoasSemAviso(iso, registros, presencas).filter((p) => doQuadro.has(p.id)).map((p) => p.id));
  const itens = pessoas.map((pessoa) => {
    const meus = registros.filter((a) => regras.expandirPessoas(a).has(pessoa.id)).sort(porHora);
    const presenca = regras.presencaEfetiva(pessoa.id, iso, null, { usuario: pessoa, agendamentos: registros, presencas });
    const servico = presenca && presenca.servicoId ? meus.find((a) => a.id === presenca.servicoId) || null : null;
    const proximo = meus.find((a) => !regras.statusFinal(a.status) && a !== servico) || null;
    return {
      pessoa,
      presenca,
      servico,
      proximo,
      atrasado: meus.some((a) => !!regras.atrasoDe(a, agoraMs)),
      cobrar: cobranca.has(pessoa.id),
      grupo: presenca ? presenca.lugar : (cobranca.has(pessoa.id) ? 'sem_aviso' : 'sem_lugar')
    };
  });
  const conta = (id) => itens.filter((x) => x.grupo === id).length;
  const atrasados = itens.filter((x) => x.atrasado).length;
  const numeros = NUMEROS_QUADRO.map((n) => ({ id: n.id, rotulo: n.rotulo, valor: conta(n.id) }));
  if (atrasados > 0) numeros.push({ id: 'atrasados', rotulo: 'Atrasados', valor: atrasados });
  return { itens, registros, numeros, cobrar: itens.filter((x) => x.cobrar) };
}

/** Cor da barra de cada número (3.4): a dos lugares vem de dados.LUGARES, e os dois próprios ficam aqui. */
function classeNumero(id) {
  if (id === 'sem_aviso') return 'quadro-num-sem-aviso';
  if (id === 'atrasados') return 'quadro-cor-st-atrasado';
  return classeLugar(id);
}

/** Os números grandes, que filtram o quadro ao toque e soltam o filtro no segundo toque (3.2, item 2). */
function numerosQuadroHTML(numeros, foco) {
  const cartoes = numeros.map((n) => {
    const ativo = foco === n.id;
    const rotuloAria = n.rotulo + ', ' + plural(n.valor, 'pessoa', 'pessoas') + (ativo ? '. Toque para tirar o filtro' : '. Toque para filtrar o quadro');
    return '<button type="button" class="quadro-numero ' + esc(classeNumero(n.id)) + '" data-acao="quadro-foco" data-valor="' + esc(n.id) + '"' +
      ' aria-pressed="' + (ativo ? 'true' : 'false') + '" aria-label="' + esc(rotuloAria) + '">' +
      '<span class="quadro-numero-valor">' + esc(String(n.valor)) + '</span>' +
      '<span class="quadro-numero-rotulo">' + esc(n.rotulo) + '</span></button>';
  }).join('');
  return '<div class="quadro-numeros" role="group" aria-label="Pessoas hoje, por lugar">' + cartoes + '</div>' +
    '<p class="quadro-unidade">Cada número conta pessoas. A linha de cima conta registros.</p>';
}

/** O cartão de pessoa (3.2): avatar de 56 px, primeiro nome, o lugar, desde que horas e o próximo compromisso. */
function cartaoPessoaQuadroHTML(item, gestao) {
  const p = item.pessoa;
  const semAviso = item.grupo === 'sem_aviso';
  const semLugar = item.grupo === 'sem_lugar';
  const lugar = semAviso || semLugar ? null : dados.lugarPorId(item.grupo);
  /* Duas situações sem presença, em dois grupos: quem não mandou nada está "Sem aviso" e é quem a gerência cobra;
     quem mandou a agenda mas não disse o lugar aparece como "Não disse onde está", porque chamar de sem aviso
     quem já postou a agenda seria acusar errado. */
  const rotulo = semAviso ? 'Sem aviso' : (semLugar ? 'Não disse onde está' : dados.nomeDoLugar(item.presenca));
  const nomeIcone = semAviso ? 'pontos' : (semLugar ? 'calendario' : lugar.icone);
  const linhas = [];
  if (item.servico) {
    const cliente = dados.nomeDoCliente(item.servico);
    linhas.push({ classe: 'quadro-pessoa-fazendo', texto: [dados.nomeDoServico(item.servico), cliente].filter(Boolean).join(', ') });
  }
  if (item.presenca && item.presenca.desde) linhas.push({ classe: 'quadro-pessoa-desde', texto: 'desde ' + item.presenca.desde });
  else if (item.presenca && item.presenca.origem === 'escala') linhas.push({ classe: 'quadro-pessoa-desde', texto: 'pela escala' });
  /* Quem não avisou nada ganha o botão de pedir no lugar do compromisso (3.2 e 3.5); quem tem registro mas não
     disse o lugar mostra o compromisso, porque pedir agenda a quem já mandou agenda é pedir o que já veio. */
  const rodape = semAviso && gestao
    ? '<button type="button" class="btn btn-secundario btn-pq quadro-pedir" data-acao="pedir-pessoa" data-id="' + esc(p.id) + '">Pedir agenda</button>'
    : (item.proximo
      ? '<p class="quadro-pessoa-prox">' + esc([dados.rotuloPeriodo(item.proximo) || 'Sem hora', dados.nomeDoServico(item.proximo)].join(', ')) + '</p>'
      : '');
  const corpo = linhas.map((l) => '<p class="' + l.classe + '">' + esc(l.texto) + '</p>').join('');
  const classe = semAviso ? 'quadro-pessoa-sem-aviso' : (semLugar ? 'quadro-pessoa-sem-lugar' : classeLugar(item.grupo));
  return '<article class="quadro-pessoa ' + esc(classe) + '" data-grupo="' + esc(item.grupo) + '">' +
    '<span class="quadro-pessoa-barra" aria-hidden="true"></span>' +
    ui.avatar(p, { tamanho: 'g', status: true }) +
    '<div class="quadro-pessoa-corpo">' +
      '<p class="quadro-pessoa-nome"><span class="quadro-pessoa-nome-txt">' + esc(util.primeiroNome(p.nome)) + '</span>' +
        (item.atrasado ? '<span class="quadro-pessoa-atraso">Atrasado</span>' : '') + '</p>' +
      '<p class="quadro-pessoa-lugar">' + icone(nomeIcone, 16) + '<span>' + esc(rotulo) + '</span></p>' +
      corpo + rodape +
    '</div></article>';
}

/** Um grupo de pessoas, com o título em 12 px caixa alta e a contagem em pessoas. */
function grupoQuadroHTML(id, itens, gestao) {
  const rotulo = ROTULOS_GRUPO[id] || dados.lugarPorId(id).rotulo;
  return '<section class="quadro-grupo" data-grupo="' + esc(id) + '">' +
    '<h3 class="quadro-grupo-titulo">' + esc(rotulo) + '<span class="quadro-grupo-qtd">' + esc(plural(itens.length, 'pessoa', 'pessoas')) + '</span></h3>' +
    '<div class="quadro-cartoes">' + itens.map((x) => cartaoPessoaQuadroHTML(x, gestao)).join('') + '</div></section>';
}

/**
 * O bloco "Quem ainda não avisou" (3.5): a lista, e os dois botões. "Pedir a agenda" copia o texto para o grupo;
 * "Avisar no app" dispara a notificação interna. O app não envia nada sozinho para o WhatsApp, nunca.
 */
function blocoSemAvisoHTML(itens, cobrar, gestao) {
  const corpo = itens.length
    ? '<div class="quadro-cartoes">' + itens.map((x) => cartaoPessoaQuadroHTML(x, gestao)).join('') + '</div>'
    : '<p class="quadro-tudo-certo">' + icone('check', 18) + '<span>Todo mundo já avisou</span></p>';
  const botoes = gestao && cobrar.length
    ? '<div class="quadro-semaviso-acoes">' +
      '<button type="button" class="btn btn-primario" data-acao="pedir-agenda">' + icone('copiar', 18) + '<span>Pedir a agenda</span></button>' +
      '<button type="button" class="btn btn-secundario" data-acao="avisar-app">' + icone('sino', 18) + '<span>Avisar no app</span></button>' +
      '</div>'
    : '';
  return '<section class="quadro-grupo quadro-semaviso" data-grupo="sem_aviso">' +
    '<h3 class="quadro-grupo-titulo">Sem aviso<span class="quadro-grupo-qtd">' + esc(plural(itens.length, 'pessoa', 'pessoas')) + '</span></h3>' +
    corpo + botoes + '</section>';
}

/** "Próximas horas", a coluna da direita do desktop (3.3): o que ainda vai começar hoje. */
function proximasHorasHTML(registros) {
  const agora = util.agoraMin();
  const itens = registros
    .filter((a) => a.horaInicio && !regras.statusFinal(a.status) && min(a.horaInicio) >= agora)
    .sort(porHora).slice(0, MAX_PROXIMAS_HORAS);
  if (!itens.length) return '';
  return '<section class="quadro-proximas">' +
    '<h3 class="quadro-grupo-titulo">Próximas horas</h3>' +
    '<ul class="quadro-proximas-lista">' + itens.map((a) => {
      const cliente = dados.nomeDoCliente(a);
      return '<li><button type="button" class="quadro-proxima" data-acao="abrir" data-id="' + esc(a.id) + '">' +
        '<span class="quadro-proxima-hora">' + esc(a.horaInicio) + '</span>' +
        '<span class="quadro-proxima-nome">' + esc(dados.nomeDoServico(a) + (cliente ? ', ' + cliente : '')) + '</span></button></li>';
    }).join('') + '</ul></section>';
}

const pctFita = (m) => ((util.clamp(m, FITA_DE_MIN, FITA_ATE_MIN) - FITA_DE_MIN) / FITA_FAIXA_MIN) * 100;
const pctTexto = (n) => (Math.round(n * 1000) / 1000) + '%';

/** Empilha os blocos em faixas para que dois serviços no mesmo horário não se cubram. */
function faixasDaFita(registros) {
  const blocos = registros
    .filter((a) => a.horaInicio)
    .map((a) => {
      const ini = min(a.horaInicio);
      const fim = a.horaFim ? min(a.horaFim) : ini + FITA_DURACAO_PADRAO;
      return { a, ini, fim: Math.max(fim, ini + FITA_DURACAO_MIN) };
    })
    .filter((b) => b.fim > FITA_DE_MIN && b.ini < FITA_ATE_MIN)
    .sort((x, y) => x.ini - y.ini || String(x.a.id).localeCompare(String(y.a.id)));
  const fimPorFaixa = [];
  for (const b of blocos) {
    let i = 0;
    while (i < fimPorFaixa.length && fimPorFaixa[i] > b.ini) i += 1;
    b.faixa = i;
    fimPorFaixa[i] = b.fim;
  }
  return { blocos, faixas: Math.max(1, fimPorFaixa.length) };
}

/** A linha do dia (3.2, item 4): 08:00 às 19:00, um bloco por serviço na cor do setor e o fio de agora. */
function linhaDoDiaHTML(iso, registros) {
  const { blocos, faixas } = faixasDaFita(registros);
  /* O rótulo da última hora não entra: ele cairia em cima da borda direita da fita. O fio das 19:00 continua lá,
     porque as linhas da hora são o gradiente do trilho, não estes elementos. */
  const horas = [];
  for (let m = FITA_DE_MIN; m < FITA_ATE_MIN; m += 60) {
    horas.push('<span class="quadro-fita-hora" style="left:' + pctTexto(pctFita(m)) + '">' + esc(util.minParaHora(m)) + '</span>');
  }
  const corpo = blocos.map((b) => {
    const cliente = dados.nomeDoCliente(b.a);
    const rotulo = [b.a.horaInicio, dados.nomeDoServico(b.a), cliente].filter(Boolean).join(', ');
    const esquerda = pctFita(b.ini);
    const largura = Math.max(2, pctFita(b.fim) - esquerda);
    const classeSetor = b.a.setorId ? ' setor-' + esc(b.a.setorId) : '';
    return '<button type="button" class="quadro-bloco' + classeSetor + '" data-acao="abrir" data-id="' + esc(b.a.id) + '"' +
      ' style="left:' + pctTexto(esquerda) + ';width:' + pctTexto(largura) + ';--quadro-faixa:' + b.faixa + '"' +
      ' title="' + esc(rotulo) + '" aria-label="' + esc('Abrir, ' + rotulo) + '">' +
      '<span class="quadro-bloco-texto">' + esc(dados.nomeDoServico(b.a)) + '</span></button>';
  }).join('');
  const agora = util.agoraMin();
  const marca = iso === util.hojeISO() && agora >= FITA_DE_MIN && agora <= FITA_ATE_MIN
    ? '<span class="quadro-agora" style="left:' + pctTexto(pctFita(agora)) + '" aria-hidden="true"></span>'
    : '';
  const semHora = registros.filter((a) => !a.horaInicio).length;
  return '<section class="quadro-fita" aria-label="A linha do dia">' +
    '<h3 class="quadro-grupo-titulo">A linha do dia</h3>' +
    '<div class="quadro-fita-rolagem"><div class="quadro-fita-trilho" style="--quadro-faixas:' + faixas + '">' +
      '<div class="quadro-fita-regua" aria-hidden="true">' + horas.join('') + '</div>' + corpo + marca +
    '</div></div>' +
    (semHora ? '<p class="quadro-fita-nota">' + esc(plural(semHora, 'registro sem hora, fora da linha', 'registros sem hora, fora da linha')) + '</p>' : '') +
    '</section>';
}

/** O filtro dos números grandes: um grupo, ou só quem está atrasado. */
function aplicarFocoQuadro(itens, foco) {
  if (!foco) return itens;
  if (foco === 'atrasados') return itens.filter((x) => x.atrasado);
  return itens.filter((x) => x.grupo === foco);
}

/**
 * O quadro do dia: números grandes, grupos de pessoas, o bloco de quem não avisou, as próximas horas e a linha do dia.
 * @param {string} iso @param {object} u @param {{quadroFoco:string}} estado @returns {string}
 */
function quadroHTML(iso, u, estado) {
  const gestao = dados.ehGestao(u);
  const d = dadosDoQuadro(iso, u);
  const foco = d.numeros.some((n) => n.id === estado.quadroFoco) ? estado.quadroFoco : '';
  const visiveis = aplicarFocoQuadro(d.itens, foco);
  const gruposDe = (ids) => ids
    .map((id) => ({ id, itens: visiveis.filter((x) => x.grupo === id) }))
    .filter((g) => g.itens.length)
    .map((g) => grupoQuadroHTML(g.id, g.itens, gestao)).join('');
  /* A ordem do DOM é a ordem da 3.2, com "Sem aviso" antes de "Folga": os grupos de cima, o bloco lateral e os
     grupos de baixo. No celular é a ordem de leitura; no desktop o CSS leva o lateral para a coluna da direita. */
  const grupos = gruposDe(GRUPOS_QUADRO);
  const gruposFim = gruposDe(GRUPOS_QUADRO_FIM);
  const semAviso = visiveis.filter((x) => x.grupo === 'sem_aviso');
  /* "Sem aviso" aparece mesmo vazio, porque o zero ali é a informação que a gerência quer (3.2). Com o filtro em
     outro número ele sai, senão a tela diria "todo mundo avisou" enquanto mostra só a gente da loja. */
  const temGente = d.itens.length > 0;
  const lado = (temGente && (foco === '' || foco === 'sem_aviso') ? blocoSemAvisoHTML(semAviso, d.cobrar, gestao) : '') +
    proximasHorasHTML(d.registros);
  /* Dia sem ninguém de turno (domingo, feriado) não é "todo mundo avisou": é dia sem escala, e a frase diz isso. */
  const aviso = (!temGente || (!grupos && !gruposFim && !semAviso.length))
    ? '<p class="quadro-tudo-certo">' + icone('info', 18) + '<span>' +
      esc(temGente ? 'Ninguém neste filtro' : 'Ninguém de turno hoje') + '</span></p>'
    : '';
  return numerosQuadroHTML(d.numeros, foco) +
    '<div class="quadro-corpo"' + (foco ? ' data-foco="' + esc(foco) + '"' : '') + '>' +
    (grupos || aviso ? '<div class="quadro-grupos">' + grupos + aviso + '</div>' : '') +
    (lado ? '<aside class="quadro-lado">' + lado + '</aside>' : '') +
    (gruposFim ? '<div class="quadro-grupos quadro-grupos-fim">' + gruposFim + '</div>' : '') +
    '</div>' + linhaDoDiaHTML(iso, d.registros);
}

/* ---- Pedir a agenda: o texto para colar e o aviso interno (3.5) ---- */

/** "Bom dia" na janela do ritual, e o que for verdade no resto do dia. O grupo abre às 08:32, mas o app abre sempre. */
function saudacaoDaHora() {
  const m = util.agoraMin();
  if (m < 12 * 60) return 'Bom dia';
  return m < 18 * 60 ? 'Boa tarde' : 'Boa noite';
}

/** O texto de 3.5, com a última linha que ensina o grupo a mandar o check-in curto, que é o que o app sabe ler. */
function textoPedidoDeAgenda(nomes) {
  return ['*AGENDA GREEN*', '',
    saudacaoDaHora() + ', agenda de hoje por favor.',
    'Falta: ' + nomes.join(', ') + '.',
    'Se for só o lugar, pode mandar uma palavra: loja, galpão ou o cliente.'].join('\n');
}

function copiarPedidoDeAgenda(iso, u, pessoas) {
  if (!pessoas.length) { ui.toast('Todo mundo de turno já avisou hoje', 'info'); return; }
  const nomes = pessoas.map((p) => nomeCurto(p.nome));
  copiarParaOGrupo(textoPedidoDeAgenda(nomes), 'Pedido de agenda em ' + util.fmtDataMedia(iso), u);
}

/** Quem a gerência pode cobrar: de turno, no recorte do quadro, sem registro e sem lugar (3.4 e 3.5). */
function pessoasParaCobrar(iso, u) {
  const doQuadro = new Set(pessoasDoQuadro(iso, u).map((p) => p.id));
  return regras.pessoasSemAviso(iso).filter((p) => doQuadro.has(p.id));
}

/** Troca a vista. Com ?ver= na URL a troca anda pela própria URL, sem gravar preferência (3.1). */
function trocarVistaHoje(u, valor, verNaURL, query) {
  if (!AGRUPAMENTOS_HOJE.some((x) => x.id === valor)) return;
  if (verNaURL) { ui.irPara('#/hoje' + ui.montarQuery(Object.assign({}, query, { ver: valor }))); return; }
  salvarEstadoHoje(u, { agrupamento: valor });
  ui.rerender();
}

/** O aviso interno, no sino que já existe. Nunca uma mensagem automática no WhatsApp (3.5). */
function avisarNoApp(u, pessoas) {
  if (!pessoas.length) { ui.toast('Todo mundo de turno já avisou hoje', 'info'); return; }
  const gravada = dados.notificar({
    tipo: 'agenda',
    para: pessoas.map((p) => p.id),
    titulo: 'Agenda de hoje',
    texto: nomeCurto(u.nome) + ' pediu a agenda de hoje.',
    link: '#/hoje',
    acoes: [{ rotulo: 'Dizer onde estou', rota: '#/hoje' }]
  });
  ui.toast(gravada ? plural(gravada.para.length, 'pessoa avisada no app', 'pessoas avisadas no app') : 'Ninguém para avisar no app', gravada ? 'ok' : 'info');
}

/**
 * Tela Hoje (DIRECAO-2 seção 4, ampliada pela DIRECAO-3 seção 3): a leitura do grupo virada app, tela inicial de
 * todos os perfis, agora em três vistas. O Quadro agrupa PESSOAS por lugar e é o padrão da gestão; Por hora e Por
 * pessoa continuam sendo o feed de REGISTROS, em col-760 e sem mudança nenhuma.
 * A faixa "Onde estou" (2.5) abre as três vistas, para todo perfil.
 * O parâmetro ?ver=quadro|hora|pessoa vence a preferência sem gravá-la, e serve de atalho e de link.
 * A atualização de um em um minuto (3.7) é a que a rota já declara com relogio: true: o relógio de src/app.js
 * re-renderiza só telas marcadas assim, já com guarda de aba escondida, de folha aberta e de campo em edição, e
 * ui.rerender preserva a rolagem. Um segundo setInterval aqui dentro só renderizaria a mesma tela duas vezes.
 * @param {{params:object, query:object, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaHoje(ctx) {
  const u = usuarioDe(ctx);
  const alvo = ctx.alvo;
  if (!u) { ui.irPara('#/entrar', { substituir: true }); return; }
  const iso = util.hojeISO();
  const estado = estadoHoje(u);
  const gestao = dados.ehGestao(u);
  const lista = listaDoFeed(iso, u);
  const query = (ctx && ctx.query) || {};
  const verNaURL = AGRUPAMENTOS_HOJE.some((x) => x.id === query.ver) ? String(query.ver) : '';
  const vista = verNaURL || estado.agrupamento;
  const ehQuadro = vista === 'quadro';

  const cab = ui.montarCabecalho({ titulo: 'Hoje', acoes: (gestao ? botaoCopiarDiaHTML() : '') + botaoAvisosHTML(u, iso) });
  if (cab) {
    ui.delegar(cab, '[data-acao]', 'click', (acao) => {
      if (acao === 'avisos') { abrirAvisos(u, iso); return; }
      if (acao === 'copiar-dia') copiarDiaParaGrupo(iso, u);
    });
  }

  const meus = !ehQuadro && ehPerfilCampo(u) ? lista.filter((a) => ehMeu(a, u)) : [];
  const resto = meus.length ? lista.filter((a) => !ehMeu(a, u)) : lista;
  const grupos = (meus.length ? grupoMeusHTML(meus, u) : '') +
    (vista === 'pessoa' ? gruposPorPessoaHTML(resto, u) : gruposPorHoraHTML(resto, u));

  /* Um estado vazio só, nunca dois empilhados como no Meu dia de antes (4.7). */
  const vazio = ui.estadoVazio({
    icone: 'calendario',
    titulo: 'Ninguém registrou nada hoje',
    texto: 'Assim que alguém registrar, aparece aqui na ordem do dia.',
    acao: dados.pode('criarServico', u) ? { rotulo: 'Registrar', acao: 'registrar' } : null
  });

  /* No quadro as duas faixas da gerência não entram: "Sem aviso" faz o trabalho da faixa de ausências melhor, e
     duas vezes a mesma informação na mesma tela é ruído (3.5). O vermelho do quadro fica só em "Atrasados". */
  const html = '<div class="' + (ehQuadro ? 'quadro' : 'feed col-760') + '">' +
    faixaOndeEstouHTML(u, iso) +
    resumoDoFeedHTML(iso, lista) +
    segmentoHojeHTML(vista) +
    (ehQuadro
      ? quadroHTML(iso, u, estado)
      : (gestao ? faixaAusenciasHTML(semRegistroHoje(iso, lista)) + faixaConflitosHTML(iso, lista, u) : '') +
        (lista.length ? grupos : vazio)) +
    linhaAmanhaHTML(u, rotaServicos('proximos')) +
    '</div>';

  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao.startsWith('ui:')) return;
      const id = el.getAttribute('data-id');
      const pessoa = el.getAttribute('data-pessoa') || u.id;
      if (acao === 'agrupar') { trocarVistaHoje(u, el.getAttribute('data-valor'), verNaURL, query); return; }
      if (acao === 'quadro-foco') {
        const valor = el.getAttribute('data-valor');
        salvarEstadoHoje(u, { quadroFoco: estado.quadroFoco === valor ? '' : valor });
        ui.rerender();
        return;
      }
      if (acao === 'onde-marcar') { marcarOndeEstou(pessoa, iso, el.getAttribute('data-valor'), '', u); return; }
      if (acao === 'onde-outro') { abrirCampoOutro(el); return; }
      if (acao === 'onde-salvar-outro') {
        const texto = textoDoCampoOutro(el);
        if (!texto) { ui.toast('Escreva onde você está', 'erro'); return; }
        marcarOndeEstou(pessoa, iso, 'outro', texto, u);
        return;
      }
      if (acao === 'onde-trocar') { estadoTela.ondeTrocar = true; ui.rerender(); return; }
      if (acao === 'onde-outra-pessoa') { abrirMarcarPorOutra(u, iso); return; }
      if (acao === 'pedir-agenda') { copiarPedidoDeAgenda(iso, u, pessoasParaCobrar(iso, u)); return; }
      if (acao === 'avisar-app') { avisarNoApp(u, pessoasParaCobrar(iso, u)); return; }
      if (acao === 'pedir-pessoa') {
        const alvoPessoa = dados.usuarioPorId(id);
        if (alvoPessoa) copiarPedidoDeAgenda(iso, u, [alvoPessoa]);
        return;
      }
      if (acao === 'registrar') { ui.irPara(ui.rotaAgendar() + ui.montarQuery({ data: iso })); return; }
      if (acao === 'copiar-dia') { copiarDiaParaGrupo(iso, u); return; }
      if (acao === 'cobrar') { copiarCobrancaParaGrupo(iso, u); return; }
      if (acao === 'feed-status') { abrirStatusSimples(id, u, el); return; }
      if (acao === 'feed-passo') { aplicarStatusDoFeed(id, el.getAttribute('data-valor'), u); return; }
      if (acao === 'reordenar') { alternarReordenar(meusDoDia(iso, u)); ui.rerender(); return; }
      if (acao === 'subir') { moverNaOrdem(id, -1); ui.rerender(); return; }
      if (acao === 'descer') { moverNaOrdem(id, 1); ui.rerender(); return; }
      agendamento.executarAcao(acao, id, { para: el.getAttribute('data-valor') });
    });
  });
  /* Sem manterRolagem fixo: no rerender a rolagem já é preservada por ui.renderizar, e na primeira abertura
     (logo depois do login) a rolagem que sobrava da tela anterior escondia a linha de data sob o cabeçalho. */

  montarFabNovo(u, iso);
}
