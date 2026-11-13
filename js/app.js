// Interface do site de RH

const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TELAS = [
  { id: 'funcionarios', nome: 'Funcionários', icone: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>') },
  { id: 'folgas', nome: 'Folgas semanais', icone: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 14l4 4M14 14l-4 4"/>') },
  { id: 'escala', nome: 'Escala de trabalho', icone: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>') },
  { id: 'ferias', nome: 'Férias', icone: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>') },
  { id: 'ponto', nome: 'Ponto', icone: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>') },
  { id: 'ajustes', nome: 'Ajustes', icone: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>') },
];

const UI = Object.assign({
  tela: 'funcionarios',
  loja: LOJAS[0],
  mes: hoje().slice(0, 7),
  dia: hoje(),
  filtroLoja: '',
  filtroSituacao: 'atuais',
  busca: '',
  escalaModo: 'mes',
  pontoModo: '7dias',
  pontoDe: addDias(hoje(), -7),
  pontoAte: addDias(hoje(), -1),
}, lerUi());

function lerUi() {
  try { return JSON.parse(localStorage.getItem('rh-ui')) || {}; } catch (e) { return {}; }
}
function salvarUi() {
  try { localStorage.setItem('rh-ui', JSON.stringify(UI)); } catch (e) { /* ignora */ }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const opcoes = (lista, sel, vazio) =>
  (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '') +
  lista.map(o => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`;
  }).join('');

const etiqueta = (texto, tipo) => `<span class="tag tag-${tipo}">${esc(texto)}</span>`;

// ---------- Estrutura ----------

function render() {
  if (!(UI.tela === 'ponto' ? LOJAS : LOJAS_ESCALA).includes(UI.loja)) UI.loja = LOJAS[0];
  salvarUi();
  document.getElementById('abas').innerHTML = TELAS
    .map(t => `<button class="item-menu${t.id === UI.tela ? ' ativo' : ''}" data-acao="tela" data-id="${t.id}">${t.icone}<span>${t.nome}</span></button>`)
    .join('');
  renderLembrete();
  const telas = { funcionarios: telaFuncionarios, folgas: telaFolgas, escala: telaEscala, ferias: telaFerias, ponto: telaPonto, ajustes: telaAjustes };
  const tela = document.getElementById('tela');
  tela.className = 'tela-' + UI.tela; // a impressão do Ponto sai deitada
  tela.innerHTML = telas[UI.tela]();
  // Rodapé azul do modelo de PDF (o quadro de folgas já traz o dele)
  if (UI.tela === 'escala' || UI.tela === 'ponto') {
    const mes = UI.tela === 'ponto' ? diasDoPonto()[0].slice(0, 7) : UI.mes;
    tela.insertAdjacentHTML('beforeend', pdfRodape(UI.escalaModo === 'dia' && UI.tela === 'escala' ? (UI.imprimeLoja || '') : UI.loja, mes));
  }
}

// Rotina do dia 30: lembrete para atualizar o cadastro antes de fechar o mês seguinte
function renderLembrete() {
  const hj = hoje();
  const mes = hj.slice(0, 7);
  const dias = diasDoMes(mes);
  const ultimoDia = hj === dias[dias.length - 1];
  const mostrar = (Number(hj.slice(8)) >= 30 || ultimoDia) && !DB.lembretesVistos[mes];
  document.getElementById('lembrete').innerHTML = mostrar ? `
    <div class="lembrete">
      <strong>Rotina do dia 30</strong>
      <span>Atualize entradas, saídas, férias e trocas antes de fechar ${esc(nomeMes(addMeses(mes, 1)))}.</span>
      <button class="btn btn-claro" data-acao="lembrete-ok">Feito</button>
    </div>` : '';
}

function seletorLoja(valor, acao, todas, lista = LOJAS_ESCALA) {
  return `<label class="campo"><span>Loja</span>
    <select data-muda="${acao}">${opcoes(lista, valor, todas ? 'Todas as lojas' : undefined)}</select></label>`;
}

function seletorMes() {
  return `<label class="campo"><span>Mês</span>
    <div class="mes-nav">
      <button class="btn btn-icone" data-acao="mes" data-n="-1" aria-label="Mês anterior">‹</button>
      <input type="month" value="${UI.mes}" data-muda="mes">
      <button class="btn btn-icone" data-acao="mes" data-n="1" aria-label="Próximo mês">›</button>
    </div></label>`;
}

// ---------- 1. Funcionários ----------

function situacaoAtual(f) {
  if (f.situacao === 'Afastado' && !afastadoEm(f, hoje())) return 'Ativo';
  if (f.situacao === 'Aviso prévio' && f.avisoFim && f.avisoFim < hoje()) return 'Desligado';
  if (f.situacao === 'Ativo' && feriasEm(f.id, hoje())) return 'Férias';
  return f.situacao;
}

function telaFuncionarios() {
  const busca = UI.busca.toLowerCase();
  const lista = DB.funcionarios
    .filter(f => !UI.filtroLoja || f.loja === UI.filtroLoja)
    .filter(f => {
      const s = situacaoAtual(f);
      if (UI.filtroSituacao === 'atuais') return s !== 'Desligado';
      return !UI.filtroSituacao || s === UI.filtroSituacao;
    })
    .filter(f => !busca || f.nome.toLowerCase().includes(busca))
    .sort((a, b) => LOJAS.indexOf(a.loja) - LOJAS.indexOf(b.loja) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const linhas = lista.map(f => {
    const s = situacaoAtual(f);
    const tipoSit = { Ativo: 'ok', Férias: 'aviso', Afastado: 'cinza', 'Aviso prévio': 'aviso', Desligado: 'erro' }[s];
    return `<tr>
      <td data-label="Nome"><strong>${esc(f.nome)}</strong>${f.obs ? `<br><small>${esc(f.obs)}</small>` : ''}</td>
      <td data-label="Loja">${esc(f.loja)}</td>
      <td data-label="Cargo">${esc(f.cargo) || etiqueta('Definir', 'cinza')}</td>
      <td data-label="Funções">${f.funcoes.length ? f.funcoes.map(esc).join(', ') : '—'}</td>
      <td data-label="Sexo">${f.sexo}${f.sexo === 'H' && f.alternaDomingos ? ' <small>(alterna)</small>' : ''}</td>
      <td data-label="Turno">${esc(f.turno) || '—'}${f.entrada ? `<br><small>${f.entrada}${f.horaSaida ? ' às ' + f.horaSaida : ''}</small>` : ''}</td>
      <td data-label="Folga fixa">${f.folgas.length ? f.folgas.map(d => FOLGAS[d]).join(', ') : etiqueta('Definir', 'erro')}</td>
      <td data-label="Início">${br(f.inicio) || '—'}</td>
      <td data-label="Situação">${etiqueta(s, tipoSit)}${f.situacao === 'Desligado' && f.saida ? `<small> em ${br(f.saida)}</small>` : ''}${s === 'Afastado' ? `<br><small>${esc(textoAfastamento(f))}</small>` : ''}${s === 'Aviso prévio' ? `<br><small>${[f.avisoInicio && 'desde ' + br(f.avisoInicio), f.avisoFim && 'último dia ' + br(f.avisoFim)].filter(Boolean).join(' · ')}</small>` : ''}</td>
      <td class="acoes">
        <button class="btn btn-claro" data-acao="editar-func" data-id="${f.id}">Editar</button>
        ${f.situacao !== 'Desligado' ? `<button class="btn btn-perigo" data-acao="desligar" data-id="${f.id}">Desligar</button>` : ''}
      </td></tr>`;
  }).join('');

  const contagem = LOJAS.map(l => {
    const n = DB.funcionarios.filter(f => f.loja === l && f.situacao !== 'Desligado').length;
    return `<button class="contador${UI.filtroLoja === l ? ' ativo' : ''}" data-acao="filtro-loja" data-id="${esc(l)}"><strong>${n}</strong><span>${esc(l)}</span></button>`;
  }).join('');

  return `
    <section class="cabeca">
      <div><h1>Funcionários</h1><p>Cadastro de todos os colaboradores, por loja</p></div>
      <div class="botoes">
        <button class="btn btn-claro" data-acao="atualizar-ponto" title="Busca no Ponto System os funcionários novos e as batidas">Importar do ponto</button>
        <button class="btn btn-principal" data-acao="novo-func">+ Adicionar funcionário</button>
      </div>
    </section>
    ${avisoPonto()}
    <div class="contadores">${contagem}</div>
    <div class="filtros">
      ${seletorLoja(UI.filtroLoja, 'filtro-loja', true, LOJAS)}
      <label class="campo"><span>Situação</span><select data-muda="filtro-situacao">
        ${opcoes([['atuais', 'Todos menos desligados'], ['', 'Todos (com histórico)'], ...SITUACOES], UI.filtroSituacao)}
      </select></label>
      <label class="campo campo-largo"><span>Buscar</span>
        <input type="search" placeholder="Nome..." value="${esc(UI.busca)}" data-digita="busca"></label>
    </div>
    ${lista.length ? `
    <div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Nome</th><th>Loja</th><th>Cargo</th><th>Funções</th><th>Sexo</th><th>Turno</th>
        <th>Folga fixa</th><th>Início</th><th>Situação</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` :
    `<div class="vazio">Nenhum funcionário encontrado. Clique em <strong>+ Adicionar funcionário</strong> para começar o cadastro.</div>`}`;
}

// Quem está no Ponto System e ainda não está no cadastro do RH
function avisoPonto() {
  const sem = pessoasSemVinculo();
  const n = sem.filter(lojaDaPessoa).length;
  // Novos no ponto que ainda não bateram em nenhum relógio: o site não sabe a loja, cadastra um por um
  const novosSemLoja = sem.filter(p => !lojaDaPessoa(p) && (DB.pontoNovos || []).includes(p.codigo));
  if (!n && !novosSemLoja.length) return '';
  return `<div class="avisos"><ul>
    ${n ? `<li class="av-aviso">${n} funcionário(s) do Ponto System ainda não estão no cadastro.
      <button class="btn btn-principal btn-mini" data-acao="cadastrar-todos-ponto">Cadastrar todos</button></li>` : ''}
    ${novosSemLoja.length ? `<li class="av-aviso">Novos no Ponto System, ainda sem loja (escolha a loja ao cadastrar):
      ${novosSemLoja.map(p => `<button class="btn btn-claro btn-mini" data-acao="cadastrar-do-ponto" data-id="${esc(p.codigo)}">${esc(nomeProprio(p.nome))}</button>`).join(' ')}</li>` : ''}
  </ul></div>`;
}

// Cargo da carteira, agrupado por setor
function opcoesCargo(sel) {
  return '<option value="">Escolha...</option>' + Object.entries(CARGOS).map(([setor, lista]) =>
    `<optgroup label="${esc(setor)}">${lista.map(c => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`
  ).join('');
}

// Funções que a pessoa pode exercer; o número mostra a ordem (1 = principal)
function chipsFuncoes(selecionadas) {
  const chip = fn => {
    const pos = selecionadas.indexOf(fn);
    return `<button type="button" class="chip chip-funcao${pos >= 0 ? ' marcado' : ''}" data-acao="toggle-funcao" data-id="${esc(fn)}">${pos >= 0 ? `<b>${pos + 1}</b>` : '+'} ${esc(fn)}</button>`;
  };
  return `<div class="grupo-funcoes"><small>Entram na escala</small><div class="chips">${FUNCOES_ESCALA.map(chip).join('')}</div></div>
    <div class="grupo-funcoes"><small>Outras funções</small><div class="chips">${OUTRAS_FUNCOES.map(chip).join('')}</div></div>`;
}

function formFuncionario(f, inicial) {
  const novo = !f;
  f = f || { nome: '', loja: UI.filtroLoja || UI.loja, cargo: '', sexo: '', funcoes: [], turno: '', entrada: '', horaSaida: '', codigoPonto: '', folgas: [],
    inicio: '', situacao: 'Ativo', saida: '', alternaDomingos: false, obs: '', ...inicial };
  let funcoes = [...f.funcoes];
  abrirModal(novo ? 'Novo funcionário' : `Editar ${f.nome}`, `
    <label class="campo campo-largo"><span>Nome *</span><input name="nome" required value="${esc(f.nome)}" autocomplete="off"></label>
    <div class="grade-2">
      <label class="campo"><span>Loja *</span><select name="loja" required>${opcoes(LOJAS, f.loja)}</select></label>
      <label class="campo"><span>Cargo na carteira *</span><select name="cargo" required>${opcoesCargo(f.cargo)}</select></label>
    </div>
    <fieldset class="campo"><legend>Funções que pode exercer <small>(toque na ordem: a 1 é a principal)</small></legend>
      <div id="funcoes-chips">${chipsFuncoes(funcoes)}</div>
    </fieldset>
    <fieldset class="campo"><legend>Sexo * <small>(define a regra dos domingos)</small></legend>
      <div class="radios">
        <label><input type="radio" name="sexo" value="H" required ${f.sexo === 'H' ? 'checked' : ''}> Homem</label>
        <label><input type="radio" name="sexo" value="M" ${f.sexo === 'M' ? 'checked' : ''}> Mulher</label>
      </div>
    </fieldset>
    <label class="check" id="linha-alterna" ${f.sexo === 'H' ? '' : 'hidden'}>
      <input type="checkbox" name="alternaDomingos" ${f.alternaDomingos ? 'checked' : ''}>
      Exceção: alterna domingos como as mulheres (um sim, um não)</label>
    <fieldset class="campo"><legend>Folga fixa * <small>(pode marcar mais de um dia)</small></legend>
      <div class="dias-folga">${Object.entries(FOLGAS).map(([d, nome]) =>
        `<label><input type="checkbox" name="folgas" value="${d}" ${f.folgas.includes(d) ? 'checked' : ''}><span>${nome.slice(0, 3)}</span></label>`).join('')}</div>
      <div id="msg-folga" class="erros"></div>
    </fieldset>
    <label class="campo"><span>Turno</span><select name="turno">${opcoes(TURNOS, f.turno, '—')}</select></label>
    <div class="grade-2">
      <label class="campo"><span>Horário de entrada <small>(para o atraso)</small></span><input type="time" name="entrada" value="${f.entrada}"></label>
      <label class="campo"><span>Horário de saída <small>(hora extra conta depois)</small></span><input type="time" name="horaSaida" value="${f.horaSaida}"></label>
    </div>
    ${DB.pontoPessoas.length ? `<label class="campo campo-largo"><span>Nome no sistema de ponto</span><select name="codigoPonto">${opcoes(
      DB.pontoPessoas.map(p => [p.codigo, p.nome]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')), f.codigoPonto, 'Mesmo nome do cadastro')}</select></label>` : ''}
    <div class="grade-2">
      <label class="campo"><span>Data de início</span><input type="date" name="inicio" value="${f.inicio}"></label>
      <label class="campo"><span>Férias em aberto desde</span><input type="date" name="feriasDesde" value="${f.feriasDesde || ''}"
        title="Início do período aquisitivo mais antigo que ainda não foi tirado. Em branco = desde a admissão."></label>
    </div>
    <div class="grade-2">
      <label class="campo"><span>Situação</span><select name="situacao">${opcoes(SITUACOES, f.situacao)}</select></label>
    </div>
    <label class="campo" id="linha-saida" ${f.situacao === 'Desligado' ? '' : 'hidden'}><span>Data de saída</span>
      <input type="date" name="saida" value="${f.saida}"></label>
    <div class="grade-2" id="linha-aviso" ${f.situacao === 'Aviso prévio' ? '' : 'hidden'}>
      <label class="campo"><span>Início do aviso</span><input type="date" name="avisoInicio" value="${f.avisoInicio || ''}"></label>
      <label class="campo"><span>Último dia de trabalho</span><input type="date" name="avisoFim" value="${f.avisoFim || ''}"
        title="Depois desse dia a pessoa sai sozinha da escala e do ponto."></label>
    </div>
    <div class="grade-2" id="linha-afastamento" ${f.situacao === 'Afastado' ? '' : 'hidden'}>
      <label class="campo"><span>Motivo</span><select name="motivoAfastamento">${opcoes(MOTIVOS_AFASTAMENTO, f.motivoAfastamento || MOTIVOS_AFASTAMENTO[0])}</select></label>
      <label class="campo"><span>Volta em <small>(previsão)</small></span><input type="date" name="retorno" value="${f.retorno || ''}"
        title="A partir desse dia a pessoa volta sozinha para a escala. Em branco = fica fora até mudar a situação."></label>
    </div>
    <label class="campo campo-largo"><span>Observação</span>
      <input name="obs" value="${esc(f.obs)}" placeholder='ex.: "não trabalha domingo", "aceita freelancer"'></label>
  `, (dados, form) => {
    if (!dados.getAll('folgas').length) {
      form.querySelector('#msg-folga').textContent = 'Marque pelo menos um dia de folga.';
      return false;
    }
    const reg = {
      nome: dados.get('nome').trim(),
      loja: dados.get('loja'),
      cargo: dados.get('cargo'),
      sexo: dados.get('sexo'),
      alternaDomingos: dados.get('sexo') === 'H' && dados.has('alternaDomingos'),
      funcoes,
      turno: dados.get('turno'),
      entrada: dados.get('entrada'),
      horaSaida: dados.get('horaSaida'),
      codigoPonto: dados.has('codigoPonto') ? dados.get('codigoPonto') : f.codigoPonto,
      folgas: Object.keys(FOLGAS).filter(d => dados.getAll('folgas').includes(d)),
      inicio: dados.get('inicio'),
      feriasDesde: dados.get('feriasDesde'),
      situacao: dados.get('situacao'),
      saida: dados.get('situacao') === 'Desligado' ? dados.get('saida') : '',
      motivoAfastamento: dados.get('situacao') === 'Afastado' ? dados.get('motivoAfastamento') : '',
      retorno: dados.get('situacao') === 'Afastado' ? dados.get('retorno') : '',
      avisoInicio: dados.get('situacao') === 'Aviso prévio' ? dados.get('avisoInicio') : '',
      avisoFim: dados.get('situacao') === 'Aviso prévio' ? dados.get('avisoFim') : '',
      obs: dados.get('obs').trim(),
    };
    if (novo) DB.funcionarios.push({ id: novoId(), ...reg });
    else Object.assign(f, reg);
    // Vinculou ao ponto: as batidas dele entram já
    if (ultimoPonto) importarPonto(ultimoPonto);
    salvar();
  }, form => {
    const caixa = form.querySelector('#funcoes-chips');
    const atualizar = () => { caixa.innerHTML = chipsFuncoes(funcoes); };
    caixa.addEventListener('click', e => {
      const el = e.target.closest('[data-acao=toggle-funcao]');
      if (!el) return;
      const fn = el.dataset.id;
      funcoes = funcoes.includes(fn) ? funcoes.filter(x => x !== fn) : [...funcoes, fn];
      atualizar();
    });
    form.addEventListener('change', e => {
      if (e.target.name === 'sexo') form.querySelector('#linha-alterna').hidden = e.target.value !== 'H';
      if (e.target.name === 'situacao') {
        form.querySelector('#linha-saida').hidden = e.target.value !== 'Desligado';
        form.querySelector('#linha-afastamento').hidden = e.target.value !== 'Afastado';
        form.querySelector('#linha-aviso').hidden = e.target.value !== 'Aviso prévio';
      }
      // Sem funções marcadas ainda: começa pela função do próprio cargo
      if (e.target.name === 'cargo' && !funcoes.length && e.target.value) {
        funcoes = [e.target.value];
        atualizar();
      }
    });
  });
}

function formDesligar(f) {
  abrirModal(`Desligar ${f.nome}`, `
    <p>${esc(f.nome)} sai da escala a partir do dia seguinte à data de saída, mas continua no histórico.</p>
    <label class="campo"><span>Data de saída *</span><input type="date" name="saida" required value="${hoje()}"></label>
  `, dados => {
    f.situacao = 'Desligado';
    f.saida = dados.get('saida');
    salvar();
  }, null, 'Desligar');
}

// ---------- 2. Folgas semanais ----------

function telaFolgas() {
  const loja = UI.loja;
  const equipe = equipeDaLoja(loja, UI.mes);
  const domingos = domingosDoMes(UI.mes);
  const quadro = DB.domingos[loja] || {};

  const dias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  if (equipe.some(f => f.folgas.includes('dom'))) dias.push('dom');
  const colunas = dias.map(d => {
    // Quem está de licença o mês todo não aparece nas folgas fixas
    const nomes = equipe.filter(f => f.folgas.includes(d) && domingos.some(x => !afastadoEm(f, x) && !feriasEm(f.id, x))).map(f => `<li title="${esc(f.nome)}">${esc(nomeCurto(f.nome))}</li>`).join('');
    const fds = d === 'sex' || d === 'sab' || d === 'dom';
    const vazio = fds ? '<p class="todos">Todos trabalham</p>' : '<p class="ninguem">—</p>';
    return `<div class="dia-col${fds ? ' fds' : ''}"><h3>${SEMANA_CURTA[SEMANA.indexOf(d)]}</h3>${nomes ? `<ul>${nomes}</ul>` : vazio}</div>`;
  }).join('');

  const avisos = agruparAvisos(validarFolgas(loja, UI.mes));

  return `
    <section class="cabeca nao-imprime">
      <div><h1>Folgas semanais</h1><p>Quem folga em cada dia, por loja</p></div>
      <div class="botoes">
        <button class="btn btn-claro" data-acao="gerar-domingos">Sugerir domingos do mês</button>
        <button class="btn btn-claro" data-acao="proximos-meses" title="Monta os domingos dos 6 meses seguintes em todas as lojas, só onde ainda está vazio">Preencher próximos meses</button>
        <button class="btn btn-principal" data-acao="imprimir">Imprimir / PDF</button>
      </div>
    </section>
    <div class="filtros nao-imprime">${seletorLoja(loja, 'loja')}${seletorMes()}</div>
    ${avisos.length ? `<details class="avisos nao-imprime"${avisos.length <= 4 ? ' open' : ''}><summary><h3>Conferência das regras · ${avisos.length} aviso(s)</h3> <small>clique para ${avisos.length <= 4 ? 'esconder' : 'ver'}</small></summary><ul>
      ${avisos.map(a => `<li class="av-${a.nivel}">${esc(a.texto)}</li>`).join('')}</ul></details>`
      : equipe.length ? '<div class="avisos ok nao-imprime">Todas as regras de folga conferidas ✓</div>' : ''}
    ${equipe.length ? pdfFolgas(loja, equipe, domingos) : ''}
    <div class="quadro nao-imprime">
      <div class="quadro-titulo">
        <img src="img/logo.png" alt="" class="logo-impressao" onerror="this.remove()">
        <div><small>QUADRO DE FOLGAS</small><h2>${esc(loja)} · ${nomeMes(UI.mes)}</h2></div>
      </div>
      ${equipe.length ? `
      <h3 class="secao">Folgas fixas</h3>
      <div class="grade-semana" style="--colunas:${dias.length}">${colunas}</div>
      <h3 class="secao">Domingos do mês</h3>
      <p class="nota nao-imprime">Clique no quadradinho para trocar: <b>Trabalha</b> (CLT) → <b>Folga</b> → <b>Free</b> (está de folga, mas vem como freelancer) → <b>Trabalha</b>. Quem está de férias ou licença fica na caixa de baixo.</p>
      ${gradeDeDomingos(loja, equipe, domingos, quadro)}` :
      '<div class="vazio">Nenhum funcionário cadastrado nesta loja.</div>'}
    </div>`;
}

// Junta avisos repetidos da mesma pessoa: "Fulana: trabalha 2 domingos seguidos (3 vezes)"
function agruparAvisos(avisos) {
  const grupos = new Map();
  avisos.forEach(a => {
    const chave = a.texto.replace(/s*([^)]*).?$/, '');
    const g = grupos.get(chave) || { ...a, texto: chave, n: 0 };
    g.n++;
    if (a.nivel === 'erro') g.nivel = 'erro';
    grupos.set(chave, g);
  });
  return [...grupos.values()]
    .map(g => ({ nivel: g.nivel, texto: g.n > 1 ? `${g.texto} (${g.n} vezes)` : avisos.find(a => a.texto.startsWith(g.texto)).texto }))
    .sort((a, b) => (a.nivel === 'erro' ? 0 : 1) - (b.nivel === 'erro' ? 0 : 1));
}

// Grade de domingos: uma linha por pessoa, um quadradinho por domingo
function gradeDeDomingos(loja, equipe, domingos, quadro) {
  const dias = domingos.map(d => ({ d, r: escalaDia(loja, d) }));
  const mes = domingos[0].slice(0, 7);
  // Quem está de férias ou licença em todos os domingos do mês sai da grade e vai para a caixa de baixo
  const fora = (f, d) => afastadoEm(f, d) || feriasEm(f.id, d);
  const presentes = equipe.filter(f => domingos.some(d => statusDia(f, d) && !fora(f, d)));
  const linhas = presentes.filter(f => noRodizio(f, mes));
  // Da escala, mas fora do quadro de domingo (ex.: turno do dia): ficam numa parte separada, ainda clicáveis
  const outros = presentes.filter(f => !noRodizio(f, mes) && entraNaEscala(f));
  const celula = (f, d) => {
    const st = statusDia(f, d);
    if (!st) return '<td class="cel-dom"><span class="quad quad-vazio">—</span></td>';
    if (feriasEm(f.id, d)) return '<td class="cel-dom"><span class="quad quad-fixo">Férias</span></td>';
    if (st.trabalha || st.motivo === 'domingo') {
      const tipo = st.free ? 'free' : st.trabalha ? 'trabalha' : 'folga';
      const proximo = { trabalha: 'dar folga', folga: 'marcar como freelancer', free: 'voltar para trabalha (CLT)' }[tipo];
      const rotulo = { trabalha: 'Trabalha', folga: 'Folga', free: 'Free' }[tipo];
      return `<td class="cel-dom"><button class="quad quad-${tipo}" data-acao="troca-domingo" data-dia="${d}" data-id="${f.id}"
        title="${esc(f.nome)} · ${brCurta(d)}: clique para ${proximo}">${rotulo}</button></td>`;
    }
    const rotulo = { 'férias': 'Férias', afastamento: 'Licença', 'folga fixa': 'Folga fixa' }[st.motivo] || st.motivo;
    return `<td class="cel-dom"><span class="quad quad-fixo" title="${esc(st.motivo === 'afastamento' ? textoAfastamento(f) : st.motivo)}">${rotulo}</span></td>`;
  };
  const linha = f => {
    const folgas = domingos.filter(d => folgaDomingo(f.loja, d, f.id) && statusDia(f, d)).length;
    const regra = f.sexo === 'M' ? 'mulher' : f.alternaDomingos ? 'homem · alterna' : 'homem';
    return `<tr><th class="col-nome" title="${esc(f.nome)}">${esc(nomeCurto(f.nome))} <small>${regra}</small></th>
      ${domingos.map(d => celula(f, d)).join('')}
      <td class="col-total">${folgas}</td></tr>`;
  };
  const corpo = linhas.map(linha).join('') + (outros.length
    ? `<tr class="grade-sep"><td colspan="${domingos.length + 2}">Não estão no quadro de domingo (turno do dia ou fora do rodízio). Clique num quadradinho para incluir.</td></tr>` + outros.map(linha).join('')
    : '');
  const cabeca = dias.map(({ d, r }) => `<th class="col-dom"><b>${brCurta(d)}</b>
      ${r.feriado ? '<span class="tag-dia tag-feriado">Feriado</span>' : r.vespera ? '<span class="tag-dia tag-vespera">Véspera</span>' : ''}
      ${!quadro[d] ? '<span class="tag-dia">Não definido</span>' : ''}</th>`).join('');
  const rodape = dias.map(({ r }) => `<td class="cel-rodape${r.alerta ? ' com-alerta' : ''}">${statusFechamento(r)}
      ${r.marcados.length ? `<div class="chips">${r.marcados.map(chipFreela).join('')}</div>` : ''}${r.definida ? botaoFreela(r) : ''}</td>`).join('');
  return `
    <div class="grade-dom-caixa"><table class="grade-dom">
      <thead><tr><th class="col-nome">Domingo</th>${cabeca}<th class="col-total">Folgas no mês</th></tr></thead>
      <tbody>${corpo || `<tr><td colspan="${domingos.length + 2}" class="ninguem">Ninguém da escala nesta loja.</td></tr>`}</tbody>
      <tfoot><tr><th class="col-nome">Equipe do dia</th>${rodape}<td></td></tr></tfoot>
    </table></div>
    ${caixaAfastados(loja, domingos)}`;
}

// Quem está de licença, afastado ou de férias em algum dia do período, com as datas
function caixaAfastados(loja, dias) {
  const doPeriodo = DB.funcionarios.filter(f => f.loja === loja && dias.some(d => ativoEm(f, d)));
  const itens = [];
  doPeriodo.filter(f => dias.some(d => afastadoEm(f, d))).forEach(f => itens.push({ f,
    motivo: f.motivoAfastamento || 'Afastado', quando: f.retorno ? 'Volta em ' + br(f.retorno) : 'Sem data de volta' }));
  doPeriodo.forEach(f => {
    const reg = DB.ferias.find(r => r.funcId === f.id && r.partes.some(p => dias.some(d => p.inicio <= d && d <= p.fim)));
    if (!reg) return;
    const parte = reg.partes.find(p => dias.some(d => p.inicio <= d && d <= p.fim));
    itens.push({ f, motivo: 'Férias', quando: `${brCurta(parte.inicio)} a ${brCurta(parte.fim)}${reg.substituto ? ' · sub.: ' + reg.substituto : ''}` });
  });
  if (!itens.length) return '';
  return `<div class="afastados"><h3>Fora da escala: férias, licença e afastamento</h3><div class="afastados-lista">
    ${itens.map(x => `<div class="afastado"><b title="${esc(x.f.nome)}">${esc(nomeCurto(x.f.nome))}</b><span>${esc(x.motivo)}</span>
      <small>${esc(x.quando)}</small></div>`).join('')}</div></div>`;
}


// ---------- PDF no modelo do Grupo CHD (faixa vermelha, cartões, rodapé azul) ----------

function pdfTopo(rotulo, titulo, subtitulo) {
  return `<div class="pdf-topo so-imprime">
    <img src="img/logo.png" alt="" class="pdf-logo" onerror="this.remove()">
    <div class="pdf-topo-texto"><small>${esc(rotulo)}</small><h1>${esc(titulo)}</h1><p>${esc(subtitulo)}</p></div>
  </div>`;
}

function pdfRodape(loja, mes) {
  const feriados = DB.feriados.filter(h => h.data.startsWith(mes) && (!loja || !h.lojas.length || h.lojas.includes(loja)))
    .sort((a, b) => a.data.localeCompare(b.data));
  return `<div class="pdf-rodape so-imprime"><span>Grupo CHD · Cachorrão Hotdog</span>
    <span>${feriados.length ? 'Feriados: ' + feriados.map(h => `${brCurta(h.data)} ${esc(h.nome)}`).join(' · ') : ''}</span></div>`;
}

// Nome do quadro: primeiro nome; se repetir na loja, primeiro e segundo
function nomeQuadro(f, equipe) {
  const primeiro = f.nome.trim().split(/\s+/)[0];
  // Nomes compostos comuns ficam com o segundo nome: Maria Julia, Ana Carolina, José Anderson
  const composto = ['maria', 'ana', 'jose', 'joao'].includes(semAcento(primeiro));
  const repete = equipe.some(x => x !== f && x.nome.trim().split(/\s+/)[0] === primeiro);
  return composto || repete ? nomeCurto(f.nome) : primeiro;
}

function pdfFolgas(loja, equipe, domingos) {
  const mes = domingos[0].slice(0, 7);
  const fora = (f, d) => afastadoEm(f, d) || feriasEm(f.id, d);
  // Mesmo time da grade de domingos: quem está no rodízio e não passa o mês todo fora
  const time = equipe.filter(f => noRodizio(f, mes) && domingos.some(d => statusDia(f, d) && !fora(f, d)));
  const nome = f => esc(nomeQuadro(f, time));

  const dias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  if (time.some(f => f.folgas.includes('dom'))) dias.push('dom');
  const fixas = dias.map(d => {
    const lista = time.filter(f => f.folgas.includes(d));
    const fds = d === 'sex' || d === 'sab';
    return `<div class="pdf-dia${lista.length ? '' : ' pdf-todos'}${fds ? ' pdf-fds' : ''}">
      <h3>${SEMANA_CURTA[SEMANA.indexOf(d)].toUpperCase()}</h3>
      <div>${lista.length ? lista.map(f => `<span>${nome(f)}</span>`).join('') : '<span>Todos<br>trabalham</span>'}</div></div>`;
  }).join('');

  const cartoes = domingos.map(d => {
    const r = escalaDia(loja, d);
    const folga = [], trabalha = [];
    time.forEach(f => {
      const st = statusDia(f, d);
      if (!st || fora(f, d)) return;
      if (st.trabalha) trabalha.push(`<span class="pdf-pill pdf-trab">${nome(f)}${st.free ? ' · free' : ''}</span>`);
      else if (st.motivo === 'domingo') folga.push(`<span class="pdf-pill pdf-folga">${nome(f)}</span>`);
    });
    r.marcados.forEach(x => trabalha.push(`<span class="pdf-pill pdf-trab">${esc(x.nome)} · free</span>`));
    const tag = r.feriado ? 'FERIADO' : r.vespera ? 'VÉSPERA DE FERIADO' : '';
    return `<div class="pdf-dom">
      <div class="pdf-data"><b>${d.slice(8)}</b><small>DOM · ${nomeMes(mes).slice(0, 3).toUpperCase()}</small></div>
      <div class="pdf-dom-corpo">
        <div><h4 class="pdf-h-folga">FOLGA</h4><div class="pdf-pills">${folga.join('') || '<span class="pdf-ninguem">—</span>'}</div></div>
        <div><h4 class="pdf-h-trab">TRABALHA</h4><div class="pdf-pills">${trabalha.join('') || '<span class="pdf-ninguem">—</span>'}</div></div>
        ${tag ? `<span class="pdf-tag">${tag}</span>` : ''}
      </div></div>`;
  }).join('');

  return `<div class="pdf-folgas so-imprime">
    ${pdfTopo('LOJA', loja.toUpperCase(), `Quadro de Folgas · ${nomeMes(mes)}`)}
    <div class="pdf-corpo">
      <h2 class="pdf-secao">Folgas fixas</h2>
      <div class="pdf-fixas" style="--colunas:${dias.length}">${fixas}</div>
      <h2 class="pdf-secao">Domingos</h2>
      <div class="pdf-doms">${cartoes}</div>
    </div>
    ${pdfRodape(loja, mes)}
  </div>`;
}

// ---------- 3. Escala de trabalho ----------

function chipFreela(x) {
  const texto = `${esc(x.nome)} <small>· ${esc(x.funcao)}</small>`;
  return `<button class="chip chip-freela" data-acao="remover-freela" data-id="${x.id}" title="Remover freelancer">${texto} ×</button>`;
}

function botaoFreela(r) {
  return `<button class="btn btn-claro btn-mini nao-imprime" data-acao="novo-freela" data-id="${esc(r.loja)}" data-dia="${r.data}">+ Freelancer</button>`;
}

function contarFuncoes(lista) {
  const cont = {};
  lista.forEach(fn => { cont[fn] = (cont[fn] || 0) + 1; });
  return Object.entries(cont).map(([fn, n]) => `${n > 1 ? n + ' ' : ''}${esc(fn)}`).join(', ');
}

// "Fechado" ou o que ainda falta para fechar a escala do dia
function statusFechamento(r) {
  if (!r.definida) return '<small>sem equipe mínima</small>';
  const total = `Cozinha ${r.cozinha.length}/${r.minimo} · Salão ${r.salao.length}/${r.salaoMinimo}`;
  if (!r.freelas.length) return `<span class="texto-ok">✓ Fechado</span> <small>${total}</small>`;
  const cls = r.alerta ? 'texto-erro' : 'texto-aviso';
  const rotulo = r.alerta ? 'Falta' : 'Prever (ideal)';
  return `<span class="${cls}">${rotulo}: ${contarFuncoes(r.freelas)}</span> <small>${total}</small>`;
}

function linhaFolgam(r) {
  if (!r.folgam.length) return '—';
  return `<ul class="lista-nomes">${r.folgam.map(x => `<li title="${esc(x.f.nome)}">${esc(nomeCurto(x.f.nome))} <small>${x.motivo}</small></li>`).join('')}</ul>`;
}

// Um nome embaixo do outro: "Guilherme Crispim  montador"
function nomesEscalados(lista) {
  if (!lista.length) return '<span class="ninguem">ninguém</span>';
  return `<ul class="lista-nomes">${lista.map(x => {
    if (x.freela) return `<li class="nome-freela">${esc(x.nome)} <small>freelancer · ${esc(x.funcao)}</small></li>`;
    const extra = [x.funcao, x.free && 'free', x.substituto && `sub.: ${x.substituto}`].filter(Boolean).map(esc).join(' · ');
    return `<li title="${esc(x.nome)}"${x.free ? ' class="nome-freela"' : ''}>${esc(nomeCurto(x.nome))} <small>${extra}</small></li>`;
  }).join('')}</ul>`;
}

function classeDia(r) {
  return [r.dow === 0 && 'dia-domingo', r.feriado && 'dia-feriado', r.vespera && 'dia-vespera', r.alerta && 'dia-alerta'].filter(Boolean).join(' ');
}

function etiquetasDia(r) {
  return (r.feriado ? etiqueta('Feriado · ' + r.feriado.nome, 'erro') : '') +
    (r.vespera ? etiqueta('Véspera', 'aviso') : '');
}

function telaEscala() {
  const modo = UI.escalaModo;
  const alternar = `<div class="alternar nao-imprime">
      <button class="${modo === 'mes' ? 'ativo' : ''}" data-acao="escala-modo" data-id="mes">Mês (uma loja)</button>
      <button class="${modo === 'dia' ? 'ativo' : ''}" data-acao="escala-modo" data-id="dia">Dia (todas as lojas)</button>
    </div>`;
  return `
    <section class="cabeca nao-imprime">
      <div><h1>Escala de trabalho</h1><p>Quem está trabalhando em cada dia</p></div>
      <button class="btn btn-principal" data-acao="imprimir">Imprimir / PDF</button>
    </section>
    ${alternar}
    ${modo === 'mes' ? escalaPorMes() : escalaPorDia()}`;
}

function escalaPorMes() {
  const loja = UI.loja;
  const dias = escalaMes(loja, UI.mes);
  const definida = DB.equipeMinima[loja].definida;
  const comFreela = dias.filter(r => r.freelas.length);
  const faltando = comFreela.reduce((s, r) => s + r.freelas.length, 0);
  const marcados = dias.reduce((s, r) => s + r.marcados.length, 0);
  const vermelhos = dias.filter(r => r.alerta).length;

  const linhas = dias.map(r => `<tr class="${classeDia(r)}">
      <td data-label="Data" class="col-data"><strong>${brCurta(r.data)}</strong> ${SEMANA_CURTA[r.dow]} ${etiquetasDia(r)}</td>
      <td data-label="Cozinha">${nomesEscalados(r.cozinha)}</td>
      <td data-label="Salão">${nomesEscalados(r.salao)}</td>
      <td data-label="Folgam">${linhaFolgam(r)}</td>
      <td data-label="Total cozinha" class="num">${r.cozinha.length}${r.definida ? `<small> / ${r.minimo}</small>` : ''}</td>
      <td data-label="Freelancer">
        <div>${statusFechamento(r)}</div>
        ${r.marcados.length ? `<div class="chips">${r.marcados.map(chipFreela).join('')}</div>` : ''}
        ${r.definida && r.freelas.length ? botaoFreela(r) : ''}
      </td>
    </tr>`).join('');

  return `
    <div class="filtros nao-imprime">${seletorLoja(loja, 'loja')}${seletorMes()}</div>
    ${pdfTopo('ESCALA DE TRABALHO', loja.toUpperCase(), nomeMes(UI.mes))}
    ${caixaAfastados(loja, diasDoMes(UI.mes))}
    ${!definida ? `<div class="avisos"><ul><li class="av-aviso">A equipe mínima de ${esc(loja)} ainda não foi definida —
      sem ela o site não calcula alertas nem freelancers. <button class="link" data-acao="tela" data-id="ajustes">Definir em Ajustes</button></li></ul></div>` : ''}
    ${definida ? `<div class="resumo">
      <div class="resumo-num ${faltando ? 'erro' : ''}"><strong>${faltando}</strong><span>freelancers ainda faltando</span></div>
      <div class="resumo-num"><strong>${marcados}</strong><span>freelancers já combinados</span></div>
      <div class="resumo-lista"><h3>Freelancer por dia <small>(número = quantos faltam · passe o mouse para ver as funções)</small></h3>
        ${comFreela.length ? `<div class="dias-freela">${comFreela.map(r => `<div class="dia-freela ${r.alerta ? 'df-erro' : 'df-aviso'}" title="${contarFuncoes(r.freelas)}"><span>${brCurta(r.data)}<small>${SEMANA_CURTA[r.dow]}</small></span><b>${r.freelas.length}</b></div>`).join('')}</div>
          <p class="nota">No mês: ${contarFuncoes(comFreela.flatMap(r => r.freelas))}. Vermelho = abaixo do mínimo; amarelo = ideal.</p>` : '<p>Nenhuma. A escala do mês está fechada.</p>'}
      </div></div>` : ''}
    <div class="tabela-caixa"><table class="tabela escala">
      <thead><tr><th>Data</th><th>Cozinha</th><th>Salão</th><th>Folgam</th><th title="Total na cozinha / mínimo">Total</th><th>Freelancer</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
    ${vermelhos ? `<p class="nota">${vermelhos} dia(s) abaixo do mínimo.</p>` : ''}`;
}

function escalaPorDia() {
  const d = UI.dia;
  // Imprimindo uma loja só: os outros cartões não saem no PDF
  const sai = loja => !UI.imprimeLoja || UI.imprimeLoja === loja ? '' : ' nao-imprime';
  const cartoes = LOJAS_ESCALA.map(loja => {
    const r = escalaDia(loja, d);
    if (!r.cozinha.length && !r.salao.length && !r.folgam.length) {
      return `<div class="cartao-loja vazio-loja${sai(loja)}"><h3>${esc(loja)}</h3><p>Sem funcionários na escala.</p></div>`;
    }
    return `<div class="cartao-loja ${r.alerta ? 'dia-alerta' : ''}${sai(loja)}">
      <div class="domingo-topo"><h3>${esc(loja)}</h3>${etiquetasDia(r)}
        <button class="btn btn-pdf-loja nao-imprime" data-acao="imprimir-loja" data-id="${esc(loja)}">PDF</button></div>
      <div class="esc-grupos">
        <div><h4>Cozinha</h4>${nomesEscalados(r.cozinha)}</div>
        <div><h4>Salão</h4>${nomesEscalados(r.salao)}</div>
        <div><h4>Folgam</h4>${linhaFolgam(r)}</div>
      </div>
      ${r.afastados.length ? `<p class="nota"><b>Afastados:</b> ${r.afastados.map(f => `${esc(nomeCurto(f.nome))} <small>(${esc(textoAfastamento(f))})</small>`).join(', ')}</p>` : ''}
      <p>${statusFechamento(r)}</p>
      ${r.definida && r.freelas.length ? botaoFreela(r) : ''}
    </div>`;
  }).join('');
  return `
    <div class="filtros nao-imprime">
      <label class="campo"><span>Dia</span>
        <div class="mes-nav">
          <button class="btn btn-icone" data-acao="dia" data-n="-1" aria-label="Dia anterior">‹</button>
          <input type="date" value="${d}" data-muda="dia">
          <button class="btn btn-icone" data-acao="dia" data-n="1" aria-label="Próximo dia">›</button>
        </div></label>
    </div>
    ${UI.imprimeLoja ? pdfTopo('ESCALA DO DIA', UI.imprimeLoja.toUpperCase(), `${SEMANA_LONGA[diaSemana(d)]}, ${br(d)}`) : ''}
    <h2 class="titulo-dia${UI.imprimeLoja ? ' nao-imprime' : ''}">${SEMANA_LONGA[diaSemana(d)]}, ${br(d)}</h2>
    <div class="cartoes-lojas${UI.imprimeLoja ? ' uma-loja' : ''}">${cartoes}</div>`;
}

// Registra um freelancer já combinado para o dia; ele entra na conta da escala
function formFreela(loja, data) {
  const r = escalaDia(loja, data);
  abrirModal(`Freelancer · ${loja}`, `
    <p><b>${SEMANA_LONGA[diaSemana(data)]}, ${br(data)}</b>${r.freelas.length ? ` — falta: ${contarFuncoes(r.freelas)}` : ''}</p>
    <label class="campo campo-largo"><span>Nome do freelancer</span><input name="nome" placeholder="Opcional" autocomplete="off"></label>
    <label class="campo"><span>Função *</span><select name="funcao" required>${opcoes(FUNCOES_ESCALA, r.freelas[0] || 'montador')}</select></label>
  `, dados => {
    DB.freelas.push({ id: novoId(), loja, data, nome: dados.get('nome').trim() || 'Freelancer', funcao: dados.get('funcao') });
    salvar();
  });
}

// ---------- 4. Férias ----------

function textoPartes(reg) {
  if (!reg) return '—';
  return reg.partes.map(p => `${br(p.inicio)} a ${br(p.fim)}`).join('<br>');
}

function telaFerias() {
  const lista = DB.funcionarios
    .filter(f => f.situacao !== 'Desligado')
    .map(situacaoFerias)
    .sort((a, b) => a.limite.localeCompare(b.limite));
  const cont = n => lista.filter(x => x.nivel === n).length;

  const linhas = lista.map(s => {
    const { f, periodo, registro } = s;
    const ultimaParte = registro && registro.partes[registro.partes.length - 1];
    return `<tr class="${s.nivel === 'erro' ? 'linha-erro' : s.nivel === 'aviso' ? 'linha-aviso' : ''}">
      <td data-label="Colaborador"><strong>${esc(f.nome)}</strong><br><small>${esc(f.loja)}${f.cargo ? ' · ' + esc(f.cargo) : ''}</small></td>
      <td data-label="Início no trabalho">${br(f.inicio) || etiqueta('Cadastrar', 'cinza')}</td>
      <td data-label="Período aquisitivo">${periodo ? `${br(periodo.inicio)} a ${br(periodo.fim)}` : '—'}</td>
      <td data-label="Data limite"><strong>${periodo ? br(periodo.limite) : '—'}</strong>
        ${s.pendente && s.faltam >= 0 ? `<br><small>faltam ${s.faltam} dias</small>` : ''}</td>
      <td data-label="Férias marcadas">${textoPartes(registro)}</td>
      <td data-label="Volta">${ultimaParte ? br(addDias(ultimaParte.fim, 1)) : '—'}</td>
      <td data-label="Substituto">${registro && registro.substituto ? esc(registro.substituto) + (registro.mesmoEsquema ? '<br><small>mesmo esquema de folgas</small>' : '') : '—'}</td>
      <td data-label="Status">${etiqueta(s.status, s.nivel)}</td>
      <td class="acoes">
        ${registro ? `<button class="btn btn-claro" data-acao="editar-ferias" data-id="${registro.id}">Editar</button>` : ''}
        <button class="btn btn-claro" data-acao="nova-ferias" data-id="${f.id}">+ Marcar</button>
      </td></tr>`;
  }).join('');

  return `
    <section class="cabeca">
      <div><h1>Férias</h1><p>Controle de férias e data limite de cada colaborador</p></div>
      <button class="btn btn-principal" data-acao="nova-ferias">+ Marcar férias</button>
    </section>
    <div class="contadores">
      <div class="contador estatico"><strong>${cont('ok')}</strong><span>Em dia</span></div>
      <div class="contador estatico aviso"><strong>${cont('aviso')}</strong><span>Vencem em menos de 90 dias</span></div>
      <div class="contador estatico erro"><strong>${cont('erro')}</strong><span>Vencidas (pagas em dobro)</span></div>
    </div>
    ${lista.length ? `<div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Colaborador / Loja</th><th>Início no trabalho</th><th>Período aquisitivo</th><th>Data limite</th>
        <th>Férias marcadas</th><th>Volta</th><th>Substituto</th><th>Status</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` : '<div class="vazio">Cadastre os funcionários primeiro.</div>'}
    <p class="nota">Data limite = último dia para começar 30 dias de férias dentro dos 12 meses seguintes ao período aquisitivo (igual ao relatório da contabilidade). Quem está de férias sai
      automaticamente da escala nos dias marcados. <strong>Confirmar as regras de férias com o contador.</strong></p>`;
}

function opcoesPeriodo(f, sel) {
  const ps = f ? periodosAquisitivos(f) : [];
  return opcoes(ps.map(p => [p.inicio, `${br(p.inicio)} a ${br(p.fim)} (limite ${br(p.limite)})`]), sel,
    ps.length ? 'Escolha o período...' : 'Cadastre a data de início do funcionário');
}

function formFerias(reg, funcId) {
  const novo = !reg;
  const ativos = DB.funcionarios.filter(f => f.situacao !== 'Desligado').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  let f = funcionario(reg ? reg.funcId : funcId);
  let periodoSel = reg ? reg.periodoInicio : '';
  if (!reg && f) {
    const s = situacaoFerias(f);
    periodoSel = s.periodo ? s.periodo.inicio : '';
  }
  reg = reg || { partes: [], substituto: '', mesmoEsquema: true, quitado: true };
  const parte = i => {
    const p = reg.partes[i] || { inicio: '', fim: '' };
    return `<div class="grade-2 parte"><label class="campo"><span>Parte ${i + 1} · início${i === 0 ? ' *' : ''}</span>
        <input type="date" name="ini${i}" value="${p.inicio}" ${i === 0 ? 'required' : ''}></label>
      <label class="campo"><span>fim${i === 0 ? ' *' : ''}</span><input type="date" name="fim${i}" value="${p.fim}" ${i === 0 ? 'required' : ''}></label></div>`;
  };
  abrirModal(novo ? 'Marcar férias' : `Férias de ${f ? f.nome : ''}`, `
    <label class="campo campo-largo"><span>Colaborador *</span>
      <select name="funcId" required>${opcoes(ativos.map(x => [x.id, `${x.nome} — ${x.loja}`]), f ? f.id : '', 'Escolha...')}</select></label>
    <label class="campo campo-largo"><span>Período aquisitivo</span>
      <select name="periodo">${opcoesPeriodo(f, periodoSel)}</select></label>
    <p class="nota">Pode dividir em até 3 partes. A volta é o dia seguinte ao fim.</p>
    ${parte(0)}${parte(1)}${parte(2)}
    <label class="campo campo-largo"><span>Substituto</span><input name="substituto" value="${esc(reg.substituto)}" placeholder="Nome do substituto (opcional)"></label>
    <label class="check"><input type="checkbox" name="mesmoEsquema" ${reg.mesmoEsquema ? 'checked' : ''}>
      O substituto faz o mesmo esquema de folgas (a escala segue com o nome do titular)</label>
    <label class="check"><input type="checkbox" name="quitado" ${reg.quitado ? 'checked' : ''}>
      Estas férias completam o período aquisitivo</label>
    <div id="msg-ferias"></div>
    ${novo ? '' : '<button type="button" class="btn btn-perigo" data-acao="excluir-ferias">Excluir estas férias</button>'}
  `, (dados, form) => {
    const partes = [0, 1, 2].map(i => ({ inicio: dados.get('ini' + i), fim: dados.get('fim' + i) }))
      .filter(p => p.inicio || p.fim);
    const { erros, avisos } = validarFerias(partes);
    const msg = form.querySelector('#msg-ferias');
    if (erros.length) {
      msg.innerHTML = `<ul class="erros">${erros.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
      return false;
    }
    if (avisos.length && !form.dataset.confirmado) {
      msg.innerHTML = `<ul class="avisos-form">${avisos.map(e => `<li>${esc(e)}</li>`).join('')}</ul><p>Clique em salvar de novo para confirmar.</p>`;
      form.dataset.confirmado = '1';
      return false;
    }
    const dadosReg = {
      funcId: dados.get('funcId'),
      periodoInicio: dados.get('periodo'),
      partes: partes.sort((a, b) => a.inicio.localeCompare(b.inicio)),
      substituto: dados.get('substituto').trim(),
      mesmoEsquema: dados.has('mesmoEsquema'),
      quitado: dados.has('quitado'),
    };
    if (novo) DB.ferias.push({ id: novoId(), ...dadosReg });
    else Object.assign(reg, dadosReg);
    salvar();
  }, form => {
    form.querySelector('[name=funcId]').addEventListener('change', e => {
      f = funcionario(e.target.value);
      const s = f && situacaoFerias(f);
      form.querySelector('[name=periodo]').innerHTML = opcoesPeriodo(f, s && s.periodo ? s.periodo.inicio : '');
    });
    const excluir = form.querySelector('[data-acao=excluir-ferias]');
    if (excluir) excluir.addEventListener('click', () => {
      if (!confirm('Excluir estas férias?')) return;
      DB.ferias = DB.ferias.filter(r => r !== reg);
      salvar();
      fecharModal();
      render();
    });
  });
}

// ---------- 5. Ponto ----------

// Dias do relatório de ponto: de um dia até outro (no máximo 62, o que fica guardado do ponto)
function diasDoPonto() {
  const de = UI.pontoDe <= UI.pontoAte ? UI.pontoDe : UI.pontoAte;
  const ate = UI.pontoDe <= UI.pontoAte ? UI.pontoAte : UI.pontoDe;
  const n = Math.min(diffDias(de, ate), 61) + 1;
  return Array.from({ length: n }, (_, i) => addDias(de, i));
}

function celulaPonto(p) {
  if (!p) return '<td class="pt-vazio">—</td>';
  if (!p.batidas) {
    const texto = { 'férias': 'Férias', 'afastamento': 'Afastado' }[p.motivo] || 'Folga';
    return `<td class="pt-folga" title="${esc(p.motivo)}">${texto}</td>`;
  }
  const titulo = `Batidas: ${p.batidas.map(relogio).join(' · ')}` +
    (p.atraso ? ` — ${p.atraso} min de atraso` : '') + (p.incompleto ? ' — falta uma batida' : '') +
    (p.extraAntes ? ` — chegou ${horas(p.extraAntes)} antes` : '') + (p.extraDepois ? ` — ficou ${horas(p.extraDepois)} depois` : '');
  // Entrada, saída e hora extra, uma embaixo da outra
  return `<td class="pt-${p.cor || 'sem'}" title="${esc(titulo)}">
    ${p.naFolga ? '<small class="pt-na-folga">na folga</small>' : ''}
    <b>${relogio(p.chegada)}</b>
    <span class="pt-saida">${p.incompleto ? '<i>sem saída</i>' : relogio(p.batidas[p.batidas.length - 1])}</span>
    ${p.extra ? `<small class="pt-extra">+${horas(p.extra)}</small>` : ''}</td>`;
}

function telaPonto() {
  const loja = UI.loja;
  const dias = diasDoPonto();
  const rel = relatorioPonto(loja, dias);
  const modo = UI.pontoModo;
  const { verde, amarelo } = DB.pontoConfig;
  const temBatidas = rel.some(r => dias.some(d => r.dias[d] && r.dias[d].batidas));
  const semHorario = rel.filter(r => !r.f.entrada);
  // Sem vínculo: quem bateu ponto no relógio desta loja no período importado
  const semVinculo = pessoasSemVinculo().filter(p => lojaDaPessoa(p) === loja);
  const soma = campo => rel.reduce((s, r) => s + r[campo], 0);
  const periodo = `${br(dias[0])} a ${br(dias[dias.length - 1])}`;

  const grade = `
    <div class="grade-ponto-caixa"><table class="grade-ponto${dias.length > 10 ? ' compacta' : ''}">
      <thead><tr><th class="pt-nome">Funcionário</th>
        ${dias.map(d => `<th class="${diaSemana(d) === 0 ? 'pt-dom' : ''}">${SEMANA_CURTA[diaSemana(d)]}<br>${d.slice(8)}</th>`).join('')}
        <th>Atrasos</th><th>Horas</th><th>Hora extra</th></tr></thead>
      <tbody>${rel.map(r => `<tr>
        <td class="pt-nome" title="${esc(r.f.nome)}"><strong>${esc(nomeCurto(r.f.nome))}</strong><small>${r.f.entrada ? `${r.f.entrada}${r.f.horaSaida ? ' às ' + r.f.horaSaida : ''}` : 'sem horário'}</small></td>
        ${dias.map(d => celulaPonto(r.dias[d])).join('')}
        <td class="pt-total">${r.amarelo || r.vermelho ? `<span class="texto-aviso">${r.amarelo}</span> · <span class="texto-erro">${r.vermelho}</span>` : '<span class="texto-ok">0</span>'}</td>
        <td class="pt-total">${horas(r.trabalhado)}</td>
        <td class="pt-total ${r.extra ? 'pt-extra' : ''}">${r.extra ? horas(r.extra) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`;

  // Hora extra por dia da semana (seg → dom); o dia com mais hora extra de cada um fica em destaque
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const comExtra = rel.filter(r => r.extra);
  const totalSemana = ordem.map(dow => comExtra.reduce((s, r) => s + r.extraSemana[dow], 0));
  const maiorTotal = Math.max(...totalSemana);
  const porSemana = comExtra.length ? `
    <div class="tabela-caixa"><table class="tabela tabela-extra">
      <thead><tr><th>Funcionário</th>${ordem.map(dow => `<th>${SEMANA_CURTA[dow]}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${comExtra.map(r => {
        const maior = Math.max(...r.extraSemana);
        return `<tr><td data-label="Funcionário" title="${esc(r.f.nome)}"><strong>${esc(nomeCurto(r.f.nome))}</strong></td>
          ${ordem.map(dow => {
            const v = r.extraSemana[dow];
            return `<td data-label="${SEMANA_CURTA[dow]}" class="${v ? (v === maior ? 'pt-pico' : 'pt-extra') : ''}">${v ? horas(v) : '—'}</td>`;
          }).join('')}
          <td data-label="Total" class="pt-extra"><strong>${horas(r.extra)}</strong></td></tr>`;
      }).join('')}
        <tr class="linha-total"><td data-label="Total"><strong>Total da loja</strong></td>
          ${totalSemana.map((v, i) => `<td data-label="${SEMANA_CURTA[ordem[i]]}" class="${v && v === maiorTotal ? 'pt-pico' : ''}"><strong>${v ? horas(v) : '—'}</strong></td>`).join('')}
          <td data-label="Total" class="pt-extra"><strong>${horas(soma('extra'))}</strong></td></tr>
      </tbody></table></div>` : '<p class="nota">Ninguém fez hora extra no período.</p>';

  return `
    <section class="cabeca nao-imprime">
      <div><h1>Ponto</h1><p>Pontualidade e hora extra de cada funcionário</p></div>
      <div class="botoes">
        <button class="btn btn-claro" data-acao="atualizar-ponto" title="Busca no Ponto System as batidas e os funcionários novos">Atualizar do ponto</button>
        <button class="btn btn-principal" data-acao="imprimir">Imprimir / PDF</button>
      </div>
    </section>
    <div class="filtros nao-imprime">${seletorLoja(loja, 'loja', false, LOJAS)}
      <label class="campo"><span>De</span><input type="date" value="${UI.pontoDe}" data-muda="ponto-de"></label>
      <label class="campo"><span>Até</span><input type="date" value="${UI.pontoAte}" data-muda="ponto-ate"></label>
    </div>
    ${pdfTopo('PONTO · PONTUALIDADE E HORA EXTRA', loja.toUpperCase(), periodo)}
    ${!temBatidas ? `<div class="avisos"><ul><li class="av-aviso">Ainda não há batidas de ${esc(loja)} neste período.
      O ponto chega sozinho todo dia de manhã; para buscar agora, clique em <b>Atualizar do ponto</b>.</li></ul></div>` : ''}
    ${semHorario.length ? `<div class="avisos"><ul><li class="av-aviso">Sem horário de entrada no cadastro (fica sem cor):
      ${semHorario.map(r => esc(r.f.nome)).join(', ')}.</li></ul></div>` : ''}
    <div class="resumo resumo-ponto">
      <div class="resumo-num"><strong class="texto-ok">${soma('verde')}</strong><span>chegadas no horário</span></div>
      <div class="resumo-num"><strong class="texto-aviso">${soma('amarelo')}</strong><span>atrasos (até ${amarelo} min)</span></div>
      <div class="resumo-num"><strong class="texto-erro">${soma('vermelho')}</strong><span>muito atrasados</span></div>
      <div class="resumo-num"><strong class="pt-extra">${horas(soma('extra'))}</strong><span>hora extra no período</span></div>
    </div>
    <div class="legenda">
      <span><i class="pt-verde"></i> até ${verde} min</span>
      <span><i class="pt-amarelo"></i> ${verde + 1} a ${amarelo} min de atraso</span>
      <span><i class="pt-vermelho"></i> mais de ${amarelo} min</span>
      <span><b class="pt-extra">+1h</b> hora extra (chegou mais de ${DB.pontoConfig.chegadaCedo} min antes, ou ficou depois da meia-noite / do horário de saída)</span>
      <span>Em cada dia: entrada, saída e hora extra, um embaixo do outro</span>
    </div>
    ${rel.length ? grade : '<div class="vazio">Nenhum funcionário nesta loja.</div>'}
    <div class="painel painel-extra">
      <div class="painel-topo"><h2>Hora extra por dia da semana</h2><small>${periodo}</small></div>
      ${porSemana}
    </div>
    ${semVinculo.length ? `<div class="painel nao-imprime">
      <div class="painel-topo"><h2>No ponto, mas sem cadastro no RH (${semVinculo.length})</h2></div>
      <p class="nota">As batidas destas pessoas só entram no relatório depois do cadastro. Clique num nome para cadastrar, ou cadastre todos de uma vez.</p>
      ${avisoPonto()}
      <div class="chips">${semVinculo.map(p => `<button class="chip" data-acao="cadastrar-do-ponto" data-id="${esc(p.codigo)}">+ ${esc(nomeProprio(p.nome))}</button>`).join('')}</div>
    </div>` : ''}`;
}

// ---------- Ajustes: feriados, equipe mínima e dados ----------

function telaAjustes() {
  const feriados = [...DB.feriados].sort((a, b) => a.data.localeCompare(b.data));
  // Equipe mínima da loja escolhida: quantas pessoas de cada função por tipo de dia
  const c = DB.equipeMinima[UI.loja];
  const num = (campo, valor) => `<input type="number" min="0" max="20" value="${valor}"
    data-equipe="${esc(UI.loja)}" data-campo="${campo}" ${c.definida ? '' : 'disabled'}>`;
  const soma = comp => FUNCOES_ESCALA.reduce((s, fn) => s + (comp[fn] || 0), 0);
  const equipe = `
      <label class="check"><input type="checkbox" data-equipe="${esc(UI.loja)}" data-campo="definida" ${c.definida ? 'checked' : ''}>
        Equipe mínima definida para ${esc(UI.loja)}</label>
      <div class="tabela-caixa"><table class="tabela tabela-equipe">
        <thead><tr><th>Função</th><th>Seg a qui</th><th>Domingo, feriado e véspera</th></tr></thead>
        <tbody>${FUNCOES_ESCALA.map(fn => `<tr>
          <td data-label="Função"><strong>${esc(fn)}</strong></td>
          <td data-label="Seg a qui">${num('semana.' + fn, c.semana[fn] || 0)}</td>
          <td data-label="Domingo/feriado">${num('domingo.' + fn, c.domingo[fn] || 0)}</td></tr>`).join('')}
          <tr class="linha-total"><td data-label="Total"><strong>Total</strong></td>
            <td data-label="Seg a qui"><strong>${soma(c.semana)}</strong></td>
            <td data-label="Domingo/feriado"><strong>${soma(c.domingo)}</strong></td></tr>
        </tbody></table></div>
      <label class="campo campo-extra"><span>Feriado e véspera: pessoas a mais na cozinha (ideal)</span>${num('feriadoExtra', c.feriadoExtra || 0)}</label>
      <p class="nota">Sexta e sábado todos trabalham: o site pede freelancer para cobrir quem estiver de férias ou afastado.
        Quem tem mais de uma função cobre a vaga que estiver aberta.</p>`;

  return `
    <section class="cabeca"><div><h1>Ajustes</h1><p>Feriados, equipe mínima e dados</p></div></section>

    <div class="painel">
      <div class="painel-topo"><h2>Feriados</h2>
        <button class="btn btn-principal" data-acao="novo-feriado">+ Adicionar feriado</button></div>
      <div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Data</th><th>Feriado</th><th>Tipo</th><th>Lojas</th><th></th></tr></thead>
        <tbody>${feriados.map(h => `<tr>
          <td data-label="Data"><strong>${br(h.data)}</strong> ${SEMANA_CURTA[diaSemana(h.data)]}</td>
          <td data-label="Feriado">${esc(h.nome)}</td>
          <td data-label="Tipo">${esc(h.tipo)}</td>
          <td data-label="Lojas">${h.lojas.length ? h.lojas.map(esc).join(', ') : 'Todas'}</td>
          <td class="acoes"><button class="btn btn-claro" data-acao="editar-feriado" data-id="${h.id}">Editar</button></td>
        </tr>`).join('')}</tbody></table></div>
    </div>

    <div class="painel">
      <div class="painel-topo"><h2>Equipe mínima</h2><div class="filtros">${seletorLoja(UI.loja, 'loja')}</div></div>
      ${equipe}
    </div>

    <div class="painel">
      <div class="painel-topo"><h2>Ponto</h2></div>
      <div class="filtros">
        <label class="campo"><span>Verde: atraso de até (min)</span><input type="number" min="0" max="120" value="${DB.pontoConfig.verde}" data-ponto="verde"></label>
        <label class="campo"><span>Amarelo: atraso de até (min)</span><input type="number" min="0" max="240" value="${DB.pontoConfig.amarelo}" data-ponto="amarelo"></label>
        <label class="btn btn-claro btn-mini">Importar arquivo do ponto (manual)<input type="file" accept=".json,.csv,.txt" data-arquivo="ponto" hidden></label>
        <label class="campo"><span>Hora extra: chegou mais de (min) antes</span><input type="number" min="0" max="120" value="${DB.pontoConfig.chegadaCedo}" data-ponto="chegadaCedo"></label>
      </div>
      <p class="nota">Acima do amarelo fica vermelho. Hora extra é o que a pessoa trabalha depois da meia-noite (quem sai depois da meia-noite, como o motoboy às 00:30, só conta depois do horário de saída) mais o tempo que chegou antes da entrada, quando passa da tolerância.</p>
    </div>

    <div class="painel">
      <div class="painel-topo"><h2>Dados</h2></div>
      <p class="nota">Os dados ficam salvos neste navegador. Faça um backup de vez em quando e use-o para levar os dados a outro computador.</p>
      <div class="botoes">
        <button class="btn btn-claro" data-acao="exportar">Baixar backup</button>
        <label class="btn btn-claro">Restaurar backup<input type="file" accept=".json" data-arquivo="backup" hidden></label>
      </div>
      <h3>Importar funcionários de planilha (opcional)</h3>
      <p class="nota">Para trazer a Base de Equipes de uma vez: salve a planilha como CSV com as colunas do modelo.</p>
      <div class="botoes">
        <button class="btn btn-claro" data-acao="modelo-csv">Baixar modelo</button>
        <label class="btn btn-claro">Importar CSV<input type="file" accept=".csv,.txt" data-arquivo="csv" hidden></label>
      </div>
    </div>`;
}

function formFeriado(h) {
  const novo = !h;
  h = h || { data: '', nome: '', tipo: 'Nacional', lojas: [] };
  abrirModal(novo ? 'Novo feriado' : 'Editar feriado', `
    <div class="grade-2">
      <label class="campo"><span>Data *</span><input type="date" name="data" required value="${h.data}"></label>
      <label class="campo"><span>Tipo</span><select name="tipo">${opcoes(TIPOS_FERIADO, h.tipo)}</select></label>
    </div>
    <label class="campo campo-largo"><span>Nome *</span><input name="nome" required value="${esc(h.nome)}"></label>
    <fieldset class="campo"><legend>Lojas <small>(nenhuma marcada = todas)</small></legend>
      <div class="radios">${LOJAS_ESCALA.map(l => `<label><input type="checkbox" name="lojas" value="${esc(l)}" ${h.lojas.includes(l) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    </fieldset>
    ${novo ? '' : '<button type="button" class="btn btn-perigo" data-acao="excluir-feriado">Excluir feriado</button>'}
  `, dados => {
    const reg = { data: dados.get('data'), nome: dados.get('nome').trim(), tipo: dados.get('tipo'), lojas: dados.getAll('lojas') };
    if (novo) DB.feriados.push({ id: novoId(), ...reg });
    else Object.assign(h, reg);
    salvar();
  }, form => {
    const excluir = form.querySelector('[data-acao=excluir-feriado]');
    if (excluir) excluir.addEventListener('click', () => {
      DB.feriados = DB.feriados.filter(x => x !== h);
      salvar();
      fecharModal();
      render();
    });
  });
}

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function lerArquivo(input, tipo) {
  const arq = input.files[0];
  if (!arq) return;
  arq.text().then(texto => {
    if (tipo === 'backup') {
      try {
        const d = JSON.parse(texto);
        if (d.versao !== 1 || !Array.isArray(d.funcionarios)) throw new Error();
        if (!confirm('Restaurar este backup? Os dados atuais serão substituídos.')) return;
        DB = completar(d);
        salvar();
        render();
      } catch (e) {
        alert('Arquivo de backup inválido.');
      }
    } else if (tipo === 'ponto') {
      let res;
      try {
        if (texto.trim().startsWith('{')) res = importarPonto(texto);
        else {
          const lido = lerCsvPonto(texto);
          res = { dias: gravarBatidas(lido.batidas), erros: lido.erros };
        }
      } catch (e) {
        alert('Arquivo de ponto inválido.');
        return;
      }
      alert(`${res.dias} dia(s) de batidas importados.` + (res.erros.length ? '\n\n' + res.erros.join('\n') : ''));
      render();
    } else {
      const { funcionarios, erros } = lerCsv(texto);
      const msg = `${funcionarios.length} funcionário(s) encontrado(s).` + (erros.length ? '\n\nAtenção:\n' + erros.join('\n') : '') + '\n\nImportar?';
      if (!funcionarios.length || !confirm(msg)) { if (!funcionarios.length) alert(erros.join('\n') || 'Nada para importar.'); return; }
      DB.funcionarios.push(...funcionarios);
      salvar();
      UI.tela = 'funcionarios';
      render();
    }
  }).finally(() => { input.value = ''; });
}

// ---------- Modal ----------

function abrirModal(titulo, corpo, aoSalvar, preparar, textoBotao = 'Salvar') {
  const modal = document.getElementById('modal');
  modal.innerHTML = `<form class="modal-caixa" novalidate>
      <div class="modal-topo"><h2>${esc(titulo)}</h2><button type="button" class="fechar" data-acao="fechar-modal" aria-label="Fechar">×</button></div>
      <div class="modal-corpo">${corpo}</div>
      <div class="modal-rodape">
        <button type="button" class="btn btn-claro" data-acao="fechar-modal">Cancelar</button>
        <button type="submit" class="btn btn-principal">${esc(textoBotao)}</button>
      </div></form>`;
  modal.hidden = false;
  document.body.classList.add('com-modal');
  const form = modal.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (aoSalvar(new FormData(form), form) === false) return;
    fecharModal();
    render();
  });
  if (preparar) preparar(form);
  const primeiro = form.querySelector('input:not([type=hidden]), select');
  if (primeiro && window.innerWidth > 700) primeiro.focus();
}

function fecharModal() {
  const modal = document.getElementById('modal');
  modal.hidden = true;
  modal.innerHTML = '';
  document.body.classList.remove('com-modal');
}

// ---------- Eventos ----------

const ACOES = {
  'tela': id => { UI.tela = id; document.body.classList.remove('menu-aberto'); window.scrollTo(0, 0); },
  'menu': () => document.body.classList.toggle('menu-aberto'),
  'tema': () => {
    const escuro = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('rh-tema', escuro ? 'escuro' : 'claro'); } catch (e) { /* ignora */ }
  },
  'filtro-loja': id => { UI.filtroLoja = UI.filtroLoja === id ? '' : id; },
  'novo-func': () => formFuncionario(),
  'editar-func': id => formFuncionario(funcionario(id)),
  'desligar': id => formDesligar(funcionario(id)),
  'mes': (id, el) => { UI.mes = addMeses(UI.mes, Number(el.dataset.n)); },
  'dia': (id, el) => { UI.dia = addDias(UI.dia, Number(el.dataset.n)); },
  'novo-freela': (id, el) => formFreela(id, el.dataset.dia),
  'remover-freela': id => {
    const x = DB.freelas.find(f => f.id === id);
    if (!x || !confirm(`Remover o freelancer ${x.nome} (${x.funcao}) de ${br(x.data)}?`)) return;
    DB.freelas = DB.freelas.filter(f => f !== x);
    salvar();
  },
  'troca-domingo': (id, el) => alternarFolgaDomingo(UI.loja, el.dataset.dia, id),
  'gerar-domingos': () => {
    const temQuadro = domingosDoMes(UI.mes).some(d => (DB.domingos[UI.loja] || {})[d]);
    if (temQuadro && !confirm('Já existe quadro de domingos neste mês. Substituir pela sugestão automática?')) return;
    gerarDomingos(UI.loja, UI.mes);
  },
  'proximos-meses': () => {
    if (!confirm(`Montar os domingos de ${nomeMes(mesSeguinte(UI.mes))} em diante (6 meses), em todas as lojas?

Só preenche os meses que ainda estão vazios; o que já foi montado não muda.`)) return;
    const n = preencherProximosMeses(LOJAS_ESCALA, UI.mes, 6);
    alert(n ? `Pronto: ${n} mês(es) de loja montados. Confira cada um em Folgas semanais.` : 'Nada para preencher: os próximos meses já estão montados.');
  },
  'atualizar-ponto': (id, el) => atualizarPontoAgora(el),
  'imprimir': () => window.print(),
  'imprimir-loja': id => {
    UI.imprimeLoja = id; render();
    window.print();
    UI.imprimeLoja = null; render();
  },
  'escala-modo': id => { UI.escalaModo = id; },
  'ponto-modo': id => { UI.pontoModo = id; },
  'cadastrar-todos-ponto': () => {
    const n = pessoasSemVinculo().filter(lojaDaPessoa).length;
    if (!confirm(`Cadastrar ${n} funcionário(s) do Ponto System?\n\nNome, loja, cargo, turno e horários já vêm do ponto. Depois complete sexo e folga de cada um.`)) return;
    cadastrarDoPonto();
    UI.tela = 'funcionarios';
    UI.filtroLoja = '';
  },
  'cadastrar-do-ponto': id => {
    const p = DB.pontoPessoas.find(x => x.codigo === id);
    const { id: _, ...inicial } = funcionarioDoPonto(p, lojaDaPessoa(p) || UI.loja);
    formFuncionario(null, inicial);
  },
  'nova-ferias': id => formFerias(null, id),
  'editar-ferias': id => formFerias(DB.ferias.find(r => r.id === id)),
  'novo-feriado': () => formFeriado(),
  'editar-feriado': id => formFeriado(DB.feriados.find(h => h.id === id)),
  'exportar': () => baixar(`rh-backup-${hoje()}.json`, JSON.stringify(DB, null, 2), 'application/json'),
  'modelo-csv': () => baixar('modelo-funcionarios.csv', '\uFEFF' + modeloCsv(), 'text/csv'),
  'lembrete-ok': () => { DB.lembretesVistos[hoje().slice(0, 7)] = true; salvar(); },
  'fechar-modal': () => fecharModal(),
};
// Ações que só mexem dentro do modal não redesenham a tela
const SEM_RENDER = new Set(['novo-func', 'editar-func', 'cadastrar-do-ponto', 'desligar', 'novo-freela', 'nova-ferias', 'editar-ferias',
  'novo-feriado', 'editar-feriado', 'exportar', 'modelo-csv', 'imprimir', 'imprimir-loja', 'fechar-modal', 'menu', 'tema']);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-acao]');
  if (!el || !ACOES[el.dataset.acao]) return;
  const acao = el.dataset.acao;
  if (acao.startsWith('excluir-')) return; // tratado dentro do formulário
  ACOES[acao](el.dataset.id, el);
  if (!SEM_RENDER.has(acao)) render();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.arquivo) { lerArquivo(el, el.dataset.arquivo); return; }
  if (el.dataset.ponto) {
    DB.pontoConfig[el.dataset.ponto] = Math.max(0, Number(el.value) || 0);
    salvar();
    render();
    return;
  }
  if (el.dataset.equipe) {
    const cfg = DB.equipeMinima[el.dataset.equipe];
    const valor = el.type === 'checkbox' ? el.checked : Math.max(0, Number(el.value) || 0);
    // 'semana.montador' grava em cfg.semana.montador
    const [grupo, funcao] = el.dataset.campo.split('.');
    if (funcao) cfg[grupo][funcao] = valor;
    else cfg[grupo] = valor;
    salvar();
    render();
    return;
  }
  const muda = el.dataset.muda;
  if (!muda || !el.value && muda !== 'filtro-loja' && muda !== 'filtro-situacao') return;
  if (muda === 'loja') UI.loja = el.value;
  if (muda === 'mes') UI.mes = el.value;
  if (muda === 'dia') UI.dia = el.value;
  if (muda === 'ponto-de' && el.value) UI.pontoDe = el.value;
  if (muda === 'ponto-ate' && el.value) UI.pontoAte = el.value;
  if (muda === 'filtro-loja') UI.filtroLoja = el.value;
  if (muda === 'filtro-situacao') UI.filtroSituacao = el.value;
  render();
});

document.addEventListener('input', e => {
  if (e.target.dataset.digita !== 'busca') return;
  UI.busca = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const campo = document.querySelector('[data-digita=busca]');
  campo.focus();
  campo.setSelectionRange(pos, pos);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('modal').hidden) fecharModal();
});

// Mostra a cópia deste computador e em seguida liga ao servidor (dados de todos + ponto do dia)
render();
iniciarNuvem();
