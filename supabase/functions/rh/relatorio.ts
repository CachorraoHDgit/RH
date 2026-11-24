// Relatório semanal de RH (ponto): os 3 com mais hora extra e quem atrasou 2 vezes ou mais, por loja.
// Gera um PDF no modelo dos relatórios do Grupo CHD (faixa vermelha, cartões, tabelas azuis)
// e manda como documento no WhatsApp pela uazapi.
//
// Mesmas regras do ponto no site (js/ponto.js): atraso = chegada depois da tolerância verde;
// hora extra = chegou antes da tolerância "chegadaCedo" + o que passou da meia-noite / do horário de saída.
// O intervalo pré-assinalado (marcação "P") não é batida; dia sem entrada e dia de folga não contam como atraso.

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const LOJAS = ['Jardim Atlântico', 'Campeche', 'Itacorubi', 'Palhoça', 'Biguaçu', 'Produção', 'Administrativo'];
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const SEMANA_LONGA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MEIA_NOITE = 1440;
const LOGO = 'https://rh-grupo-chd.vercel.app/img/logo.png';
const FONTE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDias = (s: string, n: number) => { const [a, m, d] = s.split('-').map(Number); return iso(new Date(Date.UTC(a, m - 1, d + n))); };
const chaveNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const minutos = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const horas = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return !h ? `${m}min` : m ? `${h}h${pad(m)}` : `${h}h`; };
const brCurta = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const br = (s: string) => `${brCurta(s)}/${s.slice(0, 4)}`;
const ordem = (l: number[]) => [...new Set(l)].sort((x, y) => x - y);
const soma = (l: number[]) => l.reduce((s, x) => s + x, 0);
const nomeCurto = (nome: string) => {
  const partes = nome.trim().split(/\s+/);
  const seg = partes.slice(1).find(p => !['da', 'de', 'do', 'das', 'dos', 'e'].includes(p.toLowerCase()));
  return seg ? `${partes[0]} ${seg}` : partes[0];
};

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
  return { atraso, semEntrada, extra: (cedo > cfg.chegadaCedo ? cedo : 0) + extraDepois };
}

type Pessoa = { nome: string; loja: string; extra: number; atrasos: number[]; semEntrada: number };
type Semana = { inicio: string; fim: string; lojas: { loja: string; top: Pessoa[]; atrasados: Pessoa[]; gente: Pessoa[] }[] };

// Números da semana (inicio = segunda)
async function calcularSemana(db: any, inicio: string): Promise<Semana> {
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

  const lojas = LOJAS.map(loja => {
    const gente: Pessoa[] = funcs.filter(f => f.loja === loja && dias[f.id]).map(f => {
      const r: Pessoa = { nome: f.nome, loja, extra: 0, atrasos: [], semEntrada: 0 };
      Object.entries(dias[f.id]).forEach(([data, { b, pre }]) => {
        if (!b.length) return;
        const d = resultadoDia(f, ordem(b), ordem(pre), cfg);
        r.extra += d.extra;
        if (d.semEntrada) r.semEntrada++;
        // Veio cobrir na folga (fixa ou de domingo): não é atraso
        const dow = new Date(data + 'T12:00Z').getUTCDay();
        const naFolga = (f.folgas || []).includes(SEMANA[dow])
          || (dow === 0 && (((estado.domingos || {})[f.loja] || {})[data] || []).includes(f.id));
        if (!naFolga && d.atraso !== null && d.atraso > cfg.verde) r.atrasos.push(d.atraso);
      });
      return r;
    });
    const top = gente.filter(g => g.extra > 0).sort((a, b) => b.extra - a.extra).slice(0, 3);
    const atrasados = gente.filter(g => g.atrasos.length > 1)
      .sort((a, b) => b.atrasos.length - a.atrasos.length || soma(b.atrasos) - soma(a.atrasos));
    return { loja, top, atrasados, gente };
  }).filter(l => l.gente.length);
  return { inicio, fim, lojas };
}

// ---------- PDF ----------

const COR = {
  vermelho: rgb(0.894, 0.118, 0.188), amarelo: rgb(0.965, 0.663, 0.129), azul: rgb(0.122, 0.227, 0.478),
  creme: rgb(1, 0.973, 0.941), branco: rgb(1, 1, 1), texto: rgb(0.17, 0.17, 0.2), cinza: rgb(0.45, 0.45, 0.5),
  linha: rgb(0.918, 0.875, 0.827), faixa: rgb(0.996, 0.925, 0.835), verde: rgb(0.2, 0.62, 0.36),
};
const A4 = { w: 595.28, h: 841.89 };
const M = 32; // margem lateral

async function pdfRelatorio(s: Semana) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [reg, med, neg, logo] = await Promise.all(['Regular', 'Medium', 'Bold', LOGO].map(n =>
    fetch(n.startsWith('http') ? n : `${FONTE}${n}.ttf`).then(r => { if (!r.ok) throw new Error(`${n}: ${r.status}`); return r.arrayBuffer(); })));
  const F = { reg: await doc.embedFont(reg), med: await doc.embedFont(med), neg: await doc.embedFont(neg) };
  const imgLogo = await doc.embedPng(logo);
  doc.setTitle(`Relatório Semanal RH ${brCurta(s.inicio)} a ${brCurta(s.fim)}`);
  doc.setAuthor('Grupo CHD · Cachorrão Hotdog');

  const paginas: PDFPage[] = [];
  let pg!: PDFPage, y = 0;
  const texto = (t: string, x: number, yy: number, tam: number, fonte: PDFFont, cor = COR.texto) =>
    pg.drawText(t, { x, y: yy, size: tam, font: fonte, color: cor });
  const largura = (t: string, tam: number, fonte: PDFFont) => fonte.widthOfTextAtSize(t, tam);
  // Corta o texto com "…" para caber na largura
  const caber = (t: string, w: number, tam: number, fonte: PDFFont) => {
    if (largura(t, tam, fonte) <= w) return t;
    while (t.length > 1 && largura(t + '…', tam, fonte) > w) t = t.slice(0, -1);
    return t + '…';
  };

  const novaPagina = () => {
    pg = doc.addPage([A4.w, A4.h]);
    paginas.push(pg);
    pg.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: COR.creme });
    // Faixa vermelha + linha amarela
    pg.drawRectangle({ x: 0, y: A4.h - 82, width: A4.w, height: 82, color: COR.vermelho });
    pg.drawRectangle({ x: 0, y: A4.h - 88, width: A4.w, height: 6, color: COR.amarelo });
    // Logo num selo branco
    pg.drawCircle({ x: M + 33, y: A4.h - 41, size: 33, color: COR.branco });
    pg.drawImage(imgLogo, { x: M + 6, y: A4.h - 68, width: 54, height: 54 });
    texto('CACHORRÃO', M + 76, A4.h - 40, 15, F.neg, COR.branco);
    texto('hotdog · Grupo CHD', M + 77, A4.h - 55, 9, F.med, COR.branco);
    // Título à direita
    const dir = (t: string, yy: number, tam: number, fonte: PDFFont, cor = COR.branco) => texto(t, A4.w - M - largura(t, tam, fonte), yy, tam, fonte, cor);
    dir('R E L A T Ó R I O   S E M A N A L  ·  R H', A4.h - 26, 7, F.med);
    dir('Ponto da semana', A4.h - 52, 22, F.neg);
    dir(`${br(s.inicio)} a ${br(s.fim)}`, A4.h - 70, 11, F.neg, COR.amarelo);
    y = A4.h - 116;
  };
  const rodapes = () => paginas.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: 0, width: A4.w, height: 28, color: COR.azul });
    p.drawText('Grupo CHD · Cachorrão Hotdog', { x: M, y: 10, size: 7.5, font: F.med, color: COR.branco });
    const t = `Fontes: Ponto System, site do RH — página ${i + 1}`;
    p.drawText(t, { x: A4.w - M - largura(t, 7.5, F.med), y: 10, size: 7.5, font: F.med, color: COR.branco });
  });
  // Garante espaço; senão abre página nova
  const espaco = (h: number) => { if (y - h < 44) novaPagina(); };
  const secao = (t: string, sub = '') => {
    espaco(60);
    pg.drawRectangle({ x: M, y: y - 2, width: 3.5, height: 14, color: COR.vermelho });
    texto(t, M + 11, y, 12.5, F.neg, COR.azul);
    if (sub) texto(sub, M + 15 + largura(t, 12.5, F.neg), y + 1, 8, F.reg, COR.cinza);
    y -= 20;
  };

  // Tabela: colunas { titulo, w (fração), alinhar? }, linhas de células; grupo = linhas que começam loja nova
  const tabela = (cols: { t: string; w: number; dir?: boolean }[], linhas: { c: string[]; negrito?: boolean; novaLoja?: boolean }[]) => {
    const W = A4.w - 2 * M, H = 19, xs: number[] = [];
    let x = M; cols.forEach(c => { xs.push(x); x += c.w * W; });
    const cabecalho = () => {
      pg.drawRectangle({ x: M, y: y - H + 5, width: W, height: H, color: COR.azul });
      cols.forEach((c, i) => {
        const cw = c.w * W - 16;
        const tx = c.dir ? xs[i] + 8 + cw - largura(c.t, 8, F.neg) : xs[i] + 8;
        texto(c.t, tx, y - 8, 8, F.neg, COR.branco);
      });
      y -= H;
    };
    espaco(H * 2 + 6); cabecalho();
    linhas.forEach((l, n) => {
      if (y - H < 44) { novaPagina(); cabecalho(); }
      if (l.novaLoja && n) pg.drawLine({ start: { x: M, y: y + 5 }, end: { x: M + W, y: y + 5 }, thickness: 0.9, color: COR.linha });
      cols.forEach((c, i) => {
        const fonte = i === 0 || l.negrito ? F.neg : F.reg;
        const t = caber(l.c[i] || '', c.w * W - 16, 8.5, fonte);
        const tx = c.dir ? xs[i] + c.w * W - 8 - largura(t, 8.5, fonte) : xs[i] + 8;
        texto(t, tx, y - 8, 8.5, fonte, i === 0 ? COR.azul : COR.texto);
      });
      pg.drawLine({ start: { x: M, y: y - H + 5 }, end: { x: M + W, y: y - H + 5 }, thickness: 0.5, color: COR.linha });
      y -= H;
    });
    y -= 10;
  };
  const nota = (t: string) => { espaco(14); texto(t, M, y, 7.5, F.reg, COR.cinza); y -= 18; };

  novaPagina();
  const todos = s.lojas.flatMap(l => l.gente);

  // Resumo da semana
  secao('Resumo da semana', `${SEMANA_LONGA[1]} ${brCurta(s.inicio)} a ${SEMANA_LONGA[0].toLowerCase()} ${brCurta(s.fim)}`);
  const cards = [
    ['HORA EXTRA DA REDE', horas(soma(todos.map(g => g.extra))), `${todos.filter(g => g.extra > 0).length} pessoas fizeram`],
    ['ATRASOS NA SEMANA', String(soma(todos.map(g => g.atrasos.length))), `${todos.filter(g => g.atrasos.length).length} pessoas atrasaram`],
    ['ATRASOU 2+ VEZES', String(todos.filter(g => g.atrasos.length > 1).length), 'pessoas na lista abaixo'],
    ['SEM BATER ENTRADA', String(soma(todos.map(g => g.semEntrada))), 'dias (não conta atraso)'],
    ['COM PONTO', String(todos.length), `funcionários · ${s.lojas.length} lojas`],
  ];
  const gap = 8, cw = (A4.w - 2 * M - gap * 4) / 5, ch = 66;
  cards.forEach(([rot, val, sub], i) => {
    const x = M + i * (cw + gap);
    pg.drawRectangle({ x, y: y - ch + 8, width: cw, height: ch, color: COR.branco, borderColor: COR.linha, borderWidth: 0.6 });
    pg.drawRectangle({ x, y: y + 6, width: cw, height: 2.5, color: COR.vermelho });
    texto(rot, x + 9, y - 8, 6.5, F.med, COR.cinza);
    texto(val, x + 9, y - 31, 18, F.neg, COR.azul);
    texto(caber(sub, cw - 16, 6.8, F.reg), x + 9, y - 46, 6.8, F.reg, COR.cinza);
  });
  y -= ch + 14;

  // Alertas: quem atrasou muito e quem deixou de bater a entrada várias vezes
  const alertas: { t: string; d: string; cor: any }[] = [];
  todos.filter(g => g.atrasos.length >= 4).sort((a, b) => b.atrasos.length - a.atrasos.length).forEach(g =>
    alertas.push({ t: `${nomeCurto(g.nome)} (${g.loja}) atrasou ${g.atrasos.length} vezes.`, d: `Somando ${horas(soma(g.atrasos))} de atraso; o maior foi de ${horas(Math.max(...g.atrasos))}.`, cor: COR.vermelho }));
  todos.filter(g => g.semEntrada >= 3).sort((a, b) => b.semEntrada - a.semEntrada).forEach(g =>
    alertas.push({ t: `${nomeCurto(g.nome)} (${g.loja}) ficou sem bater a entrada em ${g.semEntrada} dias.`, d: 'Conferir no Ponto System e lançar a entrada; esses dias não aparecem como atraso.', cor: COR.amarelo }));
  if (alertas.length) {
    secao('Alertas da semana');
    alertas.forEach(a => {
      espaco(34);
      const W = A4.w - 2 * M, h = 30;
      pg.drawRectangle({ x: M, y: y - h + 10, width: W, height: h, color: COR.branco, borderColor: COR.linha, borderWidth: 0.6 });
      pg.drawRectangle({ x: M, y: y - h + 10, width: 3.5, height: h, color: a.cor });
      texto(a.t, M + 12, y - 4, 8.5, F.neg);
      texto(caber(a.d, W - 24, 8, F.reg), M + 12, y - 15, 8, F.reg, COR.texto);
      y -= h + 6;
    });
    y -= 6;
  }

  // Hora extra: os 3 primeiros de cada loja
  secao('Mais hora extra por loja', 'os 3 primeiros');
  const linhasExtra = s.lojas.flatMap(l => (l.top.length ? l.top : [null]).map((g, i) => ({
    novaLoja: i === 0,
    c: [i === 0 ? l.loja : '', g ? `${i + 1}º` : '', g ? g.nome : 'Ninguém fez hora extra', g ? horas(g.extra) : '—'],
  })));
  tabela([{ t: 'Loja', w: 0.24 }, { t: '', w: 0.07 }, { t: 'Funcionário', w: 0.49 }, { t: 'Hora extra', w: 0.2, dir: true }], linhasExtra);
  nota('Hora extra = chegou mais de 10 min antes do horário + o que passou do horário de saída (ou da meia-noite).');

  // Atrasos: quem atrasou 2 vezes ou mais
  secao('Atrasou mais de uma vez', 'quem atrasou só 1 vez fica de fora');
  const linhasAtraso = s.lojas.flatMap(l => (l.atrasados.length ? l.atrasados : [null]).map((g, i) => ({
    novaLoja: i === 0,
    c: [i === 0 ? l.loja : '', g ? g.nome : 'Ninguém', g ? `${g.atrasos.length}x` : '—',
      g ? horas(soma(g.atrasos)) : '—', g ? horas(Math.max(...g.atrasos)) : '—'],
  })));
  tabela([{ t: 'Loja', w: 0.22 }, { t: 'Funcionário', w: 0.42 }, { t: 'Vezes', w: 0.1, dir: true },
    { t: 'Atraso total', w: 0.13, dir: true }, { t: 'Maior atraso', w: 0.13, dir: true }], linhasAtraso);
  nota('Atraso = chegou mais de 5 min depois do horário. Dia de folga e dia sem entrada batida não contam.');

  rodapes();
  return await doc.save();
}

// ---------- Envio ----------

// Texto curto que vai junto do PDF
function legenda(s: Semana) {
  const todos = s.lojas.flatMap(l => l.gente);
  return `*Relatório semanal de RH · ${brCurta(s.inicio)} a ${brCurta(s.fim)}*\n` +
    `Hora extra da rede: ${horas(soma(todos.map(g => g.extra)))} · ${todos.filter(g => g.atrasos.length > 1).length} pessoas atrasaram 2+ vezes.`;
}

// Gera o PDF, guarda no Storage (pasta "relatorios") e manda o link como documento pela uazapi.
// previa = só gera e devolve o link, sem mandar no WhatsApp.
export async function relatorioSemanal(db: any, segredo: (n: string) => Promise<string | undefined>, inicio: string, previa: boolean) {
  const s = await calcularSemana(db, inicio);
  const pdf = await pdfRelatorio(s);
  const nome = `Relatorio_RH_${brCurta(s.inicio).replace('/', '-')}_a_${brCurta(s.fim).replace('/', '-')}_${s.fim.slice(0, 4)}.pdf`;
  const caminho = `rh/${s.inicio}${previa ? '-previa' : ''}.pdf`;
  const up = await db.storage.from('relatorios').upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const { data: link, error } = await db.storage.from('relatorios').createSignedUrl(caminho, 7 * 86400);
  if (error) throw error;
  if (!previa) {
    const [servidor, token, numero] = await Promise.all([segredo('uazapi_url'), segredo('uazapi_token'), segredo('whatsapp_numero')]);
    if (!servidor || !token || !numero) throw new Error('Falta cadastrar uazapi_url, uazapi_token ou whatsapp_numero');
    const r = await fetch(`${servidor.replace(/\/+$/, '')}/send/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: numero, type: 'document', file: link.signedUrl, docName: nome, text: legenda(s) }),
    });
    if (!r.ok) throw new Error(`uazapi ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return { ok: true, arquivo: nome, link: link.signedUrl };
}
