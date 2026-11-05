// Servidor do RH: guarda os dados do site num lugar só (todo computador vê o mesmo)
// e busca as batidas do Ponto System toda madrugada.
//
// Rotas (?acao=...):
//   dados       GET   estado salvo + versão (?desde=versão)         (código de acesso)
//   salvar      POST  { dados, versao } → nova versão ou 409       (código de acesso)
//   ponto       GET   último arquivo do ponto (?desde=geradoEm)     (código de acesso)
//   sincronizar POST  busca o ponto de ontem (ou ?inicio=&fim=)    (segredo do servidor)
//   enviar      POST  { ponto?, ficha? } vindos do computador do RH (segredo do servidor)
//
// O código de acesso, a chave do Ponto System e o segredo do servidor ficam na tabela "segredos",
// que só esta função lê.

import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-rh-codigo, x-rh-servidor',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function segredo(nome: string) {
  const { data } = await db.from('segredos').select('valor').eq('nome', nome).single();
  return data?.valor as string | undefined;
}

async function sha256(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Código de acesso, com trava contra tentativa e erro: 10 erros em 15 minutos bloqueiam o IP
async function codigoOk(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'sem-ip';
  const desde = new Date(Date.now() - 15 * 60000).toISOString();
  const { count } = await db.from('tentativas').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('quando', desde);
  if ((count || 0) >= 10) return 'bloqueado';
  const certo = await segredo('codigo_hash');
  if (certo && (await sha256('rh-chd:' + (req.headers.get('x-rh-codigo') || ''))) === certo) return 'ok';
  await db.from('tentativas').insert({ ip });
  await new Promise(r => setTimeout(r, 1000));
  return 'errado';
}

// ---------- Ponto System ----------

const CORE = 'https://core.pontosystemweb.com.br/api';
const TIMESHEET = 'https://timesheet.pontosystemweb.com.br/api';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDias = (s: string, n: number) => { const [a, m, d] = s.split('-').map(Number); return iso(new Date(Date.UTC(a, m - 1, d + n))); };
const diffDias = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00Z') - Date.parse(a + 'T12:00Z')) / 86400000);
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const chaveNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const GUARDA_DIAS = 70; // batidas guardadas (dá para o relatório do mês anterior inteiro)

async function api(url: string, token: string | null, opcoes: RequestInit = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} em ${url}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function listar(token: string, recurso: string) {
  const lista: any[] = [];
  for (let page = 1; ; page++) {
    const j = await (await api(`${TIMESHEET}/external/v1/${recurso}?limit=100&page=${page}`, token)).json();
    lista.push(...j.results);
    if (page >= j.pages) return lista;
  }
}

async function marcacoesDoDia(token: string, data: string) {
  const corpo = {
    startAt: data, endAt: data, includeFiredEmployees: true, showRecordCollector: true, showRecordOrigin: false,
    filters: { collectors: [], employees: [], companies: [], departments: [], structures: [], roles: [], schedules: [], groups: [] },
  };
  const { id } = await (await api(`${TIMESHEET}/external/v1/report/allocated-records`, token, { method: 'POST', body: JSON.stringify(corpo) })).json();
  const r = await api(`${TIMESHEET}/v2/async-processing-monitor/${id}`, token, { headers: { Accept: 'text/event-stream' } });
  const eventos = (await r.text()).split(/\n\n/).filter(e => e.includes('data:'))
    .map(e => JSON.parse(e.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('')));
  const fim = eventos.find(e => e.complete) || eventos[eventos.length - 1];
  if (!fim || fim.error) throw new Error(`Relatório de ${data} falhou: ${fim ? fim.reason : 'sem resposta'}`);
  return fim.report || { days: [], collectors: {} };
}

async function sincronizar(inicio: string, fim: string) {
  const chave = await segredo('ponto_chave');
  if (!chave) throw new Error('Chave do Ponto System não cadastrada');
  const { token } = await (await api(`${CORE}/v1/auth-external-api/login`, null, { method: 'POST', body: JSON.stringify({ key: chave }) })).json();

  const horarios: Record<string, any> = {};
  (await listar(token, 'schedules')).forEach((h: any) => {
    const dia = [...(h.workloads || [])].sort((a: any, b: any) => a.day - b.day).find((w: any) => w.shifts && w.shifts.length);
    horarios[h.id] = { nome: h.name.trim(), entrada: dia ? dia.shifts[0][0] : '', saida: dia ? dia.shifts[dia.shifts.length - 1][1] : '' };
  });
  const pessoas = (await listar(token, 'employees')).map((p: any) => {
    const h = p.schedule ? horarios[p.schedule.id] || {} : {};
    return { codigo: p.id, nome: p.name, cargo: p.role ? p.role.name : '', empresa: p.company ? p.company.name : '', horario: h.nome || '',
      entrada: h.entrada || '', saida: h.saida || '', desligado: p.firedAt || '', local: '' } as any;
  });

  const { data: atual } = await db.from('ponto').select('dados').eq('id', 'ultimo').maybeSingle();
  const antes = atual?.dados || { batidas: [], coletores: {} };
  const coletores = { ...(antes.coletores || {}) };
  const novas: any[] = [];
  for (let data = inicio, n = 0; data <= fim; data = addDias(data, 1), n++) {
    if (n) await espera(21000); // o Ponto System aceita 3 relatórios por minuto
    const rel = await marcacoesDoDia(token, data);
    Object.assign(coletores, rel.collectors || {});
    (rel.days || []).forEach((dia: any) => dia.employees.forEach(({ employee, records }: any) => records
      .filter((x: any) => x.type !== 'D') // D = marcação desconsiderada
      .forEach((x: any) => {
        const [d, h] = x.date.split('T');
        const min = Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) + diffDias(dia.date, d) * 1440;
        novas.push({ codigo: employee.id, nome: employee.name, data: dia.date, min, tipo: x.type, local: rel.collectors ? rel.collectors[x.collectorId] || '' : '' });
      })));
  }
  // Junta com o que já estava guardado: os dias buscados agora substituem os antigos
  const corte = addDias(fim, -GUARDA_DIAS);
  const batidas = [...(antes.batidas || []).filter((b: any) => (b.data < inicio || b.data > fim) && b.data >= corte), ...novas];

  // Relógio onde cada pessoa mais bateu ponto (indica a loja)
  const conta: Record<string, Record<string, number>> = {};
  batidas.forEach(b => { if (b.local) { conta[b.codigo] = conta[b.codigo] || {}; conta[b.codigo][b.local] = (conta[b.codigo][b.local] || 0) + 1; } });
  pessoas.forEach((p: any) => { const c = conta[p.codigo] || {}; p.local = Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ''; });

  // Ficha do RH (sexo, admissão, folgas...) enviada do computador do RH
  const { data: f } = await db.from('ficha').select('dados').eq('id', 'rh').maybeSingle();
  const porNome: Record<string, any> = {};
  Object.entries(f?.dados || {}).forEach(([nome, rh]) => { if (!nome.startsWith('_')) porNome[chaveNome(nome)] = rh; });
  pessoas.forEach((p: any) => { if (porNome[chaveNome(p.nome)]) p.rh = porNome[chaveNome(p.nome)]; });
  const doPonto = new Set(pessoas.map((p: any) => chaveNome(p.nome)));
  const fichasSemPonto = Object.entries(porNome).filter(([nome]) => !doPonto.has(nome)).map(([nome, rh]) => ({ nome, ...rh }));

  const primeira = batidas.reduce((m, b) => (b.data < m ? b.data : m), inicio);
  const dados = { fonte: 'pontosystem', geradoEm: new Date().toISOString(), inicio: primeira, fim, pessoas, coletores, batidas, fichasSemPonto };
  const { error } = await db.from('ponto').upsert({ id: 'ultimo', dados, gerado_em: dados.geradoEm });
  if (error) throw error;
  return { inicio, fim, batidas: novas.length };
}

// ---------- Rotas ----------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const acao = url.searchParams.get('acao');
  try {
    if (acao === 'sincronizar' || acao === 'enviar') {
      if (req.headers.get('x-rh-servidor') !== (await segredo('servidor'))) return resposta({ erro: 'não autorizado' }, 401);
      if (acao === 'enviar') {
        const corpo = await req.json();
        if (corpo.ficha) await db.from('ficha').upsert({ id: 'rh', dados: corpo.ficha, atualizado: new Date().toISOString() });
        if (corpo.ponto) await db.from('ponto').upsert({ id: 'ultimo', dados: corpo.ponto, gerado_em: corpo.ponto.geradoEm });
        return resposta({ ok: true });
      }
      // Padrão: ontem (horário de Brasília). Roda em segundo plano para o agendador não esperar.
      const ontem = addDias(iso(new Date(Date.now() - 3 * 3600000)), -1);
      const inicio = url.searchParams.get('inicio') || ontem;
      const fim = url.searchParams.get('fim') || inicio;
      if (diffDias(inicio, fim) > 4) return resposta({ erro: 'no máximo 5 dias por vez' }, 400);
      // @ts-ignore EdgeRuntime existe no Supabase
      EdgeRuntime.waitUntil(sincronizar(inicio, fim).then(r => console.log('ponto', JSON.stringify(r))).catch(e => console.error('ponto falhou', e.message)));
      return resposta({ ok: true, inicio, fim }, 202);
    }

    const cod = await codigoOk(req);
    if (cod === 'bloqueado') return resposta({ erro: 'Muitas tentativas. Espere 15 minutos.' }, 429);
    if (cod !== 'ok') return resposta({ erro: 'Código errado' }, 401);

    // ?desde=versão / geradoEm que o computador já tem: responde só { igual: true } se nada mudou
    const desde = url.searchParams.get('desde');
    if (acao === 'dados') {
      if (desde) {
        const { data: v } = await db.from('estado').select('versao').eq('id', 'rh').maybeSingle();
        if (v && String(v.versao) === desde) return resposta({ igual: true, versao: v.versao });
      }
      const { data } = await db.from('estado').select('dados, versao').eq('id', 'rh').maybeSingle();
      return resposta(data || { dados: null, versao: 0 });
    }
    if (acao === 'salvar' && req.method === 'POST') {
      const { dados, versao } = await req.json();
      const { data: nova, error } = await db.rpc('salvar_estado', { p_dados: dados, p_versao: versao });
      if (error) throw error;
      if (nova === null) {
        const { data } = await db.from('estado').select('versao').eq('id', 'rh').maybeSingle();
        return resposta({ erro: 'conflito', versao: data?.versao }, 409);
      }
      return resposta({ versao: nova });
    }
    if (acao === 'ponto') {
      if (desde) {
        const { data: g } = await db.from('ponto').select('gerado:dados->>geradoEm').eq('id', 'ultimo').maybeSingle();
        if (g && g.gerado === desde) return resposta({ igual: true });
      }
      const { data } = await db.from('ponto').select('dados').eq('id', 'ultimo').maybeSingle();
      return resposta(data?.dados || null);
    }
    return resposta({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    console.error(e);
    return resposta({ erro: (e as Error).message }, 500);
  }
});
