// Ponto: batidas, pontualidade e hora extra.
// Horários ficam em minutos desde 00:00 do dia de trabalho; a saída depois da
// meia-noite passa de 1440 (ex.: 00:30 do dia seguinte = 1470).

// Batida antes deste horário pertence à jornada do dia anterior (fechamento da noite)
const VIRADA_NOITE = 6 * 60;
const MEIA_NOITE = 24 * 60;

function minutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function relogio(min) {
  const m = ((min % MEIA_NOITE) + MEIA_NOITE) % MEIA_NOITE;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// 0 → '0h', 95 → '1h35'
function horas(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

function batidasDe(funcId, data) {
  return (DB.batidas[funcId] || {})[data] || [];
}

// Cor da pontualidade: verde no horário, amarelo atrasado, vermelho muito atrasado
function corAtraso(atraso) {
  const { verde, amarelo } = DB.pontoConfig;
  if (atraso <= verde) return 'verde';
  if (atraso <= amarelo) return 'amarelo';
  return 'vermelho';
}

// Resultado de um dia: { batidas, chegada, atraso, cor, trabalhado, extra, incompleto }
// ou, sem batidas, { motivo } (folga, férias...) ou null.
function pontoDia(f, data) {
  const b = batidasDe(f.id, data);
  const st = statusDia(f, data);
  if (!b.length) return st && !st.trabalha ? { motivo: st.motivo } : null;
  const entrada = minutos(f.entrada);
  const atraso = entrada === null ? null : Math.max(0, b[0] - entrada);
  // Hora extra começa na meia-noite, ou no horário de saída se ele for depois (ex.: motoboy sai 00:30)
  const saida = minutos(f.horaSaida);
  const limite = saida !== null && entrada !== null && saida < entrada ? saida + MEIA_NOITE : MEIA_NOITE;
  let trabalhado = 0, extraDepois = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    trabalhado += b[i + 1] - b[i];
    extraDepois += Math.max(0, b[i + 1] - Math.max(b[i], limite));
  }
  // Chegou mais cedo que a tolerância: todo o tempo antes da entrada conta como extra
  const cedo = entrada === null ? 0 : Math.max(0, entrada - b[0]);
  const extraAntes = cedo > DB.pontoConfig.chegadaCedo ? cedo : 0;
  return {
    batidas: b, chegada: b[0], atraso, cor: atraso === null ? '' : corAtraso(atraso),
    trabalhado, extra: extraAntes + extraDepois, extraAntes, extraDepois, incompleto: b.length % 2 === 1,
    naFolga: !!st && !st.trabalha && st.motivo !== 'férias',
  };
}

// Funcionários da loja com o resultado de cada dia do período e os totais
function relatorioPonto(loja, dias) {
  return DB.funcionarios
    .filter(f => f.loja === loja && dias.some(d => ativoEm(f, d)))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(f => {
      const r = { f, dias: {}, verde: 0, amarelo: 0, vermelho: 0, trabalhado: 0, extra: 0, atrasoTotal: 0, extraSemana: Array(7).fill(0) };
      dias.forEach(d => {
        const p = ativoEm(f, d) ? pontoDia(f, d) : null;
        r.dias[d] = p;
        if (!p || !p.batidas) return;
        if (p.cor) r[p.cor]++;
        r.atrasoTotal += p.atraso || 0;
        r.trabalhado += p.trabalhado;
        r.extra += p.extra;
        r.extraSemana[diaSemana(d)] += p.extra;
      });
      return r;
    });
}

// Grava batidas ({ funcId, data: dia de trabalho, min }) agrupando por jornada.
// Os dias recebidos substituem o que já havia gravado para eles.
function gravarBatidas(lista) {
  const novos = {};
  lista.forEach(({ funcId, data, min }) => {
    ((novos[funcId] = novos[funcId] || {})[data] = novos[funcId][data] || []).push(min);
  });
  let dias = 0;
  Object.entries(novos).forEach(([funcId, porDia]) => {
    const atual = DB.batidas[funcId] = DB.batidas[funcId] || {};
    Object.entries(porDia).forEach(([data, b]) => { atual[data] = [...new Set(b)].sort((x, y) => x - y); dias++; });
  });
  salvar();
  return dias;
}

// Acha o funcionário pelo código do sistema de ponto ou, sem código, pelo nome
function acharFuncionario(codigo, nome) {
  const c = semAcento(codigo);
  if (c) {
    const f = DB.funcionarios.find(x => semAcento(x.codigoPonto) === c);
    if (f) return f;
  }
  const n = semAcento(nome);
  return n ? DB.funcionarios.find(x => semAcento(x.nome) === n) : undefined;
}

// Planilha exportada do sistema de ponto. Aceita dois formatos:
//  - uma batida por linha: codigo/nome; data; hora  (ou data e hora juntas)
//  - um dia por linha: codigo/nome; data; entrada; saida; entrada 2; saida 2...
// Retorna { batidas, erros }
function lerCsvPonto(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return { batidas: [], erros: ['Arquivo vazio.'] };
  const sep = linhas[0].includes(';') ? ';' : ',';
  const cab = linhas[0].split(sep).map(semAcento);
  const col = (...nomes) => cab.findIndex(c => nomes.includes(c));
  const iCodigo = col('codigo', 'matricula', 'pis', 'cpf', 'id');
  const iNome = col('nome', 'funcionario', 'colaborador');
  const iData = col('data', 'dia', 'data/hora', 'datahora', 'data hora');
  const iHora = col('hora', 'horario');
  const iMarcas = cab.map((c, i) => (/^(entrada|saida|batida|marcacao)/.test(c) ? i : -1)).filter(i => i >= 0);
  if (iData < 0 || (iCodigo < 0 && iNome < 0)) {
    return { batidas: [], erros: ['O cabeçalho precisa ter "data" e "nome" (ou "codigo").'] };
  }

  const batidas = [];
  const naoAchados = new Set();
  linhas.slice(1).forEach(linha => {
    const c = linha.split(sep).map(x => x.trim().replace(/^"|"$/g, ''));
    const f = acharFuncionario(c[iCodigo], c[iNome]);
    if (!f) { naoAchados.add(c[iNome] || c[iCodigo]); return; }
    const [dataTxt, horaJunto] = (c[iData] || '').split(/\s+/);
    const data = lerData(dataTxt);
    if (!data) return;
    const umaPorLinha = iHora >= 0 || !!horaJunto;
    const horarios = (iHora >= 0 ? [c[iHora]] : horaJunto ? [horaJunto] : iMarcas.map(i => c[i]))
      .map(minutos).filter(m => m !== null);
    let anterior = -1;
    horarios.forEach(min => {
      let d = data;
      if (umaPorLinha) {
        // Batida da madrugada fecha a jornada do dia anterior
        if (min < VIRADA_NOITE) { d = addDias(data, -1); min += MEIA_NOITE; }
      } else if (min < anterior) {
        // Num dia por linha, a saída depois da meia-noite vem com hora menor
        min += MEIA_NOITE;
      }
      anterior = min;
      batidas.push({ funcId: f.id, data: d, min });
    });
  });
  const erros = naoAchados.size ? [`Não encontrados no cadastro: ${[...naoAchados].join(', ')}. Confira o nome ou o vínculo com o ponto no cadastro.`] : [];
  return { batidas, erros };
}

// Arquivo gerado pela sincronização com o Ponto System (ferramentas/sincronizar-ponto.js),
// em texto ou já lido. Guarda a lista de pessoas do ponto e retorna { batidas, erros }.
function lerJsonPonto(texto) {
  const j = typeof texto === 'string' ? JSON.parse(texto) : texto;
  if (j.fonte !== 'pontosystem' || !Array.isArray(j.batidas)) throw new Error('formato');
  ultimoPonto = j;
  DB.pontoPessoas = j.pessoas;
  DB.fichasSemPonto = j.fichasSemPonto || [];
  // Quem está vinculado e ainda não tem horário no RH recebe o horário do ponto
  j.pessoas.forEach(p => {
    const f = acharFuncionario(p.codigo, p.nome);
    if (f && !f.entrada && p.entrada) f.entrada = p.entrada;
    if (f && !f.horaSaida && p.saida) f.horaSaida = p.saida;
  });
  const batidas = [];
  const naoAchados = new Set();
  j.batidas.forEach(x => {
    const f = acharFuncionario(x.codigo, x.nome);
    if (!f) { naoAchados.add(x.nome); return; }
    batidas.push({ funcId: f.id, data: x.data, min: x.min });
  });
  const erros = naoAchados.size ? [`${naoAchados.size} pessoa(s) do ponto ainda sem cadastro no RH. Clique em "Cadastrar todos" na tela Funcionários.`] : [];
  return { batidas, erros };
}

// Último arquivo do ponto lido nesta sessão: depois de cadastrar gente nova, as batidas entram de novo
let ultimoPonto = null;

// Grava o arquivo do ponto; retorna { dias, erros }
function importarPonto(j) {
  const lido = lerJsonPonto(j);
  const dias = gravarBatidas(lido.batidas);
  DB.pontoImportado = ultimoPonto.geradoEm;
  salvar();
  return { dias, erros: lido.erros };
}

// Relógios do ponto que não têm o nome da loja
const RELOGIOS = { camelao: 'Palhoça' };

// "BIGUACÚ  7" → 'Biguaçu'
function lojaDoRelogio(nome) {
  const n = semAcento(nome).replace(/\d+/g, '').trim();
  return RELOGIOS[n] || acharOpcao(n, LOJAS);
}

// Loja da pessoa: pela ficha do RH, pelo relógio onde bate ponto ou, sem batidas, pelo horário/cargo no ponto
function lojaDaPessoa(p) {
  if (p.rh && p.rh.loja) return p.rh.loja;
  const pelaBatida = p.local ? lojaDoRelogio(p.local) : '';
  if (pelaBatida) return pelaBatida;
  if (/produ/i.test(semAcento(p.horario))) return 'Produção';
  if (/comercial|adm|financ|comprador|supervisor/.test(semAcento(p.horario + ' ' + p.cargo))) return 'Administrativo';
  return '';
}

// Cargo do ponto ("MONTADOR(A) DE LANCHES") → cargo do RH
const CARGOS_PONTO = [
  [/montador/, 'montador'], [/prensador/, 'prensador'], [/auxiliar de cozinha/, 'auxiliar de cozinha'],
  [/motoboy/, 'motoboy'], [/caixa/, 'caixa de loja'], [/encarregado de cozinha/, 'cozinheiro gerente'],
  [/cozinheiro/, 'cozinheiro'], [/^gerente/, 'gerente de loja'], [/supervisor/, 'supervisor geral'],
  [/servicos gerais/, 'auxiliar de serviços gerais'],
  [/aux\.? administrativo|auxiliar administrativo/, 'auxiliar administrativo'], [/assistente adm/, 'assistente administrativo'],
];
function cargoDoPonto(cargo) {
  const c = semAcento(cargo);
  const achado = CARGOS_PONTO.find(([re]) => re.test(c));
  return achado ? achado[1] : '';
}

// Funções que a pessoa exerce pelo cargo da carteira
function funcoesDoCargo(cargo) {
  if (FUNCOES_ESCALA.includes(cargo)) return [cargo];
  return cargo === 'caixa de loja' ? ['salão'] : [];
}

// Funcionário do RH montado com o que o ponto (e a ficha do RH, se houver) já sabe
function funcionarioDoPonto(p, loja) {
  const rh = p.rh || {};
  const cargo = rh.cargo || cargoDoPonto(p.cargo);
  const entrada = p.entrada || '';
  return {
    id: novoId(), nome: nomeProprio(p.nome), loja: loja || lojaDaPessoa(p) || LOJAS[0], cargo, sexo: rh.sexo || '',
    funcoes: rh.funcoes || funcoesDoCargo(cargo),
    turno: entrada ? (entrada < '14:00' ? 'Dia' : 'Noite') : '', entrada, horaSaida: p.saida || '',
    codigoPonto: p.codigo, folgas: rh.folgas || [], inicio: rh.inicio || '', situacao: 'Ativo', saida: '', alternaDomingos: false, obs: '',
  };
}

// "ANA PAULA DE SOUZA" → "Ana Paula de Souza"
function nomeProprio(nome) {
  return nome.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/(^|\s)(\S)/g, (m, esp, l) => esp + l.toUpperCase())
    .replace(/ (Da|De|Do|Das|Dos|E) /g, m => m.toLowerCase());
}

// Cadastra de uma vez quem está no ponto e tem loja conhecida; as batidas deles entram em seguida
function cadastrarDoPonto() {
  const novos = pessoasSemVinculo().filter(lojaDaPessoa).map(p => funcionarioDoPonto(p));
  DB.funcionarios.push(...novos);
  aplicarAjustesPonto();
  if (ultimoPonto) importarPonto(ultimoPonto);
  salvar();
  return novos.length;
}

// Junta ao cadastro o que veio da ficha do RH (p.rh: loja, sexo, admissão, cargo, funções, folgas).
// Cada ficha é aplicada de novo só quando muda, para não desfazer o que foi editado no site.
// Retorna true se mudou algo no cadastro.
function aplicarAjustesPonto() {
  const pessoas = DB.pontoPessoas || [];
  let mudou = false;

  // Ficha com "unirCom": a pessoa do ponto é alguém já cadastrado com outro nome (ex.: um apelido).
  // Vincula os dois e apaga o cadastro repetido, se "Cadastrar todos" já tiver criado.
  pessoas.filter(p => p.rh && p.rh.unirCom).forEach(p => {
    const antigo = DB.funcionarios.find(f => f.nome === p.rh.unirCom && !f.codigoPonto);
    if (!antigo) return;
    const repetido = DB.funcionarios.find(f => f.codigoPonto === p.codigo);
    const base = repetido || funcionarioDoPonto(p);
    ['cargo', 'turno', 'entrada', 'horaSaida'].forEach(k => { if (!antigo[k]) antigo[k] = base[k]; });
    antigo.codigoPonto = p.codigo;
    if (repetido) {
      DB.batidas[antigo.id] = { ...DB.batidas[repetido.id], ...DB.batidas[antigo.id] };
      delete DB.batidas[repetido.id];
      DB.funcionarios = DB.funcionarios.filter(f => f !== repetido);
    }
    mudou = true;
  });

  DB.fichasAplicadas = DB.fichasAplicadas || {};
  pessoas.filter(p => p.rh).forEach(p => {
    const assinatura = JSON.stringify(p.rh);
    if (DB.fichasAplicadas[p.codigo] === assinatura) return;
    let f = acharFuncionario(p.codigo, p.nome);
    if (!f) {
      if (!p.rh.loja) return;
      DB.funcionarios.push(f = funcionarioDoPonto(p));
    }
    ['loja', 'sexo', 'inicio', 'cargo', 'funcoes', 'folgas'].forEach(k => { if (p.rh[k]) f[k] = p.rh[k]; });
    if (!f.funcoes.length) f.funcoes = funcoesDoCargo(f.cargo);
    folgasDeDomingo(f, p.rh.domingos);
    DB.fichasAplicadas[p.codigo] = assinatura;
    mudou = true;
  });

  // Da ficha, mas sem cadastro no ponto: entra uma vez, sem vínculo
  (DB.fichasSemPonto || []).forEach(rh => {
    const chave = 'nome:' + rh.nome;
    // Nome corrigido na ficha: renomeia o cadastro antigo em vez de criar outro
    const antigo = rh.unirCom && acharFuncionario('', rh.unirCom);
    if (antigo && !acharFuncionario('', rh.nome)) { antigo.nome = nomeProprio(rh.nome); mudou = true; }
    const existente = acharFuncionario('', rh.nome);
    const assinatura = JSON.stringify(rh.domingos || []);
    if (existente && rh.domingos && DB.fichasAplicadas['dom:' + rh.nome] !== assinatura) {
      folgasDeDomingo(existente, rh.domingos);
      DB.fichasAplicadas['dom:' + rh.nome] = assinatura;
      mudou = true;
    }
    if (DB.fichasAplicadas[chave] || existente) return;
    DB.funcionarios.push({
      id: novoId(), nome: nomeProprio(rh.nome), loja: rh.loja, cargo: rh.cargo || '', sexo: rh.sexo || '',
      funcoes: rh.funcoes || funcoesDoCargo(rh.cargo || ''), turno: '', entrada: '', horaSaida: '', codigoPonto: '',
      folgas: rh.folgas || [], inicio: rh.inicio || '', situacao: 'Ativo', saida: '', alternaDomingos: false, obs: '',
    });
    folgasDeDomingo(DB.funcionarios[DB.funcionarios.length - 1], rh.domingos);
    DB.fichasAplicadas[chave] = true;
    DB.fichasAplicadas['dom:' + rh.nome] = JSON.stringify(rh.domingos || []);
    mudou = true;
  });
  if (mudou) salvar();
  return mudou;
}

// Domingos de folga vindos do quadro (datas AAAA-MM-DD): marca a pessoa no quadro de domingos da loja
function folgasDeDomingo(f, datas) {
  (datas || []).forEach(d => {
    const quadro = DB.domingos[f.loja] = DB.domingos[f.loja] || {};
    const lista = quadro[d] = quadro[d] || [];
    if (!lista.includes(f.id)) lista.push(f.id);
  });
}

// Pessoas do sistema de ponto que ainda não estão vinculadas a ninguém do RH
function pessoasSemVinculo() {
  return (DB.pontoPessoas || []).filter(p => !(p.desligado && p.desligado <= hoje()) && !acharFuncionario(p.codigo, p.nome));
}
