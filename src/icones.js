/* Green Agenda, módulo ui: src/icones.js
   Dicionário de ícones SVG em linha (24 x 24, stroke currentColor,
   stroke-width 1.75, fill none, pontas e cantos redondos, estilo Feather) e
   o helper icone(). Conjunto exato na ESPECIFICACAO.md, seção 11.6.
   Os desenhos de calendário, lista, grade, sino, busca, filtro, setas,
   usuário, caminhão, carro, telefone, mapa, relógio, alerta, engrenagem,
   escudo, sair, editar, lixeira, sincronizar, wifi, cadeado, olho, chave,
   compartilhar, play, copiar, ban, pausa, histórico, caixa, sofá, cortina,
   casa, nota, pontos e info vieram do v1 (app/index.html, linhas 894 a 968).
   Os demais foram desenhados para o v2; "loja" (toldo mais porta) para o v3 e
   "galpao" (barracão com porta de enrolar) para o v4, que é o lugar novo da
   faixa "Onde estou" (docs/redesign/DIRECAO-3.md, 2.1). */

/**
 * Mapa nome para o miolo do SVG (só os elementos internos, sem a tag svg).
 * @type {Object<string, string>}
 */
export const ICONES = {
  /* Navegação e calendário */
  calendario: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  calmais: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grade: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  casa: '<path d="m3 10.5 9-7.5 9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  voltar: '<path d="m15 18-6-6 6-6"/>',
  direita: '<path d="m9 18 6-6-6-6"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  cima: '<path d="m18 15-6-6-6 6"/>',
  filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  sino: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  pontos: '<path d="M12 5h.01M12 12h.01M12 19h.01"/>',

  /* Pessoas e recursos */
  usuario: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  caminhao: '<path d="M1 4h15v12H1z"/><path d="M16 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="19" r="2"/><circle cx="18.5" cy="19" r="2"/>',
  carro: '<path d="m5 11 1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11"/><path d="M4 11h16a2 2 0 0 1 2 2v4h-2.5M2 17v-4a2 2 0 0 1 2-2M9 17.5h6"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  oficina: '<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>',

  /* Contato */
  mapa: '<path d="M12 21s-7-5.75-7-11a7 7 0 0 1 14 0c0 5.25-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  telefone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
  whatsapp: '<path d="M3 21l1.7-4.6A8.5 8.5 0 1 1 7.7 19.4Z"/><path d="M9.3 8.6c.1-.4.7-.7 1-.5l.9 1.8c.1.2 0 .5-.2.7l-.5.5a5.5 5.5 0 0 0 2.6 2.6l.5-.5c.2-.2.5-.3.7-.2l1.8.9c.2.3-.1.9-.5 1-1 .4-2.1 0-3.3-.8a10 10 0 0 1-2.7-2.7c-.8-1.2-1.2-2.3-.8-3.3Z"/>',
  compartilhar: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4M12 2v13"/>',
  copiar: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',

  /* Ações e estados */
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkduplo: '<path d="m2 13.5 4.5 4.5L17 7"/><path d="m11 16 2 2L23 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  editar: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  lixeira: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  escudo: '<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z"/><path d="m9 11.5 2 2 4-4.5"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  sincronizar: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01M1.42 9a16 16 0 0 1 21.16 0"/>',
  wifioff: '<path d="m1 1 22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  cadeado: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  olho: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  olhooff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22"/>',
  historico: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  play: '<path d="M7 4.5 20 12 7 19.5Z"/>',
  pausa: '<path d="M9 5v14M15 5v14"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  assinatura: '<path d="M3 17c2.5-6 5-9 6-8s-2 7 0 7 3-6 5-6 1 5 3 5 2-2 4-2"/><path d="M3 21h18"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  lua: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  nota: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  ordenar: '<path d="m8 18 4 4 4-4M8 6l4-4 4 4M12 2v20"/>',
  duplicar: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1"/><path d="M14.5 11.5v6M11.5 14.5h6"/>',
  instalar: '<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  teclado: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
  atalho: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z"/>',

  /* Tipos de serviço */
  caixa: '<path d="m21 8-9-5-9 5v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 21v-8"/>',
  caixaseta: '<path d="M21 12v4l-9 5-9-5V8l9-5 3.5 1.9"/><path d="m3 8 9 5 9-5M12 21v-8"/><path d="M18 8V2M15.5 4.5 18 2l2.5 2.5"/>',
  sofa: '<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M2 13.5A2.5 2.5 0 0 1 4.5 11 2.5 2.5 0 0 1 7 13.5V14h10v-.5a2.5 2.5 0 0 1 5 0V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M5 19v2M19 19v2"/>',
  cortina: '<path d="M3 3h18"/><path d="M7 3c1.2 5.8.8 11.6-2.5 17.5h5C11.5 14.5 11 8.8 10 3"/><path d="M17 3c-1.2 5.8-.8 11.6 2.5 17.5h-5C12.5 14.5 13 8.8 14 3"/>',
  regua: '<path d="M3.5 16.5 16.5 3.5l4 4-13 13Z"/><path d="m7 13 1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5"/>',
  prancheta: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
  planta: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 11h9v10M12 11V3M15 3v5M15 12h6"/>',
  chave: '<path d="m14 10 6.5-6.5a2.12 2.12 0 0 0-3-3L11 7"/><path d="m11 7 3 3-8.5 8.5a2.12 2.12 0 0 1-3-3Z"/>',
  ferramenta: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
  flor: '<path d="M12 22v-8"/><path d="M8 14c-2 0-3-1.5-3-3.5S6 6 8 6c1 0 2 .5 4 2 2-1.5 3-2 4-2 2 0 3 2.5 3 4.5S18 14 16 14Z"/><path d="M8 18c1.5 0 3 .5 4 2 1-1.5 2.5-2 4-2"/>',
  broto: '<path d="M12 22v-9"/><path d="M12 13c-4.5 0-7-3.2-7-8 4.5 0 7 3.2 7 8Z"/><path d="M12 13c4.5 0 7-3.2 7-8-4.5 0-7 3.2-7 8Z"/>',
  tesoura: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  /* Loja (DIRECAO-2 2.6): toldo em três ondas sobre a fachada, com a porta. Desenhado para o v3. */
  loja: '<path d="M4.5 4h15L21 9.5H3Z"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12.3V21h14v-8.7"/><path d="M10 21v-6h4v6"/>',
  /* Galpão (DIRECAO-3 2.1): barracão largo de telhado baixo e porta de enrolar
     com duas ripas. Desenhado para o v4, e desenhado para não se confundir com
     os dois vizinhos: a "casa" tem telhado alto e porta estreita, a "oficina"
     tem telhado de duas águas e porta lisa. Aqui o telhado é raso e sai por
     fora da parede, que é o que se vê num depósito. */
  galpao: '<path d="M2 10.5 5.5 4h13L22 10.5"/><path d="M4.5 10.5V21h15V10.5"/><rect x="8" y="13.5" width="8" height="7.5" rx="1"/><path d="M8 16.5h8M8 19h8"/>'
};

/**
 * Devolve o SVG inline do ícone.
 * @param {string} nome chave de ICONES; desconhecido cai em 'info'
 * @param {number} [tamanho=20] largura e altura em px
 * @param {string} [cls=''] classe extra
 * @returns {string} '<svg class="icone ..." width=... height=... viewBox="0 0 24 24" aria-hidden="true">...</svg>'
 * Efeitos: nenhum. Quem chama: todos os módulos de interface.
 */
export function icone(nome, tamanho = 20, cls = '') {
  const miolo = ICONES[nome] || ICONES.info;
  const t = Number(tamanho) > 0 ? Number(tamanho) : 20;
  const classe = 'icone' + (cls ? ' ' + String(cls) : '');
  return '<svg class="' + classe + '" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + miolo + '</svg>';
}
