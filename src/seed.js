/* Green Agenda, módulo dados: src/seed.js
   Dados iniciais fictícios, gerados UMA vez, relativos à data e à hora da
   primeira abertura. Nunca rejuvenescidos depois: dados.repo.iniciar só chama
   gerarSeed quando não existe meta gravada; em dia novo o dado salvo fica
   como está (meta.seedHoje é só registro).
   Conteúdo exato na ESPECIFICACAO.md, seção 10, mais a DIRECAO-3.md, seção 6:
   28 pessoas na lista oficial de 25/09/2026 (equipe real, contatos fictícios;
   Cleibiane, João Marcelo e Maria entraram na v4, João Vitor e Leonardo na
   v5, e Lidiane e Robson ficam cadastrados como inativos até o dono
   confirmar) e 2 contas compartilhadas que não contam como pessoa,
   11 clientes fictícios, 12 tipos com checklist mais o tipo "Loja", 4 equipes,
   4 veículos (a Strada entrou na v3, sem placa), 2 indisponibilidades,
   19 agendamentos de despacho mais 5 registros no formato do grupo AGENDA
   GREEN, 5 presenças do dia que imitam as capturas, config, notificações e
   auditoria iniciais.
   Rodada 5 (dia cheio de demonstração, 24/09/2026): mais 10 registros de
   hoje (a31 a a44), 30 nos sete dias seguintes (a50 a a79, com um dia lotado
   e um sábado com poucos), 10 na semana passada (a80 a a89), 6 presenças de
   hoje (pr6 a pr11), notificações e auditoria coerentes. Os registros de
   hoje com hora fixa ganham o status pela hora da geração (estadoHoje):
   o que já terminou está concluído, o que cobre agora está em andamento,
   o resto continua agendado. Os dias futuros e passados são escolhidos
   pelo dia da semana (diasUteisFuturos, sabadoProximo, diasUteisPassados),
   e H+4 recebe só registros sem Baú e sem Daniela, porque os dois estão
   fora nesse dia (i1 e a folga da escala). a16 e a2, do seed original,
   também passaram a ganhar o status pela hora, e o criador do a16 virou
   Eder, para Herti e Samuel serem os dois "sem aviso" do quadro.
   Rodada 6 (equipe oficial, 25/09/2026): nomes completos e cargos da lista
   do dono, perfil financeiro para o administrativo, Caroline saiu (o a21 e
   a auditoria dele passaram para o Eder), Lidiane e Robson ficaram inativos
   (o que era da Lidiane, equipe Decoração, registros e notificações, passou
   para o Eber), Cleibiane corrigida (id u_cleibiane), João Vitor e Leonardo
   entraram. Quem não se sabe o que faz tem o cargo "Trabalho a definir".
   A mesma lista alimenta a migração 4 para 5 (dados.MIGRACOES) por
   equipeOficial(), para quem já tinha dados gravados.
   Gera o esquema v4 direto (docs/redesign/DIRECAO.md, 5.2, DIRECAO-2.md,
   seção 2, e DIRECAO-3.md, seção 2): horário em faixas (o almoço é o vão
   entre duas faixas), exceções por data, regras de agendamento nos tipos,
   mensagens padrão ao cliente, período e campos livres nos agendamentos,
   apelidos e conta compartilhada nos usuários, presenças por pessoa e dia,
   config.locais com a loja e o galpão (galpão sem endereço, de propósito).
   Clientes, telefones e endereços são fictícios e continuam fictícios.
   Nome, endereço e telefone das capturas do grupo não se repetem aqui. */

import * as util from './util.js';
import { mensagemDoServico } from './whatsapp.js';

/** Senha comum de todos os usuários do seed. O hash é calculado por quem grava (repo.iniciar). */
export const SENHA_DEMO = 'demo123';

const TODOS_SETORES = ['dec', 'mov', 'flo', 'pai', 'cor', 'ent', 'fin', 'com', 'pos'];
const GESTORES = ['u_monica', 'u_nico', 'u_ariane'];

const FERIADOS = [
  { data: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
  { data: '2026-11-02', nome: 'Finados' },
  { data: '2026-11-15', nome: 'Proclamação da República' },
  { data: '2026-11-20', nome: 'Consciência Negra' },
  { data: '2026-12-25', nome: 'Natal' },
  { data: '2027-01-01', nome: 'Confraternização Universal' },
  { data: '2027-02-08', nome: 'Carnaval' },
  { data: '2027-02-09', nome: 'Carnaval' },
  { data: '2027-03-26', nome: 'Sexta-feira Santa' },
  { data: '2027-04-21', nome: 'Tiradentes' },
  { data: '2027-05-01', nome: 'Dia do Trabalho' },
  { data: '2027-05-27', nome: 'Corpus Christi' },
  { data: '2027-09-07', nome: 'Independência' }
];

const LOJA = { nome: 'Green Decor', endereco: 'Av. Nereu Ramos, 890, Centro, Itapema, SC', telefone: '' };
const ENDERECO_LOJA = { id: 'end_loja', rotulo: 'Loja', logradouro: 'Av. Nereu Ramos, 890', complemento: '', bairro: 'Centro', cidade: 'Itapema, SC', referencia: '' };

const escalaPadrao = () => ({ seg_sex: { de: '08:00', ate: '18:00' }, sab: { de: '08:30', ate: '12:30' }, dom: null, folgas: [], excecoes: [] });

/* Esquema v2. O texto das mensagens é o mesmo de dados.MENSAGENS_PADRAO; fica repetido aqui porque dados.js importa
   este arquivo, e o caminho contrário fecharia um ciclo de módulos. */
const MENSAGENS = {
  confirmacao: 'Oi {cliente}, aqui é da Green. Ficou agendado: {tipo}, {data}, às {hora}. Qualquer coisa é só chamar por aqui.',
  lembrete: 'Oi {cliente}, passando para confirmar: amanhã, {data}, às {hora}, a equipe da Green vai até você para {tipo}. Está de pé?',
  reagendamento: 'Oi {cliente}, precisamos remarcar o serviço de {tipo}. Ficou para {data}, às {hora}. Tudo bem assim?',
  cancelamento: 'Oi {cliente}, o serviço de {tipo} de {data} foi cancelado. Qualquer dúvida é só chamar.',
  pos: 'Oi {cliente}, serviço concluído. Qualquer coisa a gente resolve, é só chamar.'
};
const faixasSemana = () => [{ de: '08:00', ate: '12:00' }, { de: '13:30', ate: '18:30' }];
const prefsNotifPadrao = () => ({ agenda: true, status: true, conflito: true, atraso: true, sistema: true });

/* [id, nome, cargo, perfil, setores, campo, ajuste de escala]
   Lista oficial de funcionários passada pelo dono em 25/09/2026. Nome, cargo e perfil são reais; telefone e escala
   continuam fictícios. Quem não se sabe o que faz recebe o cargo "Trabalho a definir" e nasce sem setor. */
const USUARIOS = [
  ['u_monica', 'Monica', 'CEO', 'admin', TODOS_SETORES, false, null],
  ['u_nico', 'Nico', 'CEO', 'admin', TODOS_SETORES, false, null],
  /* Dono do projeto: administra o app. */
  ['u_leonardo', 'Leonardo José Triches Franco', 'Marketing e tecnologia', 'admin', TODOS_SETORES, false, null],
  ['u_ariane', 'Ariane Aparecida Drago', 'Gerente de Vendas', 'gerente', TODOS_SETORES, false, null],
  ['u_rafaela', 'Rafaela Costa Dunker', 'Gerente Financeiro', 'supervisor', ['fin'], false, null],
  ['u_herti', 'Herti Carisa Mohler', 'Vendedor II', 'atendente', ['com', 'mov', 'dec'], true, null],
  ['u_eber', 'Eber Drumm Martins', 'Vendedor', 'atendente', ['com', 'mov', 'dec', 'cor'], true, null],
  ['u_eder', 'Eder Antunes de Souza', 'Assistente de Vendas', 'atendente', ['com', 'mov', 'dec'], false, null],
  /* Samuel vai a campo (DIRECAO-3 1.2): "vamos no cliente fazer a troca do motor, eu e o Ryan". Cargo fica como está. */
  ['u_samuel', 'Samuel Pires Brum', 'Auxiliar de Vendas', 'atendente', ['com', 'mov', 'dec'], true, null],
  ['u_arisson', 'Arisson Felipe Oliveira Bahr', 'Auxiliar de Vendas', 'atendente', ['com', 'mov', 'dec'], false, null],
  ['u_leni', 'Lenilza Gonzaga Marinho', 'Auxiliar de Vendas', 'atendente', ['com', 'mov', 'dec'], false, null],
  ['u_luciana', 'Luciana de Souza Santana', 'Florista', 'atendente', ['flo'], false, { seg_sex: { de: '09:00', ate: '19:00' } }],
  ['u_lucimara', 'Lucimara dos Santos', 'Assistente Administrativo', 'financeiro', ['fin', 'pos'], false, null],
  ['u_elizete', 'Elizete Vermohlen', 'Auxiliar Administrativo', 'financeiro', ['fin', 'pos'], false, null],
  ['u_laura', 'Laura Davi Amorim', 'Auxiliar Administrativo', 'financeiro', ['fin', 'pos'], false, { sab: null }],
  ['u_evelin', 'Evelin Colombo Scotton', 'Auxiliar Administrativo', 'financeiro', ['fin', 'pos'], false, null],
  ['u_marilene', 'Marilene Cordeiro', 'Auxiliar Operacional', 'campo', ['ent'], true, null],
  ['u_anavitoria', 'Ana Vitória Ferreira Silva', 'Auxiliar Operacional', 'campo', ['ent'], true, null],
  ['u_ryan', 'Ryan Santos Garone', 'Auxiliar Operacional', 'campo', ['ent'], true, { seg_sex: { de: '07:30', ate: '17:30' } }],
  ['u_daniela', 'Daniela Zabala Dipinto Cafiero', 'Auxiliar Operacional', 'campo', ['ent'], true, { folgas: 'H+4' }],
  ['u_aquirony', 'Aquirony Cordeiro', 'Jardineiro', 'campo', ['pai'], true, { seg_sex: { de: '07:30', ate: '17:30' } }],
  ['u_vilson', 'Vilson Ruan Ramos Cordeiro', 'Auxiliar de Jardinagem', 'campo', ['pai'], true, { seg_sex: { de: '07:30', ate: '17:30' } }],
  /* Sem função conhecida na lista do dono: cargo "Trabalho a definir", perfil campo e sem setor. O que cada um faz nas
     capturas (Cleibiane leva pontuais, João Marcelo diz "Em loja", Maria instala cortina) continua nos registros. */
  ['u_cleibiane', 'Cleibiane', 'Trabalho a definir', 'campo', [], true, null],
  ['u_joaomarcelo', 'João Marcelo Motta Francischini', 'Trabalho a definir', 'campo', [], true, null],
  ['u_joaovitor', 'João Vitor Drago Rosa', 'Trabalho a definir', 'campo', [], true, null],
  ['u_maria', 'Maria Eduarda Trevizan', 'Trabalho a definir', 'campo', [], true, null],
  /* Não constam da lista oficial de 25/09/2026: ficam cadastrados e inativos (não fazem login, não aparecem em lista
     nem no quadro) até o dono confirmar se saíram. Nenhum registro de hoje ou futuro é deles. */
  ['u_lidiane', 'Lidiane', 'Vendedora', 'atendente', ['com', 'mov', 'dec'], true, null],
  ['u_robson', 'Robson', 'Auxiliar de Vendas', 'atendente', ['com', 'mov', 'dec'], false, null]
];
/** Quem está cadastrado mas fora da lista oficial: nasce com ativo: false. */
const INATIVOS = ['u_lidiane', 'u_robson'];
/** Quem saiu do seed na rodada 6: a migração 4 para 5 desativa em vez de apagar (nenhum registro fica órfão). */
const REMOVIDOS = ['u_caroline'];
const STATUS_USUARIO = { u_eder: 'ocupado', u_lucimara: 'ocupado', u_leni: 'ausente' };

/* Apelidos (DIRECAO-3 6.1): como o grupo chama quem já está no cadastro. Ninguém é criado em duplicata por causa disso.
   "Rafa" fica de propósito em duas contas (Rafaela e Green Natal): o leitor trata como ambíguo e pergunta. */
const APELIDOS = {
  u_arisson: ['Felipe', 'Consultor Felipe'],
  u_leni: ['Leni', 'Lenilza', 'Lenilza Gonzaga'],
  u_daniela: ['Dani'],
  u_rafaela: ['Rafa'],
  u_eber: ['Éber'],
  u_marilene: ['Marilene Cordeiro'],
  u_cleibiane: ['Cleibe'],
  u_joaomarcelo: ['Marcelo', 'João Marcelo'],
  u_maria: ['Maria']
};

/* Contas compartilhadas (DIRECAO-3 6.2): contas de setor que postam no grupo por mais de uma pessoa. Não são pessoa,
   não têm turno, não fazem login (sem senha no seed e barradas em dados.sessao) e não aparecem no quadro: aparecem as
   pessoas que assinam dentro delas. [id, nome, setores, apelidos] */
const CONTAS_COMPARTILHADAS = [
  ['u_green_cortinas', 'Green Cortinas', ['cor'], []],
  ['u_green_natal', 'Green Natal', ['com', 'dec'], ['Rafa']]
];

/* Os lugares fixos da operação (DIRECAO-3 2.1 e 2.4). O galpão nasce sem endereço de propósito: endereço não se inventa. */
const LOCAIS = [
  { id: 'loja', nome: 'Loja', endereco: LOJA.endereco },
  { id: 'galpao', nome: 'Galpão', endereco: '' }
];

/* [id, nome, telefone, rotulo, logradouro, complemento, bairro, cidade, obs] */
const CLIENTES = [
  ['c1', 'Fernanda Ribeiro', '(47) 99872-3341', 'Apartamento', 'Av. Nereu Ramos, 1250', 'Ed. Solar das Gaivotas, ap 1203', 'Meia Praia', 'Itapema, SC', 'Prefere contato à tarde. Apartamento novo, recém entregue pela construtora.'],
  ['c2', 'Roberto Siqueira', '(47) 99654-8820', 'Casa', 'Rua das Gaivotas, 87', '', 'Praia dos Amores', 'Balneário Camboriú, SC', 'Interessado em sofá sob medida para sala ampla.'],
  ['c3', 'Camila Andrade', '(47) 99190-4472', 'Apartamento', 'Rua 242, 180', 'Ed. Mirante do Atlântico, ap 704', 'Meia Praia', 'Itapema, SC', 'Quer cortinas motorizadas na sala e blackout nos quartos.'],
  ['c4', 'Dona Marlene Kuhn', '(47) 99733-1265', 'Casa', 'Rua Lauro Müller, 340', '', 'Centro', 'Porto Belo, SC', 'Compra flores toda semana. Gosta de lírios e astromélias.'],
  ['c5', 'Eduardo Prado', '(47) 99245-7718', 'Escritório', 'Rua 700, 55, sala 902', 'Business Tower', 'Centro', 'Balneário Camboriú, SC', 'Reforma completa do escritório de advocacia. Decisor direto.'],
  ['c6', 'Tatiane Moraes', '(47) 99518-6093', 'Apartamento', 'Av. Atlântica, 3900', 'Ed. Costa Esmeralda, ap 1801', 'Barra Sul', 'Balneário Camboriú, SC', ''],
  ['c7', 'Gilberto Nascimento', '(47) 99801-2246', 'Casa', 'Rua Bem-te-vi, 122', '', 'Morrinhos', 'Bombinhas, SC', 'Parcelamento em andamento, 6 de 10 parcelas pagas.'],
  ['c8', 'Vanessa Streit', '(47) 99377-5584', 'Cobertura', 'Rua 244, 95', 'Ed. Ilha do Arvoredo, cobertura 02', 'Meia Praia', 'Itapema, SC', 'Cobertura duplex. Projeto de decoração em fase inicial.'],
  ['c9', 'Paulo Henrique Dias', '(47) 99460-9917', 'Apartamento', 'Rua 280, 310', 'Res. Jardim das Bromélias, ap 502', 'Andorinha', 'Itapema, SC', 'Guarda-roupa entregue em maio, porta desalinhada.'],
  ['c10', 'Simone Carvalho', '(47) 99622-8135', 'Casa', 'Rua Pardal, 60', '', 'Ilhota', 'Itapema, SC', 'Organizando casamento da filha em setembro.'],
  ['c11', 'Ateliê Vera Arquitetura', '(47) 99841-2210', 'Escritório', 'Rua 246, 120, sala 31', '', 'Meia Praia', 'Itapema, SC', 'Escritório de arquitetura parceiro: solicita propostas de paisagismo e decoração para os clientes dela.']
];

/* [id, nome, icone, setorPadrao, duracao, precisaVeiculo, pedeAssinatura, ordem, checklist] */
const TIPOS = [
  ['t_entrega', 'Entrega', 'caixa', 'ent', 90, 'sim', true, 1, ['Conferir peça na saída do depósito', 'Proteger cantos e estofado para transporte', 'Confirmar acesso e elevador com o condomínio', 'Posicionar peça no ambiente indicado', 'Conferir a peça com o cliente', 'Colher assinatura de recebimento']],
  ['t_inst_moveis', 'Instalação de móveis', 'sofa', 'ent', 180, 'sim', true, 2, ['Conferir lista de volumes no carregamento', 'Montar conforme projeto ou planta', 'Nivelar e fixar as peças', 'Limpar o ambiente ao finalizar', 'Conferir com o cliente']],
  ['t_montagem', 'Montagem', 'chave', 'ent', 120, 'opcional', true, 3, ['Conferir volumes e ferragens na saída', 'Proteger o piso do ambiente', 'Montar conforme manual ou projeto', 'Nivelar e fixar à parede quando necessário', 'Recolher embalagens e limpar', 'Conferir portas e gavetas com o cliente']],
  ['t_retirada', 'Retirada', 'caixaseta', 'ent', 60, 'sim', true, 4, ['Confirmar a peça a retirar com o cliente', 'Proteger a peça para o transporte', 'Registrar o estado da peça na retirada', 'Conferir o recebimento no depósito']],
  ['t_inst_cortinas', 'Instalação de cortinas', 'cortina', 'cor', 180, 'sim', true, 5, ['Conferir trilhos, tecidos e comandos na saída', 'Verificar tipo de fixação do teto ou parede', 'Testar motor e comandos antes de finalizar', 'Demonstrar funcionamento para o cliente']],
  ['t_medicao', 'Medição', 'regua', 'cor', 60, 'opcional', false, 6, ['Confirmar o horário com o cliente', 'Levar trena, nível e medidor a laser', 'Medir vãos, altura e pé-direito', 'Verificar pontos de fixação e tomadas', 'Anotar tecido e modelo escolhidos', 'Registrar medidas na ficha do cliente']],
  ['t_visita', 'Visita técnica', 'prancheta', 'dec', 90, 'opcional', false, 7, ['Confirmar visita com o cliente 1 dia antes', 'Levar trena e medidor a laser', 'Fotografar todos os ambientes', 'Anotar restrições de acesso do condomínio', 'Registrar observações do cliente']],
  ['t_levantamento', 'Levantamento de decoração', 'planta', 'dec', 150, 'opcional', false, 8, ['Medição completa de todos os ambientes', 'Fotos de todas as paredes e vistas', 'Levantar pontos elétricos e de iluminação', 'Registrar peças existentes do cliente', 'Definir prioridades com o cliente']],
  ['t_assistencia', 'Assistência técnica', 'ferramenta', 'pos', 90, 'opcional', false, 9, ['Confirmar o defeito relatado com o cliente', 'Levar ferramentas e peças de reposição', 'Registrar o estado da peça antes do reparo', 'Executar o ajuste ou a troca', 'Testar o funcionamento com o cliente', 'Registrar se precisa de nova visita']],
  ['t_entrega_flores', 'Entrega de flores', 'flor', 'flo', 45, 'sim', false, 10, ['Conferir arranjo e cartão na saída', 'Proteger o arranjo para o transporte', 'Confirmar destinatário e horário', 'Entregar em mãos e confirmar o recebimento']],
  ['t_plantio', 'Plantio e paisagismo', 'broto', 'pai', 240, 'sim', false, 11, ['Conferir plantas e insumos na saída', 'Preparar solo e adubação', 'Plantio conforme o projeto', 'Acabamento com brita ou casca de pinus', 'Orientar o cliente sobre regas']],
  ['t_manutencao_jardim', 'Manutenção de jardim', 'tesoura', 'pai', 120, 'sim', false, 12, ['Conferir ferramentas e insumos na saída', 'Poda e limpeza conforme o combinado', 'Adubação e controle de pragas', 'Recolher resíduos', 'Registrar orientações para o cliente']],
  /* "Loja" (DIRECAO-2 2.6): estar na loja é compromisso de agenda, sem cliente, sem carro, sem checklist e sem setor.
     Duração igual ao período (4 h). Ordem 13 desde a v4 (DIRECAO-3 2.2, dúvida 5): a faixa "Onde estou" resolve o caso
     comum em um toque e o chip passa a ser o caso raro, então ele sai do primeiro lugar e vem depois de tudo. */
  ['t_loja', 'Loja', 'loja', null, 240, 'nao', false, 13, []]
];

/** Campos que todo tipo ganha no esquema atual, além dos que a tabela TIPOS traz. */
const camposTipo = (duracaoPadraoMin) => ({
  ativo: true, folgaAntesMin: null, folgaDepoisMin: null, antecedenciaMinMin: null, janelaDias: null, limiteDia: null, incrementoMin: null,
  duracoes: [duracaoPadraoMin], cor: null
});

function docTipo([id, nome, icone, setorPadrao, duracaoPadraoMin, precisaVeiculo, pedeAssinatura, ordem, checklist], criadoEm) {
  return Object.assign({ id, nome, icone, setorPadrao, duracaoPadraoMin, precisaVeiculo, pedeAssinatura, checklist: checklist.slice(), ordem },
    camposTipo(duracaoPadraoMin), { criadoEm, alteradoEm: criadoEm, versao: 1 });
}

/**
 * O tipo "Loja" completo, com os carimbos. Usado pelo seed e pela migração 2 para 3 (dados.MIGRACOES), que o acrescenta
 * a quem já tinha dados da rodada anterior. @param {number} criadoEm @returns {object}
 */
export function tipoLoja(criadoEm) {
  return docTipo(TIPOS.find((t) => t[0] === 't_loja'), criadoEm);
}

const EQUIPES = [
  { id: 'e1', nome: 'Equipe Entrega 01', apelido: 'Entrega 01', membros: ['u_ryan', 'u_daniela'], setores: ['ent'], veiculoPadraoId: 've1', liderId: 'u_ryan' },
  { id: 'e2', nome: 'Equipe Montagem', apelido: 'Montagem', membros: ['u_marilene', 'u_anavitoria'], setores: ['ent', 'mov'], veiculoPadraoId: 've2', liderId: 'u_marilene' },
  { id: 'e3', nome: 'Equipe Jardim', apelido: 'Jardim', membros: ['u_aquirony', 'u_vilson'], setores: ['pai', 'flo'], veiculoPadraoId: 've3', liderId: 'u_aquirony' },
  { id: 'e4', nome: 'Equipe Decoração', apelido: 'Decoração', membros: ['u_eber', 'u_herti'], setores: ['dec'], veiculoPadraoId: null, liderId: 'u_eber' }
];

const VEICULOS = [
  { id: 've1', nome: 'Fiorino Branca', apelido: 'Fiorino', inicial: 'F', placa: 'RXK-4D21', tipo: 'Furgão', capacidade: 'Sofá de 2 lugares, poltronas, caixas até 1,8 m', equipePadraoId: 'e1', indiceCor: 1 },
  { id: 've2', nome: 'Caminhão Baú', apelido: 'Baú', inicial: 'B', placa: 'QJT-8B67', tipo: 'Caminhão 3/4', capacidade: 'Sofás grandes, guarda-roupas, mesas de 8 lugares', equipePadraoId: 'e2', indiceCor: 2 },
  { id: 've3', nome: 'Saveiro Verde', apelido: 'Saveiro', inicial: 'S', placa: 'RLP-2C09', tipo: 'Utilitário', capacidade: 'Plantas, insumos, arranjos, ferramentas', equipePadraoId: 'e3', indiceCor: 3 },
  /* A Strada aparece nas mensagens do grupo (DIRECAO-2 2.6). Inicial T porque F, B e S já são dos outros três.
     Placa vazia de propósito: placa não se inventa; o dono informa quando quiser. Tipo e capacidade são suposição. */
  { id: 've4', nome: 'Strada', apelido: 'Strada', inicial: 'T', placa: '', tipo: 'Picape', capacidade: 'Arranjos, caixas, ferramentas e material de decoração', equipePadraoId: null, indiceCor: 4 }
];

const camposVeiculo = () => ({ ativo: true, obs: '', horario: null, limiteDia: null });

/**
 * A Strada completa, com os carimbos. Usada pelo seed e pela migração 2 para 3 (dados.MIGRACOES).
 * @param {number} criadoEm @returns {object}
 */
export function veiculoStrada(criadoEm) {
  return Object.assign({}, VEICULOS.find((v) => v.id === 've4'), camposVeiculo(), { criadoEm, alteradoEm: criadoEm, versao: 1 });
}

/** Campos que todo agendamento ganhou no esquema 3 (DIRECAO-2 2.2). O mesmo objeto de dados.AGENDAMENTO_V3_PADRAO, repetido aqui pelo ciclo de módulos. */
const CAMPOS_V3 = { periodo: 'hora', horaAproximada: false, tipoLivre: '', clienteNome: '', localTexto: '', veiculoTexto: '', autorTexto: '', mensagemOriginal: '' };

/**
 * Horas de um período nas faixas do seed (a mesma regra de regras.horasDoPeriodo, que este arquivo não pode importar
 * sem fechar um ciclo): manhã é a primeira faixa, tarde é a última (ou a metade final de uma faixa única), dia todo
 * vai da abertura ao fechamento. Domingo usa as faixas de dia de semana, a última faixa conhecida.
 */
function horasPeriodoSeed(iso, periodo) {
  const dow = util.diaSemana(iso);
  const faixas = dow === 6 ? [{ de: '08:30', ate: '12:30' }] : faixasSemana();
  const primeira = faixas[0];
  const ultima = faixas[faixas.length - 1];
  if (periodo === 'manha') return { horaInicio: primeira.de, horaFim: primeira.ate };
  if (periodo === 'tarde') {
    if (faixas.length > 1) return { horaInicio: ultima.de, horaFim: ultima.ate };
    const meio = util.arredondarMin((util.horaParaMin(ultima.de) + util.horaParaMin(ultima.ate)) / 2, 30, 'perto');
    return { horaInicio: util.minParaHora(meio), horaFim: ultima.ate };
  }
  return { horaInicio: primeira.de, horaFim: ultima.ate };
}

/* ---------------- Apoio ---------------- */

const ehFeriado = (iso) => FERIADOS.some((f) => f.data === iso);
const diaFechadoSeed = (iso) => util.diaSemana(iso) === 0 || ehFeriado(iso);

/** Desloca datas em dia fechado: futuras para o próximo dia aberto, passadas para o anterior. */
function dataAberta(iso, hoje) {
  if (!diaFechadoSeed(iso)) return iso;
  const passo = iso < hoje ? -1 : 1;
  let d = iso;
  while (diaFechadoSeed(d)) d = util.addDias(d, passo);
  return d;
}

const DIA_MS = 86400000;

/**
 * Os documentos de usuário do seed: as pessoas da lista oficial (inativas as de INATIVOS) e as contas compartilhadas.
 * Compartilhada entre gerarSeed e equipeOficial (migração 4 para 5). Folga e exceção de escala relativas a `hoje`.
 * @param {string} hoje ISO @param {number} criadoEm @returns {object[]}
 */
export function usuariosDoSeed(hoje, criadoEm) {
  const H = (n) => util.addDias(hoje, n);
  const base = { criadoEm, alteradoEm: criadoEm, versao: 1 };
  return USUARIOS.map(([id, nome, cargo, perfil, setores, campo, ajuste], i) => {
    const escala = escalaPadrao();
    if (ajuste) {
      if (ajuste.seg_sex) escala.seg_sex = ajuste.seg_sex;
      if ('sab' in ajuste) escala.sab = ajuste.sab;
      if (ajuste.folgas === 'H+4') {
        escala.folgas = [H(4)];
        escala.excecoes = [{ id: 'x_' + id + '_' + H(4), data: H(4), fechado: true, faixas: [], nome: 'Folga' }];
      }
    }
    return Object.assign({
      id, nome, cargo, email: id.slice(2) + '@greendecor.com.br', perfil, setores: setores.slice(),
      campo: perfil === 'campo' ? true : !!campo, ativo: !INATIVOS.includes(id),
      telefone: '(47) 99911-01' + String(i + 1).padStart(2, '0'),
      status: STATUS_USUARIO[id] || 'disponivel', escala, prefsNotif: prefsNotifPadrao(),
      apelidos: (APELIDOS[id] || []).slice(), contaCompartilhada: false
    }, base);
  }).concat(CONTAS_COMPARTILHADAS.map(([id, nome, setores, apelidos], i) => Object.assign({
    /* Sem senha: conta compartilhada não faz login. Perfil atendente só para as permissões terem dono;
       campo falso e contaCompartilhada verdadeiro a tiram de toda lista de pessoas. */
    id, nome, cargo: 'Conta compartilhada', email: id.slice(2).replace(/_/g, '') + '@greendecor.com.br', perfil: 'atendente',
    setores: setores.slice(), campo: false, ativo: true,
    telefone: '(47) 99911-01' + String(USUARIOS.length + i + 1).padStart(2, '0'),
    status: 'disponivel', escala: escalaPadrao(), prefsNotif: { agenda: false, status: false, conflito: false, atraso: false, sistema: false },
    apelidos: apelidos.slice(), contaCompartilhada: true
  }, base)));
}

/**
 * A equipe oficial para a migração 4 para 5 (dados.MIGRACOES): os documentos de pessoa do seed (sem as contas
 * compartilhadas) e os ids que saíram. Quem migra copia nome, cargo, perfil, setores, campo, apelidos e ativo de quem
 * já existe, acrescenta quem falta e desativa quem saiu; escala, telefone, status e senha de quem já existia ficam.
 * @param {string} hoje ISO @param {number} criadoEm @returns {{pessoas:object[], removidos:string[]}}
 */
export function equipeOficial(hoje, criadoEm) {
  return { pessoas: usuariosDoSeed(hoje, criadoEm).filter((u) => !u.contaCompartilhada), removidos: REMOVIDOS.slice() };
}

/**
 * Gera todas as coleções do seed.
 * @param {string} hoje ISO da data de geração
 * @param {number} agoraMin minutos desde a meia-noite na geração (define o serviço a1 em andamento)
 * @returns {{usuarios:object[], senhas:Object<string,string>, clientes:object[], tipos:object[], equipes:object[], veiculos:object[], indisponibilidades:object[], agendamentos:object[], assinaturas:object[], config:object, notificacoes:object[], auditoria:object[], filaSync:object[], meta:object, presencas:object[]}}
 *   `senhas` é um mapa userId para senha em texto, consumido só por repo.iniciar; nunca gravado. Conta compartilhada não tem senha.
 */
export function gerarSeed(hoje, agoraMin) {
  const agoraMs = util.msDe(hoje, util.minParaHora(agoraMin));
  const min = (n) => agoraMs - n * 60000;
  const H = (n) => util.addDias(hoje, n);
  const base = (criadoEm) => ({ criadoEm, alteradoEm: criadoEm, versao: 1 });
  const rnd = util.criarAleatorio(20260908);

  /* ---- Usuários ---- */
  const senhas = {};
  const usuarios = usuariosDoSeed(hoje, min(60 * 24 * 90));
  for (const u of usuarios) if (!u.contaCompartilhada && u.ativo) senhas[u.id] = SENHA_DEMO;

  /* ---- Clientes ---- */
  const clientes = CLIENTES.map(([id, nome, telefone, rotulo, logradouro, complemento, bairro, cidade, obs], i) => Object.assign({
    id, nome, telefone,
    enderecos: [{ id: 'end_' + id + '_1', rotulo, logradouro, complemento, bairro, cidade, referencia: '' }],
    obs, ativo: true
  }, base(min(60 * 24 * (10 + i * 7)))));
  const clientePorId = (id) => clientes.find((c) => c.id === id);

  /* ---- Tipos ---- */
  const tipos = TIPOS.map((linha) => docTipo(linha, min(60 * 24 * 120)));
  const tipoPorId = (id) => (id ? tipos.find((t) => t.id === id) : null) || null;

  /* ---- Equipes, veículos, indisponibilidades ---- */
  const equipes = EQUIPES.map((e) => Object.assign({}, e, { ativa: true, obs: '', limiteDia: null }, base(min(60 * 24 * 120))));
  const veiculos = VEICULOS.map((v) => Object.assign({}, v, camposVeiculo(), base(min(60 * 24 * 120))));
  const indisponibilidades = [
    Object.assign({ id: 'i1', veiculoId: 've2', de: H(4) + 'T00:00', ate: H(4) + 'T23:59', motivo: 'revisao', detalhe: 'Revisão programada, oficina em Itapema', criadoPor: 'u_ariane' }, base(min(60 * 24 * 3))),
    Object.assign({ id: 'i2', veiculoId: 've3', de: H(8) + 'T00:00', ate: H(8) + 'T23:59', motivo: 'oficina', detalhe: 'Troca de embreagem', criadoPor: 'u_monica' }, base(min(60 * 24 * 1)))
  ];

  /* ---- Agendamentos ---- */
  const inicioA1 = util.clamp(util.arredondarMin(agoraMin, 30, 'perto') - 60, 480, 1020);
  const fimA1 = inicioA1 + 90;
  let inicioA17 = fimA1 > 630 ? util.arredondarMin(fimA1, 30, 'cima') : 630;
  /* Rodada 5: a17 e a2 dividem a Saveiro. Quando o a17 calculado cruzaria o a2 (14:00 às 16:00), ele vai para as
     16:00, e o dia continua sem conflito falso também quando o seed nasce à tarde. */
  if (inicioA17 < 960 && inicioA17 + 90 > 840) inicioA17 = 960;
  /* a3 usa os mesmos recursos de a1 (Ryan e Fiorino). Se a1 terminar depois de
     16:00 (fim mais a folga de deslocamento de 30 min passa das 16:30), a3
     fica para o próximo dia aberto no mesmo horário, porque em H não cabe:
     fim de a1 arredondado para cima em 30 min mais a folga já passa das
     17:30, fim do turno do Ryan e limite de entrega da obs. Garante dia
     inicial sem conflito nem aviso de folga (ESPECIFICACAO.md, 10.5). */
  const FOLGA_DESLOCAMENTO_MIN = 30;
  const a3EmH = fimA1 + FOLGA_DESLOCAMENTO_MIN <= 990;

  const checklistDe = (agId, tipoId) => ((tipoPorId(tipoId) || {}).checklist || []).map((texto, i) => ({
    id: 'k_' + agId + '_' + (i + 1), texto, feito: false, por: null, quando: null, obs: ''
  }));
  const marcarFeitos = (checklist, ate, por, quandoDe) => checklist.forEach((item, i) => {
    if (i < ate) { item.feito = true; item.por = por; item.quando = quandoDe(i); }
  });
  const criadoEmPadrao = (data) => {
    const ref = data < hoje ? data : hoje;
    const dias = 1 + Math.floor(rnd() * 5);
    return util.msDe(ref, '09:00') - dias * DIA_MS + Math.floor(rnd() * 480) * 60000;
  };

  /* Um despacho de loja (cliente e tipo cadastrados, hora exata) e um registro do grupo (período, texto livre, sem
     cliente) são o mesmo documento (DIRECAO-2 2.1). O spec traz `periodo` quando não é hora exata; as horas então
     saem das faixas do dia e `horaAproximada` fica verdadeiro. */
  const ag = (spec) => {
    const cliente = spec.clienteId ? clientePorId(spec.clienteId) : null;
    const endereco = spec.endereco !== undefined ? spec.endereco : (cliente ? Object.assign({}, cliente.enderecos[0]) : null);
    const criadoEm = spec.criadoEm != null ? spec.criadoEm : criadoEmPadrao(spec.data);
    const periodo = spec.periodo || 'hora';
    const horas = periodo === 'hora' ? { horaInicio: spec.horaInicio, horaFim: spec.horaFim } : horasPeriodoSeed(spec.data, periodo);
    const doc = Object.assign({
      id: spec.id, tipoId: spec.tipoId || null, setorId: spec.setorId || null, data: spec.data,
      horaInicio: horas.horaInicio, horaFim: horas.horaFim, clienteId: spec.clienteId || null,
      endereco, enderecoAConfirmar: false,
      responsaveis: spec.responsaveis.slice(), equipeId: spec.equipeId || null, veiculoId: spec.veiculoId || null,
      semCarroConfirmado: false, obs: spec.obs || '', status: spec.status,
      justificativaConflito: null, liberacao: spec.liberacao || null,
      motivoCancelamento: spec.motivoCancelamento || null, motivoNaoRealizado: spec.motivoNaoRealizado || null,
      reagendamentos: spec.reagendamentos || [], atrasoAvisado: null,
      checklist: checklistDe(spec.id, spec.tipoId),
      obsConclusao: spec.obsConclusao || null, pendenciasConclusao: null,
      clienteAprovou: spec.clienteAprovou != null ? spec.clienteAprovou : null,
      assinaturaId: null, concluidoEm: spec.concluidoEm || null, ordemRota: null,
      origemId: null, sucessorId: null, criadoPor: spec.criadoPor,
      notaInterna: '', mensagensEnviadas: [], origem: spec.origem || 'loja'
    }, CAMPOS_V3, {
      periodo, horaAproximada: periodo !== 'hora',
      tipoLivre: spec.tipoLivre || '', clienteNome: spec.clienteNome || '', localTexto: spec.localTexto || '',
      veiculoTexto: spec.veiculoTexto || '', autorTexto: spec.autorTexto || '',
      /* v4 (DIRECAO-3 4.2): quem vai e não está no cadastro. */
      responsavelTexto: spec.responsavelTexto || ''
    }, base(criadoEm));
    if (spec.alteradoEm) doc.alteradoEm = spec.alteradoEm;
    if (spec.aoMontar) spec.aoMontar(doc);
    return doc;
  };

  /* O texto que teria sido colado do grupo, no formato da seção 5 da DIRECAO-2, para os registros de origem whatsapp. */
  const mensagemDoGrupo = (doc, assinatura) => mensagemDoServico(doc, {
    nomeServico: (tipoPorId(doc.tipoId) || {}).nome || doc.tipoLivre,
    nomeCliente: doc.clienteNome,
    nomeCarro: doc.veiculoId ? (veiculos.find((v) => v.id === doc.veiculoId) || {}).apelido : doc.veiculoTexto,
    local: doc.localTexto,
    assinatura
  });

  const dH = dataAberta(H(0), hoje);
  const dH1 = dataAberta(H(1), hoje);
  const dH2 = dataAberta(H(2), hoje);
  const dH3 = dataAberta(H(3), hoje);
  const dH5 = dataAberta(H(5), hoje);
  const dHm1 = dataAberta(H(-1), hoje);
  const dHm2 = dataAberta(H(-2), hoje);
  const dHm3 = dataAberta(H(-3), hoje);

  /* ================= Rodada 5: o dia cheio ================= */

  const hojeAs = (hora) => Math.min(util.msDe(dH, hora), agoraMs - 60000);
  const MS_MIN = 60000;
  const ROTULO_MOTIVO = {
    cliente_ausente: 'Cliente ausente', endereco_errado: 'Endereço errado', produto_defeito: 'Produto com defeito ou não coube',
    sem_acesso: 'Sem acesso', cliente_desistiu: 'Cliente desistiu', venda_cancelada: 'Venda cancelada',
    cliente_pediu: 'Cliente pediu', produto_nao_chegou: 'Produto não chegou', chuva: 'Chuva'
  };

  /* Status de um registro de hoje com hora fixa, pela hora da geração: terminou, está concluído; cobre agora, está em
     andamento; ainda não chegou, segue confirmado. `final` 'nao_realizado' vale a partir de 25 min depois do início
     (antes disso o registro ainda espera, e fica atrasado no meio do caminho). */
  const estadoHoje = (horaInicio, horaFim, final) => {
    const ini = util.horaParaMin(horaInicio);
    const fim = util.horaParaMin(horaFim);
    if (final === 'nao_realizado') return agoraMin >= ini + 25 ? 'nao_realizado' : 'confirmado';
    if (agoraMin >= fim) return 'concluido';
    if (agoraMin >= ini) return 'em_andamento';
    return 'confirmado';
  };
  const naoDepoisDeAgora = (ts) => Math.min(ts, agoraMs - MS_MIN);

  /** Registro de hoje com hora fixa: status, carimbos, checklist e motivo saem de estadoHoje. */
  const agHoje = (spec) => {
    const status = estadoHoje(spec.horaInicio, spec.horaFim, spec.final);
    const iniMs = util.msDe(dH, spec.horaInicio);
    const fimMs = util.msDe(dH, spec.horaFim);
    const lider = spec.responsaveis[0] || spec.criadoPor;
    const extras = { data: dH, status };
    if (status === 'concluido') {
      extras.concluidoEm = fimMs - 5 * MS_MIN;
      extras.alteradoEm = extras.concluidoEm;
      extras.clienteAprovou = spec.clienteId ? true : null;
      extras.obsConclusao = spec.obsConclusao || null;
    } else if (status === 'em_andamento') {
      extras.alteradoEm = naoDepoisDeAgora(iniMs + 4 * MS_MIN);
    } else if (status === 'nao_realizado') {
      const quando = iniMs + 25 * MS_MIN;
      extras.alteradoEm = quando;
      extras.motivoNaoRealizado = Object.assign({}, spec.motivo, { por: lider, quando });
    }
    return ag(Object.assign({}, spec, extras, {
      aoMontar: (doc) => {
        if (status === 'concluido') marcarFeitos(doc.checklist, doc.checklist.length, lider, (i) => iniMs + (5 + i * 9) * MS_MIN);
        else if (status === 'em_andamento') marcarFeitos(doc.checklist, Math.ceil(doc.checklist.length / 2), lider, (i) => naoDepoisDeAgora(iniMs + (5 + i * 6) * MS_MIN));
        if (spec.aoMontar) spec.aoMontar(doc);
      }
    }));
  };

  /** Registro da semana passada: concluído com checklist inteiro feito, ou não realizado quando vem `motivo`. */
  const agPassado = (spec) => {
    const iniMs = util.msDe(spec.data, spec.horaInicio);
    const fimMs = util.msDe(spec.data, spec.horaFim);
    const lider = spec.responsaveis[0] || spec.criadoPor;
    if (spec.motivo) {
      const quando = iniMs + 30 * MS_MIN;
      return ag(Object.assign({}, spec, { status: 'nao_realizado', alteradoEm: quando, motivoNaoRealizado: Object.assign({}, spec.motivo, { por: lider, quando }) }));
    }
    const concluidoEm = fimMs - 10 * MS_MIN;
    return ag(Object.assign({}, spec, {
      status: 'concluido', concluidoEm, alteradoEm: concluidoEm,
      clienteAprovou: spec.clienteAprovou !== undefined ? spec.clienteAprovou : (spec.clienteId ? true : null),
      aoMontar: (doc) => marcarFeitos(doc.checklist, doc.checklist.length, lider, (i) => iniMs + (5 + i * 10) * MS_MIN)
    }));
  };


  /* ---- Dias da rodada 5 (dia cheio). Escolhidos pelo dia da semana, para o seed valer em qualquer data de geração:
     cinco dias úteis à frente (sem sábado e sem H+4, que tem o Baú em revisão e a Daniela de folga), o sábado mais
     próximo, H+4 só quando é dia útil, e cinco dias úteis para trás. ---- */
  const ehSabado = (iso) => util.diaSemana(iso) === 6;
  const diaUtil = (iso) => !diaFechadoSeed(iso) && !ehSabado(iso);
  const diasUteisFuturos = [];
  for (let n = 1; n <= 14 && diasUteisFuturos.length < 5; n++) if (diaUtil(H(n)) && H(n) !== H(4)) diasUteisFuturos.push(H(n));
  const [D1, D2, D3, D4, D5] = diasUteisFuturos;
  let sabadoProximo = null;
  for (let n = 1; n <= 7 && !sabadoProximo; n++) if (ehSabado(H(n)) && !ehFeriado(H(n))) sabadoProximo = H(n);
  const D4x = diaUtil(H(4)) ? H(4) : null;
  const diasUteisPassados = [];
  for (let n = 1; n <= 14 && diasUteisPassados.length < 5; n++) if (diaUtil(H(-n))) diasUteisPassados.push(H(-n));
  const [P1, P2, P3, P4, P5] = diasUteisPassados;

  const agendamentos = [
    ag({
      id: 'a1', data: dH, horaInicio: util.minParaHora(inicioA1), horaFim: util.minParaHora(fimA1), tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c6', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', status: 'em_andamento', criadoPor: 'u_eber',
      obs: 'Poltrona Berger caramelo, pedido 2314. Prédio exige agendamento do elevador de serviço.',
      criadoEm: min(2900), alteradoEm: util.msDe(dH, util.minParaHora(inicioA1)),
      aoMontar: (doc) => marcarFeitos(doc.checklist, 3, 'u_ryan', (i) => min([40, 30, 25][i]))
    }),
    ag({
      id: 'a17', data: dH, horaInicio: util.minParaHora(inicioA17), horaFim: util.minParaHora(inicioA17 + 90), tipoId: 't_manutencao_jardim', setorId: 'pai',
      clienteId: 'c11', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', status: 'confirmado', criadoPor: 'u_ariane',
      obs: 'Poda das jardineiras da fachada e troca de forração.'
    }),
    /* a16 e a2 (rodada 5): o status sai da hora da geração (agHoje), para o seed nascer coerente também à tarde e à
       noite: antes das 13:30 e das 14:00 são confirmados como sempre foram; depois, em andamento ou concluídos.
       O criador do a16 passou de Herti para Eder, para o Herti poder ficar "sem aviso" no quadro (quem cria registro
       conta como quem avisou, regras.pessoasSemAviso). Eder é Assistente de Vendas e não vai a campo. */
    agHoje({
      id: 'a16', horaInicio: '13:30', horaFim: '15:00', tipoId: 't_montagem', setorId: 'mov',
      clienteId: 'c8', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_eder',
      obs: 'Montagem de rack e painel na sala da cobertura.', obsConclusao: 'Rack e painel fixados e nivelados. Cliente conferiu.'
    }),
    agHoje({
      id: 'a2', horaInicio: '14:00', horaFim: '16:00', tipoId: 't_medicao', setorId: 'cor',
      clienteId: 'c3', responsaveis: ['u_eber'], equipeId: null, veiculoId: 've3', criadoPor: 'u_eber',
      obs: 'Medição final para cortinas motorizadas da sala e blackout dos quartos.', obsConclusao: 'Medidas fechadas, sala 4,80 m e dois quartos. Ficha atualizada.'
    }),
    ag({
      id: 'a3', data: a3EmH ? dH : dH1, horaInicio: '16:30', horaFim: '17:30', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteId: 'c4', responsaveis: ['u_ryan'], equipeId: 'e1', veiculoId: 've1', status: 'confirmado', criadoPor: 'u_luciana',
      obs: 'Dois arranjos grandes de lírios. Entregar até 17h30.'
    }),
    ag({
      id: 'a13', data: dH1, horaInicio: '08:00', horaFim: '12:00', tipoId: 't_plantio', setorId: 'pai',
      clienteId: 'c5', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', status: 'confirmado', criadoPor: 'u_ariane',
      obs: 'Jardineiras da recepção e vasos internos do escritório. Levar terra adubada e casca de pinus.'
    }),
    ag({
      id: 'a4', data: dH1, horaInicio: '09:00', horaFim: '12:00', tipoId: 't_visita', setorId: 'mov',
      clienteId: 'c2', responsaveis: ['u_herti', 'u_eder'], equipeId: null, veiculoId: 've3', status: 'aguardando_conf', criadoPor: 'u_herti',
      obs: 'Medir sala para sofá retrátil sob medida de 3,20 m.', criadoEm: min(2500),
      liberacao: { estado: 'pendente', pedidoPor: 'u_herti', pedidoEm: min(2500), texto: 'Cliente só pode de manhã e a Saveiro é o carro com o mostruário.', decididoPor: null, decididoEm: null }
    }),
    ag({
      id: 'a15', data: dH1, horaInicio: '14:00', horaFim: '15:30', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteId: 'c10', responsaveis: ['u_daniela'], equipeId: 'e1', veiculoId: 've1', status: 'confirmado', criadoPor: 'u_luciana',
      obs: 'Arranjos para a mesa do casamento. Entregar na casa da cliente.', criadoEm: min(180)
    }),
    ag({
      id: 'a5', data: dH2, horaInicio: '14:00', horaFim: '17:00', tipoId: 't_levantamento', setorId: 'dec',
      clienteId: 'c1', responsaveis: ['u_eber', 'u_herti'], equipeId: 'e4', veiculoId: null, status: 'confirmado', criadoPor: 'u_eber',
      obs: 'Primeira visita do projeto. Levar mostruário de tecidos e medidor a laser.'
    }),
    ag({
      id: 'a6', data: dH2, horaInicio: '09:00', horaFim: '11:30', tipoId: 't_inst_moveis', setorId: 'ent',
      clienteId: 'c5', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', status: 'confirmado', criadoPor: 'u_ariane',
      obs: 'Instalação das estações de trabalho, fase 1 da reforma.'
    }),
    ag({
      id: 'a19', data: dH2, horaInicio: '10:00', horaFim: '11:30', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c7', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', status: 'cancelado', criadoPor: 'u_eber',
      obs: 'Cadeiras da mesa de jantar.', alteradoEm: min(300),
      motivoCancelamento: { opcao: 'venda_cancelada', texto: 'Cliente trocou o pedido por outro modelo.', por: 'u_eber', quando: min(300) }
    }),
    ag({
      id: 'a7', data: dH3, horaInicio: '08:00', horaFim: '12:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteId: 'c3', responsaveis: ['u_eber'], equipeId: null, veiculoId: 've3', status: 'aguardando_conf', criadoPor: 'u_eber',
      obs: 'Instalar trilho motorizado na sala. Levar escada alta, pé-direito 3,4 m.'
    }),
    ag({
      id: 'a18', data: dH3, horaInicio: '14:00', horaFim: '16:00', tipoId: 't_retirada', setorId: 'ent',
      clienteId: 'c9', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', status: 'reagendado', criadoPor: 'u_lucimara',
      obs: 'Retirar guarda-roupa para troca das portas na fábrica.', alteradoEm: min(1500),
      reagendamentos: [{ de: { data: H(-1), horaInicio: '14:00', horaFim: '16:00' }, para: { data: dH3, horaInicio: '14:00', horaFim: '16:00' }, motivo: { opcao: 'cliente_pediu', texto: '' }, por: 'u_lucimara', quando: min(1500) }]
    }),
    ag({
      id: 'a10', data: dH5, horaInicio: '10:00', horaFim: '12:00', tipoId: 't_visita', setorId: 'dec',
      clienteId: 'c8', responsaveis: ['u_eber', 'u_herti'], equipeId: 'e4', veiculoId: null, status: 'aguardando_conf', criadoPor: 'u_eber',
      obs: 'Visita inicial da cobertura duplex. Cliente pediu sugestões para área gourmet.'
    }),
    ag({
      id: 'a11', data: H(6), horaInicio: '15:00', horaFim: '16:00', tipoId: 't_visita', setorId: 'flo',
      clienteId: 'c10', responsaveis: ['u_luciana'], equipeId: null, veiculoId: null, status: 'aguardando_conf', criadoPor: 'u_luciana',
      obs: 'Reunião na loja para definir flores do casamento.', endereco: Object.assign({}, ENDERECO_LOJA)
    }),
    ag({
      id: 'a12', data: H(8), horaInicio: '08:30', horaFim: '12:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteId: 'c5', responsaveis: ['u_eber'], equipeId: null, veiculoId: 've3', status: 'aguardando_conf', criadoPor: 'u_eber',
      obs: 'Persianas rolô tela solar nas 8 janelas do escritório.'
    }),
    ag({
      id: 'a8', data: dHm1, horaInicio: '09:00', horaFim: '10:30', tipoId: 't_assistencia', setorId: 'pos',
      clienteId: 'c9', responsaveis: ['u_ryan'], equipeId: null, veiculoId: 've3', status: 'concluido', criadoPor: 'u_lucimara',
      obs: 'Ajuste de dobradiças do guarda-roupa.', obsConclusao: 'Dobradiças trocadas, cliente conferiu as portas.', clienteAprovou: true,
      concluidoEm: util.msDe(dHm1, '10:20'), alteradoEm: util.msDe(dHm1, '10:20'),
      aoMontar: (doc) => marcarFeitos(doc.checklist, doc.checklist.length, 'u_ryan', (i) => util.msDe(dHm1, '09:00') + (10 + i * 12) * 60000)
    }),
    ag({
      id: 'a9', data: dHm2, horaInicio: '14:00', horaFim: '16:00', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c7', responsaveis: ['u_ryan'], equipeId: 'e1', veiculoId: 've1', status: 'nao_realizado', criadoPor: 'u_eber',
      obs: 'Mesa de jantar 6 lugares.', alteradoEm: util.msDe(dHm2, '14:40'),
      motivoNaoRealizado: { opcao: 'cliente_ausente', texto: 'Cliente não estava no endereço no horário combinado.', por: 'u_ryan', quando: util.msDe(dHm2, '14:40') }
    }),
    ag({
      id: 'a14', data: dHm3, horaInicio: '09:00', horaFim: '10:30', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteId: 'c4', responsaveis: ['u_daniela'], equipeId: 'e1', veiculoId: 've1', status: 'concluido', criadoPor: 'u_luciana',
      obs: 'Arranjo semanal de lírios.', clienteAprovou: true,
      concluidoEm: util.msDe(dHm3, '09:50'), alteradoEm: util.msDe(dHm3, '09:50'),
      aoMontar: (doc) => marcarFeitos(doc.checklist, doc.checklist.length, 'u_daniela', (i) => util.msDe(dHm3, '09:05') + i * 10 * 60000)
    }),

    /* ---- Os cinco registros no formato do grupo (DIRECAO-2 2.6). Quem posta é quem faz: responsaveis = criadoPor. ---- */
    ag({
      id: 'a20', data: dH, periodo: 'tarde', tipoId: 't_loja', responsaveis: ['u_daniela'], status: 'confirmado', criadoPor: 'u_daniela',
      origem: 'whatsapp', criadoEm: util.msDe(dH, '12:40'),
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(doc, 'Dani'); }
    }),
    ag({
      id: 'a21', data: dH, horaInicio: '11:00', horaFim: '12:00', tipoLivre: 'Medidas para natalino',
      clienteNome: 'Josiane Prado', localTexto: 'Rua 238, n 40, ed. Vista Azul, apto 501', veiculoId: 've4',
      responsaveis: ['u_eder'], status: 'em_andamento', criadoPor: 'u_eder', origem: 'app',
      criadoEm: util.msDe(dH, '10:48'), alteradoEm: util.msDe(dH, '11:02')
    }),
    ag({
      id: 'a22', data: dH, periodo: 'dia', tipoLivre: 'Montagem do Natal da loja', veiculoId: 've4',
      responsaveis: ['u_luciana'], status: 'confirmado', criadoPor: 'u_luciana', origem: 'app', criadoEm: util.msDe(dHm1, '17:20')
    }),
    ag({
      id: 'a23', data: dHm1, periodo: 'manha', tipoLivre: 'Entrega de arranjos', clienteNome: 'Condomínio Vista Azul',
      responsaveis: ['u_daniela'], status: 'nao_realizado', criadoPor: 'u_daniela', origem: 'whatsapp',
      criadoEm: util.msDe(dHm1, '07:50'), alteradoEm: util.msDe(dHm1, '11:10'),
      /* É o "( x ) Não realizado" da captura, agora com a razão que o grupo perde. */
      motivoNaoRealizado: { opcao: 'cliente_ausente', texto: 'Portaria não autorizou a entrada e a síndica não atendeu.', por: 'u_daniela', quando: util.msDe(dHm1, '11:10') },
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(Object.assign({}, doc, { status: 'confirmado' }), 'Dani'); }
    }),
    ag({
      id: 'a24', data: dH1, periodo: 'tarde', tipoId: 't_loja', responsaveis: ['u_ryan'], status: 'confirmado', criadoPor: 'u_ryan',
      origem: 'app', criadoEm: min(95)
    })
  ];

  /* Os registros do bloco "agora", relativos ao a1 (que começa em inicioA1 = agora arredondado menos 60 min):
     a31 em andamento no mesmo intervalo, a33 a caminho de um serviço que começa daqui a 15 a 30 min, a34 confirmado
     que devia ter começado há 35 min e vira o único atrasado do dia. Samuel e Herti não têm registro nem presença hoje,
     de propósito: são os dois "sem aviso" do quadro. */
  const iniA31 = inicioA1;
  const iniA33 = Math.min(util.arredondarMin(agoraMin, 15, 'cima') + 15, 1050);
  const iniA34 = inicioA1 + 25;

  const novosHoje = [
    ag({
      id: 'a31', data: dH, horaInicio: util.minParaHora(iniA31), horaFim: util.minParaHora(iniA31 + 60), tipoLivre: 'Levar pontuais',
      clienteNome: 'Condomínio Brisas do Mar', localTexto: 'Av. Nereu Ramos, 2100, Meia Praia', veiculoTexto: 'Fiat do Sr. Adão',
      responsaveis: ['u_cleibiane'], responsavelTexto: 'Sr. Adão (frete)', status: 'em_andamento', criadoPor: 'u_cleibiane', origem: 'whatsapp',
      criadoEm: util.msDe(dH, util.minParaHora(iniA31)) - 20 * MS_MIN, alteradoEm: util.msDe(dH, util.minParaHora(iniA31)) + 2 * MS_MIN,
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(Object.assign({}, doc, { status: 'confirmado' }), 'Cleibe'); }
    }),
    ag({
      id: 'a33', data: dH, horaInicio: util.minParaHora(iniA33), horaFim: util.minParaHora(iniA33 + 60), tipoId: 't_assistencia', setorId: 'pos',
      clienteId: 'c2', responsaveis: ['u_joaomarcelo'], veiculoId: null, status: 'a_caminho', criadoPor: 'u_lucimara',
      obs: 'Trocar os puxadores do aparador da sala. Peças já separadas no galpão.',
      criadoEm: min(60 * 24 * 2), alteradoEm: min(6)
    }),
    ag({
      id: 'a34', data: dH, horaInicio: util.minParaHora(iniA34), horaFim: util.minParaHora(iniA34 + 45), tipoLivre: 'Explicação orçamento paisagismo',
      clienteId: 'c11', endereco: Object.assign({}, ENDERECO_LOJA), localTexto: 'Loja',
      responsaveis: ['u_arisson'], veiculoId: null, status: 'confirmado', criadoPor: 'u_ariane', origem: 'app',
      obs: 'Apresentar o orçamento do jardim da cobertura para a arquiteta. Levar a planta impressa.',
      criadoEm: min(60 * 24 * 1)
    }),
    agHoje({
      id: 'a36', horaInicio: '08:30', horaFim: '09:30', tipoLivre: 'Separar peça de manhã', localTexto: 'Galpão',
      responsaveis: ['u_marilene', 'u_anavitoria'], veiculoId: null, criadoPor: 'u_marilene', origem: 'whatsapp',
      criadoEm: hojeAs('08:05'),
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(Object.assign({}, doc, { status: 'confirmado' }), 'Marilene'); }
    }),
    agHoje({
      id: 'a38', horaInicio: '08:00', horaFim: '09:30', tipoId: 't_manutencao_jardim', setorId: 'pai',
      clienteId: 'c4', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', criadoPor: 'u_ariane',
      obs: 'Poda das roseiras e adubação do canteiro da frente.', obsConclusao: 'Poda feita, adubo aplicado. Cliente pediu orçamento de forração para o fundo.'
    }),
    agHoje({
      id: 'a40', horaInicio: '10:00', horaFim: '11:30', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c10', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_eber',
      obs: 'Aparador e dois bancos para o casamento. Deixar na sala de estar.', obsConclusao: 'Entregue e conferido com a cliente.'
    }),
    agHoje({
      id: 'a41', horaInicio: '10:30', horaFim: '11:30', tipoId: 't_medicao', setorId: 'cor', final: 'nao_realizado',
      clienteNome: 'Neide Salvador', localTexto: 'Rua 1101, 85, Centro, Balneário Camboriú', responsaveis: ['u_eber'], veiculoId: null, criadoPor: 'u_eber',
      obs: 'Medir persianas da sala e da cozinha.',
      motivo: { opcao: 'endereco_errado', texto: 'O número não existe na rua e a cliente não atendeu o telefone.' }
    }),
    ag({
      id: 'a42', data: dH, horaInicio: '15:30', horaFim: '17:00', tipoId: 't_montagem', setorId: 'mov',
      clienteId: 'c7', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', status: 'cancelado', criadoPor: 'u_eder',
      obs: 'Montagem do painel da TV e da estante.', alteradoEm: min(200),
      motivoCancelamento: { opcao: 'cliente_desistiu', texto: 'Cliente vai montar com o marceneiro dele.', por: 'u_eder', quando: min(200) }
    }),
    /* Reagendado para o fim da tarde de hoje; se o seed nasce depois das 15:30, vai para amanhã de manhã, senão já
       nasceria atrasado. */
    ag(Object.assign({
      id: 'a43', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteNome: 'Cláudia Bittencourt', localTexto: 'Rua 402, 150, ap 1201, Centro, Balneário Camboriú',
      responsaveis: ['u_eber'], veiculoId: 've4', status: 'reagendado', criadoPor: 'u_ariane',
      obs: 'Cortina de linho da sala, trilho simples. Tecido chegou da fábrica.', alteradoEm: min(1400)
    }, agoraMin <= 930 ? { data: dH, horaInicio: '16:30', horaFim: '18:00' } : { data: D1, horaInicio: '09:00', horaFim: '10:30' }, {
      reagendamentos: [{ de: { data: P2, horaInicio: '14:00', horaFim: '15:30' }, para: agoraMin <= 930 ? { data: dH, horaInicio: '16:30', horaFim: '18:00' } : { data: D1, horaInicio: '09:00', horaFim: '10:30' }, motivo: { opcao: 'produto_nao_chegou', texto: 'Tecido atrasou na fábrica.' }, por: 'u_ariane', quando: min(1400) }]
    })),
    ag({
      id: 'a44', data: dH, periodo: 'tarde', tipoLivre: 'Organizar estoque de Natal', localTexto: 'Galpão',
      responsaveis: ['u_joaomarcelo'], veiculoId: null, status: 'confirmado', criadoPor: 'u_joaomarcelo', origem: 'whatsapp',
      criadoEm: hojeAs('12:35'),
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(doc, 'Marcelo'); }
    })
  ];

  /* Os próximos dias. D1 é amanhã (ou o primeiro dia útil), D2 é o dia lotado, D4x é o H+4 sem Baú e sem Daniela. */
  const conf = (spec) => ag(Object.assign({ status: 'confirmado' }, spec));
  const futuros = [];
  /* Guarda contra conflito falso: em outra data de geração, dataAberta pode empurrar um registro do seed original
     (a6, a18...) para o mesmo dia de um registro novo com a mesma dupla ou o mesmo carro. Quando isso acontece, o
     registro novo vai para o próximo dia útil em que cabe (até quatro tentativas, senão fica de fora), em vez de
     nascer em conflito. Na data de referência da rodada (quinta, 24/09/2026) nada muda de lugar. */
  const STATUS_ATIVOS_SEED = ['aguardando_conf', 'confirmado', 'a_caminho', 'em_andamento', 'reagendado'];
  const sobrepoeSeed = (a, b) => util.horaParaMin(a.horaInicio) < util.horaParaMin(b.horaFim) && util.horaParaMin(b.horaInicio) < util.horaParaMin(a.horaFim);
  const colide = (cand) => {
    if (cand.veiculoId === 've2' && cand.data === H(4)) return true;
    if (cand.veiculoId === 've3' && cand.data === H(8)) return true;
    if (cand.responsaveis.includes('u_daniela') && cand.data === H(4)) return true;
    return agendamentos.concat(futuros).some((o) => o.data === cand.data && STATUS_ATIVOS_SEED.includes(o.status) && !o.horaAproximada && !cand.horaAproximada
      && sobrepoeSeed(cand, o) && ((cand.veiculoId && o.veiculoId === cand.veiculoId) || cand.responsaveis.some((r) => o.responsaveis.includes(r))));
  };
  const proximoDiaUtil = (iso) => { let d = util.addDias(iso, 1); while (!diaUtil(d) || d === H(4)) d = util.addDias(d, 1); return d; };
  const emDia = (dia, lista) => {
    if (!dia) return;
    for (const spec of lista) {
      let d = dia;
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const doc = spec(d);
        if (!colide(doc)) { futuros.push(doc); break; }
        d = proximoDiaUtil(d);
      }
    }
  };

  emDia(D1, [
    (d) => ag({
      id: 'a50', data: d, horaInicio: '09:00', horaFim: '10:30', tipoLivre: 'Troca do motor', clienteNome: 'Rodrigo Amaral',
      localTexto: 'Rua 1500, 320, ap 1402, Centro, Balneário Camboriú', responsaveis: ['u_samuel', 'u_ryan'], veiculoId: 've1',
      status: 'confirmado', criadoPor: 'u_samuel', origem: 'whatsapp', criadoEm: min(150),
      aoMontar: (doc) => { doc.mensagemOriginal = mensagemDoGrupo(doc, 'Samuel'); }
    }),
    (d) => conf({
      id: 'a51', data: d, horaInicio: '08:30', horaFim: '11:30', tipoId: 't_inst_moveis', setorId: 'ent',
      clienteId: 'c1', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_eber',
      obs: 'Cama box, cabeceira estofada e criados-mudos da suíte. Elevador de serviço liberado das 08:00 às 12:00.'
    }),
    (d) => conf({
      id: 'a52', data: d, horaInicio: '14:00', horaFim: '15:00', tipoId: 't_entrega', setorId: 'ent',
      clienteNome: 'Ana Paula Lemos', localTexto: 'Rua 232, 55, ap 301, Meia Praia', responsaveis: ['u_cleibiane', 'u_joaomarcelo'], veiculoId: 've2', criadoPor: 'u_eber',
      obs: 'Mesa de centro e tapete da sala.'
    }),
    (d) => ag({
      id: 'a53', data: d, horaInicio: '14:00', horaFim: '17:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteId: 'c6', responsaveis: ['u_maria'], veiculoId: 've4', status: 'aguardando_conf', criadoPor: 'u_eber', criadoEm: min(240),
      obs: 'Blackout do quarto do casal e voil da sala. Confirmar com a cliente se o porteiro libera a escada.'
    })
  ]);

  emDia(sabadoProximo, [
    (d) => conf({
      id: 'a54', data: d, horaInicio: '09:00', horaFim: '09:45', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteId: 'c4', responsaveis: ['u_daniela'], veiculoId: 've1', criadoPor: 'u_luciana',
      obs: 'Arranjo de sábado, lírios e astromélias.'
    }),
    (d) => conf({
      id: 'a55', data: d, horaInicio: '10:00', horaFim: '11:00', tipoId: 't_assistencia', setorId: 'pos',
      clienteNome: 'Marcos Tavares', localTexto: 'Rua 264, 310, ap 902, Meia Praia', responsaveis: ['u_samuel'], veiculoId: null, criadoPor: 'u_lucimara',
      obs: 'Gaveta do criado-mudo saindo do trilho.'
    })
  ]);

  emDia(D4x, [
    (d) => conf({
      id: 'a56', data: d, horaInicio: '09:00', horaFim: '12:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteNome: 'Dr. Fábio Nunes', localTexto: 'Rua 2000, 1200, sala 508, Centro, Balneário Camboriú', responsaveis: ['u_maria'], veiculoId: 've4', criadoPor: 'u_eber',
      obs: 'Persianas rolô nas três salas do consultório.'
    }),
    (d) => conf({
      id: 'a57', data: d, horaInicio: '09:00', horaFim: '10:30', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c10', responsaveis: ['u_cleibiane', 'u_joaomarcelo'], veiculoId: 've1', criadoPor: 'u_herti',
      obs: 'Cadeiras da sala de jantar, 6 unidades.'
    }),
    (d) => conf({
      id: 'a58', data: d, horaInicio: '10:30', horaFim: '11:30', tipoId: 't_assistencia', setorId: 'pos',
      clienteId: 'c7', responsaveis: ['u_samuel'], veiculoId: null, criadoPor: 'u_lucimara',
      obs: 'Regular a porta do buffet, está raspando na base.'
    })
  ]);

  emDia(D2, [
    (d) => conf({
      id: 'a59', data: d, horaInicio: '08:00', horaFim: '09:30', tipoId: 't_entrega', setorId: 'ent',
      clienteNome: 'Henrique Bauer', localTexto: 'Rua 268, 120, casa 2, Meia Praia', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', criadoPor: 'u_eber',
      obs: 'Sofá de 3 lugares e puff. Casa de esquina, portão largo.'
    }),
    (d) => conf({
      id: 'a60', data: d, horaInicio: '10:00', horaFim: '10:45', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteNome: 'Clínica Sorriso Itapema', localTexto: 'Rua 244, 300, sala 2, Meia Praia', responsaveis: ['u_daniela'], veiculoId: 've1', criadoPor: 'u_luciana',
      obs: 'Arranjo da recepção, troca semanal.'
    }),
    (d) => conf({
      id: 'a61', data: d, horaInicio: '13:30', horaFim: '15:00', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c8', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', criadoPor: 'u_eber',
      obs: 'Poltronas da área gourmet, 4 unidades.'
    }),
    (d) => conf({
      id: 'a62', data: d, horaInicio: '08:00', horaFim: '12:00', tipoId: 't_plantio', setorId: 'pai',
      clienteId: 'c2', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', criadoPor: 'u_ariane',
      obs: 'Jardim frontal, fase 1: canteiros e grama.'
    }),
    (d) => conf({
      id: 'a63', data: d, horaInicio: '09:00', horaFim: '10:00', tipoId: 't_medicao', setorId: 'cor',
      clienteNome: 'Salão Espaço Bella', localTexto: 'Av. Nereu Ramos, 1500, sala 3, Centro', responsaveis: ['u_eber'], veiculoId: null, criadoPor: 'u_eber',
      obs: 'Medir as duas vitrines para persiana.'
    }),
    (d) => conf({
      id: 'a64', data: d, horaInicio: '09:00', horaFim: '12:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteId: 'c3', responsaveis: ['u_maria'], veiculoId: 've4', criadoPor: 'u_eber',
      obs: 'Blackout dos dois quartos. A sala motorizada fica com o Eber em outra data.'
    }),
    (d) => conf({
      id: 'a65', data: d, horaInicio: '14:00', horaFim: '16:00', tipoId: 't_montagem', setorId: 'mov',
      clienteNome: 'Pousada Recanto das Ondas', localTexto: 'Av. Vereador Manoel José dos Santos, 800, Bombas, Bombinhas', responsaveis: ['u_cleibiane', 'u_joaomarcelo'], veiculoId: 've2', criadoPor: 'u_herti',
      obs: 'Camas e criados de 4 quartos. Levar parafusadeira extra.'
    }),
    (d) => conf({
      id: 'a66', data: d, horaInicio: '08:30', horaFim: '11:30', tipoId: 't_inst_moveis', setorId: 'ent',
      clienteId: 'c5', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_ariane',
      obs: 'Fase 2 da reforma: armários da copa e recepção.'
    }),
    (d) => conf({
      id: 'a67', data: d, horaInicio: '14:00', horaFim: '15:00', tipoId: 't_assistencia', setorId: 'pos',
      clienteId: 'c6', responsaveis: ['u_samuel'], veiculoId: null, criadoPor: 'u_lucimara',
      obs: 'Regular o pé da poltrona Berger entregue esta semana.'
    }),
    (d) => ag({
      id: 'a68', data: d, horaInicio: '15:30', horaFim: '16:15', tipoLivre: 'Explicação orçamento decoração', clienteNome: 'Casal Ferreira',
      endereco: Object.assign({}, ENDERECO_LOJA), localTexto: 'Loja', responsaveis: ['u_arisson'], veiculoId: null, status: 'confirmado', criadoPor: 'u_arisson', origem: 'app',
      obs: 'Sala e varanda do apartamento novo. Mostruário de tecidos na mesa 2.'
    })
  ]);

  emDia(D3, [
    (d) => conf({
      id: 'a69', data: d, horaInicio: '09:00', horaFim: '11:00', tipoId: 't_montagem', setorId: 'mov',
      clienteNome: 'Sr. Osmar Kretzer', localTexto: 'Rua 900, 210, Centro, Balneário Camboriú', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_herti',
      obs: 'Guarda-roupa 6 portas, segunda tentativa. Kit de ferragens chegou da fábrica.'
    }),
    (d) => conf({
      id: 'a70', data: d, horaInicio: '09:00', horaFim: '10:30', tipoId: 't_entrega', setorId: 'ent',
      clienteNome: 'Restaurante Mar Aberto', localTexto: 'Av. Beira Mar, 1200, Meia Praia', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', criadoPor: 'u_eber',
      obs: 'Doze cadeiras do salão. Entregar pela porta dos fundos, antes do almoço.'
    }),
    (d) => conf({
      id: 'a71', data: d, horaInicio: '13:30', horaFim: '16:30', tipoId: 't_manutencao_jardim', setorId: 'pai',
      clienteNome: 'Residencial Jardins do Atlântico', localTexto: 'Rua 250, 400, Meia Praia', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3',
      veiculoId: d === H(8) ? 've4' : 've3', criadoPor: 'u_ariane',
      obs: 'Poda das palmeiras da entrada e limpeza dos canteiros da piscina.'
    }),
    (d) => conf({
      id: 'a72', data: d, horaInicio: '14:00', horaFim: '15:00', tipoId: 't_medicao', setorId: 'cor',
      clienteId: 'c1', responsaveis: ['u_eber'], veiculoId: null, criadoPor: 'u_eber',
      obs: 'Cortinas da sala e do quarto do casal.'
    })
  ]);

  emDia(D4, [
    (d) => conf({
      id: 'a73', data: d, horaInicio: '08:30', horaFim: '10:00', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c9', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', criadoPor: 'u_lucimara',
      obs: 'Guarda-roupa de volta da fábrica com as portas novas. Conferir alinhamento com o cliente.'
    }),
    (d) => conf({
      id: 'a74', data: d, horaInicio: '13:30', horaFim: '16:30', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteNome: 'Ana Paula Lemos', localTexto: 'Rua 232, 55, ap 301, Meia Praia', responsaveis: ['u_maria'], veiculoId: 've4', criadoPor: 'u_eber',
      obs: 'Cortina da sala e blackout do quarto.'
    }),
    (d) => conf({
      id: 'a75', data: d, horaInicio: '09:00', horaFim: '11:00', tipoId: 't_entrega', setorId: 'ent',
      clienteNome: 'Escola Pequeno Príncipe', localTexto: 'Rua 280, 900, Andorinha', responsaveis: ['u_cleibiane', 'u_joaomarcelo'], veiculoId: 've2', criadoPor: 'u_herti',
      obs: 'Mesa e 12 cadeiras da sala dos professores. Entregar antes do intervalo das 10:00.'
    }),
    (d) => conf({
      id: 'a76', data: d, horaInicio: '14:00', horaFim: '16:00', tipoId: 't_levantamento', setorId: 'dec',
      clienteNome: 'Família Schneider', localTexto: 'Rua 1926, 40, Centro, Balneário Camboriú', responsaveis: ['u_eber', 'u_herti'], equipeId: 'e4', veiculoId: null, criadoPor: 'u_eber',
      obs: 'Casa inteira, três quartos e área gourmet. Cliente indicado pela Ateliê Vera.'
    })
  ]);

  emDia(D5, [
    (d) => conf({
      id: 'a77', data: d, horaInicio: '08:00', horaFim: '10:00', tipoId: 't_manutencao_jardim', setorId: 'pai',
      clienteId: 'c4', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've4', criadoPor: 'u_ariane',
      obs: 'Forração do fundo, conforme orçamento aprovado. A Saveiro está na oficina, vai a Strada.'
    }),
    (d) => conf({
      id: 'a78', data: d, horaInicio: '09:00', horaFim: '12:00', tipoId: 't_inst_moveis', setorId: 'ent',
      clienteId: 'c8', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_eber',
      obs: 'Estante da sala e aparador do hall da cobertura.'
    }),
    (d) => conf({
      id: 'a79', data: d, horaInicio: '14:00', horaFim: '14:45', tipoId: 't_entrega_flores', setorId: 'flo',
      clienteNome: 'Restaurante Mar Aberto', localTexto: 'Av. Beira Mar, 1200, Meia Praia', responsaveis: ['u_daniela'], veiculoId: 've1', criadoPor: 'u_luciana',
      obs: 'Arranjos das mesas, troca de sexta.'
    })
  ]);

  /* A semana passada: concluídos com checklist inteiro e um não realizado (a87), para Passados e a auditoria. */
  const passados = [];
  const emDiaPassado = (dia, lista) => { if (dia) for (const spec of lista) passados.push(spec(dia)); };

  emDiaPassado(P1, [
    (d) => agPassado({
      id: 'a80', data: d, horaInicio: '09:00', horaFim: '11:30', tipoId: 't_montagem', setorId: 'mov',
      clienteId: 'c10', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_herti',
      obs: 'Mesa de 8 lugares e cadeiras para o casamento.', obsConclusao: 'Montada e nivelada. Cliente conferiu as cadeiras.'
    }),
    (d) => agPassado({
      id: 'a81', data: d, horaInicio: '13:30', horaFim: '16:30', tipoId: 't_manutencao_jardim', setorId: 'pai',
      clienteId: 'c7', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', criadoPor: 'u_ariane',
      obs: 'Poda geral e adubação.', obsConclusao: 'Poda e adubação feitas. Recolhemos 6 sacos de resíduo.'
    })
  ]);
  emDiaPassado(P2, [
    (d) => agPassado({
      id: 'a82', data: d, horaInicio: '09:00', horaFim: '10:00', tipoId: 't_medicao', setorId: 'cor',
      clienteId: 'c8', responsaveis: ['u_eber'], veiculoId: null, criadoPor: 'u_eber',
      obs: 'Medição da sala da cobertura para cortina motorizada.', obsConclusao: 'Vão de 6,20 m, pé-direito 3,10 m. Medidas na ficha.'
    }),
    (d) => agPassado({
      id: 'a83', data: d, horaInicio: '09:00', horaFim: '10:30', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c1', responsaveis: ['u_cleibiane', 'u_joaomarcelo'], veiculoId: 've1', criadoPor: 'u_eber',
      obs: 'Sofá da sala e mesa lateral.', obsConclusao: 'Entregue. Cliente assinou.'
    })
  ]);
  emDiaPassado(P3, [
    (d) => agPassado({
      id: 'a84', data: d, horaInicio: '09:00', horaFim: '12:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteNome: 'Pousada Recanto das Ondas', localTexto: 'Av. Vereador Manoel José dos Santos, 800, Bombas, Bombinhas', responsaveis: ['u_maria'], veiculoId: 've4', criadoPor: 'u_eber',
      obs: 'Blackout de 4 quartos.', obsConclusao: 'Quatro quartos prontos. Faltou um comando, levo na montagem das camas.'
    }),
    (d) => agPassado({
      id: 'a85', data: d, horaInicio: '14:00', horaFim: '15:30', tipoId: 't_entrega', setorId: 'ent',
      clienteId: 'c5', responsaveis: ['u_ryan', 'u_daniela'], equipeId: 'e1', veiculoId: 've1', criadoPor: 'u_ariane',
      obs: 'Cadeiras da recepção, 8 unidades.', obsConclusao: 'Entregue na recepção, conferido com a secretária.'
    })
  ]);
  emDiaPassado(P4, [
    (d) => agPassado({
      id: 'a86', data: d, horaInicio: '08:00', horaFim: '12:00', tipoId: 't_plantio', setorId: 'pai',
      clienteId: 'c11', responsaveis: ['u_aquirony', 'u_vilson'], equipeId: 'e3', veiculoId: 've3', criadoPor: 'u_ariane',
      obs: 'Jardineiras da fachada do escritório.', obsConclusao: 'Plantio concluído. Orientamos rega diária na primeira semana.'
    }),
    (d) => agPassado({
      id: 'a87', data: d, horaInicio: '14:00', horaFim: '16:00', tipoId: 't_montagem', setorId: 'mov',
      clienteNome: 'Sr. Osmar Kretzer', localTexto: 'Rua 900, 210, Centro, Balneário Camboriú', responsaveis: ['u_marilene', 'u_anavitoria'], equipeId: 'e2', veiculoId: 've2', criadoPor: 'u_herti',
      obs: 'Guarda-roupa 6 portas.',
      motivo: { opcao: 'produto_defeito', texto: 'Faltou o kit de ferragens na caixa. Remarcar quando a fábrica mandar.' }
    })
  ]);
  emDiaPassado(P5, [
    (d) => agPassado({
      id: 'a88', data: d, horaInicio: '10:00', horaFim: '11:00', tipoId: 't_assistencia', setorId: 'pos',
      clienteId: 'c7', responsaveis: ['u_samuel'], veiculoId: null, criadoPor: 'u_lucimara',
      obs: 'Gaveta do buffet emperrada.', obsConclusao: 'Corrediça trocada. Porta ainda raspa, precisa de nova visita.'
    }),
    (d) => agPassado({
      id: 'a89', data: d, horaInicio: '08:00', horaFim: '11:00', tipoId: 't_inst_cortinas', setorId: 'cor',
      clienteNome: 'Clínica Sorriso Itapema', localTexto: 'Rua 244, 300, sala 2, Meia Praia', responsaveis: ['u_eber'], veiculoId: 've3', criadoPor: 'u_eber',
      obs: 'Persianas da recepção e dos dois consultórios.', obsConclusao: 'Instaladas e testadas. Cliente aprovou.'
    })
  ]);

  const novos = novosHoje.concat(futuros, passados);
  agendamentos.push(...novos);
  const agPorId = (id) => agendamentos.find((a) => a.id === id);
  const nomeServicoAg = (a) => (tipoPorId(a.tipoId) || {}).nome || a.tipoLivre || 'Serviço';
  const nomeClienteAg = (a) => (a.clienteId ? clientePorId(a.clienteId).nome : a.clienteNome) || '';
  const ROTULO_PERIODO = { manha: 'manhã', tarde: 'tarde', dia: 'dia todo' };
  const rotuloAg = (a) => [nomeServicoAg(a), nomeClienteAg(a), util.fmtData(a.data).slice(0, 5) + ' ' + (a.horaAproximada ? ROTULO_PERIODO[a.periodo] || a.horaInicio : a.horaInicio)].filter(Boolean).join(', ');
  const acaoCriacao = (a) => (a.origem === 'whatsapp' ? 'registro_colado' : a.origem === 'app' ? 'registro_rapido' : 'servico_criado');

  /* ---- Presenças do dia (DIRECAO-3 2.3 e lote 1, item 8): cinco que imitam as capturas do grupo. Duas no galpão
     (Lenilza 08:28 e Marilene 08:38, as duas lidas do grupo), uma na loja (João Marcelo 08:49, "Em loja"), uma na rua
     (Cleibiane, marcada no app) e uma de folga (Maria, marcada no app). Um documento por pessoa por dia, com o primeiro
     passo no histórico. `servico` nunca é gravado: quem está em serviço (Ryan e Daniela, no a1) é derivado. ---- */
  const presenca = (id, userId, lugar, desde, origem, mensagemOriginal) => {
    const ts = util.msDe(dH, desde);
    return Object.assign({
      id, userId, data: dH, lugar, lugarTexto: '', desde, origem, servicoId: null, registradoPor: userId,
      mensagemOriginal: mensagemOriginal || '',
      historico: [{ lugar, lugarTexto: '', desde, ts, por: userId, origem }]
    }, base(ts));
  };
  const presencas = [
    presenca('pr1', 'u_leni', 'galpao', '08:28', 'whatsapp', 'Galpão'),
    presenca('pr2', 'u_marilene', 'galpao', '08:38', 'whatsapp', 'Bom dia  galpão'),
    presenca('pr3', 'u_joaomarcelo', 'loja', '08:49', 'whatsapp', 'Em loja'),
    presenca('pr4', 'u_cleibiane', 'rua', '08:53', 'app', ''),
    presenca('pr5', 'u_maria', 'folga', '08:05', 'app', ''),
    /* Rodada 5: a maioria das pessoas de campo avisa onde está. Ficam sem aviso, de propósito, Herti e Samuel, para o
       quadro da Monica mostrar a cobrança (Eber não serve: criou o a1, e quem cria registro conta como avisado).
       Ryan e Daniela avisaram galpão, mas o quadro mostra os dois em serviço (a1). */
    presenca('pr6', 'u_ryan', 'galpao', '07:35', 'app', ''),
    presenca('pr7', 'u_daniela', 'galpao', '07:40', 'whatsapp', 'Galpão'),
    presenca('pr8', 'u_vilson', 'galpao', '07:45', 'app', ''),
    presenca('pr9', 'u_aquirony', 'rua', '07:50', 'whatsapp', 'Bom dia, saindo pro jardim da Dona Marlene'),
    presenca('pr10', 'u_eber', 'loja', '08:10', 'app', ''),
    presenca('pr11', 'u_anavitoria', 'galpao', '08:20', 'app', ''),
    /* Rodada 6: João Vitor entrou na equipe e avisa galpão, para Herti e Samuel continuarem os únicos sem aviso. */
    presenca('pr12', 'u_joaovitor', 'galpao', '07:55', 'app', '')
  ];
  const usuarioPorId = (id) => usuarios.find((u) => u.id === id);
  const ROTULO_LUGAR = { loja: 'Na loja', galpao: 'No galpão', rua: 'Na rua', folga: 'Folga', outro: 'Outro lugar' };

  /* ---- Config ---- */
  const config = Object.assign({
    id: 'config',
    horario: {
      seg: faixasSemana(), ter: faixasSemana(), qua: faixasSemana(), qui: faixasSemana(), sex: faixasSemana(),
      sab: [{ de: '08:30', ate: '12:30' }], dom: null
    },
    horariosSetor: { flo: { de: '08:00', ate: '19:00' } },
    excecoes: [],
    feriados: FERIADOS.map((f) => Object.assign({}, f, { ativo: true })),
    loja: Object.assign({}, LOJA),
    locais: LOCAIS.map((l) => Object.assign({}, l)),
    folgaDeslocamentoMin: 30,
    folgaAntesMin: 0,
    folgaDepoisMin: 30,
    antecedenciaMinMin: 120,
    janelaDias: 90,
    rodizio: 'menos_servicos',
    mensagens: Object.assign({}, MENSAGENS),
    horaCorteAmanha: '17:00',
    slotMin: 30,
    passoSugestaoMin: 15,
    duracaoPadraoMin: 90,
    atrasoInicioMin: 20,
    atrasoFimMin: 30,
    notificacoesMax: 600,
    auditoriaMax: 1000
  }, base(agoraMs));

  /* ---- Notificações ---- */
  const a4 = agPorId('a4');
  const a9 = agPorId('a9');
  const a15 = agPorId('a15');
  const notif = (id, campos) => Object.assign({ id, lidaPor: [], acoes: [] }, campos, base(campos.ts));
  const notificacoes = [
    notif('n1', {
      tipo: 'conflito', titulo: 'Liberação pedida',
      texto: 'Herti pediu liberação para Visita técnica, Roberto Siqueira, ' + util.fmtDataMedia(a4.data) + ', 09:00 às 12:00: ' + a4.liberacao.texto,
      ts: min(2500), para: GESTORES.slice(), link: '#/servico/a4', acoes: [{ rotulo: 'Abrir serviço', rota: '#/servico/a4' }]
    }),
    notif('n2', {
      tipo: 'status', titulo: 'Não realizado',
      texto: 'Entrega, Gilberto Nascimento, ' + util.fmtDataMedia(a9.data) + ', 14:00. Cliente ausente: ' + a9.motivoNaoRealizado.texto,
      ts: a9.motivoNaoRealizado.quando, para: GESTORES.concat('u_eber'), link: '#/servico/a9'
    }),
    notif('n3', {
      tipo: 'agenda', titulo: 'Novo serviço: Entrega de flores, ' + util.DIAS_ABR[util.diaSemana(a15.data)],
      texto: 'Simone Carvalho, ' + util.fmtDataMedia(a15.data) + ', 14:00 às 15:30, Fiorino.',
      ts: a15.criadoEm, para: ['u_ryan', 'u_daniela'], link: '#/servico/a15'
    })
  ];

  /* Rodada 5: as notificações que as regras teriam disparado nos registros novos, com o mesmo texto de
     regras.mudarStatus (gestores mais quem criou; cancelamento também para quem ia). Só o que já aconteceu. */
  const primeiroNomeDe = (id) => util.nomeCurto((usuarioPorId(id) || { nome: id }).nome);
  const destinatariosDe = (a) => util.unicos(GESTORES.concat(a.criadoPor));
  let seqNotif = 3;
  const notifAg = (a, campos) => notif('n' + (++seqNotif), Object.assign({ link: '#/servico/' + a.id }, campos));
  const notifDeEstado = (a) => {
    const lider = a.responsaveis[0] || a.criadoPor;
    const texto = rotuloAg(a);
    if (a.status === 'concluido' && a.data === dH) return notifAg(a, { tipo: 'status', titulo: 'Serviço concluído', texto: primeiroNomeDe(lider) + ' concluiu ' + texto, ts: a.concluidoEm, para: destinatariosDe(a) });
    if (a.status === 'em_andamento' && a.data === dH) return notifAg(a, { tipo: 'status', titulo: 'Serviço iniciado', texto: primeiroNomeDe(lider) + ' começou ' + texto, ts: a.alteradoEm, para: destinatariosDe(a) });
    if (a.status === 'nao_realizado') return notifAg(a, { tipo: 'status', titulo: 'Não realizado', texto: texto + '. ' + ROTULO_MOTIVO[a.motivoNaoRealizado.opcao] + ': ' + a.motivoNaoRealizado.texto, ts: a.motivoNaoRealizado.quando, para: destinatariosDe(a) });
    if (a.status === 'cancelado') return notifAg(a, { tipo: 'agenda', titulo: 'Serviço cancelado', texto, ts: a.motivoCancelamento.quando, para: util.unicos(a.responsaveis.concat(destinatariosDe(a))) });
    if (a.status === 'reagendado') return notifAg(a, { tipo: 'agenda', titulo: 'Serviço reagendado', texto: texto + '. ' + ROTULO_MOTIVO[a.reagendamentos[0].motivo.opcao], ts: a.reagendamentos[0].quando, para: util.unicos(a.responsaveis.concat(destinatariosDe(a))) });
    return null;
  };
  const derivadosDoSeedOriginal = [agPorId('a16'), agPorId('a2')];
  for (const a of novos.concat(derivadosDoSeedOriginal)) { const n = notifDeEstado(a); if (n) notificacoes.push(n); }
  const a50 = agPorId('a50');
  const a53 = agPorId('a53');
  if (a50) notificacoes.push(notifAg(a50, { tipo: 'agenda', titulo: 'Novo serviço: Troca do motor, ' + util.DIAS_ABR[util.diaSemana(a50.data)], texto: 'Samuel registrou: ' + rotuloAg(a50) + ', Fiorino, com você.', ts: a50.criadoEm, para: ['u_ryan'] }));
  if (a53) notificacoes.push(notifAg(a53, { tipo: 'agenda', titulo: 'Novo serviço: Instalação de cortinas, ' + util.DIAS_ABR[util.diaSemana(a53.data)], texto: rotuloAg(a53) + ', Strada. Aguarda confirmação.', ts: a53.criadoEm, para: ['u_maria'] }));
  notificacoes.sort((x, y) => y.ts - x.ts);

  /* ---- Auditoria ---- */
  let seqLog = 0;
  const log = (campos) => Object.assign({
    id: 'l_seed_' + String(++seqLog).padStart(3, '0'),
    ts: campos.ts, userId: campos.userId, acao: campos.acao, entidade: campos.entidade || 'agendamento',
    entidadeId: campos.entidadeId != null ? campos.entidadeId : null, rotulo: campos.rotulo,
    campos: campos.campos || null, motivo: campos.motivo || null, setorId: campos.setorId || null, origem: 'online'
  }, base(campos.ts));
  const logAg = (a, acao, extras = {}) => log(Object.assign({ ts: a.criadoEm, userId: a.criadoPor, acao, entidadeId: a.id, rotulo: rotuloAg(a), setorId: a.setorId }, extras));

  const a1 = agPorId('a1');
  const a8 = agPorId('a8');
  const a14 = agPorId('a14');
  const a18 = agPorId('a18');
  const a19 = agPorId('a19');
  const a21 = agPorId('a21');
  const a23 = agPorId('a23');

  /* Rodada 5: os passos de status que os registros novos já deram, no formato que regras.mudarStatus audita. */
  const campoStatus = (antes, depois) => [{ campo: 'status', rotulo: 'Status', antes, depois }];
  const logsDeEstado = (a) => {
    const lider = a.responsaveis[0] || a.criadoPor;
    const iniMs = util.msDe(a.data, a.horaInicio);
    const lista = [];
    if (a.status === 'a_caminho') lista.push(logAg(a, 'status_alterado', { ts: a.alteradoEm, userId: lider, campos: campoStatus('Confirmado', 'A caminho') }));
    if (a.status === 'em_andamento') lista.push(logAg(a, 'status_alterado', { ts: a.alteradoEm, userId: lider, campos: campoStatus('Confirmado', 'Em andamento') }));
    if (a.status === 'concluido') {
      lista.push(logAg(a, 'status_alterado', { ts: iniMs + 3 * MS_MIN, userId: lider, campos: campoStatus('Confirmado', 'Em andamento') }));
      lista.push(logAg(a, 'servico_concluido', { ts: a.concluidoEm, userId: lider, motivo: a.obsConclusao }));
    }
    if (a.status === 'nao_realizado') lista.push(logAg(a, 'servico_nao_realizado', { ts: a.motivoNaoRealizado.quando, userId: a.motivoNaoRealizado.por, motivo: ROTULO_MOTIVO[a.motivoNaoRealizado.opcao] + ': ' + a.motivoNaoRealizado.texto }));
    if (a.status === 'cancelado') lista.push(logAg(a, 'servico_cancelado', { ts: a.motivoCancelamento.quando, userId: a.motivoCancelamento.por, motivo: ROTULO_MOTIVO[a.motivoCancelamento.opcao] + ': ' + a.motivoCancelamento.texto }));
    if (a.status === 'reagendado') {
      const r = a.reagendamentos[0];
      lista.push(logAg(a, 'servico_reagendado', {
        ts: r.quando, userId: r.por, motivo: ROTULO_MOTIVO[r.motivo.opcao] + (r.motivo.texto ? ': ' + r.motivo.texto : ''),
        campos: [{ campo: 'data', rotulo: 'Data', antes: util.fmtData(r.de.data).slice(0, 5), depois: util.fmtData(a.data).slice(0, 5) }]
      }));
    }
    return lista;
  };

  const auditoria = agendamentos.map((a) => logAg(a, acaoCriacao(a))).concat(novos.concat(derivadosDoSeedOriginal).flatMap(logsDeEstado), [
    logAg(a1, 'status_alterado', { ts: util.msDe(a1.data, a1.horaInicio), userId: 'u_ryan', campos: [{ campo: 'status', rotulo: 'Status', antes: 'Confirmado', depois: 'Em andamento' }] }),
    logAg(a21, 'status_alterado', { ts: a21.alteradoEm, userId: 'u_eder', campos: [{ campo: 'status', rotulo: 'Status', antes: 'Confirmado', depois: 'Em andamento' }] }),
    logAg(a23, 'servico_nao_realizado', { ts: a23.motivoNaoRealizado.quando, userId: 'u_daniela', motivo: 'Cliente ausente: ' + a23.motivoNaoRealizado.texto }),
    logAg(a8, 'servico_concluido', { ts: a8.concluidoEm, userId: 'u_ryan', motivo: a8.obsConclusao }),
    logAg(a14, 'servico_concluido', { ts: a14.concluidoEm, userId: 'u_daniela' }),
    logAg(a9, 'servico_nao_realizado', { ts: a9.motivoNaoRealizado.quando, userId: 'u_ryan', motivo: 'Cliente ausente: ' + a9.motivoNaoRealizado.texto }),
    logAg(a19, 'servico_cancelado', { ts: a19.motivoCancelamento.quando, userId: 'u_eber', motivo: 'Venda cancelada: ' + a19.motivoCancelamento.texto }),
    logAg(a18, 'servico_reagendado', {
      ts: a18.reagendamentos[0].quando, userId: 'u_lucimara', motivo: 'Cliente pediu',
      campos: [{ campo: 'data', rotulo: 'Data', antes: util.fmtData(a18.reagendamentos[0].de.data).slice(0, 5), depois: util.fmtData(a18.data).slice(0, 5) }]
    }),
    logAg(a4, 'liberacao_pedida', { ts: a4.liberacao.pedidoEm, userId: 'u_herti', motivo: a4.liberacao.texto }),
    ...presencas.map((p) => log({
      ts: p.criadoEm, userId: p.userId, acao: 'presenca_marcada', entidade: 'presenca', entidadeId: p.id,
      rotulo: usuarioPorId(p.userId).nome + ', ' + ROTULO_LUGAR[p.lugar] + ', desde ' + p.desde,
      campos: [{ campo: 'lugar', rotulo: 'Lugar', antes: '', depois: ROTULO_LUGAR[p.lugar] }]
    })),
    log({ ts: indisponibilidades[0].criadoEm, userId: 'u_ariane', acao: 'indisponibilidade_criada', entidade: 'indisponibilidade', entidadeId: 'i1', rotulo: 'Baú, ' + util.fmtData(H(4)).slice(0, 5) + ', dia inteiro: revisão', motivo: indisponibilidades[0].detalhe }),
    log({ ts: indisponibilidades[1].criadoEm, userId: 'u_monica', acao: 'indisponibilidade_criada', entidade: 'indisponibilidade', entidadeId: 'i2', rotulo: 'Saveiro, ' + util.fmtData(H(8)).slice(0, 5) + ', dia inteiro: oficina', motivo: indisponibilidades[1].detalhe }),
    log({ ts: min(5), userId: 'u_monica', acao: 'login', entidade: 'sessao', entidadeId: 'u_monica', rotulo: 'Monica' })
  ]).sort((x, y) => y.ts - x.ts || y.id.localeCompare(x.id));

  const meta = Object.assign({ id: 'meta', versaoEsquema: 5, versaoSeed: 6, seedCriadoEm: agoraMs, seedHoje: hoje }, base(agoraMs));

  return {
    usuarios, senhas, clientes, tipos, equipes, veiculos, indisponibilidades, agendamentos,
    assinaturas: [], config, notificacoes, auditoria, filaSync: [], meta, presencas
  };
}
