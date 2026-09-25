/* Green Agenda, módulo recursos: src/recursos.js
   Telas de veículos (lista, ficha, formulário, indisponibilidade), equipes,
   pessoas, hub de cadastros, tipos de serviço, horários e loja, usuários,
   dados de demonstração, notificações (tela e popover), auditoria (tela e
   CSV), conta e sincronização.
   Importa cartaoServico e abrirTrocarCarro de src/agendamento.js.
   Referência no v1 (app/index.html): STATUS_RECURSO e agendaDoRecurso
   4351 a 4354, TELAS.equipes 4355 a 4377, TELAS.veiculos 4378 a 4399,
   TELAS.notificacoes 4320 a 4346, cartaoNotif 2163 a 2173, TELAS.usuarios
   e salvarUsuario 4751 a 4787, mudarStatusUsuario 4298, salvarHorario 4906
   a 4913, novoTipoServico/removerTipoServico 4969 a 4980, configurações de
   notificação 4877 a 4880, sheet de rede e sincronização 1850 a 1921,
   iniciarPWA/abrirInstalacao 5228 a 5254.
   Ver ESPECIFICACAO.md, seção 9.

   Convenções internas:
   - Formulários guardam o que foi digitado em `rascunhos` (por chave de
     rota) para sobreviver ao rerender disparado por dados:alterado. O
     rascunho é apagado ao navegar para outra rota e ao gravar.
   - Campos de formulário usam data-campo e são lidos por delegação de
     input e change; chips alternáveis usam data-acao="alternar-chip" com
     data-grupo e data-valor.
   - O popover do sino e a notificação nativa do aparelho são ligados em
     registrarTelasRecursos, uma única vez. */

import * as util from './util.js';
import * as dados from './dados.js';
import * as regras from './regras.js';
import * as ui from './ui.js';
import { icone, ICONES } from './icones.js';
import * as grade from './grade.js';
import * as agendamento from './agendamento.js';

const { esc } = util;
const { repo } = dados;

const VERSAO_APP = '1.0';
const AVISO_ARMAZENAMENTO_BYTES = 4 * 1024 * 1024;
/* "loja" entrou com o tipo Loja (DIRECAO-2 2.6). Ícone que o cadastro não lista não aparece na grade
   e, pior, seria trocado por "caixa" no primeiro salvamento: a lista precisa acompanhar icones.js. */
const ICONES_TIPO = ['loja', 'caixa', 'sofa', 'cortina', 'regua', 'prancheta', 'planta', 'chave', 'ferramenta', 'flor', 'broto', 'tesoura', 'caixaseta'];
const TIPOS_VEICULO = ['Furgão', 'Caminhão 3/4', 'Utilitário'];
const DIAS_CONFIG = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const STATUS_USUARIO = [['disponivel', 'Disponível'], ['ocupado', 'Ocupado'], ['ausente', 'Ausente']];
const ESCALA_PADRAO = { seg_sex: { de: '08:00', ate: '18:00' }, sab: { de: '08:30', ate: '12:30' }, dom: null, folgas: [] };
const PREFS_NOTIF_PADRAO = { agenda: true, status: true, conflito: true, atraso: true, sistema: true };
const ROTULO_OP_FILA = { criar: 'Criar', atualizar: 'Atualizar', remover: 'Remover' };
const ROTULO_ENTIDADE = {
  agendamentos: 'Serviço', clientes: 'Cliente', veiculos: 'Veículo', equipes: 'Equipe', indisponibilidades: 'Indisponibilidade',
  tipos: 'Tipo de serviço', config: 'Horários e loja', usuarios: 'Usuário', credenciais: 'Senha', assinaturas: 'Assinatura',
  agendamento: 'Serviço', veiculo: 'Veículo', equipe: 'Equipe', indisponibilidade: 'Indisponibilidade', tipo: 'Tipo de serviço',
  usuario: 'Usuário', sessao: 'Sessão', sistema: 'Sistema'
};
const ENTIDADES_AUDITORIA = ['agendamento', 'veiculo', 'equipe', 'indisponibilidade', 'tipo', 'config', 'usuario', 'sessao', 'sistema'];

/* ================================================================== */
/* Apoio                                                               */
/* ================================================================== */

const usuarioAtual = () => dados.sessao.usuario();
const hoje = () => util.hojeISO();
const agoraHora = () => util.minParaHora(util.agoraMin());
const { plural, unicos, nomeCurto, classeCarro } = util;
const { ehDesktop } = ui;
const min = (hora) => util.horaParaMin(hora);
const capitalizar = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const horaValida = (h) => /^\d{2}:\d{2}$/.test(String(h || ''));
const dataValida = (d) => util.dataValida(d);

const nomeUsuario = (id) => { const u = dados.usuarioPorId(id); return u ? u.nome : ''; };
const nomeCurtoDe = (id) => nomeCurto(nomeUsuario(id));
/* Os pares id mais texto da v3 (DIRECAO-2 2.2): o id vence quando existe, e o texto livre é o que
   se mostra quando não existe id. Sem isto, "Montagem do Natal da loja" aparecia como "Serviço" no
   próximo uso do carro e na agenda do recurso (passada de crítica de 22/09/2026, lote 5). */
const nomeTipo = (a) => dados.nomeDoServico(a);
const nomeCliente = (a) => dados.nomeDoCliente(a);
const tituloServico = (a) => [nomeTipo(a), nomeCliente(a)].filter(Boolean).join(', ');
const apelidoVeiculo = (v) => (v ? (v.apelido || v.nome || '') : '');
const apelidoEquipe = (e) => (e ? (e.apelido || e.nome || '') : '');
const podeEditarRecursos = (u) => dados.pode('editarRecursos', u) === true;
const podeIndisponibilidade = (u) => !!dados.pode('editarRecursos', u);

function inicialCarro(v, tamanho = 'g') {
  if (!v) return '';
  const letra = String(v.inicial || (v.apelido || '?')[0]).toUpperCase();
  return '<span class="inicial inicial-' + tamanho + ' ' + classeCarro(v) + '" aria-hidden="true">' + esc(letra) + '</span>';
}

function chipEstado(estado) {
  return '<span class="chip chip-estado ' + esc(estado.classe) + '"><span>' + esc(estado.rotulo) + '</span></span>';
}

function pontoTurno(u, iso, hora) {
  if (!u) return '';
  if (regras.emFolga(u, iso)) return '<span class="ponto-turno" data-turno="folga" title="Folga"></span>';
  if (u.status === 'ausente') return '<span class="ponto-turno" data-turno="ausente" title="Ausente"></span>';
  if (regras.estaDeServico(u, iso, hora)) return '<span class="ponto-turno" data-turno="em" title="Em turno"></span>';
  return '<span class="ponto-turno" data-turno="fora" title="Fora de escala"></span>';
}

function textoTurno(u, iso, hora) {
  if (!u) return '';
  if (regras.emFolga(u, iso)) return 'Folga';
  if (u.status === 'ausente') return 'Ausente';
  if (regras.estaDeServico(u, iso, hora)) return 'Em turno';
  return 'Fora de escala';
}

function agendamentosAtivosDoRecurso(filtro, isoIni, isoFim) {
  return dados.agendamentosEntre(isoIni, isoFim).filter((a) => regras.statusAtivo(a.status) && filtro(a));
}

function usaEquipe(a, equipe) {
  if (!a || !equipe) return false;
  if (a.equipeId === equipe.id) return true;
  const membros = equipe.membros || [];
  return membros.length > 0 && membros.every((m) => (a.responsaveis || []).includes(m));
}

/** Formato de tamanho para a tela de dados: "12,4 KB". */
function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
  return (n / (1024 * 1024)).toFixed(2).replace('.', ',') + ' MB';
}

function telaSemAcesso(alvo, titulo) {
  ui.montarCabecalho({ voltar: true, titulo: titulo || 'Sem acesso' });
  ui.renderizar(alvo, '<div class="tela-erro">' + ui.estadoVazio({ icone: 'cadeado', titulo: 'Você não tem acesso a essa tela', acao: { rotulo: 'Voltar', acao: 'ui:voltar' } }) + '</div>');
}

function telaNaoEncontrado(alvo, titulo, texto) {
  ui.montarCabecalho({ voltar: true, titulo });
  ui.renderizar(alvo, '<div class="tela-erro">' + ui.estadoVazio({ icone: 'alerta', titulo, texto, acao: { rotulo: 'Voltar', acao: 'ui:voltar' } }) + '</div>');
}

/* ---- Rascunhos de formulário (sobrevivem ao rerender) ---- */

const rascunhos = new Map();

/* 'rota:alterada' chega DEPOIS do render da tela nova. Limpar tudo nessa hora apagava também o
   rascunho que a tela acabara de criar, e o primeiro rerender do repositório (uma sincronização,
   uma notificação) devolvia o formulário ao que estava gravado, perdendo o que a pessoa já tinha
   mexido sem estar com o foco num campo (o "+" de faixa da Disponibilidade, por exemplo). Cada
   rascunho guarda a geração de rota em que foi usado pela última vez, e só os de outra rota saem. */
let geracaoRota = 0;

function estadoForm(chave, inicial) {
  if (!rascunhos.has(chave)) rascunhos.set(chave, { valores: inicial(), erros: {}, mexeu: false });
  const r = rascunhos.get(chave);
  r.geracao = geracaoRota;
  return r;
}

function limparRascunho(chave) {
  rascunhos.delete(chave);
}

function limparTodosRascunhos() {
  for (const [chave, r] of rascunhos) if (r.geracao !== geracaoRota) rascunhos.delete(chave);
  geracaoRota += 1;
}

/** Liga a leitura dos campos [data-campo] (input e change) e dos chips alternáveis ao estado do formulário. */
function ligarForm(alvo, estado, aoMudar) {
  const guardar = (el) => {
    const campo = el.getAttribute('data-campo');
    if (!campo) return;
    let valor;
    if (el.type === 'checkbox') valor = !!el.checked;
    else if (el.type === 'number') valor = el.value === '' ? '' : Number(el.value);
    else valor = el.value;
    estado.valores[campo] = valor;
    estado.mexeu = true;
    if (typeof aoMudar === 'function') aoMudar(campo, valor, el);
  };
  ui.delegar(alvo, '[data-campo]', 'input', (acao, el) => guardar(el));
  ui.delegar(alvo, '[data-campo]', 'change', (acao, el) => guardar(el));
  ui.delegar(alvo, '[data-acao="alternar-chip"]', 'click', (acao, el) => {
    const grupo = el.getAttribute('data-grupo');
    const valor = el.getAttribute('data-valor');
    if (!grupo) return;
    const unico = el.hasAttribute('data-unico');
    if (unico) {
      estado.valores[grupo] = valor;
      alvo.querySelectorAll('[data-acao="alternar-chip"][data-grupo="' + grupo + '"]').forEach((c) => marcarChip(c, c === el));
    } else {
      const lista = Array.isArray(estado.valores[grupo]) ? estado.valores[grupo].slice() : [];
      const i = lista.indexOf(valor);
      if (i >= 0) lista.splice(i, 1); else lista.push(valor);
      estado.valores[grupo] = lista;
      marcarChip(el, i < 0);
    }
    estado.mexeu = true;
    if (typeof aoMudar === 'function') aoMudar(grupo, estado.valores[grupo], el);
  });
}

function marcarChip(el, ativo) {
  el.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  if (ativo) el.setAttribute('data-ativo', ''); else el.removeAttribute('data-ativo');
}

function chipEscolha(grupo, valor, rotulo, ativo, opcoes = {}) {
  return '<button type="button" class="chip chip-escolha" data-acao="alternar-chip" data-grupo="' + esc(grupo) + '" data-valor="' + esc(valor) + '"' +
    (opcoes.unico ? ' data-unico' : '') + (ativo ? ' data-ativo' : '') + ' aria-pressed="' + (ativo ? 'true' : 'false') + '">' +
    (opcoes.icone ? icone(opcoes.icone, 16) : '') + '<span>' + esc(rotulo) + '</span></button>';
}

function chipsSetores(grupo, escolhidos, setoresPermitidos) {
  const lista = setoresPermitidos || dados.SETORES;
  return '<div class="chips-escolha" role="group" aria-label="Setores">' +
    lista.map((s) => chipEscolha(grupo, s.id, s.nome, (escolhidos || []).includes(s.id), { icone: s.icone })).join('') + '</div>';
}

function interruptor(campo, ligado, rotulo, sub) {
  const id = 'sw-' + campo.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  return '<div class="linha-interruptor"><label for="' + id + '"><span class="linha-interruptor-rotulo">' + esc(rotulo) + '</span>' +
    (sub ? '<div class="linha-interruptor-sub">' + esc(sub) + '</div>' : '') + '</label>' +
    '<span class="interruptor"><input type="checkbox" id="' + id + '" data-campo="' + esc(campo) + '"' + (ligado ? ' checked' : '') + ' aria-label="' + esc(rotulo) + '"></span></div>';
}

function interruptorSimples(campo, ligado, ariaLabel, extra = '') {
  return '<span class="interruptor"><input type="checkbox" data-campo="' + esc(campo) + '"' + (ligado ? ' checked' : '') + ' aria-label="' + esc(ariaLabel) + '"' + (extra ? ' ' + extra : '') + '></span>';
}

function campoTexto(campo, rotulo, valor, opcoes = {}) {
  const extra = opcoes.atributos ? ' ' + opcoes.atributos : '';
  const op = Object.assign({}, opcoes);
  delete op.atributos;
  return ui.campo(Object.assign({ id: 'f-' + campo, rotulo, valor: valor == null ? '' : valor }, op, { atributos: 'data-campo="' + esc(campo) + '"' + extra }));
}

function rodapeForm(rotuloOk, opcoes = {}) {
  return '<div class="form-rodape-acoes">' +
    '<button type="button" class="btn btn-fantasma" data-acao="cancelar-form">Cancelar</button>' +
    '<button type="button" class="btn btn-primario" data-acao="salvar-form"' + (opcoes.desativado ? ' disabled' : '') + '>' + esc(rotuloOk) + '</button></div>';
}

function mostrarErros(alvo, erros) {
  alvo.querySelectorAll('.msg-erro-campo[data-erro-de]').forEach((el) => { el.hidden = true; el.textContent = ''; });
  alvo.querySelectorAll('.campo-erro').forEach((el) => el.classList.remove('campo-erro'));
  let primeiro = null;
  for (const e of erros || []) {
    const el = alvo.querySelector('.msg-erro-campo[data-erro-de="' + e.campo + '"]');
    if (el) {
      el.textContent = e.mensagem;
      el.hidden = false;
      const campo = el.closest('.campo');
      if (campo) campo.classList.add('campo-erro');
      if (!primeiro) primeiro = el;
    }
  }
  if (!primeiro && erros && erros.length) ui.toast(erros[0].mensagem, 'erro');
  if (primeiro) {
    primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const controle = primeiro.closest('.campo') && primeiro.closest('.campo').querySelector('input, select, textarea, button');
    if (controle) controle.focus({ preventScroll: true });
  }
}

const slotErro = (campo) => '<p class="msg-erro-campo" data-erro-de="' + esc(campo) + '" hidden></p>';

async function confirmarDescarte(estado) {
  if (!estado || !estado.mexeu) return true;
  return ui.confirmar({ titulo: 'Descartar alterações?', texto: 'O que você digitou neste formulário será perdido.', rotuloOk: 'Descartar', rotuloCancelar: 'Continuar editando', perigo: true });
}

/** Cabeçalho da tela com botão de ação opcional à direita. */
function cabecalhoComAcao(opcoes) {
  const acoes = opcoes.acao
    ? '<button type="button" class="btn-icone" data-acao="' + esc(opcoes.acao.acao) + '" aria-label="' + esc(opcoes.acao.rotulo) + '" title="' + esc(opcoes.acao.rotulo) + '">' + icone(opcoes.acao.icone || 'mais', 22) + '</button>'
    : '';
  return ui.montarCabecalho({ titulo: opcoes.titulo, subtitulo: opcoes.subtitulo, voltar: !!opcoes.voltar, grande: !!opcoes.grande, acoes: acoes + (opcoes.acoesExtra || '') });
}

function ligarCabecalho(cab, handler) {
  if (cab) ui.delegar(cab, '[data-acao]', 'click', handler);
}

/* ================================================================== */
/* Registro de rotas                                                   */
/* ================================================================== */

let ligadoGlobais = false;

/**
 * Registra #/recursos e filhas, #/cadastros e filhas, #/notificacoes, #/auditoria, #/conta,
 * #/sincronizacao (3.1), cada uma com o requer de capacidade. Quem chama: app.iniciar.
 */
export function registrarTelasRecursos() {
  ui.registrarRota('#/recursos', { render: redirecionarRecursos, titulo: 'Recursos', requer: ['verRecursos'] });
  ui.registrarRota('#/recursos/veiculos', { render: telaVeiculos, titulo: 'Veículos', requer: ['verRecursos'], relogio: true });
  ui.registrarRota('#/recursos/veiculos/novo', { render: formVeiculo, titulo: 'Novo veículo', requer: ['editarRecursos'] });
  ui.registrarRota('#/recursos/veiculos/:id', { render: telaVeiculo, titulo: 'Veículo', requer: ['verRecursos'], relogio: true });
  ui.registrarRota('#/recursos/veiculos/:id/editar', { render: formVeiculo, titulo: 'Editar veículo', requer: ['editarRecursos'] });
  ui.registrarRota('#/recursos/equipes', { render: telaEquipes, titulo: 'Equipes', requer: ['verRecursos'], relogio: true });
  ui.registrarRota('#/recursos/equipes/novo', { render: formEquipe, titulo: 'Nova equipe', requer: ['editarRecursos'] });
  ui.registrarRota('#/recursos/equipes/:id', { render: telaEquipe, titulo: 'Equipe', requer: ['verRecursos'] });
  ui.registrarRota('#/recursos/equipes/:id/editar', { render: formEquipe, titulo: 'Editar equipe', requer: ['editarRecursos'] });
  ui.registrarRota('#/recursos/pessoas', { render: telaPessoas, titulo: 'Pessoas', requer: ['verRecursos'], relogio: true });
  ui.registrarRota('#/notificacoes', { render: telaNotificacoes, titulo: 'Notificações' });
  ui.registrarRota('#/auditoria', { render: telaAuditoria, titulo: 'Auditoria', requer: ['auditoria'] });
  ui.registrarRota('#/cadastros', { render: telaCadastros, titulo: 'Cadastros' });
  ui.registrarRota('#/cadastros/tipos', { render: telaTipos, titulo: 'Tipos de serviço', requer: ['cadastros'] });
  ui.registrarRota('#/cadastros/tipos/novo', { render: formTipo, titulo: 'Novo tipo de serviço', requer: ['cadastros'] });
  ui.registrarRota('#/cadastros/tipos/:id', { render: formTipo, titulo: 'Tipo de serviço', requer: ['cadastros'] });
  ui.registrarRota('#/disponibilidade', { render: telaDisponibilidade, titulo: 'Disponibilidade', requer: ['cadastros'] });
  ui.registrarRota('#/disponibilidade/:aba', { render: telaDisponibilidade, titulo: 'Disponibilidade', requer: ['cadastros'] });
  /* #/cadastros/horarios virou Disponibilidade (DIRECAO 3.5); o endereço antigo continua abrindo, redirecionado. */
  ui.registrarRota('#/cadastros/horarios', { render: redirecionarHorarios, titulo: 'Disponibilidade', requer: ['cadastros'] });
  ui.registrarRota('#/cadastros/usuarios', { render: telaUsuarios, titulo: 'Usuários', requer: ['usuarios'] });
  ui.registrarRota('#/cadastros/usuarios/novo', { render: formUsuario, titulo: 'Novo usuário', requer: ['usuarios'] });
  ui.registrarRota('#/cadastros/usuarios/:id', { render: formUsuario, titulo: 'Usuário', requer: ['usuarios'] });
  ui.registrarRota('#/cadastros/dados', { render: telaDadosDemo, titulo: 'Dados de demonstração', requer: ['dadosDemo'] });
  ui.registrarRota('#/conta', { render: telaConta, titulo: 'Conta' });
  ui.registrarRota('#/sincronizacao', { render: telaSincronizacao, titulo: 'Sincronização' });
  ligarGlobais();
}

function redirecionarRecursos() {
  ui.irPara('#/recursos/veiculos', { substituir: true });
}

function redirecionarHorarios() {
  ui.irPara('#/disponibilidade/loja', { substituir: true });
}

function ligarGlobais() {
  if (ligadoGlobais) return;
  ligadoGlobais = true;
  document.addEventListener('rota:alterada', () => { limparTodosRascunhos(); fecharPopover(); });
  document.addEventListener('ui:sino', (ev) => {
    if (!ehDesktop()) return;
    ev.preventDefault();
    popoverNotificacoes(ev.detail && ev.detail.ancora);
  });
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    promptInstalacao = ev;
  });
  window.addEventListener('appinstalled', () => { promptInstalacao = null; });
  ligarNotificacaoNativa();
}

/* ================================================================== */
/* Veículos (9.1)                                                      */
/* ================================================================== */

function indisponibilidadesFuturas(veiculoId) {
  const marca = util.isoHora(hoje(), agoraHora());
  return dados.indisponibilidadesDoVeiculo(veiculoId).filter((i) => i.ate >= marca);
}

function textoIndisponibilidade(i) {
  const de = util.partesIsoHora(i.de);
  const ate = util.partesIsoHora(i.ate);
  const motivo = dados.MOTIVOS_INDISPONIBILIDADE.find((m) => m.id === i.motivo);
  const rotuloMotivo = motivo ? motivo.rotulo.toLowerCase() : (i.motivo || 'indisponível');
  const diaInteiro = de.hora === '00:00' && ate.hora === '23:59' && de.data === ate.data;
  const dia = capitalizar(util.DIAS_ABR[util.diaSemana(de.data)]) + ' ' + util.dataDe(de.data).getDate();
  if (diaInteiro) return dia + ': ' + rotuloMotivo;
  if (de.data === ate.data) return dia + ', ' + de.hora + ' às ' + ate.hora + ': ' + rotuloMotivo;
  return dia + ' ' + de.hora + ' a ' + util.fmtData(ate.data).slice(0, 5) + ' ' + ate.hora + ': ' + rotuloMotivo;
}

function periodoIndisponibilidade(i) {
  const de = util.partesIsoHora(i.de);
  const ate = util.partesIsoHora(i.ate);
  const diaInteiro = de.hora === '00:00' && ate.hora === '23:59' && de.data === ate.data;
  if (diaInteiro) return util.fmtDataMedia(de.data) + ', dia inteiro';
  if (de.data === ate.data) return util.fmtDataMedia(de.data) + ', ' + de.hora + ' às ' + ate.hora;
  return util.fmtDataMedia(de.data) + ' ' + de.hora + ' até ' + util.fmtDataMedia(ate.data) + ' ' + ate.hora;
}

function proximoUsoVeiculo(veiculoId) {
  const h = hoje();
  const agora = agoraHora();
  const lista = agendamentosAtivosDoRecurso((a) => a.veiculoId === veiculoId, h, util.addDias(h, 60));
  return lista.find((a) => a.data > h || a.horaFim >= agora) || null;
}

function cartaoVeiculoHTML(v, u) {
  const estado = regras.estadoVeiculo(v.id);
  const equipe = v.equipePadraoId ? dados.equipePorId(v.equipePadraoId) : null;
  const proximo = proximoUsoVeiculo(v.id);
  const indisps = indisponibilidadesFuturas(v.id).slice(0, 3);
  const linhas = [];
  /* Placa vazia (a Strada entra sem placa, DIRECAO-2 2.6) não deixa separador solto na frente do tipo. */
  const partesSub = [v.placa ? '<span class="placa">' + esc(v.placa) + '</span>' : '', v.tipo ? esc(v.tipo) : '', equipe ? esc(apelidoEquipe(equipe)) : ''].filter(Boolean);
  linhas.push('<div class="cartao-recurso-sub">' + partesSub.join('\u00a0<span aria-hidden="true">·</span> ') + '</div>');
  linhas.push('<div class="cartao-recurso-linha">' + chipEstado(estado) +
    (proximo ? '<span class="mudo">Próximo uso: ' + esc(util.rotuloDia(proximo.data).toLowerCase() + ' ' + proximo.horaInicio + ', ' + nomeTipo(proximo)) + '</span>' : '<span class="mudo">Sem uso previsto</span>') + '</div>');
  if (indisps.length) {
    linhas.push('<div class="cartao-recurso-linha">' + indisps.map((i) => '<span class="chip cor-alerta">' + icone('ban', 14) + '<span>' + esc(textoIndisponibilidade(i)) + '</span></span>').join('') + '</div>');
  }
  const acoes = [
    ui.botao({ rotulo: 'Ver na agenda', acao: 'ver-agenda', valor: v.id, cls: 'btn-secundario btn-pq', icone: 'calendario' }),
    podeIndisponibilidade(u) && v.ativo ? ui.botao({ rotulo: 'Marcar indisponível', acao: 'indisponivel', valor: v.id, cls: 'btn-secundario btn-pq', icone: 'ban' }) : '',
    podeEditarRecursos(u) ? ui.botao({ rotulo: 'Editar', acao: 'editar', valor: v.id, cls: 'btn-secundario btn-pq', icone: 'editar' }) : ''
  ].filter(Boolean).join('');
  return '<article class="cartao cartao-recurso cartao-veiculo" data-veiculo="' + esc(v.id) + '">' +
    inicialCarro(v) +
    '<div class="cartao-recurso-corpo">' +
      '<div class="cartao-recurso-nome"><button type="button" class="link-nome" data-acao="abrir" data-id="' + esc(v.id) + '">' + esc(v.nome) + '</button>' + (v.ativo ? '' : '<span class="chip chip-desativado">Desativado</span>') + '</div>' +
      linhas.join('') +
      '<div class="cartao-acoes">' + acoes + '</div>' +
    '</div></article>';
}

function ligarAcoesVeiculos(alvo, u) {
  ui.delegar(alvo, '[data-acao]', 'click', (acao, el) => {
    const id = el.getAttribute('data-id') || el.getAttribute('data-valor');
    switch (acao) {
      case 'abrir': ui.irPara('#/recursos/veiculos/' + id); break;
      case 'ver-agenda': ui.irPara('#/agenda/recursos/' + hoje() + '/veiculos'); break;
      case 'indisponivel': if (podeIndisponibilidade(u)) abrirIndisponibilidade(id); break;
      case 'editar': if (podeEditarRecursos(u)) ui.irPara('#/recursos/veiculos/' + id + '/editar'); break;
      case 'novo': if (podeEditarRecursos(u)) ui.irPara('#/recursos/veiculos/novo'); break;
      default: break;
    }
  });
}

/** Lista de veículos (9.1). @param {{params:object, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function telaVeiculos(ctx) {
  const { alvo, usuario } = ctx;
  const cab = cabecalhoComAcao({ titulo: 'Veículos', subtitulo: 'Frota e disponibilidade', acao: podeEditarRecursos(usuario) ? { acao: 'novo', rotulo: 'Novo veículo', icone: 'mais' } : null });
  ligarCabecalho(cab, (acao) => { if (acao === 'novo') ui.irPara('#/recursos/veiculos/novo'); });
  const todos = repo.listar('veiculos').sort((a, b) => (a.indiceCor || 0) - (b.indiceCor || 0) || util.porNome(a, b));
  const ativos = todos.filter((v) => v.ativo);
  const inativos = todos.filter((v) => !v.ativo);
  const abasRecursos = abasRecursosHTML('veiculos');
  let html = '<div class="recursos">' + abasRecursos;
  if (!ativos.length) {
    html += ui.estadoVazio({ icone: 'caminhao', titulo: 'Nenhum veículo ativo', texto: 'Cadastre os carros da operação para alocar nos serviços.', acao: podeEditarRecursos(usuario) ? { rotulo: 'Novo veículo', acao: 'novo' } : null });
  } else {
    html += '<div class="recursos-lista">' + ativos.map((v) => cartaoVeiculoHTML(v, usuario)).join('') + '</div>';
  }
  if (inativos.length) {
    html += '<details class="secao secao-recolhida"><summary class="secao-titulo">' + icone('direita', 16) + ' Desativados (' + inativos.length + ')</summary>' +
      '<div class="recursos-lista mt3">' + inativos.map((v) => cartaoVeiculoHTML(v, usuario)).join('') + '</div></details>';
  }
  html += '</div>';
  ui.renderizar(alvo, html, (raiz) => ligarAcoesVeiculos(raiz, usuario));
}

function abasRecursosHTML(atual) {
  const abas = [['veiculos', 'Veículos', '#/recursos/veiculos'], ['equipes', 'Equipes', '#/recursos/equipes'], ['pessoas', 'Pessoas', '#/recursos/pessoas']];
  return '<div class="abas-pilula" role="tablist" aria-label="Recursos">' + abas.map((a) =>
    '<button type="button" class="aba-pilula" role="tab" aria-selected="' + (a[0] === atual ? 'true' : 'false') + '" data-acao="ui:nav" data-rota="' + a[2] + '">' + a[1] + '</button>'
  ).join('') + '</div>';
}

/* ---- Ficha do veículo ---- */

function indispsParaGrade(veiculoId, iso) {
  return dados.indisponibilidadesDoVeiculo(veiculoId, iso, iso).map((i) => {
    const de = util.partesIsoHora(i.de);
    const ate = util.partesIsoHora(i.ate);
    const motivo = dados.MOTIVOS_INDISPONIBILIDADE.find((m) => m.id === i.motivo);
    return {
      de: de.data < iso ? '00:00' : de.hora,
      ate: ate.data > iso ? '23:59' : ate.hora,
      texto: i.detalhe || (motivo ? motivo.rotulo : 'Indisponível')
    };
  });
}

function navDatasFicha(iso, base) {
  const ehHoje = iso === hoje();
  return '<div class="nav-datas">' +
    '<button type="button" class="btn-icone" data-acao="data-anterior" aria-label="Dia anterior">' + icone('voltar', 22) + '</button>' +
    '<button type="button" class="nav-datas-rotulo" data-acao="escolher-data" aria-label="Escolher data">' + esc(util.rotuloDia(iso)) + '</button>' +
    '<button type="button" class="btn-icone" data-acao="data-seguinte" aria-label="Dia seguinte">' + icone('direita', 22) + '</button>' +
    '<button type="button" class="btn-hoje" data-acao="data-hoje"' + (ehHoje ? ' data-hoje' : '') + '>Hoje</button>' +
    '</div>';
}

function resumo30DiasVeiculo(veiculoId) {
  const h = hoje();
  const lista = dados.agendamentosEntre(util.addDias(h, -30), h).filter((a) => a.veiculoId === veiculoId);
  const concluidos = lista.filter((a) => a.status === 'concluido').length;
  const naoRealizados = lista.filter((a) => a.status === 'nao_realizado').length;
  return '<div class="contadores">' +
    '<div class="contador"><span class="contador-num">' + concluidos + '</span><span class="contador-rotulo">' + (concluidos === 1 ? 'Concluído' : 'Concluídos') + '</span></div>' +
    '<div class="contador"><span class="contador-num">' + naoRealizados + '</span><span class="contador-rotulo">' + (naoRealizados === 1 ? 'Não realizado' : 'Não realizados') + '</span></div>' +
    '</div>';
}

/** Ficha do veículo com grade de um dia, próximos usos com "Trocar carro", indisponibilidades, 30 dias. @param {{params:{id:string, data?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function telaVeiculo(ctx) {
  const { params, query, alvo, usuario } = ctx;
  const v = dados.veiculoPorId(params.id);
  if (!v) { telaNaoEncontrado(alvo, 'Veículo não encontrado', 'O veículo pode ter sido removido.'); return; }
  const iso = dataValida(params.data) ? params.data : dataValida(query.data) ? query.data : hoje();
  const estado = regras.estadoVeiculo(v.id);
  const cab = cabecalhoComAcao({ titulo: v.nome, subtitulo: [v.placa || '', v.tipo || ''].filter(Boolean).join(', '), voltar: true, acao: podeEditarRecursos(usuario) ? { acao: 'editar', rotulo: 'Editar veículo', icone: 'editar' } : null });
  ligarCabecalho(cab, (acao) => { if (acao === 'editar') ui.irPara('#/recursos/veiculos/' + v.id + '/editar'); });

  const doDia = dados.agendamentosDoDia(iso).filter((a) => a.veiculoId === v.id && a.status !== 'cancelado');
  const h = hoje();
  const proximos = agendamentosAtivosDoRecurso((a) => a.veiculoId === v.id, h, util.addDias(h, 7));
  const indisps = dados.indisponibilidadesDoVeiculo(v.id).filter((i) => i.ate >= util.isoHora(h, '00:00'));
  const podeTrocar = !!dados.pode('alocarRecursos', usuario) && !!dados.pode('editarServico', usuario);

  const html =
    '<div class="ficha ficha-veiculo">' +
      '<div class="ficha-cab">' + inicialCarro(v) + '<div class="ficha-cab-corpo"><div class="ficha-cab-nome">' + esc(v.nome) + '</div>' +
        '<div class="ficha-cab-sub">' + esc([v.capacidade, v.equipePadraoId ? 'Equipe padrão: ' + apelidoEquipe(dados.equipePorId(v.equipePadraoId)) : ''].filter(Boolean).join('. ')) + '</div></div>' +
        chipEstado(estado) + '</div>' +
      (v.ativo ? '' : '<p class="campo-aviso">' + icone('alerta', 14) + '<span>Veículo desativado: não aparece para alocação.</span></p>') +
      '<div class="btn-grupo">' +
        ui.botao({ rotulo: 'Ver na agenda', acao: 'ver-agenda', cls: 'btn-secundario btn-pq', icone: 'calendario' }) +
        (podeIndisponibilidade(usuario) && v.ativo ? ui.botao({ rotulo: 'Marcar indisponível', acao: 'indisponivel', valor: v.id, cls: 'btn-secundario btn-pq', icone: 'ban' }) : '') +
      '</div>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Dia</h2></div>' + navDatasFicha(iso) + '<div class="ficha-grade" data-grade></div></section>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Próximos 7 dias</h2><span class="mudo">' + plural(proximos.length, 'serviço', 'serviços') + '</span></div>' +
        (proximos.length
          ? '<div class="lista">' + proximos.map((a) => agendamento.cartaoServico(a, { variante: 'lista', mostrarData: true, acoesAtencao: podeTrocar ? ['trocarCarro'] : [] })).join('') + '</div>'
          : ui.estadoVazio({ icone: 'calendario', titulo: apelidoVeiculo(v) + ' livre nos próximos 7 dias' })) +
      '</section>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Indisponibilidades</h2></div>' +
        (indisps.length
          ? '<div class="lista lista-cartao indisp-lista">' + indisps.map((i) => '<div class="item"><div class="item-corpo"><div class="indisp-periodo">' + esc(periodoIndisponibilidade(i)) + '</div>' +
              '<div class="indisp-motivo">' + esc((dados.MOTIVOS_INDISPONIBILIDADE.find((m) => m.id === i.motivo) || { rotulo: i.motivo }).rotulo) + (i.detalhe ? ': ' + esc(i.detalhe) : '') + (i.criadoPor ? ' <span class="pequeno">(' + esc(nomeCurtoDe(i.criadoPor)) + ')</span>' : '') + '</div></div>' +
              (podeIndisponibilidade(usuario) ? '<div class="item-fim">' + ui.botao({ rotulo: 'Remover', acao: 'remover-indisp', valor: i.id, cls: 'btn-fantasma btn-pq', icone: 'lixeira' }) + '</div>' : '') + '</div>').join('') + '</div>'
          : '<p class="secao-nota">Nenhuma indisponibilidade marcada.</p>') +
      '</section>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Últimos 30 dias</h2></div>' + resumo30DiasVeiculo(v.id) + '</section>' +
    '</div>';

  ui.renderizar(alvo, html, (raiz) => {
    const faixa = regras.faixaGrade(iso, doDia, null);
    const horario = regras.horarioDoDia(iso);
    const el = grade.montarGrade({
      data: iso,
      modo: 'ficha',
      colunas: [{
        id: v.id, tipoRecurso: 'veiculo', titulo: apelidoVeiculo(v), subtitulo: v.placa || '', data: iso, horario, fechado: !horario, hoje: iso === h,
        agendamentos: doDia, indisponibilidades: indispsParaGrade(v.id, iso), vazioTexto: apelidoVeiculo(v) + ' livre o dia todo'
      }],
      faixa,
      conflitos: regras.conflitosDoDia(iso),
      mostrarAgora: iso === h,
      arrastavel: false,
      aoTocarVao: (info) => {
        if (!dados.pode('criarServico', usuario)) return;
        ui.irPara('#/servico/novo' + ui.montarQuery({ data: info.data, inicio: info.horaInicio, veiculo: v.id }));
      },
      aoAbrirBloco: (id) => ui.irPara('#/servico/' + id),
      aoAbrirConflito: (id) => ui.irPara('#/servico/' + id + '?foco=conflito'),
      aoAbrirMais: (ids) => agendamento.abrirMaisBlocos(ids),
      aoMenuRapido: (id) => agendamento.abrirMenuRapido(id)
    });
    const caixa = raiz.querySelector('[data-grade]');
    if (caixa) { caixa.appendChild(el); }
    const primeiro = doDia[0];
    const alvoMin = iso === h ? util.agoraMin() - 45 : primeiro ? min(primeiro.horaInicio) - 15 : (horario ? min(horario.de) : 8 * 60);
    grade.rolarPara(el, alvoMin);

    ui.delegar(raiz, '[data-acao]', 'click', (acao, botao) => {
      const id = botao.getAttribute('data-id') || botao.getAttribute('data-valor');
      const irData = (nova) => ui.irPara('#/recursos/veiculos/' + v.id + ui.montarQuery({ data: nova }), { substituir: true });
      switch (acao) {
        case 'data-anterior': irData(util.addDias(iso, -1)); break;
        case 'data-seguinte': irData(util.addDias(iso, 1)); break;
        case 'data-hoje': irData(h); break;
        case 'escolher-data': ui.seletorMes(iso, (nova) => irData(nova)); break;
        case 'ver-agenda': ui.irPara('#/agenda/recursos/' + iso + '/veiculos'); break;
        case 'indisponivel': abrirIndisponibilidade(v.id, { de: util.isoHora(iso, '00:00'), ate: util.isoHora(iso, '23:59') }); break;
        case 'remover-indisp': removerIndisponibilidade(id); break;
        case 'abrir': ui.irPara('#/servico/' + id); break;
        case 'trocarCarro': agendamento.abrirTrocarCarro(id); break;
        default: if (id) agendamento.executarAcao(acao, id); break;
      }
    });
    ui.gestoDeslizar(raiz.querySelector('.ficha-grade'), {
      aoEsquerda: () => ui.irPara('#/recursos/veiculos/' + v.id + ui.montarQuery({ data: util.addDias(iso, 1) }), { substituir: true }),
      aoDireita: () => ui.irPara('#/recursos/veiculos/' + v.id + ui.montarQuery({ data: util.addDias(iso, -1) }), { substituir: true })
    });
  });
}

/* ---- Formulário do veículo ---- */

/* Rótulo do veículo na auditoria: sem placa não sobra parêntese vazio na linha. */
function rotuloVeiculo(v) {
  return v.placa ? v.nome + ' (' + v.placa + ')' : v.nome;
}

function proximoIndiceCor() {
  const usados = new Set(dados.veiculosAtivos().map((v) => Number(v.indiceCor)));
  for (let i = 1; i <= 5; i++) if (!usados.has(i)) return i;
  return ((repo.listar('veiculos').length) % 5) + 1;
}

function valoresVeiculo(v) {
  return {
    nome: v ? v.nome : '', apelido: v ? v.apelido : '', inicial: v ? v.inicial : '', placa: v ? v.placa : '', tipo: v ? v.tipo : '',
    capacidade: v ? v.capacidade : '', equipePadraoId: v ? (v.equipePadraoId || '') : '', ativo: v ? !!v.ativo : true, obs: v ? (v.obs || '') : ''
  };
}

/** Formulário de veículo (novo ou params.id). @param {{params:{id?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function formVeiculo(ctx) {
  const { params, alvo, usuario } = ctx;
  if (!podeEditarRecursos(usuario)) { telaSemAcesso(alvo, 'Veículo'); return; }
  const id = params.id || null;
  const original = id ? dados.veiculoPorId(id) : null;
  if (id && !original) { telaNaoEncontrado(alvo, 'Veículo não encontrado', 'O veículo pode ter sido removido.'); return; }
  const chave = 'veiculo:' + (id || 'novo');
  const estado = estadoForm(chave, () => valoresVeiculo(original));
  const f = estado.valores;
  ui.montarCabecalho({ titulo: id ? 'Editar veículo' : 'Novo veículo', voltar: true, subtitulo: id ? original.nome : 'Cadastro da frota' });
  const equipes = [{ valor: '', rotulo: 'Sem equipe padrão' }].concat(dados.equipesAtivas().map((e) => ({ valor: e.id, rotulo: e.nome })));
  const html =
    '<form class="form-cadastro" novalidate>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Identificação</h2>' +
        campoTexto('nome', 'Nome', f.nome, { obrigatorio: true, atributos: 'placeholder="Fiorino Branca" autocomplete="off"' }) + slotErro('nome') +
        '<div class="linha-campos">' +
          campoTexto('apelido', 'Apelido', f.apelido, { obrigatorio: true, ajuda: 'Aparece em chips e colunas', atributos: 'placeholder="Fiorino" autocomplete="off"' }) +
          campoTexto('inicial', 'Inicial', f.inicial, { obrigatorio: true, ajuda: 'Uma letra, única entre os ativos', atributos: 'maxlength="1" autocapitalize="characters" autocomplete="off"' }) +
        '</div>' + slotErro('apelido') + slotErro('inicial') +
        '<div class="linha-campos">' +
          /* Placa deixou de ser obrigatória (DIRECAO-2, lote 4, item 6): a Strada entrou no cadastro
             sem placa conhecida, e placa não se inventa. Quando houver, a repetição continua barrada. */
          campoTexto('placa', 'Placa', f.placa, { ajuda: 'Opcional, deixe vazio se não souber', atributos: 'placeholder="RXK-4D21" autocapitalize="characters" autocomplete="off"' }) +
          campoTexto('tipo', 'Tipo', f.tipo, { atributos: 'list="tipos-veiculo" placeholder="Furgão" autocomplete="off"' }) +
        '</div>' + slotErro('placa') +
        '<datalist id="tipos-veiculo">' + TIPOS_VEICULO.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
        campoTexto('capacidade', 'Capacidade', f.capacidade, { ajuda: 'Texto livre: o que cabe no carro', atributos: 'placeholder="Sofá de 2 lugares, poltronas, caixas até 1,8 m"' }) +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Operação</h2>' +
        ui.campo({ id: 'f-equipePadraoId', rotulo: 'Equipe padrão', valor: f.equipePadraoId, opcoes: equipes, ajuda: 'Sugerida ao escolher o carro; nunca implica conflito', atributos: 'data-campo="equipePadraoId"' }) +
        interruptor('ativo', f.ativo, 'Ativo', 'Desativar tira o carro da alocação sem apagar o histórico') +
        campoTexto('obs', 'Observações', f.obs, { multilinha: true }) +
      '</div>' +
      rodapeForm(id ? 'Salvar' : 'Cadastrar veículo') +
    '</form>';
  ui.renderizar(alvo, html, (raiz) => {
    ligarForm(raiz, estado);
    raiz.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); gravarVeiculo(); });
    const gravarVeiculo = () => {
      const r = salvarVeiculo(estado.valores, { id });
      if (!r.ok) { estado.erros = r.erros; mostrarErros(raiz, r.erros); return; }
      limparRascunho(chave);
      ui.toast(id ? 'Veículo salvo' : 'Veículo cadastrado');
      ui.irPara('#/recursos/veiculos/' + r.veiculo.id, { substituir: true });
    };
    ui.delegar(raiz, '[data-acao]', 'click', async (acao) => {
      if (acao === 'salvar-form') gravarVeiculo();
      else if (acao === 'cancelar-form') { if (await confirmarDescarte(estado)) { limparRascunho(chave); ui.voltar(); } }
    });
    if (estado.erros && Object.keys(estado.erros).length) mostrarErros(raiz, estado.erros);
    if (!id) { const primeiro = raiz.querySelector('[data-campo="nome"]'); if (primeiro) primeiro.focus(); }
  });
}

/**
 * Valida (inicial única, placa repetida, apelido) e grava; indiceCor no primeiro cadastro; audita veiculo_criado ou veiculo_editado com campos.
 * A placa é opcional (DIRECAO-2, lote 4, item 6): vazia passa, repetida não.
 * @param {object} dadosForm @param {{id?:string|null}} [opcoes] @returns {{ok:boolean, veiculo?:object, erros?:{campo:string, mensagem:string}[]}}
 */
export function salvarVeiculo(dadosForm, opcoes = {}) {
  const u = usuarioAtual();
  const id = opcoes.id || null;
  const original = id ? dados.veiculoPorId(id) : null;
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !podeEditarRecursos(u)) return { ok: false, erros: [{ campo: 'capacidade', mensagem: 'Você não pode cadastrar veículos' }] };
  if (id && !original) return { ok: false, erros: [{ campo: 'id', mensagem: 'Veículo não encontrado' }] };
  const f = dadosForm || {};
  const doc = {
    nome: String(f.nome || '').trim(),
    apelido: String(f.apelido || '').trim(),
    inicial: String(f.inicial || '').trim().slice(0, 1).toUpperCase(),
    placa: String(f.placa || '').trim().toUpperCase(),
    tipo: String(f.tipo || '').trim(),
    capacidade: String(f.capacidade || '').trim(),
    equipePadraoId: f.equipePadraoId ? String(f.equipePadraoId) : null,
    ativo: f.ativo !== false,
    obs: String(f.obs || '').trim()
  };
  if (!doc.nome) erro('nome', 'Escreva o nome do veículo');
  if (!doc.apelido) erro('apelido', 'Escreva o apelido');
  if (!doc.inicial || !/^[A-ZÀ-Ü0-9]$/i.test(doc.inicial)) erro('inicial', 'Uma letra para a inicial');
  if (doc.equipePadraoId && !dados.equipePorId(doc.equipePadraoId)) doc.equipePadraoId = null;
  const outros = repo.listar('veiculos', (v) => v.id !== id);
  if (doc.ativo && doc.inicial && outros.some((v) => v.ativo && String(v.inicial || '').toUpperCase() === doc.inicial)) erro('inicial', 'Já existe um veículo ativo com a inicial ' + doc.inicial);
  if (doc.placa && outros.some((v) => String(v.placa || '').toUpperCase() === doc.placa)) erro('placa', 'Já existe um veículo com esta placa');
  if (doc.apelido && outros.some((v) => v.ativo && util.normalizar(v.apelido) === util.normalizar(doc.apelido))) erro('apelido', 'Já existe um veículo ativo com este apelido');
  if (erros.length) return { ok: false, erros };

  const veiculo = repo.transacao(() => {
    if (original) {
      const depois = repo.atualizar('veiculos', id, doc);
      const campos = dados.diffCampos(original, depois, ['nome', 'apelido', 'inicial', 'placa', 'tipo', 'capacidade', 'equipePadraoId', 'ativo', 'obs']);
      dados.auditar({ acao: 'veiculo_editado', entidade: 'veiculo', entidadeId: id, rotulo: rotuloVeiculo(depois), campos, motivo: null, setorId: null });
      return depois;
    }
    const novo = repo.criar('veiculos', Object.assign({ indiceCor: proximoIndiceCor() }, doc));
    dados.auditar({ acao: 'veiculo_criado', entidade: 'veiculo', entidadeId: novo.id, rotulo: rotuloVeiculo(novo), campos: dados.diffCampos({}, novo, ['nome', 'apelido', 'inicial', 'placa', 'tipo', 'equipePadraoId']), motivo: null, setorId: null });
    return novo;
  });
  return { ok: true, veiculo };
}

/* ---- Indisponibilidade ---- */

function afetadosPorIndisponibilidade(veiculoId, de, ate, ignorarId) {
  const pde = util.partesIsoHora(de);
  const pate = util.partesIsoHora(ate);
  if (!dataValida(pde.data) || !dataValida(pate.data)) return [];
  return dados.agendamentosEntre(pde.data, pate.data).filter((a) => {
    if (a.veiculoId !== veiculoId || !regras.statusAtivo(a.status) || a.id === ignorarId) return false;
    const ini = util.isoHora(a.data, a.horaInicio);
    const fim = util.isoHora(a.data, a.horaFim);
    return ini < ate && de < fim;
  });
}

function montarPeriodo(v) {
  if (v.diaInteiro) return { de: util.isoHora(v.data, '00:00'), ate: util.isoHora(v.data, '23:59') };
  return { de: util.isoHora(v.data, v.horaDe || '00:00'), ate: util.isoHora(v.dataAte || v.data, v.horaAte || '23:59') };
}

function afetadosHTML(veiculo, afetados) {
  if (!afetados.length) return '<p class="secao-nota mt3">Nenhum serviço marcado com ' + esc(apelidoVeiculo(veiculo)) + ' neste período.</p>';
  return '<div class="afetados" data-afetados>' +
    '<div class="afetados-titulo">' + icone('alerta', 16) + ' ' + plural(afetados.length, 'serviço marcado', 'serviços marcados') + ' com ' + esc(apelidoVeiculo(veiculo)) + ' neste período</div>' +
    '<p class="pequeno mudo mb2">Troque o carro agora ou deixe como está: o serviço entra no alerta "Carro indisponível com serviço".</p>' +
    afetados.map((a) => '<div class="afetado mb2" data-afetado="' + esc(a.id) + '">' +
      '<div class="forte">' + esc(tituloServico(a)) + '</div><div class="pequeno mudo">' + esc(util.fmtDataMedia(a.data) + ', ' + util.fmtIntervalo(a.horaInicio, a.horaFim)) + '</div>' +
      '<div class="btn-grupo mt2">' +
        ui.botao({ rotulo: 'Trocar carro', acao: 'trocar-carro', valor: a.id, cls: 'btn-secundario btn-pq', icone: 'caminhao' }) +
        ui.botao({ rotulo: 'Deixar como está', acao: 'deixar', valor: a.id, cls: 'btn-fantasma btn-pq' }) +
      '</div></div>').join('') +
    '</div>';
}

/**
 * Sheet de indisponibilidade (9.1): dia inteiro ou período, motivo, lista dos serviços afetados com "Trocar carro" ou "Deixar como está".
 * @param {string} veiculoId @param {{de?:string, ate?:string}} [pre] ISOHora
 */
export function abrirIndisponibilidade(veiculoId, pre = {}) {
  const u = usuarioAtual();
  const v = dados.veiculoPorId(veiculoId);
  if (!v || !u) return;
  if (!podeIndisponibilidade(u)) { ui.toast('Você não pode marcar indisponibilidade', 'erro'); return; }
  const p = pre || {};
  const pde = util.partesIsoHora(p.de || '');
  const pate = util.partesIsoHora(p.ate || '');
  const diaInteiroPre = !p.de || (pde.hora === '00:00' && (pate.hora === '23:59' || !p.ate) && (!pate.data || pate.data === pde.data));
  const estado = p.estado || {
    diaInteiro: diaInteiroPre,
    data: dataValida(pde.data) ? pde.data : hoje(),
    horaDe: horaValida(pde.hora) && pde.hora !== '00:00' ? pde.hora : '08:00',
    dataAte: dataValida(pate.data) ? pate.data : (dataValida(pde.data) ? pde.data : hoje()),
    horaAte: horaValida(pate.hora) && pate.hora !== '23:59' ? pate.hora : '18:00',
    motivo: '',
    detalhe: '',
    deixados: []
  };
  const periodo = () => montarPeriodo(estado);
  const afetados = () => { const per = periodo(); return afetadosPorIndisponibilidade(v.id, per.de, per.ate); };

  const corpo = () =>
    '<div class="indisp-form">' +
      '<p class="mudo">' + inicialCarro(v, 'm') + ' ' + esc(v.nome) + ', ' + esc(v.placa || '') + '</p>' +
      interruptor('diaInteiro', estado.diaInteiro, 'Dia inteiro', 'Desligue para marcar um período com hora') +
      '<div data-parte="periodo" class="mt2">' + periodoHTML() + '</div>' +
      '<div class="campo mt3"><span class="campo-rotulo">Motivo</span><div class="chips-escolha" role="group" aria-label="Motivo">' +
        dados.MOTIVOS_INDISPONIBILIDADE.map((m) => chipEscolha('motivo', m.id, m.rotulo, estado.motivo === m.id, { unico: true })).join('') + '</div>' + slotErro('motivo') + '</div>' +
      '<div class="campo"><label class="campo-rotulo" for="indisp-detalhe">Detalhe' + (estado.motivo === 'outro' ? '' : ' <span class="mudo">(opcional)</span>') + '</label>' +
        '<textarea class="areatexto" id="indisp-detalhe" data-campo="detalhe" rows="2" placeholder="Ex.: revisão dos 40 mil, oficina em Itapema">' + esc(estado.detalhe) + '</textarea>' + slotErro('detalhe') + '</div>' +
      '<div data-parte="afetados">' + afetadosHTML(v, afetados()) + '</div>' +
      slotErro('geral') +
    '</div>';

  function periodoHTML() {
    if (estado.diaInteiro) {
      return ui.campo({ id: 'indisp-data', rotulo: 'Data', tipo: 'date', valor: estado.data, atributos: 'data-campo="data"' }) + slotErro('data');
    }
    return '<div class="linha-campos">' +
      ui.campo({ id: 'indisp-data', rotulo: 'Início', tipo: 'date', valor: estado.data, atributos: 'data-campo="data"' }) +
      ui.campo({ id: 'indisp-hora-de', rotulo: 'Hora', tipo: 'time', valor: estado.horaDe, atributos: 'data-campo="horaDe" step="900"' }) +
      '</div><div class="linha-campos">' +
      ui.campo({ id: 'indisp-data-ate', rotulo: 'Fim', tipo: 'date', valor: estado.dataAte, atributos: 'data-campo="dataAte"' }) +
      ui.campo({ id: 'indisp-hora-ate', rotulo: 'Hora', tipo: 'time', valor: estado.horaAte, atributos: 'data-campo="horaAte" step="900"' }) +
      '</div>' + slotErro('data') + slotErro('ate');
  }

  const { el, fechar } = ui.abrirSheet({
    titulo: 'Marcar indisponível',
    corpo: corpo(),
    rodape: '<button type="button" class="btn btn-fantasma" data-acao="ui:fechar-sheet">Voltar</button>' +
      '<button type="button" class="btn btn-primario" data-acao="gravar-indisp">Marcar indisponível</button>'
  });
  const formEstado = { valores: estado, erros: {}, mexeu: false };
  const atualizarAfetados = () => {
    const caixa = el.querySelector('[data-parte="afetados"]');
    if (caixa) caixa.innerHTML = afetadosHTML(v, afetados().filter((a) => !estado.deixados.includes(a.id)));
  };
  ligarForm(el, formEstado, (campo) => {
    if (campo === 'diaInteiro') {
      const caixa = el.querySelector('[data-parte="periodo"]');
      if (caixa) caixa.innerHTML = periodoHTML();
    }
    if (campo === 'motivo') {
      const rotulo = el.querySelector('label[for="indisp-detalhe"]');
      if (rotulo) rotulo.innerHTML = 'Detalhe' + (estado.motivo === 'outro' ? '' : ' <span class="mudo">(opcional)</span>');
    }
    if (['diaInteiro', 'data', 'horaDe', 'dataAte', 'horaAte'].includes(campo)) atualizarAfetados();
  });
  ui.delegar(el, '[data-acao]', 'click', (acao, botao) => {
    const id = botao.getAttribute('data-id') || botao.getAttribute('data-valor');
    if (acao === 'deixar') {
      estado.deixados = unicos(estado.deixados.concat(id));
      atualizarAfetados();
    } else if (acao === 'trocar-carro') {
      /* Só há um sheet por vez: reabre esta ao fechar a troca, com o estado preservado. */
      const reabrir = () => abrirIndisponibilidade(veiculoId, { estado });
      agendamento.abrirTrocarCarro(id);
      setTimeout(() => {
        if (!ui.sheetAberto()) { reabrir(); return; }
        document.addEventListener('ui:sheet-fechado', reabrir, { once: true });
      }, 0);
    } else if (acao === 'gravar-indisp') {
      const per = periodo();
      const r = salvarIndisponibilidade({ veiculoId: v.id, de: per.de, ate: per.ate, motivo: estado.motivo, detalhe: estado.detalhe });
      if (!r.ok) { mostrarErros(el, r.erros); return; }
      fechar();
      const n = r.afetados.length;
      ui.toast(apelidoVeiculo(v) + ' marcada indisponível' + (n ? ', ' + plural(n, 'serviço afetado', 'serviços afetados') : ''), n ? 'info' : 'ok');
    }
  });
}

/** Grava a indisponibilidade; audita; notifica gestores e pessoas dos serviços afetados. @param {object} indisponibilidade @returns {{ok:boolean, indisponibilidade?:object, afetados:object[], erros?:object[]}} */
export function salvarIndisponibilidade(indisponibilidade) {
  const u = usuarioAtual();
  const i = indisponibilidade || {};
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !podeIndisponibilidade(u)) return { ok: false, afetados: [], erros: [{ campo: 'geral', mensagem: 'Você não pode marcar indisponibilidade' }] };
  const v = dados.veiculoPorId(i.veiculoId);
  if (!v) erro('geral', 'Veículo não encontrado');
  const pde = util.partesIsoHora(i.de);
  const pate = util.partesIsoHora(i.ate);
  if (!dataValida(pde.data) || !horaValida(pde.hora)) erro('data', 'Escolha a data de início');
  if (!dataValida(pate.data) || !horaValida(pate.hora)) erro('ate', 'Escolha a data de fim');
  if (!erros.length && !(i.de < i.ate)) erro('ate', 'O fim precisa ser depois do início');
  const motivo = dados.MOTIVOS_INDISPONIBILIDADE.find((m) => m.id === i.motivo);
  if (!motivo) erro('motivo', 'Escolha o motivo');
  const detalhe = String(i.detalhe || '').trim();
  if (motivo && motivo.id === 'outro' && !detalhe) erro('detalhe', 'Descreva o motivo');
  if (erros.length) return { ok: false, afetados: [], erros };
  const afetados = afetadosPorIndisponibilidade(v.id, i.de, i.ate);
  const doc = { veiculoId: v.id, de: i.de, ate: i.ate, motivo: motivo.id, detalhe, criadoPor: u.id };
  const rotulo = apelidoVeiculo(v) + ', ' + util.fmtData(pde.data).slice(0, 5) + ' ' + pde.hora + ' a ' + util.fmtData(pate.data).slice(0, 5) + ' ' + pate.hora + ', ' + motivo.rotulo.toLowerCase();
  const gravada = repo.transacao(() => {
    const nova = repo.criar('indisponibilidades', doc);
    dados.auditar({ acao: 'indisponibilidade_criada', entidade: 'indisponibilidade', entidadeId: nova.id, rotulo, campos: null, motivo: detalhe || null, setorId: null });
    if (afetados.length) {
      const pessoas = [];
      for (const a of afetados) pessoas.push(...Array.from(regras.expandirPessoas(a)));
      dados.notificar({
        tipo: 'conflito',
        titulo: apelidoVeiculo(v) + ' indisponível com serviço',
        texto: plural(afetados.length, 'serviço marcado', 'serviços marcados') + ' com ' + apelidoVeiculo(v) + ' em ' + periodoIndisponibilidade(nova) + ': ' + afetados.map((a) => tituloServico(a) + ' (' + util.fmtData(a.data).slice(0, 5) + ' ' + a.horaInicio + ')').join('; '),
        para: unicos(dados.gestoresIds().concat(pessoas)),
        link: afetados.length === 1 ? '#/servico/' + afetados[0].id : '#/recursos/veiculos/' + v.id,
        acoes: afetados.length === 1 ? [{ rotulo: 'Abrir serviço', rota: '#/servico/' + afetados[0].id }] : [{ rotulo: 'Ver veículo', rota: '#/recursos/veiculos/' + v.id }]
      });
    }
    return nova;
  });
  return { ok: true, indisponibilidade: gravada, afetados };
}

/** Remove com confirmação; audita indisponibilidade_removida. @param {string} id @returns {Promise<boolean>} */
export async function removerIndisponibilidade(id) {
  const u = usuarioAtual();
  const i = repo.obter('indisponibilidades', id);
  if (!i || !u) return false;
  if (!podeIndisponibilidade(u)) { ui.toast('Você não pode remover indisponibilidade', 'erro'); return false; }
  const v = dados.veiculoPorId(i.veiculoId);
  const ok = await ui.confirmar({
    titulo: 'Remover indisponibilidade?',
    texto: apelidoVeiculo(v) + ' volta a ficar disponível em ' + periodoIndisponibilidade(i) + '.',
    rotuloOk: 'Remover', perigo: true
  });
  if (!ok) return false;
  const pde = util.partesIsoHora(i.de);
  const pate = util.partesIsoHora(i.ate);
  repo.transacao(() => {
    repo.remover('indisponibilidades', id);
    dados.auditar({
      acao: 'indisponibilidade_removida', entidade: 'indisponibilidade', entidadeId: id,
      rotulo: apelidoVeiculo(v) + ', ' + util.fmtData(pde.data).slice(0, 5) + ' ' + pde.hora + ' a ' + util.fmtData(pate.data).slice(0, 5) + ' ' + pate.hora,
      campos: null, motivo: null, setorId: null
    });
  });
  ui.toast('Indisponibilidade removida');
  return true;
}

/* ================================================================== */
/* Equipes (9.2)                                                       */
/* ================================================================== */

function membrosHTML(equipe, iso, hora) {
  const membros = (equipe.membros || []).map((id) => dados.usuarioPorId(id)).filter(Boolean);
  if (!membros.length) return '<span class="mudo">Sem membros</span>';
  return '<div class="membros-lista">' + membros.map((m) =>
    '<span class="membro-chip">' + ui.avatar(m, { tamanho: 'pq' }) + '<span>' + esc(nomeCurto(m.nome)) + (equipe.liderId === m.id ? ' <span class="pequeno mudo">(líder)</span>' : '') + '</span>' + pontoTurno(m, iso, hora) + '</span>'
  ).join('') + '</div>';
}

function cartaoEquipeHTML(e, u) {
  const h = hoje();
  const hora = agoraHora();
  const estado = regras.estadoEquipe(e.id);
  const veiculo = e.veiculoPadraoId ? dados.veiculoPorId(e.veiculoPadraoId) : null;
  const deHoje = dados.agendamentosDoDia(h).filter((a) => a.status !== 'cancelado' && usaEquipe(a, e));
  const emTurno = (e.membros || []).map((id) => dados.usuarioPorId(id)).filter((m) => m && regras.estaDeServico(m, h, hora)).length;
  const acoes = [
    ui.botao({ rotulo: 'Ver na agenda', acao: 'ver-agenda', valor: e.id, cls: 'btn-secundario btn-pq', icone: 'calendario' }),
    podeEditarRecursos(u) ? ui.botao({ rotulo: 'Editar', acao: 'editar', valor: e.id, cls: 'btn-secundario btn-pq', icone: 'editar' }) : ''
  ].filter(Boolean).join('');
  return '<article class="cartao cartao-recurso cartao-equipe" data-equipe="' + esc(e.id) + '">' +
    '<div class="cartao-recurso-corpo">' +
      '<div class="cartao-recurso-nome"><button type="button" class="link-nome" data-acao="abrir" data-id="' + esc(e.id) + '">' + esc(apelidoEquipe(e)) + '</button>' +
        (e.ativa ? '' : '<span class="chip chip-desativado">Desativada</span>') + '</div>' +
      '<div class="cartao-recurso-sub">' + esc(e.nome) + (e.membros && e.membros.length ? '\u00a0<span aria-hidden="true">·</span> ' + emTurno + ' de ' + e.membros.length + ' em turno' : '') + '</div>' +
      '<div class="cartao-recurso-linha">' + membrosHTML(e, h, hora) + '</div>' +
      '<div class="cartao-recurso-linha">' + (e.setores || []).map((s) => ui.chipSetor(s)).join('') + ui.chipCarro(veiculo, { pequeno: true }) + '</div>' +
      '<div class="cartao-recurso-linha">' + chipEstado(estado) + '<span class="mudo">Hoje: ' + (deHoje.length ? plural(deHoje.length, 'serviço', 'serviços') : 'sem serviços') + '</span></div>' +
      '<div class="cartao-acoes">' + acoes + '</div>' +
    '</div></article>';
}

function ligarAcoesEquipes(alvo, u) {
  ui.delegar(alvo, '[data-acao]', 'click', (acao, el) => {
    const id = el.getAttribute('data-id') || el.getAttribute('data-valor');
    switch (acao) {
      case 'abrir': ui.irPara('#/recursos/equipes/' + id); break;
      case 'ver-agenda': ui.irPara('#/agenda/recursos/' + hoje() + '/equipes'); break;
      case 'editar': if (podeEditarRecursos(u)) ui.irPara('#/recursos/equipes/' + id + '/editar'); break;
      case 'novo': if (podeEditarRecursos(u)) ui.irPara('#/recursos/equipes/novo'); break;
      default: break;
    }
  });
}

/** Lista de equipes (9.2). @param {object} ctx */
export function telaEquipes(ctx) {
  const { alvo, usuario } = ctx;
  const cab = cabecalhoComAcao({ titulo: 'Equipes', subtitulo: 'Quem sai junto', acao: podeEditarRecursos(usuario) ? { acao: 'novo', rotulo: 'Nova equipe', icone: 'mais' } : null });
  ligarCabecalho(cab, (acao) => { if (acao === 'novo') ui.irPara('#/recursos/equipes/novo'); });
  const todas = repo.listar('equipes').sort(util.porNome);
  const ativas = todas.filter((e) => e.ativa);
  const inativas = todas.filter((e) => !e.ativa);
  let html = '<div class="recursos">' + abasRecursosHTML('equipes');
  if (!ativas.length) {
    html += ui.estadoVazio({ icone: 'usuarios', titulo: 'Nenhuma equipe ativa', texto: 'Monte equipes para alocar várias pessoas de uma vez.', acao: podeEditarRecursos(usuario) ? { rotulo: 'Nova equipe', acao: 'novo' } : null });
  } else {
    html += '<div class="recursos-lista">' + ativas.map((e) => cartaoEquipeHTML(e, usuario)).join('') + '</div>';
  }
  if (inativas.length) {
    html += '<details class="secao secao-recolhida"><summary class="secao-titulo">' + icone('direita', 16) + ' Desativadas (' + inativas.length + ')</summary>' +
      '<div class="recursos-lista mt3">' + inativas.map((e) => cartaoEquipeHTML(e, usuario)).join('') + '</div></details>';
  }
  html += '</div>';
  ui.renderizar(alvo, html, (raiz) => ligarAcoesEquipes(raiz, usuario));
}

function miniSemanaHTML(contagem) {
  const h = hoje();
  return '<div class="mini-semana" role="list">' + Array.from({ length: 7 }, (x, i) => {
    const iso = util.addDias(h, i);
    const n = contagem(iso);
    const fechado = regras.diaFechado(iso);
    return '<button type="button" class="mini-dia" role="listitem" data-acao="ver-dia" data-valor="' + iso + '"' + (fechado ? ' data-fechado' : '') + (iso === h ? ' data-hoje' : '') +
      ' aria-label="' + esc(util.fmtDataExtensa(iso) + ', ' + plural(n, 'serviço', 'serviços')) + '">' +
      '<span class="mini-dia-abrev pequeno mudo">' + esc(util.DIAS_ABR[util.diaSemana(iso)]) + '</span>' +
      '<span class="mini-dia-num">' + util.dataDe(iso).getDate() + '</span>' +
      '<span class="mini-dia-qtd">' + (n || '') + '</span></button>';
  }).join('') + '</div>';
}

/** Ficha da equipe com mini semana e próximos serviços. @param {{params:{id:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function telaEquipe(ctx) {
  const { params, alvo, usuario } = ctx;
  const e = dados.equipePorId(params.id);
  if (!e) { telaNaoEncontrado(alvo, 'Equipe não encontrada', 'A equipe pode ter sido removida.'); return; }
  const h = hoje();
  const hora = agoraHora();
  const estado = regras.estadoEquipe(e.id);
  const veiculo = e.veiculoPadraoId ? dados.veiculoPorId(e.veiculoPadraoId) : null;
  const cab = cabecalhoComAcao({ titulo: apelidoEquipe(e), subtitulo: e.nome, voltar: true, acao: podeEditarRecursos(usuario) ? { acao: 'editar', rotulo: 'Editar equipe', icone: 'editar' } : null });
  ligarCabecalho(cab, (acao) => { if (acao === 'editar') ui.irPara('#/recursos/equipes/' + e.id + '/editar'); });
  const proximos = agendamentosAtivosDoRecurso((a) => usaEquipe(a, e), h, util.addDias(h, 6));
  const contagem = (iso) => dados.agendamentosDoDia(iso).filter((a) => a.status !== 'cancelado' && usaEquipe(a, e)).length;
  const html =
    '<div class="ficha ficha-equipe">' +
      '<div class="ficha-cab"><div class="ficha-cab-corpo"><div class="ficha-cab-nome">' + esc(e.nome) + '</div>' +
        '<div class="ficha-cab-sub">' + (e.setores || []).map((s) => dados.setorPorId(s).nome).join(', ') + (veiculo ? '. Sai com a ' + esc(apelidoVeiculo(veiculo)) : '') + '</div></div>' + chipEstado(estado) + '</div>' +
      (e.ativa ? '' : '<p class="campo-aviso">' + icone('alerta', 14) + '<span>Equipe desativada: não aparece para alocação.</span></p>') +
      (e.obs ? '<p class="mudo mb3">' + esc(e.obs) + '</p>' : '') +
      '<div class="btn-grupo">' + ui.botao({ rotulo: 'Ver na agenda', acao: 'ver-agenda', cls: 'btn-secundario btn-pq', icone: 'calendario' }) + '</div>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Membros</h2></div>' +
        '<div class="lista-pessoas">' + (e.membros || []).map((id) => dados.usuarioPorId(id)).filter(Boolean).map((m) =>
          '<div class="pessoa-linha">' + ui.avatar(m, { status: true }) + '<div class="pessoa-corpo"><div class="pessoa-nome">' + esc(m.nome) + (e.liderId === m.id ? '<span class="chip chip-pq">Líder</span>' : '') + '</div>' +
          '<div class="pessoa-cargo">' + esc(m.cargo || '') + '</div></div><span class="pessoa-linha-turno">' + pontoTurno(m, h, hora) + esc(textoTurno(m, h, hora)) + '</span></div>'
        ).join('') + ((e.membros || []).length ? '' : '<p class="secao-nota">Sem membros.</p>') + '</div>' +
      '</section>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Próximos 7 dias</h2></div>' + miniSemanaHTML(contagem) + '</section>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Próximos serviços</h2><span class="mudo">' + plural(proximos.length, 'serviço', 'serviços') + '</span></div>' +
        (proximos.length
          ? '<div class="lista">' + proximos.map((a) => agendamento.cartaoServico(a, { variante: 'lista', mostrarData: true })).join('') + '</div>'
          : ui.estadoVazio({ icone: 'calendario', titulo: apelidoEquipe(e) + ' sem serviços nos próximos 7 dias' })) +
      '</section>' +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      const id = el.getAttribute('data-id') || el.getAttribute('data-valor');
      if (acao === 'ver-agenda') ui.irPara('#/agenda/recursos/' + h + '/equipes');
      else if (acao === 'ver-dia') ui.irPara('#/agenda/recursos/' + id + '/equipes');
      else if (acao === 'abrir') ui.irPara('#/servico/' + id);
      else if (id) agendamento.executarAcao(acao, id);
    });
  });
}

/* ---- Formulário da equipe ---- */

function valoresEquipe(e) {
  return {
    nome: e ? e.nome : '', apelido: e ? e.apelido : '', setores: e ? (e.setores || []).slice() : [], membros: e ? (e.membros || []).slice() : [],
    liderId: e ? (e.liderId || '') : '', veiculoPadraoId: e ? (e.veiculoPadraoId || '') : '', ativa: e ? !!e.ativa : true, obs: e ? (e.obs || '') : '',
    buscaPessoa: '', maisPessoas: false
  };
}

function linhaPessoaEscolha(u, marcado, iso, hora, grupo) {
  return '<button type="button" class="pessoa-linha" data-acao="alternar-chip" data-grupo="' + esc(grupo) + '" data-valor="' + esc(u.id) + '" role="checkbox" aria-checked="' + (marcado ? 'true' : 'false') + '"' + (marcado ? ' data-ativo' : '') + '>' +
    ui.avatar(u) + '<div class="pessoa-corpo"><div class="pessoa-nome">' + esc(u.nome) + pontoTurno(u, iso, hora) + '</div><div class="pessoa-cargo">' + esc(u.cargo || '') + '</div></div>' +
    '<span class="caixa-marcar"' + (marcado ? ' data-ativo' : '') + ' aria-hidden="true">' + icone('check', 16) + '</span></button>';
}

function listaPessoasHTML(f, grupo) {
  const h = hoje();
  const hora = agoraHora();
  const escolhidos = f[grupo] || [];
  const busca = util.normalizar(f.buscaPessoa || '');
  const filtro = (u) => !busca || util.normalizar(u.nome).includes(busca);
  const campo = dados.usuariosCampo().filter(filtro);
  const outros = dados.usuariosAtivos().filter((u) => !u.campo && (escolhidos.includes(u.id) || f.maisPessoas)).filter(filtro);
  const escolhidosInativos = escolhidos.map((id) => dados.usuarioPorId(id)).filter((u) => u && !u.ativo);
  const totalCandidatos = dados.usuariosCampo().length;
  return '<div class="lista-pessoas" data-lista-pessoas>' +
    (totalCandidatos > 8 ? '<div class="busca">' + icone('busca', 18) + '<input class="entrada" type="search" data-campo="buscaPessoa" value="' + esc(f.buscaPessoa || '') + '" placeholder="Buscar pessoa" aria-label="Buscar pessoa"></div>' : '') +
    campo.map((u) => linhaPessoaEscolha(u, escolhidos.includes(u.id), h, hora, grupo)).join('') +
    (campo.length ? '' : '<p class="secao-nota">Ninguém encontrado.</p>') +
    (outros.length ? '<p class="secao-titulo mt3">Mais pessoas</p>' + outros.map((u) => linhaPessoaEscolha(u, escolhidos.includes(u.id), h, hora, grupo)).join('') : '') +
    escolhidosInativos.map((u) => linhaPessoaEscolha(u, true, h, hora, grupo)).join('') +
    (f.maisPessoas ? '' : '<div class="lista-pessoas-mais">' + ui.botao({ rotulo: 'Mais pessoas', acao: 'mais-pessoas', cls: 'btn-fantasma btn-pq', icone: 'baixo' }) + '</div>') +
    '</div>';
}

function opcoesLider(f) {
  return [{ valor: '', rotulo: 'Sem líder' }].concat((f.membros || []).map((id) => dados.usuarioPorId(id)).filter(Boolean).map((u) => ({ valor: u.id, rotulo: u.nome })));
}

/** Formulário de equipe. @param {{params:{id?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function formEquipe(ctx) {
  const { params, alvo, usuario } = ctx;
  if (!podeEditarRecursos(usuario)) { telaSemAcesso(alvo, 'Equipe'); return; }
  const id = params.id || null;
  const original = id ? dados.equipePorId(id) : null;
  if (id && !original) { telaNaoEncontrado(alvo, 'Equipe não encontrada', 'A equipe pode ter sido removida.'); return; }
  const chave = 'equipe:' + (id || 'novo');
  const estado = estadoForm(chave, () => valoresEquipe(original));
  const f = estado.valores;
  ui.montarCabecalho({ titulo: id ? 'Editar equipe' : 'Nova equipe', voltar: true, subtitulo: id ? original.nome : 'Quem sai junto' });
  const veiculos = [{ valor: '', rotulo: 'Sem carro padrão' }].concat(dados.veiculosAtivos().map((v) => ({ valor: v.id, rotulo: v.nome })));
  const html =
    '<form class="form-cadastro" novalidate>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Identificação</h2>' +
        campoTexto('nome', 'Nome', f.nome, { obrigatorio: true, atributos: 'placeholder="Equipe Entrega 01" autocomplete="off"' }) + slotErro('nome') +
        campoTexto('apelido', 'Apelido', f.apelido, { obrigatorio: true, ajuda: 'Cabeçalho de coluna e chips', atributos: 'placeholder="Entrega 01" autocomplete="off"' }) + slotErro('apelido') +
        '<div class="campo"><span class="campo-rotulo">Setores</span>' + chipsSetores('setores', f.setores) + slotErro('setores') + '</div>' +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Membros</h2>' +
        '<div data-parte="pessoas">' + listaPessoasHTML(f, 'membros') + '</div>' + slotErro('membros') +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Operação</h2>' +
        '<div data-parte="lider">' + ui.campo({ id: 'f-liderId', rotulo: 'Líder', valor: f.liderId, opcoes: opcoesLider(f), atributos: 'data-campo="liderId"' }) + '</div>' +
        ui.campo({ id: 'f-veiculoPadraoId', rotulo: 'Carro padrão', valor: f.veiculoPadraoId, opcoes: veiculos, ajuda: 'Sugerido ao escolher a equipe; nunca implica conflito', atributos: 'data-campo="veiculoPadraoId"' }) +
        interruptor('ativa', f.ativa, 'Ativa', 'Desativar tira a equipe da alocação sem apagar o histórico') +
        campoTexto('obs', 'Observações', f.obs, { multilinha: true }) +
      '</div>' +
      rodapeForm(id ? 'Salvar' : 'Criar equipe') +
    '</form>';
  ui.renderizar(alvo, html, (raiz) => {
    const atualizarPessoas = () => {
      const caixa = raiz.querySelector('[data-parte="pessoas"]');
      if (!caixa) return;
      const busca = caixa.querySelector('[data-campo="buscaPessoa"]');
      const foco = busca && document.activeElement === busca;
      const pos = foco ? busca.selectionStart : null;
      caixa.innerHTML = listaPessoasHTML(f, 'membros');
      if (foco) { const novo = caixa.querySelector('[data-campo="buscaPessoa"]'); if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* ignora */ } } }
    };
    const atualizarLider = () => {
      const caixa = raiz.querySelector('[data-parte="lider"]');
      if (!f.membros.includes(f.liderId)) f.liderId = '';
      if (caixa) caixa.innerHTML = ui.campo({ id: 'f-liderId', rotulo: 'Líder', valor: f.liderId, opcoes: opcoesLider(f), atributos: 'data-campo="liderId"' });
    };
    ligarForm(raiz, estado, (campo, valor, el) => {
      if (campo === 'buscaPessoa') atualizarPessoas();
      if (campo === 'membros') { el.setAttribute('aria-checked', el.hasAttribute('data-ativo') ? 'true' : 'false'); const caixa = el.querySelector('.caixa-marcar'); if (caixa) { if (el.hasAttribute('data-ativo')) caixa.setAttribute('data-ativo', ''); else caixa.removeAttribute('data-ativo'); } atualizarLider(); }
    });
    const gravar = () => {
      const r = salvarEquipe(estado.valores, { id });
      if (!r.ok) { estado.erros = r.erros; mostrarErros(raiz, r.erros); return; }
      limparRascunho(chave);
      ui.toast(id ? 'Equipe salva' : 'Equipe criada');
      ui.irPara('#/recursos/equipes/' + r.equipe.id, { substituir: true });
    };
    raiz.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); gravar(); });
    ui.delegar(raiz, '[data-acao]', 'click', async (acao) => {
      if (acao === 'salvar-form') gravar();
      else if (acao === 'mais-pessoas') { f.maisPessoas = true; atualizarPessoas(); }
      else if (acao === 'cancelar-form') { if (await confirmarDescarte(estado)) { limparRascunho(chave); ui.voltar(); } }
    });
    if (estado.erros && Object.keys(estado.erros).length) mostrarErros(raiz, estado.erros);
    if (!id) { const primeiro = raiz.querySelector('[data-campo="nome"]'); if (primeiro) primeiro.focus(); }
  });
}

/** Valida e grava; audita equipe_criada ou equipe_editada. @param {object} dadosForm @param {{id?:string|null}} [opcoes] @returns {{ok:boolean, equipe?:object, erros?:object[]}} */
export function salvarEquipe(dadosForm, opcoes = {}) {
  const u = usuarioAtual();
  const id = opcoes.id || null;
  const original = id ? dados.equipePorId(id) : null;
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !podeEditarRecursos(u)) return { ok: false, erros: [{ campo: 'nome', mensagem: 'Você não pode cadastrar equipes' }] };
  if (id && !original) return { ok: false, erros: [{ campo: 'id', mensagem: 'Equipe não encontrada' }] };
  const f = dadosForm || {};
  const membros = unicos(f.membros || []).filter((m) => dados.usuarioPorId(m));
  const setoresValidos = new Set(dados.SETORES.map((s) => s.id));
  const doc = {
    nome: String(f.nome || '').trim(),
    apelido: String(f.apelido || '').trim(),
    setores: unicos(f.setores || []).filter((s) => setoresValidos.has(s)),
    membros,
    liderId: f.liderId && membros.includes(f.liderId) ? f.liderId : null,
    veiculoPadraoId: f.veiculoPadraoId && dados.veiculoPorId(f.veiculoPadraoId) ? f.veiculoPadraoId : null,
    ativa: f.ativa !== false,
    obs: String(f.obs || '').trim()
  };
  if (!doc.nome) erro('nome', 'Escreva o nome da equipe');
  if (!doc.apelido) erro('apelido', 'Escreva o apelido');
  if (!doc.setores.length) erro('setores', 'Escolha ao menos um setor');
  if (!doc.membros.length) erro('membros', 'Escolha ao menos uma pessoa');
  const outras = repo.listar('equipes', (e) => e.id !== id);
  if (doc.apelido && outras.some((e) => e.ativa && util.normalizar(e.apelido) === util.normalizar(doc.apelido))) erro('apelido', 'Já existe uma equipe ativa com este apelido');
  if (erros.length) return { ok: false, erros };
  const campos = ['nome', 'apelido', 'setores', 'membros', 'liderId', 'veiculoPadraoId', 'ativa', 'obs'];
  const equipe = repo.transacao(() => {
    if (original) {
      const depois = repo.atualizar('equipes', id, doc);
      dados.auditar({ acao: 'equipe_editada', entidade: 'equipe', entidadeId: id, rotulo: depois.nome, campos: dados.diffCampos(original, depois, campos), motivo: null, setorId: null });
      return depois;
    }
    const nova = repo.criar('equipes', doc);
    dados.auditar({ acao: 'equipe_criada', entidade: 'equipe', entidadeId: nova.id, rotulo: nova.nome, campos: dados.diffCampos({}, nova, ['nome', 'apelido', 'setores', 'membros', 'liderId', 'veiculoPadraoId']), motivo: null, setorId: null });
    return nova;
  });
  return { ok: true, equipe };
}

/* ================================================================== */
/* Pessoas (9.3)                                                       */
/* ================================================================== */

let mostrarTodasPessoas = false;

/** Pessoas operacionais com turno e contagem do dia (9.3). @param {object} ctx */
export function telaPessoas(ctx) {
  const { alvo, usuario } = ctx;
  ui.montarCabecalho({ titulo: 'Pessoas', subtitulo: 'Quem está em campo' });
  const h = hoje();
  const hora = agoraHora();
  const todos = dados.usuariosAtivos();
  const lista = mostrarTodasPessoas ? todos : todos.filter((u) => u.campo);
  const podeUsuarios = !!dados.pode('usuarios', usuario);
  const contagem = (u) => dados.agendamentosDoDia(h).filter((a) => a.status !== 'cancelado' && regras.expandirPessoas(a).has(u.id)).length;
  const html =
    '<div class="recursos pessoas">' + abasRecursosHTML('pessoas') +
      '<div class="linha-interruptor"><label for="sw-todas-pessoas"><span class="linha-interruptor-rotulo">Mostrar todos</span><div class="linha-interruptor-sub">Inclui quem não é pessoa de campo</div></label>' +
        '<span class="interruptor"><input type="checkbox" id="sw-todas-pessoas" data-acao-mudar="todas"' + (mostrarTodasPessoas ? ' checked' : '') + ' aria-label="Mostrar todos"></span></div>' +
      (lista.length ? '<div class="lista lista-cartao">' + lista.map((u) => {
        const n = contagem(u);
        return '<button type="button" class="item item-toque cartao-pessoa" data-acao="pessoa" data-id="' + esc(u.id) + '" aria-label="' + esc(u.nome + ', ' + textoTurno(u, h, hora) + ', hoje ' + plural(n, 'serviço', 'serviços')) + '">' +
          ui.avatar(u, { status: true }) +
          '<div class="item-corpo"><div class="item-titulo">' + esc(u.nome) + (u.campo ? '' : ' <span class="pequeno mudo">(não é de campo)</span>') + '</div>' +
          '<div class="item-sub">' + esc(u.cargo || '') + (u.setores && u.setores.length ? '\u00a0<span aria-hidden="true">·</span> ' + esc(u.setores.map((s) => dados.setorPorId(s).nome).join(', ')) : '') + '</div>' +
          '<div class="pessoa-linha-turno">' + pontoTurno(u, h, hora) + esc(textoTurno(u, h, hora)) + '\u00a0<span aria-hidden="true">·</span> Hoje: ' + (n ? plural(n, 'serviço', 'serviços') : 'sem serviços') + '</div></div>' +
          '<span class="item-fim">' + icone(podeUsuarios ? 'pontos' : 'direita', 18) + '</span></button>';
      }).join('') + '</div>' : ui.estadoVazio({ icone: 'usuarios', titulo: 'Ninguém de campo cadastrado', texto: 'Marque "Pessoa de campo" no cadastro de usuários.' })) +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao-mudar="todas"]', 'change', (acao, el) => { mostrarTodasPessoas = !!el.checked; telaPessoas(ctx); });
    ui.delegar(raiz, '[data-acao="pessoa"]', 'click', (acao, el) => {
      const id = el.getAttribute('data-id');
      const u = dados.usuarioPorId(id);
      if (!u) return;
      const irAgenda = () => ui.irPara('#/agenda/recursos/' + h + '/pessoas' + ui.montarQuery({ pessoa: id }));
      if (!podeUsuarios) { irAgenda(); return; }
      const { el: sheet, fechar } = ui.abrirSheet({
        titulo: u.nome,
        corpo: '<div class="lista sheet-lista-acoes">' +
          '<button type="button" class="item item-toque" data-acao="ver-agenda"><span class="item-icone">' + icone('calendario', 20) + '</span><div class="item-corpo"><div class="item-titulo">Ver na agenda</div><div class="item-sub">Coluna de hoje na visão Pessoas</div></div></button>' +
          '<button type="button" class="item item-toque" data-acao="editar-cadastro"><span class="item-icone">' + icone('editar', 20) + '</span><div class="item-corpo"><div class="item-titulo">Editar cadastro</div><div class="item-sub">Perfil, setores, escala e senha</div></div></button>' +
          '</div>'
      });
      ui.delegar(sheet, '[data-acao]', 'click', (a) => {
        if (a === 'ver-agenda') { fechar(); irAgenda(); }
        else if (a === 'editar-cadastro') { fechar(); ui.irPara('#/cadastros/usuarios/' + id); }
      });
    });
  });
}

/* ================================================================== */
/* Cadastros: hub (9.4 a 9.7)                                          */
/* ================================================================== */

/** Hub #/cadastros: lista os cadastros que o perfil pode abrir. @param {object} ctx */
export function telaCadastros(ctx) {
  const { alvo, usuario } = ctx;
  const podeCad = !!dados.pode('cadastros', usuario);
  const podeUsu = !!dados.pode('usuarios', usuario);
  const podeDemo = !!dados.pode('dadosDemo', usuario);
  if (!podeCad && !podeUsu) { telaSemAcesso(alvo, 'Cadastros'); return; }
  ui.montarCabecalho({ titulo: 'Cadastros', subtitulo: 'Tipos, horários e acessos' });
  const itens = [];
  if (podeCad) {
    itens.push({ rota: '#/cadastros/tipos', icone: 'lista', titulo: 'Tipos de serviço', sub: plural(dados.tiposAtivos().length, 'tipo ativo', 'tipos ativos') + ', com duração, carro e checklist' });
    itens.push({ rota: '#/disponibilidade/loja', icone: 'relogio', titulo: 'Disponibilidade', sub: 'Horas da loja, das pessoas e dos carros, datas específicas e parâmetros' });
  }
  if (podeUsu) itens.push({ rota: '#/cadastros/usuarios', icone: 'usuarios', titulo: 'Usuários', sub: plural(dados.usuariosAtivos().length, 'usuário ativo', 'usuários ativos') + ', perfis e escalas' });
  if (dados.pode('verRecursos', usuario)) itens.push({ rota: '#/recursos/veiculos', icone: 'caminhao', titulo: 'Veículos e equipes', sub: 'Frota, indisponibilidades e equipes' });
  if (podeDemo) itens.push({ rota: '#/cadastros/dados', icone: 'sincronizar', titulo: 'Dados de demonstração', sub: 'Recriar ou limpar os dados fictícios' });
  const html = '<div class="cadastros-hub"><div class="lista lista-cartao">' + itens.map((i) =>
    '<button type="button" class="item item-toque" data-acao="ui:nav" data-rota="' + esc(i.rota) + '"><span class="item-icone">' + icone(i.icone, 20) + '</span>' +
    '<div class="item-corpo"><div class="item-titulo">' + esc(i.titulo) + '</div><div class="item-sub quebra">' + esc(i.sub) + '</div></div><span class="item-fim">' + icone('direita', 18) + '</span></button>'
  ).join('') + '</div></div>';
  ui.renderizar(alvo, html);
}

/* ---- Tipos de serviço (9.4, redesenhada em 3.6) ---- */

/** Liga e desliga o tipo direto do cartão, sem passar pelo formulário. */
function alternarTipoAtivo(id, ativo) {
  const u = usuarioAtual();
  const t = dados.tipoPorId(id);
  if (!u || !t || !dados.pode('cadastros', u)) { ui.toast('Você não pode alterar tipos de serviço', 'erro'); return; }
  repo.transacao(() => {
    const depois = repo.atualizar('tipos', id, { ativo: !!ativo });
    dados.auditar({ acao: 'tipo_editado', entidade: 'tipo', entidadeId: id, rotulo: depois.nome, campos: dados.diffCampos(t, depois, ['ativo']), motivo: null, setorId: null });
  });
  ui.toast(ativo ? t.nome + ' ativo' : t.nome + ' inativo', ativo ? 'ok' : 'info');
}

/** Grade de cartões de tipo de serviço (3.6): faixa na cor do setor, interruptor de ativo, copiar link e editar. @param {object} ctx */
export function telaTipos(ctx) {
  const { alvo, usuario } = ctx;
  if (!dados.pode('cadastros', usuario)) { telaSemAcesso(alvo, 'Tipos de serviço'); return; }
  const cab = cabecalhoComAcao({ titulo: 'Tipos de serviço', voltar: true, acao: { acao: 'novo', rotulo: 'Novo tipo', icone: 'mais' } });
  ligarCabecalho(cab, (acao) => { if (acao === 'novo') ui.irPara('#/cadastros/tipos/novo'); });
  const tipos = repo.listar('tipos').sort((a, b) => (a.ativo === b.ativo ? 0 : a.ativo ? -1 : 1) || (a.ordem || 0) - (b.ordem || 0) || util.porNome(a, b));
  const cartao = (t) => agendamento.cartaoTipoHTML(t, {
    interruptor: '<span class="interruptor cartao-tipo-interruptor"><input type="checkbox" data-acao="alternar-ativo" data-id="' + esc(t.id) + '"' +
      (t.ativo ? ' checked' : '') + ' aria-label="' + esc('Ativo: ' + t.nome) + '"></span>',
    rodape: '<div class="cartao-tipo-acoes">' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="copiar-link" data-id="' + esc(t.id) + '">' + icone('copiar', 16) + '<span>Copiar link</span></button>' +
      '<button type="button" class="btn btn-secundario btn-pq" data-acao="editar-tipo" data-id="' + esc(t.id) + '">' + icone('editar', 16) + '<span>Editar</span></button>' +
      '</div>'
  });
  const html = '<div class="col-900">' + (tipos.length
    ? '<p class="disp-bloco-nota">O link de um tipo abre o Registrar já com aquele serviço escolhido. Serve para mandar no WhatsApp da equipe.</p>' +
      '<div class="tipos-grade">' + tipos.map(cartao).join('') + '</div>'
    : ui.estadoVazio({ icone: 'lista', titulo: 'Nenhum tipo de serviço', acao: { rotulo: 'Novo tipo', acao: 'novo' } })) + '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      const id = el.getAttribute('data-id');
      if (acao === 'novo') ui.irPara('#/cadastros/tipos/novo');
      else if (acao === 'editar-tipo') ui.irPara('#/cadastros/tipos/' + id);
      else if (acao === 'copiar-link') agendamento.copiarLinkDoTipo(id);
      else if (acao === 'alternar-ativo') alternarTipoAtivo(id, el.checked);
    });
  });
}

/** Lista de minutos digitada em texto ("90, 180") virando array, sem repetido e sem zero. */
function listaDeMinutos(texto) {
  return unicos(String(texto == null ? '' : texto).split(/[,;\n]/).map((x) => Math.round(Number(String(x).trim())) || 0).filter((n) => n > 0));
}

/** Campo numérico que pode ficar vazio: vazio vira null, que quer dizer "herda da config". */
function vazioOuNumero(v) {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function valoresTipo(t) {
  const extras = t && Array.isArray(t.duracoes) ? t.duracoes.filter((d) => d !== t.duracaoPadraoMin) : [];
  const ou = (v) => (v == null ? '' : v);
  return {
    nome: t ? t.nome : '', icone: t ? (t.icone || 'caixa') : 'caixa', setorPadrao: t ? (t.setorPadrao || '') : 'ent', duracaoPadraoMin: t ? t.duracaoPadraoMin : 90,
    precisaVeiculo: t ? t.precisaVeiculo : 'opcional', pedeAssinatura: t ? !!t.pedeAssinatura : false, checklist: t ? (t.checklist || []).join('\n') : '',
    ordem: t ? t.ordem : (repo.listar('tipos').length + 1), ativo: t ? !!t.ativo : true,
    /* Regras de agendamento (DIRECAO 5.2 e 3.6): vazio herda da config. */
    duracoesExtras: extras.join(', '),
    incrementoMin: t ? ou(t.incrementoMin) : '',
    folgaAntesMin: t ? ou(t.folgaAntesMin) : '',
    folgaDepoisMin: t ? ou(t.folgaDepoisMin) : '',
    antecedenciaMinMin: t ? ou(t.antecedenciaMinMin) : '',
    janelaDias: t ? ou(t.janelaDias) : '',
    limiteDia: t ? ou(t.limiteDia) : '',
    cor: t && t.cor ? t.cor : ''
  };
}

/** Formulário de tipo com grade de ícones e checklist em textarea. @param {{params:{id?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function formTipo(ctx) {
  const { params, alvo, usuario } = ctx;
  if (!dados.pode('cadastros', usuario)) { telaSemAcesso(alvo, 'Tipo de serviço'); return; }
  const id = params.id || null;
  const original = id ? dados.tipoPorId(id) : null;
  if (id && !original) { telaNaoEncontrado(alvo, 'Tipo não encontrado', 'O tipo de serviço pode ter sido removido.'); return; }
  const chave = 'tipo:' + (id || 'novo');
  const estado = estadoForm(chave, () => valoresTipo(original));
  const f = estado.valores;
  ui.montarCabecalho({ titulo: id ? original.nome : 'Novo tipo de serviço', voltar: true, subtitulo: id ? 'Tipo de serviço' : 'Cadastro' });
  /* "Sem setor" existe porque o tipo "Loja" não pertence a Decoração nem a Entrega (DIRECAO-2 D3):
     amarrar a loja a um setor faria a florista não conseguir registrar que está no balcão. */
  const setores = [{ valor: '', rotulo: 'Sem setor' }].concat(dados.SETORES.map((s) => ({ valor: s.id, rotulo: s.nome })));
  const carro = [{ valor: 'sim', rotulo: 'Sim, sempre' }, { valor: 'opcional', rotulo: 'Opcional' }, { valor: 'nao', rotulo: 'Não' }];
  const html =
    '<form class="form-cadastro" novalidate>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">O serviço</h2>' +
        campoTexto('nome', 'Nome', f.nome, { obrigatorio: true, atributos: 'placeholder="Entrega" autocomplete="off"' }) + slotErro('nome') +
        '<div class="campo"><span class="campo-rotulo">Ícone</span><div class="grade-icones" role="group" aria-label="Ícone">' +
          ICONES_TIPO.filter((n) => ICONES[n]).map((n) => '<button type="button" class="icone-escolha" data-acao="alternar-chip" data-grupo="icone" data-valor="' + n + '" data-unico aria-label="' + n + '" aria-pressed="' + (f.icone === n ? 'true' : 'false') + '"' + (f.icone === n ? ' data-ativo' : '') + '>' + icone(n, 24) + '</button>').join('') +
        '</div></div>' +
        ui.campo({ id: 'f-setorPadrao', rotulo: 'Setor padrão', valor: f.setorPadrao, opcoes: setores, ajuda: 'Sem setor deixa o registro visível para todo mundo', atributos: 'data-campo="setorPadrao"' }) +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Como acontece</h2>' +
        '<div class="linha-campos">' +
          campoTexto('duracaoPadraoMin', 'Duração padrão (min)', f.duracaoPadraoMin, { tipo: 'number', obrigatorio: true, atributos: 'min="15" step="15" inputmode="numeric"' }) +
          ui.campo({ id: 'f-precisaVeiculo', rotulo: 'Precisa de carro', valor: f.precisaVeiculo, opcoes: carro, atributos: 'data-campo="precisaVeiculo"' }) +
        '</div>' + slotErro('duracaoPadraoMin') +
        interruptor('pedeAssinatura', f.pedeAssinatura, 'Pede assinatura', 'Mostra o canvas de assinatura ao concluir') +
        campoTexto('checklist', 'Checklist', f.checklist, { multilinha: true, ajuda: 'Um item por linha. Copiado para cada serviço novo deste tipo.', atributos: 'rows="6"' }) +
      '</div>' +
      /* Regras de agendamento (DIRECAO 3.6 e 4.2 a 4.6): campo vazio herda da Disponibilidade. */
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Regras de agendamento</h2>' +
        '<p class="disp-bloco-nota">Deixe vazio para seguir o que está em Disponibilidade. O que estiver aqui vale só para este tipo.</p>' +
        campoTexto('duracoesExtras', 'Outras durações (min)', f.duracoesExtras, { ajuda: 'Separadas por vírgula. Aparecem como escolha no Registrar, ex.: 90, 180', atributos: 'inputmode="numeric" placeholder="90, 180"' }) + slotErro('duracoesExtras') +
        '<div class="linha-campos">' +
          campoTexto('incrementoMin', 'Incremento dos horários (min)', f.incrementoMin, { tipo: 'number', atributos: 'min="5" step="5" inputmode="numeric"' }) +
          campoTexto('limiteDia', 'Limite por dia', f.limiteDia, { tipo: 'number', ajuda: 'Quantos serviços deste tipo cabem no dia', atributos: 'min="1" step="1" inputmode="numeric"' }) +
        '</div>' +
        '<div class="linha-campos">' +
          campoTexto('folgaAntesMin', 'Folga antes (min)', f.folgaAntesMin, { tipo: 'number', atributos: 'min="0" step="5" inputmode="numeric"' }) +
          campoTexto('folgaDepoisMin', 'Folga depois (min)', f.folgaDepoisMin, { tipo: 'number', atributos: 'min="0" step="5" inputmode="numeric"' }) +
        '</div>' +
        '<div class="linha-campos">' +
          campoTexto('antecedenciaMinMin', 'Antecedência mínima (min)', f.antecedenciaMinMin, { tipo: 'number', atributos: 'min="0" step="15" inputmode="numeric"' }) +
          campoTexto('janelaDias', 'Janela de agendamento (dias)', f.janelaDias, { tipo: 'number', atributos: 'min="1" step="1" inputmode="numeric"' }) +
        '</div>' + slotErro('regras') +
        '<p class="disp-param-ajuda">Antecedência, janela e limite são aviso, nunca bloqueio: a coluna de horários mostra o motivo e a loja pode furar a fila.</p>' +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Exibição</h2>' +
        ui.campo({ id: 'f-cor', rotulo: 'Cor do cartão', valor: f.cor, opcoes: [{ valor: '', rotulo: 'A cor do setor' }].concat(dados.SETORES.map((s) => ({ valor: s.id, rotulo: 'Cor de ' + s.nome }))), atributos: 'data-campo="cor"' }) +
        campoTexto('ordem', 'Ordem nos chips', f.ordem, { tipo: 'number', atributos: 'min="1" step="1" inputmode="numeric"' }) +
        interruptor('ativo', f.ativo, 'Ativo', 'Inativo não aparece para novos serviços; os antigos continuam') +
      '</div>' +
      rodapeForm(id ? 'Salvar' : 'Criar tipo') +
    '</form>';
  ui.renderizar(alvo, html, (raiz) => {
    ligarForm(raiz, estado);
    const gravar = () => {
      const r = salvarTipo(estado.valores, { id });
      if (!r.ok) { estado.erros = r.erros; mostrarErros(raiz, r.erros); return; }
      limparRascunho(chave);
      ui.toast(id ? 'Tipo salvo' : 'Tipo criado');
      ui.irPara('#/cadastros/tipos', { substituir: true });
    };
    raiz.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); gravar(); });
    ui.delegar(raiz, '[data-acao]', 'click', async (acao) => {
      if (acao === 'salvar-form') gravar();
      else if (acao === 'cancelar-form') { if (await confirmarDescarte(estado)) { limparRascunho(chave); ui.voltar(); } }
    });
    if (estado.erros && Object.keys(estado.erros).length) mostrarErros(raiz, estado.erros);
  });
}

/** Valida e grava; audita tipo_criado ou tipo_editado. @param {object} dadosForm @param {{id?:string|null}} [opcoes] @returns {{ok:boolean, tipo?:object, erros?:object[]}} */
export function salvarTipo(dadosForm, opcoes = {}) {
  const u = usuarioAtual();
  const id = opcoes.id || null;
  const original = id ? dados.tipoPorId(id) : null;
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !dados.pode('cadastros', u)) return { ok: false, erros: [{ campo: 'nome', mensagem: 'Você não pode alterar tipos de serviço' }] };
  if (id && !original) return { ok: false, erros: [{ campo: 'id', mensagem: 'Tipo não encontrado' }] };
  const f = dadosForm || {};
  const checklist = Array.isArray(f.checklist) ? f.checklist : String(f.checklist || '').split('\n');
  const doc = {
    nome: String(f.nome || '').trim(),
    icone: ICONES_TIPO.includes(f.icone) ? f.icone : 'caixa',
    setorPadrao: dados.SETORES.some((s) => s.id === f.setorPadrao) ? f.setorPadrao : null,
    duracaoPadraoMin: Math.round(Number(f.duracaoPadraoMin) || 0),
    precisaVeiculo: ['sim', 'nao', 'opcional'].includes(f.precisaVeiculo) ? f.precisaVeiculo : 'opcional',
    pedeAssinatura: !!f.pedeAssinatura,
    checklist: checklist.map((t) => String(t || '').trim()).filter(Boolean),
    /* Ordem zero é legítima: é como o tipo "Loja" fica em primeiro nos chips (DIRECAO-2 D3).
       Antes o piso era 1, e gravar a Loja sem mudar nada a empurrava para o meio da fila. */
    ordem: Math.max(0, Math.round(Number(f.ordem) || 0)),
    ativo: f.ativo !== false,
    /* Regras de agendamento (DIRECAO 5.2): null herda da config. */
    incrementoMin: vazioOuNumero(f.incrementoMin),
    limiteDia: vazioOuNumero(f.limiteDia),
    folgaAntesMin: vazioOuNumero(f.folgaAntesMin),
    folgaDepoisMin: vazioOuNumero(f.folgaDepoisMin),
    antecedenciaMinMin: vazioOuNumero(f.antecedenciaMinMin),
    janelaDias: vazioOuNumero(f.janelaDias),
    cor: dados.SETORES.some((s) => s.id === f.cor) ? f.cor : null
  };
  /* A padrão é sempre a primeira das durações (DIRECAO 4.14). */
  doc.duracoes = unicos([doc.duracaoPadraoMin].concat(listaDeMinutos(f.duracoesExtras))).slice(0, 4);
  if (!doc.nome) erro('nome', 'Escreva o nome do tipo');
  if (doc.duracaoPadraoMin < 15) erro('duracaoPadraoMin', 'Duração mínima de 15 minutos');
  if (doc.duracoes.some((d) => d < 15)) erro('duracoesExtras', 'Cada duração precisa de ao menos 15 minutos');
  if (doc.incrementoMin != null && doc.incrementoMin < 5) erro('regras', 'O incremento mínimo é de 5 minutos');
  if (doc.limiteDia != null && doc.limiteDia < 1) erro('regras', 'O limite por dia começa em 1');
  if (doc.janelaDias != null && doc.janelaDias < 1) erro('regras', 'A janela de agendamento começa em 1 dia');
  if ([doc.folgaAntesMin, doc.folgaDepoisMin, doc.antecedenciaMinMin].some((n) => n != null && n < 0)) erro('regras', 'Folga e antecedência não podem ser negativas');
  if (doc.nome && repo.listar('tipos', (t) => t.id !== id).some((t) => util.normalizar(t.nome) === util.normalizar(doc.nome))) erro('nome', 'Já existe um tipo com este nome');
  if (erros.length) return { ok: false, erros };
  const campos = ['nome', 'icone', 'setorPadrao', 'duracaoPadraoMin', 'precisaVeiculo', 'pedeAssinatura', 'checklist', 'ordem', 'ativo',
    'duracoes', 'incrementoMin', 'limiteDia', 'folgaAntesMin', 'folgaDepoisMin', 'antecedenciaMinMin', 'janelaDias', 'cor'];
  const tipo = repo.transacao(() => {
    if (original) {
      const depois = repo.atualizar('tipos', id, doc);
      dados.auditar({ acao: 'tipo_editado', entidade: 'tipo', entidadeId: id, rotulo: depois.nome, campos: dados.diffCampos(original, depois, campos), motivo: null, setorId: null });
      return depois;
    }
    const novo = repo.criar('tipos', doc);
    dados.auditar({ acao: 'tipo_criado', entidade: 'tipo', entidadeId: novo.id, rotulo: novo.nome, campos: dados.diffCampos({}, novo, ['nome', 'setorPadrao', 'duracaoPadraoMin', 'precisaVeiculo']), motivo: null, setorId: null });
    return novo;
  });
  return { ok: true, tipo };
}

/* ---- Disponibilidade (9.5, redesenhada em DIRECAO 3.5) ----
   Absorve a tela "Horários e loja" e a indisponibilidade de veículo. Três abas:
   Loja (faixas por dia da semana, datas específicas, parâmetros e endereço),
   Pessoas (escala e folgas) e Carros (dias em que o carro sai e indisponibilidades).
   O almoço não é mais uma pintura: é o vão entre duas faixas do mesmo dia. */

const ABAS_DISP = [['loja', 'Loja'], ['pessoas', 'Pessoas'], ['carros', 'Carros']];
const DIAS_UTEIS = ['seg', 'ter', 'qua', 'qui', 'sex'];
const FAIXA_PADRAO = { de: '08:00', ate: '18:00' };

/** Array de faixas limpo a partir do que estiver gravado; null quer dizer fechado. */
function faixasDe(valor) {
  const faixas = dados.normalizarFaixas(valor, null);
  return faixas ? faixas.map((f) => ({ de: f.de, ate: f.ate })) : null;
}

const temFaixa = (faixas) => Array.isArray(faixas) && faixas.length > 0;

/** Editor de faixas de um dia: "08:00 às 12:00", com x para remover e + para abrir a segunda faixa. */
function faixasEditorHTML(alvo, faixas, opcoes = {}) {
  if (!temFaixa(faixas)) {
    return '<div class="disp-faixas"><span class="disp-fechado">' + esc(opcoes.rotuloFechado || 'Fechado') + '</span></div>' +
      '<div class="disp-linha-acoes"></div>';
  }
  const linhas = faixas.map((f, i) =>
    '<div class="disp-faixa">' +
      '<input class="entrada" type="time" step="900" value="' + esc(f.de) + '" data-campo="faixa" data-alvo="' + esc(alvo) + '" data-i="' + i + '" data-lado="de" aria-label="Abre">' +
      '<span class="disp-faixa-as">às</span>' +
      '<input class="entrada" type="time" step="900" value="' + esc(f.ate) + '" data-campo="faixa" data-alvo="' + esc(alvo) + '" data-i="' + i + '" data-lado="ate" aria-label="Fecha">' +
      (faixas.length > 1 || opcoes.podeZerar
        ? '<button type="button" class="btn-icone" data-acao="remover-faixa" data-alvo="' + esc(alvo) + '" data-i="' + i + '" aria-label="Remover esta faixa">' + icone('x', 18) + '</button>'
        : '') +
    '</div>').join('');
  const acoes = '<div class="disp-linha-acoes">' +
    (faixas.length < 3 ? '<button type="button" class="btn-icone" data-acao="mais-faixa" data-alvo="' + esc(alvo) + '" aria-label="Acrescentar faixa neste dia" title="Acrescentar faixa (o vão entre as duas é o almoço)">' + icone('mais', 18) + '</button>' : '') +
    (opcoes.copiar ? '<button type="button" class="btn-icone" data-acao="copiar-faixa" data-alvo="' + esc(alvo) + '" aria-label="Copiar este horário para os outros dias úteis" title="Copiar para os outros dias úteis">' + icone('duplicar', 18) + '</button>' : '') +
    '</div>';
  return '<div class="disp-faixas">' + linhas + '</div>' + acoes;
}

/** Uma linha de dia da semana: nome, interruptor, faixas e ações. */
function linhaDiaHTML(chave, rotulo, faixas, opcoes = {}) {
  const aberto = temFaixa(faixas);
  return '<div class="disp-linha"' + (aberto ? '' : ' data-fechado') + '>' +
    '<div class="disp-linha-dia">' +
      '<span class="interruptor"><input type="checkbox" data-acao="alternar-dia" data-alvo="' + esc(chave) + '"' + (aberto ? ' checked' : '') +
        ' aria-label="' + esc('Aberto: ' + rotulo) + '"></span>' +
      '<span>' + esc(rotulo) + '</span>' +
    '</div>' + faixasEditorHTML(chave, faixas, opcoes) + '</div>';
}

/* ---- Estado da tela ---- */

function valoresDisponibilidade() {
  const c = repo.config();
  const horario = {};
  for (const [chave] of DIAS_CONFIG) horario[chave] = faixasDe((c.horario || {})[chave]);
  return {
    aba: 'loja',
    horario,
    excecoes: (c.excecoes || []).map((x) => ({ id: x.id, data: x.data, nome: x.nome || '', fechado: x.fechado !== false, faixas: faixasDe(x.faixas) })),
    feriados: (c.feriados || []).map((f) => ({ data: f.data, nome: f.nome, ativo: f.ativo !== false })),
    loja: Object.assign({ nome: '', endereco: '', telefone: '' }, c.loja || {}),
    params: {
      folgaAntesMin: c.folgaAntesMin != null ? c.folgaAntesMin : 0,
      folgaDepoisMin: c.folgaDepoisMin != null ? c.folgaDepoisMin : 30,
      antecedenciaMinMin: c.antecedenciaMinMin != null ? c.antecedenciaMinMin : 120,
      janelaDias: c.janelaDias != null ? c.janelaDias : 90,
      slotMin: c.slotMin != null ? c.slotMin : 30,
      horaCorteAmanha: c.horaCorteAmanha || '17:00',
      atrasoInicioMin: c.atrasoInicioMin != null ? c.atrasoInicioMin : 20,
      atrasoFimMin: c.atrasoFimMin != null ? c.atrasoFimMin : 30
    },
    pessoaId: '',
    escala: null,
    veiculoId: '',
    veiculo: null
  };
}

/** Escala da pessoa em faixas por dia da semana, com recuo para a faixa de seg a sex. */
function escalaEmFaixas(u) {
  const e = (u && u.escala) || {};
  const saida = {};
  for (const [chave] of DIAS_CONFIG) {
    if (chave === 'sab') saida.sab = faixasDe(e.sab);
    else if (chave === 'dom') saida.dom = faixasDe(e.dom);
    else saida[chave] = faixasDe(e[chave] !== undefined ? e[chave] : e.seg_sex);
  }
  return {
    dias: saida,
    excecoes: (e.excecoes || []).map((x) => ({ id: x.id, data: x.data, nome: x.nome || '', fechado: x.fechado !== false, faixas: faixasDe(x.faixas) }))
  };
}

/* ---- Aba Loja ---- */

function paramsHTML(f) {
  const p = f.params;
  const campo = (nome, rotulo, valor, ajuda, extra) =>
    '<div>' + campoTexto('p-' + nome, rotulo, valor, { tipo: extra === 'hora' ? 'time' : 'number', atributos: (extra === 'hora' ? '' : 'min="0" step="5" inputmode="numeric" ') + 'data-param="' + nome + '"' }) +
    '<p class="disp-param-ajuda">' + esc(ajuda) + '</p></div>';
  return '<div class="disp-params">' +
    campo('folgaAntesMin', 'Folga antes (min)', p.folgaAntesMin, 'Tempo vazio exigido antes do serviço, para o deslocamento.') +
    campo('folgaDepoisMin', 'Folga depois (min)', p.folgaDepoisMin, 'Tempo vazio exigido depois, para o carro e a equipe chegarem ao próximo.') +
    campo('antecedenciaMinMin', 'Antecedência mínima (min)', p.antecedenciaMinMin, 'Abaixo disso o horário aparece com aviso, e a loja ainda pode agendar.') +
    campo('janelaDias', 'Janela de agendamento (dias)', p.janelaDias, 'Até onde o calendário do Registrar avança.') +
    campo('slotMin', 'Incremento dos horários (min)', p.slotMin, 'De quanto em quanto tempo a coluna de horários oferece início.') +
    campo('horaCorteAmanha', 'Hora de corte para amanhã', p.horaCorteAmanha, 'Depois dela, o formulário já sugere o dia seguinte.', 'hora') +
    campo('atrasoInicioMin', 'Atraso de início (min)', p.atrasoInicioMin, 'A partir de quanto tempo o serviço aparece como atrasado.') +
    campo('atrasoFimMin', 'Atraso de fim (min)', p.atrasoFimMin, 'A partir de quanto tempo passando do término o serviço aparece como atrasado.') +
    '</div>';
}

function excecoesLojaHTML(f) {
  const linhas = f.excecoes.slice().sort((a, b) => util.compararISO(a.data, b.data)).map((x, i) => {
    const alvo = 'exc:' + i;
    return '<div class="disp-excecao">' +
      '<span class="disp-excecao-data">' + esc(util.fmtData(x.data)) + '</span>' +
      '<input class="entrada disp-excecao-nome" type="text" value="' + esc(x.nome) + '" data-campo="excecao-nome" data-i="' + i + '" aria-label="Nome da data específica" placeholder="Feirão, mutirão, inventário">' +
      '<span class="interruptor"><input type="checkbox" data-acao="alternar-dia" data-alvo="' + alvo + '"' + (x.fechado ? '' : ' checked') + ' aria-label="Abre nesta data"></span>' +
      (x.fechado ? '<span class="disp-fechado">Fechado</span><div class="disp-linha-acoes"></div>' : faixasEditorHTML(alvo, x.faixas)) +
      '<button type="button" class="btn-icone" data-acao="remover-excecao" data-i="' + i + '" aria-label="Remover esta data">' + icone('lixeira', 18) + '</button>' +
      '</div>';
  }).join('');
  const feriados = f.feriados.slice().sort((a, b) => util.compararISO(a.data, b.data)).map((x, i) =>
    '<div class="disp-excecao">' +
      '<span class="disp-excecao-data">' + esc(util.fmtData(x.data)) + '</span>' +
      '<span class="disp-excecao-nome">' + esc(x.nome) + '</span>' +
      '<span class="interruptor"><input type="checkbox" data-acao="alternar-feriado" data-data="' + esc(x.data) + '"' + (x.ativo ? ' checked' : '') +
        ' aria-label="' + esc('Fecha no feriado ' + x.nome) + '"></span>' +
      '<span class="disp-excecao-faixa">' + (x.ativo ? 'Fechado' : 'Dia normal') + '</span>' +
      '<button type="button" class="btn-icone" data-acao="remover-feriado" data-data="' + esc(x.data) + '" aria-label="' + esc('Remover feriado ' + x.nome) + '">' + icone('lixeira', 18) + '</button>' +
      '</div>').join('');
  return '<div data-parte="excecoes">' +
    (linhas || '<p class="disp-bloco-nota">Nenhuma data específica. Use para véspera de Natal, feirão, mutirão de entrega e inventário.</p>') +
    '<div class="linha-campos mt3">' + ui.campo({ id: 'f-novaExcecao', rotulo: 'Nova data', tipo: 'date', valor: '', atributos: 'data-campo="novaExcecaoData"' }) + '</div>' + slotErro('excecao') +
    '<div class="btn-grupo"><button type="button" class="btn btn-secundario btn-pq" data-acao="nova-excecao">' + icone('mais', 16) + '<span>Data específica</span></button></div>' +
    '<div class="disp-bloco-titulo mt4">Feriados</div>' +
    '<p class="disp-bloco-nota">Desligado, o feriado vira um dia normal de trabalho.</p>' +
    (feriados || '<p class="disp-bloco-nota">Nenhum feriado cadastrado.</p>') +
    '<div class="linha-campos mt3">' +
      ui.campo({ id: 'f-novoFeriadoData', rotulo: 'Data', tipo: 'date', valor: '', atributos: 'data-campo="novoFeriadoData"' }) +
      ui.campo({ id: 'f-novoFeriadoNome', rotulo: 'Nome', valor: '', atributos: 'data-campo="novoFeriadoNome" placeholder="Finados"' }) +
    '</div>' + slotErro('feriado') +
    '<div class="btn-grupo"><button type="button" class="btn btn-secundario btn-pq" data-acao="adicionar-feriado">' + icone('mais', 16) + '<span>Acrescentar feriado</span></button></div>' +
    '</div>';
}

function abaLojaHTML(f) {
  const dias = DIAS_CONFIG.map(([chave, rotulo]) => linhaDiaHTML(chave, rotulo, f.horario[chave], { copiar: DIAS_UTEIS.includes(chave) })).join('');
  return '<div class="disp-bloco"><div class="disp-bloco-titulo">Horas por dia da semana</div>' +
      '<p class="disp-bloco-nota">Duas faixas no mesmo dia é como o almoço existe: 08:00 às 12:00 e 13:30 às 18:30.</p>' +
      '<div class="disp-quadro" data-parte="dias">' + dias + '</div>' + slotErro('horario') +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Datas específicas</div>' +
      '<div class="disp-quadro">' + excecoesLojaHTML(f) + '</div>' +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Parâmetros</div>' +
      '<p class="disp-bloco-nota">Valem para todos os tipos de serviço. Cada tipo pode ter os seus, em Tipos de serviço.</p>' +
      paramsHTML(f) + slotErro('operacao') +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Loja</div>' +
      campoTexto('lojaNome', 'Nome', f.loja.nome, { obrigatorio: true, atributos: 'data-loja="nome"' }) + slotErro('lojaNome') +
      campoTexto('lojaEndereco', 'Endereço', f.loja.endereco, { obrigatorio: true, ajuda: 'Origem da rota do dia no Maps', atributos: 'data-loja="endereco"' }) + slotErro('lojaEndereco') +
      campoTexto('lojaTelefone', 'Telefone', f.loja.telefone, { tipo: 'tel', atributos: 'inputmode="tel" data-loja="telefone"' }) +
    '</div>' +
    '<div class="form-rodape-acoes"><button type="button" class="btn btn-primario" data-acao="salvar-loja">Salvar</button></div>';
}

/* ---- Aba Pessoas ---- */

function excecoesPessoaHTML(f) {
  const linhas = (f.escala.excecoes || []).slice().sort((a, b) => util.compararISO(a.data, b.data)).map((x, i) =>
    '<div class="disp-excecao">' +
      '<span class="disp-excecao-data">' + esc(util.fmtData(x.data)) + '</span>' +
      '<span class="disp-excecao-nome">' + esc(x.nome || (x.fechado ? 'Folga' : 'Horário próprio')) + '</span>' +
      '<span class="disp-excecao-faixa">' + esc(x.fechado ? 'Não trabalha' : (x.faixas || []).map((y) => y.de + ' às ' + y.ate).join(' e ')) + '</span>' +
      '<button type="button" class="btn-icone" data-acao="remover-excecao-pessoa" data-i="' + i + '" aria-label="Remover esta data">' + icone('lixeira', 18) + '</button>' +
      '</div>').join('');
  return '<div data-parte="excecoes-pessoa">' +
    (linhas || '<p class="disp-bloco-nota">Sem folga marcada.</p>') +
    '<div class="linha-campos mt3">' + ui.campo({ id: 'f-novaFolga', rotulo: 'Folga', tipo: 'date', valor: '', atributos: 'data-campo="novaFolga"' }) + '</div>' + slotErro('folga') +
    '<div class="btn-grupo"><button type="button" class="btn btn-secundario btn-pq" data-acao="adicionar-folga">' + icone('mais', 16) + '<span>Marcar folga</span></button></div>' +
    '</div>';
}

function abaPessoasHTML(f) {
  const pessoas = dados.usuariosAtivos().slice().sort(util.porNome);
  if (!pessoas.length) return ui.estadoVazio({ icone: 'usuarios', titulo: 'Nenhuma pessoa ativa' });
  const seletor = ui.campo({
    id: 'f-pessoa', rotulo: 'Pessoa', valor: f.pessoaId,
    opcoes: pessoas.map((p) => ({ valor: p.id, rotulo: p.nome + (p.cargo ? ', ' + p.cargo : '') })),
    atributos: 'data-campo="pessoaId"'
  });
  if (!f.escala) return '<div class="disp-alvo">' + seletor + '</div>';
  const dias = DIAS_CONFIG.map(([chave, rotulo]) => linhaDiaHTML(chave, rotulo, f.escala.dias[chave], { copiar: DIAS_UTEIS.includes(chave), rotuloFechado: 'Não trabalha' })).join('');
  return '<div class="disp-alvo">' + seletor + '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Turno por dia da semana</div>' +
      '<div class="disp-quadro" data-parte="dias">' + dias + '</div>' + slotErro('escala') +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Folgas e datas específicas</div>' +
      '<div class="disp-quadro">' + excecoesPessoaHTML(f) + '</div>' +
    '</div>' +
    '<div class="form-rodape-acoes"><button type="button" class="btn btn-primario" data-acao="salvar-pessoa">Salvar</button></div>';
}

/* ---- Aba Carros ---- */

function indisponibilidadesHTML(veiculoId) {
  const lista = indisponibilidadesFuturas(veiculoId).sort((a, b) => String(a.de).localeCompare(String(b.de)));
  const linhas = lista.map((i) =>
    '<div class="disp-excecao">' +
      '<span class="disp-excecao-nome">' + esc(textoIndisponibilidade(i)) + '</span>' +
      '<button type="button" class="btn-icone" data-acao="remover-indisp" data-id="' + esc(i.id) + '" aria-label="Remover indisponibilidade">' + icone('lixeira', 18) + '</button>' +
      '</div>').join('');
  return '<div data-parte="indisps">' +
    (linhas || '<p class="disp-bloco-nota">Sem indisponibilidade marcada daqui para a frente.</p>') +
    '<div class="btn-grupo mt3"><button type="button" class="btn btn-secundario btn-pq" data-acao="nova-indisp">' + icone('mais', 16) + '<span>Data específica</span></button></div>' +
    '</div>';
}

function abaCarrosHTML(f) {
  const veiculos = dados.veiculosAtivos().slice().sort(util.porNome);
  if (!veiculos.length) return ui.estadoVazio({ icone: 'caminhao', titulo: 'Nenhum carro ativo' });
  const seletor = ui.campo({
    id: 'f-veiculo', rotulo: 'Carro', valor: f.veiculoId,
    opcoes: veiculos.map((v) => ({ valor: v.id, rotulo: apelidoVeiculo(v) + (v.placa ? ', ' + v.placa : '') })),
    atributos: 'data-campo="veiculoId"'
  });
  if (!f.veiculo) return '<div class="disp-alvo">' + seletor + '</div>';
  const segueLoja = f.veiculo.horario === null;
  const dias = segueLoja ? '' : DIAS_CONFIG.map(([chave, rotulo]) => linhaDiaHTML(chave, rotulo, f.veiculo.horario[chave], { copiar: DIAS_UTEIS.includes(chave), rotuloFechado: 'Não sai' })).join('');
  return '<div class="disp-alvo">' + seletor + '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Dias em que o carro sai</div>' +
      '<div class="disp-quadro">' +
        interruptor('segueLoja', segueLoja, 'Segue o horário da loja', 'Desligue para dar ao carro um horário próprio, por exemplo não sair no sábado') +
        (segueLoja ? '' : '<div data-parte="dias">' + dias + '</div>') +
      '</div>' + slotErro('horarioVeiculo') +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Limite por dia</div>' +
      '<div class="disp-quadro">' +
        campoTexto('limiteVeiculo', 'Serviços por dia', f.veiculo.limiteDia == null ? '' : f.veiculo.limiteDia, { tipo: 'number', ajuda: 'Vazio quer dizer sem limite. Estourado, o horário aparece com o motivo na coluna.', atributos: 'min="1" step="1" inputmode="numeric"' }) +
      '</div>' +
    '</div>' +
    '<div class="disp-bloco"><div class="disp-bloco-titulo">Indisponibilidades</div>' +
      '<div class="disp-quadro">' + indisponibilidadesHTML(f.veiculoId) + '</div>' +
    '</div>' +
    '<div class="form-rodape-acoes"><button type="button" class="btn btn-primario" data-acao="salvar-veiculo-horario">Salvar</button></div>';
}

/* ---- Tela ---- */

function abasDispHTML(aba) {
  return '<div class="abas-sublinhado" role="tablist" aria-label="Disponibilidade">' + ABAS_DISP.map(([chave, rotulo]) =>
    '<button type="button" class="aba-sublinhado" role="tab" data-acao="aba-disp" data-valor="' + chave + '"' +
    (chave === aba ? ' data-ativo aria-selected="true"' : ' aria-selected="false"') + '>' + esc(rotulo) + '</button>').join('') + '</div>';
}

function disponibilidadeHTML(f) {
  const corpo = f.aba === 'pessoas' ? abaPessoasHTML(f) : f.aba === 'carros' ? abaCarrosHTML(f) : abaLojaHTML(f);
  return '<div class="disp">' + abasDispHTML(f.aba) + '<div data-parte="aba">' + corpo + '</div></div>';
}

/**
 * Disponibilidade (DIRECAO 3.5): faixas por dia da semana da loja, das pessoas e dos carros,
 * datas específicas, feriados e os parâmetros de agendamento.
 * @param {{params:{aba?:string}, alvo:HTMLElement, usuario:object}} ctx
 */
export function telaDisponibilidade(ctx) {
  const { alvo, usuario, params } = ctx;
  if (!dados.pode('cadastros', usuario)) { telaSemAcesso(alvo, 'Disponibilidade'); return; }
  const chave = 'disponibilidade';
  /* A aba da rota só manda ao abrir a tela: depois disso quem manda é a aba escolhida no clique,
     senão um rerender do repositório jogaria a pessoa de volta para a aba do endereço. */
  const primeiraVez = !rascunhos.has(chave);
  const estado = estadoForm(chave, () => valoresDisponibilidade());
  const f = estado.valores;
  if (primeiraVez && ABAS_DISP.some(([x]) => x === params.aba)) f.aba = params.aba;
  const aba = f.aba;
  if (aba === 'pessoas' && !f.pessoaId) {
    const primeira = dados.usuariosAtivos().slice().sort(util.porNome)[0];
    if (primeira) { f.pessoaId = primeira.id; f.escala = escalaEmFaixas(primeira); }
  }
  if (aba === 'carros' && !f.veiculoId) {
    const primeiro = dados.veiculosAtivos().slice().sort(util.porNome)[0];
    if (primeiro) { f.veiculoId = primeiro.id; f.veiculo = { horario: faixasPorDiaDoVeiculo(primeiro), limiteDia: primeiro.limiteDia == null ? '' : primeiro.limiteDia }; }
  }
  ui.montarCabecalho({ titulo: 'Disponibilidade', voltar: true });
  ui.renderizar(alvo, '<div data-parte="disponibilidade">' + disponibilidadeHTML(f) + '</div>', (raiz) => {
    ligarDisponibilidade(raiz, estado, chave);
  });
}

/** Mapa de faixas por dia do carro; null quer dizer que o carro segue a loja. */
function faixasPorDiaDoVeiculo(v) {
  if (!v || !v.horario) return null;
  const saida = {};
  for (const [chave] of DIAS_CONFIG) saida[chave] = faixasDe(v.horario[chave]);
  return saida;
}

/** Onde mora a lista de faixas apontada por data-alvo ("seg", "exc:2"). */
function conjuntoDeFaixas(f, alvo) {
  if (String(alvo || '').startsWith('exc:')) {
    const i = Number(String(alvo).slice(4));
    const ordenadas = f.excecoes.slice().sort((a, b) => util.compararISO(a.data, b.data));
    return ordenadas[i] || null;
  }
  if (f.aba === 'pessoas' && f.escala) return { get faixas() { return f.escala.dias[alvo]; }, set faixas(v) { f.escala.dias[alvo] = v; } };
  if (f.aba === 'carros' && f.veiculo && f.veiculo.horario) return { get faixas() { return f.veiculo.horario[alvo]; }, set faixas(v) { f.veiculo.horario[alvo] = v; } };
  return { get faixas() { return f.horario[alvo]; }, set faixas(v) { f.horario[alvo] = v; } };
}

/** Todos os conjuntos de dia da semana da aba corrente, para o botão de copiar. */
function diasDaAba(f) {
  if (f.aba === 'pessoas' && f.escala) return f.escala.dias;
  if (f.aba === 'carros' && f.veiculo && f.veiculo.horario) return f.veiculo.horario;
  return f.horario;
}

function ligarDisponibilidade(raiz, estado, chave) {
  const f = estado.valores;
  const u = usuarioAtual();
  const redesenhar = () => {
    const caixa = raiz.querySelector('[data-parte="disponibilidade"]');
    if (caixa) caixa.innerHTML = disponibilidadeHTML(f);
  };
  const mexeu = () => { estado.mexeu = true; };

  ui.delegar(raiz, '[data-acao]', 'click', async (acao, el) => {
    const alvo = el.getAttribute('data-alvo');
    const i = Number(el.getAttribute('data-i'));
    if (acao === 'aba-disp') {
      /* Troca de aba sem navegar: mudar de rota limparia o rascunho e o que a pessoa
         já digitou nas faixas se perderia antes de salvar. */
      f.aba = el.getAttribute('data-valor');
      if (f.aba === 'pessoas' && !f.escala) {
        const primeira = dados.usuariosAtivos().slice().sort(util.porNome)[0];
        if (primeira) { f.pessoaId = primeira.id; f.escala = escalaEmFaixas(primeira); }
      }
      if (f.aba === 'carros' && !f.veiculo) {
        const primeiro = dados.veiculosAtivos().slice().sort(util.porNome)[0];
        if (primeiro) { f.veiculoId = primeiro.id; f.veiculo = { horario: faixasPorDiaDoVeiculo(primeiro), limiteDia: primeiro.limiteDia == null ? '' : primeiro.limiteDia }; }
      }
      redesenhar();
    } else if (acao === 'alternar-dia') {
      const conjunto = conjuntoDeFaixas(f, alvo);
      if (!conjunto) return;
      if (String(alvo).startsWith('exc:')) {
        conjunto.fechado = !el.checked;
        if (!conjunto.fechado && !temFaixa(conjunto.faixas)) conjunto.faixas = [Object.assign({}, FAIXA_PADRAO)];
      } else {
        conjunto.faixas = el.checked ? [Object.assign({}, FAIXA_PADRAO)] : null;
      }
      mexeu();
      redesenhar();
    } else if (acao === 'mais-faixa') {
      const conjunto = conjuntoDeFaixas(f, alvo);
      if (!conjunto || !temFaixa(conjunto.faixas)) return;
      const ultima = conjunto.faixas[conjunto.faixas.length - 1];
      const inicio = util.minParaHora(Math.min(min(ultima.ate) + 60, 23 * 60));
      const fim = util.minParaHora(Math.min(min(inicio) + 240, 23 * 60 + 59));
      conjunto.faixas = conjunto.faixas.concat({ de: inicio, ate: fim });
      mexeu();
      redesenhar();
    } else if (acao === 'remover-faixa') {
      const conjunto = conjuntoDeFaixas(f, alvo);
      if (!conjunto || !temFaixa(conjunto.faixas)) return;
      const restantes = conjunto.faixas.filter((x, k) => k !== i);
      conjunto.faixas = restantes.length ? restantes : null;
      mexeu();
      redesenhar();
    } else if (acao === 'copiar-faixa') {
      const dias = diasDaAba(f);
      const origem = dias[alvo];
      if (!temFaixa(origem)) return;
      for (const dia of DIAS_UTEIS) dias[dia] = origem.map((x) => ({ de: x.de, ate: x.ate }));
      mexeu();
      redesenhar();
      ui.toast('Horário copiado para os dias úteis');
    } else if (acao === 'nova-excecao') {
      const data = String(f.novaExcecaoData || '');
      if (!dataValida(data)) { mostrarErros(raiz, [{ campo: 'excecao', mensagem: 'Escolha a data' }]); return; }
      if (f.excecoes.some((x) => x.data === data)) { mostrarErros(raiz, [{ campo: 'excecao', mensagem: 'Já existe uma data específica nesse dia' }]); return; }
      f.excecoes = f.excecoes.concat({ id: util.uid('x'), data, nome: '', fechado: true, faixas: null });
      f.novaExcecaoData = '';
      mexeu();
      redesenhar();
    } else if (acao === 'remover-excecao') {
      const ordenadas = f.excecoes.slice().sort((a, b) => util.compararISO(a.data, b.data));
      const fora = ordenadas[i];
      if (!fora) return;
      f.excecoes = f.excecoes.filter((x) => x !== fora);
      mexeu();
      redesenhar();
    } else if (acao === 'alternar-feriado') {
      const data = el.getAttribute('data-data');
      f.feriados = f.feriados.map((x) => (x.data === data ? Object.assign({}, x, { ativo: el.checked }) : x));
      mexeu();
      redesenhar();
    } else if (acao === 'remover-feriado') {
      const data = el.getAttribute('data-data');
      f.feriados = f.feriados.filter((x) => x.data !== data);
      mexeu();
      redesenhar();
    } else if (acao === 'adicionar-feriado') {
      const data = String(f.novoFeriadoData || '');
      const nome = String(f.novoFeriadoNome || '').trim();
      if (!dataValida(data) || !nome) { mostrarErros(raiz, [{ campo: 'feriado', mensagem: 'Informe a data e o nome do feriado' }]); return; }
      if (f.feriados.some((x) => x.data === data)) { mostrarErros(raiz, [{ campo: 'feriado', mensagem: 'Já existe feriado nesta data' }]); return; }
      f.feriados = f.feriados.concat({ data, nome, ativo: true });
      f.novoFeriadoData = '';
      f.novoFeriadoNome = '';
      mexeu();
      redesenhar();
    } else if (acao === 'adicionar-folga') {
      const data = String(f.novaFolga || '');
      if (!dataValida(data)) { mostrarErros(raiz, [{ campo: 'folga', mensagem: 'Escolha a data da folga' }]); return; }
      if ((f.escala.excecoes || []).some((x) => x.data === data)) { mostrarErros(raiz, [{ campo: 'folga', mensagem: 'Já existe uma data marcada nesse dia' }]); return; }
      f.escala.excecoes = (f.escala.excecoes || []).concat({ id: util.uid('x'), data, nome: 'Folga', fechado: true, faixas: null });
      f.novaFolga = '';
      mexeu();
      redesenhar();
    } else if (acao === 'remover-excecao-pessoa') {
      const ordenadas = (f.escala.excecoes || []).slice().sort((a, b) => util.compararISO(a.data, b.data));
      const fora = ordenadas[i];
      if (!fora) return;
      f.escala.excecoes = f.escala.excecoes.filter((x) => x !== fora);
      mexeu();
      redesenhar();
    } else if (acao === 'nova-indisp') {
      abrirIndisponibilidade(f.veiculoId);
    } else if (acao === 'remover-indisp') {
      const ok = await removerIndisponibilidade(el.getAttribute('data-id'));
      if (ok) redesenhar();
    } else if (acao === 'salvar-loja') {
      const r = salvarDisponibilidadeLoja(f);
      if (!r.ok) { mostrarErros(raiz, r.erros); return; }
      if (r.mudou) {
        /* O rascunho renasce do que foi gravado, mas na mesma aba: sem isso o rerender que vem
           depois da gravação jogava a pessoa para a aba do endereço (#/disponibilidade/carros). */
        const abaAtual = f.aba;
        limparRascunho(chave);
        estadoForm(chave, () => valoresDisponibilidade()).valores.aba = abaAtual;
      }
      ui.toast(r.mudou ? 'Disponibilidade salva' : 'Nada mudou', r.mudou ? 'ok' : 'info');
    } else if (acao === 'salvar-pessoa') {
      const r = salvarEscalaPessoa(f.pessoaId, f.escala, u);
      if (!r.ok) { mostrarErros(raiz, r.erros); return; }
      estado.mexeu = false;
      ui.toast(r.mudou ? 'Escala salva' : 'Nada mudou', r.mudou ? 'ok' : 'info');
    } else if (acao === 'salvar-veiculo-horario') {
      const r = salvarHorarioVeiculo(f.veiculoId, f.veiculo, u);
      if (!r.ok) { mostrarErros(raiz, r.erros); return; }
      estado.mexeu = false;
      ui.toast(r.mudou ? 'Horário do carro salvo' : 'Nada mudou', r.mudou ? 'ok' : 'info');
    }
  });

  const guardar = (el) => {
    const campo = el.getAttribute('data-campo');
    const param = el.getAttribute('data-param');
    const loja = el.getAttribute('data-loja');
    if (param) { f.params[param] = el.value; mexeu(); return; }
    if (loja) { f.loja[loja] = el.value; mexeu(); return; }
    if (campo === 'faixa') {
      const conjunto = conjuntoDeFaixas(f, el.getAttribute('data-alvo'));
      const i = Number(el.getAttribute('data-i'));
      if (!conjunto || !temFaixa(conjunto.faixas) || !conjunto.faixas[i]) return;
      const copia = conjunto.faixas.map((x) => ({ de: x.de, ate: x.ate }));
      copia[i][el.getAttribute('data-lado')] = el.value;
      conjunto.faixas = copia;
      mexeu();
      return;
    }
    if (campo === 'excecao-nome') {
      const ordenadas = f.excecoes.slice().sort((a, b) => util.compararISO(a.data, b.data));
      const alvo = ordenadas[Number(el.getAttribute('data-i'))];
      if (alvo) { alvo.nome = el.value; mexeu(); }
      return;
    }
    if (campo === 'pessoaId') {
      const pessoa = dados.usuarioPorId(el.value);
      f.pessoaId = el.value;
      f.escala = pessoa ? escalaEmFaixas(pessoa) : null;
      redesenhar();
      return;
    }
    if (campo === 'veiculoId') {
      const v = dados.veiculoPorId(el.value);
      f.veiculoId = el.value;
      f.veiculo = v ? { horario: faixasPorDiaDoVeiculo(v), limiteDia: v.limiteDia == null ? '' : v.limiteDia } : null;
      redesenhar();
      return;
    }
    if (campo === 'limiteVeiculo') { if (f.veiculo) { f.veiculo.limiteDia = el.value; mexeu(); } return; }
    if (campo === 'segueLoja') {
      if (!f.veiculo) return;
      f.veiculo.horario = el.checked ? null : Object.assign({}, faixasPorDiaDoVeiculo({ horario: repo.config().horario }));
      mexeu();
      redesenhar();
      return;
    }
    if (['novoFeriadoData', 'novoFeriadoNome', 'novaFolga', 'novaExcecaoData'].includes(campo)) { f[campo] = el.value; }
  };
  ui.delegar(raiz, '[data-campo], [data-param], [data-loja]', 'change', (acao, el) => guardar(el));
  ui.delegar(raiz, '[data-campo], [data-param], [data-loja]', 'input', (acao, el) => {
    const campo = el.getAttribute('data-campo');
    if (el.type === 'time' || el.type === 'checkbox' || campo === 'pessoaId' || campo === 'veiculoId') return;
    guardar(el);
  });
}

/** Grava a aba Loja: faixas, datas específicas, feriados, parâmetros e endereço, tudo por salvarHorarios. */
function salvarDisponibilidadeLoja(f) {
  const horario = {};
  for (const [chave] of DIAS_CONFIG) horario[chave] = temFaixa(f.horario[chave]) ? f.horario[chave] : null;
  const numero = (v, padrao) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : padrao; };
  return salvarHorarios({
    horario,
    excecoes: f.excecoes.map((x) => ({ id: x.id, data: x.data, nome: String(x.nome || '').trim(), fechado: !!x.fechado, faixas: x.fechado ? [] : (x.faixas || []) })),
    feriados: f.feriados.map((x) => ({ data: x.data, nome: x.nome, ativo: x.ativo !== false })),
    loja: f.loja,
    folgaAntesMin: numero(f.params.folgaAntesMin, 0),
    folgaDepoisMin: numero(f.params.folgaDepoisMin, 30),
    folgaDeslocamentoMin: numero(f.params.folgaDepoisMin, 30),
    antecedenciaMinMin: numero(f.params.antecedenciaMinMin, 120),
    janelaDias: numero(f.params.janelaDias, 90),
    slotMin: numero(f.params.slotMin, 30),
    horaCorteAmanha: f.params.horaCorteAmanha,
    atrasoInicioMin: numero(f.params.atrasoInicioMin, 20),
    atrasoFimMin: numero(f.params.atrasoFimMin, 30)
  });
}

/** Grava a escala da pessoa sem passar por salvarUsuario: aqui não se mexe em perfil nem em senha. */
function salvarEscalaPessoa(id, escala, u) {
  const pessoa = dados.usuarioPorId(id);
  if (!pessoa || !u || !dados.pode('cadastros', u)) return { ok: false, erros: [{ campo: 'escala', mensagem: 'Você não pode alterar escalas' }] };
  if (!escala) return { ok: false, erros: [{ campo: 'escala', mensagem: 'Escolha a pessoa' }] };
  for (const [chave] of DIAS_CONFIG) {
    const faixas = escala.dias[chave] || [];
    for (const faixa of faixas) if (!horaValida(faixa.de) || !horaValida(faixa.ate) || min(faixa.de) >= min(faixa.ate)) {
      return { ok: false, erros: [{ campo: 'escala', mensagem: 'A saída precisa ser depois da entrada' }] };
    }
  }
  const excecoes = (escala.excecoes || []).filter((x) => dataValida(x.data))
    .map((x) => ({ id: x.id || util.uid('x'), data: x.data, nome: String(x.nome || '').trim(), fechado: !!x.fechado, faixas: x.fechado ? [] : (x.faixas || []) }));
  const nova = Object.assign({}, pessoa.escala || {}, {
    seg_sex: temFaixa(escala.dias.seg) ? escala.dias.seg : null,
    sab: temFaixa(escala.dias.sab) ? escala.dias.sab : null,
    dom: temFaixa(escala.dias.dom) ? escala.dias.dom : null,
    folgas: excecoes.filter((x) => x.fechado).map((x) => x.data).sort(),
    excecoes
  });
  for (const chave of DIAS_UTEIS) nova[chave] = temFaixa(escala.dias[chave]) ? escala.dias[chave] : null;
  if (JSON.stringify(nova) === JSON.stringify(pessoa.escala || {})) return { ok: true, mudou: false };
  repo.transacao(() => {
    const depois = repo.atualizar('usuarios', id, { escala: nova });
    dados.auditar({
      acao: 'disponibilidade_editada', entidade: 'usuario', entidadeId: id, rotulo: depois.nome,
      campos: [{ campo: 'Escala', antes: textoEscala(pessoa.escala), depois: textoEscala(nova) }], motivo: null, setorId: null
    });
  });
  return { ok: true, mudou: true };
}

/** Resumo legível de uma escala, para a auditoria. */
function textoEscala(escala) {
  const e = escala || {};
  const partes = DIAS_CONFIG.map(([chave, rotulo]) => {
    const valor = chave === 'sab' ? e.sab : chave === 'dom' ? e.dom : (e[chave] !== undefined ? e[chave] : e.seg_sex);
    return rotulo.toLowerCase() + ' ' + faixaTexto(valor).toLowerCase();
  });
  const folgas = (e.folgas || []).length;
  return partes.join('; ') + (folgas ? '; ' + plural(folgas, 'folga', 'folgas') : '');
}

/** Grava o horário próprio e o limite por dia do carro. */
function salvarHorarioVeiculo(id, dadosVeiculo, u) {
  const v = dados.veiculoPorId(id);
  if (!v || !u || !dados.pode('editarRecursos', u)) return { ok: false, erros: [{ campo: 'horarioVeiculo', mensagem: 'Você não pode alterar carros' }] };
  if (!dadosVeiculo) return { ok: false, erros: [{ campo: 'horarioVeiculo', mensagem: 'Escolha o carro' }] };
  let horario = null;
  if (dadosVeiculo.horario) {
    horario = {};
    for (const [chave] of DIAS_CONFIG) {
      const faixas = dadosVeiculo.horario[chave] || [];
      for (const faixa of faixas) if (!horaValida(faixa.de) || !horaValida(faixa.ate) || min(faixa.de) >= min(faixa.ate)) {
        return { ok: false, erros: [{ campo: 'horarioVeiculo', mensagem: 'O fechamento precisa ser depois da abertura' }] };
      }
      horario[chave] = temFaixa(faixas) ? faixas : null;
    }
  }
  const limite = dadosVeiculo.limiteDia === '' || dadosVeiculo.limiteDia == null ? null : Math.round(Number(dadosVeiculo.limiteDia));
  if (limite != null && (!Number.isFinite(limite) || limite < 1)) return { ok: false, erros: [{ campo: 'horarioVeiculo', mensagem: 'O limite por dia começa em 1' }] };
  const mudancas = { horario, limiteDia: limite };
  if (JSON.stringify(mudancas) === JSON.stringify({ horario: v.horario || null, limiteDia: v.limiteDia == null ? null : v.limiteDia })) return { ok: true, mudou: false };
  repo.transacao(() => {
    const depois = repo.atualizar('veiculos', id, mudancas);
    dados.auditar({
      acao: 'disponibilidade_editada', entidade: 'veiculo', entidadeId: id, rotulo: apelidoVeiculo(depois),
      campos: [
        { campo: 'Horário', antes: textoHorarioVeiculo(v.horario), depois: textoHorarioVeiculo(depois.horario) },
        { campo: 'Limite por dia', antes: v.limiteDia == null ? 'sem limite' : String(v.limiteDia), depois: limite == null ? 'sem limite' : String(limite) }
      ],
      motivo: null, setorId: null
    });
  });
  return { ok: true, mudou: true };
}

function textoHorarioVeiculo(horario) {
  if (!horario) return 'segue a loja';
  return DIAS_CONFIG.map(([chave, rotulo]) => rotulo.toLowerCase() + ' ' + faixaTexto(horario[chave]).toLowerCase()).join('; ');
}
/** "08:00 às 12:00 e 13:30 às 18:30" a partir de uma faixa única (v1) ou de um array de faixas (v2). */
function faixaTexto(h) {
  const faixas = Array.isArray(h) ? h : (h && h.de && h.ate ? [h] : []);
  if (!faixas.length) return 'Fechado';
  return faixas.map((f) => f.de + ' às ' + f.ate).join(' e ');
}

/** Diferença legível entre duas configs, por dia, setor, feriado e campo. */
function diffConfig(antes, depois) {
  const saida = [];
  const empurrar = (campo, a, d) => { if (a !== d) saida.push({ campo, antes: a, depois: d }); };
  for (const [k, rotulo] of DIAS_CONFIG) empurrar('Horário ' + rotulo.toLowerCase(), faixaTexto((antes.horario || {})[k]), faixaTexto((depois.horario || {})[k]));
  empurrar('Almoço', antes.almoco ? faixaTexto(antes.almoco) : 'Sem faixa', depois.almoco ? faixaTexto(depois.almoco) : 'Sem faixa');
  for (const s of dados.SETORES) {
    const a = (antes.horariosSetor || {})[s.id];
    const d = (depois.horariosSetor || {})[s.id];
    empurrar('Horário ' + s.nome, a ? faixaTexto(a) : 'Geral', d ? faixaTexto(d) : 'Geral');
  }
  const chaveFeriado = (x) => util.fmtData(x.data).slice(0, 5) + ' ' + x.nome + (x.ativo === false ? ' (desligado)' : '');
  const fa = new Set((antes.feriados || []).map(chaveFeriado));
  const fd = new Set((depois.feriados || []).map(chaveFeriado));
  for (const f of fa) if (!fd.has(f)) saida.push({ campo: 'Feriado', antes: f, depois: 'removido' });
  for (const f of fd) if (!fa.has(f)) saida.push({ campo: 'Feriado', antes: 'novo', depois: f });
  /* Datas específicas (DIRECAO 5.2): entram na auditoria uma a uma, como os feriados. */
  const chaveExcecao = (x) => util.fmtData(x.data).slice(0, 5) + ' ' + (x.nome || 'sem nome') + ', ' + (x.fechado ? 'fechado' : faixaTexto(x.faixas));
  const xa = new Set((antes.excecoes || []).map(chaveExcecao));
  const xd = new Set((depois.excecoes || []).map(chaveExcecao));
  for (const x of xa) if (!xd.has(x)) saida.push({ campo: 'Data específica', antes: x, depois: 'removida' });
  for (const x of xd) if (!xa.has(x)) saida.push({ campo: 'Data específica', antes: 'nova', depois: x });
  const la = antes.loja || {};
  const ld = depois.loja || {};
  empurrar('Loja', la.nome || '', ld.nome || '');
  empurrar('Endereço da loja', la.endereco || '', ld.endereco || '');
  empurrar('Telefone da loja', la.telefone || '', ld.telefone || '');
  empurrar('Folga de deslocamento', String(antes.folgaDeslocamentoMin) + ' min', String(depois.folgaDeslocamentoMin) + ' min');
  for (const [campo, sufixo] of [['folgaAntesMin', ' min'], ['folgaDepoisMin', ' min'], ['antecedenciaMinMin', ' min'], ['janelaDias', ' dias'], ['slotMin', ' min']]) {
    empurrar(dados.rotuloCampo(campo), String(antes[campo]) + sufixo, String(depois[campo]) + sufixo);
  }
  empurrar('Hora de corte', antes.horaCorteAmanha || '', depois.horaCorteAmanha || '');
  empurrar('Atraso de início', String(antes.atrasoInicioMin) + ' min', String(depois.atrasoInicioMin) + ' min');
  empurrar('Atraso de fim', String(antes.atrasoFimMin) + ' min', String(depois.atrasoFimMin) + ' min');
  return saida;
}

/**
 * Grava config de uma vez; audita horarios_editados com campos.
 * Aceita horário em faixa única (v1) ou em array de faixas (v2), mais excecoes, feriados com `ativo`
 * e os parâmetros de agendamento da DIRECAO 4.2 a 4.6.
 * @param {object} mudancas campos de 4.10 @returns {{ok:boolean, mudou?:boolean, erros?:object[]}}
 */
export function salvarHorarios(mudancas) {
  const u = usuarioAtual();
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !dados.pode('cadastros', u)) return { ok: false, erros: [{ campo: 'horario', mensagem: 'Você não pode alterar horários' }] };
  const m = mudancas || {};
  const antes = repo.config();
  const novo = {};
  if (m.horario) {
    /* Aceita a faixa única da v1 e o array de faixas da v2 (DIRECAO 5.2). O vão entre duas faixas é o almoço. */
    novo.horario = {};
    for (const [k, rotulo] of DIAS_CONFIG) {
      const h = m.horario[k];
      const faixas = Array.isArray(h) ? h : (h ? [h] : []);
      if (!faixas.length) { novo.horario[k] = null; continue; }
      let fimAnterior = -1;
      for (const faixa of faixas) {
        if (!faixa || !horaValida(faixa.de) || !horaValida(faixa.ate) || min(faixa.de) >= min(faixa.ate)) erro('horario', rotulo + ': o fechamento precisa ser depois da abertura');
        else if (min(faixa.de) < fimAnterior) erro('horario', rotulo + ': as faixas do dia não podem se sobrepor');
        else fimAnterior = min(faixa.ate);
      }
      novo.horario[k] = faixas.map((faixa) => ({ de: faixa.de, ate: faixa.ate }));
    }
    if (!Object.values(novo.horario).some(Boolean)) erro('horario', 'A loja precisa abrir em ao menos um dia');
  }
  if (m.excecoes !== undefined) {
    novo.excecoes = [];
    for (const x of m.excecoes || []) {
      if (!x || !dataValida(x.data)) continue;
      const faixas = (x.fechado ? [] : (x.faixas || [])).filter((faixa) => faixa && horaValida(faixa.de) && horaValida(faixa.ate));
      if (!x.fechado && !faixas.length) erro('excecao', util.fmtData(x.data) + ': informe o horário ou marque como fechado');
      for (const faixa of faixas) if (min(faixa.de) >= min(faixa.ate)) erro('excecao', util.fmtData(x.data) + ': o fechamento precisa ser depois da abertura');
      novo.excecoes.push({ id: x.id || util.uid('x'), data: x.data, nome: String(x.nome || '').trim(), fechado: !!x.fechado, faixas: faixas.map((faixa) => ({ de: faixa.de, ate: faixa.ate })) });
    }
    novo.excecoes.sort((a, b) => util.compararISO(a.data, b.data));
  }
  if (m.horariosSetor !== undefined) {
    novo.horariosSetor = {};
    for (const s of dados.SETORES) {
      const h = (m.horariosSetor || {})[s.id];
      if (!h) continue;
      if (!horaValida(h.de) || !horaValida(h.ate) || min(h.de) >= min(h.ate)) erro('horariosSetor', s.nome + ': o fechamento precisa ser depois da abertura');
      novo.horariosSetor[s.id] = { de: h.de, ate: h.ate };
    }
  }
  if (m.almoco !== undefined) {
    if (m.almoco && (!horaValida(m.almoco.de) || !horaValida(m.almoco.ate) || min(m.almoco.de) >= min(m.almoco.ate))) erro('almoco', 'Almoço: o fim precisa ser depois do início');
    novo.almoco = m.almoco ? { de: m.almoco.de, ate: m.almoco.ate } : null;
  }
  if (m.feriados !== undefined) {
    novo.feriados = (m.feriados || []).filter((x) => x && dataValida(x.data))
      .map((x) => ({ data: x.data, nome: String(x.nome || '').trim() || 'Feriado', ativo: x.ativo !== false }));
  }
  if (m.loja !== undefined) {
    novo.loja = { nome: String(m.loja.nome || '').trim(), endereco: String(m.loja.endereco || '').trim(), telefone: String(m.loja.telefone || '').trim() };
    if (!novo.loja.nome) erro('lojaNome', 'Escreva o nome da loja');
    if (!novo.loja.endereco) erro('lojaEndereco', 'Escreva o endereço da loja');
  }
  for (const campo of ['folgaDeslocamentoMin', 'folgaAntesMin', 'folgaDepoisMin', 'antecedenciaMinMin', 'janelaDias',
    'atrasoInicioMin', 'atrasoFimMin', 'slotMin', 'passoSugestaoMin', 'duracaoPadraoMin', 'notificacoesMax', 'auditoriaMax']) {
    if (m[campo] === undefined) continue;
    const n = Number(m[campo]);
    if (!Number.isFinite(n) || n < 0) erro('operacao', 'Valor inválido em ' + dados.rotuloCampo(campo).toLowerCase());
    else novo[campo] = Math.round(n);
  }
  if (m.horaCorteAmanha !== undefined) {
    if (!horaValida(m.horaCorteAmanha)) erro('operacao', 'Hora de corte inválida');
    else novo.horaCorteAmanha = m.horaCorteAmanha;
  }
  if (erros.length) return { ok: false, erros };
  const depoisPrevisto = Object.assign({}, antes, novo);
  const campos = diffConfig(antes, depoisPrevisto);
  if (!campos.length) return { ok: true, mudou: false };
  repo.transacao(() => {
    repo.salvarConfig(novo);
    dados.auditar({ acao: 'horarios_editados', entidade: 'config', entidadeId: 'config', rotulo: 'Horários e loja', campos, motivo: null, setorId: null });
  });
  return { ok: true, mudou: true };
}

/* ---- Usuários (9.6) ---- */

let buscaUsuarios = '';

/** Lista de usuários com busca (9.6). @param {object} ctx */
export function telaUsuarios(ctx) {
  const { alvo, usuario } = ctx;
  if (!dados.pode('usuarios', usuario)) { telaSemAcesso(alvo, 'Usuários'); return; }
  const cab = cabecalhoComAcao({ titulo: 'Usuários', subtitulo: 'Acessos, perfis e escalas', voltar: true, acao: { acao: 'novo', rotulo: 'Novo usuário', icone: 'mais' } });
  ligarCabecalho(cab, (acao) => { if (acao === 'novo') ui.irPara('#/cadastros/usuarios/novo'); });
  const norm = util.normalizar(buscaUsuarios);
  const lista = repo.listar('usuarios').sort((a, b) => (a.ativo === b.ativo ? 0 : a.ativo ? -1 : 1) || util.porNome(a, b))
    .filter((u) => !norm || util.normalizar(u.nome).includes(norm) || util.normalizar(u.email).includes(norm) || util.normalizar(u.cargo).includes(norm));
  const html =
    '<div class="usuarios">' +
      '<div class="busca mb3">' + icone('busca', 18) + '<input class="entrada" type="search" data-busca value="' + esc(buscaUsuarios) + '" placeholder="Buscar por nome" aria-label="Buscar usuário"></div>' +
      (lista.length ? '<div class="lista lista-cartao">' + lista.map((u) =>
        '<button type="button" class="item item-toque' + (u.ativo ? '' : ' item-desativado') + '" data-acao="ui:nav" data-rota="#/cadastros/usuarios/' + esc(u.id) + '">' +
        ui.avatar(u) +
        '<div class="item-corpo"><div class="item-titulo">' + esc(u.nome) + (u.ativo ? '' : ' <span class="pequeno mudo">(inativo)</span>') + '</div>' +
        '<div class="item-sub">' + esc([u.cargo, dados.rotuloPerfil(u.perfil)].filter(Boolean).join('\u00a0· ')) + '</div>' +
        '<div class="item-sub">' + esc((u.setores || []).map((s) => dados.setorPorId(s).nome).join(', ')) + (u.campo ? '\u00a0<span aria-hidden="true">·</span> campo' : '') + '</div></div>' +
        '<span class="item-fim">' + icone('direita', 18) + '</span></button>').join('') + '</div>'
        : ui.estadoVazio({ icone: 'usuarios', titulo: norm ? 'Ninguém com esse nome' : 'Nenhum usuário', acao: norm ? null : { rotulo: 'Novo usuário', acao: 'novo' } })) +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    const campo = raiz.querySelector('[data-busca]');
    const filtrar = util.debounce(() => {
      buscaUsuarios = campo.value;
      const pos = campo.selectionStart;
      telaUsuarios(ctx);
      const novo = alvo.querySelector('[data-busca]');
      if (novo) { novo.focus(); try { novo.setSelectionRange(pos, pos); } catch (e) { /* ignora */ } }
    }, 150);
    campo.addEventListener('input', filtrar);
    ui.delegar(raiz, '[data-acao="novo"]', 'click', () => ui.irPara('#/cadastros/usuarios/novo'));
  });
}

function valoresUsuario(u) {
  const e = (u && u.escala) || ESCALA_PADRAO;
  return {
    nome: u ? u.nome : '', cargo: u ? (u.cargo || '') : '', email: u ? u.email : '', perfil: u ? u.perfil : 'atendente',
    setores: u ? (u.setores || []).slice() : [], campo: u ? !!u.campo : false, ativo: u ? !!u.ativo : true, telefone: u ? (u.telefone || '') : '',
    segSexLigado: !!e.seg_sex, segSexDe: e.seg_sex ? e.seg_sex.de : '08:00', segSexAte: e.seg_sex ? e.seg_sex.ate : '18:00',
    sabLigado: !!e.sab, sabDe: e.sab ? e.sab.de : '08:30', sabAte: e.sab ? e.sab.ate : '12:30',
    domLigado: !!e.dom, domDe: e.dom ? e.dom.de : '08:00', domAte: e.dom ? e.dom.ate : '12:00',
    folgas: (e.folgas || []).slice(), novaFolga: '',
    senha: '', senha2: ''
  };
}

function folgasHTML(f) {
  const lista = (f.folgas || []).slice().sort();
  return '<div data-parte="folgas">' +
    '<div class="folgas-lista">' + (lista.length ? lista.map((d) => '<span class="chip chip-filtro">' + esc(util.fmtDataMedia(d)) +
      '<button type="button" class="chip-x" data-acao="remover-folga" data-valor="' + esc(d) + '" aria-label="Remover folga ' + esc(util.fmtDataMedia(d)) + '">' + icone('x', 14) + '</button></span>').join('')
      : '<span class="mudo">Sem folgas marcadas</span>') + '</div>' +
    '<div class="campo-com-botao mt2">' + ui.campo({ id: 'f-novaFolga', rotulo: 'Nova folga', tipo: 'date', valor: f.novaFolga, atributos: 'data-campo="novaFolga"' }) +
      ui.botao({ rotulo: 'Adicionar', acao: 'adicionar-folga', cls: 'btn-secundario', icone: 'mais' }) + '</div>' + slotErro('folga') +
    '</div>';
}

function linhaEscalaHTML(rotulo, campoLigado, ligado, campoDe, de, campoAte, ate) {
  return '<div class="escala-linha"' + (ligado ? '' : ' data-fechado') + '>' +
    '<span class="horario-linha-dia">' + esc(rotulo) + '</span>' +
    interruptorSimples(campoLigado, ligado, 'Trabalha: ' + rotulo) +
    '<input class="entrada" type="time" data-campo="' + esc(campoDe) + '" value="' + esc(de) + '" aria-label="Entrada" step="900"' + (ligado ? '' : ' disabled') + '>' +
    '<input class="entrada" type="time" data-campo="' + esc(campoAte) + '" value="' + esc(ate) + '" aria-label="Saída" step="900"' + (ligado ? '' : ' disabled') + '>' +
    '</div>';
}

/** Formulário de usuário com escala, folgas e redefinição de senha. @param {{params:{id?:string}, query:object, alvo:HTMLElement, usuario:object}} ctx */
export function formUsuario(ctx) {
  const { params, alvo, usuario } = ctx;
  if (!dados.pode('usuarios', usuario)) { telaSemAcesso(alvo, 'Usuário'); return; }
  const id = params.id || null;
  const original = id ? dados.usuarioPorId(id) : null;
  if (id && !original) { telaNaoEncontrado(alvo, 'Usuário não encontrado', 'O cadastro pode ter sido removido.'); return; }
  const chave = 'usuario:' + (id || 'novo');
  const estado = estadoForm(chave, () => valoresUsuario(original));
  const f = estado.valores;
  ui.montarCabecalho({ titulo: id ? original.nome : 'Novo usuário', voltar: true, subtitulo: id ? dados.rotuloPerfil(original.perfil) : 'Acesso à agenda' });
  const perfis = Object.keys(dados.PERFIS).map((p) => ({ valor: p, rotulo: dados.rotuloPerfil(p) }));
  const html =
    '<form class="form-cadastro form-usuario" novalidate autocomplete="off">' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Pessoa</h2>' +
        campoTexto('nome', 'Nome', f.nome, { obrigatorio: true, atributos: 'autocomplete="off"' }) + slotErro('nome') +
        '<div class="linha-campos">' +
          campoTexto('cargo', 'Cargo', f.cargo, { atributos: 'placeholder="Auxiliar Operacional" autocomplete="off"' }) +
          campoTexto('telefone', 'Telefone', f.telefone, { tipo: 'tel', atributos: 'inputmode="tel" autocomplete="off"' }) +
        '</div>' +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Acesso</h2>' +
        campoTexto('email', 'Email', f.email, { tipo: 'email', obrigatorio: true, ajuda: 'Chave de login, minúsculo', atributos: 'inputmode="email" autocomplete="off" autocapitalize="none"' }) + slotErro('email') +
        ui.campo({ id: 'f-perfil', rotulo: 'Perfil', valor: f.perfil, opcoes: perfis, atributos: 'data-campo="perfil"' }) + slotErro('perfil') +
        '<div class="campo"><span class="campo-rotulo">Setores</span>' + chipsSetores('setores', f.setores) + slotErro('setores') + '</div>' +
        interruptor('campo', f.campo || f.perfil === 'campo', 'Pessoa de campo', 'Aparece nas colunas de Pessoas e no bloco Quem vai') +
        interruptor('ativo', f.ativo, 'Ativo', 'Inativo não entra e não aparece para alocação') +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">Escala</h2><div class="cartao">' +
        linhaEscalaHTML('Seg a sex', 'segSexLigado', f.segSexLigado, 'segSexDe', f.segSexDe, 'segSexAte', f.segSexAte) +
        linhaEscalaHTML('Sábado', 'sabLigado', f.sabLigado, 'sabDe', f.sabDe, 'sabAte', f.sabAte) +
        linhaEscalaHTML('Domingo', 'domLigado', f.domLigado, 'domDe', f.domDe, 'domAte', f.domAte) +
        slotErro('escala') + '</div>' +
        '<div class="campo mt3"><span class="campo-rotulo">Folgas</span>' + folgasHTML(f) + '</div>' +
      '</div>' +
      '<div class="form-bloco"><h2 class="form-bloco-titulo">' + (id ? 'Redefinir senha' : 'Senha') + '</h2>' +
        (id ? '<p class="campo-ajuda mb2">Deixe em branco para manter a senha atual.</p>' : '') +
        '<div class="linha-campos">' +
          campoTexto('senha', id ? 'Nova senha' : 'Senha', f.senha, { tipo: 'password', obrigatorio: !id, atributos: 'autocomplete="new-password" minlength="6"' }) +
          campoTexto('senha2', 'Repita a senha', f.senha2, { tipo: 'password', obrigatorio: !id, atributos: 'autocomplete="new-password" minlength="6"' }) +
        '</div>' + slotErro('senha') +
      '</div>' +
      rodapeForm(id ? 'Salvar' : 'Criar usuário') +
    '</form>';
  ui.renderizar(alvo, html, (raiz) => {
    ligarForm(raiz, estado, (campo, valor, el) => {
      const linha = el.closest('.escala-linha');
      if (linha && el.type === 'checkbox') {
        if (valor) linha.removeAttribute('data-fechado'); else linha.setAttribute('data-fechado', '');
        linha.querySelectorAll('input[type="time"]').forEach((i) => { i.disabled = !valor; });
      }
      if (campo === 'perfil' && valor === 'campo') {
        f.campo = true;
        const sw = raiz.querySelector('[data-campo="campo"]');
        if (sw) sw.checked = true;
      }
    });
    const atualizarFolgas = () => { const caixa = raiz.querySelector('[data-parte="folgas"]'); if (caixa) caixa.outerHTML = folgasHTML(f); };
    const gravar = async () => {
      const botao = raiz.querySelector('[data-acao="salvar-form"]');
      if (botao) botao.disabled = true;
      const r = await salvarUsuario(estado.valores, { id, senha: estado.valores.senha || null, senha2: estado.valores.senha2 || null });
      if (botao) botao.disabled = false;
      if (!r.ok) { estado.erros = r.erros; mostrarErros(raiz, r.erros); return; }
      limparRascunho(chave);
      ui.toast(id ? 'Usuário salvo' : 'Usuário criado');
      ui.irPara('#/cadastros/usuarios', { substituir: true });
    };
    raiz.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); gravar(); });
    ui.delegar(raiz, '[data-acao]', 'click', async (acao, el) => {
      if (acao === 'salvar-form') gravar();
      else if (acao === 'cancelar-form') { if (await confirmarDescarte(estado)) { limparRascunho(chave); ui.voltar(); } }
      else if (acao === 'remover-folga') { f.folgas = f.folgas.filter((d) => d !== el.getAttribute('data-valor')); estado.mexeu = true; atualizarFolgas(); }
      else if (acao === 'adicionar-folga') {
        const d = String(f.novaFolga || '');
        if (!dataValida(d)) { mostrarErros(raiz, [{ campo: 'folga', mensagem: 'Escolha a data da folga' }]); return; }
        if (f.folgas.includes(d)) { mostrarErros(raiz, [{ campo: 'folga', mensagem: 'Folga já marcada' }]); return; }
        f.folgas = f.folgas.concat(d);
        f.novaFolga = '';
        estado.mexeu = true;
        atualizarFolgas();
      }
    });
    if (estado.erros && Object.keys(estado.erros).length) mostrarErros(raiz, estado.erros);
    if (!id) { const primeiro = raiz.querySelector('[data-campo="nome"]'); if (primeiro) primeiro.focus(); }
  });
}

/* O formulário de usuário edita a escala em faixa única por bloco de dias. O que ele não conhece
   (dias soltos e exceções da v2, que a tela Disponibilidade escreve) é preservado, nunca apagado. */
function montarEscala(f, escalaAtual) {
  const faixa = (ligado, de, ate) => (ligado && horaValida(de) && horaValida(ate) ? { de, ate } : null);
  const atual = escalaAtual || {};
  const folgas = unicos(f.folgas || []).filter(dataValida).sort();
  const excecoes = (atual.excecoes || []).filter((x) => !x.fechado || folgas.includes(x.data));
  for (const data of folgas) {
    if (!excecoes.some((x) => x.data === data)) excecoes.push({ id: util.uid('x'), data, fechado: true, faixas: [], nome: 'Folga' });
  }
  const nova = Object.assign({}, atual, {
    seg_sex: faixa(f.segSexLigado, f.segSexDe, f.segSexAte),
    sab: faixa(f.sabLigado, f.sabDe, f.sabAte),
    dom: faixa(f.domLigado, f.domDe, f.domAte),
    folgas,
    excecoes: excecoes.sort((a, b) => util.compararISO(a.data, b.data))
  });
  /* Dias soltos que a Disponibilidade tenha gravado saem de cena quando o bloco seg a sex é editado aqui. */
  for (const dia of ['seg', 'ter', 'qua', 'qui', 'sex']) delete nova[dia];
  return nova;
}

function diffEscala(antes, depois) {
  const saida = [];
  const a = antes || {};
  const d = depois || {};
  const rotulos = { seg_sex: 'Escala seg a sex', sab: 'Escala sábado', dom: 'Escala domingo' };
  for (const k of Object.keys(rotulos)) {
    const ta = a[k] ? a[k].de + ' às ' + a[k].ate : 'Não trabalha';
    const td = d[k] ? d[k].de + ' às ' + d[k].ate : 'Não trabalha';
    if (ta !== td) saida.push({ campo: rotulos[k], antes: ta, depois: td });
  }
  const fa = (a.folgas || []).map((x) => util.fmtData(x).slice(0, 5)).join(', ') || 'Nenhuma';
  const fd = (d.folgas || []).map((x) => util.fmtData(x).slice(0, 5)).join(', ') || 'Nenhuma';
  if (fa !== fd) saida.push({ campo: 'Folgas', antes: fa, depois: fd });
  return saida;
}

/**
 * Valida (email único, perfil, ao menos um setor salvo campo puro), grava, define senha quando informada; audita usuario_criado ou usuario_editado (sem hash).
 * @param {object} dadosForm @param {{id?:string|null, senha?:string|null}} [opcoes] @returns {Promise<{ok:boolean, usuario?:object, erros?:object[]}>}
 */
export async function salvarUsuario(dadosForm, opcoes = {}) {
  const u = usuarioAtual();
  const id = opcoes.id || null;
  const original = id ? dados.usuarioPorId(id) : null;
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  if (!u || !dados.pode('usuarios', u)) return { ok: false, erros: [{ campo: 'nome', mensagem: 'Você não pode cadastrar usuários' }] };
  if (id && !original) return { ok: false, erros: [{ campo: 'id', mensagem: 'Usuário não encontrado' }] };
  const f = dadosForm || {};
  const perfil = dados.PERFIS[f.perfil] ? f.perfil : null;
  const setoresValidos = new Set(dados.SETORES.map((s) => s.id));
  const doc = {
    nome: String(f.nome || '').trim(),
    cargo: String(f.cargo || '').trim(),
    email: String(f.email || '').trim().toLowerCase(),
    perfil,
    setores: unicos(f.setores || []).filter((s) => setoresValidos.has(s)),
    campo: perfil === 'campo' ? true : !!f.campo,
    ativo: f.ativo !== false,
    telefone: String(f.telefone || '').trim(),
    escala: montarEscala(f, original ? original.escala : null)
  };
  if (!doc.nome) erro('nome', 'Escreva o nome');
  if (!doc.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.email)) erro('email', 'Escreva um email válido');
  else if (repo.listar('usuarios', (x) => x.id !== id).some((x) => String(x.email || '').toLowerCase() === doc.email)) erro('email', 'Já existe um usuário com este email');
  if (!perfil) erro('perfil', 'Escolha o perfil');
  if (!doc.setores.length && perfil !== 'campo') erro('setores', 'Escolha ao menos um setor');
  for (const k of ['seg_sex', 'sab', 'dom']) {
    const faixa = doc.escala[k];
    if (faixa && min(faixa.de) >= min(faixa.ate)) erro('escala', 'A saída precisa ser depois da entrada');
  }
  const senha = opcoes.senha != null ? String(opcoes.senha) : '';
  const senha2 = opcoes.senha2 != null ? String(opcoes.senha2) : (f.senha2 != null ? String(f.senha2) : senha);
  if (!id && !senha) erro('senha', 'Defina a senha inicial');
  if (senha && senha.length < 6) erro('senha', 'A senha precisa de ao menos 6 caracteres');
  if (senha && senha !== senha2) erro('senha', 'As duas senhas não conferem');
  if (id && original.id === u.id && !doc.ativo) erro('ativo', 'Você não pode desativar o próprio acesso');
  if (id && original.id === u.id && doc.perfil !== 'admin') erro('perfil', 'Você não pode tirar o próprio perfil de administrador');
  if (erros.length) return { ok: false, erros };

  const campos = ['nome', 'cargo', 'email', 'perfil', 'setores', 'campo', 'ativo', 'telefone'];
  const gravado = repo.transacao(() => {
    if (original) {
      const depois = repo.atualizar('usuarios', id, doc);
      const diff = dados.diffCampos(original, depois, campos).concat(diffEscala(original.escala, depois.escala));
      if (diff.length) dados.auditar({ acao: 'usuario_editado', entidade: 'usuario', entidadeId: id, rotulo: depois.nome, campos: diff, motivo: null, setorId: null });
      return depois;
    }
    const novo = repo.criar('usuarios', Object.assign({ status: 'disponivel', prefsNotif: Object.assign({}, PREFS_NOTIF_PADRAO) }, doc));
    dados.auditar({ acao: 'usuario_criado', entidade: 'usuario', entidadeId: novo.id, rotulo: novo.nome, campos: dados.diffCampos({}, novo, ['nome', 'cargo', 'email', 'perfil', 'setores', 'campo']), motivo: null, setorId: null });
    return novo;
  });
  if (senha) {
    await dados.sessao.definirSenha(gravado.id, senha);
    repo.transacao(() => {
      dados.auditar({ acao: 'senha_alterada', entidade: 'usuario', entidadeId: gravado.id, rotulo: gravado.nome, campos: null, motivo: id ? 'Senha redefinida por ' + nomeCurto(u.nome) : 'Senha inicial definida', setorId: null });
    });
  }
  return { ok: true, usuario: dados.usuarioPorId(gravado.id) };
}

/* ---- Dados de demonstração (9.7) ---- */

/** Dados de demonstração (9.7): recriar e limpar com confirmação digitando LIMPAR, uso de armazenamento. @param {object} ctx */
export function telaDadosDemo(ctx) {
  const { alvo, usuario } = ctx;
  if (!dados.pode('dadosDemo', usuario)) { telaSemAcesso(alvo, 'Dados de demonstração'); return; }
  ui.montarCabecalho({ titulo: 'Dados de demonstração', subtitulo: 'Clientes e serviços fictícios', voltar: true });
  const uso = repo.usoArmazenamento();
  const meta = repo.meta();
  const rotulos = { usuarios: 'Usuários', credenciais: 'Credenciais', clientes: 'Clientes', tipos: 'Tipos de serviço', equipes: 'Equipes', veiculos: 'Veículos', indisponibilidades: 'Indisponibilidades', agendamentos: 'Serviços', assinaturas: 'Assinaturas', config: 'Configuração', notificacoes: 'Notificações', auditoria: 'Auditoria', filaSync: 'Fila de sincronização', meta: 'Meta', presencas: 'Presenças' };
  const acima = uso.total > AVISO_ARMAZENAMENTO_BYTES;
  /* Nuvem (docs/NUVEM.md): só com a nuvem ligada e só para admin. "Enviar tudo" é a migração do que está neste
     aparelho para o Firestore; "Vincular login" liga um uid criado no console a uma pessoa do cadastro. */
  const nuvemLigada = dados.nuvemAtiva() && usuario.perfil === 'admin';
  const estadoNuvem = nuvemLigada ? dados.estadoNuvem() : null;
  const semLogin = nuvemLigada ? dados.usuariosAtivos().filter((p) => !p.uid) : [];
  const nuvemHTML = nuvemLigada
    ? '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Nuvem</h2></div>' +
        '<div class="cartao"><div class="cartao-titulo mb2">Enviar tudo para a nuvem</div>' +
          '<p class="cartao-sub mb3">Projeto ' + esc(estadoNuvem.projeto || '') + ', entrou como ' + esc(estadoNuvem.email || '') + '. Sobe todas as coleções deste aparelho para o Firestore (pessoas, clientes, tipos, equipes, carros, serviços, presenças, configuração, notificações e auditoria). O que já existe lá com a mesma data de alteração ou mais nova não é sobrescrito.</p>' +
          ui.botao({ rotulo: 'Enviar tudo para a nuvem', acao: 'enviar-nuvem', cls: 'btn-primario', icone: 'sincronizar' }) + '</div>' +
        '<div class="cartao"><div class="cartao-titulo mb2">Vincular login a uma pessoa</div>' +
          '<p class="cartao-sub mb3">Crie o login em Authentication no console do Firebase, copie o UID do usuário e cole aqui. Com as Cloud Functions publicadas isso acontece sozinho pelo email.</p>' +
          '<div class="campo"><label class="campo-rotulo" for="nuvem-pessoa">Pessoa</label><select class="selecao" id="nuvem-pessoa">' +
            (semLogin.length ? semLogin.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nome) + ' (' + esc(p.email || 'sem email') + ')</option>').join('') : '<option value="">Todas as pessoas já têm login</option>') +
          '</select></div>' +
          '<div class="campo"><label class="campo-rotulo" for="nuvem-uid">UID do Firebase</label><input class="entrada" id="nuvem-uid" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="28 letras e números"></div>' +
          ui.botao({ rotulo: 'Vincular login', acao: 'vincular-login', cls: 'btn-secundario', icone: 'check', desativado: !semLogin.length }) + '</div>' +
      '</section>'
    : '';
  const html =
    '<div class="dados-demo">' +
      nuvemHTML +
      '<p class="dados-demo-aviso">Os clientes, telefones, endereços e serviços desta agenda são fictícios, gerados para demonstração' + (meta.seedHoje ? ' em ' + esc(util.fmtData(meta.seedHoje)) : '') + '. A equipe (nomes e cargos) é real. ' + (nuvemLigada ? 'Com a nuvem ligada, recriar apaga só a cópia deste aparelho e baixa tudo de novo; limpar apaga também na nuvem.' : 'Tudo fica guardado só neste aparelho.') + '</p>' +
      '<div class="cartao"><div class="cartao-titulo mb2">Recriar dados de demonstração</div><p class="cartao-sub mb3">Apaga tudo, inclusive usuários e senhas, e gera o cenário inicial de novo relativo a hoje. A página recarrega.</p>' +
        ui.botao({ rotulo: 'Recriar dados de demonstração', acao: 'recriar', cls: 'btn-perigo', icone: 'sincronizar' }) + '</div>' +
      '<div class="cartao"><div class="cartao-titulo mb2">Limpar dados de demonstração</div><p class="cartao-sub mb3">Remove clientes, serviços, assinaturas, notificações, auditoria e fila. Mantém usuários, senhas, equipes, veículos, indisponibilidades, tipos e configuração.</p>' +
        ui.botao({ rotulo: 'Limpar dados de demonstração', acao: 'limpar', cls: 'btn-perigo', icone: 'lixeira' }) + '</div>' +
      '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Uso de armazenamento</h2></div>' +
        '<div class="cartao uso-armazenamento"' + (acima ? ' data-alerta' : '') + '>' +
          (acima ? '<p class="campo-aviso mb2">' + icone('alerta', 14) + '<span>Acima de 4 MB: o navegador pode recusar novas gravações. Limpe os dados de demonstração.</span></p>' : '') +
          '<div class="lista">' + dados.CHAVES.colecoes.map((c) => '<div class="item"><div class="item-corpo"><div class="item-titulo">' + esc(rotulos[c] || c) + '</div></div><span class="item-fim">' + esc(fmtBytes(uso.porColecao[c] || 0)) + '</span></div>').join('') +
          '<div class="item"><div class="item-corpo"><div class="item-titulo uso-armazenamento-total">Total</div></div><span class="item-fim uso-armazenamento-total">' + esc(fmtBytes(uso.total)) + '</span></div></div>' +
        '</div></section>' +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', async (acao, el) => {
      if (acao === 'enviar-nuvem') {
        const ok = await ui.confirmar({ titulo: 'Enviar tudo para a nuvem?', texto: 'Todas as coleções deste aparelho sobem para o Firestore. Documentos que já existem lá só são trocados se a cópia daqui for mais nova. Pode levar alguns segundos.', rotuloOk: 'Enviar', digitar: 'ENVIAR' });
        if (!ok) return;
        el.disabled = true;
        ui.toast('Enviando para a nuvem...', 'info');
        try {
          const r = await dados.enviarTudoParaNuvem((feitos, total) => ui.anunciar(feitos + ' de ' + total + ' enviados'));
          ui.toast(plural(r.enviados, 'documento enviado', 'documentos enviados') + ' para a nuvem');
        } catch (e) {
          ui.toast('Não foi possível enviar: ' + String((e && e.message) || e), 'erro', 6000);
        }
        if (document.contains(el)) el.disabled = false;
        return;
      }
      if (acao === 'vincular-login') {
        const pessoaId = (raiz.querySelector('#nuvem-pessoa') || {}).value || '';
        const uid = String((raiz.querySelector('#nuvem-uid') || {}).value || '').trim();
        if (!pessoaId || !uid) { ui.toast('Escolha a pessoa e cole o UID', 'erro'); return; }
        el.disabled = true;
        const r = await dados.vincularLoginNuvem(pessoaId, uid);
        if (document.contains(el)) el.disabled = false;
        if (r.ok) { ui.toast('Login vinculado'); telaDadosDemo(ctx); } else ui.toast(r.erro || 'Não foi possível vincular', 'erro', 6000);
        return;
      }
      if (acao === 'recriar') {
        const ok = await ui.confirmar({ titulo: 'Recriar dados de demonstração?', texto: 'Tudo o que foi alterado neste aparelho será perdido, inclusive usuários e senhas. A página recarrega ao terminar.', rotuloOk: 'Recriar', perigo: true, digitar: 'LIMPAR' });
        if (!ok) return;
        ui.toast('Recriando dados...', 'info');
        await dados.recriarDemo();
      } else if (acao === 'limpar') {
        const ok = await ui.confirmar({ titulo: 'Limpar dados de demonstração?', texto: 'Clientes, serviços, assinaturas, notificações, auditoria e fila serão apagados. Usuários, equipes, veículos, tipos e configuração ficam.', rotuloOk: 'Limpar', perigo: true, digitar: 'LIMPAR' });
        if (!ok) return;
        dados.limparDemo();
        ui.toast('Dados de demonstração limpos');
      }
    });
  });
}

/* ================================================================== */
/* Notificações (9.8)                                                  */
/* ================================================================== */

let abaNotificacoes = 'todas';
let promptInstalacao = null;
let ultimoTsNativo = Date.now();

const ABAS_NOTIF = [
  { id: 'todas', rotulo: 'Todas', tipos: null },
  { id: 'naolidas', rotulo: 'Não lidas', tipos: null },
  { id: 'agenda', rotulo: 'Agenda', tipos: ['agenda', 'status'] },
  { id: 'conflitos', rotulo: 'Conflitos', tipos: ['conflito', 'atraso'] }
];

function notifHTML(n, userId) {
  const lida = (n.lidaPor || []).includes(userId);
  const tipo = dados.TIPOS_NOTIFICACAO[n.tipo] || dados.TIPOS_NOTIFICACAO.sistema;
  const acoes = (n.acoes || []).length
    ? '<div class="notif-acoes">' + n.acoes.map((a) => '<button type="button" class="btn btn-secundario btn-pq" data-acao="notif-rota" data-id="' + esc(n.id) + '" data-rota="' + esc(a.rota) + '">' + esc(a.rotulo) + '</button>').join('') + '</div>'
    : '';
  return '<div class="notif ' + esc(tipo.classe) + (lida ? '' : ' notif-nao-lida') + '" data-notif="' + esc(n.id) + '">' +
    '<span class="notif-icone" aria-hidden="true">' + icone(tipo.icone, 18) + '</span>' +
    '<div class="notif-corpo">' +
      '<button type="button" class="notif-abrir cartao-toque" data-acao="notif-abrir" data-id="' + esc(n.id) + '" aria-label="' + esc(n.titulo + '. ' + n.texto + (lida ? '' : '. Não lida')) + '">' +
        '<div class="notif-titulo">' + esc(n.titulo) + '</div><div class="notif-texto">' + esc(n.texto) + '</div>' +
        '<div class="notif-quando">' + esc(util.tempoRelativo(n.ts)) + '\u00a0<span aria-hidden="true">·</span> ' + esc(tipo.rotulo) + '</div>' +
      '</button>' + acoes +
    '</div>' +
    (lida ? '' : '<span class="notif-nao-lida" aria-hidden="true"></span>') +
    '</div>';
}

function filtrarNotificacoes(lista, aba, userId) {
  const def = ABAS_NOTIF.find((a) => a.id === aba) || ABAS_NOTIF[0];
  if (def.id === 'naolidas') return lista.filter((n) => !(n.lidaPor || []).includes(userId));
  if (def.tipos) return lista.filter((n) => def.tipos.includes(n.tipo));
  return lista;
}

function abrirNotificacao(id, userId, rota) {
  const n = repo.obter('notificacoes', id);
  if (!n) return;
  dados.marcarLida(id, userId);
  const destino = rota || n.link;
  if (destino) ui.irPara(destino);
}

function ligarAcoesNotificacoes(raiz, userId) {
  ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
    const id = el.getAttribute('data-id');
    if (acao === 'notif-abrir') abrirNotificacao(id, userId);
    else if (acao === 'notif-rota') abrirNotificacao(id, userId, el.getAttribute('data-rota'));
    else if (acao === 'marcar-todas') { dados.marcarTodasLidas(userId); ui.toast('Todas marcadas como lidas', 'info'); }
    else if (acao === 'ver-todas') { fecharPopover(); ui.irPara('#/notificacoes'); }
  });
}

/** Tela de notificações com abas (9.8). @param {object} ctx */
export function telaNotificacoes(ctx) {
  const { alvo, usuario } = ctx;
  if (!usuario) return;
  const todas = dados.minhasNotificacoes(usuario.id);
  const naoLidas = dados.naoLidas(usuario.id);
  const cab = ui.montarCabecalho({
    titulo: 'Notificações', subtitulo: naoLidas ? plural(naoLidas, 'não lida', 'não lidas') : 'Tudo lido', semSino: true,
    acoes: naoLidas ? '<button type="button" class="btn-icone" data-acao="marcar-todas" aria-label="Marcar todas como lidas" title="Marcar todas como lidas">' + icone('checkduplo', 22) + '</button>' : ''
  });
  ligarCabecalho(cab, (acao) => { if (acao === 'marcar-todas') { dados.marcarTodasLidas(usuario.id); ui.toast('Todas marcadas como lidas', 'info'); } });
  const lista = filtrarNotificacoes(todas, abaNotificacoes, usuario.id);
  const html =
    '<div class="notificacoes">' +
      '<div class="abas" role="tablist" aria-label="Notificações">' + ABAS_NOTIF.map((a) => {
        const n = a.id === 'naolidas' ? naoLidas : 0;
        return '<button type="button" class="aba" role="tab" aria-selected="' + (a.id === abaNotificacoes ? 'true' : 'false') + '" data-acao="aba" data-valor="' + a.id + '">' + a.rotulo + (n ? '<span class="badge">' + (n > 9 ? '9+' : n) + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      (lista.length ? '<div class="notif-lista">' + lista.map((n) => notifHTML(n, usuario.id)).join('') + '</div>'
        : ui.estadoVazio({ icone: 'sino', titulo: abaNotificacoes === 'naolidas' ? 'Nada por ler' : 'Nada por aqui', texto: 'As notificações de agenda, status, conflito e atraso aparecem nesta lista.' })) +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ligarAcoesNotificacoes(raiz, usuario.id);
    ui.delegar(raiz, '[data-acao="aba"]', 'click', (acao, el) => { abaNotificacoes = el.getAttribute('data-valor') || 'todas'; telaNotificacoes(ctx); });
  });
}

let popoverAtual = null;

function fecharPopover() {
  if (!popoverAtual) return;
  const { el, remover } = popoverAtual;
  popoverAtual = null;
  remover();
  el.remove();
}

/** Popover do sino no desktop: 8 mais recentes e "Ver todas". @param {HTMLElement} ancora */
export function popoverNotificacoes(ancora) {
  const u = usuarioAtual();
  if (!u) return;
  if (popoverAtual) { fecharPopover(); return; }
  const lista = dados.minhasNotificacoes(u.id).slice(0, 8);
  const naoLidas = dados.naoLidas(u.id);
  const el = document.createElement('div');
  el.className = 'popover popover-notificacoes';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Notificações recentes');
  el.innerHTML =
    '<div class="popover-cab"><span>Notificações</span>' +
      (naoLidas ? '<button type="button" class="btn btn-fantasma btn-pq" data-acao="marcar-todas">Marcar todas como lidas</button>' : '') + '</div>' +
    (lista.length ? '<div class="notif-lista">' + lista.map((n) => notifHTML(n, u.id)).join('') + '</div>'
      : '<div class="vazio vazio-compacto"><p class="vazio-titulo">Nada por aqui</p></div>') +
    '<div class="popover-rodape"><button type="button" class="btn btn-secundario" data-acao="ver-todas">Ver todas</button></div>';
  document.body.appendChild(el);
  posicionarPopover(el, ancora);
  const aoClicarFora = (ev) => { if (!el.contains(ev.target) && !(ancora && ancora.contains(ev.target))) fecharPopover(); };
  const aoTeclar = (ev) => { if (ev.key === 'Escape') { fecharPopover(); if (ancora && ancora.focus) ancora.focus(); } };
  const aoRedimensionar = () => posicionarPopover(el, ancora);
  setTimeout(() => document.addEventListener('click', aoClicarFora), 0);
  document.addEventListener('keydown', aoTeclar);
  window.addEventListener('resize', aoRedimensionar);
  const remover = () => {
    document.removeEventListener('click', aoClicarFora);
    document.removeEventListener('keydown', aoTeclar);
    window.removeEventListener('resize', aoRedimensionar);
  };
  popoverAtual = { el, remover };
  ligarAcoesNotificacoes(el, u.id);
  const primeiro = el.querySelector('button');
  if (primeiro) primeiro.focus({ preventScroll: true });
}

function posicionarPopover(el, ancora) {
  const r = ancora && ancora.getBoundingClientRect ? ancora.getBoundingClientRect() : { right: window.innerWidth - 16, bottom: 56 };
  const largura = el.offsetWidth || 380;
  const esquerda = Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8));
  el.style.top = (r.bottom + 8 + window.scrollY) + 'px';
  el.style.left = (esquerda + window.scrollX) + 'px';
}

/* ---- Notificação nativa do aparelho (6.11) ---- */

function ligarNotificacaoNativa() {
  repo.assinar('notificacoes', () => {
    const u = usuarioAtual();
    if (!u || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!dados.aparelho().notifNativa) return;
    const novas = dados.minhasNotificacoes(u.id).filter((n) => n.ts > ultimoTsNativo && (n.tipo === 'conflito' || n.tipo === 'atraso'));
    if (!novas.length) return;
    ultimoTsNativo = Math.max(ultimoTsNativo, ...novas.map((n) => n.ts));
    for (const n of novas.slice(0, 3)) {
      try {
        const nativa = new Notification(n.titulo, { body: n.texto, tag: n.id, icon: './icone-192.png' });
        nativa.addEventListener('click', () => { window.focus(); if (n.link) ui.irPara(n.link); });
      } catch (e) { /* alguns navegadores só aceitam pelo service worker */ }
    }
  });
}

async function ligarNotifNativa(ligar) {
  if (!ligar) { dados.salvarAparelho({ notifNativa: false }); return false; }
  if (typeof Notification === 'undefined') { ui.toast('Este navegador não mostra notificações do aparelho', 'erro'); return false; }
  let permissao = Notification.permission;
  if (permissao === 'default') {
    try { permissao = await Notification.requestPermission(); } catch (e) { permissao = 'denied'; }
  }
  if (permissao !== 'granted') { ui.toast('Permissão de notificação não concedida', 'erro'); dados.salvarAparelho({ notifNativa: false }); return false; }
  dados.salvarAparelho({ notifNativa: true });
  ultimoTsNativo = Date.now();
  ui.toast('Notificações do aparelho ligadas para conflitos e atrasos');
  return true;
}

/* ================================================================== */
/* Auditoria (9.9)                                                     */
/* ================================================================== */

const PERIODOS_AUDITORIA = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['tudo', 'Tudo']];
const PAGINA_AUDITORIA = 100;
let paginaAuditoria = 1;

function registrosAuditoria(usuario, q) {
  const h = hoje();
  const periodo = q.periodo || '7';
  let deTs = 0;
  if (periodo === 'hoje') deTs = util.msDe(h, '00:00');
  else if (periodo === '7') deTs = util.msDe(util.addDias(h, -7), '00:00');
  else if (periodo === '30') deTs = util.msDe(util.addDias(h, -30), '00:00');
  const supervisor = dados.pode('auditoria', usuario) === 'setores';
  const meusSetores = new Set(usuario.setores || []);
  return repo.listar('auditoria', (l) => {
    if (l.ts < deTs) return false;
    if (q.entidade && l.entidade !== q.entidade) return false;
    if (q.id && l.entidadeId !== q.id) return false;
    if (q.usuario && l.userId !== q.usuario) return false;
    if (q.acao && l.acao !== q.acao) return false;
    if (supervisor) {
      if (l.setorId) return meusSetores.has(l.setorId);
      return l.entidade !== 'agendamento';
    }
    return true;
  }).sort((a, b) => dados.compararAuditoria(b, a));
}

function tomAuditoria(acao) {
  if (['servico_cancelado', 'servico_nao_realizado', 'login_falha', 'demo_limpa', 'demo_recriada', 'indisponibilidade_criada'].includes(acao)) return 'erro';
  if (['servico_concluido', 'liberacao_concedida', 'login', 'sincronizacao'].includes(acao)) return 'ok';
  if (['conflito_justificado', 'liberacao_pedida', 'atraso_avisado', 'servico_reagendado'].includes(acao)) return 'alerta';
  return '';
}

function camposAuditoriaHTML(campos) {
  if (!campos || !campos.length) return '';
  return '<details class="audit-campos"><summary>' + plural(campos.length, 'campo alterado', 'campos alterados') + '</summary><ul>' +
    campos.map((c) => '<li><span class="campo-nome">' + esc(c.rotulo || dados.rotuloCampo(c.campo)) + ':</span> <span class="antes">' + esc(c.antes === '' || c.antes == null ? 'vazio' : c.antes) + '</span> para <span class="depois">' + esc(c.depois === '' || c.depois == null ? 'vazio' : c.depois) + '</span></li>').join('') +
    '</ul></details>';
}

function itemAuditoriaHTML(l) {
  const u = l.userId ? dados.usuarioPorId(l.userId) : null;
  const abre = l.entidade === 'agendamento' && l.entidadeId;
  const tag = abre ? 'button' : 'div';
  const tom = tomAuditoria(l.acao);
  return '<' + tag + ' class="item audit-item' + (abre ? ' item-toque' : '') + '"' + (abre ? ' type="button" data-acao="abrir-servico" data-id="' + esc(l.entidadeId) + '"' : '') + (tom ? ' data-tom="' + tom + '"' : '') + '>' +
    '<span class="audit-quando">' + esc(util.fmtHora(l.ts)) + '<br>' + esc(util.fmtData(util.isoDe(new Date(l.ts))).slice(0, 5)) + '</span>' +
    (u ? ui.avatar(u, { tamanho: 'pq' }) : '<span class="avatar avatar-pq avatar-1" aria-hidden="true">?</span>') +
    '<span class="item-corpo"><span class="audit-acao">' + esc(dados.ACOES_AUDITORIA[l.acao] || l.acao) + ' <span class="pequeno mudo">' + esc(u ? nomeCurto(u.nome) : 'Sem usuário') + '</span></span>' +
      '<span class="audit-rotulo quebra">' + esc(ROTULO_ENTIDADE[l.entidade] || l.entidade) + ': ' + esc(l.rotulo || '') + '</span>' +
      (l.motivo ? '<span class="audit-motivo quebra">' + esc(l.motivo) + '</span>' : '') +
      camposAuditoriaHTML(l.campos) +
      (l.origem === 'fila' ? '<span class="audit-origem">Gravado offline</span>' : '') +
    '</span></' + tag + '>';
}

/** Tela de auditoria com filtros (9.9). @param {{params:object, query:{entidade?:string, id?:string, periodo?:string, usuario?:string, acao?:string}, alvo:HTMLElement, usuario:object}} ctx */
export function telaAuditoria(ctx) {
  const { query, alvo, usuario } = ctx;
  if (!dados.pode('auditoria', usuario)) { telaSemAcesso(alvo, 'Auditoria'); return; }
  const q = { periodo: query.periodo || '7', entidade: query.entidade || '', id: query.id || '', usuario: query.usuario || '', acao: query.acao || '' };
  const registros = registrosAuditoria(usuario, q);
  const visiveis = registros.slice(0, PAGINA_AUDITORIA * paginaAuditoria);
  const cab = ui.montarCabecalho({
    titulo: 'Auditoria', subtitulo: plural(registros.length, 'registro', 'registros'),
    acoes: '<button type="button" class="btn-icone" data-acao="exportar" aria-label="Exportar CSV" title="Exportar CSV"' + (registros.length ? '' : ' disabled') + '>' + icone('instalar', 22) + '</button>'
  });
  ligarCabecalho(cab, (acao) => { if (acao === 'exportar') exportarAuditoriaCSV(registros); });
  /* A opção "tudo" de cada filtro é o substantivo no plural, e não "Todas as pessoas", porque no
     celular os três selects dividem 343 px e os três apareciam cortados no mesmo "Todas a...",
     que é o contrário de dizer o que cada um filtra. "Pessoas", "Ações" e "Entidades" cabem
     inteiros em 110 px. O rótulo do campo continua existindo para o leitor de tela, e no desktop
     ele é visível (passada de crítica de 22/09/2026, lote 5). */
  const pessoas = [{ valor: '', rotulo: 'Pessoas' }].concat(repo.listar('usuarios').sort(util.porNome).map((u) => ({ valor: u.id, rotulo: u.nome })));
  const acoes = [{ valor: '', rotulo: 'Ações' }].concat(Object.keys(dados.ACOES_AUDITORIA).map((k) => ({ valor: k, rotulo: dados.ACOES_AUDITORIA[k] })));
  const entidades = [{ valor: '', rotulo: 'Entidades' }].concat(ENTIDADES_AUDITORIA.map((e) => ({ valor: e, rotulo: ROTULO_ENTIDADE[e] || e })));
  const html =
    '<div class="auditoria">' +
      '<div class="audit-filtros">' +
        '<div class="linha-chips" role="group" aria-label="Período">' + PERIODOS_AUDITORIA.map(([id, rotulo]) => '<button type="button" class="chip chip-escolha" data-acao="periodo" data-valor="' + id + '" aria-pressed="' + (q.periodo === id ? 'true' : 'false') + '"' + (q.periodo === id ? ' data-ativo' : '') + '>' + rotulo + '</button>').join('') + '</div>' +
        ui.campo({ id: 'audit-usuario', rotulo: 'Pessoa', valor: q.usuario, opcoes: pessoas, atributos: 'data-filtro="usuario"' }) +
        ui.campo({ id: 'audit-acao', rotulo: 'Ação', valor: q.acao, opcoes: acoes, atributos: 'data-filtro="acao"' }) +
        ui.campo({ id: 'audit-entidade', rotulo: 'Entidade', valor: q.entidade, opcoes: entidades, atributos: 'data-filtro="entidade"' }) +
        (q.id ? '<div class="linha-chips"><span class="chip chip-filtro">' + esc('Registro: ' + q.id) + '<button type="button" class="chip-x" data-acao="limpar-id" aria-label="Remover filtro de registro">' + icone('x', 14) + '</button></span></div>' : '') +
      '</div>' +
      (visiveis.length ? '<div class="lista lista-cartao">' + visiveis.map(itemAuditoriaHTML).join('') + '</div>'
        : ui.estadoVazio({ icone: 'historico', titulo: 'Nenhum registro', texto: 'Amplie o período ou limpe os filtros.' })) +
      (registros.length > visiveis.length ? '<div class="mt4">' + ui.botao({ rotulo: 'Mostrar mais ' + Math.min(PAGINA_AUDITORIA, registros.length - visiveis.length), acao: 'mais', cls: 'btn-secundario btn-cheio' }) + '</div>' : '') +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    const navegar = (mudancas) => {
      paginaAuditoria = 1;
      ui.irPara('#/auditoria' + ui.montarQuery(Object.assign({}, q, mudancas)), { substituir: true });
    };
    ui.delegar(raiz, '[data-filtro]', 'change', (acao, el) => { const m = {}; m[el.getAttribute('data-filtro')] = el.value; navegar(m); });
    ui.delegar(raiz, '[data-acao]', 'click', (acao, el) => {
      if (acao === 'periodo') navegar({ periodo: el.getAttribute('data-valor') });
      else if (acao === 'limpar-id') navegar({ id: '', entidade: '' });
      else if (acao === 'abrir-servico') ui.irPara('#/servico/' + el.getAttribute('data-id'));
      else if (acao === 'mais') { paginaAuditoria += 1; telaAuditoria(ctx); }
    });
  });
}

/** Gera e baixa auditoria.csv (separador ';') com os registros filtrados. @param {object[]} registros */
export function exportarAuditoriaCSV(registros) {
  const lista = registros || [];
  if (!lista.length) { ui.toast('Nada para exportar', 'info'); return; }
  const linhas = lista.map((l) => [
    util.fmtDataHora(l.ts),
    l.userId ? nomeUsuario(l.userId) : '',
    dados.ACOES_AUDITORIA[l.acao] || l.acao,
    ROTULO_ENTIDADE[l.entidade] || l.entidade,
    l.entidadeId || '',
    l.rotulo || '',
    l.motivo || '',
    (l.campos || []).map((c) => (c.rotulo || dados.rotuloCampo(c.campo)) + ': ' + (c.antes || 'vazio') + ' para ' + (c.depois || 'vazio')).join(' | '),
    l.setorId ? dados.setorPorId(l.setorId).nome : '',
    l.origem || 'online'
  ]);
  const csv = util.csvDe(['Data e hora', 'Pessoa', 'Ação', 'Entidade', 'Id', 'Registro', 'Motivo', 'Campos', 'Setor', 'Origem'], linhas);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'auditoria.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ui.toast(plural(lista.length, 'registro exportado', 'registros exportados'));
}

/* ================================================================== */
/* Conta (9.10)                                                        */
/* ================================================================== */

function ehIosSafari() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

function ehInstalado() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function cartaoSecao(titulo, corpo, cls = '') {
  return '<section class="cartao conta-secao' + (cls ? ' ' + cls : '') + '"><h2 class="secao-titulo">' + esc(titulo) + '</h2>' + corpo + '</section>';
}

function chipsOpcao(grupo, opcoes, atual) {
  return '<div class="conta-opcoes" role="group" aria-label="' + esc(grupo) + '">' + opcoes.map(([id, rotulo]) =>
    '<button type="button" class="chip chip-escolha" data-acao="' + esc(grupo) + '" data-valor="' + esc(id) + '" aria-pressed="' + (atual === id ? 'true' : 'false') + '"' + (atual === id ? ' data-ativo' : '') + '>' + esc(rotulo) + '</button>'
  ).join('') + '</div>';
}

async function instalarApp() {
  if (!promptInstalacao) return false;
  const evento = promptInstalacao;
  try {
    evento.prompt();
    const escolha = await evento.userChoice;
    if (escolha && escolha.outcome === 'accepted') { promptInstalacao = null; ui.toast('Green Agenda instalada. Procure o ícone na tela inicial.'); return true; }
    ui.toast('Instalação cancelada', 'info');
  } catch (e) {
    ui.toast('Não foi possível instalar agora', 'erro');
  }
  return false;
}

function secaoInstalarHTML() {
  if (ehInstalado()) return '';
  if (promptInstalacao) {
    return cartaoSecao('Instalar o app', '<p class="mudo mb3">Abre em tela cheia, com ícone próprio, e funciona sem conexão depois da primeira carga.</p>' + ui.botao({ rotulo: 'Instalar agora', acao: 'instalar', cls: 'btn-primario', icone: 'instalar' }));
  }
  if (ehIosSafari()) {
    return cartaoSecao('Instalar o app', '<p class="mudo mb2">No Safari, o app vai para a tela de início em dois toques:</p><ol class="conta-instalar-passos"><li>Toque em Compartilhar, o quadrado com a seta para cima.</li><li>Escolha "Adicionar à Tela de Início" e confirme.</li></ol>');
  }
  return '';
}

/** Conta (9.10): perfil, status, notificações, aparência, conexão, instalar, atalhos, sair. @param {object} ctx */
export function telaConta(ctx) {
  const { alvo, usuario } = ctx;
  if (!usuario) return;
  ui.montarCabecalho({ titulo: 'Conta', subtitulo: usuario.nome });
  const prefsNotif = Object.assign({}, PREFS_NOTIF_PADRAO, usuario.prefsNotif || {});
  const ap = dados.aparelho();
  const online = dados.conexao.online;
  const pendentes = dados.pendentesSync().length;
  const desktop = ehDesktop();
  const temaAtual = ui.tema.atual();
  const perfilHTML =
    '<div class="conta-perfil">' + ui.avatar(usuario, { tamanho: 'g', status: true }) +
      '<div class="conta-perfil-corpo"><div class="conta-perfil-nome">' + esc(usuario.nome) + '</div><div class="conta-perfil-cargo">' + esc([usuario.cargo, dados.rotuloPerfil(usuario.perfil)].filter(Boolean).join(', ')) + '</div>' +
      '<div class="conta-perfil-meta">' + dados.setoresVisiveis(usuario).slice(0, dados.pode('verTudo', usuario) ? 0 : 9).map((s) => ui.chipSetor(s.id)).join('') + (dados.pode('verTudo', usuario) ? ui.chip('Todos os setores', '', 'grade') : '') + (usuario.campo ? ui.chip('Pessoa de campo', '', 'caminhao') : '') + '</div>' +
      '<div class="conta-perfil-email">' + esc(usuario.email) + '</div></div></div>';
  const statusHTML = chipsOpcao('status', STATUS_USUARIO, usuario.status || 'disponivel') + '<p class="campo-ajuda">Ausente tira você de "em turno" nas colunas e listas.</p>';
  const notifHTMLs = Object.keys(dados.TIPOS_NOTIFICACAO).map((t) => interruptor('notif_' + t, prefsNotif[t] !== false, dados.TIPOS_NOTIFICACAO[t].rotulo)).join('') +
    interruptor('notifNativa', !!ap.notifNativa && typeof Notification !== 'undefined' && Notification.permission === 'granted', 'Notificação do aparelho', 'Conflitos e atrasos enquanto a aba está aberta');
  const aparenciaHTML =
    '<div class="campo"><span class="campo-rotulo">Tema</span>' + chipsOpcao('tema', [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']], temaAtual) + '</div>' +
    (desktop ? '<div class="campo"><span class="campo-rotulo">Densidade</span>' + chipsOpcao('densidade', [['confortavel', 'Confortável'], ['compacta', 'Compacta']], ap.densidade === 'compacta' ? 'compacta' : 'confortavel') + '</div>' : '');
  const conexaoHTML =
    '<div class="conta-conexao-estado"' + (online ? '' : ' data-offline') + '><span class="ponto-conexao" aria-hidden="true"></span>' + icone(online ? 'wifi' : 'wifioff', 18) + '<span>' + (online ? 'Online' : 'Sem conexão') + '</span></div>' +
    interruptor('forcarOffline', dados.conexao.forcadoOffline, 'Forçar modo offline', 'Simula uma visita sem sinal: tudo entra na fila') +
    '<p class="mudo mt2">' + (pendentes ? plural(pendentes, 'alteração aguardando', 'alterações aguardando') + ' envio' : 'Tudo sincronizado') + '</p>' +
    '<div class="btn-grupo mt2">' + ui.botao({ rotulo: 'Sincronizar agora', acao: 'sincronizar', cls: 'btn-secundario btn-pq', icone: 'sincronizar', desativado: !online || !pendentes }) + ui.botao({ rotulo: 'Ver fila', acao: 'ver-fila', cls: 'btn-fantasma btn-pq', icone: 'lista' }) + '</div>';
  const atalhosHTML = desktop ? cartaoSecao('Atalhos de teclado',
    interruptor('atalhos', ui.atalhos.ativos(), 'Atalhos de uma tecla', 'Letras como N e M agem quando nenhum campo de texto está em foco. Esc e Tab valem sempre.') +
    '<div class="atalhos-lista"' + (ui.atalhos.ativos() ? '' : ' data-desligados') + '>' + ui.atalhos.listar().map((a) => '<kbd class="tecla">' + esc(a.tecla) + '</kbd><span>' + esc(a.descricao) + '</span>').join('') + '</div>') : '';
  const links = [];
  if (dados.pode('auditoria', usuario)) links.push({ rota: '#/auditoria', icone: 'historico', titulo: 'Auditoria', sub: 'Quem fez o quê e quando' });
  if (dados.pode('cadastros', usuario) || dados.pode('usuarios', usuario)) links.push({ rota: '#/cadastros', icone: 'engrenagem', titulo: 'Cadastros', sub: 'Tipos, horários e usuários' });
  if (dados.pode('verRecursos', usuario)) links.push({ rota: '#/recursos/veiculos', icone: 'caminhao', titulo: 'Recursos', sub: 'Veículos, equipes e pessoas' });
  const linksHTML = links.length ? '<div class="lista lista-cartao conta-links">' + links.map((i) =>
    '<button type="button" class="item item-toque" data-acao="ui:nav" data-rota="' + esc(i.rota) + '"><span class="item-icone">' + icone(i.icone, 20) + '</span><div class="item-corpo"><div class="item-titulo">' + esc(i.titulo) + '</div><div class="item-sub">' + esc(i.sub) + '</div></div><span class="item-fim">' + icone('direita', 18) + '</span></button>'
  ).join('') + '</div>' : '';
  const html =
    '<div class="conta"><div class="conta-colunas"><div>' +
      cartaoSecao('Perfil', perfilHTML) +
      cartaoSecao('Meu status', '<div class="conta-status">' + statusHTML + '</div>') +
      cartaoSecao('Notificações', notifHTMLs) +
    '</div><div>' +
      cartaoSecao('Aparência', aparenciaHTML) +
      cartaoSecao('Conexão e sincronização', conexaoHTML) +
      secaoInstalarHTML() +
      atalhosHTML +
      linksHTML +
    '</div></div>' +
      '<div class="conta-sair">' + ui.botao({ rotulo: 'Sair', acao: 'sair', cls: 'btn-perigo btn-cheio', icone: 'sair' }) + '</div>' +
      '<p class="conta-versao">Green Agenda ' + esc(VERSAO_APP) + '</p>' +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-campo]', 'change', async (acao, el) => {
      const campo = el.getAttribute('data-campo');
      if (campo.startsWith('notif_')) {
        const tipo = campo.slice(6);
        const novas = Object.assign({}, prefsNotif);
        novas[tipo] = !!el.checked;
        repo.atualizar('usuarios', usuario.id, { prefsNotif: novas });
      } else if (campo === 'notifNativa') {
        const ok = await ligarNotifNativa(!!el.checked);
        el.checked = ok;
      } else if (campo === 'atalhos') {
        ui.atalhos.ativar(!!el.checked);
        ui.toast(el.checked ? 'Atalhos de uma tecla ligados' : 'Atalhos de uma tecla desligados. Esc e Tab continuam valendo', 'info');
        telaConta(ctx);
      } else if (campo === 'forcarOffline') {
        dados.conexao.forcarOffline(!!el.checked);
        ui.toast(el.checked ? 'Modo offline forçado: as alterações ficam na fila' : 'Conexão restabelecida', 'info');
        telaConta(ctx);
      }
    });
    ui.delegar(raiz, '[data-acao]', 'click', async (acao, el) => {
      const valor = el.getAttribute('data-valor');
      switch (acao) {
        case 'status':
          if (STATUS_USUARIO.some(([id]) => id === valor) && valor !== usuario.status) {
            repo.atualizar('usuarios', usuario.id, { status: valor });
            ui.toast('Status: ' + STATUS_USUARIO.find(([id]) => id === valor)[1]);
          }
          break;
        case 'tema': ui.tema.aplicar(valor); telaConta(ctx); break;
        case 'densidade': ui.tema.densidade(valor); telaConta(ctx); break;
        case 'sincronizar': {
          const r = await dados.sincronizar();
          if (r && r.enviadas > 0) ui.toast(plural(r.enviadas, 'alteração sincronizada', 'alterações sincronizadas'));
          else ui.toast('Nada para sincronizar', 'info');
          break;
        }
        case 'ver-fila': ui.irPara('#/sincronizacao'); break;
        case 'instalar': { const ok = await instalarApp(); if (ok) telaConta(ctx); break; }
        case 'sair': {
          const ok = await ui.confirmar({ titulo: 'Sair da conta?', texto: pendentes ? plural(pendentes, 'alteração ainda aguarda', 'alterações ainda aguardam') + ' envio. Elas ficam guardadas no aparelho.' : 'Você volta para a tela de entrada.', rotuloOk: 'Sair', perigo: true });
          if (!ok) return;
          dados.sessao.sair();
          ui.irPara('#/entrar', { substituir: true });
          break;
        }
        default: break;
      }
    });
  });
}

/* ================================================================== */
/* Sincronização (9.11)                                                */
/* ================================================================== */

function rotuloFila(f) {
  const p = f.payload || {};
  const entidade = ROTULO_ENTIDADE[f.entidade] || f.entidade;
  let rotulo = '';
  switch (f.entidade) {
    case 'agendamentos': {
      const a = dados.agendamentoPorId(f.entidadeId) || p;
      rotulo = a && a.tipoId ? tituloServico(a) + (a.data ? ', ' + util.fmtData(a.data).slice(0, 5) + ' ' + (a.horaInicio || '') : '') : '';
      break;
    }
    case 'clientes': rotulo = p.nome || (dados.clientePorId(f.entidadeId) || {}).nome || ''; break;
    case 'veiculos': rotulo = p.nome || apelidoVeiculo(dados.veiculoPorId(f.entidadeId)); break;
    case 'equipes': rotulo = p.nome || apelidoEquipe(dados.equipePorId(f.entidadeId)); break;
    case 'usuarios': case 'credenciais': rotulo = p.nome || nomeUsuario(f.entidadeId) || ''; break;
    case 'tipos': rotulo = p.nome || (dados.tipoPorId(f.entidadeId) || {}).nome || ''; break;
    case 'indisponibilidades': rotulo = p.veiculoId ? apelidoVeiculo(dados.veiculoPorId(p.veiculoId)) + (p.de ? ', ' + periodoIndisponibilidade(p) : '') : ''; break;
    case 'config': rotulo = 'Horários e loja'; break;
    default: rotulo = f.entidadeId || ''; break;
  }
  return entidade + (rotulo ? ': ' + rotulo : '');
}

const ROTULO_ESTADO_FILA = { pendente: 'Pendente', enviando: 'Enviando', enviada: 'Enviada', erro: 'Erro' };

/** Fila de sincronização (9.11). @param {object} ctx */
export function telaSincronizacao(ctx) {
  const { alvo, usuario } = ctx;
  if (!usuario) return;
  ui.montarCabecalho({ titulo: 'Sincronização', subtitulo: 'Fila de envio deste aparelho', voltar: true });
  const fila = dados.pendentesSync();
  const online = dados.conexao.online;
  const gestao = dados.ehGestao(usuario);
  const html =
    '<div class="sincronizacao">' +
      '<div class="cartao"><div class="conta-conexao-estado"' + (online ? '' : ' data-offline') + '><span class="ponto-conexao" aria-hidden="true"></span>' + icone(online ? 'wifi' : 'wifioff', 18) + '<span>' + (online ? 'Online' : 'Sem conexão') + '</span></div>' +
        '<p class="mudo mt2">' + (online ? 'As alterações são enviadas assim que entram na fila.' : 'Continue trabalhando: tudo fica guardado no aparelho e sobe quando a conexão voltar.') + '</p>' +
        '<div class="sincronizacao-acoes">' + ui.botao({ rotulo: 'Sincronizar agora', acao: 'sincronizar', cls: 'btn-primario', icone: 'sincronizar', desativado: !online || !fila.length }) + '</div></div>' +
      (fila.length
        ? '<section class="secao"><div class="secao-cab"><h2 class="secao-titulo">Aguardando envio</h2><span class="mudo">' + plural(fila.length, 'operação', 'operações') + '</span></div>' +
          '<div class="lista lista-cartao">' + fila.map((f) => {
            const podeDescartar = gestao || f.userId === usuario.id;
            return '<div class="item fila-item" data-fila="' + esc(f.id) + '">' +
              '<div class="item-corpo"><div class="fila-op">' + esc(ROTULO_OP_FILA[f.op] || f.op) + '</div><div class="item-sub quebra">' + esc(rotuloFila(f)) + '</div>' +
              '<div class="fila-meta"><span>' + esc(util.tempoRelativo(f.ts)) + '</span><span>' + esc(f.userId ? nomeCurtoDe(f.userId) : 'Sem usuário') + '</span><span>' + plural(f.tentativas || 0, 'tentativa', 'tentativas') + '</span>' +
              '<span class="fila-estado" data-estado="' + esc(f.estado) + '">' + esc(ROTULO_ESTADO_FILA[f.estado] || f.estado) + '</span></div></div>' +
              (podeDescartar && f.estado !== 'enviando' ? '<div class="item-fim">' + ui.botao({ rotulo: 'Descartar', acao: 'descartar', valor: f.id, cls: 'btn-fantasma btn-pq', icone: 'lixeira' }) + '</div>' : '') +
              '</div>';
          }).join('') + '</div></section>'
        : ui.estadoVazio({ icone: 'checkduplo', titulo: 'Tudo sincronizado', texto: 'Nenhuma alteração aguardando envio neste aparelho.' })) +
    '</div>';
  ui.renderizar(alvo, html, (raiz) => {
    ui.delegar(raiz, '[data-acao]', 'click', async (acao, el) => {
      if (acao === 'sincronizar') {
        const r = await dados.sincronizar();
        if (r && r.enviadas > 0) ui.toast(plural(r.enviadas, 'alteração sincronizada', 'alterações sincronizadas'));
        else ui.toast(online ? 'Nada para sincronizar' : 'Sem conexão: a fila espera', 'info');
      } else if (acao === 'descartar') {
        const id = el.getAttribute('data-valor');
        const f = fila.find((x) => x.id === id);
        if (!f) return;
        if (!(gestao || f.userId === usuario.id)) { ui.toast('Só quem fez a alteração ou a gestão pode descartar', 'erro'); return; }
        const ok = await ui.confirmar({ titulo: 'Descartar da fila?', texto: 'A alteração continua gravada neste aparelho, mas não será enviada. ' + rotuloFila(f) + '.', rotuloOk: 'Descartar', perigo: true });
        if (!ok) return;
        dados.descartarSync(id);
        ui.toast('Operação descartada da fila', 'info');
      }
    });
  });
}
