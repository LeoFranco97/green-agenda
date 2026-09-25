/* Green Agenda, módulo dados: src/util.js
   Utilitários puros de data, formato, id, escape, telefone e endereço.
   Sem estado, sem DOM (exceto $ e $$), sem acesso a storage.
   Datas de calendário sempre em ISO local 'AAAA-MM-DD', nunca toISOString.
   Horas em 'HH:MM', instantes em milissegundos. */

/** Atalho para document.querySelector. @param {string} seletor @returns {Element|null} */
export const $ = (seletor) => document.querySelector(seletor);
/** Atalho para document.querySelectorAll como array. @param {string} seletor @returns {Element[]} */
export const $$ = (seletor) => Array.from(document.querySelectorAll(seletor));

const MAPA_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapa & < > " ' para inserir texto em HTML. Aceita null e undefined (vira '').
 * @param {*} texto @returns {string}
 */
export function esc(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => MAPA_ESCAPE[c]);
}

/**
 * Gera id único: prefixo + '_' + tempo em base36 + 5 caracteres aleatórios.
 * @param {string} prefixo ex. 'a', 'c', 'n'
 * @returns {string}
 */
export function uid(prefixo) {
  return (prefixo || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Nomes de meses e dias em minúsculas, pt-BR. */
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DIAS_SEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const DIAS_ABR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const dois = (n) => String(n).padStart(2, '0');

/* ---------------- Datas ---------------- */

/** ISO local 'AAAA-MM-DD' para Date local (meia-noite), sem fuso. @param {string} iso @returns {Date} */
export function dataDe(iso) {
  const [a, m, d] = String(iso || '').split('-').map(Number);
  return new Date(a || 1970, (m || 1) - 1, d || 1);
}

/** Date para ISO local 'AAAA-MM-DD'. @param {Date} data @returns {string} */
export function isoDe(data) {
  return data.getFullYear() + '-' + dois(data.getMonth() + 1) + '-' + dois(data.getDate());
}

/** Data existe de fato (ida e volta pelo calendário): '2026-02-31' falha, '2026-03-03' passa. @param {string} iso @returns {boolean} */
export function dataValida(iso) {
  const texto = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && isoDe(dataDe(texto)) === texto;
}

/** ISO de hoje. @returns {string} */
export function hojeISO() {
  return isoDe(new Date());
}

/** Minutos desde a meia-noite, agora. @returns {number} */
export function agoraMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Soma n dias (negativo permitido). @param {string} iso @param {number} n @returns {string} */
export function addDias(iso, n) {
  const d = dataDe(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
}

/** Soma n meses mantendo o dia; se o dia não existe, usa o último do mês. @param {string} iso @param {number} n @returns {string} */
export function addMeses(iso, n) {
  const d = dataDe(iso);
  const dia = d.getDate();
  const alvo = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(dia, ultimo));
  return isoDe(alvo);
}

/** Dia da semana 0 (domingo) a 6. @param {string} iso @returns {number} */
export function diaSemana(iso) {
  return dataDe(iso).getDay();
}

/** Segunda-feira da semana da data. @param {string} iso @returns {string} */
export function inicioSemana(iso) {
  const ds = diaSemana(iso);
  return addDias(iso, ds === 0 ? -6 : 1 - ds);
}

/** Dia 1 do mês da data. @param {string} iso @returns {string} */
export function inicioMes(iso) {
  return String(iso).slice(0, 8) + '01';
}

/** Quantidade de dias no mês da data. @param {string} iso @returns {number} */
export function diasNoMes(iso) {
  const d = dataDe(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Compara duas ISO: negativo, zero ou positivo. @param {string} a @param {string} b @returns {number} */
export function compararISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------- Formatos ---------------- */

/** 'dd/mm/aaaa'. @param {string} iso @returns {string} */
export function fmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).split('-');
  return d + '/' + m + '/' + a;
}

/** '8 set'. @param {string} iso @returns {string} */
export function fmtDataCurta(iso) {
  if (!iso) return '';
  const d = dataDe(iso);
  return d.getDate() + ' ' + MESES_ABR[d.getMonth()];
}

/** 'ter, 8 de set'. @param {string} iso @returns {string} */
export function fmtDataMedia(iso) {
  if (!iso) return '';
  const d = dataDe(iso);
  return DIAS_ABR[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES_ABR[d.getMonth()];
}

/** 'terça-feira, 8 de setembro'. @param {string} iso @returns {string} */
export function fmtDataExtensa(iso) {
  if (!iso) return '';
  const d = dataDe(iso);
  return DIAS_SEM[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()];
}

/** 'Hoje', 'Amanhã', 'Ontem' ou fmtDataMedia. @param {string} iso @returns {string} */
export function rotuloDia(iso) {
  const h = hojeISO();
  if (iso === h) return 'Hoje';
  if (iso === addDias(h, 1)) return 'Amanhã';
  if (iso === addDias(h, -1)) return 'Ontem';
  return fmtDataMedia(iso);
}

/** 'HH:MM' de um instante em ms. @param {number} ts @returns {string} */
export function fmtHora(ts) {
  const d = new Date(ts);
  return dois(d.getHours()) + ':' + dois(d.getMinutes());
}

/** 'dd/mm/aaaa HH:MM' de um instante em ms. @param {number} ts @returns {string} */
export function fmtDataHora(ts) {
  const d = new Date(ts);
  return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + fmtHora(ts);
}

/** '08:30 às 10:00'. @param {string} horaInicio @param {string} horaFim @returns {string} */
export function fmtIntervalo(horaInicio, horaFim) {
  return (horaInicio || '') + ' às ' + (horaFim || '');
}

/** '1 h 30', '45 min', '2 h'. @param {number} minutos @returns {string} */
export function fmtDuracao(minutos) {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? h + ' h ' + dois(resto) : h + ' h';
}

/** 'agora', 'há 5 min', 'há 2 h', 'ontem', 'há 3 dias'. @param {number} ts @returns {string} */
export function tempoRelativo(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : 'há ' + d + ' dias';
}

/** 'HH:MM' para minutos desde a meia-noite; vazio ou inválido devolve 0. @param {string} hora @returns {number} */
export function horaParaMin(hora) {
  if (!hora || typeof hora !== 'string') return 0;
  const [hh, mm] = hora.split(':').map(Number);
  if (Number.isNaN(hh)) return 0;
  return hh * 60 + (Number.isNaN(mm) ? 0 : mm || 0);
}

/** Minutos para 'HH:MM'. @param {number} minutos @returns {string} */
export function minParaHora(minutos) {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  return dois(Math.floor(m / 60)) + ':' + dois(m % 60);
}

/**
 * Arredonda minutos ao múltiplo de passo: 'baixo', 'cima' ou 'perto'.
 * @param {number} minutos @param {number} passo @param {'baixo'|'cima'|'perto'} [modo='perto'] @returns {number}
 */
export function arredondarMin(minutos, passo, modo = 'perto') {
  const p = Number(passo) || 1;
  const fator = modo === 'baixo' ? Math.floor : modo === 'cima' ? Math.ceil : Math.round;
  return fator(minutos / p) * p;
}

/** Monta 'AAAA-MM-DDTHH:MM'. @param {string} iso @param {string} hora @returns {string} */
export function isoHora(iso, hora) {
  return iso + 'T' + hora;
}

/** Separa 'AAAA-MM-DDTHH:MM' em {data, hora}. @param {string} isoHora @returns {{data:string, hora:string}} */
export function partesIsoHora(isoHora) {
  const [data, hora] = String(isoHora || '').split('T');
  return { data: data || '', hora: (hora || '').slice(0, 5) };
}

/** Instante em ms de uma data ISO e hora 'HH:MM' locais. @param {string} iso @param {string} hora @returns {number} */
export function msDe(iso, hora) {
  const d = dataDe(iso);
  d.setMinutes(horaParaMin(hora || '00:00'));
  return d.getTime();
}

/* ---------------- Nomes, texto, telefone, endereço ---------------- */

/** Iniciais: primeiro e último nome. @param {string} nome @returns {string} */
export function iniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Primeiro nome. @param {string} nome @returns {string} */
export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

/** Primeiro nome; mantém a segunda palavra quando a primeira é curta demais para identificar ("Ana Vitória"). @param {string} nome @returns {string} */
export function nomeCurto(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  return partes[0].length <= 3 && partes[1] ? partes[0] + ' ' + partes[1] : partes[0];
}

/** "1 serviço", "3 serviços". @param {number} n @param {string} singular @param {string} pluralTexto @returns {string} */
export function plural(n, singular, pluralTexto) {
  return n + ' ' + (n === 1 ? singular : pluralTexto);
}

/** Lista sem repetidos e sem vazios, na ordem de entrada. @param {Array} [lista] @returns {Array} */
export function unicos(lista) {
  return Array.from(new Set((lista || []).filter(Boolean)));
}

/** Comparação estrutural (JSON) tratando undefined como null. @param {*} x @param {*} y @returns {boolean} */
export function difere(x, y) {
  return JSON.stringify(x === undefined ? null : x) !== JSON.stringify(y === undefined ? null : y);
}

/** Classe de cor do veículo, 'carro-1' a 'carro-5' (indiceCor fora da faixa cai em 1). @param {{indiceCor?:number}|null} veiculo @returns {string} */
export function classeCarro(veiculo) {
  const n = veiculo && Number(veiculo.indiceCor) >= 1 && Number(veiculo.indiceCor) <= 5 ? Number(veiculo.indiceCor) : 1;
  return 'carro-' + n;
}

/** Comparador por campo nome em pt-BR, para sort. @param {{nome:string}} a @param {{nome:string}} b @returns {number} */
export function porNome(a, b) {
  return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
}

/** Minúsculas sem acento, para busca. @param {string} texto @returns {string} */
export function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Só dígitos. @param {string} telefone @returns {string} */
export function telDigitos(telefone) {
  return String(telefone || '').replace(/\D/g, '');
}

/** '(47) 99999-9999' quando há 11 dígitos, '(47) 3333-4444' com 10; senão devolve o original. @param {string} telefone @returns {string} */
export function telFmt(telefone) {
  const n = telDigitos(telefone);
  if (n.length === 11) return '(' + n.slice(0, 2) + ') ' + n.slice(2, 7) + '-' + n.slice(7);
  if (n.length === 10) return '(' + n.slice(0, 2) + ') ' + n.slice(2, 6) + '-' + n.slice(6);
  return telefone == null ? '' : String(telefone);
}

/** 'tel:+55DDDNUMERO' com 10 ou 11 dígitos; senão 'tel:' + dígitos. @param {string} telefone @returns {string} */
export function telHref(telefone) {
  const n = telDigitos(telefone);
  if (n.length === 10 || n.length === 11) return 'tel:+55' + n;
  return 'tel:' + n;
}

/** 'https://wa.me/55<digitos>?text=<mensagem codificada>'. @param {string} telefone @param {string} [mensagem] @returns {string} */
export function waHref(telefone, mensagem) {
  let n = telDigitos(telefone);
  if ((n.length === 10 || n.length === 11) && !n.startsWith('55')) n = '55' + n;
  else if (n.length === 12 || n.length === 13) n = n.startsWith('55') ? n : '55' + n;
  const base = 'https://wa.me/' + n;
  return mensagem ? base + '?text=' + encodeURIComponent(mensagem) : base;
}

/** 'logradouro, complemento, bairro, cidade' pulando vazios. @param {object|null} endereco @returns {string} */
export function enderecoTexto(endereco) {
  if (!endereco) return '';
  return [endereco.logradouro, endereco.complemento, endereco.bairro, endereco.cidade]
    .map((p) => String(p || '').trim()).filter(Boolean).join(', ');
}

/** 'bairro, cidade' pulando vazios. @param {object|null} endereco @returns {string} */
export function enderecoCurto(endereco) {
  if (!endereco) return '';
  return [endereco.bairro, endereco.cidade].map((p) => String(p || '').trim()).filter(Boolean).join(', ');
}

/* ---------------- Diversos ---------------- */

/** PRNG com semente (mulberry32), para seed estável. @param {number} semente @returns {() => number} */
export function criarAleatorio(semente) {
  let s = semente >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Debounce simples. @param {Function} fn @param {number} ms @returns {Function} */
export function debounce(fn, ms) {
  let timer = null;
  const atrasada = function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, ms);
  };
  atrasada.cancelar = () => { clearTimeout(timer); timer = null; };
  return atrasada;
}

/** Limita v a [minimo, maximo]. @param {number} v @param {number} minimo @param {number} maximo @returns {number} */
export function clamp(v, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, v));
}

/** Agrupa por chave devolvida por fn, preservando a ordem de entrada. @param {Array} lista @param {Function} fnChave @returns {Map<*, Array>} */
export function agrupar(lista, fnChave) {
  const mapa = new Map();
  for (const item of lista || []) {
    const chave = fnChave(item);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
  }
  return mapa;
}

/** SHA-256 hex via crypto.subtle; em contexto sem subtle (http fora de localhost), usa implementação local. @param {string} texto @returns {Promise<string>} */
export async function hashTexto(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && subtle.digest) {
    const buf = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Local(bytes);
}

/* SHA-256 em JavaScript puro, só como reserva quando crypto.subtle não existe. */
const K_SHA = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Local(bytes) {
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const tam = bytes.length;
  const blocos = Math.ceil((tam + 9) / 64);
  const msg = new Uint8Array(blocos * 64);
  msg.set(bytes);
  msg[tam] = 0x80;
  const bits = tam * 8;
  const visao = new DataView(msg.buffer);
  visao.setUint32(msg.length - 4, bits >>> 0);
  visao.setUint32(msg.length - 8, Math.floor(bits / 4294967296));
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let b = 0; b < blocos; b++) {
    for (let i = 0; i < 16; i++) w[i] = visao.getUint32(b * 64 + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K_SHA[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h = [a, bb, c, d, e, f, g, hh].map((v, i) => (h[i] + v) >>> 0);
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}

/** 8 caracteres aleatórios [a-z0-9] para sal de senha. @returns {string} */
export function salAleatorio() {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let saida = '';
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) saida += alfabeto[b % alfabeto.length];
    return saida;
  }
  for (let i = 0; i < 8; i++) saida += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return saida;
}

/** Monta CSV com ';' e aspas onde preciso. @param {string[]} cabecalho @param {Array<Array<string|number>>} linhas @returns {string} */
export function csvDe(cabecalho, linhas) {
  const celula = (v) => {
    const t = v == null ? '' : String(v);
    return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const todas = [cabecalho || []].concat(linhas || []);
  return todas.map((l) => l.map(celula).join(';')).join('\r\n');
}
