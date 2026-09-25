/* Green Agenda, módulo dados: src/whatsapp.js
   A ponte com o grupo AGENDA GREEN do WhatsApp (docs/redesign/DIRECAO-2.md,
   seção 5, e docs/redesign/DIRECAO-3.md, seções 2.6, 4.3 e 5): o texto que
   sai para o grupo a partir de um registro (mensagemDoServico), o resumo do
   dia para a gerência (resumoDoDia) e a gramática tolerante que lê mensagens
   coladas do grupo (lerMensagens), com o check-in de uma palavra
   (lerPresenca) e a assinatura de dupla (lerAssinatura).
   Funções puras sobre o modelo: sem DOM, sem localStorage e sem importar
   dados.js. Tudo que precisam saber vem no contexto (ctx) que o chamador
   monta, então o módulo roda fora do navegador e testa em Node.
   Regras de escrita: nenhum travessão, nenhuma meia risca e nenhum emoji no
   que o módulo gera, com uma única exceção decidida pelo dono: o pino no
   título da mensagem, porque é assim que o grupo reconhece o formato. A
   regra "sem emoji" vale para a interface do app, não para o WhatsApp.
   A leitura aceita o pino presente ou ausente. */

import * as util from './util.js';

/* ------------------------------------------------------------------ */
/* Modelo                                                              */
/* ------------------------------------------------------------------ */

/** O pino da mensagem fixada. Única exceção à regra "sem emoji"; para tirar, é só aqui. */
export const PINO = '\u{1F4CC}';
export const TITULO = 'AGENDAMENTO DE SERVIÇO';

/** Rótulos dos campos na ordem do fixado (F3 da captura). */
export const ROTULOS = { data: 'Data', cliente: 'Cliente', periodo: 'Período', tipo: 'Tipo de serviço', local: 'Local', veiculo: 'Veículo', status: 'Status' };

/** As três caixas de status do grupo, na ordem do fixado. O "não marcado" é o Agendado. */
export const CAIXAS_STATUS = [
  { chave: 'concluido', rotulo: 'Concluído' },
  { chave: 'nao_realizado', rotulo: 'Não realizado' },
  { chave: 'em_andamento', rotulo: 'Em andamento' }
];

/** Rótulo de cada período como o grupo escreve. */
export const PERIODO_TEXTO = { manha: 'manhã', tarde: 'tarde', dia: 'dia todo' };

/* Status interno para a chave simples. Espelho de dados.STATUS_SIMPLES, repetido aqui porque este módulo não importa
   dados.js; quem chama pode passar ctx.statusSimples para sobrepor. */
const SIMPLES_PADRAO = {
  aguardando_conf: 'agendado', confirmado: 'agendado', reagendado: 'agendado',
  a_caminho: 'em_andamento', em_andamento: 'em_andamento',
  concluido: 'concluido', nao_realizado: 'nao_realizado', cancelado: 'cancelado'
};

/* Horas de cada período quando o chamador não passa ctx.horasDoPeriodo (as faixas do seed: 08:00 às 12:00 e 13:30 às
   18:30 de segunda a sexta; sábado 08:30 às 12:30, com a tarde na metade final). */
function horasPadrao(iso, periodo) {
  const sabado = util.diaSemana(iso) === 6;
  if (periodo === 'manha') return sabado ? { horaInicio: '08:30', horaFim: '12:30' } : { horaInicio: '08:00', horaFim: '12:00' };
  if (periodo === 'tarde') return sabado ? { horaInicio: '10:30', horaFim: '12:30' } : { horaInicio: '13:30', horaFim: '18:30' };
  return sabado ? { horaInicio: '08:30', horaFim: '12:30' } : { horaInicio: '08:00', horaFim: '18:30' };
}

const DURACAO_SEM_TIPO_MIN = 60;

/** Texto do modelo, para a tela de ajuda e para quem quiser copiar o formulário vazio. */
export const MODELO_MENSAGEM = [
  PINO + ' *' + TITULO + '*', '',
  '• *' + ROTULOS.data + ':*', '• *' + ROTULOS.cliente + ':*', '• *' + ROTULOS.periodo + ':*', '• *' + ROTULOS.tipo + ':*',
  '• *' + ROTULOS.local + ':*', '• *' + ROTULOS.veiculo + ':*', '', '',
  '• *' + ROTULOS.status + ':*'
].concat(CAIXAS_STATUS.map((c) => '( ) ' + c.rotulo)).join('\n');

/* Os avisos que a conferência mostra, exportados para quem quiser reconhecê-los pelo texto. */
export const AVISO_STATUS_SOLTO = 'Encontrei um bloco de status sem título e sem data. Cole a mensagem inteira, ou escolha o registro que você quer atualizar';
export const AVISO_CITACAO = 'Tirei a mensagem citada; li só a resposta';
export const AVISO_LEITURA_LIVRE = 'Li por conta própria, confira antes de gravar';
export const AVISO_SEM_DATA = 'Sem data: escreva a data como dd/mm antes de gravar';
export const AVISO_NADA = 'Não encontrei nenhuma mensagem de agendamento no texto colado';

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const primeiroTexto = (...valores) => { for (const v of valores) { const t = v == null ? '' : String(v).trim(); if (t) return t; } return ''; };

/** Sem travessão nem meia risca em nada que sai daqui, mesmo quando veio digitado assim. */
const semTravessao = (texto) => String(texto || '').replace(/[\u{2013}\u{2014}]/gu, '-');

/** Minúsculas, sem acento, sem marcadores e sem espaços: é a forma em que o título é reconhecido. */
const chaveDeLinha = (linha) => util.normalizar(linha).replace(/[*•\-◦>·\s]/g, '');

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const LARGURA_ZERO = /[\u{200B}-\u{200F}\u{FEFF}\u{2060}]/gu;
const CHECKS = /[\u{2713}\u{2714}\u{2705}\u{2611}]/gu;

/** Passo 1 da gramática: quebras de linha, espaço não separável, largura zero e emoji. Os vistos viram "(x)" antes de sair. */
function limpar(texto) {
  return String(texto || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u{A0}/gu, ' ')
    .replace(LARGURA_ZERO, '')
    .replace(CHECKS, '(x)')
    .replace(EMOJI, '');
}

/** Tira os marcadores de lista do começo da linha, inclusive combinações como "*•" e "•*". */
const semMarcador = (linha) => String(linha || '').replace(/^[\s*•\-◦>·]+/, '').trim();

/** Tira os asteriscos do negrito do WhatsApp. */
const semNegrito = (texto) => String(texto || '').replace(/\*/g, '').trim();

/** Espaço duplo vira simples; pontas limpas. */
const compactar = (texto) => String(texto || '').replace(/\s+/g, ' ').trim();

/** A linha começa com marcador de lista ("• Andry", "- Ângela", "1. Fulano"). */
const ehMarcadorDeLista = (linha) => /^\s*(?:[•\-◦>·*]+|\d{1,2}[.)])\s*\S/.test(String(linha || ''));

/* Rótulos aceitos, normalizados, do mais longo para o mais curto (para "tipo de servico" ganhar de "tipo"). */
const ROTULOS_ACEITOS = [
  ['tipo de servico', 'tipo'], ['tipo do servico', 'tipo'], ['servico', 'tipo'], ['tipo', 'tipo'],
  ['endereco', 'local'], ['lugar', 'local'], ['local', 'local'],
  ['periodo', 'periodo'], ['horario', 'periodo'], ['hora', 'periodo'],
  ['veiculo', 'veiculo'], ['carro', 'veiculo'],
  ['cliente', 'cliente'],
  ['status', 'status'],
  ['observacoes', 'obs'], ['observacao', 'obs'], ['obs', 'obs'],
  ['data', 'data'], ['dia', 'data']
].sort((a, b) => b[0].length - a[0].length);

/**
 * Passo 3: separa rótulo e valor. Primeiro tenta casar o começo da linha com um rótulo conhecido (com ou sem dois
 * pontos, o que resolve "• Cliente  Fabiana"); senão, o primeiro dois pontos separa um rótulo desconhecido, desde que
 * não seja o dois pontos de uma hora ("Atendimento hoje 09:30" não é campo).
 * @returns {{campo:string|null, rotulo:string, valor:string}|null} null quando a linha não tem cara de campo
 */
function lerCampo(linha) {
  const limpa = semNegrito(semMarcador(linha));
  if (!limpa) return null;
  const norm = util.normalizar(limpa);
  for (const [rotulo, campo] of ROTULOS_ACEITOS) {
    if (!norm.startsWith(rotulo)) continue;
    const resto = limpa.slice(rotulo.length);
    /* O rótulo precisa terminar ali: "datas" não é "data". */
    if (resto && /^[a-z0-9À-ÿ]/i.test(resto)) continue;
    const valor = resto.replace(/^\s*:?\s*/, '').replace(/\s*:\s*$/, '').trim();
    return { campo, rotulo, valor };
  }
  const pos = limpa.indexOf(':');
  if (pos > 0 && pos <= 30 && !/\d$/.test(limpa.slice(0, pos))) return { campo: null, rotulo: limpa.slice(0, pos).trim(), valor: limpa.slice(pos + 1).trim() };
  return null;
}

const STATUS_LINHA = /^[(\[]\s*([xX]?)\s*[)\]]\s*(.+)$/;
const STATUS_POR_TEXTO = [['concluido', 'concluido'], ['nao realizado', 'nao_realizado'], ['em andamento', 'em_andamento'], ['agendado', 'confirmado'], ['confirmado', 'confirmado']];
/* Mais de uma caixa marcada: vence o mais avançado. */
const PESO_STATUS = { concluido: 3, nao_realizado: 2, em_andamento: 1, confirmado: 0 };

/** Linha de caixa de status: "( x ) Concluído", "(x) Não realizado", "[ ] Em andamento". */
function lerLinhaStatus(linha) {
  const m = STATUS_LINHA.exec(semNegrito(semMarcador(linha)));
  if (!m) return null;
  const norm = util.normalizar(m[2]).trim();
  const par = STATUS_POR_TEXTO.find(([texto]) => norm.startsWith(texto));
  if (!par) return null;
  return { status: par[1], marcado: !!m[1] };
}

/** Status escrito solto, sem caixa (defeito 6 da DIRECAO-3): "Em andamento", "concluído", "não realizado". */
function statusPorTexto(texto) {
  const norm = util.normalizar(semNegrito(semMarcador(texto))).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  const par = STATUS_POR_TEXTO.find(([t]) => new RegExp('(^|\\s)' + t + '(\\s|$)').test(norm));
  return par ? par[1] : null;
}

/* Saudações e palavras de conversa que nunca são assinatura nem lugar. Do mais longo para o mais curto, para o corte
   do começo pegar "boa tarde" antes de "boa". */
const SAUDACOES_LISTA = ['bom dia a todos', 'bom dia a todas', 'bom dia pessoal', 'bom dia gente', 'bom dia galera', 'boa tarde pessoal', 'bom diaa', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'obrigada', 'pessoal', 'galera', 'gente', 'valeu', 'ola', 'oi', 'ok'];
const SAUDACOES = new Set(['bom dia', 'boa tarde', 'boa noite', 'oi', 'ola', 'obrigado', 'obrigada', 'ok', 'valeu', 'pessoal', 'gente', 'galera']);
/* Palavras que têm cara de nome mas são estado ou ritual: nunca viram assinatura. */
const NAO_ASSINATURA = new Set(['cancelado', 'cancelada', 'concluido', 'agendado', 'confirmado', 'em andamento', 'nao realizado', 'agenda', 'status', 'obs']);

/**
 * Corta as saudações do começo de um texto já normalizado e sem pontuação ("bom dia galpao" vira "galpao").
 * @returns {{resto:string, cortadas:number}} o que sobrou e quantas palavras saíram
 */
function cortarSaudacao(norm) {
  let resto = norm;
  let cortadas = 0;
  let cortou = true;
  while (cortou && resto) {
    cortou = false;
    for (const s of SAUDACOES_LISTA) {
      if (resto === s) { cortadas += s.split(' ').length; resto = ''; cortou = true; break; }
      if (resto.startsWith(s + ' ')) { cortadas += s.split(' ').length; resto = resto.slice(s.length + 1); cortou = true; break; }
    }
  }
  return { resto, cortadas };
}

/** Linha inteira é só saudação ("Bom dia!!!", "Bom dia a todos"). */
function ehSaudacao(linha) {
  const norm = util.normalizar(semNegrito(semMarcador(linha))).replace(/[!.,;?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return false;
  return !cortarSaudacao(norm).resto;
}

/** Linha solta que pode ser assinatura: até 24 caracteres, com letras, sem dois pontos e sem ser saudação. */
function pareceAssinatura(linha) {
  const limpa = semNegrito(semMarcador(linha));
  if (!limpa || limpa.length > 24 || limpa.includes(':')) return false;
  if (!/[a-zÀ-ÿ]/i.test(limpa)) return false;
  if (/\d{1,2}[\/\-.]\d{1,2}/.test(limpa)) return false;
  const norm = util.normalizar(limpa).replace(/[!.,]/g, '').trim();
  if (SAUDACOES.has(norm) || NAO_ASSINATURA.has(norm)) return false;
  return !ehSaudacao(limpa);
}

const DIAS_NOME = { domingo: 0, dom: 0, segunda: 1, seg: 1, terca: 2, ter: 2, quarta: 3, qua: 3, quinta: 4, qui: 4, sexta: 5, sex: 5, sabado: 6, sab: 6 };

/**
 * Passo 6: data em dd/mm, dd/mm/aa, dd/mm/aaaa, com "-" ou "." no lugar da barra; hoje, amanhã, depois de amanhã e nome
 * de dia da semana (próxima ocorrência, contando hoje). Sem ano, o ano corrente; caindo mais de 180 dias no passado,
 * soma um ano (o "30/12" colado em janeiro). @returns {string|null} ISO local
 */
export function lerData(valor, hoje) {
  const norm = util.normalizar(valor).trim();
  if (!norm) return null;
  if (/^hoje\b/.test(norm)) return hoje;
  if (/^depois de amanha\b/.test(norm)) return util.addDias(hoje, 2);
  if (/^amanha\b/.test(norm)) return util.addDias(hoje, 1);
  const numerica = /(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/.exec(norm);
  if (numerica) {
    const d = Number(numerica[1]);
    const m = Number(numerica[2]);
    let ano = numerica[3] ? Number(numerica[3]) : Number(hoje.slice(0, 4));
    if (numerica[3] && numerica[3].length === 2) ano += 2000;
    let iso = ano + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (!util.dataValida(iso)) return null;
    if (!numerica[3] && iso < util.addDias(hoje, -180)) {
      const proximo = (ano + 1) + iso.slice(4);
      if (util.dataValida(proximo)) iso = proximo;
    }
    return iso;
  }
  const palavra = norm.replace(/-feira\b/, '').split(/[\s,]+/)[0];
  if (palavra in DIAS_NOME) {
    const alvo = DIAS_NOME[palavra];
    const atual = util.diaSemana(hoje);
    return util.addDias(hoje, (alvo - atual + 7) % 7);
  }
  return null;
}

const DATA_NUMERICA = /\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?/;
const DATA_PALAVRA = /\b(depois de amanha|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)(-feira)?\b/;

/** O que sobra da linha da data depois de tirar a data em si ("24/09 - 11:30" vira "- 11:30"). */
function restoSemData(valor) {
  return String(valor || '')
    .replace(DATA_NUMERICA, ' ')
    .replace(/\b(depois de amanh[aã]|hoje|amanh[aã])\b/i, ' ')
    .replace(/\b(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(-feira)?\b/gi, ' ')
    .trim();
}

/** Linha que é só uma data, sem rótulo ("24/09/26", "24/09 quarta"): abre uma lista de tarefas. */
function ehLinhaSoDeData(linha, hoje) {
  const limpa = semNegrito(String(linha || '').trim());
  if (!limpa || ehMarcadorDeLista(limpa) || limpa.includes(':')) return false;
  if (!lerData(limpa, hoje)) return false;
  return restoSemData(limpa).replace(/[^a-zÀ-ÿ]/gi, '').length <= 3;
}

const HORA = /(\d{1,2})\s*(?:[:h.]\s*(\d{2})|h)?\s*(?:hrs|hr|horas|h)?\b/gi;

/**
 * Passo 7: "manhã", "tarde", "dia todo" ou uma hora ("11:00 hrs", "11h", "11 horas", "11:00"). Duas horas na mesma
 * linha viram início e fim. @returns {{periodo:'manha'|'tarde'|'dia'|'hora', horaInicio?:string, horaFim?:string}|null}
 */
export function lerPeriodo(valor) {
  const norm = util.normalizar(valor).trim();
  if (!norm) return null;
  if (/\bmanha\b/.test(norm) && !/\d/.test(norm)) return { periodo: 'manha' };
  if (/\btarde\b/.test(norm) && !/\d/.test(norm)) return { periodo: 'tarde' };
  if (/\b(dia todo|o dia|dia inteiro|integral|dia todo)\b/.test(norm)) return { periodo: 'dia' };
  const horas = [];
  HORA.lastIndex = 0;
  let m;
  while ((m = HORA.exec(norm)) && horas.length < 2) {
    const h = Number(m[1]);
    const mm = m[2] != null ? Number(m[2]) : 0;
    if (h > 23 || mm > 59) continue;
    /* Um número solto sem ":" nem "h" ("2 caixas") não é hora. */
    if (m[2] == null && !/h/i.test(m[0])) continue;
    horas.push(util.minParaHora(h * 60 + mm));
  }
  if (!horas.length) {
    if (/\bmanha\b/.test(norm)) return { periodo: 'manha' };
    if (/\btarde\b/.test(norm)) return { periodo: 'tarde' };
    return null;
  }
  if (horas.length === 2 && util.horaParaMin(horas[1]) > util.horaParaMin(horas[0])) return { periodo: 'hora', horaInicio: horas[0], horaFim: horas[1] };
  return { periodo: 'hora', horaInicio: horas[0] };
}

/* Dois períodos numa linha só (caso 2 da DIRECAO-3 5.1): "separar peça de manhã e decoracao à tarde". Sem \b depois de
   "manhã", porque o \b do JavaScript não enxerga o "ã" como letra; o lookahead faz o papel dele. */
const DOIS_PERIODOS = /(.+?)\s+(?:de |pela |na )?manh[aã](?![a-zà-ÿ])\s*(?:e|,)\s*(.+?)\s+(?:à |a |de |na )?tarde(?![a-zà-ÿ])/i;

/**
 * Casa o texto com um cadastro pelo nome ou apelido normalizados: igualdade e, se `exato` não foi pedido, inclusão
 * com resultado único.
 */
function casarCadastro(valor, lista, campos, opcoes = {}) {
  const norm = util.normalizar(valor).trim();
  if (!norm || !Array.isArray(lista)) return null;
  const nomes = (item) => campos.map((c) => util.normalizar(item[c] || '').trim()).filter(Boolean);
  const exato = lista.find((item) => nomes(item).includes(norm));
  if (exato || opcoes.exato) return exato || null;
  const parciais = lista.filter((item) => nomes(item).some((n) => n.includes(norm) || norm.includes(n)));
  return parciais.length === 1 ? parciais[0] : null;
}

/** Só letras e espaços, sem acento, para comparar nome de gente. */
const chaveDeNome = (texto) => util.normalizar(texto).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Passo 9: candidatos a uma assinatura entre os usuários ativos. Casa por nome completo, primeiro nome e apelidos
 * (DIRECAO-3 4.3), tudo normalizado sem acento; sem casamento exato, por prefixo de 4 caracteres ou mais quando o
 * resultado é único ("dani" casa com "Daniela"). Mais de um exato é ambiguidade, e quem chama decide o que fazer.
 * @returns {object[]} usuários candidatos (vazio, um, ou vários quando ambíguo)
 */
function candidatosUsuario(assinatura, usuarios) {
  const norm = chaveDeNome(assinatura);
  if (!norm || !Array.isArray(usuarios)) return [];
  const primeiro = norm.split(' ')[0];
  const ativos = usuarios.filter((u) => u && u.ativo !== false && u.nome);
  const formas = (u) => {
    const apelidos = Array.isArray(u.apelidos) ? u.apelidos : [];
    return util.unicos([chaveDeNome(u.nome), chaveDeNome(util.primeiroNome(u.nome))].concat(apelidos.map(chaveDeNome)));
  };
  const primeiros = (u) => formas(u).map((f) => f.split(' ')[0]);
  /* Nome ou apelido inteiro vence ("Green Cortinas" é uma conta só); só depois o primeiro nome ("ryan santos" é o Ryan). */
  const inteiros = ativos.filter((u) => formas(u).includes(norm));
  if (inteiros.length) return inteiros;
  const exatos = ativos.filter((u) => primeiros(u).includes(primeiro));
  if (exatos.length) return exatos;
  if (primeiro.length < 4) return [];
  const prefixo = ativos.filter((u) => primeiros(u).some((p) => p.startsWith(primeiro)));
  return prefixo.length === 1 ? prefixo : [];
}

/** Um usuário só, ou null quando não casa ou quando é ambíguo. */
function casarUsuario(assinatura, usuarios) {
  const c = candidatosUsuario(assinatura, usuarios);
  return c.length === 1 ? c[0] : null;
}

/**
 * A assinatura lida do grupo (DIRECAO-3 4.3): "Felipe/Eber", "Éber e Felipe", "Maria/ryan", "Eu e o Ryan",
 * "@~ryan santos", "Rafa". Limpa arroba, til, negrito e pontuação; quebra por "/", ",", "&", "+" e pela palavra
 * isolada " e "; "Eu" vira quem está colando; cada pedaço casa por nome, primeiro nome e apelido. Ambiguidade não
 * casa sozinha, e conta compartilhada nunca é responsável sozinha (6.2).
 * @param {string} texto a linha da assinatura
 * @param {object[]} usuarios os usuários do cadastro, com `apelidos` e `contaCompartilhada`
 * @param {{usuario?:{id:string}|null}} [ctx] quem está colando, para o "Eu"
 * @returns {{ids:string[], texto:string, ambiguos:{pedaco:string, candidatos:string[]}[], avisos:string[]}}
 *   ids na ordem da assinatura; texto é o que não casou, separado por vírgula (vira responsavelTexto)
 */
export function lerAssinatura(texto, usuarios, ctx = {}) {
  const c = ctx || {};
  const limpo = compactar(semNegrito(semMarcador(String(texto || ''))).replace(/[@~]/g, ' ')).replace(/[.!;:]+$/, '').trim();
  const ids = [];
  const ambiguos = [];
  const sobras = [];
  const avisos = [];
  if (!limpo) return { ids, texto: '', ambiguos, avisos };
  const pedacos = limpo.split(/\s*[\/,&+]\s*|\s+e\s+/i).map((p) => p.trim()).filter(Boolean);
  for (const bruto of pedacos) {
    const pedaco = bruto.replace(/^(?:o|a|os|as|com|e)\s+/i, '').trim();
    if (!pedaco) continue;
    if (chaveDeNome(pedaco) === 'eu') {
      if (c.usuario && c.usuario.id) { if (!ids.includes(c.usuario.id)) ids.push(c.usuario.id); }
      else avisos.push('A assinatura diz "Eu" e não sei quem está colando');
      continue;
    }
    const cand = candidatosUsuario(pedaco, usuarios);
    if (cand.length === 1) {
      if (cand[0].contaCompartilhada) {
        sobras.push(pedaco);
        avisos.push('"' + pedaco + '" é uma conta compartilhada: diga quem foi');
      } else if (!ids.includes(cand[0].id)) ids.push(cand[0].id);
    } else if (cand.length > 1) {
      ambiguos.push({ pedaco, candidatos: cand.map((u) => u.id) });
    } else {
      sobras.push(pedaco);
    }
  }
  return { ids, texto: sobras.join(', '), ambiguos, avisos };
}

/* ------------------------------------------------------------------ */
/* Lugares                                                             */
/* ------------------------------------------------------------------ */

/**
 * Taquigrafia de lugar (DIRECAO-3 5.1, caso 8): só o que apareceu nas capturas e as cidades que o seed já usa.
 * A normalização vale só quando a taquigrafia é o valor inteiro do campo Local: endereço de cliente nunca é reescrito.
 * "Centro" sozinho é ambíguo; adotamos Itapema, a cidade da loja, e a conferência mostra a suposição.
 */
export const LUGARES_CURTOS = [
  { escritos: ['bc', 'balneario', 'camboriu', 'balneario camboriu'], texto: 'Balneário Camboriú, SC' },
  { escritos: ['itapema'], texto: 'Itapema, SC' },
  { escritos: ['centro'], texto: 'Centro, Itapema, SC', suposicao: 'Supus Itapema para "centro"' },
  { escritos: ['itapema centro', 'centro itapema', 'centro de itapema'], texto: 'Centro, Itapema, SC' },
  { escritos: ['porto belo', 'pb'], texto: 'Porto Belo, SC' },
  { escritos: ['meia praia', 'meia praia itapema'], texto: 'Meia Praia, Itapema, SC' }
];

/** Casa um valor inteiro de Local com a taquigrafia. @returns {{texto:string, suposicao?:string}|null} */
export function lugarCurto(valor) {
  const norm = util.normalizar(valor).replace(/[\/\-,.()]+/g, ' ').replace(/\bsc\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  const achado = LUGARES_CURTOS.find((l) => l.escritos.includes(norm));
  return achado ? { texto: achado.texto, suposicao: achado.suposicao || '' } : null;
}

/* O check-in de uma ou duas palavras (DIRECAO-3 2.6), por igualdade depois de normalizar. */
const PRESENCA_POR_TEXTO = [
  { lugar: 'galpao', escritos: ['galpao', 'no galpao', 'galpao hoje', 'hoje galpao', 'deposito', 'no deposito'] },
  { lugar: 'loja', escritos: ['loja', 'em loja', 'na loja', 'loja hoje', 'hoje loja', 'showroom'] },
  { lugar: 'rua', escritos: ['na rua', 'rua', 'a caminho', 'saindo', 'em rota', 'na estrada'] },
  { lugar: 'folga', escritos: ['folga', 'de folga', 'folga hoje', 'hoje folga', 'atestado', 'ferias', 'de ferias'] },
  { lugar: 'outro', escritos: ['fora', 'externo'] }
];
const PREFIXOS_PRESENCA = /^(?:eu\s+)?(?:to|estou|hoje|ja)\s+/;

/**
 * Check-in de uma palavra (DIRECAO-3 2.6): "Galpão", "Bom dia  galpão", "Em loja". Tira saudação, pontuação repetida e
 * espaço duplo; o que sobra precisa ter até 4 palavras, sem data, sem dois pontos e sem caixa de status. Casa contra a
 * tabela fixa (e contra ctx.lugares, quando vier); qualquer outra coisa curta vira "outro" com confiança média, a não
 * ser que seja o nome de alguém do cadastro, que aí é assinatura e não lugar.
 * @param {string} texto
 * @param {{usuarios?:object[], lugares?:{id:string, rotulo?:string, curto?:string}[]}} [ctx]
 * @returns {{lugar:string, lugarTexto:string, confianca:'alta'|'media'}|null}
 */
export function lerPresenca(texto, ctx = {}) {
  const c = ctx || {};
  const linhas = limpar(texto).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const junto = compactar(linhas.join(' '));
  if (junto.includes(':') || DATA_NUMERICA.test(junto)) return null;
  if (linhas.some((l) => lerLinhaStatus(l))) return null;
  if (chaveDeLinha(junto).includes('agendamentodeservico')) return null;
  const palavrasOriginais = junto.replace(/[!?.,;]+/g, ' ').split(/\s+/).filter(Boolean);
  const corte = cortarSaudacao(util.normalizar(palavrasOriginais.join(' ')));
  const norm = corte.resto;
  const cortadas = corte.cortadas;
  if (!norm || !/[a-z]/.test(norm)) return null;
  const palavras = norm.split(' ');
  if (palavras.length > 4) return null;
  const original = palavrasOriginais.slice(cortadas).join(' ');
  const semPrefixo = norm.replace(PREFIXOS_PRESENCA, '');
  for (const par of PRESENCA_POR_TEXTO) {
    if (par.escritos.includes(norm) || par.escritos.includes(semPrefixo)) {
      return { lugar: par.lugar, lugarTexto: par.lugar === 'outro' ? original.slice(0, 40) : '', confianca: 'alta' };
    }
  }
  for (const l of (Array.isArray(c.lugares) ? c.lugares : [])) {
    if (!l || l.id === 'servico') continue;
    const formas = [l.id, l.rotulo, l.curto].filter(Boolean).map((f) => util.normalizar(f));
    if (formas.includes(norm) || formas.includes(semPrefixo)) return { lugar: l.id, lugarTexto: l.id === 'outro' ? original.slice(0, 40) : '', confianca: 'alta' };
  }
  /* "Dani" sozinho é gente, não lugar. */
  const gente = lerAssinatura(original, c.usuarios || [], c);
  if (gente.ids.length || gente.ambiguos.length) return null;
  return { lugar: 'outro', lugarTexto: original.slice(0, 40), confianca: 'media' };
}

/* ------------------------------------------------------------------ */
/* Registro para o grupo                                               */
/* ------------------------------------------------------------------ */

function textoDoPeriodo(a) {
  const periodo = a.periodo || (a.horaInicio ? 'hora' : 'dia');
  if (periodo === 'hora') return a.horaInicio ? a.horaInicio + ' hrs' : '';
  return PERIODO_TEXTO[periodo] || '';
}

/**
 * O registro no formato exato do fixado (DIRECAO-2 5.1): título com o pino, os seis campos com rótulo em negrito,
 * a assinatura sozinha numa linha e o bloco de status com as três caixas. Campo vazio sai com o rótulo e nada depois.
 * Agendado e Cancelado saem com as três caixas vazias; Cancelado ganha a linha "Cancelado." no fim.
 * @param {object} a agendamento
 * @param {{nomeServico?:string, nomeCliente?:string, nomeCarro?:string, local?:string, assinatura?:string,
 *   tipo?:object|null, cliente?:object|null, veiculo?:object|null, autor?:object|null, statusSimples?:Object<string,string>, pino?:boolean}} [ctx]
 *   os textos já resolvidos (dados.nomeDoServico e companhia) vencem; sem eles, o módulo lê os objetos e por fim o próprio registro
 * @returns {string}
 */
export function mensagemDoServico(a, ctx = {}) {
  const c = ctx || {};
  const nomeServico = primeiroTexto(c.nomeServico, c.tipo && c.tipo.nome, a.tipoLivre);
  const nomeCliente = primeiroTexto(c.nomeCliente, c.cliente && c.cliente.nome, a.clienteNome);
  const nomeCarro = primeiroTexto(c.nomeCarro, c.veiculo && (c.veiculo.apelido || c.veiculo.nome), a.veiculoTexto);
  const local = primeiroTexto(c.local, util.enderecoCurto(a.endereco), a.localTexto);
  const assinatura = primeiroTexto(c.assinatura, c.autor && util.nomeCurto(c.autor.nome), a.autorTexto);
  const simples = (c.statusSimples || SIMPLES_PADRAO)[a.status] || 'agendado';
  const campo = (rotulo, valor) => ('• *' + rotulo + ':* ' + semTravessao(valor)).trimEnd();
  const titulo = (c.pino === false ? '' : PINO + ' ') + '*' + TITULO + '*';
  const linhas = [
    titulo, '',
    campo(ROTULOS.data, a.data ? util.fmtData(a.data).slice(0, 5) : ''),
    campo(ROTULOS.cliente, nomeCliente),
    campo(ROTULOS.periodo, textoDoPeriodo(a)),
    campo(ROTULOS.tipo, nomeServico),
    campo(ROTULOS.local, local),
    campo(ROTULOS.veiculo, nomeCarro),
    ''
  ];
  if (assinatura) linhas.push(semTravessao(assinatura), '');
  linhas.push('• *' + ROTULOS.status + ':*');
  for (const caixa of CAIXAS_STATUS) linhas.push((simples === caixa.chave ? '( x ) ' : '( ) ') + caixa.rotulo);
  if (simples === 'cancelado') linhas.push('', 'Cancelado.');
  return linhas.join('\n');
}

/* ------------------------------------------------------------------ */
/* Resumo do dia                                                       */
/* ------------------------------------------------------------------ */

const GRUPOS_RESUMO = [['manha', 'Manhã'], ['tarde', 'Tarde'], ['dia', 'Dia todo'], ['sem_hora', 'Sem hora definida']];

function grupoDoResumo(a) {
  if (a.periodo === 'manha' || a.periodo === 'tarde' || a.periodo === 'dia') return a.periodo;
  if (!a.horaInicio) return 'sem_hora';
  return util.horaParaMin(a.horaInicio) < 13 * 60 ? 'manha' : 'tarde';
}

const porId = (lista, id) => (id && Array.isArray(lista) ? lista.find((x) => x && x.id === id) : null) || null;

/**
 * O dia inteiro em texto, para "Copiar o dia para o grupo" (DIRECAO-2 5.4): ordem do feed, nome curto primeiro, sem
 * telefone e sem endereço. Cancelados ficam de fora; concluído e não realizado levam o estado no fim da linha.
 * @param {object[]} lista agendamentos do dia
 * @param {string} iso a data
 * @param {{hoje:string, tipos?:object[], veiculos?:object[], usuarios?:object[], clientes?:object[], semRegistro?:string[]}} ctx
 *   semRegistro: nomes de quem está de turno e não registrou nada (a faixa de ausências do lote 3)
 * @returns {string}
 */
export function resumoDoDia(lista, iso, ctx = {}) {
  const c = ctx || {};
  const hoje = c.hoje || iso;
  const quando = iso === hoje ? 'HOJE' : iso === util.addDias(hoje, 1) ? 'AMANHÃ' : util.DIAS_SEM[util.diaSemana(iso)].toUpperCase();
  const linhas = ['*AGENDA DE ' + quando + ', ' + util.fmtData(iso).slice(0, 5) + '*'];
  const itens = (lista || []).filter((a) => a && a.status !== 'cancelado');
  /* Quem posta é quem faz (F8): o primeiro responsável assina, como o feed mostra; quem cadastrou só sem responsável. */
  const nomeDe = (a) => {
    const u = porId(c.usuarios, (a.responsaveis || [])[0]) || porId(c.usuarios, a.criadoPor);
    return u ? util.nomeCurto(u.nome) : primeiroTexto(a.autorTexto, 'Equipe');
  };
  const servicoDe = (a) => {
    const t = porId(c.tipos, a.tipoId);
    if (t) return t.nome.charAt(0).toLowerCase() + t.nome.slice(1);
    return primeiroTexto(a.tipoLivre, 'serviço');
  };
  const clienteDe = (a) => { const cl = porId(c.clientes, a.clienteId); return cl ? cl.nome : primeiroTexto(a.clienteNome); };
  const carroDe = (a) => { const v = porId(c.veiculos, a.veiculoId); return v ? (v.apelido || v.nome) : primeiroTexto(a.veiculoTexto); };
  const estadoDe = (a) => (a.status === 'concluido' ? 'concluído' : a.status === 'nao_realizado' ? 'não realizado' : '');
  for (const [chave, rotulo] of GRUPOS_RESUMO) {
    const doGrupo = itens.filter((a) => grupoDoResumo(a) === chave).sort((x, y) => (x.horaInicio || '').localeCompare(y.horaInicio || ''));
    if (!doGrupo.length) continue;
    linhas.push('', rotulo);
    for (const a of doGrupo) {
      const partes = [nomeDe(a), servicoDe(a), clienteDe(a), a.periodo === 'hora' || (!a.periodo && a.horaInicio) ? a.horaInicio : '', carroDe(a), estadoDe(a)];
      linhas.push('• ' + semTravessao(partes.filter(Boolean).join(', ')));
    }
  }
  if (!itens.length) linhas.push('', 'Nenhum registro.');
  const ausentes = (c.semRegistro || []).filter(Boolean);
  if (ausentes.length) linhas.push('', 'Sem registro ' + (iso === hoje ? 'hoje' : 'neste dia') + ': ' + ausentes.join(', '));
  return linhas.join('\n');
}

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: cortar em blocos                           */
/* ------------------------------------------------------------------ */

/* O cabeçalho que o WhatsApp põe na frente de cada mensagem quando se copiam várias de uma vez:
   "[24/09/2026, 08:53:12] Marilene Cordeiro: Bom dia  galpão", "[08:53, 24/09/2026] Marilene: ..." ou
   "24/09/2026 08:53 - Marilene: ...". Não é fato das capturas, é o formato do próprio aplicativo. */
const CABECALHO = /^\s*\[?\s*(?:(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?|(\d{1,2}:\d{2})(?::\d{2})?,?\s+(\d{1,2}\/\d{1,2}\/\d{2,4}))\s*\]?\s*-?\s*([^:]{1,60}?):\s?(.*)$/;

const horaCheia = (h) => { const [hh, mm] = String(h).split(':'); return String(hh).padStart(2, '0') + ':' + String(mm || '00').padStart(2, '0'); };

/** @returns {{data:string, hora:string, remetente:string, resto:string}|null} */
function lerCabecalho(linha) {
  const m = CABECALHO.exec(linha);
  if (!m) return null;
  return { data: m[1] || m[4], hora: horaCheia(m[2] || m[3]), remetente: compactar(m[5].replace(/^[~@\s]+/, '')), resto: m[6] };
}

const ehTitulo = (linha) => chaveDeLinha(linha).includes('agendamentodeservico');

/**
 * Passo 2: corta o texto em blocos. Toda linha cuja chave contenha "agendamentodeservico" abre um bloco; o que vem
 * antes do primeiro título é preâmbulo do primeiro bloco (é onde estão o "Bom dia" e o "Dani" da captura). Uma linha
 * com cabeçalho de mensagem copiada também abre um bloco, porque é outra mensagem. Sem nenhum título, o texto inteiro
 * é um bloco sem título.
 */
function cortarBlocos(texto) {
  const linhas = texto.split('\n');
  const blocos = [];
  let atual = null;
  let preambulo = [];
  /* Duas mensagens coladas juntas: o que vem depois da última caixa de status da anterior ("Bom dia", "Dani") é
     preâmbulo da próxima, não rabo da anterior. */
  const soltarRabo = (bloco) => {
    let ultimaCaixa = -1;
    bloco.linhas.forEach((l, i) => { if (lerLinhaStatus(l)) ultimaCaixa = i; });
    if (ultimaCaixa < 0) return [];
    const rabo = bloco.linhas.splice(ultimaCaixa + 1);
    bloco.cru.splice(bloco.cru.length - rabo.length);
    return rabo;
  };
  const novoBloco = (titulo, pre, cru, cabecalho) => {
    const b = { titulo, preambulo: pre, linhas: [], cru, cabecalho: cabecalho || null };
    blocos.push(b);
    return b;
  };
  for (const bruta of linhas) {
    let linha = bruta;
    const cab = lerCabecalho(bruta);
    if (cab) {
      /* Outra mensagem começa aqui. O preâmbulo solto de antes fica com ela. */
      atual = novoBloco(false, [], preambulo.slice(), cab);
      atual.linhas = preambulo.filter((l) => l.trim());
      preambulo = [];
      linha = cab.resto;
    }
    if (ehTitulo(linha)) {
      if (atual && !atual.titulo) {
        /* A mensagem que começou sem título ("Bom dia", "Dani") era o preâmbulo deste título. */
        atual.titulo = true;
        atual.preambulo = atual.linhas;
        atual.linhas = [];
        atual.cru.push(linha);
        continue;
      }
      if (atual) preambulo = soltarRabo(atual).concat(preambulo);
      atual = novoBloco(true, preambulo, preambulo.concat(linha), null);
      preambulo = [];
      continue;
    }
    if (!atual) { preambulo.push(linha); continue; }
    if (!cab || linha.trim()) {
      atual.linhas.push(linha);
      atual.cru.push(linha);
    }
  }
  if (!blocos.length && preambulo.some((l) => l.trim())) blocos.push({ titulo: false, preambulo: [], linhas: preambulo, cru: preambulo.slice(), cabecalho: null });
  return blocos.filter((b) => b.titulo || b.linhas.some((l) => l.trim()));
}

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: status                                     */
/* ------------------------------------------------------------------ */

/**
 * Só o status de um texto colado (o bloco cortado da captura, F6), para atualizar um registro existente a partir da
 * conferência. Aceita as caixas e também o texto solto ("Status: Em andamento", defeito 6 da DIRECAO-3).
 * @returns {'concluido'|'nao_realizado'|'em_andamento'|'confirmado'|null} null sem nenhuma caixa nem texto de status
 */
export function lerStatus(texto) {
  let achou = false;
  let melhor = null;
  const linhas = limpar(texto).split('\n');
  for (const linha of linhas) {
    const s = lerLinhaStatus(linha);
    if (!s) continue;
    achou = true;
    if (s.marcado && (!melhor || PESO_STATUS[s.status] > PESO_STATUS[melhor])) melhor = s.status;
  }
  if (achou) return melhor || 'confirmado';
  for (const linha of linhas) {
    const s = statusPorTexto(linha);
    if (s) return s;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: pessoas e horas de um registro             */
/* ------------------------------------------------------------------ */

/**
 * Entre as linhas candidatas (a última solta primeiro, depois o preâmbulo), a primeira que casa alguém ou fica
 * ambígua é a assinatura. Sem nenhuma casada, a primeira candidata vira texto de assinatura, como antes.
 */
function escolherAssinatura(candidatas, ctx) {
  for (const cand of candidatas) {
    const r = lerAssinatura(cand, ctx.usuarios, ctx);
    if (r.ids.length || r.ambiguos.length) return { assinatura: cand, leitura: r };
  }
  const primeira = candidatas[0] || '';
  return { assinatura: primeira, leitura: primeira ? lerAssinatura(primeira, ctx.usuarios, ctx) : { ids: [], texto: '', ambiguos: [], avisos: [] } };
}

/**
 * Quem cria e quem faz, a partir da assinatura lida e de quem está colando (DIRECAO-2 5.2 e DIRECAO-3 4.3).
 * A assinatura manda em "quem vai": casou alguém, os casados são os responsáveis e ninguém mais entra, nem quem
 * está colando (5.2, caso C: "Éber e Felipe" são só os dois, seja quem for que colou). Ficou ambígua ("Rafa"),
 * ninguém entra até a conferência responder, senão quem colou aparecia ao lado da pessoa escolhida. Só sem
 * assinatura nenhuma casada é que quem colou entra como responsável, e a assinatura vai para autorTexto.
 * Com capacidade plena a primeira pessoa casada é também quem cria; sem ela, quem cria é quem colou, e a
 * validação de salvarServico continua exigindo a pessoa no próprio registro (criarServico 'proprios').
 * O que não casou vira responsavelTexto.
 */
function definirPessoas(sel, ctx) {
  const quemCola = ctx.usuario && ctx.usuario.id ? ctx.usuario : null;
  const pleno = ctx.criarServico === true || ctx.criarServico === 1;
  const ids = sel.leitura.ids;
  const ambigua = sel.leitura.ambiguos.length > 0;
  let criadoPor;
  let responsaveis;
  let autorTexto;
  if (ids.length) {
    criadoPor = pleno || !quemCola ? ids[0] : quemCola.id;
    responsaveis = ids.slice();
    autorTexto = '';
  } else if (ambigua) {
    criadoPor = quemCola ? quemCola.id : null;
    responsaveis = [];
    autorTexto = '';
  } else {
    criadoPor = quemCola ? quemCola.id : null;
    responsaveis = quemCola ? [quemCola.id] : [];
    autorTexto = sel.assinatura;
  }
  return {
    criadoPor, responsaveis, autorTexto: semTravessao(autorTexto), responsavelTexto: semTravessao(sel.leitura.texto),
    autorId: ids[0] || null, assinatura: sel.assinatura, ambiguos: sel.leitura.ambiguos, avisos: sel.leitura.avisos
  };
}

/** Horas de início e fim conforme o período, o tipo e a data (as faixas de regras.horasDoPeriodo quando vierem). */
function horasDoRegistro(data, periodo, horaInicio, horaFim, tipo, ctx) {
  const iso = data || ctx.hoje;
  if (periodo === 'hora') {
    if (!horaFim) {
      const dur = tipo && Number(tipo.duracaoPadraoMin) > 0 ? Number(tipo.duracaoPadraoMin) : DURACAO_SEM_TIPO_MIN;
      horaFim = util.minParaHora(Math.min(util.horaParaMin(horaInicio) + dur, 23 * 60 + 59));
    }
    return { horaInicio, horaFim };
  }
  const h = typeof ctx.horasDoPeriodo === 'function' ? ctx.horasDoPeriodo(iso, periodo, tipo ? tipo.setorPadrao : null) : null;
  return h && h.horaInicio && h.horaFim ? { horaInicio: h.horaInicio, horaFim: h.horaFim } : horasPadrao(iso, periodo);
}

/** Cliente: nunca vincula sozinho; um resultado único vira sugestão. */
function sugerirCliente(nome, ctx) {
  if (!nome || !Array.isArray(ctx.clientes)) return null;
  const norm = util.normalizar(nome).trim();
  if (!norm) return null;
  const achados = ctx.clientes.filter((cl) => cl && cl.ativo !== false && util.normalizar(cl.nome).includes(norm));
  return achados.length === 1 ? { id: achados[0].id, nome: achados[0].nome, endereco: (achados[0].enderecos || [])[0] || null } : null;
}

/**
 * Monta um item da conferência a partir do que foi lido. `base` traz os campos já decididos; aqui entram as horas,
 * o tipo casado e a forma final no formato de `agendamentos`.
 */
function montarItem(base, ctx) {
  const tipos = (ctx.tipos || []).filter((t) => t && t.ativo !== false);
  const tipo = base.tipoTexto ? casarCadastro(base.tipoTexto, tipos, ['nome'], { exato: !!base.tipoExato }) : null;
  const avisos = base.avisos.slice();
  if (!base.tipoTexto) avisos.push('Sem tipo de serviço: escreva o que vai fazer antes de gravar');
  if (!base.data) avisos.push(AVISO_SEM_DATA);
  const horas = horasDoRegistro(base.data, base.periodo, base.horaInicio || null, base.horaFim || null, tipo, ctx);
  const veiculo = base.veiculoTexto ? casarCadastro(base.veiculoTexto, (ctx.veiculos || []).filter((v) => v && v.ativo !== false), ['apelido', 'nome']) : null;
  const status = base.status || 'confirmado';
  if (status === 'nao_realizado') avisos.push('Marcado como não realizado sem motivo: informe o motivo na conferência');
  const pessoas = base.pessoas;
  const campos = {
    tipoId: tipo ? tipo.id : null, tipoLivre: tipo ? '' : semTravessao(base.tipoTexto), setorId: tipo ? (tipo.setorPadrao || null) : null,
    data: base.data || null, periodo: base.periodo, horaInicio: horas.horaInicio, horaFim: horas.horaFim, horaAproximada: base.periodo !== 'hora',
    clienteId: null, clienteNome: semTravessao(base.clienteNome), endereco: null, localTexto: semTravessao(base.localTexto),
    veiculoId: veiculo ? veiculo.id : null, veiculoTexto: veiculo ? '' : semTravessao(base.veiculoTexto),
    responsaveis: pessoas.responsaveis, responsavelTexto: pessoas.responsavelTexto, equipeId: null, semCarroConfirmado: false,
    criadoPor: pessoas.criadoPor, autorTexto: pessoas.autorTexto,
    status, motivoNaoRealizado: null,
    obs: semTravessao(base.obs.filter(Boolean).join('\n')),
    mensagemOriginal: base.mensagemOriginal,
    origem: 'whatsapp',
    confianca: base.confianca
  };
  return {
    campos, avisos: avisos.concat(pessoas.avisos), clienteSugerido: sugerirCliente(base.clienteNome, ctx),
    assinatura: pessoas.assinatura, autorId: pessoas.autorId, confianca: base.confianca,
    ambiguos: pessoas.ambiguos, suposicoes: base.suposicoes || []
  };
}

const vazio = () => ({ itens: [], presencas: [], avisos: [], statusSolto: null });

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: o bloco com modelo                         */
/* ------------------------------------------------------------------ */

/**
 * A citação de resposta (DIRECAO-3 5.1, bônus): o texto copiado de uma resposta vem com a mensagem citada colada no
 * começo (título ou um ou dois rótulos, sem caixa de status) e depois um texto curto sem rótulo, com hora ou data
 * própria. A primeira parte é descartada e só a resposta é lida. Conservador de propósito: sempre com aviso.
 * @returns {string[]|null} as linhas da resposta, ou null quando não é citação
 */
function separarCitacao(bloco) {
  let rotulos = 0;
  let ultimoRotulo = -1;
  const linhas = bloco.linhas;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.trim()) continue;
    if (lerLinhaStatus(l)) return null;
    const campo = lerCampo(l);
    if (campo && campo.campo) { rotulos++; ultimoRotulo = i; }
  }
  if (rotulos > 2 || (!bloco.titulo && !rotulos)) return null;
  const corpo = linhas.slice(ultimoRotulo + 1).filter((l) => l.trim());
  if (!corpo.length || corpo.length > 3) return null;
  if (corpo.some((l) => { const c = lerCampo(l); return c && c.campo; })) return null;
  const temDadoProprio = corpo.some((l) => DATA_NUMERICA.test(l) || /\d{1,2}[:h]\d{2}\b|\d{1,2}\s*h\b/i.test(l) || DATA_PALAVRA.test(util.normalizar(l)));
  const temCorpo = corpo.some((l) => !pareceAssinatura(l) || /\d/.test(l));
  if (!temDadoProprio || !temCorpo) return null;
  const antes = linhas.slice(0, ultimoRotulo + 1).filter((l) => l.trim());
  return antes.length || bloco.titulo ? corpo : null;
}

function lerBloco(bloco, ctx, indice, opcoes = {}) {
  const hoje = ctx.hoje;
  if (!opcoes.semCitacao) {
    const corpo = separarCitacao(bloco);
    if (corpo) {
      const r = lerBloco({ titulo: false, preambulo: [], linhas: corpo, cru: bloco.cru, cabecalho: bloco.cabecalho }, ctx, indice, { semCitacao: true });
      r.avisos.unshift(AVISO_CITACAO);
      return r;
    }
  }
  const avisos = [];
  const campos = { data: '', cliente: '', periodo: '', tipo: '', local: '', veiculo: '' };
  const vistos = new Set();
  const obs = [];
  const soltas = [];
  const posStatus = [];
  let rotulos = 0;
  let algumaCaixa = false;
  let statusMarcado = null;
  let dentroDoStatus = false;

  for (const linha of bloco.linhas) {
    if (!linha.trim()) continue;
    const caixa = lerLinhaStatus(linha);
    if (caixa) {
      algumaCaixa = true;
      if (caixa.marcado && (!statusMarcado || PESO_STATUS[caixa.status] > PESO_STATUS[statusMarcado])) statusMarcado = caixa.status;
      continue;
    }
    const campo = lerCampo(linha);
    if (campo && campo.campo === 'status') {
      dentroDoStatus = true;
      rotulos++;
      /* "Status: Em andamento" escrito no rótulo (defeito 6): o texto solto vale como a caixa marcada. */
      if (campo.valor) { const s = lerStatus(campo.valor); if (s) statusMarcado = s; }
      continue;
    }
    if (campo && campo.campo === 'obs') { rotulos++; if (campo.valor) obs.push(campo.valor); continue; }
    if (campo && campo.campo) {
      rotulos++;
      /* O mesmo rótulo duas vezes no mesmo bloco: o primeiro vale, o segundo vira observação. */
      if (vistos.has(campo.campo)) { if (campo.valor) obs.push(campo.rotulo + ': ' + campo.valor); continue; }
      vistos.add(campo.campo);
      campos[campo.campo] = campo.valor;
      continue;
    }
    if (campo) {
      avisos.push('Não entendi o campo "' + campo.rotulo + '", ficou nas observações');
      obs.push(campo.rotulo + ': ' + campo.valor);
      continue;
    }
    if (dentroDoStatus) { posStatus.push(linha); continue; }
    soltas.push(linha);
  }

  /* Sem título, sem rótulo e sem caixa: não é o modelo. Pode ser lista, check-in ou texto livre (5.1). */
  if (!bloco.titulo && !rotulos && !algumaCaixa) return lerSemModelo(bloco, ctx, indice);

  /* Só caixas, sem título e sem data: é o status de um registro que já existe (F6). */
  if (!bloco.titulo && !campos.data && algumaCaixa && !Object.values(campos).some(Boolean) && !obs.length) {
    return { itens: [], presencas: [], avisos: [AVISO_STATUS_SOLTO], statusSolto: statusMarcado || 'confirmado' };
  }

  /* Data, e o resto da linha da data quando traz hora ("24/09 - 11:30", caso 4). */
  let data = campos.data ? lerData(campos.data, hoje) : null;
  let periodo = 'dia';
  let horaInicio = null;
  let horaFim = null;
  if (campos.data && !data) avisos.push('A data "' + campos.data + '" não é uma data que eu entenda');
  if (data && !campos.periodo) {
    const p = lerPeriodo(restoSemData(campos.data));
    if (p) { periodo = p.periodo; horaInicio = p.horaInicio || null; horaFim = p.horaFim || null; }
  }
  if (campos.periodo) {
    const p = lerPeriodo(campos.periodo);
    if (!p) {
      avisos.push('Não entendi o período "' + campos.periodo + '", ficou como dia todo');
      obs.push(ROTULOS.periodo + ': ' + campos.periodo);
    } else {
      periodo = p.periodo;
      horaInicio = p.horaInicio || null;
      horaFim = p.horaFim || null;
    }
  }

  /* Local: taquigrafia só quando é o valor inteiro (caso 8); endereço passa intocado. */
  const suposicoes = [];
  let localTexto = campos.local;
  const curto = campos.local ? lugarCurto(campos.local) : null;
  if (curto) {
    localTexto = curto.texto;
    if (curto.suposicao) { suposicoes.push(curto.suposicao); avisos.push(curto.suposicao); }
  }

  /* Assinatura: linhas soltas (a última primeiro), linhas depois do status que casam alguém, depois o preâmbulo. */
  const limpa = (l) => semNegrito(semMarcador(l));
  const candidatas = soltas.slice().reverse().map(limpa).filter(pareceAssinatura);
  const depoisDoStatus = posStatus.map(limpa).filter((l) => pareceAssinatura(l) && (() => { const r = lerAssinatura(l, ctx.usuarios, ctx); return r.ids.length || r.ambiguos.length; })());
  const doPreambulo = bloco.preambulo.slice().reverse().map(limpa).filter(pareceAssinatura);
  const sel = escolherAssinatura(candidatas.concat(depoisDoStatus, doPreambulo), ctx);
  const pessoas = definirPessoas(sel, ctx);
  for (const linha of soltas) {
    const l = limpa(linha);
    if (l && l !== sel.assinatura && !candidatas.includes(l)) obs.push(l);
  }
  for (const linha of posStatus) {
    const l = limpa(linha);
    if (l && l !== sel.assinatura && !depoisDoStatus.includes(l)) obs.push(l);
  }

  const base = {
    data, periodo, horaInicio, horaFim, clienteNome: campos.cliente, localTexto, veiculoTexto: campos.veiculo,
    status: statusMarcado || 'confirmado', obs, pessoas, avisos, suposicoes, confianca: 'alta',
    mensagemOriginal: bloco.cru.join('\n').trim(), tipoTexto: campos.tipo, tipoExato: false
  };

  /* Dois períodos na mesma linha (caso 2): um registro de manhã e outro à tarde, cada um com o seu texto. */
  const dois = campos.tipo ? DOIS_PERIODOS.exec(campos.tipo) : null;
  if (dois && dois[1].trim() && dois[2].trim()) {
    const manha = Object.assign({}, base, { periodo: 'manha', horaInicio: null, horaFim: null, tipoTexto: dois[1].trim(), tipoExato: true });
    const tarde = Object.assign({}, base, { periodo: 'tarde', horaInicio: null, horaFim: null, tipoTexto: dois[2].trim(), tipoExato: true, avisos: [] });
    return { itens: [montarItem(manha, ctx), montarItem(tarde, ctx)], presencas: [], avisos: [], statusSolto: null };
  }
  return { itens: [montarItem(base, ctx)], presencas: [], avisos: [], statusSolto: null };
}

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: sem modelo (lista, check-in, texto livre)  */
/* ------------------------------------------------------------------ */

function lerSemModelo(bloco, ctx, indice) {
  const linhas = bloco.linhas.map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return Object.assign(vazio(), { avisos: [AVISO_NADA] });
  const cru = bloco.cru.join('\n').trim();

  /* Caso 1: lista de tarefas, primeira linha só com a data e linhas em marcador. */
  if (ehLinhaSoDeData(linhas[0], ctx.hoje) && linhas.slice(1).some(ehMarcadorDeLista)) return lerLista(bloco, linhas, cru, ctx);

  /* Caso 9: check-in de uma palavra. */
  const p = lerPresenca(linhas.join('\n'), ctx);
  if (p) {
    const cab = bloco.cabecalho;
    const remetente = cab ? casarUsuario(cab.remetente, ctx.usuarios) : null;
    return {
      itens: [], statusSolto: null, avisos: [],
      presencas: [{
        userId: remetente && !remetente.contaCompartilhada ? remetente.id : null,
        assinatura: cab ? cab.remetente : '',
        lugar: p.lugar, lugarTexto: p.lugarTexto, hora: cab ? cab.hora : null, confianca: p.confianca,
        mensagemOriginal: cru
      }]
    };
  }

  /* Caso 3: texto livre. */
  return lerTextoLivre(bloco, linhas, cru, ctx);
}

/** Caso 1 (DIRECAO-3 5.1): cada linha em marcador vira um registro com a mesma data e a mesma assinatura. */
function lerLista(bloco, linhas, cru, ctx) {
  const data = lerData(linhas[0], ctx.hoje);
  const marcadas = linhas.slice(1).filter(ehMarcadorDeLista);
  const outras = linhas.slice(1).filter((l) => !ehMarcadorDeLista(l) && !ehSaudacao(l));
  const limpa = (l) => semNegrito(semMarcador(l));
  const candidatas = outras.slice().reverse().map(limpa).filter(pareceAssinatura).concat(bloco.preambulo.slice().reverse().map(limpa).filter(pareceAssinatura));
  const sel = escolherAssinatura(candidatas, ctx);
  const pessoas = definirPessoas(sel, ctx);
  const obsComuns = outras.map(limpa).filter((l) => l && l !== sel.assinatura && !candidatas.includes(l));
  const itens = marcadas.map((linha) => {
    let texto = compactar(semNegrito(semMarcador(linha)));
    let periodo = 'dia';
    let horaInicio = null;
    let horaFim = null;
    const hora = /^(\d{1,2}[:h]\d{2}|\d{1,2}\s*h)\b\s*(?:hrs|hr|horas)?\s*[-:]?\s*/i.exec(texto);
    if (hora) {
      const p = lerPeriodo(hora[1]);
      if (p && p.periodo === 'hora') { periodo = 'hora'; horaInicio = p.horaInicio; horaFim = p.horaFim || null; texto = texto.slice(hora[0].length).trim(); }
    }
    let clienteNome = '';
    const sep = /(?:\s+-\s*|\s*-\s+)/.exec(texto);
    if (sep && sep.index > 0) {
      clienteNome = texto.slice(0, sep.index).trim();
      texto = texto.slice(sep.index + sep[0].length).trim();
    }
    let localTexto = '';
    const obs = [];
    const suposicoes = [];
    const parenteses = /\(([^()]*)\)\s*$/.exec(texto);
    if (parenteses) {
      const conteudo = parenteses[1].trim();
      const curto = lugarCurto(conteudo);
      if (curto) { localTexto = curto.texto; if (curto.suposicao) suposicoes.push(curto.suposicao); }
      else if (conteudo) obs.push(conteudo);
      texto = texto.slice(0, parenteses.index).trim();
    }
    return montarItem({
      data, periodo, horaInicio, horaFim, clienteNome, localTexto, veiculoTexto: '',
      status: 'confirmado', obs: obs.concat(obsComuns), pessoas, avisos: suposicoes.slice(), suposicoes, confianca: 'media',
      mensagemOriginal: cru, tipoTexto: texto, tipoExato: true
    }, ctx);
  });
  return { itens, presencas: [], avisos: [], statusSolto: null };
}

/** Texto igual em tamanho ao original, minúsculo e sem acento, para achar posições e cortar no original. */
function alinhado(texto) {
  return String(texto || '').split('').map((ch) => { const n = util.normalizar(ch); return n.length === 1 ? n : ch.toLowerCase(); }).join('');
}

/** Corta do original tudo o que a regex casa no texto alinhado. */
function cortarPor(texto, regex) {
  const norm = alinhado(texto);
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let saida = '';
  let pos = 0;
  let m;
  while ((m = re.exec(norm))) {
    saida += texto.slice(pos, m.index) + ' ';
    pos = m.index + m[0].length;
    if (!m[0].length) re.lastIndex++;
  }
  return saida + texto.slice(pos);
}

const HORA_SOLTA = /\b\d{1,2}:\d{2}\s*(?:hrs|hr|horas|h)?\b|\b\d{1,2}\s*h(?:rs|oras)?\b/;
const FRASE_PERIODO = /\b(?:agora\s+)?(?:de\s+|pela\s+|a\s+|na\s+|no\s+)?(?:manha|tarde|dia todo|dia inteiro)\b\s*,?/;
const FRASE_CLIENTE = /\b(?:no|na|do|da|o|a)?\s*cliente\s+([^,.;]+)[,.;]?/i;

/**
 * Caso 3 (DIRECAO-3 5.1): texto corrido sem modelo. Data por "hoje", "amanhã", dia da semana ou dd/mm (senão hoje);
 * período por "de manhã", "à tarde" ou uma hora; cliente só quando a palavra "cliente" está escrita certa; assinatura na
 * última linha; o resto vira o que vai ser feito. Confiança baixa, e sempre com o aviso para conferir.
 */
function lerTextoLivre(bloco, todas, cru, ctx) {
  const linhas = todas.filter((l) => !ehSaudacao(l));
  if (!linhas.length) return Object.assign(vazio(), { avisos: [AVISO_NADA] });
  let assinaturaLinha = '';
  const ultima = linhas[linhas.length - 1];
  if (linhas.length > 1 && (pareceAssinatura(ultima) || /^eu\s+e\b/.test(util.normalizar(ultima)))) {
    assinaturaLinha = semNegrito(semMarcador(ultima));
    linhas.pop();
  }
  let corpo = compactar(linhas.map((l) => semNegrito(semMarcador(l))).join(' '));
  if (!assinaturaLinha) {
    /* "Atendimento hoje 09:30 - rafa": o nome no fim da linha, depois do traço. */
    const m = /\s+-\s+([^-]{1,24})$/.exec(corpo);
    if (m && pareceAssinatura(m[1])) {
      const r = lerAssinatura(m[1], ctx.usuarios, ctx);
      if (r.ids.length || r.ambiguos.length) { assinaturaLinha = m[1].trim(); corpo = corpo.slice(0, m.index).trim(); }
    }
  }
  if (corpo.split(' ').filter((p) => /[a-zÀ-ÿ]/i.test(p)).length < 2 && !assinaturaLinha) return Object.assign(vazio(), { avisos: [AVISO_NADA] });

  let data = null;
  const norm = alinhado(corpo);
  const mNum = DATA_NUMERICA.exec(norm);
  if (mNum) data = lerData(mNum[0], ctx.hoje);
  if (data) corpo = cortarPor(corpo, DATA_NUMERICA);
  else {
    const mPal = DATA_PALAVRA.exec(norm);
    if (mPal) { data = lerData(mPal[1], ctx.hoje); if (data) corpo = cortarPor(corpo, new RegExp('\\b' + mPal[0] + '\\b')); }
  }
  if (!data) data = ctx.hoje;

  const p = lerPeriodo(corpo);
  let periodo = 'dia';
  let horaInicio = null;
  let horaFim = null;
  if (p) {
    periodo = p.periodo;
    horaInicio = p.horaInicio || null;
    horaFim = p.horaFim || null;
    corpo = periodo === 'hora' ? cortarPor(corpo, HORA_SOLTA) : cortarPor(corpo, FRASE_PERIODO);
  }

  let clienteNome = '';
  const mCliente = FRASE_CLIENTE.exec(corpo);
  if (mCliente && mCliente[1].trim()) {
    clienteNome = compactar(mCliente[1]);
    corpo = corpo.slice(0, mCliente.index) + ' ' + corpo.slice(mCliente.index + mCliente[0].length);
  }

  const tipoTexto = compactar(corpo).replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, '');
  const sel = escolherAssinatura(assinaturaLinha ? [assinaturaLinha] : bloco.preambulo.slice().reverse().map((l) => semNegrito(semMarcador(l))).filter(pareceAssinatura), ctx);
  const pessoas = definirPessoas(sel, ctx);
  const item = montarItem({
    data, periodo, horaInicio, horaFim, clienteNome, localTexto: '', veiculoTexto: '',
    status: 'confirmado', obs: [], pessoas, avisos: [AVISO_LEITURA_LIVRE], suposicoes: [], confianca: 'baixa',
    mensagemOriginal: cru, tipoTexto, tipoExato: true
  }, ctx);
  return { itens: [item], presencas: [], avisos: [], statusSolto: null };
}

/* ------------------------------------------------------------------ */
/* Leitura do texto colado: a entrada                                  */
/* ------------------------------------------------------------------ */

/**
 * A gramática tolerante (DIRECAO-2 5.2 e DIRECAO-3 5): lê uma ou várias mensagens coladas e devolve os registros
 * entendidos, os check-ins de presença e os avisos, prontos para a tela de conferência. Nada é gravado aqui.
 * @param {string} texto o que foi colado
 * @param {{hoje:string, tipos?:object[], veiculos?:object[], usuarios?:object[], clientes?:object[], lugares?:object[],
 *   usuario?:{id:string, perfil:string}|null, criarServico?:boolean|number|string, horasDoPeriodo?:Function}} ctx
 *   hoje é obrigatório (ISO local). usuarios deve trazer `apelidos` e `contaCompartilhada`, e incluir as contas
 *   compartilhadas para a ambiguidade de "Rafa" aparecer. usuario é quem está colando e criarServico o valor de
 *   dados.pode('criarServico'); com capacidade plena a assinatura casada vira criadoPor e responsáveis, senão vai para
 *   autorTexto e criadoPor é quem colou. horasDoPeriodo(iso, periodo, setorId) é regras.horasDoPeriodo; sem ela, as
 *   faixas padrão do seed. lugares é dados.LUGARES, opcional, para o check-in casar também pelo rótulo.
 * @returns {{registros:{campos:object, avisos:string[], clienteSugerido:{id:string, nome:string, endereco:object|null}|null,
 *   assinatura:string, autorId:string|null, confianca:'alta'|'media'|'baixa', ambiguos:{pedaco:string, candidatos:string[]}[],
 *   suposicoes:string[]}[], presencas:{userId:string|null, assinatura:string, lugar:string, lugarTexto:string, hora:string|null,
 *   confianca:'alta'|'media', mensagemOriginal:string}[], avisos:string[], statusSolto:string|null}}
 *   campos é o candidato no formato de `agendamentos` (data, periodo, horaInicio, horaFim, horaAproximada, tipoId, tipoLivre,
 *   clienteNome, localTexto, veiculoId, veiculoTexto, responsaveis, responsavelTexto, criadoPor, autorTexto, status, obs,
 *   mensagemOriginal, origem), mais confianca; data fica null quando não veio, e o aviso pede para escrever.
 *   confianca: 'alta' veio do modelo, 'media' de uma lista, 'baixa' de texto livre. ambiguos: pedaços da assinatura que
 *   casaram com mais de uma pessoa; nada deve ser gravado com ambiguidade aberta. avisos (do topo) são os blocos que não
 *   viraram registro; statusSolto é o status de um bloco só de caixas, para atualizar um registro existente.
 */
export function lerMensagens(texto, ctx = {}) {
  const c = Object.assign({ hoje: util.hojeISO() }, ctx || {});
  const blocos = cortarBlocos(limpar(texto));
  const registros = [];
  const presencas = [];
  const avisos = [];
  let statusSolto = null;
  if (!blocos.length) return { registros, presencas, avisos: ['Cole a mensagem do grupo na caixa de texto'], statusSolto };
  blocos.forEach((bloco, i) => {
    const r = lerBloco(bloco, c, i);
    for (const item of r.itens) registros.push(item);
    for (const p of r.presencas) presencas.push(p);
    for (const a of r.avisos) avisos.push(a);
    if (r.statusSolto) statusSolto = r.statusSolto;
  });
  return { registros, presencas, avisos, statusSolto };
}
