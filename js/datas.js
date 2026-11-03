// Utilitários de data. Datas sempre como texto 'AAAA-MM-DD' (horário local).

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const SEMANA_CURTA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const SEMANA_LONGA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const pad = n => String(n).padStart(2, '0');

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(s) {
  const [a, m, d] = s.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function hoje() {
  return iso(new Date());
}

function addDias(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

// Soma anos mantendo o dia; 29/02 vira 28/02 em ano não bissexto.
function addAnos(s, n) {
  const d = parse(s);
  const r = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  if (r.getMonth() !== d.getMonth()) r.setDate(0);
  return iso(r);
}

function diffDias(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

function diaSemana(s) {
  return parse(s).getDay();
}

// 'AAAA-MM' -> lista de datas do mês
function diasDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const total = new Date(a, m, 0).getDate();
  const dias = [];
  for (let d = 1; d <= total; d++) dias.push(`${a}-${pad(m)}-${pad(d)}`);
  return dias;
}

function domingosDoMes(mes) {
  return diasDoMes(mes).filter(d => diaSemana(d) === 0);
}

function addMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function nomeMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

function br(s) {
  if (!s) return '';
  const [a, m, d] = s.split('-');
  return `${d}/${m}/${a}`;
}

function brCurta(s) {
  if (!s) return '';
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
}

// Aceita 'dd/mm/aaaa' ou 'aaaa-mm-dd'
function lerData(txt) {
  txt = (txt || '').trim();
  let m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? txt : '';
}
