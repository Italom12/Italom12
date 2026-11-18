'use strict';
/* =========================================================
   Meta Driver — controle de metas e despesas para motoristas
   Todos os dados ficam salvos no próprio celular (localStorage).
   ========================================================= */

const DB_KEY = 'metadriver.v1';
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const EXPENSE_CATS = [
  { id: 'alimentacao', name: 'Alimentação', ico: '🍔' },
  { id: 'manutencao', name: 'Manutenção', ico: '🔧' },
  { id: 'lavagem', name: 'Lavagem', ico: '🧽' },
  { id: 'pedagio', name: 'Pedágio', ico: '🛣️' },
  { id: 'estacionamento', name: 'Estacionamento', ico: '🅿️' },
  { id: 'celular', name: 'Celular/Internet', ico: '📱' },
  { id: 'aluguel', name: 'Aluguel de carro', ico: '🚗' },
  { id: 'multa', name: 'Multa', ico: '🚨' },
  { id: 'agua', name: 'Água/Balas p/ passageiro', ico: '🥤' },
  { id: 'combustivel', name: 'Combustível (rápido)', ico: '⛽' },
  { id: 'outros', name: 'Outros', ico: '📦' }
];
const FUEL_TYPES = {
  gasolina: { name: 'Gasolina', unit: 'L', eff: 'km/L' },
  etanol: { name: 'Etanol', unit: 'L', eff: 'km/L' },
  diesel: { name: 'Diesel', unit: 'L', eff: 'km/L' },
  gnv: { name: 'GNV', unit: 'm³', eff: 'km/m³' },
  eletrico: { name: 'Recarga elétrica', unit: 'kWh', eff: 'km/kWh' }
};

/* ---------------- utilidades ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = v => BRL.format(isFinite(v) ? v : 0);
const num = (v, d = 1) => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const parseNum = v => {
  if (v == null) return 0;
  let s = String(v).trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};
const inputVal = n => (n ? String(Math.round(n * 100) / 100).replace('.', ',') : '');

// Datas sempre como 'AAAA-MM-DD' no horário local
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
const fmtDate = iso => { const d = fromISO(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const fmtDateLong = iso => { const d = fromISO(iso); return `${WEEKDAYS_LONG[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dueDateIn = (y, m, day) => { // trata meses curtos (ex.: dia 31 em fevereiro)
  const dt = new Date(y, m, 1, 12);
  return toISO(new Date(dt.getFullYear(), dt.getMonth(), Math.min(day, lastDayOfMonth(dt.getFullYear(), dt.getMonth())), 12));
};

/* ---------------- dados ---------------- */
function defaultData() {
  return {
    version: 1,
    setupDone: false,
    settings: {
      dueDay: 15,
      personalGoal: 0,
      workDays: [1, 2, 3, 4, 5, 6],
      vehicle: 'combustao',
      fuelDefault: 'gasolina',
      odometer: 0,
      platforms: ['Uber', '99', 'inDrive', 'Particular'],
      reservePerKm: 0
    },
    bills: [{ id: uid(), name: 'Financiamento do carro', amount: 2370, dueDay: 15 }],
    days: {},      // 'AAAA-MM-DD' -> { inc:{plataforma:valor}, tips, km, hours, trips, note }
    expenses: [],  // { id, date, cat, amount, note }
    fuel: [],      // { id, date, type, qty, total, odo, full, place }
    maint: [
      { id: uid(), name: 'Troca de óleo', everyKm: 10000, lastKm: 0 },
      { id: uid(), name: 'Rodízio/alinhamento', everyKm: 10000, lastKm: 0 },
      { id: uid(), name: 'Pastilhas de freio', everyKm: 30000, lastKm: 0 }
    ],
    daysOff: []
  };
}

let DB = load();
function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const def = defaultData();
      d.settings = Object.assign(def.settings, d.settings || {});
      ['bills', 'expenses', 'fuel', 'maint', 'daysOff'].forEach(k => { if (!Array.isArray(d[k])) d[k] = def[k]; });
      if (!d.days || typeof d.days !== 'object') d.days = {};
      return d;
    }
  } catch (e) { console.error(e); }
  return defaultData();
}
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  catch (e) { toast('Erro ao salvar: ' + e.message); }
}

/* ---------------- cálculos ---------------- */
function cycleFor(iso, dueDay) {
  const d = fromISO(iso);
  const y = d.getFullYear(), m = d.getMonth();
  const dueThis = dueDateIn(y, m, dueDay);
  let end, prevDue;
  if (iso <= dueThis) { end = dueThis; prevDue = dueDateIn(y, m - 1, dueDay); }
  else { end = dueDateIn(y, m + 1, dueDay); prevDue = dueThis; }
  return { start: addDays(prevDue, 1), end };
}
const currentCycle = () => cycleFor(todayISO(), DB.settings.dueDay);

function dayGross(day) {
  if (!day) return 0;
  let t = (+day.tips || 0);
  for (const k in (day.inc || {})) t += (+day.inc[k] || 0);
  return t;
}
const inRange = (iso, a, b) => iso >= a && iso <= b;

function periodStats(start, end) {
  const s = { gross: 0, exp: 0, fuel: 0, km: 0, hours: 0, trips: 0, workedDays: 0, byPlatform: {}, byCat: {}, daily: {} };
  for (const iso in DB.days) {
    if (!inRange(iso, start, end)) continue;
    const d = DB.days[iso];
    const g = dayGross(d);
    s.gross += g;
    s.km += +d.km || 0; s.hours += +d.hours || 0; s.trips += +d.trips || 0;
    if (g > 0) s.workedDays++;
    for (const p in (d.inc || {})) s.byPlatform[p] = (s.byPlatform[p] || 0) + (+d.inc[p] || 0);
    if (d.tips) s.byPlatform['Gorjetas/Bônus'] = (s.byPlatform['Gorjetas/Bônus'] || 0) + (+d.tips);
    (s.daily[iso] = s.daily[iso] || { gross: 0, exp: 0 }).gross += g;
  }
  for (const e of DB.expenses) {
    if (!inRange(e.date, start, end)) continue;
    s.exp += +e.amount || 0;
    s.byCat[e.cat] = (s.byCat[e.cat] || 0) + (+e.amount || 0);
    (s.daily[e.date] = s.daily[e.date] || { gross: 0, exp: 0 }).exp += +e.amount || 0;
  }
  for (const f of DB.fuel) {
    if (!inRange(f.date, start, end)) continue;
    s.fuel += +f.total || 0;
    const key = f.type === 'eletrico' ? 'energia' : 'combustivel';
    s.byCat[key] = (s.byCat[key] || 0) + (+f.total || 0);
    (s.daily[f.date] = s.daily[f.date] || { gross: 0, exp: 0 }).exp += +f.total || 0;
  }
  s.totalExp = s.exp + s.fuel;
  s.net = s.gross - s.totalExp;
  return s;
}

function isWorkDay(iso) {
  return DB.settings.workDays.includes(fromISO(iso).getDay()) && !DB.daysOff.includes(iso);
}
function workDaysBetween(a, b) {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkDay(d)) n++;
  return n;
}
const totalTarget = () => DB.bills.reduce((t, b) => t + (+b.amount || 0), 0) + (+DB.settings.personalGoal || 0);

function nextDue(dueDay, from = todayISO()) {
  const d = fromISO(from);
  let due = dueDateIn(d.getFullYear(), d.getMonth(), dueDay);
  if (due < from) due = dueDateIn(d.getFullYear(), d.getMonth() + 1, dueDay);
  return due;
}

function currentOdometer() {
  let o = +DB.settings.odometer || 0;
  for (const f of DB.fuel) o = Math.max(o, +f.odo || 0);
  return o;
}

/** Consumo pelo método tanque cheio → tanque cheio, separado por tipo de energia. */
function fuelAnalysis(type) {
  const list = DB.fuel.filter(f => (type ? f.type === type : true) && +f.odo > 0).sort((a, b) => a.odo - b.odo || a.date.localeCompare(b.date));
  const segments = [];
  let lastFull = null, accQty = 0, accCost = 0;
  for (const f of list) {
    if (lastFull) { accQty += +f.qty || 0; accCost += +f.total || 0; }
    if (f.full) {
      if (lastFull && accQty > 0 && f.odo > lastFull.odo) {
        const km = f.odo - lastFull.odo;
        segments.push({ km, qty: accQty, cost: accCost, eff: km / accQty, costKm: accCost / km, date: f.date });
      }
      lastFull = f; accQty = 0; accCost = 0;
    }
  }
  const km = segments.reduce((t, s) => t + s.km, 0);
  const qty = segments.reduce((t, s) => t + s.qty, 0);
  const cost = segments.reduce((t, s) => t + s.cost, 0);
  const all = DB.fuel.filter(f => (type ? f.type === type : true));
  const tq = all.reduce((t, f) => t + (+f.qty || 0), 0);
  const tc = all.reduce((t, f) => t + (+f.total || 0), 0);
  return {
    segments,
    avgEff: qty > 0 ? km / qty : 0,
    lastEff: segments.length ? segments[segments.length - 1].eff : 0,
    costKm: km > 0 ? cost / km : 0,
    avgPrice: tq > 0 ? tc / tq : 0,
    count: all.length
  };
}

/** Custo por km: usa o consumo medido; se não houver, estima pelos km lançados no período. */
function costPerKm() {
  const fa = fuelAnalysis();
  if (fa.costKm > 0) return fa.costKm;
  const c = currentCycle();
  const s = periodStats(c.start, c.end);
  return s.km > 0 ? s.fuel / s.km : 0;
}

/* ---------------- interface base ---------------- */
let currentTab = 'home';
let addDate = todayISO();
let reportPeriod = 'cycle';
let fuelFilter = '';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function openModal(title, html, onMount) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  if (onMount) onMount($('#modalBody'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

window.handleBack = function () {
  if (!$('#modal').classList.contains('hidden')) { closeModal(); return true; }
  if (currentTab !== 'home') { go('home'); return true; }
  return false;
};

function go(tab) {
  currentTab = tab;
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}
$$('.tabbar button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.tab === 'add') addDate = todayISO();
  go(b.dataset.tab);
}));

function render() {
  const c = currentCycle();
  $('#cycleChip').textContent = `Ciclo ${fmtDate(c.start)} → ${fmtDate(c.end)}`;
  const v = $('#view');
  ({ home: renderHome, add: renderAdd, fuel: renderFuel, reports: renderReports, more: renderMore }[currentTab])(v);
  if (!DB.setupDone && currentTab === 'home') setupWizard();
}

/* ================= INÍCIO ================= */
function renderHome(v) {
  const today = todayISO();
  const c = currentCycle();
  const s = periodStats(c.start, c.end);
  const target = totalTarget();
  const remaining = Math.max(0, target - s.net);
  const pct = target > 0 ? Math.min(100, Math.max(0, s.net / target * 100)) : 0;
  const daysLeft = daysBetween(today, c.end) + 1;
  const todayData = DB.days[today];
  const todayHasGross = dayGross(todayData) > 0;
  // dias de trabalho restantes: conta hoje se ainda não houver ganho lançado
  const startCount = todayHasGross ? addDays(today, 1) : today;
  const workLeft = workDaysBetween(startCount, c.end);
  const neededDay = workLeft > 0 ? remaining / workLeft : remaining;
  const totalDays = daysBetween(c.start, c.end) + 1;
  const elapsedPct = Math.min(100, (daysBetween(c.start, today) + 1) / totalDays * 100);
  const avgNet = s.workedDays > 0 ? s.net / s.workedDays : 0;
  const projection = s.net + avgNet * workLeft;
  // gastos "suavizados": combustível pelo custo/km (um tanque cheio não distorce a estimativa)
  const cpkEst = costPerKm();
  const smoothExp = cpkEst > 0 && s.km > 0 ? s.exp + s.km * cpkEst : s.totalExp;
  const expRatio = s.gross > 0 ? Math.min(0.8, smoothExp / s.gross) : 0.3;
  const grossNeededDay = neededDay / (1 - expRatio);

  // Hoje
  const tStats = periodStats(today, today);
  const todayGoal = todayHasGross ? (Math.max(0, target - (s.net - tStats.net)) / (workLeft + 1)) : neededDay;

  let status;
  if (s.net >= target) status = '<span class="pill ok">🎉 Meta batida!</span>';
  else if (s.workedDays === 0) status = '<span class="pill warn">Comece a lançar seus ganhos</span>';
  else if (projection >= target) status = '<span class="pill ok">✅ No ritmo</span>';
  else if (projection >= target * 0.85) status = '<span class="pill warn">⚠️ Um pouco abaixo</span>';
  else status = '<span class="pill bad">🔻 Abaixo do ritmo</span>';

  // contas (cascata por vencimento)
  const bills = DB.bills.map(b => ({ ...b, next: nextDue(b.dueDay) })).sort((a, b) => a.next.localeCompare(b.next));
  let pool = Math.max(0, s.net);
  const billRows = bills.map(b => {
    const covered = Math.min(pool, +b.amount || 0); pool -= covered;
    const dleft = daysBetween(today, b.next);
    const p = b.amount > 0 ? covered / b.amount * 100 : 0;
    const when = dleft === 0 ? '<b class="red">vence HOJE</b>' : dleft === 1 ? '<b class="orange">vence amanhã</b>' : `vence em ${dleft} dias (${fmtDate(b.next)})`;
    return `<div class="item" style="display:block">
      <div class="row between"><span class="t">${esc(b.name)}</span><span>${money(b.amount)}</span></div>
      <div class="s">${when} · coberto ${money(covered)}</div>
      <div class="bar"><div style="width:${p}%;background:${p >= 100 ? 'var(--green)' : 'var(--blue)'}"></div></div>
    </div>`;
  }).join('');

  // alertas
  const alerts = [];
  for (const b of bills) {
    const dl = daysBetween(today, b.next);
    if (dl <= 3) {
      const covered = s.net >= target;
      alerts.push(`<div class="alert ${covered ? 'green' : 'red'}">📅 <b>${esc(b.name)}</b> ${dl === 0 ? 'vence hoje' : `vence em ${dl} dia(s)`} — ${money(b.amount)}</div>`);
    }
  }
  const odo = currentOdometer();
  for (const m of DB.maint) {
    if (!m.everyKm || !odo || !m.lastKm) continue;
    const left = (+m.lastKm || 0) + (+m.everyKm) - odo;
    if (left <= 500) alerts.push(`<div class="alert">🔧 <b>${esc(m.name)}</b>: ${left <= 0 ? `atrasada ${num(-left, 0)} km` : `faltam ${num(left, 0)} km`}</div>`);
  }

  const cpk = cpkEst;
  v.innerHTML = `
    ${alerts.join('')}
    <div class="card hero">
      <div class="row between"><span class="muted">Meta do ciclo</span>${status}</div>
      <div class="big">${money(Math.max(0, s.net))} <span class="muted" style="font-size:16px">/ ${money(target)}</span></div>
      <div class="progress"><div style="width:${pct}%"></div><span class="marker" style="left:${elapsedPct}%"></span></div>
      <div class="row between small muted"><span>${num(pct, 0)}% da meta (lucro líquido)</span><span>│ = tempo decorrido ${num(elapsedPct, 0)}%</span></div>
      <hr>
      <div class="grid2">
        <div class="stat"><div class="lbl">Falta</div><div class="val ${remaining > 0 ? 'yellow' : 'green'}">${money(remaining)}</div></div>
        <div class="stat"><div class="lbl">Dias restantes</div><div class="val">${daysLeft} <span class="small muted">(${workLeft} de trabalho)</span></div></div>
        <div class="stat"><div class="lbl">Preciso por dia (líquido)</div><div class="val green">${money(neededDay)}</div></div>
        <div class="stat"><div class="lbl">≈ Faturar por dia (bruto)</div><div class="val">${money(grossNeededDay)}</div></div>
      </div>
      <div class="hint">Bruto estimado considerando que seus gastos (combustível pelo custo/km) têm consumido ${num(expRatio * 100, 0)}% do faturamento${s.gross > 0 ? '' : ' (estimativa padrão de 30%)'}.</div>
    </div>

    <div class="card">
      <h2>Hoje <small>${fmtDateLong(today)}</small></h2>
      <div class="grid3">
        <div class="stat"><div class="lbl">Faturei</div><div class="val">${money(tStats.gross)}</div></div>
        <div class="stat"><div class="lbl">Gastei</div><div class="val red">${money(tStats.totalExp)}</div></div>
        <div class="stat"><div class="lbl">Líquido</div><div class="val ${tStats.net >= 0 ? 'green' : 'red'}">${money(tStats.net)}</div></div>
      </div>
      ${todayGoal > 0 ? `<div class="progress" style="height:10px"><div style="width:${Math.min(100, Math.max(0, tStats.net / todayGoal * 100))}%"></div></div>
      <div class="small muted">${tStats.net >= todayGoal ? '✅ Meta de hoje alcançada!' : `Faltam ${money(todayGoal - tStats.net)} para a meta de hoje (${money(todayGoal)})`}</div>` : ''}
      ${isWorkDay(today) ? '' : '<div class="hint">Hoje está marcado como folga.</div>'}
      <button class="btn" onclick="addDate=todayISO();go('add')">➕ Lançar ganhos e gastos de hoje</button>
    </div>

    <div class="card">
      <h2>Resumo do ciclo</h2>
      <div class="grid2">
        <div class="stat"><div class="lbl">Faturamento bruto</div><div class="val">${money(s.gross)}</div></div>
        <div class="stat"><div class="lbl">Gastos totais</div><div class="val red">${money(s.totalExp)}</div></div>
        <div class="stat"><div class="lbl">Média líquida/dia</div><div class="val">${money(avgNet)}</div></div>
        <div class="stat"><div class="lbl">Projeção no fim</div><div class="val ${projection >= target ? 'green' : 'yellow'}">${money(projection)}</div></div>
        <div class="stat"><div class="lbl">Ganho por km</div><div class="val">${s.km ? money(s.gross / s.km) : '—'}</div></div>
        <div class="stat"><div class="lbl">Custo por km</div><div class="val">${cpk ? money(cpk) : '—'}</div></div>
        <div class="stat"><div class="lbl">Líquido por hora</div><div class="val">${s.hours ? money(s.net / s.hours) : '—'}</div></div>
        <div class="stat"><div class="lbl">Dias trabalhados</div><div class="val">${s.workedDays}</div></div>
      </div>
    </div>

    <div class="card list">
      <h2>Contas do ciclo <button class="btn sm sec" onclick="go('more');setTimeout(editBills,50)">Editar</button></h2>
      ${billRows || '<div class="empty">Nenhuma conta cadastrada.</div>'}
      ${DB.settings.personalGoal > 0 ? `<div class="item"><span class="t">Meta pessoal (para você)</span><span>${money(DB.settings.personalGoal)}</span></div>` : ''}
    </div>
  `;
}

/* ================= LANÇAR ================= */
function renderAdd(v) {
  const d = DB.days[addDate] || { inc: {}, tips: 0, km: 0, hours: 0, trips: 0, note: '' };
  const exps = DB.expenses.filter(e => e.date === addDate);
  const fuels = DB.fuel.filter(f => f.date === addDate);
  const st = periodStats(addDate, addDate);
  const platforms = DB.settings.platforms;
  v.innerHTML = `
    <div class="datebar">
      <button onclick="shiftAddDate(-1)">‹</button>
      <input type="date" id="addDate" value="${addDate}" max="${todayISO()}">
      <button onclick="shiftAddDate(1)">›</button>
    </div>
    <div class="small muted" style="text-align:center;margin:-6px 0 10px">${fmtDateLong(addDate)}${isWorkDay(addDate) ? '' : ' · folga'}</div>

    <div class="card">
      <h2>💰 Ganhos do dia <small>bruto</small></h2>
      <div class="inline-inputs">
        ${platforms.map(p => `<div><label>${esc(p)}</label><input inputmode="decimal" class="inc" data-p="${esc(p)}" placeholder="R$ 0,00" value="${inputVal(d.inc[p])}"></div>`).join('')}
        <div><label>Gorjetas / Bônus</label><input inputmode="decimal" id="tips" placeholder="R$ 0,00" value="${inputVal(d.tips)}"></div>
      </div>
      <div class="row between" style="margin-top:10px"><span class="muted">Total bruto</span><b id="grossTotal">${money(dayGross(d))}</b></div>
    </div>

    <div class="card">
      <h2>🚗 Jornada</h2>
      <div class="inline-inputs3">
        <div><label>Km rodados</label><input inputmode="decimal" id="km" value="${inputVal(d.km)}" placeholder="0"></div>
        <div><label>Horas online</label><input inputmode="decimal" id="hours" value="${inputVal(d.hours)}" placeholder="0"></div>
        <div><label>Corridas</label><input inputmode="numeric" id="trips" value="${inputVal(d.trips)}" placeholder="0"></div>
      </div>
      <details style="margin-top:8px"><summary class="small muted">Calcular km pelo hodômetro</summary>
        <div class="inline-inputs"><div><label>Hodômetro início</label><input inputmode="numeric" id="odoA"></div><div><label>Hodômetro fim</label><input inputmode="numeric" id="odoB"></div></div>
      </details>
      <label>Observação</label><input id="note" value="${esc(d.note)}" placeholder="Ex.: chuva, evento, dinâmico alto...">
      <button class="btn" onclick="saveDay()">💾 Salvar dia</button>
    </div>

    <div class="card list">
      <h2>💸 Gastos do dia <small>${money(st.totalExp)}</small></h2>
      <div class="chips" id="quickCats">
        ${EXPENSE_CATS.map(c => `<button class="chip" data-cat="${c.id}">${c.ico} ${c.name}</button>`).join('')}
      </div>
      <div id="expForm" style="display:none">
        <div class="inline-inputs">
          <div><label>Categoria</label><select id="expCat">${EXPENSE_CATS.map(c => `<option value="${c.id}">${c.ico} ${c.name}</option>`).join('')}</select></div>
          <div><label>Valor</label><input inputmode="decimal" id="expVal" placeholder="R$ 0,00"></div>
        </div>
        <label>Descrição (opcional)</label><input id="expNote" placeholder="Ex.: almoço, troca de pneu...">
        <button class="btn" onclick="addExpense()">Adicionar gasto</button>
      </div>
      <div style="margin-top:8px">
      ${exps.map(e => {
        const c = EXPENSE_CATS.find(x => x.id === e.cat) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
        return `<div class="item"><div><div class="t">${c.ico} ${c.name}</div><div class="s">${esc(e.note || '')}</div></div>
          <div class="row"><b class="red">${money(e.amount)}</b><button class="icon-btn" onclick="delExpense('${e.id}')">🗑️</button></div></div>`;
      }).join('')}
      ${fuels.map(f => `<div class="item"><div><div class="t">⛽ ${FUEL_TYPES[f.type].name}</div><div class="s">${num(f.qty, 2)} ${FUEL_TYPES[f.type].unit} · lançado em Energia</div></div><b class="red">${money(f.total)}</b></div>`).join('')}
      ${!exps.length && !fuels.length ? '<div class="empty">Nenhum gasto neste dia. Toque numa categoria acima.</div>' : ''}
      </div>
      <button class="btn sec" onclick="go('fuel')">⛽ Registrar abastecimento / recarga completo</button>
    </div>

    <div class="card">
      <h2>Resultado do dia</h2>
      <div class="grid3">
        <div class="stat"><div class="lbl">Bruto</div><div class="val">${money(st.gross)}</div></div>
        <div class="stat"><div class="lbl">Gastos</div><div class="val red">${money(st.totalExp)}</div></div>
        <div class="stat"><div class="lbl">Líquido</div><div class="val ${st.net >= 0 ? 'green' : 'red'}">${money(st.net)}</div></div>
      </div>
      ${st.km ? `<div class="hint">R$ ${num(st.gross / st.km, 2)} por km rodado${st.hours ? ` · ${money(st.net / st.hours)} líquido por hora` : ''}${st.trips ? ` · ticket médio ${money(st.gross / st.trips)}` : ''}</div>` : ''}
    </div>
  `;
  $('#addDate').addEventListener('change', e => { if (e.target.value) { addDate = e.target.value; render(); } });
  const recalc = () => {
    let t = parseNum($('#tips').value);
    $$('.inc').forEach(i => t += parseNum(i.value));
    $('#grossTotal').textContent = money(t);
  };
  $$('.inc, #tips').forEach(i => i.addEventListener('input', recalc));
  const odoCalc = () => {
    const a = parseNum($('#odoA').value), b = parseNum($('#odoB').value);
    if (a && b && b > a) $('#km').value = inputVal(b - a);
  };
  $('#odoA').addEventListener('input', odoCalc); $('#odoB').addEventListener('input', odoCalc);
  $$('#quickCats .chip').forEach(ch => ch.addEventListener('click', () => {
    $$('#quickCats .chip').forEach(x => x.classList.remove('on'));
    ch.classList.add('on');
    $('#expForm').style.display = 'block';
    $('#expCat').value = ch.dataset.cat;
    $('#expVal').focus();
  }));
}
function shiftAddDate(n) {
  const nd = addDays(addDate, n);
  if (nd > todayISO()) return;
  addDate = nd; render();
}
function saveDay() {
  const inc = {};
  $$('.inc').forEach(i => { const v = parseNum(i.value); if (v) inc[i.dataset.p] = v; });
  const day = {
    inc, tips: parseNum($('#tips').value), km: parseNum($('#km').value),
    hours: parseNum($('#hours').value), trips: Math.round(parseNum($('#trips').value)), note: $('#note').value.trim()
  };
  const empty = !dayGross(day) && !day.km && !day.hours && !day.trips && !day.note;
  if (empty) delete DB.days[addDate]; else DB.days[addDate] = day;
  const b = parseNum($('#odoB').value);
  if (b > (+DB.settings.odometer || 0)) DB.settings.odometer = b;
  save(); toast('Dia salvo ✅'); render();
}
function addExpense() {
  const amount = parseNum($('#expVal').value);
  if (amount <= 0) { toast('Informe o valor do gasto'); return; }
  DB.expenses.push({ id: uid(), date: addDate, cat: $('#expCat').value, amount, note: $('#expNote').value.trim() });
  // guarda o que já foi digitado nos ganhos antes de redesenhar
  saveDayDraftSilently();
  save(); toast('Gasto adicionado'); render();
}
function saveDayDraftSilently() {
  if (!$('#tips')) return;
  const inc = {};
  $$('.inc').forEach(i => { const v = parseNum(i.value); if (v) inc[i.dataset.p] = v; });
  const day = { inc, tips: parseNum($('#tips').value), km: parseNum($('#km').value), hours: parseNum($('#hours').value), trips: Math.round(parseNum($('#trips').value)), note: $('#note').value.trim() };
  if (dayGross(day) || day.km || day.hours || day.trips || day.note) DB.days[addDate] = day;
}
function delExpense(id) {
  if (!confirm('Excluir este gasto?')) return;
  saveDayDraftSilently();
  DB.expenses = DB.expenses.filter(e => e.id !== id); save(); render();
}

/* ================= ENERGIA (combustível / recarga) ================= */
function renderFuel(v) {
  const elec = DB.settings.vehicle === 'eletrico';
  const defType = elec ? 'eletrico' : DB.settings.fuelDefault;
  const types = Object.keys(FUEL_TYPES).filter(t => DB.fuel.some(f => f.type === t));
  const showType = fuelFilter || (types.length === 1 ? types[0] : '');
  const fa = fuelAnalysis(showType || null);
  const unitEff = showType ? FUEL_TYPES[showType].eff : (elec ? 'km/kWh' : 'km/L');
  const c = currentCycle();
  const cyc = DB.fuel.filter(f => inRange(f.date, c.start, c.end));
  const cycCost = cyc.reduce((t, f) => t + (+f.total || 0), 0);
  const list = DB.fuel.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.odo - a.odo));
  const lastOdo = currentOdometer();

  v.innerHTML = `
    <div class="card">
      <h2>${elec ? '🔌 Nova recarga' : '⛽ Novo abastecimento'}</h2>
      <div class="inline-inputs">
        <div><label>Data</label><input type="date" id="fDate" value="${todayISO()}" max="${todayISO()}"></div>
        <div><label>Tipo</label><select id="fType">${Object.entries(FUEL_TYPES).map(([k, t]) => `<option value="${k}" ${k === defType ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
        <div><label>Quantidade (<span id="fUnit">${FUEL_TYPES[defType].unit}</span>)</label><input inputmode="decimal" id="fQty" placeholder="0,00"></div>
        <div><label>Preço por <span id="fUnit2">${FUEL_TYPES[defType].unit}</span></label><input inputmode="decimal" id="fPrice" placeholder="R$ 0,00"></div>
        <div><label>Valor total pago</label><input inputmode="decimal" id="fTotal" placeholder="R$ 0,00"></div>
        <div><label>Hodômetro (km)</label><input inputmode="numeric" id="fOdo" placeholder="${lastOdo ? 'último: ' + lastOdo : 'km do painel'}"></div>
      </div>
      <label style="display:flex;align-items:center;margin-top:12px"><input type="checkbox" id="fFull" checked> <span id="fFullLbl">${elec ? 'Carga completa (100%)' : 'Completei o tanque'}</span></label>
      <label>Posto / local (opcional)</label><input id="fPlace" placeholder="${elec ? 'Ex.: em casa, eletroposto...' : 'Ex.: Posto Shell centro'}">
      <button class="btn" onclick="addFuel()">Salvar</button>
      <div class="hint">Para calcular o consumo real, informe o hodômetro e marque “tanque cheio / carga completa”. O consumo é calculado entre dois registros completos.</div>
    </div>

    ${types.length > 1 ? `<div class="seg">${['', ...types].map(t => `<button class="${t === fuelFilter ? 'on' : ''}" onclick="fuelFilter='${t}';render()">${t ? FUEL_TYPES[t].name : 'Todos'}</button>`).join('')}</div>` : ''}

    <div class="card">
      <h2>Médias ${showType ? '— ' + FUEL_TYPES[showType].name : ''}</h2>
      <div class="grid2">
        <div class="stat"><div class="lbl">Consumo médio</div><div class="val green">${fa.avgEff ? num(fa.avgEff, 2) + ' ' + unitEff : '—'}</div></div>
        <div class="stat"><div class="lbl">Último consumo</div><div class="val">${fa.lastEff ? num(fa.lastEff, 2) + ' ' + unitEff : '—'}</div></div>
        <div class="stat"><div class="lbl">Custo por km</div><div class="val">${fa.costKm ? money(fa.costKm) : '—'}</div></div>
        <div class="stat"><div class="lbl">Preço médio pago</div><div class="val">${fa.avgPrice ? money(fa.avgPrice) : '—'}</div></div>
        <div class="stat"><div class="lbl">Gasto no ciclo</div><div class="val red">${money(cycCost)}</div></div>
        <div class="stat"><div class="lbl">Registros</div><div class="val">${fa.count}</div></div>
      </div>
      ${fa.segments.length ? `<div class="hint">Com ${money(100)} você roda em média ${num(100 / fa.costKm, 0)} km.</div>` : ''}
      ${fa.segments.length >= 2 ? chartLine(fa.segments.slice(-12).map(s => ({ label: fmtDate(s.date), value: s.eff })), unitEff) : ''}
    </div>

    <div class="card">
      <h2>🧮 Etanol ou gasolina?</h2>
      <div class="inline-inputs">
        <div><label>Preço etanol</label><input inputmode="decimal" id="pE" placeholder="R$ 0,00"></div>
        <div><label>Preço gasolina</label><input inputmode="decimal" id="pG" placeholder="R$ 0,00"></div>
      </div>
      <div id="egResult" class="hint"></div>
    </div>

    <div class="card list">
      <h2>Histórico</h2>
      ${list.length ? list.map(f => {
        const t = FUEL_TYPES[f.type];
        return `<div class="item"><div><div class="t">${fmtDate(f.date)} · ${t.name}${f.full ? ' · cheio' : ''}</div>
          <div class="s">${num(f.qty, 2)} ${t.unit} × ${money(f.qty ? f.total / f.qty : 0)}${f.odo ? ' · ' + num(f.odo, 0) + ' km' : ''}${f.place ? ' · ' + esc(f.place) : ''}</div></div>
          <div class="row"><b>${money(f.total)}</b><button class="icon-btn" onclick="delFuel('${f.id}')">🗑️</button></div></div>`;
      }).join('') : '<div class="empty">Nenhum registro ainda.</div>'}
    </div>
  `;
  const q = $('#fQty'), p = $('#fPrice'), t = $('#fTotal');
  let last = '';
  const sync = src => {
    last = src;
    const Q = parseNum(q.value), P = parseNum(p.value), T = parseNum(t.value);
    if (src !== 'total' && Q && P) t.value = inputVal(Q * P);
    else if (src === 'total' && T && P) q.value = inputVal(T / P);
    else if (src === 'total' && T && Q) p.value = inputVal(T / Q);
  };
  q.addEventListener('input', () => sync('qty')); p.addEventListener('input', () => sync('price')); t.addEventListener('input', () => sync('total'));
  $('#fType').addEventListener('change', e => {
    const u = FUEL_TYPES[e.target.value].unit; $('#fUnit').textContent = u; $('#fUnit2').textContent = u;
    $('#fFullLbl').textContent = e.target.value === 'eletrico' ? 'Carga completa (100%)' : 'Completei o tanque';
  });
  const eg = () => {
    const e = parseNum($('#pE').value), g = parseNum($('#pG').value);
    if (!e || !g) { $('#egResult').innerHTML = 'Regra geral: etanol compensa se custar até 70% da gasolina.'; return; }
    const r = e / g;
    const eE = fuelAnalysis('etanol').avgEff, eG = fuelAnalysis('gasolina').avgEff;
    let html = `Etanol custa <b>${num(r * 100, 1)}%</b> da gasolina → pela regra dos 70%: <b class="${r <= 0.7 ? 'green' : 'yellow'}">${r <= 0.7 ? 'abasteça com ETANOL' : 'abasteça com GASOLINA'}</b>.`;
    if (eE && eG) {
      const cE = e / eE, cG = g / eG;
      html += `<br>Pelo consumo real do seu carro: etanol ${money(cE)}/km × gasolina ${money(cG)}/km → <b class="green">${cE < cG ? 'ETANOL' : 'GASOLINA'}</b> é mais barato.`;
    }
    $('#egResult').innerHTML = html;
  };
  $('#pE').addEventListener('input', eg); $('#pG').addEventListener('input', eg); eg();
}
function addFuel() {
  let qty = parseNum($('#fQty').value), total = parseNum($('#fTotal').value);
  const price = parseNum($('#fPrice').value);
  if (!total && qty && price) total = qty * price;
  if (!qty && total && price) qty = total / price;
  if (!total) { toast('Informe o valor pago'); return; }
  const odo = parseNum($('#fOdo').value);
  if (odo && odo < currentOdometer() - 5000) { if (!confirm('Hodômetro bem menor que o último registrado. Salvar assim mesmo?')) return; }
  const type = $('#fType').value;
  DB.fuel.push({ id: uid(), date: $('#fDate').value || todayISO(), type, qty, total, odo, full: $('#fFull').checked, place: $('#fPlace').value.trim() });
  if (type !== 'eletrico') DB.settings.fuelDefault = type;
  if (odo > (+DB.settings.odometer || 0)) DB.settings.odometer = odo;
  save(); toast('Registro salvo ⛽'); render();
}
function delFuel(id) {
  if (!confirm('Excluir este registro?')) return;
  DB.fuel = DB.fuel.filter(f => f.id !== id); save(); render();
}

/* ================= RELATÓRIOS ================= */
function periodRange(p) {
  const t = todayISO();
  const c = currentCycle();
  switch (p) {
    case 'week': return { start: addDays(t, -6), end: t, label: 'Últimos 7 dias' };
    case 'month': { const d = fromISO(t); return { start: toISO(new Date(d.getFullYear(), d.getMonth(), 1, 12)), end: t, label: 'Mês atual' }; }
    case 'prev': { const pc = cycleFor(addDays(c.start, -1), DB.settings.dueDay); return { ...pc, label: 'Ciclo anterior' }; }
    case 'all': {
      const dates = [...Object.keys(DB.days), ...DB.expenses.map(e => e.date), ...DB.fuel.map(f => f.date)].sort();
      return { start: dates[0] || t, end: t, label: 'Tudo' };
    }
    default: return { start: c.start, end: c.end > t ? t : c.end, label: 'Ciclo atual' };
  }
}
function renderReports(v) {
  const r = periodRange(reportPeriod);
  const s = periodStats(r.start, r.end);
  const days = Object.keys(s.daily).sort();
  const chartDays = [];
  if (daysBetween(r.start, r.end) <= 45) { for (let d = r.start; d <= r.end; d = addDays(d, 1)) chartDays.push(d); }
  else chartDays.push(...days.slice(-45));
  const catName = id => id === 'energia' ? '🔌 Recarga elétrica' : id === 'combustivel' ? '⛽ Combustível' : (() => { const c = EXPENSE_CATS.find(x => x.id === id); return c ? `${c.ico} ${c.name}` : id; })();
  const maxCat = Math.max(1, ...Object.values(s.byCat));
  const maxPlat = Math.max(1, ...Object.values(s.byPlatform));
  // dia da semana
  const wd = Array.from({ length: 7 }, () => ({ net: 0, n: 0 }));
  for (const iso of days) { const dd = s.daily[iso]; if (dd.gross > 0) { const w = fromISO(iso).getDay(); wd[w].net += dd.gross - dd.exp; wd[w].n++; } }
  const wdAvg = wd.map(x => x.n ? x.net / x.n : 0);
  const maxWd = Math.max(1, ...wdAvg);
  const best = wdAvg.indexOf(Math.max(...wdAvg));
  const reserve = (+DB.settings.reservePerKm || 0) * s.km;

  v.innerHTML = `
    <div class="seg">
      ${[['week', '7 dias'], ['cycle', 'Ciclo'], ['month', 'Mês'], ['prev', 'Ciclo ant.'], ['all', 'Tudo']].map(([k, l]) => `<button class="${k === reportPeriod ? 'on' : ''}" onclick="reportPeriod='${k}';render()">${l}</button>`).join('')}
    </div>
    <div class="small muted" style="margin:-4px 0 10px">${r.label}: ${fmtDate(r.start)} a ${fmtDate(r.end)}</div>

    <div class="card">
      <div class="grid3">
        <div class="stat"><div class="lbl">Bruto</div><div class="val">${money(s.gross)}</div></div>
        <div class="stat"><div class="lbl">Gastos</div><div class="val red">${money(s.totalExp)}</div></div>
        <div class="stat"><div class="lbl">Líquido</div><div class="val ${s.net >= 0 ? 'green' : 'red'}">${money(s.net)}</div></div>
      </div>
      <div class="grid2" style="margin-top:10px">
        <div class="stat"><div class="lbl">Km rodados</div><div class="val">${num(s.km, 0)} km</div></div>
        <div class="stat"><div class="lbl">Horas online</div><div class="val">${num(s.hours, 1)} h</div></div>
        <div class="stat"><div class="lbl">Corridas</div><div class="val">${s.trips}</div></div>
        <div class="stat"><div class="lbl">Dias trabalhados</div><div class="val">${s.workedDays}</div></div>
        <div class="stat"><div class="lbl">Bruto por km</div><div class="val">${s.km ? money(s.gross / s.km) : '—'}</div></div>
        <div class="stat"><div class="lbl">Líquido por km</div><div class="val">${s.km ? money(s.net / s.km) : '—'}</div></div>
        <div class="stat"><div class="lbl">Líquido por hora</div><div class="val">${s.hours ? money(s.net / s.hours) : '—'}</div></div>
        <div class="stat"><div class="lbl">Ticket médio</div><div class="val">${s.trips ? money(s.gross / s.trips) : '—'}</div></div>
        <div class="stat"><div class="lbl">Líquido por dia</div><div class="val">${s.workedDays ? money(s.net / s.workedDays) : '—'}</div></div>
        <div class="stat"><div class="lbl">Gastos / faturamento</div><div class="val">${s.gross ? num(s.totalExp / s.gross * 100, 0) + '%' : '—'}</div></div>
      </div>
      ${reserve > 0 ? `<div class="alert" style="margin-top:10px">🛡️ Reserva sugerida para manutenção/desgaste: <b>${money(reserve)}</b> (${money(DB.settings.reservePerKm)} por km). Lucro real após reserva: <b>${money(s.net - reserve)}</b></div>` : ''}
    </div>

    <div class="card">
      <h2>Dia a dia <small><span class="green">■</span> líquido <span class="red">■</span> gastos</small></h2>
      ${chartDays.length ? chartBars(chartDays.map(d => ({ label: fmtDate(d), gross: (s.daily[d] || {}).gross || 0, exp: (s.daily[d] || {}).exp || 0 }))) : '<div class="empty">Sem dados no período.</div>'}
    </div>

    <div class="card">
      <h2>Por plataforma</h2>
      ${Object.keys(s.byPlatform).length ? Object.entries(s.byPlatform).sort((a, b) => b[1] - a[1]).map(([k, val]) => `
        <div style="margin-bottom:8px"><div class="row between"><span>${esc(k)}</span><span>${money(val)} <span class="muted small">${num(val / (s.gross || 1) * 100, 0)}%</span></span></div>
        <div class="bar"><div style="width:${val / maxPlat * 100}%;background:var(--blue)"></div></div></div>`).join('') : '<div class="empty">Sem ganhos no período.</div>'}
    </div>

    <div class="card">
      <h2>Gastos por categoria</h2>
      ${Object.keys(s.byCat).length ? Object.entries(s.byCat).sort((a, b) => b[1] - a[1]).map(([k, val]) => `
        <div style="margin-bottom:8px"><div class="row between"><span>${catName(k)}</span><span>${money(val)} <span class="muted small">${num(val / (s.totalExp || 1) * 100, 0)}%</span></span></div>
        <div class="bar"><div style="width:${val / maxCat * 100}%;background:var(--red)"></div></div></div>`).join('') : '<div class="empty">Sem gastos no período.</div>'}
    </div>

    <div class="card">
      <h2>Melhores dias da semana <small>líquido médio</small></h2>
      ${wd.some(x => x.n) ? wdAvg.map((val, i) => `
        <div style="margin-bottom:6px"><div class="row between"><span>${WEEKDAYS_LONG[i]} ${i === best && val > 0 ? '⭐' : ''}</span><span>${wd[i].n ? money(val) : '—'}</span></div>
        <div class="bar"><div style="width:${val > 0 ? val / maxWd * 100 : 0}%"></div></div></div>`).join('') : '<div class="empty">Lance alguns dias para ver a análise.</div>'}
    </div>

    <div class="card list">
      <h2>Histórico de dias</h2>
      ${days.length ? days.slice().reverse().map(d => {
        const dd = s.daily[d]; const net = dd.gross - dd.exp; const info = DB.days[d];
        return `<div class="item" onclick="addDate='${d}';go('add')"><div><div class="t">${fmtDateLong(d)}</div>
          <div class="s">Bruto ${money(dd.gross)} · Gastos ${money(dd.exp)}${info && info.km ? ' · ' + num(info.km, 0) + ' km' : ''}${info && info.note ? ' · ' + esc(info.note) : ''}</div></div>
          <b class="${net >= 0 ? 'green' : 'red'}">${money(net)}</b></div>`;
      }).join('') : '<div class="empty">Nada lançado neste período.</div>'}
    </div>
    <button class="btn sec" onclick="shareReport()">📤 Compartilhar resumo</button>
  `;
}
function shareReport() {
  const r = periodRange(reportPeriod);
  const s = periodStats(r.start, r.end);
  const target = totalTarget();
  const text = `📊 Meta Driver — ${r.label} (${fmtDate(r.start)} a ${fmtDate(r.end)})
💰 Bruto: ${money(s.gross)}
💸 Gastos: ${money(s.totalExp)}
✅ Líquido: ${money(s.net)}
🚗 ${num(s.km, 0)} km · ${num(s.hours, 1)} h · ${s.trips} corridas · ${s.workedDays} dias
📈 ${s.km ? money(s.gross / s.km) + '/km' : ''} ${s.hours ? '· ' + money(s.net / s.hours) + '/h líquido' : ''}
🎯 Meta do ciclo: ${money(target)}`;
  shareText('Resumo Meta Driver', text);
}

/* ---------- gráficos SVG ---------- */
function chartBars(data) {
  const W = 340, H = 150, pad = 18;
  const max = Math.max(1, ...data.map(d => Math.max(d.gross, d.exp)));
  const bw = (W - pad) / data.length;
  let bars = '';
  data.forEach((d, i) => {
    const x = pad + i * bw;
    const net = Math.max(0, d.gross - d.exp);
    const hN = net / max * (H - 30), hE = d.exp / max * (H - 30);
    const w = Math.max(2, bw * 0.38);
    bars += `<rect x="${x + bw * 0.1}" y="${H - 18 - hN}" width="${w}" height="${hN}" rx="2" fill="#22C55E"/>`;
    bars += `<rect x="${x + bw * 0.1 + w + 1}" y="${H - 18 - hE}" width="${w}" height="${hE}" rx="2" fill="#F87171"/>`;
    const step = Math.ceil(data.length / 8);
    if (i % step === 0) bars += `<text x="${x + bw / 2}" y="${H - 4}" font-size="8" fill="#94A3B8" text-anchor="middle">${d.label}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - 18}" x2="${W}" y2="${H - 18}" stroke="#334155"/>
    <text x="0" y="10" font-size="8" fill="#94A3B8">${money(max).replace(',00', '')}</text>${bars}</svg>`;
}
function chartLine(data, unit) {
  const W = 340, H = 110, pad = 20;
  const vals = data.map(d => d.value);
  const max = Math.max(...vals) * 1.1, min = Math.min(...vals) * 0.9;
  const x = i => pad + i * (W - pad * 2) / Math.max(1, data.length - 1);
  const y = vv => 10 + (H - 30) * (1 - (vv - min) / ((max - min) || 1));
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="margin-top:10px">
    <polyline points="${pts}" fill="none" stroke="#22C55E" stroke-width="2"/>
    ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.value)}" r="3" fill="#22C55E"/>
      <text x="${x(i)}" y="${y(d.value) - 6}" font-size="8" fill="#F1F5F9" text-anchor="middle">${num(d.value, 1)}</text>
      <text x="${x(i)}" y="${H - 4}" font-size="8" fill="#94A3B8" text-anchor="middle">${d.label}</text>`).join('')}
  </svg><div class="small muted" style="text-align:center">Consumo (${unit}) por tanque</div>`;
}

/* ================= MAIS ================= */
function renderMore(v) {
  const s = DB.settings;
  const odo = currentOdometer();
  v.innerHTML = `
    <div class="card list">
      <h2>🎯 Contas e metas</h2>
      <div class="item"><div><div class="t">Meta total do ciclo</div><div class="s">${DB.bills.length} conta(s)${s.personalGoal ? ' + meta pessoal' : ''} · ciclo fecha todo dia ${s.dueDay}</div></div><b>${money(totalTarget())}</b></div>
      <button class="btn" onclick="editBills()">Editar contas e meta</button>
    </div>

    <div class="card">
      <h2>📅 Dias de trabalho</h2>
      <div class="weekdays">${WEEKDAYS.map((w, i) => `<button class="chip ${s.workDays.includes(i) ? 'on' : ''}" onclick="toggleWorkDay(${i})">${w}</button>`).join('')}</div>
      <div class="hint">Usado para calcular quanto você precisa fazer por dia de trabalho.</div>
      <label>Folgas planejadas</label>
      <div class="row"><input type="date" id="offDate" min="${todayISO()}"><button class="btn sm" onclick="addDayOff()">Adicionar</button></div>
      <div class="chips" style="margin-top:8px">${DB.daysOff.filter(d => d >= todayISO()).sort().map(d => `<button class="chip" onclick="removeDayOff('${d}')">${fmtDate(d)} ✕</button>`).join('') || '<span class="small muted">Nenhuma folga planejada.</span>'}</div>
    </div>

    <div class="card">
      <h2>🚘 Veículo</h2>
      <div class="inline-inputs">
        <div><label>Tipo</label><select id="vehType">
          <option value="combustao" ${s.vehicle === 'combustao' ? 'selected' : ''}>Combustão / Flex</option>
          <option value="eletrico" ${s.vehicle === 'eletrico' ? 'selected' : ''}>Elétrico</option>
          <option value="hibrido" ${s.vehicle === 'hibrido' ? 'selected' : ''}>Híbrido</option></select></div>
        <div><label>Hodômetro atual (km)</label><input inputmode="numeric" id="odoNow" value="${odo || ''}"></div>
      </div>
      <label>Reserva para manutenção/desgaste (R$ por km)</label>
      <input inputmode="decimal" id="resKm" value="${inputVal(s.reservePerKm)}" placeholder="Ex.: 0,15">
      <label>Plataformas (separe por vírgula)</label>
      <input id="plats" value="${esc(s.platforms.join(', '))}">
      <button class="btn" onclick="saveVehicle()">Salvar</button>
    </div>

    <div class="card list">
      <h2>🔧 Manutenção <small>hodômetro: ${num(odo, 0)} km</small></h2>
      ${DB.maint.map(m => {
        const due = (+m.lastKm || 0) + (+m.everyKm || 0);
        const left = due - odo;
        const p = m.everyKm && m.lastKm ? Math.min(100, Math.max(0, (odo - m.lastKm) / m.everyKm * 100)) : 0;
        return `<div class="item" style="display:block">
          <div class="row between"><span class="t">${esc(m.name)}</span>
            <span class="row"><button class="btn sm" onclick="maintDone('${m.id}')">Feito</button><button class="icon-btn" onclick="editMaint('${m.id}')">✏️</button></span></div>
          <div class="s">A cada ${num(m.everyKm, 0)} km · ${!m.lastKm ? 'toque em ✏️ e informe o km da última vez' : `última em ${num(m.lastKm, 0)} km · `}${!m.lastKm ? '' : odo ? (left <= 0 ? `<b class="red">atrasada ${num(-left, 0)} km</b>` : `faltam ${num(left, 0)} km`) : 'informe o hodômetro'}</div>
          <div class="bar"><div style="width:${p}%;background:${p >= 100 ? 'var(--red)' : p > 85 ? 'var(--yellow)' : 'var(--green)'}"></div></div></div>`;
      }).join('')}
      <button class="btn sec" onclick="editMaint()">➕ Novo item de manutenção</button>
    </div>

    <div class="card">
      <h2>🧮 Vale a pena essa corrida?</h2>
      <div class="inline-inputs3">
        <div><label>Valor (R$)</label><input inputmode="decimal" id="rV"></div>
        <div><label>Km total</label><input inputmode="decimal" id="rK" placeholder="busca+viagem"></div>
        <div><label>Minutos</label><input inputmode="decimal" id="rM"></div>
      </div>
      <div id="rideRes" class="hint"></div>
    </div>

    <div class="card">
      <h2>💾 Backup dos dados</h2>
      <div class="hint">Os dados ficam só neste celular. Faça backup com frequência (WhatsApp, e-mail, Drive) para não perder nada ao trocar de aparelho.</div>
      <button class="btn" onclick="exportData()">📤 Exportar backup</button>
      <button class="btn sec" onclick="importData()">📥 Importar backup</button>
      <button class="btn sec" onclick="exportCSV()">📄 Exportar planilha (CSV)</button>
      <button class="btn danger" onclick="resetAll()">Apagar todos os dados</button>
    </div>
    <div class="small muted" style="text-align:center;margin:8px 0 20px">Meta Driver v1.0 · funciona 100% offline</div>
  `;
  const ride = () => {
    const val = parseNum($('#rV').value), km = parseNum($('#rK').value), min = parseNum($('#rM').value);
    if (!val || !km) { $('#rideRes').innerHTML = 'Preencha valor e km para avaliar.'; return; }
    const cpk = costPerKm();
    const cost = cpk * km;
    const profit = val - cost;
    const perKm = val / km;
    const perH = min ? profit / (min / 60) : 0;
    const c = currentCycle(); const st = periodStats(c.start, c.end);
    const myHour = st.hours ? st.net / st.hours : 0;
    let verdict = perKm >= 2 ? '<b class="green">👍 Boa corrida</b>' : perKm >= 1.5 ? '<b class="yellow">🤔 Razoável</b>' : '<b class="red">👎 Paga pouco</b>';
    $('#rideRes').innerHTML = `${verdict}<br>${money(perKm)} por km · custo estimado ${cpk ? money(cost) : '(registre abastecimentos para calcular)'} · lucro ≈ <b>${money(profit)}</b>${min ? ` · ${money(perH)}/h` : ''}${myHour && min ? `<br>Sua média no ciclo: ${money(myHour)}/h líquido → ${perH >= myHour ? 'acima' : 'abaixo'} da sua média.` : ''}`;
  };
  ['#rV', '#rK', '#rM'].forEach(id => $(id).addEventListener('input', ride)); ride();
}
function toggleWorkDay(i) {
  const w = DB.settings.workDays;
  DB.settings.workDays = w.includes(i) ? w.filter(x => x !== i) : [...w, i].sort();
  save(); render();
}
function addDayOff() {
  const d = $('#offDate').value; if (!d) return;
  if (!DB.daysOff.includes(d)) DB.daysOff.push(d);
  save(); render();
}
function removeDayOff(d) { DB.daysOff = DB.daysOff.filter(x => x !== d); save(); render(); }
function saveVehicle() {
  DB.settings.vehicle = $('#vehType').value;
  if (DB.settings.vehicle === 'eletrico') DB.settings.fuelDefault = 'eletrico';
  else if (DB.settings.fuelDefault === 'eletrico') DB.settings.fuelDefault = 'gasolina';
  DB.settings.odometer = parseNum($('#odoNow').value);
  DB.settings.reservePerKm = parseNum($('#resKm').value);
  const pl = $('#plats').value.split(',').map(x => x.trim()).filter(Boolean);
  if (pl.length) DB.settings.platforms = pl;
  save(); toast('Salvo ✅'); render();
}
function maintDone(id) {
  const m = DB.maint.find(x => x.id === id); const odo = currentOdometer();
  if (!odo) { toast('Informe o hodômetro atual primeiro'); return; }
  if (!confirm(`Marcar "${m.name}" como feita em ${num(odo, 0)} km?`)) return;
  m.lastKm = odo; save(); render();
}
function editMaint(id) {
  const m = id ? DB.maint.find(x => x.id === id) : { name: '', everyKm: 10000, lastKm: currentOdometer() };
  openModal(id ? 'Editar manutenção' : 'Nova manutenção', `
    <label>Item</label><input id="mN" value="${esc(m.name)}" placeholder="Ex.: Troca de óleo">
    <div class="inline-inputs"><div><label>A cada (km)</label><input inputmode="numeric" id="mE" value="${m.everyKm || ''}"></div>
    <div><label>Última vez (km)</label><input inputmode="numeric" id="mL" value="${m.lastKm || ''}"></div></div>
    <button class="btn" id="mSave">Salvar</button>
    ${id ? '<button class="btn danger" id="mDel">Excluir</button>' : ''}`, b => {
    $('#mSave', b).onclick = () => {
      const name = $('#mN').value.trim(); if (!name) { toast('Informe o nome'); return; }
      const obj = { name, everyKm: parseNum($('#mE').value), lastKm: parseNum($('#mL').value) };
      if (id) Object.assign(m, obj); else DB.maint.push({ id: uid(), ...obj });
      save(); closeModal(); render();
    };
    if (id) $('#mDel', b).onclick = () => { if (confirm('Excluir?')) { DB.maint = DB.maint.filter(x => x.id !== id); save(); closeModal(); render(); } };
  });
}

function editBills() {
  const draw = () => `
    <div class="hint">Cadastre as contas que você precisa pagar todo mês com o dinheiro das corridas. A soma vira sua meta do ciclo.</div>
    <div id="billList">${DB.bills.map(b => `
      <div class="card" style="background:var(--card2);margin:8px 0;padding:10px" data-id="${b.id}">
        <label>Nome</label><input class="bN" value="${esc(b.name)}">
        <div class="inline-inputs"><div><label>Valor (R$)</label><input inputmode="decimal" class="bA" value="${inputVal(b.amount)}"></div>
        <div><label>Dia do vencimento</label><input inputmode="numeric" class="bD" value="${b.dueDay}"></div></div>
        <button class="btn sm danger" style="margin-top:8px" onclick="removeBill('${b.id}')">Remover</button>
      </div>`).join('')}</div>
    <button class="btn sec" onclick="addBill()">➕ Adicionar conta (seguro, aluguel, IPVA, celular...)</button>
    <hr>
    <label>Meta pessoal extra no ciclo (o que você quer sobrar pra você)</label>
    <input inputmode="decimal" id="pGoal" value="${inputVal(DB.settings.personalGoal)}" placeholder="R$ 0,00">
    <label>Dia em que o ciclo fecha (geralmente o vencimento principal)</label>
    <input inputmode="numeric" id="dDay" value="${DB.settings.dueDay}">
    <button class="btn" onclick="saveBills()">Salvar</button>`;
  openModal('Contas e metas', draw());
}
function collectBills() {
  $$('#billList [data-id]').forEach(el => {
    const b = DB.bills.find(x => x.id === el.dataset.id); if (!b) return;
    b.name = $('.bN', el).value.trim() || 'Conta';
    b.amount = parseNum($('.bA', el).value);
    b.dueDay = Math.min(31, Math.max(1, Math.round(parseNum($('.bD', el).value)) || 1));
  });
}
function addBill() { collectBills(); DB.bills.push({ id: uid(), name: '', amount: 0, dueDay: DB.settings.dueDay }); editBills(); }
function removeBill(id) { collectBills(); DB.bills = DB.bills.filter(b => b.id !== id); editBills(); }
function saveBills() {
  collectBills();
  DB.settings.personalGoal = parseNum($('#pGoal').value);
  DB.settings.dueDay = Math.min(31, Math.max(1, Math.round(parseNum($('#dDay').value)) || 15));
  save(); closeModal(); toast('Metas atualizadas 🎯'); render();
}

/* ---------- configuração inicial ---------- */
function setupWizard() {
  const b = DB.bills[0] || { name: 'Financiamento do carro', amount: 2370, dueDay: 15 };
  openModal('Bem-vindo ao Meta Driver 🚗', `
    <div class="hint" style="font-size:14px">Vamos configurar sua meta. Exemplo: parcela do carro de R$ 2.370 que vence todo dia 15.</div>
    <label>Principal conta do mês</label><input id="wN" value="${esc(b.name)}">
    <div class="inline-inputs"><div><label>Valor (R$)</label><input inputmode="decimal" id="wA" value="${inputVal(b.amount)}"></div>
    <div><label>Vence todo dia</label><input inputmode="numeric" id="wD" value="${b.dueDay}"></div></div>
    <label>Tipo de veículo</label><select id="wV"><option value="combustao">Combustão / Flex</option><option value="eletrico">Elétrico</option><option value="hibrido">Híbrido</option></select>
    <label>Dias que você trabalha</label>
    <div class="weekdays" id="wW">${WEEKDAYS.map((w, i) => `<button class="chip ${DB.settings.workDays.includes(i) ? 'on' : ''}" data-i="${i}">${w}</button>`).join('')}</div>
    <div class="hint">Você pode adicionar outras contas (seguro, aluguel, celular) depois em <b>Mais → Contas e metas</b>.</div>
    <button class="btn" id="wGo">Começar</button>`, body => {
    $$('#wW .chip', body).forEach(c => c.onclick = () => c.classList.toggle('on'));
    $('#wGo', body).onclick = () => {
      const day = Math.min(31, Math.max(1, Math.round(parseNum($('#wD').value)) || 15));
      if (!DB.bills.length) DB.bills.push({ id: uid() });
      Object.assign(DB.bills[0], { name: $('#wN').value.trim() || 'Financiamento do carro', amount: parseNum($('#wA').value), dueDay: day });
      DB.settings.dueDay = day;
      DB.settings.vehicle = $('#wV').value;
      if (DB.settings.vehicle === 'eletrico') DB.settings.fuelDefault = 'eletrico';
      const wd = $$('#wW .chip.on', body).map(c => +c.dataset.i);
      if (wd.length) DB.settings.workDays = wd;
      DB.setupDone = true; save(); closeModal(); render();
    };
  });
}

/* ---------- backup ---------- */
function shareText(title, text) {
  if (window.AndroidBridge && AndroidBridge.shareText) { AndroidBridge.shareText(title, text); return; }
  if (navigator.share) { navigator.share({ title, text }).catch(() => {}); return; }
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = title.replace(/\s+/g, '_') + '.txt'; a.click();
}
function exportData() {
  shareText('Backup Meta Driver ' + todayISO(), JSON.stringify(DB));
}
function exportCSV() {
  const rows = [['data', 'tipo', 'categoria/plataforma', 'valor', 'km', 'horas', 'corridas', 'obs']];
  Object.keys(DB.days).sort().forEach(d => {
    const x = DB.days[d];
    Object.entries(x.inc || {}).forEach(([p, val]) => rows.push([d, 'ganho', p, val, '', '', '', '']));
    if (x.tips) rows.push([d, 'ganho', 'Gorjetas/Bônus', x.tips, '', '', '', '']);
    rows.push([d, 'jornada', '', '', x.km || '', x.hours || '', x.trips || '', x.note || '']);
  });
  DB.expenses.forEach(e => rows.push([e.date, 'gasto', (EXPENSE_CATS.find(c => c.id === e.cat) || {}).name || e.cat, e.amount, '', '', '', e.note || '']));
  DB.fuel.forEach(f => rows.push([f.date, 'abastecimento', FUEL_TYPES[f.type].name, f.total, f.odo || '', '', '', `${f.qty} ${FUEL_TYPES[f.type].unit}`]));
  const head = rows.shift();
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  rows.unshift(head);
  const cell = c => typeof c === 'number' ? String(c).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(cell).join(';')).join('\n');
  shareText('Planilha Meta Driver', csv);
}
function importData() {
  openModal('Importar backup', `
    <div class="hint">Escolha o arquivo de backup ou cole o texto do backup abaixo. <b>Os dados atuais serão substituídos.</b></div>
    <label>Arquivo</label><input type="file" id="impFile" accept=".txt,.json,text/plain,application/json">
    <label>Ou cole o texto</label><textarea id="impText" rows="5" placeholder='{"version":1,...}'></textarea>
    <button class="btn" id="impGo">Importar</button>`, b => {
    $('#impFile', b).onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { $('#impText').value = r.result; }; r.readAsText(f);
    };
    $('#impGo', b).onclick = () => {
      try {
        const d = JSON.parse($('#impText').value.trim());
        if (!d || !d.settings || !d.days) throw new Error('formato inválido');
        localStorage.setItem(DB_KEY, JSON.stringify(d));
        DB = load(); DB.setupDone = true; save(); closeModal(); toast('Backup importado ✅'); go('home');
      } catch (e) { toast('Não foi possível importar: ' + e.message); }
    };
  });
}
function resetAll() {
  if (!confirm('Apagar TODOS os dados? Faça um backup antes.')) return;
  if (!confirm('Tem certeza? Essa ação não pode ser desfeita.')) return;
  DB = defaultData(); save(); go('home');
}

/* ---------- início ---------- */
render();
// atualiza a tela quando o app volta do segundo plano em outro dia
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
