// Cadastro e persistência. Os dados ficam no servidor do RH (js/nuvem.js), com cópia no navegador (localStorage).

const LOJAS = ['Jardim Atlântico', 'Campeche', 'Itacorubi', 'Palhoça', 'Biguaçu', 'Forquilhinhas', 'Produção', 'Administrativo'];

// Cargo que está na carteira de trabalho, agrupado por setor
const CARGOS = {
  'Cozinha': ['montador', 'prensador', 'auxiliar de cozinha', 'cozinheiro', 'cozinheiro gerente'],
  'Loja': ['caixa de loja', 'motoboy', 'auxiliar de serviços gerais', 'sub gerente', 'gerente de loja', 'gerente dia', 'supervisor geral'],
  'Administrativo': ['gerente geral', 'gerente financeiro', 'gerente comercial', 'assistente administrativo', 'auxiliar administrativo'],
};
const LISTA_CARGOS = Object.values(CARGOS).flat();

// Funções que entram na conta da equipe mínima
const FUNCOES_ESCALA = ['montador', 'prensador', 'auxiliar de cozinha', 'despacho', 'salão'];
const OUTRAS_FUNCOES = LISTA_CARGOS.filter(c => !FUNCOES_ESCALA.includes(c));

const TURNOS = ['Dia', 'Noite'];
const FOLGAS = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };
const SITUACOES = ['Ativo', 'Férias', 'Afastado', 'Desligado'];
const TIPOS_FERIADO = ['Nacional', 'SC', 'Municipal'];

const CHAVE = 'rh-grupo-chd-v1';

// Números do Jardim Atlântico; as outras lojas ainda não têm equipe mínima definida.
// feriadoExtra: pessoas a mais na cozinha (ideal) em feriado e véspera
function equipePadrao(definida) {
  return {
    definida,
    semana: { 'montador': 1, 'prensador': 1, 'auxiliar de cozinha': 1, 'despacho': 1, 'salão': 1 },
    domingo: { 'montador': 2, 'prensador': 1, 'auxiliar de cozinha': 1, 'despacho': 1, 'salão': 1 },
    feriadoExtra: 1,
  };
}

function dadosIniciais() {
  const equipeMinima = {};
  LOJAS.forEach(l => { equipeMinima[l] = equipePadrao(l === 'Jardim Atlântico'); });
  const amaral = {
    id: novoId(), nome: 'Amaral', loja: 'Jardim Atlântico', cargo: '', sexo: 'H',
    funcoes: ['salão'], turno: '', entrada: '', horaSaida: '', codigoPonto: '', folgas: [], inicio: '', situacao: 'Ativo', saida: '',
    alternaDomingos: true, obs: 'Exceção: alterna domingos como as mulheres',
  };
  return {
    versao: 1,
    funcionarios: [amaral],
    // domingos[loja][data] = ids de quem folga naquele domingo
    domingos: {},
    // freelancers já combinados para um dia: { id, loja, data, nome, funcao }
    freelas: [],
    feriados: [
      { id: novoId(), data: '2026-11-02', nome: 'Finados', tipo: 'Nacional', lojas: [] },
      { id: novoId(), data: '2026-11-15', nome: 'Proclamação da República', tipo: 'Nacional', lojas: [] },
      { id: novoId(), data: '2026-11-20', nome: 'Consciência Negra', tipo: 'Nacional', lojas: [] },
      { id: novoId(), data: '2026-12-25', nome: 'Natal', tipo: 'Nacional', lojas: [] },
      { id: novoId(), data: '2027-01-01', nome: 'Confraternização Universal', tipo: 'Nacional', lojas: [] },
    ],
    ferias: [{
      id: novoId(), funcId: amaral.id, periodoInicio: '',
      partes: [{ inicio: '2026-11-03', fim: '2026-12-01' }],
      substituto: 'Substituto (contrato de 30 dias)', mesmoEsquema: true, quitado: true,
    }],
    equipeMinima,
    // batidas[funcId][data] = minutos de cada batida (ver ponto.js)
    batidas: {},
    // Até quantos minutos de atraso fica verde e até quantos fica amarelo;
    // chegar mais cedo que chegadaCedo (min) conta como hora extra
    pontoConfig: { verde: 5, amarelo: 15, chegadaCedo: 10 },
    // Pessoas cadastradas no sistema de ponto: { codigo, nome, cargo, empresa }
    pontoPessoas: [],
    // geradoEm do último arquivo do ponto importado
    pontoImportado: '',
    lembretesVistos: {},
  };
}

function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE));
    if (salvo && salvo.versao === 1) return completar(salvo);
  } catch (e) { /* dados corrompidos: começa do zero */ }
  return dadosIniciais();
}

// Garante campos novos em dados antigos ou importados
function completar(d) {
  const base = dadosIniciais();
  for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
  d.pontoConfig = { ...base.pontoConfig, ...d.pontoConfig };
  d.funcionarios.forEach(f => {
    if (f.cargo === undefined) f.cargo = '';
    if (f.entrada === undefined) f.entrada = '';
    if (f.horaSaida === undefined) f.horaSaida = '';
    if (f.codigoPonto === undefined) f.codigoPonto = '';
    if (!f.funcoes.length && f.setor === 'Salão') f.funcoes = ['salão'];
    f.funcoes = f.funcoes.map(x => (x === 'auxiliar' ? 'auxiliar de cozinha' : x));
    if (f.turno === 'Dia/Express') f.turno = 'Dia';
    if (!Array.isArray(f.folgas)) f.folgas = f.folga ? [f.folga] : [];
    delete f.folga;
    delete f.setor;
  });
  LOJAS.forEach(l => {
    const c = d.equipeMinima[l];
    if (!c || typeof c.semana !== 'object') d.equipeMinima[l] = equipePadrao(c ? !!c.definida : false);
  });
  return d;
}

let DB = carregar();

function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(DB));
  } catch (e) { /* cópia local cheia: o servidor continua guardando */ }
  if (typeof nuvemSalvou === 'function') nuvemSalvou();
}

function funcionario(id) {
  return DB.funcionarios.find(f => f.id === id);
}

// ---------- Importação da Base de Equipes (CSV) ----------

const COLUNAS_CSV = ['nome', 'loja', 'cargo', 'sexo', 'funcoes', 'turno', 'entrada', 'codigo', 'folgas', 'inicio', 'situacao', 'observacao'];

function modeloCsv() {
  return COLUNAS_CSV.join(';') + '\n' +
    'Maria Souza;Campeche;auxiliar de cozinha;M;auxiliar de cozinha, montador;Noite;18:00;;terça, quarta;15/03/2024;Ativo;\n' +
    'João Lima;Jardim Atlântico;gerente de loja;H;montador;Noite;17:30;;segunda;02/05/2022;Ativo;\n';
}

const semAcento = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function acharOpcao(valor, opcoes) {
  const v = semAcento(valor);
  return opcoes.find(o => semAcento(o) === v) || opcoes.find(o => v && semAcento(o).startsWith(v)) || '';
}

// Retorna { funcionarios, erros }
function lerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return { funcionarios: [], erros: ['Arquivo vazio.'] };
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map(semAcento);
  const col = (...nomes) => cab.findIndex(c => nomes.includes(c));
  if (col('nome') < 0) return { funcionarios: [], erros: ['Falta a coluna "nome" no cabeçalho.'] };

  const funcionarios = [];
  const erros = [];
  linhas.slice(1).forEach((linha, i) => {
    const c = linha.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
    const val = (...nomes) => (col(...nomes) >= 0 ? c[col(...nomes)] || '' : '');
    const nome = val('nome');
    if (!nome) return;
    const loja = acharOpcao(val('loja'), LOJAS);
    if (!loja) erros.push(`Linha ${i + 2} (${nome}): loja "${val('loja')}" não reconhecida.`);
    const cargo = acharOpcao(val('cargo'), LISTA_CARGOS);
    if (val('cargo') && !cargo) erros.push(`Linha ${i + 2} (${nome}): cargo "${val('cargo')}" não reconhecido.`);
    // Folgas fixas: "segunda, terça" ou "segunda e terça"
    const folgas = semAcento(val('folgas', 'folga')).split(/,|\/|\se\s/)
      .map(x => x.trim().slice(0, 3)).filter(x => FOLGAS[x]);
    // H = homem, M = mulher (aceita também "masculino"/"feminino")
    const sx = semAcento(val('sexo'));
    const sexo = sx.startsWith('f') || (sx.startsWith('m') && !sx.startsWith('masc')) ? 'M' : 'H';
    const funcoes = val('funcoes', 'funcao').split(/[,/]/)
      .map(x => acharOpcao(x, [...FUNCOES_ESCALA, ...OUTRAS_FUNCOES]) || x.trim().toLowerCase())
      .filter(Boolean);
    funcionarios.push({
      id: novoId(), nome, loja: loja || LOJAS[0], cargo, sexo,
      funcoes: [...new Set(funcoes)],
      turno: acharOpcao(val('turno'), TURNOS),
      entrada: /^\d{1,2}:\d{2}$/.test(val('entrada')) ? val('entrada').padStart(5, '0') : '',
      codigoPonto: val('codigo', 'matricula'),
      folgas: [...new Set(folgas)],
      inicio: lerData(val('inicio')),
      situacao: acharOpcao(val('situacao'), SITUACOES) || 'Ativo',
      saida: '',
      alternaDomingos: sexo === 'M',
      obs: val('observacao'),
    });
  });
  return { funcionarios, erros };
}
