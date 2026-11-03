// Busca as batidas no Ponto System e gera um arquivo para "Importar batidas" na tela Ponto.
//
// Uso (Node 18+), com a chave da API numa variável de ambiente — nunca no código:
//   PowerShell:  $env:PONTO_CHAVE = '...'; node ferramentas/sincronizar-ponto.js 2026-10-01 2026-10-31
//   Sem datas, busca os últimos 7 dias até ontem.
//   Com --ficha, só junta de novo a ficha do RH (dados-ponto/cadastro-rh.json) ao último arquivo.
//
// A API libera o relatório de marcações um dia por vez e no máximo 3 relatórios por minuto,
// então um mês leva uns 11 minutos. Quando o RH for para o servidor do painel, esta mesma rotina
// roda sozinha toda madrugada buscando o dia anterior.

const fs = require('fs');

const CORE = 'https://core.pontosystemweb.com.br/api';
const TIMESHEET = 'https://timesheet.pontosystemweb.com.br/api';
const INTERVALO_RELATORIOS = 21000; // 3 por minuto

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDias = (s, n) => { const [a, m, d] = s.split('-').map(Number); return iso(new Date(a, m - 1, d + n)); };
const diffDias = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
const espera = ms => new Promise(r => setTimeout(r, ms));

async function api(url, token, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opcoes.headers },
  });
  if (!r.ok) throw new Error(`${r.status} em ${url}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function entrar(chave) {
  const r = await api(`${CORE}/v1/auth-external-api/login`, null, { method: 'POST', body: JSON.stringify({ key: chave }) });
  return (await r.json()).token;
}

async function listar(token, recurso) {
  const lista = [];
  for (let page = 1; ; page++) {
    const j = await (await api(`${TIMESHEET}/external/v1/${recurso}?limit=100&page=${page}`, token)).json();
    lista.push(...j.results);
    if (page >= j.pages) return lista;
  }
}

// Entrada e saída de cada horário cadastrado: início do primeiro turno e fim do último, no primeiro dia com jornada
async function entradas(token) {
  const mapa = {};
  (await listar(token, 'schedules')).forEach(h => {
    const dia = [...(h.workloads || [])].sort((a, b) => a.day - b.day).find(w => w.shifts && w.shifts.length);
    mapa[h.id] = { nome: h.name.trim(), entrada: dia ? dia.shifts[0][0] : '', saida: dia ? dia.shifts[dia.shifts.length - 1][1] : '' };
  });
  return mapa;
}

// Pede o relatório de um dia e acompanha o processamento até terminar
async function marcacoesDoDia(token, data) {
  const corpo = {
    startAt: data, endAt: data, includeFiredEmployees: true, showRecordCollector: true, showRecordOrigin: false,
    filters: { collectors: [], employees: [], companies: [], departments: [], structures: [], roles: [], schedules: [], groups: [] },
  };
  const { id } = await (await api(`${TIMESHEET}/external/v1/report/allocated-records`, token, { method: 'POST', body: JSON.stringify(corpo) })).json();
  const r = await api(`${TIMESHEET}/v2/async-processing-monitor/${id}`, token, { headers: { Accept: 'text/event-stream' } });
  const texto = await r.text();
  const eventos = texto.split(/\n\n/).filter(e => e.includes('data:'))
    .map(e => JSON.parse(e.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('')));
  const fim = eventos.find(e => e.complete) || eventos[eventos.length - 1];
  if (!fim || fim.error) throw new Error(`Relatório de ${data} falhou: ${fim ? fim.reason : 'sem resposta'}`);
  return fim.report || { days: [], collectors: {} };
}

// Ficha do RH (dados-ponto/cadastro-rh.json): sexo, admissão, loja, cargo, folgas e domingos que o ponto não tem
function juntarFicha(saida) {
  const chaveNome = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const arqFicha = require('path').join(__dirname, '..', 'dados-ponto', 'cadastro-rh.json');
  const ficha = fs.existsSync(arqFicha) ? JSON.parse(fs.readFileSync(arqFicha, 'utf8')) : {};
  const fichaPorNome = {};
  Object.entries(ficha).forEach(([nome, rh]) => { if (!nome.startsWith('_')) fichaPorNome[chaveNome(nome)] = rh; });
  saida.pessoas.forEach(p => { delete p.rh; if (fichaPorNome[chaveNome(p.nome)]) p.rh = fichaPorNome[chaveNome(p.nome)]; });
  // Quem está na ficha mas não no ponto (ex.: gerente que não bate ponto) entra direto no cadastro
  const doPonto = new Set(saida.pessoas.map(p => chaveNome(p.nome)));
  saida.fichasSemPonto = Object.entries(fichaPorNome).filter(([nome]) => !doPonto.has(nome)).map(([nome, rh]) => ({ nome, ...rh }));
}

// Salva em RH/dados-ponto, onde a tela Ponto procura o arquivo para importar
function gravar(saida) {
  const pasta = require('path').join(__dirname, '..', 'dados-ponto');
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = require('path').join(pasta, `ponto-${saida.inicio}-a-${saida.fim}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(saida));
  // ultimo.js: o site carrega sozinho ao abrir, sem precisar importar
  fs.writeFileSync(require('path').join(pasta, 'ultimo.js'), `window.PONTO_ULTIMO = ${JSON.stringify(saida)};\n`);
  return arquivo;
}

async function main() {
  // --ficha: só junta a ficha do RH de novo ao último arquivo, sem consultar o ponto
  if (process.argv[2] === '--ficha') {
    const ultimo = require('path').join(__dirname, '..', 'dados-ponto', 'ultimo.js');
    const saida = JSON.parse(fs.readFileSync(ultimo, 'utf8').replace(/^window\.PONTO_ULTIMO = /, '').replace(/;\s*$/, ''));
    saida.geradoEm = new Date().toISOString();
    juntarFicha(saida);
    console.log(`Ficha atualizada em ${gravar(saida)}`);
    return;
  }
  const chave = process.env.PONTO_CHAVE;
  if (!chave) { console.error('Defina a variável PONTO_CHAVE com a chave da API do Ponto System.'); process.exit(1); }
  const ontem = addDias(iso(new Date()), -1);
  const inicio = process.argv[2] || addDias(ontem, -6);
  const fim = process.argv[3] || (process.argv[2] ? inicio : ontem);

  const token = await entrar(chave);
  const gente = await listar(token, 'employees');
  const horarios = await entradas(token);
  const saida = {
    fonte: 'pontosystem', geradoEm: new Date().toISOString(), inicio, fim,
    pessoas: gente.map(p => {
      const h = p.schedule ? horarios[p.schedule.id] || {} : {};
      return { codigo: p.id, nome: p.name, cargo: p.role ? p.role.name : '', empresa: p.company ? p.company.name : '', horario: h.nome || '', entrada: h.entrada || '', saida: h.saida || '', desligado: p.firedAt || '', local: '' };
    }),
    coletores: {},
    batidas: [],
  };

  for (let data = inicio, n = 0; data <= fim; data = addDias(data, 1), n++) {
    if (n) await espera(INTERVALO_RELATORIOS);
    const rel = await marcacoesDoDia(token, data);
    Object.assign(saida.coletores, rel.collectors || {});
    (rel.days || []).forEach(dia => dia.employees.forEach(({ employee, records }) => records
      .filter(x => x.type !== 'D') // D = marcação desconsiderada
      .forEach(x => {
        // Dia de trabalho = dia da linha; a saída depois da meia-noite passa de 24h
        const [d, h] = x.date.split('T');
        const min = Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) + diffDias(dia.date, d) * 1440;
        saida.batidas.push({ codigo: employee.id, nome: employee.name, data: dia.date, min, tipo: x.type, local: rel.collectors ? rel.collectors[x.collectorId] || '' : '' });
      })));
    console.log(`${data}: ${(rel.days || []).reduce((s, d) => s + d.employees.length, 0)} pessoas`);
  }

  juntarFicha(saida);

  // Relógio onde cada pessoa mais bateu ponto no período (indica a loja)
  saida.pessoas.forEach(p => {
    const conta = {};
    saida.batidas.filter(b => b.codigo === p.codigo && b.local).forEach(b => { conta[b.local] = (conta[b.local] || 0) + 1; });
    p.local = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0] || '';
  });

  const arquivo = gravar(saida);
  console.log(`Pronto: ${saida.batidas.length} batidas em ${arquivo}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
