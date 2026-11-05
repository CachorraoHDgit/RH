// Envia para o servidor do RH (Supabase) a ficha do RH e, se pedir, o último arquivo do ponto.
// O segredo do servidor fica em dados-ponto/segredo-nuvem.txt (só neste computador).
//
//   node ferramentas/enviar-nuvem.js            → só a ficha (dados-ponto/cadastro-rh.json)
//   node ferramentas/enviar-nuvem.js ponto      → ficha + dados-ponto/ultimo.js
//   node ferramentas/enviar-nuvem.js sincronizar 2026-11-01 2026-11-04  → servidor busca esses dias no ponto (até 5)

const fs = require('fs');
const path = require('path');

const SERVIDOR = 'https://aafoitmrsymmttsswvqu.supabase.co/functions/v1/rh';
const pasta = path.join(__dirname, '..', 'dados-ponto');
const segredo = fs.readFileSync(path.join(pasta, 'segredo-nuvem.txt'), 'utf8').trim();

async function main() {
  const [modo, inicio, fim] = process.argv.slice(2);
  if (modo === 'sincronizar') {
    const q = new URLSearchParams({ acao: 'sincronizar', ...(inicio ? { inicio } : {}), ...(fim ? { fim } : {}) });
    const r = await fetch(`${SERVIDOR}?${q}`, { method: 'POST', headers: { 'x-rh-servidor': segredo } });
    console.log(r.status, await r.text());
    return;
  }
  const corpo = { ficha: JSON.parse(fs.readFileSync(path.join(pasta, 'cadastro-rh.json'), 'utf8')) };
  if (modo === 'ponto') {
    const js = fs.readFileSync(path.join(pasta, 'ultimo.js'), 'utf8');
    corpo.ponto = JSON.parse(js.replace(/^window\.PONTO_ULTIMO = /, '').replace(/;\s*$/, ''));
  }
  const r = await fetch(`${SERVIDOR}?acao=enviar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rh-servidor': segredo }, body: JSON.stringify(corpo),
  });
  console.log(r.status, await r.text());
}

main().catch(e => { console.error(e.message); process.exit(1); });
