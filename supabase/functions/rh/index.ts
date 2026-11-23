// Servidor do RH: guarda os dados do site num lugar só (todo computador vê o mesmo)
// e busca as batidas do Ponto System toda madrugada.
//
// Rotas (?acao=...):
//   dados       GET   estado salvo + versão (?desde=versão)         (código de acesso)
//   salvar      POST  { dados, versao } → nova versão ou 409       (código de acesso)
//   ponto       GET   último arquivo do ponto (?desde=geradoEm)     (código de acesso)
//   atualizar-ponto POST  busca o Ponto System agora (botão do site) (código de acesso)
//   sincronizar POST  busca o ponto de ontem (ou ?inicio=&fim=)    (segredo do servidor)
//   enviar      POST  { ponto?, ficha? } vindos do computador do RH (segredo do servidor)
//   relatorio   POST  hora extra e atrasos da semana passada no WhatsApp (?inicio=, ?previa=1) (segredo do servidor)
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

// ---------- Relatório semanal no WhatsApp ----------
// Mesmas regras do ponto no site (js/ponto.js): atraso = chegada depois da tolerância verde;
// hora extra = chegou antes da tolerância "chegadaCedo" + o que passou da meia-noite / do horário de saída.
// O intervalo pré-assinalado (marcação "P") não é batida; dia sem entrada não conta como atraso.

const LOJAS = ['Jardim Atlântico', 'Campeche', 'Itacorubi', 'Palhoça', 'Biguaçu', 'Produção', 'Administrativo'];
const MEIA_NOITE = 1440;
const minutos = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const horas = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return !h ? `${m}min` : m ? `${h}h${pad(m)}` : `${h}h`; };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const brCurta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const ordem = (l: number[]) => [...new Set(l)].sort((x, y) => x - y);

function ativoEm(f: any, data: string) {
  if (f.inicio && data < f.inicio) return false;
  if (f.situacao === 'Aviso prévio' && f.avisoFim && data > f.avisoFim) return false;
  if (f.situacao === 'Desligado' && (!f.saida || data > f.saida)) return false;
  return true;
}

function resultadoDia(f: any, b: number[], pre: number[], cfg: any) {
  const entrada = minutos(f.entrada), saida = minutos(f.horaSaida);
  const virada = saida !== null && entrada !== null && saida < entrada;
  const fimDoDia = virada ? saida! + MEIA_NOITE : saida;
  const impar = b.length % 2 === 1;
  const semEntrada = impar && (pre.length ? b[0] > pre[0]
    : b.length === 1 && entrada !== null && fimDoDia !== null && Math.abs(b[0] - fimDoDia) < Math.abs(b[0] - entrada));
  let marcas = ordem([...b, ...pre]);
  if (semEntrada) {
    const volta = pre.filter(m => m <= b[0]).pop();
    marcas = volta === undefined ? b.slice(1) : marcas.filter(m => m >= volta);
  } else if (marcas.length % 2 !== b.length % 2) marcas = b;
  const atraso = entrada === null || semEntrada ? null : Math.max(0, b[0] - entrada);
  const limite = virada ? saida! + MEIA_NOITE : MEIA_NOITE;
  let extraDepois = 0;
  for (let i = 0; i + 1 < marcas.length; i += 2) extraDepois += Math.max(0, marcas[i + 1] - Math.max(marcas[i], limite));
  const cedo = entrada === null || semEntrada ? 0 : Math.max(0, entrada - b[0]);
  return { atraso, extra: (cedo > cfg.chegadaCedo ? cedo : 0) + extraDepois };
}

// Texto do relatório de uma semana (inicio = segunda)
async function montarRelatorio(inicio: string) {
  const fim = addDias(inicio, 6);
  const [{ data: e }, { data: p }] = await Promise.all([
    db.from('estado').select('dados').eq('id', 'rh').maybeSingle(),
    db.from('ponto').select('dados').eq('id', 'ultimo').maybeSingle(),
  ]);
  const estado = e?.dados || {}, ponto = p?.dados || {};
  const cfg = { verde: 5, amarelo: 15, chegadaCedo: 10, ...(estado.pontoConfig || {}) };
  const funcs: any[] = estado.funcionarios || [];
  const porCodigo = new Map(funcs.filter(f => f.codigoPonto).map(f => [f.codigoPonto, f]));
  const porNome = new Map(funcs.map(f => [chaveNome(f.nome), f]));

  // Batidas da semana por funcionário e dia, separando o intervalo pré-assinalado
  const dias: Record<string, Record<string, { b: number[]; pre: number[] }>> = {};
  (ponto.batidas || []).forEach((x: any) => {
    if (x.data < inicio || x.data > fim) return;
    const f = porCodigo.get(x.codigo) || porNome.get(chaveNome(x.nome || ''));
    if (!f || !ativoEm(f, x.data)) return;
    const d = ((dias[f.id] = dias[f.id] || {})[x.data] = dias[f.id][x.data] || { b: [], pre: [] });
    d[x.tipo === 'P' ? 'pre' : 'b'].push(x.min);
  });

  const linhas = [`*Relatório de ponto · ${brCurta(inicio)} a ${brCurta(fim)}*`];
  LOJAS.forEach(loja => {
    const gente = funcs.filter(f => f.loja === loja && dias[f.id]).map(f => {
      let extra = 0; const atrasos: number[] = [];
      Object.entries(dias[f.id]).forEach(([data, { b, pre }]) => {
        if (!b.length) return;
        const r = resultadoDia(f, ordem(b), ordem(pre), cfg);
        extra += r.extra;
        // Veio cobrir na folga (fixa ou de domingo): não é atraso
        const dow = new Date(data + 'T12:00Z').getUTCDay();
        const naFolga = (f.folgas || []).includes(SEMANA[dow])
          || (dow === 0 && (((estado.domingos || {})[f.loja] || {})[data] || []).includes(f.id));
        if (!naFolga && r.atraso !== null && r.atraso > cfg.verde) atrasos.push(r.atraso);
      });
      return { nome: f.nome, extra, atrasos };
    });
    if (!gente.length) return;
    const top = gente.filter(g => g.extra > 0).sort((a, b) => b.extra - a.extra).slice(0, 3);
    const atrasados = gente.filter(g => g.atrasos.length > 1)
      .sort((a, b) => b.atrasos.length - a.atrasos.length || b.atrasos.reduce((s, x) => s + x, 0) - a.atrasos.reduce((s, x) => s + x, 0));
    linhas.push('', `🏪 *${loja}*`, '_Mais hora extra_');
    linhas.push(...(top.length ? top.map((g, i) => `${i + 1}. ${g.nome} — ${horas(g.extra)}`) : ['ninguém fez hora extra']));
    linhas.push('_Atrasou mais de uma vez_');
    linhas.push(...(atrasados.length
      ? atrasados.map(g => `• ${g.nome} — ${g.atrasos.length}x (total ${horas(g.atrasos.reduce((s, x) => s + x, 0))})`)
      : ['ninguém']));
  });
  if (linhas.length === 1) linhas.push('', 'Sem batidas nesta semana.');
  return linhas.join('\n');
}

// Envia pela uazapi (servidor, token da instância e número ficam na tabela "segredos")
async function enviarWhatsapp(texto: string) {
  const [servidor, token, numero] = await Promise.all([segredo('uazapi_url'), segredo('uazapi_token'), segredo('whatsapp_numero')]);
  if (!servidor || !token || !numero) throw new Error('Falta cadastrar uazapi_url, uazapi_token ou whatsapp_numero');
  const r = await fetch(`${servidor.replace(/\/+$/, '')}/send/text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', token }, body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!r.ok) throw new Error(`uazapi ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---------- Rotas ----------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const acao = url.searchParams.get('acao');
  try {
    if (acao === 'sincronizar' || acao === 'enviar' || acao === 'relatorio') {
      if (req.headers.get('x-rh-servidor') !== (await segredo('servidor'))) return resposta({ erro: 'não autorizado' }, 401);
      // Relatório da semana passada (ou ?inicio=segunda) no WhatsApp; ?previa=1 só devolve o texto
      if (acao === 'relatorio') {
        const hoje = iso(new Date(Date.now() - 3 * 3600000));
        const dow = new Date(hoje + 'T12:00Z').getUTCDay();
        const inicio = url.searchParams.get('inicio') || addDias(hoje, -((dow + 6) % 7) - 7);
        const texto = await montarRelatorio(inicio);
        if (url.searchParams.get('previa') !== '1') await enviarWhatsapp(texto);
        return resposta({ ok: true, texto });
      }
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
    // Botão "Importar do ponto" do site: busca a lista nova do Ponto System agora (no máximo a cada 3 minutos)
    if (acao === 'atualizar-ponto' && req.method === 'POST') {
      const { data: g } = await db.from('ponto').select('gerado_em').eq('id', 'ultimo').maybeSingle();
      if (g && Date.now() - Date.parse(g.gerado_em) < 3 * 60000) return resposta({ ok: true, recente: true });
      const ontem = addDias(iso(new Date(Date.now() - 3 * 3600000)), -1);
      // @ts-ignore EdgeRuntime existe no Supabase
      EdgeRuntime.waitUntil(sincronizar(ontem, ontem).catch(e => console.error('ponto falhou', e.message)));
      return resposta({ ok: true }, 202);
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
