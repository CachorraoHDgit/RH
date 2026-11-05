// Dados num lugar só: todo computador lê e grava no servidor do RH (Supabase, função "rh").
// O localStorage continua como cópia, para abrir rápido e não perder nada sem internet.
// O ponto chega sozinho: o servidor busca as batidas toda madrugada e cada computador importa ao abrir.

const NUVEM = 'https://aafoitmrsymmttsswvqu.supabase.co/functions/v1/rh';
const Nuvem = { ativa: false, versao: 0, codigo: '', timer: null, enviando: false, pendente: false, ultimaPonto: 0 };
try { Nuvem.codigo = localStorage.getItem('rh-codigo') || ''; } catch (e) { /* sem localStorage */ }

async function pedirNuvem(acao, corpo, extra = '') {
  const r = await fetch(`${NUVEM}?acao=${acao}${extra}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'x-rh-codigo': Nuvem.codigo, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

function statusNuvem(texto, tipo = '') {
  const el = document.getElementById('nuvem-status');
  if (!el) return;
  el.textContent = texto;
  el.className = 'nuvem-status ' + tipo;
}

// Computador que já tem cadastro de verdade (não só o exemplo inicial)
function temDadosReais() {
  return !!DB.pontoImportado || DB.funcionarios.some(f => f.codigoPonto);
}

function modalAberto() {
  return !document.getElementById('modal').hidden;
}

// Troca os dados deste computador pelos do servidor
function usarDadosNuvem(j) {
  try {
    if (temDadosReais() && !localStorage.getItem('rh-copia-antes-nuvem')) localStorage.setItem('rh-copia-antes-nuvem', JSON.stringify(DB));
  } catch (e) { /* sem espaço: segue */ }
  Nuvem.base = JSON.parse(JSON.stringify(j.dados));
  DB = completar(j.dados);
  Nuvem.versao = j.versao;
  try { localStorage.setItem(CHAVE, JSON.stringify(DB)); } catch (e) { /* ignora */ }
}

// Junta duas versões que saíram da mesma base: o que cada computador mudou é mantido.
// Listas com id (funcionários, férias...) juntam item por item; objetos, campo por campo.
// Se os dois mudaram a mesma coisa, fica a deste computador.
function mesclar(base, meu, deles) {
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (igual(meu, base)) return deles;
  if (igual(deles, base) || deles === undefined) return meu;
  const objeto = v => v && typeof v === 'object' && !Array.isArray(v);
  const comId = v => Array.isArray(v) && v.every(x => objeto(x) && 'id' in x);
  if (comId(meu) && comId(deles) && (base === undefined || comId(base))) {
    const mapa = l => new Map((l || []).map(x => [x.id, x]));
    const B = mapa(base), M = mapa(meu), D = mapa(deles);
    const ids = [...new Set([...D.keys(), ...M.keys()])];
    return ids.flatMap(id => {
      const b = B.get(id), m = M.get(id), d = D.get(id);
      if (m === undefined) return b !== undefined ? [] : [d];            // apaguei aqui
      if (d === undefined) return b !== undefined && igual(m, b) ? [] : [m]; // apagaram lá
      return [mesclar(b, m, d)];
    });
  }
  if (objeto(meu) && objeto(deles)) {
    const out = {};
    new Set([...Object.keys(deles), ...Object.keys(meu)]).forEach(k => {
      const b = objeto(base) ? base[k] : undefined;
      if (!(k in meu) && b !== undefined) return;             // apaguei aqui
      if (!(k in deles) && b !== undefined && igual(meu[k], b)) return; // apagaram lá
      const v = mesclar(b, meu[k], deles[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return meu;
}

// Chamado por salvar(): manda para o servidor logo depois da última alteração
function nuvemSalvou() {
  if (!Nuvem.ativa) return;
  Nuvem.pendente = true;
  statusNuvem('Salvando…');
  clearTimeout(Nuvem.timer);
  Nuvem.timer = setTimeout(enviarNuvem, 700);
}

async function enviarNuvem() {
  if (Nuvem.enviando) return;
  Nuvem.enviando = true;
  Nuvem.pendente = false;
  Nuvem.timer = null;
  let falhou = false;
  try {
    const enviado = JSON.stringify(DB);
    const { status, j } = await pedirNuvem('salvar', { dados: JSON.parse(enviado), versao: Nuvem.versao });
    if (status === 200) {
      Nuvem.versao = j.versao;
      Nuvem.base = JSON.parse(enviado);
      if (!Nuvem.pendente) statusNuvem('Salvo para todos', 'ok');
    } else if (status === 409) {
      // Outro computador salvou antes: junta as duas alterações e manda de novo
      const r = await pedirNuvem('dados');
      if (r.status !== 200 || !r.j.dados) throw new Error('conflito');
      const deles = JSON.parse(JSON.stringify(r.j.dados));
      DB = completar(mesclar(Nuvem.base, JSON.parse(JSON.stringify(DB)), r.j.dados));
      Nuvem.base = deles;
      Nuvem.versao = r.j.versao;
      try { localStorage.setItem(CHAVE, JSON.stringify(DB)); } catch (e) { /* ignora */ }
      if (!modalAberto()) render();
      Nuvem.pendente = true;
    } else if (status === 401) {
      esquecerCodigo();
    } else {
      throw new Error(j.erro || status);
    }
  } catch (e) {
    falhou = true;
    Nuvem.pendente = true;
    statusNuvem('Sem conexão: salvo só neste computador por enquanto', 'erro');
    setTimeout(() => { if (Nuvem.pendente && !Nuvem.enviando) enviarNuvem(); }, 15000);
  } finally {
    Nuvem.enviando = false;
    // Alterou de novo enquanto enviava: manda outra vez
    if (Nuvem.pendente && !falhou && !Nuvem.timer) Nuvem.timer = setTimeout(enviarNuvem, 700);
  }
}

// Busca o que outros computadores salvaram e o ponto novo
async function atualizarDaNuvem(forcarPonto) {
  if (!Nuvem.ativa || Nuvem.enviando || Nuvem.pendente || modalAberto()) return;
  try {
    const { status, j } = await pedirNuvem('dados', null, '&desde=' + Nuvem.versao);
    if (status === 200 && !j.igual && j.dados && j.versao !== Nuvem.versao && !Nuvem.pendente && !modalAberto()) {
      usarDadosNuvem(j);
      render();
    }
    // O ponto muda uma vez por dia: confere a cada 15 minutos
    if (forcarPonto || Date.now() - Nuvem.ultimaPonto > 15 * 60000) await puxarPonto();
    statusNuvem('Salvo para todos', 'ok');
  } catch (e) {
    statusNuvem('Sem conexão com o servidor', 'erro');
  }
}

async function puxarPonto() {
  Nuvem.ultimaPonto = Date.now();
  // Na primeira vez da sessão baixa o arquivo inteiro: "Cadastrar todos" e o formulário usam ele (ultimoPonto)
  const desde = ultimoPonto ? '&desde=' + encodeURIComponent(DB.pontoImportado || '') : '';
  const { status, j } = await pedirNuvem('ponto', null, desde);
  if (status !== 200 || !j || j.igual || !j.geradoEm) return;
  if (j.geradoEm === DB.pontoImportado) { ultimoPonto = j; return; }
  importarPonto(j);
  if (aplicarAjustesPonto()) importarPonto(j);
  if (!modalAberto()) render();
}

function esquecerCodigo() {
  Nuvem.ativa = false;
  Nuvem.codigo = '';
  try { localStorage.removeItem('rh-codigo'); } catch (e) { /* ignora */ }
  pedirCodigo('Código mudou ou está errado. Digite de novo.');
}

// Primeira vez neste computador: pede o código de acesso (depois fica guardado)
function pedirCodigo(aviso = '') {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<form class="modal-caixa" novalidate>
      <div class="modal-topo"><h2>Código de acesso</h2></div>
      <div class="modal-corpo">
        <p>Digite o código do RH. Este computador vai lembrar e não pede de novo.</p>
        <label class="campo"><span>Código</span><input name="codigo" type="password" inputmode="numeric" autocomplete="off" required></label>
        <div class="erros" id="msg-codigo">${esc(aviso)}</div>
      </div>
      <div class="modal-rodape"><button type="submit" class="btn btn-principal">Entrar</button></div></form>`;
  modal.hidden = false;
  document.body.classList.add('com-modal');
  const form = modal.querySelector('form');
  form.querySelector('input').focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('button');
    botao.disabled = true;
    Nuvem.codigo = form.codigo.value.trim();
    const msg = await entrarNaNuvem();
    botao.disabled = false;
    if (msg) { form.querySelector('#msg-codigo').textContent = msg; return; }
    try { localStorage.setItem('rh-codigo', Nuvem.codigo); } catch (e2) { /* ignora */ }
    fecharModal();
    render();
  });
}

// Liga o computador ao servidor. Devolve uma mensagem de erro do código, ou '' se entrou.
async function entrarNaNuvem() {
  statusNuvem('Conectando…');
  let r;
  try { r = await pedirNuvem('dados'); } catch (e) {
    statusNuvem('Sem conexão: usando os dados deste computador', 'erro');
    return Nuvem.codigo && localStorage.getItem('rh-codigo') ? '' : 'Sem conexão com o servidor. Tente de novo.';
  }
  if (r.status === 401) return 'Código errado.';
  if (r.status === 429) return r.j.erro;
  if (r.status !== 200) { statusNuvem('Servidor com problema: usando os dados deste computador', 'erro'); return ''; }

  if (r.j.dados) {
    Nuvem.ativa = true;
    usarDadosNuvem(r.j);
  } else if (temDadosReais() && confirm(`O servidor ainda está vazio. Este computador tem ${DB.funcionarios.length} funcionários cadastrados.\n\n`
    + 'Mandar o cadastro DESTE computador para todos? (OK só se for o computador onde você configurou tudo)')) {
    // Servidor vazio: este computador já tem o cadastro e manda para todos
    Nuvem.ativa = true;
    Nuvem.versao = 0;
    await enviarNuvem();
  } else {
    // Servidor vazio e este computador também: espera o computador do cadastro mandar primeiro
    statusNuvem('Aguardando: abra o site primeiro no computador onde o cadastro já está feito', 'aviso');
    setTimeout(async () => { await entrarNaNuvem(); render(); }, 60000);
    return '';
  }
  try { await puxarPonto(); } catch (e) { /* tenta de novo depois */ }
  if (!Nuvem.pendente && Nuvem.versao) statusNuvem('Salvo para todos', 'ok');
  if (!Nuvem.intervalo) {
    Nuvem.intervalo = setInterval(() => atualizarDaNuvem(false), 60000);
    window.addEventListener('focus', () => atualizarDaNuvem(false));
  }
  return '';
}

async function iniciarNuvem() {
  if (!Nuvem.codigo) { pedirCodigo(); return; }
  await entrarNaNuvem();
  render();
}
