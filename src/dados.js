/* Green Agenda, módulo dados: src/dados.js
   Constantes de domínio (contrato), repositório e persistência isolada,
   migração, sessão e credenciais, permissões e visibilidade, lookups,
   auditoria, notificação, presenças do dia (esquema 4, DIRECAO-3 seção 2),
   fila de sync, preferências e controle dos dados de demonstração.
   Este é o ÚNICO arquivo que toca localStorage e sessionStorage.
   Ver ESPECIFICACAO.md, seções 2, 4, 5, 6.11 e 6.12.

   Nuvem (docs/NUVEM.md): com `ativo: true` em src/config-nuvem.js, este
   repositório continua sendo a fonte síncrona das telas e passa a REPLICAR:
   a fila de sync vira fila de saída de verdade (src/nuvem.js grava no
   Firestore), as escutas do Firestore entram por repo.aplicarRemoto e a
   sessão é do Firebase Auth. Com `ativo: false` nada disso é carregado. */

import * as util from './util.js';
import { gerarSeed, veiculoStrada, tipoLoja, equipeOficial, SENHA_DEMO } from './seed.js';
import * as nuvem from './nuvem.js';

/* ------------------------------------------------------------------ */
/* Constantes de domínio (contrato; podem ser importadas já)           */
/* ------------------------------------------------------------------ */

/* 4 desde 24/09/2026 (docs/redesign/DIRECAO-3.md, seção 2): coleção `presencas` (onde cada pessoa está no dia), apelidos e
   conta compartilhada em usuários, `responsavelTexto` em agendamentos e `config.locais` (loja e galpão).
   3 desde 22/09/2026 (docs/redesign/DIRECAO-2.md, seção 2): período e campos livres nos agendamentos, Strada e tipo "Loja". */
export const VERSAO_ESQUEMA = 5;

/** Chaves de armazenamento. Prefixo único para limpar tudo com segurança. `presencas` entrou por último na v4: a ordem é usada para limpar e recriar. */
export const CHAVES = {
  prefixo: 'ga_v1_',
  colecoes: ['usuarios', 'credenciais', 'clientes', 'tipos', 'equipes', 'veiculos', 'indisponibilidades', 'agendamentos', 'assinaturas', 'config', 'notificacoes', 'auditoria', 'filaSync', 'meta', 'presencas'],
  sessao: 'ga_sessao',
  prefs: 'ga_prefs_',
  aparelho: 'ga_aparelho'
};

export const PERFIS = {
  admin: { rotulo: 'Administrador', caps: { verTudo: 1, criarServico: 1, editarServico: 1, reagendar: 1, cancelar: 1, confirmar: 1, statusCampo: 1, alocarRecursos: 1, justificarConflito: 1, liberarConflito: 1, reabrir: 1, avisarAtraso: 1, checklist: 1, reordenarRota: 1, verRecursos: 1, editarRecursos: 1, cadastros: 1, usuarios: 1, auditoria: 1, dadosDemo: 1 } },
  diretor: { rotulo: 'Diretor', caps: { verTudo: 1, criarServico: 1, editarServico: 1, reagendar: 1, cancelar: 1, confirmar: 1, statusCampo: 1, alocarRecursos: 1, justificarConflito: 1, liberarConflito: 1, reabrir: 1, avisarAtraso: 1, checklist: 1, reordenarRota: 1, verRecursos: 1, editarRecursos: 1, cadastros: 1, auditoria: 1 } },
  gerente: { rotulo: 'Gerente', caps: { verTudo: 1, criarServico: 1, editarServico: 1, reagendar: 1, cancelar: 1, confirmar: 1, statusCampo: 1, alocarRecursos: 1, justificarConflito: 1, liberarConflito: 1, reabrir: 1, avisarAtraso: 1, checklist: 1, reordenarRota: 1, verRecursos: 1, editarRecursos: 1, cadastros: 1, auditoria: 1 } },
  supervisor: { rotulo: 'Supervisor de setor', caps: { verSetores: 1, criarServico: 1, editarServico: 1, reagendar: 1, cancelar: 1, confirmar: 1, statusCampo: 1, alocarRecursos: 1, pedirLiberacao: 1, avisarAtraso: 1, checklist: 1, reordenarRota: 1, verRecursos: 1, editarRecursos: 'indisponibilidade', auditoria: 'setores' } },
  atendente: { rotulo: 'Atendimento e vendas', caps: { verSetores: 1, criarServico: 1, editarServico: 'ateConfirmado', reagendar: 'ateConfirmado', cancelar: 'ateConfirmado', confirmar: 1, alocarRecursos: 1, pedirLiberacao: 1, avisarAtraso: 1, checklist: 1 } },
  /* Financeiro e administrativo (equipe oficial, 25/09/2026): as mesmas capacidades do atendimento, nos setores da pessoa.
     É perfil próprio para a tela de entrar e os cadastros dizerem quem é do escritório, não para mudar permissão. */
  financeiro: { rotulo: 'Financeiro e administrativo', caps: { verSetores: 1, criarServico: 1, editarServico: 'ateConfirmado', reagendar: 'ateConfirmado', cancelar: 'ateConfirmado', confirmar: 1, alocarRecursos: 1, pedirLiberacao: 1, avisarAtraso: 1, checklist: 1 } },
  /* criarServico 'proprios' (DIRECAO-2 2.5): o campo registra o que ele mesmo vai fazer. Só origem diferente de 'loja' e com ele
     mesmo em responsaveis; a validação mora em salvarServico (agendamento.js) e em capNoServico (regras.js). */
  campo: { rotulo: 'Entrega e instalação', caps: { verSoMeus: 1, criarServico: 'proprios', statusCampo: 'meus', avisarAtraso: 'meus', checklist: 'meus', reordenarRota: 'propria' } }
};

export const SETORES = [
  { id: 'dec', nome: 'Decoração', icone: 'planta' },
  { id: 'mov', nome: 'Móveis', icone: 'sofa' },
  { id: 'flo', nome: 'Floricultura', icone: 'flor' },
  { id: 'pai', nome: 'Paisagismo e Jardins', icone: 'broto' },
  { id: 'cor', nome: 'Cortinas e Persianas', icone: 'cortina' },
  { id: 'ent', nome: 'Entrega e Instalação', icone: 'caminhao' },
  { id: 'pos', nome: 'Pós-venda e Assistência', icone: 'ferramenta' },
  { id: 'com', nome: 'Comercial e Vendas', icone: 'nota' },
  { id: 'fin', nome: 'Financeiro', icone: 'escudo' }
];

export const STATUS = {
  aguardando_conf: { id: 'aguardando_conf', rotulo: 'Aguardando confirmação', rotuloAcao: 'Confirmar', verboCampo: null, icone: 'relogio', classe: 'status-aguardando' },
  confirmado: { id: 'confirmado', rotulo: 'Confirmado', rotuloAcao: 'A caminho', verboCampo: 'Saí para o serviço', icone: 'check', classe: 'status-confirmado' },
  a_caminho: { id: 'a_caminho', rotulo: 'A caminho', rotuloAcao: 'Iniciar', verboCampo: 'Cheguei, comecei', icone: 'caminhao', classe: 'status-a-caminho' },
  em_andamento: { id: 'em_andamento', rotulo: 'Em andamento', rotuloAcao: 'Concluir', verboCampo: 'Terminei', icone: 'play', classe: 'status-em-andamento' },
  concluido: { id: 'concluido', rotulo: 'Concluído', rotuloAcao: null, verboCampo: null, icone: 'checkduplo', classe: 'status-concluido' },
  reagendado: { id: 'reagendado', rotulo: 'Reagendado', rotuloAcao: 'Confirmar', verboCampo: null, icone: 'sincronizar', classe: 'status-reagendado' },
  cancelado: { id: 'cancelado', rotulo: 'Cancelado', rotuloAcao: null, verboCampo: null, icone: 'ban', classe: 'status-cancelado' },
  nao_realizado: { id: 'nao_realizado', rotulo: 'Não realizado', rotuloAcao: null, verboCampo: null, icone: 'alerta', classe: 'status-nao-realizado' }
};
/* rotuloAcao é o rótulo do botão de próximo passo para gestão e atendente
   (o que o botão FAZ a partir deste status); verboCampo é o mesmo botão para
   o perfil campo. */

export const STATUS_ATIVOS = ['aguardando_conf', 'confirmado', 'a_caminho', 'em_andamento', 'reagendado'];
export const STATUS_FINAIS = ['concluido', 'cancelado', 'nao_realizado'];

/**
 * Status enxuto (DIRECAO-2 2.4 e 6.1): os oito internos continuam em STATUS e em regras.TRANSICOES; isto é só exibição.
 * Os quatro primeiros são os que o grupo tem (o "não marcado" do grupo é o Agendado). `cancelado` é o quinto rótulo,
 * só de exibição, nunca opção de um toque: cancelar antes e não realizar no local são coisas diferentes.
 */
export const STATUS_SIMPLES = {
  agendado: { rotulo: 'Agendado', classe: 'status-confirmado', inclui: ['aguardando_conf', 'confirmado', 'reagendado'] },
  em_andamento: { rotulo: 'Em andamento', classe: 'status-em-andamento', inclui: ['a_caminho', 'em_andamento'] },
  concluido: { rotulo: 'Concluído', classe: 'status-concluido', inclui: ['concluido'] },
  nao_realizado: { rotulo: 'Não realizado', classe: 'status-nao-realizado', inclui: ['nao_realizado'] },
  cancelado: { rotulo: 'Cancelado', classe: 'status-cancelado', inclui: ['cancelado'] }
};

/** Os quatro que o colaborador vê e toca, na ordem do grupo. Cancelado fica fora do seletor. */
export const STATUS_SIMPLES_TOQUE = ['agendado', 'em_andamento', 'concluido', 'nao_realizado'];

/** @param {string} status interno @returns {string} chave de STATUS_SIMPLES ('agendado' para desconhecido) */
export function statusSimples(status) {
  for (const chave of Object.keys(STATUS_SIMPLES)) if (STATUS_SIMPLES[chave].inclui.includes(status)) return chave;
  return 'agendado';
}

/** @param {string} status interno @returns {string} rótulo simples ("Agendado", "Em andamento", ...) */
export function rotuloSimples(status) {
  return STATUS_SIMPLES[statusSimples(status)].rotulo;
}

/**
 * Os períodos do grupo (DIRECAO-2 2.2 e 2.3). A interface mostra o rótulo; o dado guarda horaInicio e horaFim derivadas
 * das faixas do dia (regras.horasDoPeriodo) e horaAproximada verdadeiro em tudo que não é hora exata.
 */
export const PERIODOS = {
  manha: { id: 'manha', rotulo: 'Manhã', curto: 'manhã' },
  tarde: { id: 'tarde', rotulo: 'Tarde', curto: 'tarde' },
  dia: { id: 'dia', rotulo: 'Dia todo', curto: 'dia todo' },
  hora: { id: 'hora', rotulo: 'Hora exata', curto: 'hora exata' }
};

/** Origem do documento (DIRECAO-2 2.1): quanto dele é obrigatório. */
export const ORIGENS = {
  app: { rotulo: 'Registro no app' },
  whatsapp: { rotulo: 'Colado do WhatsApp' },
  loja: { rotulo: 'Despacho da loja' }
};

export const MOTIVOS_REAGENDAMENTO = [
  { id: 'cliente_pediu', rotulo: 'Cliente pediu' },
  { id: 'produto_nao_chegou', rotulo: 'Produto não chegou' },
  { id: 'chuva', rotulo: 'Chuva' },
  { id: 'equipe_indisponivel', rotulo: 'Equipe indisponível' },
  { id: 'veiculo_indisponivel', rotulo: 'Veículo indisponível' },
  { id: 'outro', rotulo: 'Outro' }
];
export const MOTIVOS_CANCELAMENTO = [
  { id: 'cliente_desistiu', rotulo: 'Cliente desistiu' },
  { id: 'venda_cancelada', rotulo: 'Venda cancelada' },
  { id: 'duplicado', rotulo: 'Duplicado' },
  { id: 'outro', rotulo: 'Outro' }
];
export const MOTIVOS_NAO_REALIZADO = [
  { id: 'cliente_ausente', rotulo: 'Cliente ausente' },
  { id: 'endereco_errado', rotulo: 'Endereço errado' },
  { id: 'produto_defeito', rotulo: 'Produto com defeito ou não coube' },
  { id: 'chuva', rotulo: 'Chuva' },
  { id: 'sem_acesso', rotulo: 'Sem acesso' },
  { id: 'veiculo_quebrou', rotulo: 'Veículo quebrou' },
  { id: 'outro', rotulo: 'Outro' }
];
export const MOTIVOS_INDISPONIBILIDADE = [
  { id: 'revisao', rotulo: 'Revisão' },
  { id: 'oficina', rotulo: 'Oficina' },
  { id: 'documentacao', rotulo: 'Multa ou documentação' },
  { id: 'emprestado', rotulo: 'Emprestado' },
  { id: 'outro', rotulo: 'Outro' }
];

export const TIPOS_NOTIFICACAO = {
  agenda: { rotulo: 'Agenda', icone: 'calendario', classe: 'notif-agenda' },
  status: { rotulo: 'Status dos serviços', icone: 'play', classe: 'notif-status' },
  conflito: { rotulo: 'Conflitos', icone: 'alerta', classe: 'notif-conflito' },
  atraso: { rotulo: 'Atrasos', icone: 'relogio', classe: 'notif-atraso' },
  sistema: { rotulo: 'Sistema', icone: 'sincronizar', classe: 'notif-sistema' }
};

export const ACOES_AUDITORIA = {
  servico_criado: 'Serviço criado', servico_editado: 'Serviço editado', servico_reagendado: 'Reagendado',
  servico_cancelado: 'Cancelado', servico_nao_realizado: 'Não realizado', servico_concluido: 'Concluído',
  servico_reaberto: 'Reaberto', servico_duplicado: 'Duplicado', status_alterado: 'Status alterado',
  status_desfeito: 'Status desfeito', checklist_alterado: 'Checklist', conflito_justificado: 'Conflito justificado',
  liberacao_pedida: 'Liberação pedida', liberacao_concedida: 'Liberação concedida', atraso_avisado: 'Atraso avisado',
  rota_reordenada: 'Rota reordenada', veiculo_criado: 'Veículo criado', veiculo_editado: 'Veículo editado',
  indisponibilidade_criada: 'Indisponibilidade criada', indisponibilidade_removida: 'Indisponibilidade removida',
  equipe_criada: 'Equipe criada', equipe_editada: 'Equipe editada', tipo_criado: 'Tipo de serviço criado',
  tipo_editado: 'Tipo de serviço editado', horarios_editados: 'Horários e loja editados',
  usuario_criado: 'Usuário criado', usuario_editado: 'Usuário editado', senha_alterada: 'Senha alterada',
  login: 'Entrou', login_falha: 'Tentativa de acesso', logout: 'Saiu', sincronizacao: 'Sincronização',
  demo_recriada: 'Dados de demonstração recriados', demo_limpa: 'Dados de demonstração limpos',
  mensagem_preparada: 'Mensagem preparada', disponibilidade_editada: 'Disponibilidade editada',
  excecao_criada: 'Data específica criada', excecao_removida: 'Data específica removida',
  registro_rapido: 'Registro rápido', registro_colado: 'Registro colado do WhatsApp', mensagem_copiada: 'Mensagem copiada para o grupo',
  presenca_marcada: 'Presença marcada', presenca_corrigida: 'Presença corrigida'
};

/* ---- Esquema v4: presença do dia (docs/redesign/DIRECAO-3.md, seção 2) ---- */

/**
 * Os lugares onde uma pessoa pode estar (2.1), na ordem da interface. `servico` nunca é gravado: é derivado de um registro
 * em andamento ou a caminho (regras.presencaEfetiva). `classe` é o token de cor da barra, para o CSS; `botao` diz se o
 * lugar é um dos cinco botões grandes da faixa "Onde estou" (o "Outro" é o escape com texto). Rótulo em `curto` para o
 * texto corrido ("desde 08:28 no galpão") e em `rotulo` para o botão e o título de grupo.
 */
export const LUGARES = [
  { id: 'loja', rotulo: 'Na loja', curto: 'na loja', icone: 'loja', classe: 'set-mov', botao: true, gravavel: true },
  { id: 'galpao', rotulo: 'No galpão', curto: 'no galpão', icone: 'galpao', classe: 'set-ent', botao: true, gravavel: true },
  { id: 'servico', rotulo: 'Em serviço', curto: 'em serviço', icone: 'play', classe: 'st-em-andamento', botao: false, gravavel: false },
  { id: 'rua', rotulo: 'Na rua', curto: 'na rua', icone: 'caminhao', classe: 'set-cor', botao: true, gravavel: true },
  { id: 'folga', rotulo: 'Folga', curto: 'de folga', icone: 'casa', classe: '', botao: true, gravavel: true },
  { id: 'outro', rotulo: 'Outro lugar', curto: 'em outro lugar', icone: 'info', classe: 'info', botao: false, gravavel: true }
];

/** Tamanho máximo do texto livre de "Outro lugar" (2.3). */
export const LUGAR_TEXTO_MAX = 40;

/** Origens de uma presença gravada. `escala` só aparece no resultado de regras.presencaEfetiva, nunca no documento. */
export const ORIGENS_PRESENCA = { app: 'Marcado no app', whatsapp: 'Lido do grupo', automatico: 'Pelo registro do dia', escala: 'Pela escala' };

/** @param {string} id @returns {object} item de LUGARES, ou o "Outro lugar" para id desconhecido */
export function lugarPorId(id) {
  return LUGARES.find((l) => l.id === id) || LUGARES[LUGARES.length - 1];
}

/** "No galpão", o texto livre de "Outro lugar", ou "Outro lugar". @param {{lugar?:string, lugarTexto?:string}} p @returns {string} */
export function nomeDoLugar(p) {
  if (!p) return '';
  const texto = String(p.lugarTexto || '').trim();
  if (p.lugar === 'outro' || !LUGARES.some((l) => l.id === p.lugar)) return texto || 'Outro lugar';
  return lugarPorId(p.lugar).rotulo;
}

/* ---- Esquema v2: faixas de horário, exceções por data, regras de agendamento (docs/redesign/DIRECAO.md, 5.2) ---- */

/** Modelos de mensagem ao cliente (DIRECAO 4.9). Variáveis: {cliente} {tipo} {data} {hora} {carro} {equipe} {loja}. */
export const MENSAGENS_PADRAO = {
  confirmacao: 'Oi {cliente}, aqui é da Green. Ficou agendado: {tipo}, {data}, às {hora}. Qualquer coisa é só chamar por aqui.',
  lembrete: 'Oi {cliente}, passando para confirmar: amanhã, {data}, às {hora}, a equipe da Green vai até você para {tipo}. Está de pé?',
  reagendamento: 'Oi {cliente}, precisamos remarcar o serviço de {tipo}. Ficou para {data}, às {hora}. Tudo bem assim?',
  cancelamento: 'Oi {cliente}, o serviço de {tipo} de {data} foi cancelado. Qualquer dúvida é só chamar.',
  pos: 'Oi {cliente}, serviço concluído. Qualquer coisa a gente resolve, é só chamar.'
};

/** Textos de fábrica anteriores (com "Seu(sua)" e "o(a)"). Config que ainda guarda um deles, sem edição, lê o modelo novo. */
export const MENSAGENS_ANTIGAS = {
  confirmacao: 'Oi {cliente}, aqui é da Green. Seu(sua) {tipo} está agendado para {data}, às {hora}. Qualquer coisa é só chamar por aqui.',
  reagendamento: 'Oi {cliente}, precisamos remarcar o(a) {tipo}. Ficou para {data}, às {hora}. Tudo bem assim?',
  cancelamento: 'Oi {cliente}, o(a) {tipo} de {data} foi cancelado. Qualquer dúvida é só chamar.'
};

/** Valores de partida dos campos de config que nasceram na v2. Usados pela migração, pelo seed e como recuo em regras.js. */
export const CONFIG_V2_PADRAO = { folgaAntesMin: 0, folgaDepoisMin: 30, antecedenciaMinMin: 120, janelaDias: 90, rodizio: 'menos_servicos' };

/** Campos que todo tipo de serviço ganha na v2. null herda de config. `duracoes` é preenchido à parte. */
export const TIPO_V2_PADRAO = { folgaAntesMin: null, folgaDepoisMin: null, antecedenciaMinMin: null, janelaDias: null, limiteDia: null, incrementoMin: null, cor: null };

const DIAS_HORARIO = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const minDe = (hora) => util.horaParaMin(hora);
const faixaValida = (f) => !!f && typeof f.de === 'string' && typeof f.ate === 'string' && minDe(f.de) < minDe(f.ate);

/**
 * Normaliza o horário de um dia para o formato v2: array de faixas {de, ate} em ordem, sem sobreposição, ou null (fechado).
 * Aceita o formato v1 ({de, ate}); nesse caso, se `almoco` cabe inteiro dentro da faixa, quebra em duas.
 * @param {object|object[]|null} valor @param {{de:string, ate:string}|null} [almoco] @returns {{de:string, ate:string}[]|null}
 */
export function normalizarFaixas(valor, almoco) {
  if (!valor) return null;
  let faixas;
  if (Array.isArray(valor)) {
    faixas = valor.filter(faixaValida).map((f) => ({ de: f.de, ate: f.ate }));
  } else if (faixaValida(valor)) {
    const cabe = faixaValida(almoco) && minDe(almoco.de) > minDe(valor.de) && minDe(almoco.ate) < minDe(valor.ate);
    faixas = cabe ? [{ de: valor.de, ate: almoco.de }, { de: almoco.ate, ate: valor.ate }] : [{ de: valor.de, ate: valor.ate }];
  } else {
    return null;
  }
  faixas.sort((a, b) => minDe(a.de) - minDe(b.de) || minDe(a.ate) - minDe(b.ate));
  const saida = [];
  for (const f of faixas) {
    const ultima = saida[saida.length - 1];
    if (ultima && minDe(f.de) <= minDe(ultima.ate)) { if (minDe(f.ate) > minDe(ultima.ate)) ultima.ate = f.ate; } else saida.push(f);
  }
  return saida.length ? saida : null;
}

/** Mapa de horário por dia da semana (loja ou carro) normalizado para faixas. @param {object|null} horario @param {object|null} [almoco] @returns {object|null} */
export function normalizarHorario(horario, almoco) {
  if (!horario || typeof horario !== 'object') return null;
  const saida = {};
  for (const dia of DIAS_HORARIO) saida[dia] = normalizarFaixas(horario[dia], almoco);
  return saida;
}

/** Primeiro vão entre duas faixas, na ordem seg a dom: é o "almoço" que as telas da v1 ainda leem. */
function almocoDerivado(horario) {
  for (const dia of DIAS_HORARIO) {
    const faixas = (horario || {})[dia];
    if (Array.isArray(faixas) && faixas.length >= 2) return { de: faixas[0].ate, ate: faixas[1].de };
  }
  return null;
}

/**
 * Visão de leitura da config. O dado gravado é v2 puro (array de faixas, sem `almoco`). Enquanto telas da v1
 * (recursos.telaHorarios, grade.almocoHTML) ainda leem o formato antigo, cada array de faixas devolvido aqui leva
 * também as propriedades `de` e `ate` da união do dia, e `almoco` vem derivado do primeiro vão. As duas coisas são
 * só de leitura: não entram no JSON (propriedade extra de array não é serializada) e `salvarConfig` nunca grava `almoco`.
 */
function configParaLeitura(doc) {
  if (!doc) return {};
  const c = Object.assign({}, doc);
  if (c.horario && typeof c.horario === 'object') {
    const horario = {};
    for (const dia of Object.keys(c.horario)) {
      const faixas = normalizarFaixas(c.horario[dia], doc.almoco);
      horario[dia] = faixas ? Object.assign(faixas, { de: faixas[0].de, ate: faixas[faixas.length - 1].ate }) : null;
    }
    c.horario = horario;
    if (c.almoco === undefined) c.almoco = almocoDerivado(horario);
  }
  return c;
}

/** Mudanças de config vindas de qualquer tela, convertidas para o formato v2 antes de gravar. */
function configParaGravar(mudancas, atual) {
  const m = Object.assign({}, mudancas || {});
  if (m.horario && typeof m.horario === 'object') {
    /* Tela da v1 manda {de, ate} por dia mais `almoco`; tela da v2 manda arrays e nenhum `almoco`. */
    const almoco = m.almoco !== undefined ? m.almoco : null;
    const horario = {};
    for (const dia of Object.keys(m.horario)) horario[dia] = normalizarFaixas(m.horario[dia], almoco);
    m.horario = horario;
  } else if (m.almoco !== undefined && atual && atual.horario) {
    /* Só o almoço mudou (v1): refaz as faixas a partir da união de cada dia. */
    const horario = {};
    for (const dia of Object.keys(atual.horario)) {
      const faixas = normalizarFaixas(atual.horario[dia], null);
      horario[dia] = faixas ? normalizarFaixas({ de: faixas[0].de, ate: faixas[faixas.length - 1].ate }, m.almoco) : null;
    }
    m.horario = horario;
  }
  delete m.almoco;
  /* A tela da v1 só conhece folgaDeslocamentoMin: quando ela muda sozinha, a folga depois acompanha. */
  if (m.folgaDeslocamentoMin != null && m.folgaDepoisMin === undefined && (!atual || m.folgaDeslocamentoMin !== atual.folgaDeslocamentoMin)) {
    m.folgaDepoisMin = m.folgaDeslocamentoMin;
  }
  if (Array.isArray(m.feriados)) {
    const antes = new Map(((atual && atual.feriados) || []).map((f) => [f.data, f]));
    m.feriados = m.feriados.map((f) => Object.assign({}, f, { ativo: f.ativo !== undefined ? f.ativo !== false : !(antes.has(f.data) && antes.get(f.data).ativo === false) }));
  }
  return m;
}

function migrarConfigV1(config) {
  if (!config || typeof config !== 'object') return config;
  const c = Object.assign({}, config);
  c.horario = normalizarHorario(c.horario || {}, c.almoco || null) || {};
  delete c.almoco;
  const folgaAntiga = typeof c.folgaDeslocamentoMin === 'number' ? c.folgaDeslocamentoMin : CONFIG_V2_PADRAO.folgaDepoisMin;
  if (c.folgaAntesMin == null) c.folgaAntesMin = CONFIG_V2_PADRAO.folgaAntesMin;
  if (c.folgaDepoisMin == null) c.folgaDepoisMin = folgaAntiga;
  if (!Array.isArray(c.excecoes)) c.excecoes = [];
  if (c.antecedenciaMinMin == null) c.antecedenciaMinMin = CONFIG_V2_PADRAO.antecedenciaMinMin;
  if (c.janelaDias == null) c.janelaDias = CONFIG_V2_PADRAO.janelaDias;
  if (!c.rodizio) c.rodizio = CONFIG_V2_PADRAO.rodizio;
  c.mensagens = Object.assign({}, MENSAGENS_PADRAO, c.mensagens || {});
  c.feriados = (c.feriados || []).map((f) => Object.assign({}, f, { ativo: f.ativo !== false }));
  return c;
}

function migrarTipoV1(t) {
  const novo = Object.assign({}, TIPO_V2_PADRAO, t);
  if (!Array.isArray(novo.duracoes) || !novo.duracoes.length) novo.duracoes = [novo.duracaoPadraoMin || 90];
  return novo;
}

function migrarUsuarioV1(u) {
  if (!u.escala || typeof u.escala !== 'object') return u;
  const escala = Object.assign({}, u.escala);
  const folgas = Array.isArray(escala.folgas) ? escala.folgas : [];
  const excecoes = Array.isArray(escala.excecoes) ? escala.excecoes.slice() : [];
  for (const data of folgas) {
    if (!excecoes.some((x) => x.data === data)) excecoes.push({ id: 'x_' + u.id + '_' + data, data, fechado: true, faixas: [], nome: 'Folga' });
  }
  escala.folgas = folgas;
  escala.excecoes = excecoes;
  return Object.assign({}, u, { escala });
}

const comPadrao = (padrao) => (doc) => Object.assign({}, padrao, doc);

/* ---- Esquema v3: período, campos livres, Strada e tipo "Loja" (docs/redesign/DIRECAO-2.md, seção 2) ---- */

/** Campos que todo agendamento ganhou na v3 (2.2). Nada foi renomeado nem removido; `tipoId`, `clienteId` e `endereco` passam a aceitar null. */
export const AGENDAMENTO_V3_PADRAO = { periodo: 'hora', horaAproximada: false, tipoLivre: '', clienteNome: '', localTexto: '', veiculoTexto: '', autorTexto: '', mensagemOriginal: '' };

/** Só acrescenta: nenhum campo é lido, convertido ou apagado (2.7). */
function migrarAgendamentoV2(a) {
  return Object.assign({}, AGENDAMENTO_V3_PADRAO, a);
}

/** Acrescenta a Strada se não houver veículo com apelido (ou nome) normalizado "strada": quem já tinha dados nunca a veria sem isso. */
function comStrada(veiculos) {
  const tem = veiculos.some((v) => v && (util.normalizar(v.apelido) === 'strada' || util.normalizar(v.nome) === 'strada' || v.id === 've4'));
  return tem ? veiculos : veiculos.concat(veiculoStrada(Date.now()));
}

/** Mesma lógica para o tipo "Loja" (t_loja). */
function comTipoLoja(tipos) {
  const tem = tipos.some((t) => t && (t.id === 't_loja' || util.normalizar(t.nome) === 'loja'));
  return tem ? tipos : tipos.concat(tipoLoja(Date.now()));
}

/* ---- Esquema v4: presenças, apelidos, conta compartilhada, quem vai em texto e config.locais (docs/redesign/DIRECAO-3.md, 2.4) ---- */

/** Campos que todo usuário ganhou na v4 (6.1). `apelidos` casa a assinatura do grupo; `contaCompartilhada` marca a conta de setor que não é pessoa. */
export const USUARIO_V4_PADRAO = { apelidos: [], contaCompartilhada: false };

/** Campo que todo agendamento ganhou na v4 (4.2): quem vai e não está no cadastro, em texto. */
export const AGENDAMENTO_V4_PADRAO = { responsavelTexto: '' };

/** Documento de presença com todos os campos (2.3). */
export const PRESENCA_PADRAO = { userId: null, data: '', lugar: 'outro', lugarTexto: '', desde: '', origem: 'app', servicoId: null, registradoPor: null, mensagemOriginal: '', historico: [] };

/** Só acrescenta; o array de apelidos é sempre um array novo por documento. */
function migrarUsuarioV3(u) {
  const novo = Object.assign({}, USUARIO_V4_PADRAO, u);
  novo.apelidos = Array.isArray(u && u.apelidos) ? u.apelidos.slice() : [];
  novo.contaCompartilhada = !!(u && u.contaCompartilhada);
  return novo;
}

function migrarAgendamentoV3(a) {
  return Object.assign({}, AGENDAMENTO_V4_PADRAO, a);
}

/**
 * `config.locais` nasce ao lado de `config.loja`, que continua intacto: a loja com o endereço que já existe e o galpão
 * com endereço vazio de propósito (endereço não se inventa; o dono informa quando quiser). Quem já tem `locais` não muda.
 */
function comLugarGalpao(config) {
  if (!config || typeof config !== 'object') return config;
  if (Array.isArray(config.locais) && config.locais.length) return config;
  const enderecoLoja = config.loja && typeof config.loja === 'object' ? String(config.loja.endereco || '') : '';
  return Object.assign({}, config, {
    locais: [
      { id: 'loja', nome: 'Loja', endereco: enderecoLoja },
      { id: 'galpao', nome: 'Galpão', endereco: '' }
    ]
  });
}

/** Documento novo já nasce com os campos do esquema atual, mesmo quando a tela que cria é de uma versão anterior. */
function comCamposAtuais(colecao, doc) {
  if (colecao === 'tipos') return migrarTipoV1(doc || {});
  if (colecao === 'agendamentos') {
    const novo = Object.assign({ notaInterna: '', mensagensEnviadas: [], origem: 'loja' }, AGENDAMENTO_V3_PADRAO, AGENDAMENTO_V4_PADRAO, doc);
    if (novo.periodo !== 'hora' && (!doc || doc.horaAproximada === undefined)) novo.horaAproximada = true;
    return novo;
  }
  if (colecao === 'usuarios') return migrarUsuarioV3(doc || {});
  if (colecao === 'presencas') {
    const novo = Object.assign({}, PRESENCA_PADRAO, doc);
    novo.historico = Array.isArray(novo.historico) ? novo.historico.slice() : [];
    return novo;
  }
  if (colecao === 'veiculos') return Object.assign({ horario: null, limiteDia: null }, doc);
  if (colecao === 'equipes') return Object.assign({ limiteDia: null }, doc);
  if (colecao === 'config') return comLugarGalpao(migrarConfigV1(Object.assign({}, doc)));
  return Object.assign({}, doc);
}

/**
 * Migrações incrementais: MIGRACOES[n] leva da versão n para n + 1.
 * Recebe e devolve o mapa coleção para array (ou documento, em config e meta). Só acrescenta e converte; nada é apagado,
 * a não ser `config.almoco`, que vira o vão entre as duas faixas do dia.
 */
export const MIGRACOES = {
  1: (d) => {
    const lista = (nome) => (Array.isArray(d[nome]) ? d[nome] : []);
    return Object.assign({}, d, {
      config: migrarConfigV1(d.config),
      tipos: lista('tipos').map(migrarTipoV1),
      agendamentos: lista('agendamentos').map(comPadrao({ notaInterna: '', mensagensEnviadas: [], origem: 'loja' })),
      usuarios: lista('usuarios').map(migrarUsuarioV1),
      veiculos: lista('veiculos').map(comPadrao({ horario: null, limiteDia: null })),
      equipes: lista('equipes').map(comPadrao({ limiteDia: null }))
    });
  },
  /* 2 para 3 (DIRECAO-2 2.7): campos novos com o padrão em cada agendamento, Strada e "Loja" acrescentados quando faltam.
     Usuários não mudam de dado: a capacidade de registrar do perfil campo vem de PERFIS. */
  2: (d) => {
    const lista = (nome) => (Array.isArray(d[nome]) ? d[nome] : []);
    return Object.assign({}, d, {
      agendamentos: lista('agendamentos').map(migrarAgendamentoV2),
      veiculos: comStrada(lista('veiculos')),
      tipos: comTipoLoja(lista('tipos')),
      usuarios: lista('usuarios')
    });
  },
  /* 3 para 4 (DIRECAO-3 2.4): só acrescenta. `presencas` nasce vazia (ou fica como estiver), cada usuário ganha
     `apelidos` e `contaCompartilhada`, cada agendamento ganha `responsavelTexto`, e `config.locais` nasce ao lado de
     `config.loja`, com o galpão sem endereço. Nada é renomeado, lido e convertido, nem apagado. */
  3: (d) => {
    const lista = (nome) => (Array.isArray(d[nome]) ? d[nome] : []);
    return Object.assign({}, d, {
      presencas: lista('presencas'),
      usuarios: lista('usuarios').map(migrarUsuarioV3),
      agendamentos: lista('agendamentos').map(migrarAgendamentoV3),
      config: comLugarGalpao(d.config)
    });
  },
  /* 4 para 5 (equipe oficial, 25/09/2026): alinha as pessoas do seed à lista de funcionários do dono. Para cada id do
     seed que já existe, copia nome, cargo, perfil, setores, campo, apelidos e ativo (é o único degrau que reescreve
     campo de usuário, e só nos ids do seed: escala, telefone, status e senha de quem já existia ficam). Acrescenta
     quem falta (João Vitor, Leonardo) e desativa quem saiu (Caroline), em vez de apagar, para nenhum registro ficar
     órfão. Senha de quem entrou nasce em repo.iniciar (completarCredenciaisDemo). Usuário criado à mão não é tocado. */
  4: (d) => {
    const lista = (nome) => (Array.isArray(d[nome]) ? d[nome] : []);
    return Object.assign({}, d, { usuarios: alinharEquipeV4(lista('usuarios')) });
  }
};

function alinharEquipeV4(usuarios) {
  const oficial = equipeOficial(util.hojeISO(), agora());
  const saida = usuarios.map((u) => {
    const p = oficial.pessoas.find((x) => x.id === u.id);
    if (p) {
      return Object.assign({}, u, {
        nome: p.nome, cargo: p.cargo, perfil: p.perfil, setores: p.setores.slice(), campo: p.campo,
        apelidos: p.apelidos.slice(), ativo: p.ativo, alteradoEm: agora(), versao: (u.versao || 1) + 1
      });
    }
    if (oficial.removidos.includes(u.id) && u.ativo) return Object.assign({}, u, { ativo: false, alteradoEm: agora(), versao: (u.versao || 1) + 1 });
    return u;
  });
  for (const p of oficial.pessoas) if (!saida.some((u) => u.id === p.id)) saida.push(p);
  return saida;
}

/** Rótulos legíveis dos campos que aparecem em diffCampos e na auditoria (extra, fora do contrato). */
export const ROTULOS_CAMPO = {
  tipoId: 'Tipo', setorId: 'Setor', data: 'Data', horaInicio: 'Início', horaFim: 'Término', clienteId: 'Cliente',
  endereco: 'Endereço', enderecoAConfirmar: 'Endereço a confirmar', responsaveis: 'Responsáveis', equipeId: 'Equipe',
  veiculoId: 'Carro', semCarroConfirmado: 'Sem carro', obs: 'Observações', status: 'Status',
  justificativaConflito: 'Justificativa', ordemRota: 'Ordem da rota', obsConclusao: 'Obs. de conclusão',
  pendenciasConclusao: 'Pendências', clienteAprovou: 'Cliente aprovou', concluidoEm: 'Concluído em',
  nome: 'Nome', apelido: 'Apelido', inicial: 'Inicial', placa: 'Placa', tipo: 'Tipo', capacidade: 'Capacidade',
  equipePadraoId: 'Equipe padrão', indiceCor: 'Cor', ativo: 'Ativo', ativa: 'Ativa', membros: 'Membros',
  setores: 'Setores', veiculoPadraoId: 'Carro padrão', liderId: 'Líder', cargo: 'Cargo', email: 'Email',
  perfil: 'Perfil', campo: 'Pessoa de campo', telefone: 'Telefone', icone: 'Ícone', setorPadrao: 'Setor padrão',
  duracaoPadraoMin: 'Duração padrão', precisaVeiculo: 'Precisa de carro', pedeAssinatura: 'Pede assinatura',
  checklist: 'Checklist', ordem: 'Ordem', de: 'De', ate: 'Até', motivo: 'Motivo', detalhe: 'Detalhe',
  horario: 'Horário', horariosSetor: 'Horários por setor', almoco: 'Almoço', feriados: 'Feriados', loja: 'Loja',
  folgaDeslocamentoMin: 'Folga de deslocamento', horaCorteAmanha: 'Hora de corte', slotMin: 'Slot',
  passoSugestaoMin: 'Passo da sugestão', atrasoInicioMin: 'Atraso de início', atrasoFimMin: 'Atraso de fim',
  escala: 'Escala', prefsNotif: 'Notificações', status_usuario: 'Status',
  folgaAntesMin: 'Folga antes', folgaDepoisMin: 'Folga depois', antecedenciaMinMin: 'Antecedência mínima',
  janelaDias: 'Janela de agendamento', limiteDia: 'Limite por dia', incrementoMin: 'Incremento dos horários',
  duracoes: 'Durações', cor: 'Cor', excecoes: 'Datas específicas', rodizio: 'Rodízio de recursos',
  mensagens: 'Mensagens ao cliente', notaInterna: 'Nota interna', mensagensEnviadas: 'Mensagens preparadas',
  origem: 'Origem', fechado: 'Fechado', faixas: 'Faixas de horário',
  periodo: 'Período', horaAproximada: 'Hora aproximada', tipoLivre: 'Tipo (texto livre)', clienteNome: 'Cliente (texto livre)',
  localTexto: 'Local (texto livre)', veiculoTexto: 'Carro (texto livre)', autorTexto: 'Assinado por', mensagemOriginal: 'Mensagem do grupo',
  lugar: 'Lugar', lugarTexto: 'Lugar (texto livre)', desde: 'Desde', apelidos: 'Apelidos', contaCompartilhada: 'Conta compartilhada',
  responsavelTexto: 'Quem vai (texto livre)', locais: 'Lugares', registradoPor: 'Marcado por', servicoId: 'Serviço'
};

/** Rótulo legível de um campo. @param {string} campo @returns {string} */
export function rotuloCampo(campo) {
  return ROTULOS_CAMPO[campo] || campo;
}

/* ------------------------------------------------------------------ */
/* Armazenamento físico (único lugar com localStorage e sessionStorage)*/
/* ------------------------------------------------------------------ */

const memoriaReserva = new Map();

function armazemDe(nome) {
  try {
    const a = globalThis[nome];
    if (a) { a.getItem('__teste'); return a; }
  } catch (e) { /* sem storage: reserva em memória */ }
  return null;
}

const lerChave = (chave, nome = 'localStorage') => {
  const a = armazemDe(nome);
  try {
    if (a) return a.getItem(chave);
  } catch (e) { /* cai na reserva */ }
  return memoriaReserva.has(nome + ':' + chave) ? memoriaReserva.get(nome + ':' + chave) : null;
};

const gravarChave = (chave, valor, nome = 'localStorage') => {
  const a = armazemDe(nome);
  try {
    if (a) { a.setItem(chave, valor); return; }
  } catch (e) { console.warn('Falha ao gravar', chave, e); }
  memoriaReserva.set(nome + ':' + chave, valor);
};

const apagarChave = (chave, nome = 'localStorage') => {
  const a = armazemDe(nome);
  try {
    if (a) a.removeItem(chave);
  } catch (e) { /* ignora */ }
  memoriaReserva.delete(nome + ':' + chave);
};

const listarChaves = (nome = 'localStorage') => {
  const a = armazemDe(nome);
  const saida = [];
  try {
    if (a) for (let i = 0; i < a.length; i++) saida.push(a.key(i));
  } catch (e) { /* ignora */ }
  for (const k of memoriaReserva.keys()) if (k.startsWith(nome + ':')) saida.push(k.slice(nome.length + 1));
  return saida;
};

const lerJSON = (chave, nome) => {
  const bruto = lerChave(chave, nome);
  if (!bruto) return null;
  try { return JSON.parse(bruto); } catch (e) { return null; }
};

const chaveColecao = (colecao) => CHAVES.prefixo + colecao;

/* ------------------------------------------------------------------ */
/* Estado em memória, eventos e transação                              */
/* ------------------------------------------------------------------ */

const DOCUMENTO_UNICO = { config: 'config', meta: 'meta' };
/* Coleções que não entram na fila de sincronização. No modo local, auditoria e
   notificações ficam de fora porque seriam geradas do lado do servidor num
   backend clássico, e a própria sincronização grava nelas. No modo nuvem
   (src/nuvem.js) elas SOBEM: a auditoria é só criação no Firestore, e a
   notificação criada lá é o que dispara o push pela Cloud Function. O que
   nunca sobe é a própria fila, a meta do aparelho e as credenciais locais (na
   nuvem, senha é assunto do Firebase Auth). */
const SEM_FILA_LOCAL = new Set(['filaSync', 'meta', 'auditoria', 'notificacoes']);
const SEM_FILA_NUVEM = new Set(['filaSync', 'meta', 'credenciais']);
const foraDaFila = (colecao) => (nuvem.ativa() ? SEM_FILA_NUVEM : SEM_FILA_LOCAL).has(colecao);

const dados = {};
const indicePorData = new Map();
const assinantes = new Map();
let profundidadeTransacao = 0;
let colecoesSujas = new Set();
let iniciado = false;

const agora = () => Date.now();
const copia = (doc) => (doc ? Object.assign({}, doc) : null);

/* Sequência da auditoria: desempate estável entre registros gravados no mesmo milissegundo (ordem de inserção). */
let sequenciaAuditoria = 0;
function proximaSequencia() {
  if (!sequenciaAuditoria) {
    for (const l of colecaoViva('auditoria')) if (typeof l.seq === 'number' && l.seq > sequenciaAuditoria) sequenciaAuditoria = l.seq;
  }
  sequenciaAuditoria += 1;
  return sequenciaAuditoria;
}

/** Ordem cronológica estável: carimbo em ms, depois sequência de inserção, depois id. */
export function compararAuditoria(x, y) {
  return (x.ts || 0) - (y.ts || 0) || (x.seq || 0) - (y.seq || 0) || String(x.id).localeCompare(String(y.id));
}

function colecaoViva(colecao) {
  if (!dados[colecao]) dados[colecao] = [];
  return dados[colecao];
}

function reconstruirIndice() {
  indicePorData.clear();
  for (const a of colecaoViva('agendamentos')) indexar(a);
}

function indexar(a) {
  if (!a || !a.data) return;
  if (!indicePorData.has(a.data)) indicePorData.set(a.data, []);
  const ids = indicePorData.get(a.data);
  if (!ids.includes(a.id)) ids.push(a.id);
}

function desindexar(a) {
  if (!a || !a.data) return;
  const ids = indicePorData.get(a.data);
  if (!ids) return;
  const i = ids.indexOf(a.id);
  if (i >= 0) ids.splice(i, 1);
  if (!ids.length) indicePorData.delete(a.data);
}

function emitir(nome, detail) {
  if (typeof document === 'undefined' || !document.dispatchEvent) return;
  document.dispatchEvent(new CustomEvent(nome, { detail }));
}

function gravarColecao(colecao) {
  const lista = colecaoViva(colecao);
  const valor = DOCUMENTO_UNICO[colecao] ? (lista[0] || null) : lista;
  gravarChave(chaveColecao(colecao), JSON.stringify(valor));
}

function avisarAssinantes(colecoes) {
  const detail = { colecoes };
  const chamados = new Set();
  for (const c of colecoes.concat('*')) {
    for (const cb of assinantes.get(c) || []) {
      if (chamados.has(cb)) continue;
      chamados.add(cb);
      try { cb(detail); } catch (e) { console.error(e); }
    }
  }
}

function confirmarEscritas(colecoes) {
  for (const c of colecoes) gravarColecao(c);
  avisarAssinantes(colecoes);
  emitir('dados:alterado', { colecoes });
  if (colecoes.some((c) => !foraDaFila(c) || c === 'filaSync')) agendarSincronizacao();
}

function marcarSuja(colecao) {
  if (profundidadeTransacao > 0) { colecoesSujas.add(colecao); return; }
  confirmarEscritas([colecao]);
}

/** Substitui a coleção inteira (uso interno: poda, limpeza, seed). */
function substituirColecao(colecao, lista) {
  dados[colecao] = lista;
  if (colecao === 'agendamentos') reconstruirIndice();
  marcarSuja(colecao);
}

/* ------------------------------------------------------------------ */
/* Fila de sincronização (núcleo)                                      */
/* ------------------------------------------------------------------ */

let forcadoOffline = false;
let sincronizando = false;
let sincronizacaoAgendada = false;
let loteAcumuladoOffline = false;

function enfileirar(op, entidade, entidadeId, payload) {
  if (foraDaFila(entidade)) return;
  const u = sessao.usuario();
  /* Sem sessão a nuvem recusa qualquer gravação (firestore.rules): a auditoria de uma entrada que falhou fica só neste aparelho. */
  if (!u && entidade === 'auditoria' && nuvem.ativa()) return;
  const fila = colecaoViva('filaSync');
  /* Uma operação pendente por documento: a mais nova substitui a anterior,
     salvo criar seguido de atualizar (mantém criar com o payload novo). */
  const existente = fila.find((f) => f.entidade === entidade && f.entidadeId === entidadeId && (f.estado === 'pendente' || f.estado === 'erro'));
  if (existente && op === 'remover' && existente.op === 'criar') {
    /* Criado e removido antes de sincronizar: o servidor nunca precisa saber. */
    fila.splice(fila.indexOf(existente), 1);
  } else if (existente) {
    existente.ts = agora();
    existente.payload = payload;
    existente.estado = 'pendente';
    if (op === 'remover') existente.op = 'remover';
    else if (existente.op !== 'criar') existente.op = op;
  } else {
    fila.push({ id: util.uid('f'), ts: agora(), op, entidade, entidadeId, payload, userId: u ? u.id : null, tentativas: 0, estado: 'pendente' });
  }
  if (!conexao.online) loteAcumuladoOffline = true;
  marcarSuja('filaSync');
}

function agendarSincronizacao() {
  if (sincronizacaoAgendada || !iniciado) return;
  if (!conexao.online || !pendentesSync().length) return;
  /* No modo nuvem só há para onde enviar depois do login: as regras recusam escrita sem autenticação. */
  if (nuvem.ativa() && (!nuvem.uidAtual() || !sessaoAtual)) return;
  sincronizacaoAgendada = true;
  setTimeout(() => { sincronizacaoAgendada = false; sincronizar(); }, 0);
}

let novaTentativaAgendada = false;
const NOVA_TENTATIVA_MS = 30000;

/** A nuvem demorou ou está indisponível: tenta a fila de novo daqui a pouco, sem depender de um novo commit. */
function agendarNovaTentativa() {
  if (novaTentativaAgendada) return;
  novaTentativaAgendada = true;
  setTimeout(() => { novaTentativaAgendada = false; agendarSincronizacao(); }, NOVA_TENTATIVA_MS);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Modo local: o envio é simulado, 250 ms por item, exatamente como sempre foi. @returns {Promise<number>} enviadas */
async function simularEnvioDaFila() {
  let enviadas = 0;
  let proxima = pendentesSync()[0];
  while (proxima && conexao.online) {
    const item = colecaoViva('filaSync').find((f) => f.id === proxima.id);
    if (!item) { proxima = pendentesSync()[0]; continue; }
    item.estado = 'enviando';
    item.tentativas += 1;
    marcarSuja('filaSync');
    emitir('conexao:alterada', { online: conexao.online, pendentes: pendentesSync().length, sincronizando: true });
    await esperar(250);
    if (!conexao.online) { item.estado = 'pendente'; marcarSuja('filaSync'); break; }
    item.estado = 'enviada';
    substituirColecao('filaSync', colecaoViva('filaSync').filter((f) => f.id !== item.id));
    enviadas += 1;
    proxima = pendentesSync()[0];
  }
  return enviadas;
}

/* Erros que significam "sem nuvem agora", e não "esta gravação é inválida": a fila para e tenta de novo daqui a pouco. */
const ehErroDeRede = (codigo) => codigo === 'tempo-esgotado' || /unavailable|network|deadline|aborted|resource-exhausted|unauthenticated/.test(codigo);

/**
 * Modo nuvem: cada item da fila vira uma gravação de verdade no Firestore (nuvem.replicar). Sucesso tira da fila;
 * erro de rede deixa pendente e para a rodada; erro de regra ou de dado marca `erro` e segue para o próximo, sem
 * bloquear os demais. Cada item é tentado uma vez por rodada.
 * @returns {Promise<number>} enviadas
 */
async function enviarFilaParaNuvem() {
  let enviadas = 0;
  const vistos = new Set();
  const proximo = () => pendentesSync().find((f) => !vistos.has(f.id));
  let proxima = proximo();
  while (proxima && conexao.online) {
    vistos.add(proxima.id);
    const item = colecaoViva('filaSync').find((f) => f.id === proxima.id);
    if (!item) { proxima = proximo(); continue; }
    item.estado = 'enviando';
    item.tentativas += 1;
    marcarSuja('filaSync');
    emitir('conexao:alterada', { online: conexao.online, pendentes: pendentesSync().length, sincronizando: true });
    try {
      await nuvem.replicar(item.entidade, item.op, item.payload);
      item.estado = 'enviada';
      substituirColecao('filaSync', colecaoViva('filaSync').filter((f) => f.id !== item.id));
      enviadas += 1;
    } catch (e) {
      const codigo = String((e && e.code) || '');
      item.erro = nuvem.mensagemDeErro(e);
      item.erroCodigo = codigo;
      item.erroEm = agora();
      if (ehErroDeRede(codigo)) {
        item.estado = 'pendente';
        marcarSuja('filaSync');
        agendarNovaTentativa();
        break;
      }
      item.estado = 'erro';
      marcarSuja('filaSync');
      console.warn('Nuvem: gravação recusada', item.entidade, item.entidadeId, codigo, e);
    }
    proxima = proximo();
  }
  return enviadas;
}

/**
 * Processa a fila em ordem, remove enviadas, audita 'sincronizacao' uma vez por lote e notifica o próprio usuário
 * (tipo sistema) quando o lote veio do modo offline. No modo local o envio é simulado (250 ms por item); no modo
 * nuvem cada item é gravado no Firestore.
 * @returns {Promise<{enviadas:number}>}
 */
export async function sincronizar() {
  if (sincronizando || !conexao.online) return { enviadas: 0 };
  sincronizando = true;
  const veioDoOffline = loteAcumuladoOffline;
  let enviadas = 0;
  try {
    enviadas = nuvem.ativa() ? await enviarFilaParaNuvem() : await simularEnvioDaFila();
  } finally {
    sincronizando = false;
  }
  if (enviadas > 0) {
    loteAcumuladoOffline = false;
    const texto = enviadas + (enviadas === 1 ? ' alteração sincronizada' : ' alterações sincronizadas');
    repo.transacao(() => {
      /* No modo nuvem a auditoria também sobe pela fila: auditar cada lote geraria um lote novo a cada lote, sem fim. */
      if (!nuvem.ativa()) auditar({ acao: 'sincronizacao', entidade: 'sistema', entidadeId: null, rotulo: texto, motivo: null, setorId: null });
      const u = sessao.usuario();
      if (veioDoOffline && u) {
        notificar({ tipo: 'sistema', titulo: 'Sincronização concluída', texto, para: [u.id], link: '#/sincronizacao', incluirAutor: true });
      }
    });
  }
  emitir('conexao:alterada', { online: conexao.online, pendentes: pendentesSync().length, sincronizando: false });
  return { enviadas };
}

/** @returns {object[]} operações pendentes ou com erro, mais antigas primeiro. */
export function pendentesSync() {
  return colecaoViva('filaSync')
    .filter((f) => f.estado === 'pendente' || f.estado === 'erro' || f.estado === 'enviando')
    .sort((a, b) => a.ts - b.ts)
    .map(copia);
}

/** @param {string} entidade @param {string} id @returns {boolean} há operação pendente para o documento. */
export function pendenteSync(entidade, id) {
  return colecaoViva('filaSync').some((f) => f.entidade === entidade && f.entidadeId === id && f.estado !== 'enviada');
}

/** Tira uma operação da fila sem desfazer o dado local. @param {string} opId */
export function descartarSync(opId) {
  const fila = colecaoViva('filaSync');
  if (!fila.some((f) => f.id === opId)) return;
  substituirColecao('filaSync', fila.filter((f) => f.id !== opId));
  emitir('conexao:alterada', { online: conexao.online, pendentes: pendentesSync().length });
}

let fisicoOnline = typeof navigator !== 'undefined' && navigator ? navigator.onLine !== false : true;

/** Estado de conexão (5.4). */
export const conexao = {
  get online() { return fisicoOnline && !forcadoOffline; },
  get forcadoOffline() { return forcadoOffline; },
  get sincronizando() { return sincronizando; },
  definirOnline(online) {
    fisicoOnline = !!online;
    emitir('conexao:alterada', { online: this.online, pendentes: pendentesSync().length });
    if (this.online) agendarSincronizacao();
  },
  forcarOffline(ligado) {
    forcadoOffline = !!ligado;
    emitir('conexao:alterada', { online: this.online, pendentes: pendentesSync().length });
    if (this.online) agendarSincronizacao();
  }
};

/* ------------------------------------------------------------------ */
/* Repositório                                                         */
/* ------------------------------------------------------------------ */

function carregarColecao(colecao) {
  const bruto = lerJSON(chaveColecao(colecao));
  if (DOCUMENTO_UNICO[colecao]) dados[colecao] = bruto && typeof bruto === 'object' ? [bruto] : [];
  else dados[colecao] = Array.isArray(bruto) ? bruto : [];
}

async function credenciaisDoSeed(senhas) {
  const lista = [];
  for (const userId of Object.keys(senhas || {})) {
    const sal = util.salAleatorio();
    const hash = await util.hashTexto(sal + ':' + senhas[userId]);
    lista.push({ id: userId, userId, sal, hash, criadoEm: agora(), alteradoEm: agora(), versao: 1 });
  }
  return lista;
}

/** Modo local: pessoa ativa do seed que a migração acrescentou ganha a senha de demonstração, como se tivesse nascido no seed. */
async function completarCredenciaisDemo() {
  const credenciais = colecaoViva('credenciais');
  const faltam = {};
  for (const u of colecaoViva('usuarios')) {
    if (u.ativo && !u.contaCompartilhada && /@greendecor\.com\.br$/.test(String(u.email || '')) && !credenciais.some((c) => c.userId === u.id)) faltam[u.id] = SENHA_DEMO;
  }
  if (!Object.keys(faltam).length) return;
  for (const c of await credenciaisDoSeed(faltam)) credenciais.push(c);
  gravarColecao('credenciais');
}

async function gravarSeedCompleto(seed) {
  const credenciais = await credenciaisDoSeed(seed.senhas);
  for (const colecao of CHAVES.colecoes) {
    let valor;
    if (colecao === 'credenciais') valor = credenciais;
    else if (DOCUMENTO_UNICO[colecao]) valor = seed[colecao] ? [seed[colecao]] : [];
    else valor = seed[colecao] || [];
    dados[colecao] = valor;
    gravarColecao(colecao);
  }
  reconstruirIndice();
}

/**
 * Aparelho novo no modo nuvem: nada de demonstração, porque o que vale está no Firestore e chega pela escuta. Fica só a
 * estrutura que as telas precisam antes da primeira escuta chegar (config, tipos e veículos do seed), com carimbo zero
 * para qualquer versão da nuvem vencer, mais a meta. Sem usuários, sem senhas, sem clientes, sem registros.
 */
function seedEstrutural(seed) {
  const zerar = (d) => (d ? Object.assign({}, d, { criadoEm: 0, alteradoEm: 0 }) : d);
  const vazio = {};
  for (const colecao of CHAVES.colecoes) vazio[colecao] = DOCUMENTO_UNICO[colecao] ? null : [];
  return Object.assign(vazio, {
    senhas: {},
    config: zerar(seed.config),
    tipos: (seed.tipos || []).map(zerar),
    veiculos: (seed.veiculos || []).map(zerar),
    meta: seed.meta
  });
}

/* ------------------------------------------------------------------ */
/* Replicação de entrada (modo nuvem): o que mudou no Firestore chega   */
/* aqui e é aplicado na base local por id, vencendo pelo alteradoEm.    */
/* ------------------------------------------------------------------ */

/** Mesma chave lógica de presença (userId mais data) com dois ids: a mais recente vence, empate pelo menor id; a perdedora sai daqui e da nuvem. Toda cópia chega ao mesmo resultado. */
function resolverPresencaDuplicada(doc) {
  const lista = colecaoViva('presencas');
  const iguais = lista.filter((p) => p.userId === doc.userId && p.data === doc.data);
  if (iguais.length < 2) return;
  iguais.sort((a, b) => (b.alteradoEm || 0) - (a.alteradoEm || 0) || String(a.id).localeCompare(String(b.id)));
  for (const perdedora of iguais.slice(1)) {
    const i = lista.indexOf(perdedora);
    if (i >= 0) lista.splice(i, 1);
    enfileirar('remover', 'presencas', perdedora.id, { id: perdedora.id });
  }
}

/**
 * Aplica um documento vindo da nuvem. O local vence quando o seu `alteradoEm` é igual ou mais novo (o eco da própria
 * gravação, ou uma edição feita aqui que ainda vai subir pela fila). O objeto vivo é atualizado no lugar, para quem
 * segura uma referência (a sessão, uma tela montada) continuar vendo o mesmo documento. Nunca entra na fila.
 * @returns {boolean} mudou algo
 */
function aplicarRemotoInterno(colecao, docRemoto) {
  if (!docRemoto || docRemoto.id == null || !CHAVES.colecoes.includes(colecao)) return false;
  const lista = colecaoViva(colecao);
  const id = String(docRemoto.id);
  const local = lista.find((d) => d.id === id);
  const remotoEm = typeof docRemoto.alteradoEm === 'number' ? docRemoto.alteradoEm : 0;
  if (local && (local.alteradoEm || 0) >= remotoEm) return false;
  const novo = comCamposAtuais(colecao, Object.assign({}, docRemoto, { id }));
  if (local) {
    if (colecao === 'agendamentos' && local.data !== novo.data) desindexar(local);
    for (const k of Object.keys(local)) if (!(k in novo)) delete local[k];
    Object.assign(local, novo);
    if (colecao === 'agendamentos') indexar(local);
  } else {
    if (DOCUMENTO_UNICO[colecao]) lista.length = 0;
    if (colecao === 'auditoria' || colecao === 'notificacoes') lista.unshift(novo); else lista.push(novo);
    if (colecao === 'agendamentos') indexar(novo);
  }
  if (colecao === 'presencas') resolverPresencaDuplicada(local || novo);
  marcarSuja(colecao);
  return true;
}

/** Documento apagado na nuvem (ou que saiu da janela das coleções limitadas): sai daqui sem entrar na fila. @returns {boolean} */
function removerRemotoInterno(colecao, id) {
  const lista = colecaoViva(colecao);
  const i = lista.findIndex((d) => d.id === String(id));
  if (i < 0) return false;
  const [doc] = lista.splice(i, 1);
  if (colecao === 'agendamentos') desindexar(doc);
  marcarSuja(colecao);
  return true;
}

/** Um lote de mudanças de uma coleção (um onSnapshot), gravado uma vez e anunciado uma vez. @returns {number} quantas mudaram */
function aplicarLoteRemoto(colecao, itens) {
  let mudou = 0;
  repo.transacao(() => {
    for (const item of itens || []) {
      if (!item) continue;
      if (item.tipo === 'removed') { if (removerRemotoInterno(colecao, item.id)) mudou += 1; }
      else if (aplicarRemotoInterno(colecao, item.doc)) mudou += 1;
    }
  });
  return mudou;
}

/** Abre as escutas do Firestore (depois do login). Erros de escuta viram o evento 'nuvem:erro', que o app mostra. */
function iniciarEscutaNuvem() {
  if (!nuvem.ativa()) return;
  nuvem.escutar(nuvem.COLECOES_REPLICADAS, {
    aplicarLote: (colecao, itens) => aplicarLoteRemoto(colecao, itens),
    erro: (colecao, erro) => emitir('nuvem:erro', { colecao, mensagem: nuvem.mensagemDeErro(erro), codigo: String((erro && erro.code) || '') })
  }).catch((e) => console.warn('Nuvem: não foi possível abrir as escutas', e));
}

/** O Firebase derrubou a sessão por fora (senha trocada em outro lugar, conta desativada): a sessão local acaba junto. */
function aoMudarSessaoNuvem(uid) {
  if (uid || !sessaoAtual) return;
  sessaoAtual = null;
  limparSessaoGravada();
  nuvem.pararEscuta();
  emitir('sessao:alterada', { usuario: null });
}

/**
 * Repositório único (ESPECIFICACAO.md, 5.1).
 */
export const repo = {
  async iniciar() {
    for (const colecao of CHAVES.colecoes) carregarColecao(colecao);
    /* Modo nuvem: o SDK carrega em paralelo com a leitura local. A sessão do Firebase precisa estar resolvida antes
       de sessao.restaurar(), e uma falha aqui é falha de boot (com a nuvem ligada, não existe recuo para o demo). */
    const nuvemLigada = nuvem.ativa();
    const nuvemPronta = nuvemLigada ? nuvem.iniciar().catch((e) => ({ erro: e })) : null;
    let meta = colecaoViva('meta')[0];
    if (!meta) {
      const seed = gerarSeed(util.hojeISO(), util.agoraMin());
      await gravarSeedCompleto(nuvemLigada ? seedEstrutural(seed) : seed);
      meta = colecaoViva('meta')[0];
    } else if ((meta.versaoEsquema || 1) < VERSAO_ESQUEMA) {
      const brutos = {};
      for (const colecao of CHAVES.colecoes) brutos[colecao] = DOCUMENTO_UNICO[colecao] ? colecaoViva(colecao)[0] : colecaoViva(colecao);
      /* Se a migração falhar, nada é gravado: o dado antigo fica intacto no armazenamento e o app abre com ele
         (regras.js lê os dois formatos de horário). Tenta de novo na próxima abertura. */
      let migrados = null;
      try { migrados = migrar(brutos, meta.versaoEsquema || 1); } catch (e) { console.error('Falha na migração do esquema', e); }
      if (migrados) {
        for (const colecao of CHAVES.colecoes) {
          if (DOCUMENTO_UNICO[colecao]) dados[colecao] = migrados[colecao] ? [migrados[colecao]] : [];
          else dados[colecao] = Array.isArray(migrados[colecao]) ? migrados[colecao] : [];
        }
        if (colecaoViva('meta')[0]) colecaoViva('meta')[0].versaoEsquema = VERSAO_ESQUEMA;
        for (const colecao of CHAVES.colecoes) gravarColecao(colecao);
        if (!nuvemLigada) await completarCredenciaisDemo();
      }
    }
    /* meta.seedHoje é só registro da data do seed: dado salvo nunca se rejuvenesce (ESPECIFICACAO.md, 4.14, 10 e 16.15). */
    /* Operações que ficaram "enviando" numa aba fechada voltam a pendente. */
    for (const f of colecaoViva('filaSync')) if (f.estado === 'enviando') f.estado = 'pendente';
    reconstruirIndice();
    if (nuvemPronta) {
      const estadoNuvem = await nuvemPronta;
      if (estadoNuvem && estadoNuvem.erro) {
        const e = estadoNuvem.erro;
        throw new Error('Não foi possível carregar a nuvem. Verifique a conexão e tente de novo. ' + String((e && e.message) || e || ''));
      }
      /* A pessoa da sessão restaurada chega junto: entra na base antes de sessao.restaurar() procurar por ela. */
      if (estadoNuvem && estadoNuvem.usuario) aplicarRemotoInterno('usuarios', estadoNuvem.usuario);
      nuvem.aoMudarSessao(aoMudarSessaoNuvem);
    }
    iniciado = true;
    agendarSincronizacao();
  },

  /** Modo nuvem: aplica um documento vindo do Firestore (id, alteradoEm vence). Nunca entra na fila. @returns {boolean} */
  aplicarRemoto(colecao, doc) {
    return aplicarRemotoInterno(colecao, doc);
  },

  /** Modo nuvem: tira um documento apagado no Firestore. Nunca entra na fila. @returns {boolean} */
  removerRemoto(colecao, id) {
    return removerRemotoInterno(colecao, id);
  },

  listar(colecao, filtro) {
    const lista = colecaoViva(colecao);
    const saida = [];
    for (const doc of lista) if (!filtro || filtro(doc)) saida.push(copia(doc));
    return saida;
  },

  obter(colecao, id) {
    return copia(colecaoViva(colecao).find((d) => d.id === id) || null);
  },

  criar(colecao, doc) {
    const lista = colecaoViva(colecao);
    const prefixo = PREFIXO_ID[colecao] || colecao.slice(0, 1);
    const novo = comCamposAtuais(colecao, doc);
    if (!novo.id) novo.id = util.uid(prefixo);
    if (lista.some((d) => d.id === novo.id)) throw new Error('Já existe ' + colecao + ' com id ' + novo.id);
    const ts = agora();
    if (novo.criadoEm == null) novo.criadoEm = ts;
    novo.alteradoEm = ts;
    novo.versao = 1;
    if (DOCUMENTO_UNICO[colecao]) lista.length = 0;
    if (colecao === 'auditoria' || colecao === 'notificacoes') lista.unshift(novo); else lista.push(novo);
    if (colecao === 'agendamentos') indexar(novo);
    enfileirar('criar', colecao, novo.id, copia(novo));
    marcarSuja(colecao);
    return copia(novo);
  },

  atualizar(colecao, id, mudancas) {
    const doc = colecaoViva(colecao).find((d) => d.id === id);
    if (!doc) throw new Error('Documento não encontrado: ' + colecao + '/' + id);
    const dataAntes = doc.data;
    Object.assign(doc, mudancas || {});
    /* Tela da v1 muda só duracaoPadraoMin: a primeira duração da lista acompanha (DIRECAO 5.2). */
    if (colecao === 'tipos' && mudancas && mudancas.duracaoPadraoMin != null && mudancas.duracoes === undefined) {
      doc.duracoes = [mudancas.duracaoPadraoMin].concat((doc.duracoes || []).slice(1).filter((x) => x !== mudancas.duracaoPadraoMin));
    }
    doc.id = id;
    doc.alteradoEm = agora();
    doc.versao = (doc.versao || 0) + 1;
    if (colecao === 'agendamentos' && dataAntes !== doc.data) {
      desindexar({ id, data: dataAntes });
      indexar(doc);
    }
    enfileirar('atualizar', colecao, id, copia(doc));
    marcarSuja(colecao);
    return copia(doc);
  },

  remover(colecao, id) {
    const lista = colecaoViva(colecao);
    const i = lista.findIndex((d) => d.id === id);
    if (i < 0) return false;
    const [doc] = lista.splice(i, 1);
    if (colecao === 'agendamentos') desindexar(doc);
    enfileirar('remover', colecao, id, { id });
    marcarSuja(colecao);
    return true;
  },

  transacao(fn) {
    profundidadeTransacao += 1;
    let resultado;
    try {
      resultado = fn();
    } finally {
      profundidadeTransacao -= 1;
      if (profundidadeTransacao === 0 && colecoesSujas.size) {
        const colecoes = Array.from(colecoesSujas);
        colecoesSujas = new Set();
        confirmarEscritas(colecoes);
      }
    }
    return resultado;
  },

  config() {
    return configParaLeitura(colecaoViva('config')[0]);
  },

  salvarConfig(mudancas) {
    const atual = colecaoViva('config')[0];
    const v2 = configParaGravar(mudancas, atual);
    if (!atual) return this.criar('config', Object.assign({ id: 'config' }, v2));
    if (atual.almoco !== undefined) delete atual.almoco;
    return this.atualizar('config', 'config', v2);
  },

  meta() {
    return copia(colecaoViva('meta')[0]) || { versaoEsquema: VERSAO_ESQUEMA, seedCriadoEm: 0, seedHoje: '' };
  },

  assinar(colecao, cb) {
    if (!assinantes.has(colecao)) assinantes.set(colecao, new Set());
    assinantes.get(colecao).add(cb);
    return () => { const s = assinantes.get(colecao); if (s) s.delete(cb); };
  },

  usoArmazenamento() {
    const porColecao = {};
    let total = 0;
    for (const colecao of CHAVES.colecoes) {
      const chave = chaveColecao(colecao);
      const bruto = lerChave(chave) || '';
      const bytes = (chave.length + bruto.length) * 2;
      porColecao[colecao] = bytes;
      total += bytes;
    }
    for (const chave of listarChaves()) {
      if (chave.startsWith(CHAVES.prefixo)) continue;
      if (chave === CHAVES.sessao || chave === CHAVES.aparelho || chave.startsWith(CHAVES.prefs)) {
        total += (chave.length + (lerChave(chave) || '').length) * 2;
      }
    }
    return { porColecao, total };
  }
};

const PREFIXO_ID = {
  agendamentos: 'a', clientes: 'c', usuarios: 'u', equipes: 'e', veiculos: 've', indisponibilidades: 'i',
  tipos: 't', notificacoes: 'n', auditoria: 'l', filaSync: 'f', assinaturas: 's', credenciais: 'cred', presencas: 'pr'
};

/**
 * Aplica MIGRACOES em sequência de versaoAtual até VERSAO_ESQUEMA.
 * @param {object} dadosBrutos mapa colecao para array ou documento
 * @param {number} versaoAtual
 * @returns {object} dados migrados. Efeitos: nenhum (quem chama grava).
 */
export function migrar(dadosBrutos, versaoAtual) {
  let atual = dadosBrutos;
  for (let v = versaoAtual || 1; v < VERSAO_ESQUEMA; v++) {
    const passo = MIGRACOES[v];
    if (typeof passo === 'function') atual = passo(atual) || atual;
  }
  if (atual.meta) atual.meta.versaoEsquema = VERSAO_ESQUEMA;
  return atual;
}

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

const DIAS_SESSAO = 30;
let sessaoAtual = null;

function lerSessaoGravada() {
  const s = lerJSON(CHAVES.sessao, 'sessionStorage');
  if (s) return { dados: s, origem: 'sessionStorage' };
  const l = lerJSON(CHAVES.sessao, 'localStorage');
  if (l) return { dados: l, origem: 'localStorage' };
  return null;
}

function limparSessaoGravada() {
  apagarChave(CHAVES.sessao, 'sessionStorage');
  apagarChave(CHAVES.sessao, 'localStorage');
}

/* Só usuário ativo (ESPECIFICACAO.md, 5.3): conta desativada falha como qualquer outra, sem revelar que existe.
   Conta compartilhada (DIRECAO-3 6.2) também não entra: ela existe só para o leitor do grupo casar o remetente. */
function usuarioVivoPorEmail(email) {
  const alvo = String(email || '').trim().toLowerCase();
  if (!alvo) return null;
  return colecaoViva('usuarios').find((u) => u.ativo && !u.contaCompartilhada && String(u.email || '').toLowerCase() === alvo) || null;
}

/* ---- Sessão no modo nuvem (src/nuvem.js): Firebase Auth manda; a pessoa vem de contas/{uid} e usuarios/{usuarioId} ---- */

const ESCALA_MINIMA = { seg_sex: { de: '08:00', ate: '18:00' }, sab: { de: '08:30', ate: '12:30' }, dom: null, folgas: [], excecoes: [] };

function nomeDoEmail(email) {
  const parte = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return parte ? parte.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Pessoa';
}

/**
 * Garante que a pessoa da conta exista na base local com o uid do login. Três casos: veio da nuvem (aplica); só existe
 * aqui, no aparelho em que o app era usado no modo local (ganha o uid e sobe pela fila); não existe em lugar nenhum,
 * que é a primeira conta de um projeto novo (nasce o mínimo, sobe pela fila, e o resto se preenche em Cadastros).
 */
function garantirUsuarioDaConta(conta, usuarioRemoto, autenticado) {
  const id = String(conta.usuarioId);
  if (usuarioRemoto) aplicarRemotoInterno('usuarios', usuarioRemoto);
  let u = colecaoViva('usuarios').find((x) => x.id === id);
  if (!u && !usuarioRemoto) {
    repo.criar('usuarios', Object.assign({}, USUARIO_V4_PADRAO, {
      id, nome: nomeDoEmail(conta.email || autenticado.email), cargo: '', email: String(conta.email || autenticado.email || '').toLowerCase(),
      perfil: PERFIS[conta.perfil] ? conta.perfil : 'campo', setores: [], campo: conta.perfil === 'campo', ativo: true, telefone: '',
      status: 'disponivel', escala: JSON.parse(JSON.stringify(ESCALA_MINIMA)), prefsNotif: {}, uid: autenticado.uid
    }));
    u = colecaoViva('usuarios').find((x) => x.id === id);
  } else if (u && u.uid !== autenticado.uid) {
    repo.atualizar('usuarios', id, { uid: autenticado.uid });
  }
  return u;
}

async function entrarPelaNuvem(emailNorm, senha, lembrar) {
  const falha = (erro, rotulo) => {
    repo.transacao(() => {
      auditar({ acao: 'login_falha', entidade: 'sessao', entidadeId: null, userId: null, rotulo: rotulo || emailNorm || '(sem email)', motivo: null, setorId: null });
    });
    return { ok: false, erro };
  };
  const r = await nuvem.entrar(emailNorm, senha, !!lembrar);
  if (!r.ok) return falha(r.erro || 'Email ou senha incorretos.');
  let carregada;
  try {
    carregada = await nuvem.carregarConta(r.uid);
  } catch (e) {
    await nuvem.sair();
    return falha('Não foi possível ler o seu cadastro na nuvem agora. Tente de novo.');
  }
  const conta = carregada.conta;
  if (!conta || !conta.usuarioId) {
    await nuvem.sair();
    return falha('Este login ainda não está ligado a uma pessoa do cadastro. Peça ao administrador para vincular em Cadastros, Dados.', emailNorm + ' (login sem vínculo)');
  }
  const u = garantirUsuarioDaConta(conta, carregada.usuario, r);
  if (!u || !u.ativo || u.contaCompartilhada) {
    await nuvem.sair();
    return falha('Email ou senha incorretos.');
  }
  sessaoAtual = { userId: u.id, ts: agora(), expiraEm: null };
  limparSessaoGravada();
  repo.transacao(() => {
    auditar({ acao: 'login', entidade: 'sessao', entidadeId: u.id, userId: u.id, rotulo: u.nome, motivo: null, setorId: null });
  });
  iniciarEscutaNuvem();
  agendarSincronizacao();
  emitir('sessao:alterada', { usuario: copia(u) });
  return { ok: true, usuario: copia(u) };
}

function restaurarPelaNuvem() {
  const uid = nuvem.uidAtual();
  const conta = nuvem.contaCarregada();
  if (!uid) { sessaoAtual = null; return null; }
  const u = conta && conta.usuarioId ? colecaoViva('usuarios').find((x) => x.id === conta.usuarioId) : null;
  if (!u || !u.ativo || u.contaCompartilhada) {
    /* Login sem vínculo, pessoa desativada ou cadastro que não chegou: sai do Firebase para a próxima entrada reler tudo. */
    sessaoAtual = null;
    nuvem.sair().catch(() => {});
    return null;
  }
  sessaoAtual = { userId: u.id, ts: agora(), expiraEm: null };
  iniciarEscutaNuvem();
  return u;
}

/**
 * Senha no modo nuvem. A própria: troca no Firebase Auth. Pessoa sem login: cria a conta (instância secundária, sem
 * derrubar a sessão de quem cadastra) e vincula. Login de outra pessoa que já existe: o app não redefine senha alheia;
 * manda o email de redefinição para ela. Nunca lança: devolve { ok, erro?, aviso? } e anuncia o aviso.
 */
async function definirSenhaPelaNuvem(userId, senha) {
  const u = colecaoViva('usuarios').find((x) => x.id === userId);
  if (!u) return { ok: false, erro: 'Pessoa não encontrada: ' + userId };
  const eu = sessao.usuario();
  let r;
  if (u.uid && eu && eu.id === userId) {
    r = await nuvem.trocarSenha(senha);
    if (r.ok) r.aviso = 'Senha trocada na nuvem.';
  } else if (!u.uid) {
    r = await nuvem.criarLogin(u.email, senha);
    if (r.ok) {
      const v = await nuvem.vincularConta(userId, r.uid, { perfil: u.perfil, email: u.email });
      if (!v.ok) r = v;
      else { repo.atualizar('usuarios', userId, { uid: r.uid }); r.aviso = 'Login criado na nuvem para ' + u.email + '.'; }
    }
  } else {
    r = await nuvem.redefinirSenha(u.email);
    if (r.ok) r.aviso = 'Esta pessoa já tem login. Enviamos um email para ' + u.email + ' redefinir a senha; a senha digitada aqui não foi usada.';
  }
  emitir('nuvem:aviso', { mensagem: r.ok ? (r.aviso || '') : r.erro, tipo: r.ok ? 'info' : 'erro' });
  return r;
}

/** Sessão (ESPECIFICACAO.md, 5.3). */
export const sessao = {
  async entrar(email, senha, lembrar) {
    const emailNorm = String(email || '').trim().toLowerCase();
    if (nuvem.ativa()) return entrarPelaNuvem(emailNorm, senha, lembrar);
    const u = usuarioVivoPorEmail(emailNorm);
    const cred = u ? colecaoViva('credenciais').find((c) => c.userId === u.id) : null;
    let ok = false;
    if (u && u.ativo && cred && senha != null) {
      const hash = await util.hashTexto(cred.sal + ':' + senha);
      ok = hash === cred.hash;
    }
    if (!ok) {
      /* Mensagem única para toda falha; o motivo real fica só na auditoria. */
      const erro = 'Email ou senha incorretos.';
      repo.transacao(() => {
        auditar({ acao: 'login_falha', entidade: 'sessao', entidadeId: null, userId: null, rotulo: emailNorm || '(sem email)', motivo: null, setorId: null });
      });
      return { ok: false, erro };
    }
    const ts = agora();
    sessaoAtual = { userId: u.id, ts, expiraEm: lembrar ? ts + DIAS_SESSAO * 86400000 : null };
    limparSessaoGravada();
    gravarChave(CHAVES.sessao, JSON.stringify(sessaoAtual), lembrar ? 'localStorage' : 'sessionStorage');
    repo.transacao(() => {
      auditar({ acao: 'login', entidade: 'sessao', entidadeId: u.id, userId: u.id, rotulo: u.nome, motivo: null, setorId: null });
    });
    emitir('sessao:alterada', { usuario: copia(u) });
    return { ok: true, usuario: copia(u) };
  },

  restaurar() {
    if (nuvem.ativa()) return restaurarPelaNuvem();
    const gravada = lerSessaoGravada();
    if (!gravada) { sessaoAtual = null; return null; }
    const s = gravada.dados;
    const expirada = s.expiraEm && s.expiraEm < agora();
    const u = colecaoViva('usuarios').find((x) => x.id === s.userId);
    if (expirada || !u || !u.ativo || u.contaCompartilhada) {
      limparSessaoGravada();
      sessaoAtual = null;
      return null;
    }
    sessaoAtual = { userId: s.userId, ts: s.ts, expiraEm: s.expiraEm || null };
    return u;
  },

  sair() {
    const u = this.usuario();
    if (u) {
      repo.transacao(() => {
        auditar({ acao: 'logout', entidade: 'sessao', entidadeId: u.id, userId: u.id, rotulo: u.nome, motivo: null, setorId: null });
      });
    }
    sessaoAtual = null;
    limparSessaoGravada();
    if (nuvem.ativa()) nuvem.sair().catch(() => {});
    emitir('sessao:alterada', { usuario: null });
  },

  usuario() {
    if (!sessaoAtual) return null;
    return colecaoViva('usuarios').find((x) => x.id === sessaoAtual.userId) || null;
  },

  async definirSenha(userId, senha) {
    if (nuvem.ativa()) return definirSenhaPelaNuvem(userId, senha);
    const sal = util.salAleatorio();
    const hash = await util.hashTexto(sal + ':' + senha);
    const existente = colecaoViva('credenciais').find((c) => c.userId === userId);
    if (existente) repo.atualizar('credenciais', existente.id, { sal, hash });
    else repo.criar('credenciais', { id: userId, userId, sal, hash });
    return { ok: true };
  },

  /** "Esqueci a senha": só no modo nuvem (email de redefinição do Firebase). @param {string} email @returns {Promise<{ok:boolean, erro?:string}>} */
  async redefinirSenha(email) {
    if (!nuvem.ativa()) return { ok: false, erro: 'No modo local a senha é redefinida por um administrador em Cadastros, Pessoas.' };
    return nuvem.redefinirSenha(email);
  }
};

/* ------------------------------------------------------------------ */
/* Nuvem: o que as telas perguntam e pedem (docs/NUVEM.md)             */
/* ------------------------------------------------------------------ */

/** Modo nuvem ligado e configurado (src/config-nuvem.js). @returns {boolean} */
export function nuvemAtiva() {
  return nuvem.ativa();
}

/** Estado da nuvem para telas: { ativa, sdkCarregado, uid, email, usuarioId, escutando, projeto }. */
export function estadoNuvem() {
  return nuvem.estado();
}

/**
 * "Enviar tudo para a nuvem" (Cadastros, Dados, só admin): sobe todas as coleções replicáveis desta base local para o
 * Firestore, em lotes. É a migração dos dados de demonstração e do que foi feito no modo local. Antes garante o uid do
 * admin no próprio cadastro; depois tira da fila o que já foi contido no envio (só remoções pendentes ficam).
 * @param {(feitos:number, total:number, colecao:string) => void} [aoProgredir]
 * @returns {Promise<{enviados:number, colecoes:number}>}
 */
export async function enviarTudoParaNuvem(aoProgredir) {
  const u = sessao.usuario();
  if (!nuvem.ativa()) throw new Error('A nuvem está desligada em src/config-nuvem.js');
  if (!u || u.perfil !== 'admin') throw new Error('Só o administrador envia tudo para a nuvem');
  const uid = nuvem.uidAtual();
  if (uid && u.uid !== uid) repo.atualizar('usuarios', u.id, { uid });
  const mapa = {};
  for (const colecao of nuvem.COLECOES_REPLICADAS) mapa[colecao] = colecaoViva(colecao).map(copia);
  const r = await nuvem.enviarTudo(mapa, aoProgredir);
  repo.transacao(() => {
    substituirColecao('filaSync', colecaoViva('filaSync').filter((f) => f.op === 'remover'));
    auditar({ acao: 'sincronizacao', entidade: 'sistema', entidadeId: null, rotulo: r.enviados + (r.enviados === 1 ? ' documento enviado' : ' documentos enviados') + ' para a nuvem', motivo: null, setorId: null });
  });
  emitir('conexao:alterada', { online: conexao.online, pendentes: pendentesSync().length });
  return r;
}

/**
 * Liga um login do Firebase (uid criado no console) a uma pessoa do cadastro (Cadastros, Dados, só admin). Com a
 * Cloud Function `aoCriarUsuarioAuth` publicada isso acontece sozinho pelo email; sem ela, é aqui.
 * @param {string} usuarioId @param {string} uid @returns {Promise<{ok:boolean, erro?:string}>}
 */
export async function vincularLoginNuvem(usuarioId, uid) {
  const eu = sessao.usuario();
  if (!nuvem.ativa()) return { ok: false, erro: 'A nuvem está desligada.' };
  if (!eu || eu.perfil !== 'admin') return { ok: false, erro: 'Só o administrador vincula logins.' };
  const u = colecaoViva('usuarios').find((x) => x.id === usuarioId);
  if (!u) return { ok: false, erro: 'Pessoa não encontrada.' };
  const uidLimpo = String(uid || '').trim();
  if (!/^[A-Za-z0-9]{20,128}$/.test(uidLimpo)) return { ok: false, erro: 'Isso não parece um uid do Firebase (letras e números, 28 caracteres).' };
  const r = await nuvem.vincularConta(usuarioId, uidLimpo, { perfil: u.perfil, email: u.email });
  if (!r.ok) return r;
  repo.transacao(() => {
    repo.atualizar('usuarios', usuarioId, { uid: uidLimpo });
    auditar({ acao: 'usuario_editado', entidade: 'usuario', entidadeId: usuarioId, rotulo: u.nome, campos: [{ campo: 'uid', rotulo: 'Login na nuvem', antes: '', depois: uidLimpo }], motivo: 'Login vinculado', setorId: null });
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Permissões e visibilidade                                           */
/* ------------------------------------------------------------------ */

const usuarioOuSessao = (usuario) => usuario || sessao.usuario();

/** @param {object} [usuario] @returns {object} mapa de caps do perfil (vazio sem usuário) */
export function capsDe(usuario) {
  const u = usuarioOuSessao(usuario);
  if (!u || !PERFIS[u.perfil]) return {};
  return PERFIS[u.perfil].caps || {};
}

/**
 * @param {string} cap @param {object} [usuario]
 * @returns {boolean|string} false, true ou o modificador
 */
export function pode(cap, usuario) {
  const valor = capsDe(usuario)[cap];
  if (!valor) return false;
  return valor === 1 || valor === true ? true : valor;
}

function pessoaNoServico(agendamento, userId) {
  if (!agendamento || !userId) return false;
  if ((agendamento.responsaveis || []).includes(userId)) return true;
  if (!agendamento.equipeId) return false;
  const eq = colecaoViva('equipes').find((e) => e.id === agendamento.equipeId);
  return !!(eq && (eq.membros || []).includes(userId));
}

/**
 * Regra de visibilidade (2.3). Serviço sem setor ("Loja", tipo livre) é visível para todo mundo que tem verSetores
 * (DIRECAO-2 2.5): não pertencer a setor nenhum significa interno, não secreto.
 */
export function visivel(agendamento, usuario) {
  const u = usuarioOuSessao(usuario);
  if (!u || !agendamento) return false;
  const caps = capsDe(u);
  if (caps.verTudo) return true;
  if (caps.verSetores) return !agendamento.setorId || (u.setores || []).includes(agendamento.setorId) || pessoaNoServico(agendamento, u.id);
  return pessoaNoServico(agendamento, u.id);
}

/**
 * Paridade com o grupo no feed de Hoje (decisão do dono, DIRECAO-2 seção 10, dúvida 2): no feed, todo perfil vê os
 * registros de todo mundo, com cliente e local, como já vê no grupo. A restrição de `visivel` continua valendo para
 * editar, para mudar status e para as demais telas. Só o lote 3 (tela Hoje) usa isto.
 * @param {object} agendamento @param {object} [usuario] @returns {boolean}
 */
export function visivelNoFeed(agendamento, usuario) {
  const u = usuarioOuSessao(usuario);
  return !!u && !!agendamento;
}

/** Setores que o usuário enxerga (todos com verTudo). */
export function setoresVisiveis(usuario) {
  const u = usuarioOuSessao(usuario);
  if (!u) return [];
  if (capsDe(u).verTudo) return SETORES.slice();
  return SETORES.filter((s) => (u.setores || []).includes(s.id));
}

/** admin, diretor, gerente ou supervisor. */
export function ehGestao(usuario) {
  const u = usuarioOuSessao(usuario);
  return !!u && ['admin', 'diretor', 'gerente', 'supervisor'].includes(u.perfil);
}

/** Ids de admin, diretor e gerente ativos. */
export function gestoresIds() {
  return colecaoViva('usuarios').filter((u) => u.ativo && ['admin', 'diretor', 'gerente'].includes(u.perfil)).map((u) => u.id);
}

/** Ids dos supervisores ativos que têm o setor. */
export function supervisoresDoSetor(setorId) {
  return colecaoViva('usuarios').filter((u) => u.ativo && u.perfil === 'supervisor' && (u.setores || []).includes(setorId)).map((u) => u.id);
}

/** @param {string} perfil @returns {string} rótulo */
export function rotuloPerfil(perfil) {
  return (PERFIS[perfil] || {}).rotulo || String(perfil || '');
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

const porId = (colecao, id) => copia(colecaoViva(colecao).find((d) => d.id === id) || null);

export function usuarioPorId(id) { return porId('usuarios', id); }
export function clientePorId(id) { return porId('clientes', id); }
export function equipePorId(id) { return porId('equipes', id); }
export function veiculoPorId(id) { return porId('veiculos', id); }
export function tipoPorId(id) { return porId('tipos', id); }
export function agendamentoPorId(id) { return porId('agendamentos', id); }

/** @param {string} id @returns {object} item de SETORES ou {id, nome:'Geral', icone:'grade'} */
export function setorPorId(id) {
  return SETORES.find((s) => s.id === id) || { id, nome: 'Geral', icone: 'grade' };
}

/* ---- Os pares id mais texto (DIRECAO-2 2.2): o id vence quando existe; o texto é o que se mostra quando não existe id.
   Toda tela passa a usar só estas quatro funções em vez de tipoPorId(a.tipoId).nome e companhia. ---- */

/** "Entrega", "Medidas para natalino" ou "Serviço". @param {object} a @returns {string} */
export function nomeDoServico(a) {
  if (!a) return 'Serviço';
  const t = a.tipoId ? colecaoViva('tipos').find((x) => x.id === a.tipoId) : null;
  return (t && t.nome) || String(a.tipoLivre || '').trim() || 'Serviço';
}

/** Nome do cliente cadastrado, o nome solto ("Fabiana") ou vazio. @param {object} a @returns {string} */
export function nomeDoCliente(a) {
  if (!a) return '';
  const c = a.clienteId ? colecaoViva('clientes').find((x) => x.id === a.clienteId) : null;
  return (c && c.nome) || String(a.clienteNome || '').trim() || '';
}

/** Apelido do carro cadastrado, o texto solto ("strada") ou vazio. @param {object} a @returns {string} */
export function nomeDoCarro(a) {
  if (!a) return '';
  const v = a.veiculoId ? colecaoViva('veiculos').find((x) => x.id === a.veiculoId) : null;
  return (v && (v.apelido || v.nome)) || String(a.veiculoTexto || '').trim() || '';
}

/** Endereço curto do cadastro ("Meia Praia, Itapema, SC"), o local solto ou vazio. @param {object} a @returns {string} */
export function localDe(a) {
  if (!a) return '';
  return util.enderecoCurto(a.endereco) || String(a.localTexto || '').trim() || '';
}

/** "Éber e Felipe", "Ryan, Daniela e Marcelo": " e " antes do último. @param {string[]} nomes @returns {string} */
export function juntarNomes(nomes) {
  const lista = util.unicos((nomes || []).map((n) => String(n || '').trim()));
  if (!lista.length) return '';
  if (lista.length === 1) return lista[0];
  return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
}

/**
 * Quem vai, para o cartão e o detalhe (DIRECAO-3 4.2): primeiro nome de cada responsável cadastrado, e o texto livre
 * de `responsavelTexto` com "(não cadastrado)" no fim. "Cleibiane e Marcelo (não cadastrado)". Vazio sem ninguém.
 * @param {object} a @returns {string}
 */
export function nomeDosResponsaveis(a) {
  if (!a) return '';
  const usuarios = colecaoViva('usuarios');
  const nomes = (a.responsaveis || []).map((id) => { const u = usuarios.find((x) => x.id === id); return u ? util.nomeCurto(u.nome) : ''; }).filter(Boolean);
  const texto = String(a.responsavelTexto || '').trim();
  if (texto) nomes.push(texto + ' (não cadastrado)');
  return juntarNomes(nomes);
}

/** Rótulo do período para a interface: "Tarde" ou, em hora exata, "14:00". @param {object} a @returns {string} */
export function rotuloPeriodo(a) {
  if (!a) return '';
  const p = a.horaAproximada && PERIODOS[a.periodo] && a.periodo !== 'hora' ? PERIODOS[a.periodo] : null;
  return p ? p.rotulo : (a.horaInicio || '');
}

const ordemHora = (a, b) => (a.horaInicio || '').localeCompare(b.horaInicio || '') || String(a.id).localeCompare(String(b.id));

/** Todos os agendamentos da data (sem filtro de visibilidade), pelo índice. */
export function agendamentosDoDia(iso) {
  const ids = indicePorData.get(iso);
  if (!ids || !ids.length) return [];
  const lista = colecaoViva('agendamentos');
  const saida = [];
  for (const id of ids) {
    const a = lista.find((x) => x.id === id);
    if (a) saida.push(copia(a));
  }
  return saida.sort(ordemHora);
}

/** Agendamentos com data entre isoIni e isoFim, inclusive. */
export function agendamentosEntre(isoIni, isoFim) {
  const saida = [];
  for (const data of indicePorData.keys()) {
    if (data >= isoIni && data <= isoFim) saida.push(...agendamentosDoDia(data));
  }
  return saida.sort((a, b) => util.compararISO(a.data, b.data) || ordemHora(a, b));
}

/** Filtra por visivel(). */
export function agendamentosVisiveis(lista, usuario) {
  const u = usuarioOuSessao(usuario);
  return (lista || []).filter((a) => visivel(a, u));
}

/** Indisponibilidades do veículo, opcionalmente cruzando o intervalo de datas. */
export function indisponibilidadesDoVeiculo(veiculoId, isoIni, isoFim) {
  return colecaoViva('indisponibilidades')
    .filter((i) => i.veiculoId === veiculoId)
    .filter((i) => {
      if (!isoIni && !isoFim) return true;
      const ini = isoIni ? isoIni + 'T00:00' : '';
      const fim = isoFim ? isoFim + 'T23:59' : '9999-12-31T23:59';
      return i.de <= fim && i.ate >= ini;
    })
    .sort((a, b) => a.de.localeCompare(b.de))
    .map(copia);
}

/**
 * Pessoas ativas. Conta compartilhada (DIRECAO-3 6.2) fica de fora: ela não é pessoa, não tem turno, não aparece no
 * quadro nem na lista de pessoas. Quem precisa dela para casar remetente usa usuariosParaAssinatura().
 */
export function usuariosAtivos() {
  return colecaoViva('usuarios').filter((u) => u.ativo && !u.contaCompartilhada).map(copia).sort(util.porNome);
}

/**
 * As contas que a tela de entrar oferece em um toque (modo local, demonstração): as pessoas ativas do seed, cada uma
 * com a senha de demonstração. Conta compartilhada e pessoa inativa ficam de fora; em modo nuvem a lista é vazia,
 * porque lá as contas são reais. @returns {{usuario:object, senha:string}[]}
 */
export function contasDemo() {
  if (nuvem.ativa()) return [];
  return usuariosAtivos().filter((u) => /@greendecor\.com\.br$/.test(String(u.email || ''))).map((usuario) => ({ usuario, senha: SENHA_DEMO }));
}

export function usuariosCampo() {
  return usuariosAtivos().filter((u) => u.campo);
}

/** As contas de setor que assinam no grupo por mais de uma pessoa ("Green Cortinas"), ativas. @returns {object[]} */
export function contasCompartilhadas() {
  return colecaoViva('usuarios').filter((u) => u.ativo && u.contaCompartilhada).map(copia).sort(util.porNome);
}

/** Pessoas ativas mais as contas compartilhadas: o `ctx.usuarios` do leitor do grupo, que precisa casar os dois. @returns {object[]} */
export function usuariosParaAssinatura() {
  return colecaoViva('usuarios').filter((u) => u.ativo).map(copia).sort(util.porNome);
}

/**
 * Casa um nome escrito ("Felipe", "Éber", "Rafa") com as pessoas ativas pelo nome, primeiro nome ou apelido, todos
 * normalizados. Devolve todos os candidatos: quem chama decide o que fazer com mais de um (DIRECAO-3 4.3, nunca no chute).
 * @param {string} texto @param {object[]} [lista] usuariosParaAssinatura() por padrão @returns {object[]}
 */
export function usuariosPorNomeOuApelido(texto, lista) {
  const alvo = util.normalizar(String(texto || '').trim()).replace(/\s+/g, ' ');
  if (!alvo) return [];
  const candidatos = lista || usuariosParaAssinatura();
  const casa = (u) => {
    const nome = util.normalizar(u.nome).replace(/\s+/g, ' ');
    if (nome === alvo || util.normalizar(util.primeiroNome(u.nome)) === alvo || util.normalizar(util.nomeCurto(u.nome)) === alvo) return true;
    return (u.apelidos || []).some((ap) => util.normalizar(ap).replace(/\s+/g, ' ') === alvo);
  };
  return candidatos.filter(casa);
}

export function equipesAtivas() {
  return colecaoViva('equipes').filter((e) => e.ativa).map(copia).sort(util.porNome);
}

export function veiculosAtivos() {
  return colecaoViva('veiculos').filter((v) => v.ativo).map(copia).sort((a, b) => (a.indiceCor || 0) - (b.indiceCor || 0) || util.porNome(a, b));
}

export function tiposAtivos() {
  return colecaoViva('tipos').filter((t) => t.ativo).map(copia).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || util.porNome(a, b));
}

function ultimoUsoPorCliente() {
  const mapa = new Map();
  for (const a of colecaoViva('agendamentos')) {
    const atual = mapa.get(a.clienteId) || 0;
    const marca = Math.max(a.criadoEm || 0, util.msDe(a.data, a.horaInicio || '00:00'));
    if (marca > atual) mapa.set(a.clienteId, marca);
  }
  return mapa;
}

/**
 * Busca clientes por nome (normalizado) ou dígitos do telefone, ordenados por uso recente.
 * @param {string} texto @param {number} [limite=8] @returns {object[]}
 */
export function clientesPorTexto(texto, limite = 8) {
  const bruto = String(texto || '').trim();
  const usos = ultimoUsoPorCliente();
  const ordenar = (lista) => lista.sort((a, b) => (usos.get(b.id) || 0) - (usos.get(a.id) || 0) || util.porNome(a, b));
  const ativos = colecaoViva('clientes').filter((c) => c.ativo !== false);
  if (!bruto) return ordenar(ativos.map(copia)).slice(0, limite);
  const digitos = util.telDigitos(bruto);
  const ehTelefone = digitos.length >= 2 && !/[a-zA-ZÀ-ÿ]/.test(bruto);
  const norm = util.normalizar(bruto);
  const achados = ativos.filter((c) => ehTelefone
    ? util.telDigitos(c.telefone).includes(digitos)
    : util.normalizar(c.nome).includes(norm));
  return ordenar(achados.map(copia)).slice(0, limite);
}

/* ------------------------------------------------------------------ */
/* Auditoria                                                           */
/* ------------------------------------------------------------------ */

function podarPorLimite(colecao, limite) {
  const lista = colecaoViva(colecao);
  if (!limite || lista.length <= limite) return;
  lista.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  substituirColecao(colecao, lista.slice(0, limite));
}

/**
 * Grava registro de auditoria (4.12): preenche id, ts, userId (sessão), origem; poda pelo limite.
 * @returns {object} registro gravado.
 */
export function auditar(registro) {
  const u = sessao.usuario();
  const doc = {
    ts: registro.ts != null ? registro.ts : agora(),
    seq: proximaSequencia(),
    userId: registro.userId !== undefined ? registro.userId : (u ? u.id : null),
    acao: registro.acao,
    entidade: registro.entidade || 'sistema',
    entidadeId: registro.entidadeId != null ? registro.entidadeId : null,
    rotulo: registro.rotulo || (ACOES_AUDITORIA[registro.acao] || registro.acao),
    campos: registro.campos && registro.campos.length ? registro.campos : null,
    motivo: registro.motivo != null && registro.motivo !== '' ? registro.motivo : null,
    setorId: registro.setorId || null,
    origem: conexao.online ? 'online' : 'fila'
  };
  return repo.transacao(() => {
    const gravado = repo.criar('auditoria', doc);
    podarPorLimite('auditoria', (repo.config().auditoriaMax) || 1000);
    return gravado;
  });
}

const nomeUsuario = (id) => { const u = colecaoViva('usuarios').find((x) => x.id === id); return u ? u.nome : (id || ''); };
const nomeSetor = (id) => setorPorId(id).nome;

const LEGIVEL = {
  status: (v) => (STATUS[v] || {}).rotulo || v,
  tipoId: (v) => { const t = colecaoViva('tipos').find((x) => x.id === v); return t ? t.nome : v; },
  setorId: nomeSetor,
  setorPadrao: nomeSetor,
  clienteId: (v) => { const c = colecaoViva('clientes').find((x) => x.id === v); return c ? c.nome : v; },
  equipeId: (v) => { const e = colecaoViva('equipes').find((x) => x.id === v); return e ? (e.apelido || e.nome) : v; },
  equipePadraoId: (v) => LEGIVEL.equipeId(v),
  veiculoId: (v) => { const ve = colecaoViva('veiculos').find((x) => x.id === v); return ve ? (ve.apelido || ve.nome) : v; },
  veiculoPadraoId: (v) => LEGIVEL.veiculoId(v),
  liderId: nomeUsuario,
  criadoPor: nomeUsuario,
  por: nomeUsuario,
  perfil: rotuloPerfil,
  precisaVeiculo: (v) => ({ sim: 'Sim', nao: 'Não', opcional: 'Opcional' }[v] || v),
  periodo: (v) => (PERIODOS[v] || {}).rotulo || v,
  origem: (v) => (ORIGENS[v] || {}).rotulo || ORIGENS_PRESENCA[v] || v,
  lugar: (v) => (LUGARES.find((l) => l.id === v) || {}).rotulo || v,
  registradoPor: nomeUsuario,
  servicoId: (v) => { const a = colecaoViva('agendamentos').find((x) => x.id === v); return a ? nomeDoServico(a) : v; },
  motivo: (v) => {
    const todos = [].concat(MOTIVOS_REAGENDAMENTO, MOTIVOS_CANCELAMENTO, MOTIVOS_NAO_REALIZADO, MOTIVOS_INDISPONIBILIDADE);
    const m = todos.find((x) => x.id === v);
    return m ? m.rotulo : v;
  }
};
const LISTAS_DE_IDS = { responsaveis: nomeUsuario, membros: nomeUsuario, setores: nomeSetor };

function valorLegivel(campo, valor) {
  if (valor == null || valor === '') return '';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (Array.isArray(valor)) {
    const fn = LISTAS_DE_IDS[campo];
    if (fn) return valor.map(fn).join(', ');
    return valor.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof valor === 'object') {
    if (campo === 'endereco') return util.enderecoTexto(valor);
    if (valor.de && valor.ate) return valor.de + ' às ' + valor.ate;
    return JSON.stringify(valor);
  }
  if (LEGIVEL[campo]) return String(LEGIVEL[campo](valor));
  const texto = String(valor);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) {
    const p = util.partesIsoHora(texto);
    return util.fmtData(p.data).slice(0, 5) + ' ' + p.hora;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return util.fmtData(texto).slice(0, 5);
  if (campo === 'concluidoEm' && typeof valor === 'number') return util.fmtDataHora(valor);
  return texto;
}

function ehComparavel(valor) {
  if (valor == null) return true;
  const t = typeof valor;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(valor)) return valor.every((v) => typeof v === 'string');
  return false;
}

const CAMPOS_IGNORADOS = new Set(['id', 'criadoEm', 'alteradoEm', 'versao', 'hash', 'sal']);

/**
 * Diferença legível entre dois documentos (nomes em vez de ids, HH:MM, dd/mm).
 * Devolve `{campo, rotulo, antes, depois}`; `rotulo` é extra ao contrato.
 */
export function diffCampos(antes, depois, campos) {
  const a = antes || {};
  const d = depois || {};
  const chaves = campos && campos.length
    ? campos
    : Array.from(new Set(Object.keys(a).concat(Object.keys(d)))).filter((k) => !CAMPOS_IGNORADOS.has(k) && ehComparavel(a[k]) && ehComparavel(d[k]));
  const saida = [];
  for (const campo of chaves) {
    if (CAMPOS_IGNORADOS.has(campo)) continue;
    const va = a[campo];
    const vd = d[campo];
    if (JSON.stringify(va === undefined ? null : va) === JSON.stringify(vd === undefined ? null : vd)) continue;
    saida.push({ campo, rotulo: rotuloCampo(campo), antes: valorLegivel(campo, va), depois: valorLegivel(campo, vd) });
  }
  return saida;
}

/** Auditoria de uma entidade em ordem cronológica. */
export function auditoriaDe(entidade, entidadeId) {
  return colecaoViva('auditoria')
    .filter((l) => l.entidade === entidade && l.entidadeId === entidadeId)
    .sort(compararAuditoria)
    .map(copia);
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

/**
 * Cria notificação (6.11): remove inativos e o autor (salvo incluirAutor), aplica prefsNotif, grava se sobrar alguém, poda.
 * @returns {object|null}
 */
export function notificar(n) {
  const autor = sessao.usuario();
  const tipo = TIPOS_NOTIFICACAO[n.tipo] ? n.tipo : 'sistema';
  const usuarios = colecaoViva('usuarios');
  const para = Array.from(new Set(n.para || [])).filter((id) => {
    const u = usuarios.find((x) => x.id === id);
    if (!u || !u.ativo) return false;
    if (!n.incluirAutor && autor && autor.id === id) return false;
    if (u.prefsNotif && u.prefsNotif[tipo] === false) return false;
    return true;
  });
  if (!para.length) return null;
  const doc = {
    tipo,
    titulo: n.titulo || TIPOS_NOTIFICACAO[tipo].rotulo,
    texto: n.texto || '',
    ts: n.ts != null ? n.ts : agora(),
    para,
    lidaPor: [],
    link: n.link || null,
    acoes: Array.isArray(n.acoes) ? n.acoes.filter((x) => x && x.rotulo && x.rota) : []
  };
  return repo.transacao(() => {
    const gravada = repo.criar('notificacoes', doc);
    podarPorLimite('notificacoes', (repo.config().notificacoesMax) || 600);
    return gravada;
  });
}

/** @param {string} userId @returns {object[]} mais recentes primeiro */
export function minhasNotificacoes(userId) {
  return colecaoViva('notificacoes')
    .filter((n) => (n.para || []).includes(userId))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .map(copia);
}

/** @param {string} userId @returns {number} */
export function naoLidas(userId) {
  return colecaoViva('notificacoes').filter((n) => (n.para || []).includes(userId) && !(n.lidaPor || []).includes(userId)).length;
}

/** @param {string} id @param {string} userId */
export function marcarLida(id, userId) {
  const n = colecaoViva('notificacoes').find((x) => x.id === id);
  if (!n || (n.lidaPor || []).includes(userId)) return;
  repo.atualizar('notificacoes', id, { lidaPor: (n.lidaPor || []).concat(userId) });
}

/** @param {string} userId Efeitos: grava uma vez, emite. */
export function marcarTodasLidas(userId) {
  let mudou = false;
  for (const n of colecaoViva('notificacoes')) {
    if (!(n.para || []).includes(userId) || (n.lidaPor || []).includes(userId)) continue;
    n.lidaPor = (n.lidaPor || []).concat(userId);
    n.alteradoEm = agora();
    n.versao = (n.versao || 0) + 1;
    enfileirar('atualizar', 'notificacoes', n.id, copia(n));
    mudou = true;
  }
  if (mudou) marcarSuja('notificacoes');
}

/* ------------------------------------------------------------------ */
/* Presenças: onde cada pessoa está no dia (DIRECAO-3, seção 2)        */
/* ------------------------------------------------------------------ */

const ORIGENS_GRAVAVEIS = ['app', 'whatsapp', 'automatico'];
const horaValida = (h) => /^\d{2}:\d{2}$/.test(String(h || ''));
const ordemDesde = (a, b) => String(a.desde || '').localeCompare(String(b.desde || '')) || String(a.id).localeCompare(String(b.id));

/** O documento de presença da pessoa no dia, ou null. Um por pessoa por dia. @param {string} userId @param {string} iso @returns {object|null} */
export function presencaDoDia(userId, iso) {
  if (!userId || !iso) return null;
  return copia(colecaoViva('presencas').find((p) => p.userId === userId && p.data === iso) || null);
}

/** Todas as presenças gravadas no dia, da mais cedo para a mais tarde. @param {string} iso @returns {object[]} */
export function presencasDoDia(iso) {
  if (!iso) return [];
  return colecaoViva('presencas').filter((p) => p.data === iso).map(copia).sort(ordemDesde);
}

/**
 * Grava onde a pessoa está no dia (2.3). Chave lógica userId mais data: a segunda marcação do mesmo dia atualiza o
 * documento e empilha no `historico`, nunca cria um segundo. `servico` nunca é gravado (é derivado). Audita
 * `presenca_marcada` na primeira do dia e `presenca_corrigida` nas seguintes, guardando quem marcou por quem, e entra
 * na fila de sincronização como qualquer escrita. Marcar por outra pessoa exige alocarRecursos ou verTudo, salvo
 * origem `automatico`, que é consequência de um registro já permitido.
 * @param {string} userId
 * @param {string} iso
 * @param {{lugar:string, lugarTexto?:string, desde?:string, origem?:string, servicoId?:string|null, mensagemOriginal?:string, registradoPor?:string}} opcoes
 * @returns {object} documento gravado
 */
export function marcarPresenca(userId, iso, opcoes = {}) {
  const lugarDef = LUGARES.find((l) => l.id === opcoes.lugar);
  if (!userId || !iso) throw new Error('Presença precisa de pessoa e data');
  if (!lugarDef || !lugarDef.gravavel) throw new Error('Lugar inválido para presença: ' + String(opcoes.lugar));
  const pessoa = colecaoViva('usuarios').find((u) => u.id === userId);
  if (!pessoa) throw new Error('Pessoa não encontrada: ' + userId);
  const quem = sessao.usuario();
  const origem = ORIGENS_GRAVAVEIS.includes(opcoes.origem) ? opcoes.origem : 'app';
  const registradoPor = opcoes.registradoPor || (quem ? quem.id : userId);
  if (registradoPor !== userId && origem !== 'automatico' && quem && !pode('alocarRecursos', quem) && !pode('verTudo', quem)) {
    throw new Error('Sem permissão para marcar presença por outra pessoa');
  }
  const lugar = lugarDef.id;
  const lugarTexto = lugar === 'outro' ? String(opcoes.lugarTexto || '').trim().slice(0, LUGAR_TEXTO_MAX) : '';
  const desde = horaValida(opcoes.desde) ? opcoes.desde : util.minParaHora(util.agoraMin());
  const servicoId = opcoes.servicoId || null;
  const mensagemOriginal = origem === 'whatsapp' ? String(opcoes.mensagemOriginal || '') : '';
  const passo = { lugar, lugarTexto, desde, ts: agora(), por: registradoPor, origem };
  const existente = colecaoViva('presencas').find((p) => p.userId === userId && p.data === iso);
  const porOutro = registradoPor !== userId ? ', marcado por ' + nomeUsuario(registradoPor) : '';
  return repo.transacao(() => {
    let gravado;
    if (existente) {
      const antes = copia(existente);
      gravado = repo.atualizar('presencas', existente.id, {
        lugar, lugarTexto, desde, origem, servicoId, registradoPor, mensagemOriginal,
        historico: (Array.isArray(existente.historico) ? existente.historico : []).concat(passo)
      });
      auditar({
        acao: 'presenca_corrigida', entidade: 'presenca', entidadeId: gravado.id, userId: registradoPor,
        rotulo: pessoa.nome + ', ' + nomeDoLugar(gravado) + ', desde ' + desde + porOutro,
        campos: diffCampos(antes, gravado, ['lugar', 'lugarTexto', 'desde', 'origem']), motivo: null, setorId: null
      });
    } else {
      gravado = repo.criar('presencas', Object.assign({}, PRESENCA_PADRAO, {
        userId, data: iso, lugar, lugarTexto, desde, origem, servicoId, registradoPor, mensagemOriginal, historico: [passo]
      }));
      auditar({
        acao: 'presenca_marcada', entidade: 'presenca', entidadeId: gravado.id, userId: registradoPor,
        rotulo: pessoa.nome + ', ' + nomeDoLugar(gravado) + ', desde ' + desde + porOutro,
        campos: [{ campo: 'lugar', rotulo: rotuloCampo('lugar'), antes: '', depois: nomeDoLugar(gravado) }], motivo: null, setorId: null
      });
    }
    return gravado;
  });
}

/* ------------------------------------------------------------------ */
/* Preferências                                                        */
/* ------------------------------------------------------------------ */

const MODO_PADRAO = { campo: 'dia', atendente: 'lista', financeiro: 'lista', supervisor: 'dia', gerente: 'recursos', diretor: 'recursos', admin: 'recursos' };

function prefsPadrao(userId) {
  const u = colecaoViva('usuarios').find((x) => x.id === userId);
  const perfil = u ? u.perfil : 'atendente';
  return { agenda: { modo: MODO_PADRAO[perfil] || 'dia', eixo: 'veiculos', filtros: {}, alertasRecolhidos: false } };
}

function mesclarSecoes(base, mudancas) {
  const saida = Object.assign({}, base);
  for (const chave of Object.keys(mudancas || {})) {
    const v = mudancas[chave];
    if (v && typeof v === 'object' && !Array.isArray(v) && saida[chave] && typeof saida[chave] === 'object') {
      saida[chave] = Object.assign({}, saida[chave], v);
    } else {
      saida[chave] = v;
    }
  }
  return saida;
}

/** @param {string} userId @returns {{agenda:{modo:string, eixo:string, filtros:object, alertasRecolhidos:boolean}}} */
export function prefs(userId) {
  const padrao = prefsPadrao(userId);
  const gravadas = lerJSON(CHAVES.prefs + userId);
  return gravadas ? mesclarSecoes(padrao, gravadas) : padrao;
}

/** @param {string} userId @param {object} mudancas mescla rasa por seção @returns {object} */
export function salvarPrefs(userId, mudancas) {
  const novas = mesclarSecoes(prefs(userId), mudancas);
  gravarChave(CHAVES.prefs + userId, JSON.stringify(novas));
  return novas;
}

const APARELHO_PADRAO = { tema: 'auto', densidade: 'confortavel', notifNativa: false, dicaAtalhosVista: false, atalhos: true };

/** atalhos: atalhos de uma tecla ligados neste aparelho (WCAG 2.1.4); Esc e Tab valem sempre. @returns {{tema:'claro'|'escuro'|'auto', densidade:'confortavel'|'compacta', notifNativa:boolean, dicaAtalhosVista:boolean, atalhos:boolean}} */
export function aparelho() {
  return Object.assign({}, APARELHO_PADRAO, lerJSON(CHAVES.aparelho) || {});
}

/** @param {object} mudancas @returns {object} */
export function salvarAparelho(mudancas) {
  const novo = Object.assign(aparelho(), mudancas || {});
  gravarChave(CHAVES.aparelho, JSON.stringify(novo));
  return novo;
}

/* ------------------------------------------------------------------ */
/* Dados de demonstração                                               */
/* ------------------------------------------------------------------ */

/** Apaga tudo, gera o seed de novo e recarrega a página. Só dadosDemo. No modo nuvem vira "baixar tudo de novo": apaga a cópia local, deixa só a estrutura e recarrega; a escuta traz o que está no Firestore. */
export async function recriarDemo() {
  const u = sessao.usuario();
  for (const chave of listarChaves()) if (chave.startsWith(CHAVES.prefixo)) apagarChave(chave);
  const seed = gerarSeed(util.hojeISO(), util.agoraMin());
  if (nuvem.ativa()) {
    await gravarSeedCompleto(seedEstrutural(seed));
    if (typeof location !== 'undefined' && location.reload) location.reload();
    return;
  }
  seed.auditoria.unshift({
    id: util.uid('l'), ts: agora(), userId: u ? u.id : null, acao: 'demo_recriada', entidade: 'sistema', entidadeId: null,
    rotulo: 'Dados de demonstração recriados', campos: null, motivo: null, setorId: null, origem: 'online',
    criadoEm: agora(), alteradoEm: agora(), versao: 1
  });
  await gravarSeedCompleto(seed);
  if (typeof location !== 'undefined' && location.reload) location.reload();
}

/** Remove clientes, agendamentos, presenças, assinaturas, notificações, auditoria e fila; mantém o resto; audita demo_limpa. No modo nuvem as remoções sobem pela fila (a auditoria da nuvem é só criação e fica; a fila é o que está subindo e não se apaga). */
export function limparDemo() {
  repo.transacao(() => {
    if (nuvem.ativa()) {
      for (const colecao of ['clientes', 'agendamentos', 'presencas', 'assinaturas', 'notificacoes']) {
        for (const d of colecaoViva(colecao)) enfileirar('remover', colecao, d.id, { id: d.id });
        substituirColecao(colecao, []);
      }
    } else {
      for (const colecao of ['clientes', 'agendamentos', 'presencas', 'assinaturas', 'notificacoes', 'auditoria', 'filaSync']) substituirColecao(colecao, []);
    }
    auditar({ acao: 'demo_limpa', entidade: 'sistema', entidadeId: null, rotulo: 'Dados de demonstração limpos', motivo: null, setorId: null });
  });
  loteAcumuladoOffline = false;
  emitir('conexao:alterada', { online: conexao.online, pendentes: 0 });
}
