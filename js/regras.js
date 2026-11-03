// Regras de escala, folgas de domingo e férias.

// ---------- Situação de cada pessoa em cada dia ----------

function ativoEm(f, data) {
  if (f.inicio && data < f.inicio) return false;
  if (f.situacao === 'Desligado' && (!f.saida || data > f.saida)) return false;
  return true;
}

function feriadoEm(data, loja) {
  return DB.feriados.find(h => h.data === data && (!h.lojas.length || h.lojas.includes(loja)));
}

function vesperaEm(data, loja) {
  return feriadoEm(addDias(data, 1), loja);
}

function feriasEm(funcId, data) {
  return DB.ferias.find(r => r.funcId === funcId && r.partes.some(p => p.inicio <= data && data <= p.fim));
}

function folgaDomingo(loja, data, funcId) {
  const lista = (DB.domingos[loja] || {})[data];
  return !!lista && lista.includes(funcId);
}

// null = não faz parte da equipe nesse dia
// { trabalha: true, substituto? } ou { trabalha: false, motivo }
function statusDia(f, data) {
  if (!ativoEm(f, data)) return null;
  const ferias = feriasEm(f.id, data);
  let substituto = '';
  if (ferias) {
    // Substituto que faz o mesmo esquema: a escala segue com o nome do titular
    if (!(ferias.mesmoEsquema && ferias.substituto)) return { trabalha: false, motivo: 'férias' };
    substituto = ferias.substituto;
  } else if (f.situacao === 'Afastado') {
    return { trabalha: false, motivo: 'afastamento' };
  } else if (f.situacao === 'Férias') {
    return { trabalha: false, motivo: 'férias' };
  }
  const dow = diaSemana(data);
  if (f.folgas.includes(SEMANA[dow])) return { trabalha: false, motivo: 'folga fixa' };
  if (dow === 0 && folgaDomingo(f.loja, data, f.id)) return { trabalha: false, motivo: 'domingo' };
  return { trabalha: true, substituto };
}

function equipeDaLoja(loja, mes) {
  const dias = diasDoMes(mes);
  return DB.funcionarios
    .filter(f => f.loja === loja && dias.some(d => ativoEm(f, d)))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Quem entra na escala: tem pelo menos uma função da equipe mínima
function entraNaEscala(f) {
  return f.funcoes.some(x => FUNCOES_ESCALA.includes(x));
}

function freelasDoDia(loja, data) {
  return DB.freelas.filter(x => x.loja === loja && x.data === data);
}

// ---------- Escala de um dia ----------

// Vagas do dia conforme a equipe mínima da loja. Feriado e véspera usam a composição
// de domingo e ganham vagas extras de "ideal" (sempre prever freelancer).
// Em sexta e sábado (todos trabalham) cada função pede o maior entre a equipe mínima
// e quantos normalmente estariam ali (quem está de férias/afastado precisa ser coberto).
function vagasDoDia(cfg, tipo, esperado) {
  const comp = tipo === 'domingo' || tipo === 'feriado' ? cfg.domingo : cfg.semana;
  const vagas = [];
  FUNCOES_ESCALA.forEach(fn => {
    const n = Math.max(comp[fn] || 0, (esperado && esperado[fn]) || 0);
    for (let i = 0; i < n; i++) vagas.push({ funcao: fn, ideal: false });
  });
  if (tipo === 'feriado') {
    for (let i = 0; i < (cfg.feriadoExtra || 0); i++) vagas.push({ funcao: 'auxiliar de cozinha', ideal: true });
  }
  return vagas;
}

// Encaixa pessoas nas vagas pelas funções que cada uma sabe fazer (emparelhamento máximo).
// Quem tem duas funções cobre a vaga que estiver em aberto. Vagas do mínimo vêm antes das de ideal.
function encaixar(pessoas, vagas) {
  const vagaDaPessoa = pessoas.map(() => -1);
  const pessoaDaVaga = vagas.map(() => -1);
  const tenta = (v, vistos) => {
    const fn = vagas[v].funcao;
    const candidatos = pessoas.map((p, i) => i)
      .filter(i => pessoas[i].funcoes.includes(fn))
      .sort((a, b) => pessoas[a].funcoes.indexOf(fn) - pessoas[b].funcoes.indexOf(fn));
    for (const i of candidatos) {
      if (vistos.has(i)) continue;
      vistos.add(i);
      if (vagaDaPessoa[i] < 0 || tenta(vagaDaPessoa[i], vistos)) {
        vagaDaPessoa[i] = v;
        pessoaDaVaga[v] = i;
        return true;
      }
    }
    return false;
  };
  vagas.forEach((_, v) => tenta(v, new Set()));
  return { vagaDaPessoa, pessoaDaVaga };
}

function escalaDia(loja, data) {
  const dow = diaSemana(data);
  const feriado = feriadoEm(data, loja);
  const vespera = !feriado && vesperaEm(data, loja);
  const cfg = DB.equipeMinima[loja];

  const trabalham = [], folgam = [], fora = [];
  for (const f of DB.funcionarios) {
    if (f.loja !== loja || !entraNaEscala(f)) continue;
    const st = statusDia(f, data);
    if (!st) continue;
    if (st.trabalha) trabalham.push({ f, nome: f.nome, funcoes: f.funcoes, substituto: st.substituto });
    else folgam.push({ f, motivo: st.motivo });
    // Sexta e sábado todos trabalham: quem está fora sem substituto precisa ser coberto
    if (!st.trabalha && (st.motivo === 'férias' || st.motivo === 'afastamento')) fora.push(f);
  }
  const marcados = freelasDoDia(loja, data);
  marcados.forEach(x => trabalham.push({ freela: x, nome: x.nome, funcoes: [x.funcao] }));

  let tipo = dow === 0 ? 'domingo' : dow >= 5 ? 'fimsemana' : 'semana';
  if (feriado || vespera) tipo = 'feriado';

  const r = { loja, data, dow, feriado, vespera, tipo, cozinha: [], salao: [], folgam,
    definida: cfg.definida, minimo: 0, ideal: 0, freelas: [], marcados, alerta: '', aviso: '' };

  let esperado = null;
  if (dow >= 5) {
    esperado = {};
    const principal = f => f.funcoes.find(x => FUNCOES_ESCALA.includes(x));
    [...trabalham.filter(p => p.f).map(p => p.f), ...fora].forEach(f => {
      esperado[principal(f)] = (esperado[principal(f)] || 0) + 1;
    });
  }
  const vagas = cfg.definida ? vagasDoDia(cfg, tipo, esperado) : [];
  const { vagaDaPessoa, pessoaDaVaga } = encaixar(trabalham, vagas);

  trabalham.forEach((p, i) => {
    const v = vagaDaPessoa[i];
    p.funcao = v >= 0 ? vagas[v].funcao : p.funcoes.find(x => FUNCOES_ESCALA.includes(x));
    (p.funcao === 'salão' ? r.salao : r.cozinha).push(p);
  });
  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  r.cozinha.sort(porNome); r.salao.sort(porNome); folgam.sort((a, b) => a.f.nome.localeCompare(b.f.nome, 'pt-BR'));

  if (!cfg.definida) return r;
  const daCozinha = vagas.filter(v => v.funcao !== 'salão');
  r.minimo = daCozinha.filter(v => !v.ideal).length;
  r.ideal = daCozinha.length;
  r.salaoMinimo = vagas.filter(v => v.funcao === 'salão').length;

  const abertas = vagas.filter((v, i) => pessoaDaVaga[i] < 0);
  r.freelas = abertas.map(v => v.funcao);
  const faltaMinimo = abertas.filter(v => !v.ideal);
  if (faltaMinimo.length) {
    r.alerta = `Faltam ${faltaMinimo.length} para fechar o mínimo`;
  } else if (abertas.length) {
    r.aviso = 'Prever freelancer (ideal)';
  }
  return r;
}

function escalaMes(loja, mes) {
  return diasDoMes(mes).map(d => escalaDia(loja, d));
}

// ---------- Domingos ----------

function alternaDomingos(f) {
  return f.sexo === 'M' || !!f.alternaDomingos;
}

// Situação no domingo considerando só a regra de domingo: 'folga' | 'trabalha' | 'fora' (férias etc.) | null (indefinido)
function situacaoDomingo(f, data) {
  const st = statusDia(f, data);
  if (!st) return null;
  // Folga fixa no domingo também tira a pessoa da regra de alternância
  if (!st.trabalha && st.motivo !== 'domingo') return 'fora';
  const lista = (DB.domingos[f.loja] || {})[data];
  if (!lista) return null;
  return lista.includes(f.id) ? 'folga' : 'trabalha';
}

function validarFolgas(loja, mes) {
  const avisos = [];
  const add = (nivel, texto) => avisos.push({ nivel, texto });
  const domingos = domingosDoMes(mes);
  const equipe = equipeDaLoja(loja, mes);
  const quadro = DB.domingos[loja] || {};

  equipe.forEach(f => {
    if (!f.folgas.length) add('erro', `${f.nome}: sem folga fixa cadastrada.`);
  });
  // Regras de domingo valem para quem entra na escala e não tem folga fixa no domingo
  const doDomingo = equipe.filter(f => entraNaEscala(f) && !f.folgas.includes('dom'));

  domingos.forEach(d => {
    if (!quadro[d]) add('aviso', `Domingo ${brCurta(d)}: quadro ainda não definido.`);
  });

  doDomingo.forEach(f => {
    if (alternaDomingos(f)) {
      // Inclui o último domingo do mês anterior para continuar a alternância
      const seq = [addDias(domingos[0], -7), ...domingos];
      for (let i = 1; i < seq.length; i++) {
        const a = situacaoDomingo(f, seq[i - 1]);
        const b = situacaoDomingo(f, seq[i]);
        if (a === 'trabalha' && b === 'trabalha') {
          add('erro', `${f.nome}: trabalha 2 domingos seguidos (${brCurta(seq[i - 1])} e ${brCurta(seq[i])}).`);
        } else if (a === 'folga' && b === 'folga') {
          add('aviso', `${f.nome}: folga 2 domingos seguidos (${brCurta(seq[i - 1])} e ${brCurta(seq[i])}) — deveria alternar.`);
        }
      }
    } else {
      const sits = domingos.map(d => situacaoDomingo(f, d));
      if (sits.includes('fora') || sits.includes(null)) return;
      const folgas = sits.filter(s => s === 'folga').length;
      if (folgas === 0) add('erro', `${f.nome}: nenhum domingo de folga no mês.`);
      if (folgas > 1) add('aviso', `${f.nome}: ${folgas} domingos de folga no mês (o normal é 1).`);
    }
  });

  domingos.forEach(d => {
    const homens = doDomingo.filter(f => f.sexo === 'H' && situacaoDomingo(f, d) === 'folga');
    if (homens.length > 1) {
      add('aviso', `Domingo ${brCurta(d)}: ${homens.length} homens de folga (${homens.map(f => f.nome).join(', ')}) — evitar.`);
    }
  });

  return avisos;
}

// Monta uma sugestão de folgas de domingo para o mês inteiro
function gerarDomingos(loja, mes) {
  const domingos = domingosDoMes(mes);
  const quadroAnterior = DB.domingos[loja] || {};
  const anterior = addDias(domingos[0], -7);
  const equipe = equipeDaLoja(loja, mes).filter(f => entraNaEscala(f) && !f.folgas.includes('dom'));
  const novo = {};
  domingos.forEach(d => { novo[d] = []; });

  const disponivel = (f, d) => {
    const st = statusDia(f, d);
    return st && (st.trabalha || st.motivo === 'domingo');
  };

  // Alternância: continua do último domingo do mês anterior
  equipe.filter(alternaDomingos).forEach((f, i) => {
    const listaAnt = quadroAnterior[anterior];
    let folgou = listaAnt ? listaAnt.includes(f.id) : i % 2 === 1;
    domingos.forEach(d => {
      const folga = !folgou;
      if (folga && disponivel(f, d)) novo[d].push(f.id);
      folgou = folga;
    });
  });

  // Homens: 1 domingo por mês, espalhando para não coincidir
  const homemNoDomingo = d => novo[d].filter(id => funcionario(id).sexo === 'H').length;
  // Salão tem 1 pessoa por dia: evita tirar dois do salão no mesmo domingo
  const doSalao = f => f.funcoes.includes('salão');
  const mesmoSetorNoDomingo = (f, d) => (doSalao(f) ? novo[d].filter(id => doSalao(funcionario(id))).length : 0);
  equipe.filter(f => !alternaDomingos(f)).forEach(f => {
    const opcoes = domingos.filter(d => disponivel(f, d));
    if (opcoes.length < domingos.length) return; // férias/afastamento em algum domingo
    opcoes.sort((a, b) => mesmoSetorNoDomingo(f, a) - mesmoSetorNoDomingo(f, b) ||
      homemNoDomingo(a) - homemNoDomingo(b) || novo[a].length - novo[b].length);
    if (opcoes.length) novo[opcoes[0]].push(f.id);
  });

  DB.domingos[loja] = { ...quadroAnterior, ...novo };
  salvar();
}

function alternarFolgaDomingo(loja, data, funcId) {
  if (!DB.domingos[loja]) DB.domingos[loja] = {};
  const lista = DB.domingos[loja][data] || [];
  DB.domingos[loja][data] = lista.includes(funcId) ? lista.filter(id => id !== funcId) : [...lista, funcId];
  salvar();
}

// ---------- Férias ----------

// Períodos aquisitivos até o que está em andamento hoje. Começa no período mais antigo ainda em aberto
// (feriasDesde, do relatório da contabilidade); sem ele, na admissão.
// Limite = último dia para começar 30 dias de férias dentro dos 12 meses seguintes (igual ao relatório).
function periodosAquisitivos(f, ate = hoje()) {
  const base = f.feriasDesde || f.inicio;
  if (!base) return [];
  const lista = [];
  for (let k = 0; ; k++) {
    const inicio = addAnos(base, k);
    if (inicio > ate && k > 0) break;
    lista.push({
      inicio,
      fim: addDias(addAnos(base, k + 1), -1),
      limite: addDias(addAnos(base, k + 2), -30),
    });
    if (k > 80) break;
  }
  return lista;
}

function feriasDoPeriodo(f, periodoInicio) {
  return DB.ferias.find(r => r.funcId === f.id && r.periodoInicio === periodoInicio);
}

function diasDeFerias(registro) {
  return registro.partes.reduce((s, p) => s + diffDias(p.inicio, p.fim) + 1, 0);
}

// Período que importa agora: o mais antigo já completo e não quitado; se não houver, o atual
function situacaoFerias(f) {
  const hj = hoje();
  const periodos = periodosAquisitivos(f, hj);
  const registros = DB.ferias.filter(r => r.funcId === f.id)
    .sort((a, b) => (a.partes[0]?.inicio || '').localeCompare(b.partes[0]?.inicio || ''));
  const proximo = registros.find(r => r.partes.some(p => p.fim >= hj)) || registros[registros.length - 1];

  if (!periodos.length) {
    return { f, periodo: null, registro: proximo, status: 'Sem data de início', nivel: 'cinza', limite: '9999' };
  }
  const pendente = periodos.find(p => p.fim < hj && !(feriasDoPeriodo(f, p.inicio) || {}).quitado);
  const periodo = pendente || periodos[periodos.length - 1];
  const registro = feriasDoPeriodo(f, periodo.inicio) || proximo;
  const faltam = diffDias(hj, periodo.limite);
  let status = 'Em dia', nivel = 'ok';
  if (pendente && faltam < 0) { status = 'Vencida'; nivel = 'erro'; }
  else if (pendente && faltam < 90) { status = 'Vence em menos de 90 dias'; nivel = 'aviso'; }
  return { f, periodo, registro, status, nivel, limite: periodo.limite, faltam, pendente: !!pendente };
}

// Avisos do formulário de férias (regras a confirmar com o contador)
function validarFerias(partes) {
  const erros = [], avisos = [];
  if (!partes.length) erros.push('Informe pelo menos um período de férias.');
  if (partes.length > 3) erros.push('As férias podem ser divididas em no máximo 3 partes.');
  partes.forEach((p, i) => {
    if (!p.inicio || !p.fim) erros.push(`Parte ${i + 1}: informe início e fim.`);
    else if (p.fim < p.inicio) erros.push(`Parte ${i + 1}: o fim é antes do início.`);
  });
  const ord = [...partes].filter(p => p.inicio && p.fim).sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < ord.length; i++) {
    if (ord[i].inicio <= ord[i - 1].fim) erros.push('Há partes de férias se sobrepondo.');
  }
  if (!erros.length && partes.length > 1) {
    const dias = partes.map(p => diffDias(p.inicio, p.fim) + 1);
    if (Math.max(...dias) < 14) avisos.push('Na divisão, uma das partes costuma ter no mínimo 14 dias.');
    if (Math.min(...dias) < 5) avisos.push('Na divisão, nenhuma parte costuma ter menos de 5 dias.');
  }
  return { erros, avisos };
}
