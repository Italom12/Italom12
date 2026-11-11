/* Eletrovia — mapa de carregadores de veículos elétricos.
 * Dados: snapshot do OpenStreetMap empacotado (data/stations.json) + atualização
 * por área via Overpass + pontos adicionados pelo próprio usuário (salvos no aparelho). */
(() => {
'use strict';

// ---------------------------------------------------------------- constantes
const CONN = {
  ccs2:    { n: 'CCS2',     dc: 1, c: 'var(--yellow)' },
  type2:   { n: 'Tipo 2',   dc: 0, c: 'var(--green)' },
  chademo: { n: 'CHAdeMO',  dc: 1, c: 'var(--blue)' },
  gbt_dc:  { n: 'GB/T DC',  dc: 1, c: 'var(--pink)' },
  gbt_ac:  { n: 'GB/T AC',  dc: 0, c: 'var(--pink)' },
  tesla:   { n: 'Tesla',    dc: 1, c: 'var(--violet)' },
  ccs1:    { n: 'CCS1',     dc: 1, c: 'var(--yellow)' },
  type1:   { n: 'Tipo 1',   dc: 0, c: 'var(--green)' },
  tomada:  { n: 'Tomada',   dc: 0, c: 'var(--muted)' },
};
const MAIN_CONNS = ['ccs2', 'type2', 'chademo', 'gbt_dc', 'tesla', 'type1', 'tomada'];
const CLS = [
  { n: 'AC',    l: 'Lenta · AC',      c: 'var(--c0)' },
  { n: 'DC',    l: 'Rápida · DC',     c: 'var(--c1)' },
  { n: 'ULTRA', l: 'Ultra · 100 kW+', c: 'var(--c2)' },
  { n: '?',     l: 'Sem dados',       c: 'var(--c3)' },
];
const KW_STEPS = [0, 7, 11, 22, 50, 100, 150, 250];
const OPERATORS = ['Tupi', 'VAPT', 'Shell Recharge', 'Raízen', 'EDP', 'Zletric', 'WEG', 'BYD', 'Tesla', 'Volvo',
  'Enel X', 'Neoenergia', 'CPFL', 'Ipiranga', 'Electra', 'EZVolt', 'Copel', 'Cemig', 'Porsche', 'BMW', 'Mercedes-Benz', 'GWM'];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fmt = (n) => Number(n).toLocaleString('pt-BR');
const fmtK = (n) => (n >= 1000 ? (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : String(Math.round(n)));
const kwTxt = (p) => (p == null ? '—' : (p % 1 ? p.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : String(p)));

const store = {
  get(k, d) { try { const v = localStorage.getItem('ev.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ev.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTxt = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : km < 10 ? km.toFixed(1).replace('.', ',') + ' km' : Math.round(km) + ' km');

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
function openUrl(url) {
  if (window.Android && Android.openUrl) Android.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- estado
const S = {
  all: new Map(),          // id -> estação
  markers: new Map(),      // id -> L.Marker
  filtered: [],
  favs: new Set(store.get('favs', [])),
  checkins: store.get('ck', {}),
  user: store.get('user', []),
  live: store.get('live', []),
  ocm: store.get('ocm', []),
  generated: '',
  me: null,                // {lat, lon}
  tab: 'map',
  selected: null,
  placing: false,
  f: Object.assign(
    { cls: [0, 1, 2, 3], conn: [], kw: 0, op: '', free: false, h24: false, hidePrivate: true },
    store.get('filters', {})
  ),
};

// ---------------------------------------------------------------- interpretação de tags OSM (atualização ao vivo)
const SOCK = {
  type2_combo: 'ccs2', type1_combo: 'ccs1', chademo: 'chademo', type2: 'type2', type2_cable: 'type2', type1: 'type1',
  tesla_supercharger: 'tesla', tesla_destination: 'tesla', nacs: 'tesla', gb_dc: 'gbt_dc', gb_ac: 'gbt_ac',
  schuko: 'tomada', typee: 'tomada', BR: 'tomada', br_10a: 'tomada', br_20a: 'tomada',
};
function parseKw(v) {
  if (!v) return null;
  let best = null;
  for (const m of String(v).matchAll(/(\d+(?:[.,]\d+)?)\s*(kw|kva|w)?/gi)) {
    let n = parseFloat(m[1].replace(',', '.'));
    const u = (m[2] || '').toLowerCase();
    if (u === 'w' || (!u && n > 1000)) n /= 1000;
    if (n > 0 && n <= 1000) best = best == null ? n : Math.max(best, n);
  }
  return best;
}
function classify(p, conns) {
  const dc = Object.keys(conns || {}).some((c) => CONN[c] && CONN[c].dc);
  if (p) return p >= 100 ? 2 : (p > 22 || (dc && p >= 20)) ? 1 : 0;
  if (dc) return 1;
  return conns && Object.keys(conns).length ? 0 : 3;
}
function fromOsm(id, lat, lon, t) {
  const s = { i: id, a: +lat.toFixed(6), o: +lon.toFixed(6) };
  if (t.name || t.brand) s.n = t.name || t.brand;
  const op = t.network || t.operator || t.brand;
  if (op) s.op = op;
  const c = {}, k = {};
  for (const [key, code] of Object.entries(SOCK)) {
    const b = 'socket:' + key;
    if (!(b in t) && !((b + ':output') in t)) continue;
    if (t[b] === 'no' || t[b] === '0') continue;
    const cnt = parseInt(t[b], 10);
    c[code] = (c[code] || 0) + (cnt > 0 ? cnt : 1);
    const kw = parseKw(t[b + ':output']);
    if (kw) k[code] = Math.max(k[code] || 0, kw);
  }
  if (Object.keys(c).length) s.c = c;
  if (Object.keys(k).length) s.k = k;
  let p = Math.max(0, ...Object.values(k)) || null;
  for (const key of ['charging_station:output', 'maxpower', 'output']) {
    const v = parseKw(t[key]);
    if (v) p = Math.max(p || 0, v);
  }
  if (p) s.p = Math.round(p * 10) / 10;
  s.x = classify(s.p, s.c);
  const cap = parseInt(t.capacity, 10);
  if (cap > 0) s.q = cap;
  if (t.fee === 'no' || t.fee === 'free') s.f = 0;
  else if (t.fee === 'yes') s.f = 1;
  if (t.charge) s.pr = t.charge;
  if (t.opening_hours) s.h = t.opening_hours;
  if (['private', 'customers', 'no', 'permissive', 'destination'].includes(t.access)) s.ac = t.access;
  const street = t['addr:street'] ? t['addr:street'] + (t['addr:housenumber'] ? ' ' + t['addr:housenumber'] : '') : null;
  const ad = [street, t['addr:suburb'], t['addr:city'], t['addr:state']].filter(Boolean).join(', ');
  if (ad) s.ad = ad;
  if (t['addr:city']) s.ci = t['addr:city'];
  if (t.description) s.d = t.description;
  const w = t.website || t['contact:website'] || t.url;
  if (w) s.w = w;
  const ph = t.phone || t['contact:phone'];
  if (ph) s.ph = ph;
  return s;
}


// ---------------------------------------------------------------- Open Charge Map (chave gratuita do usuário)
const OCM_URL = 'https://api.openchargemap.io/v3/poi/';
function ocmConn(c) {
  const t = norm((c.ConnectionType && c.ConnectionType.Title) || '');
  const dc = c.CurrentTypeID === 30;
  if (t.includes('ccs') || t.includes('combo')) return t.includes('type 1') || t.includes('sae') ? 'ccs1' : 'ccs2';
  if (t.includes('chademo')) return 'chademo';
  if (t.includes('gb-t') || t.includes('gb/t') || t.includes('gbt')) return dc || t.includes('dc') ? 'gbt_dc' : 'gbt_ac';
  if (t.includes('tesla') || t.includes('nacs')) return 'tesla';
  if (t.includes('type 2') || t.includes('mennekes') || t.includes('62196-2')) return 'type2';
  if (t.includes('type 1') || t.includes('j1772')) return 'type1';
  return 'tomada';
}
function fromOcm(p) {
  const A = p.AddressInfo || {};
  if (A.Latitude == null) return null;
  const s = { i: 'c' + p.ID, a: +A.Latitude.toFixed(6), o: +A.Longitude.toFixed(6) };
  if (A.Title) s.n = A.Title;
  const op = p.OperatorInfo && p.OperatorInfo.Title;
  if (op && !/unknown|desconhecid/i.test(op)) s.op = op.replace(/\s*\(.*\)\s*$/, '');
  const c = {}, k = {};
  for (const cn of p.Connections || []) {
    const code = ocmConn(cn);
    c[code] = (c[code] || 0) + (cn.Quantity > 0 ? cn.Quantity : 1);
    if (cn.PowerKW) k[code] = Math.max(k[code] || 0, cn.PowerKW);
  }
  if (Object.keys(c).length) s.c = c;
  if (Object.keys(k).length) s.k = k;
  const pmax = Math.max(0, ...Object.values(k));
  if (pmax) s.p = Math.round(pmax * 10) / 10;
  s.x = classify(s.p, s.c);
  if (p.NumberOfPoints > 0) s.q = p.NumberOfPoints;
  const cost = (p.UsageCost || '').trim();
  if (cost) { if (/^(free|gr[aá]tis|gratuito|0)$/i.test(cost)) s.f = 0; else s.pr = cost.slice(0, 80); }
  const ut = p.UsageType || {};
  if (ut.ID === 2 || /private/i.test(ut.Title || '')) s.ac = 'private';
  else if (ut.IsMembershipRequired || ut.ID === 4 || ut.ID === 7) s.ac = 'customers';
  const ad = [A.AddressLine1, A.Town, A.StateOrProvince].filter(Boolean).join(', ');
  if (ad) s.ad = ad;
  if (A.Town) s.ci = A.Town;
  if (A.AccessComments) s.d = A.AccessComments.slice(0, 200);
  if (A.ContactTelephone1) s.ph = A.ContactTelephone1;
  if (A.RelatedURL) s.w = A.RelatedURL;
  if (p.StatusType && p.StatusType.IsOperational === false) s.off = 1;
  return s;
}
async function ocmFetch(params) {
  const key = store.get('ocmKey', '');
  if (!key) return null;
  const q = new URLSearchParams(Object.assign({ output: 'json', compact: 'false', verbose: 'false', maxresults: '10000', key }, params));
  const r = await fetch(OCM_URL + '?' + q, { headers: { 'X-API-Key': key } });
  if (!r.ok) throw new Error('OCM ' + r.status);
  return (await r.json()).map(fromOcm).filter(Boolean);
}
// baixa o Brasil inteiro do OCM e guarda no aparelho (uma vez por semana)
async function syncOcm(force = false) {
  if (!store.get('ocmKey', '')) return false;
  const last = store.get('ocmAt', 0);
  if (!force && Date.now() - last < 7 * 864e5 && S.ocm.length) return false;
  try {
    const list = await ocmFetch({ countrycode: 'BR' });
    S.ocm = list.filter((s) => !s.off);
    if (!store.set('ocm', S.ocm)) toast('Pouco espaço: dados do OCM não ficaram salvos offline');
    store.set('ocmAt', Date.now());
    for (const s of S.ocm) addStation(s);
    buildFilterUI();
    applyFilters(false);
    toast(`${fmt(S.ocm.length)} carregadores do Open Charge Map carregados`);
    return true;
  } catch (e) {
    toast('Open Charge Map: não foi possível baixar (confira a chave)');
    return false;
  }
}

// ---------------------------------------------------------------- mapa
const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 3, maxZoom: 19, preferCanvas: false, tap: false });
const lastView = store.get('view', null);
if (lastView) map.setView([lastView[0], lastView[1]], lastView[2]);
else map.setView([-15.8, -50.5], 4);

// mapa base escuro sem chave de API: Esri Dark Gray Canvas (fundo + rótulos)
L.tileLayer(ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, maxNativeZoom: 16, className: 'base-tiles',
  attribution: '© Esri · © OpenStreetMap',
}).addTo(map);
L.tileLayer(ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, maxNativeZoom: 16, pane: 'overlayPane',
}).addTo(map);

const ICONS = [0, 1, 2, 3, 4].map((k) => [false, true].map((sel) =>
  L.divIcon({ className: '', html: `<div class="pin k${k}${sel ? ' sel' : ''}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] })));
const visualCls = (s) => (s.u ? 4 : s.x);

const cluster = L.markerClusterGroup({
  chunkedLoading: true,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  maxClusterRadius: (z) => (z < 8 ? 70 : z < 13 ? 55 : 40),
  disableClusteringAtZoom: 17,
  iconCreateFunction(c) {
    const ms = c.getAllChildMarkers();
    const cnt = [0, 0, 0, 0, 0];
    for (const m of ms) cnt[m.options.k]++;
    const n = ms.length;
    const cols = ['#5aa9ff', '#5ee6a0', '#f5c84c', '#a78bfa', '#ff6fa8'];
    let acc = 0;
    const stops = [];
    cnt.forEach((v, i) => {
      if (!v) return;
      const a = (acc / n) * 360, b = ((acc + v) / n) * 360;
      stops.push(`${cols[i]} ${a}deg ${b}deg`);
      acc += v;
    });
    const size = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56;
    return L.divIcon({
      html: `<div class="cl" style="--ring:conic-gradient(${stops.join(',')})"><b>${n >= 1000 ? fmtK(n) : n}</b></div>`,
      className: 'marker-cluster', iconSize: [size, size],
    });
  },
});
map.addLayer(cluster);

let meMarker = null;
function setMe(lat, lon) {
  S.me = { lat, lon };
  const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  if (meMarker) meMarker.setLatLng([lat, lon]);
  else meMarker = L.marker([lat, lon], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
}

function locate(fly = true) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('Localização indisponível'); return resolve(null); }
    $('#locBtn').classList.add('active');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe(p.coords.latitude, p.coords.longitude);
        if (fly) map.flyTo([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 13), { duration: 0.8 });
        resolve(S.me);
      },
      () => {
        $('#locBtn').classList.remove('active');
        toast('Não foi possível obter sua localização');
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

map.on('moveend', () => {
  const c = map.getCenter();
  store.set('view', [+c.lat.toFixed(5), +c.lng.toFixed(5), map.getZoom()]);
  updateCounter();
  $('#areaBtn').classList.toggle('hidden', map.getZoom() < 10 || S.placing);
});
map.on('dragstart', () => $('#locBtn').classList.remove('active'));
map.on('click', () => closeResults());

// ---------------------------------------------------------------- dados
function addStation(s) {
  S.all.set(s.i, s);
  let m = S.markers.get(s.i);
  if (m) {
    m.setLatLng([s.a, s.o]);
    m.options.k = visualCls(s);
    m.setIcon(ICONS[m.options.k][0]);
  } else {
    m = L.marker([s.a, s.o], { icon: ICONS[visualCls(s)][0], keyboard: false, k: visualCls(s) });
    m.on('click', () => openStation(s.i));
    S.markers.set(s.i, m);
  }
}
function removeStation(id) {
  const m = S.markers.get(id);
  if (m) cluster.removeLayer(m);
  S.markers.delete(id);
  S.all.delete(id);
}

async function loadData() {
  try {
    const r = await fetch('data/stations.json');
    const j = await r.json();
    S.generated = j.generated || '';
    for (const s of j.stations) addStation(s);
  } catch (e) {
    toast('Não foi possível carregar os dados do mapa');
  }
  for (const s of S.ocm) addStation(s);
  for (const s of S.live) addStation(s);
  for (const s of S.user) addStation(s);
  buildFilterUI();
  applyFilters(false);
  syncOcm();
}

// ---------------------------------------------------------------- filtros
function passes(s, f = S.f) {
  if (s.u) return true; // os seus pontos sempre aparecem
  if (!f.cls.includes(s.x)) return false;
  if (f.conn.length && !(s.c && f.conn.some((c) => s.c[c] || (c === 'type2' && s.c.type2) || (c === 'gbt_dc' && s.c.gbt_ac)))) return false;
  if (f.kw && !(s.p >= KW_STEPS[f.kw])) return false;
  if (f.op && norm(s.op) !== f.op) return false;
  if (f.free && s.f !== 0) return false;
  if (f.h24 && !(s.h && /24\s*\/\s*7|24\s*h/i.test(s.h))) return false;
  if (f.hidePrivate && (s.ac === 'private' || s.ac === 'no')) return false;
  return true;
}
const filterActive = (f = S.f) => f.cls.length < 4 || f.conn.length || f.kw || f.op || f.free || f.h24;

function applyFilters(save = true) {
  S.filtered = [];
  const layers = [];
  for (const s of S.all.values()) {
    if (passes(s)) { S.filtered.push(s); layers.push(S.markers.get(s.i)); }
  }
  cluster.clearLayers();
  cluster.addLayers(layers);
  if (save) store.set('filters', S.f);
  $('#filterDot').classList.toggle('hidden', !filterActive());
  renderChips();
  updateCounter();
  if (S.tab === 'near') renderNear();
}

function updateCounter() {
  const b = map.getBounds();
  let n = 0;
  for (const s of S.filtered) if (b.contains([s.a, s.o])) n++;
  $('#counter').innerHTML = `<span class="mono"><b>${fmt(n)}</b> na tela · ${fmt(S.filtered.length)} no total</span>`;
}

const QUICK = [
  { id: 'fast', l: 'Rápidos DC', c: 'var(--c1)', on: () => !S.f.cls.includes(0) && !S.f.cls.includes(3) && S.f.cls.length > 0,
    toggle: (v) => { S.f.cls = v ? [1, 2] : [0, 1, 2, 3]; } },
  { id: 'ultra', l: '100 kW+', c: 'var(--c2)', on: () => S.f.kw >= 5, toggle: (v) => { S.f.kw = v ? 5 : 0; } },
  { id: 'ccs2', l: 'CCS2', c: 'var(--yellow)', conn: 1 },
  { id: 'type2', l: 'Tipo 2', c: 'var(--green)', conn: 1 },
  { id: 'chademo', l: 'CHAdeMO', c: 'var(--blue)', conn: 1 },
  { id: 'gbt_dc', l: 'GB/T', c: 'var(--pink)', conn: 1 },
  { id: 'free', l: 'Gratuitos', c: 'var(--up)', on: () => S.f.free, toggle: (v) => { S.f.free = v; } },
  { id: 'h24', l: '24 horas', c: 'var(--violet)', on: () => S.f.h24, toggle: (v) => { S.f.h24 = v; } },
];
function renderChips() {
  const el = $('#chips');
  el.innerHTML = QUICK.map((q) => {
    const on = q.conn ? S.f.conn.includes(q.id) : q.on();
    return `<button class="chip${on ? ' on' : ''}" data-q="${q.id}" style="--cc:${q.c}"><i></i>${q.l}</button>`;
  }).join('') + (store.get('ocmKey', '') ? '' : '<button class="chip" data-q="more" style="--cc:var(--pink)"><i></i>+ Mais carregadores</button>') + (S.f.op ? `<button class="chip on" data-q="op" style="--cc:var(--text)"><i></i>${esc(opLabel(S.f.op))} ✕</button>` : '');
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const id = b.dataset.q;
  if (id === 'more') { openAbout(); return; }
  if (id === 'op') S.f.op = '';
  else {
    const q = QUICK.find((x) => x.id === id);
    if (q.conn) S.f.conn = S.f.conn.includes(id) ? S.f.conn.filter((c) => c !== id) : [...S.f.conn, id];
    else q.toggle(!q.on());
  }
  applyFilters();
});

let opNames = new Map(); // norm -> rótulo mais comum
const opLabel = (k) => opNames.get(k)?.label || k;
function buildFilterUI() {
  const counts = new Map();
  for (const s of S.all.values()) {
    if (!s.op) continue;
    const k = norm(s.op);
    const e = counts.get(k) || { n: 0, labels: {} };
    e.n++;
    e.labels[s.op] = (e.labels[s.op] || 0) + 1;
    counts.set(k, e);
  }
  opNames = new Map([...counts].map(([k, e]) => [k, { n: e.n, label: Object.entries(e.labels).sort((a, b) => b[1] - a[1])[0][0] }]));
  const ops = [...opNames].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n);
  $('#fOp').innerHTML = '<option value="">Todas as operadoras</option>' +
    ops.map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)} (${v.n})</option>`).join('');
  $('#opList').innerHTML = [...new Set([...OPERATORS, ...ops.slice(0, 40).map(([, v]) => v.label)])]
    .map((o) => `<option value="${esc(o)}">`).join('');
}

// folha de filtros (rascunho até "Mostrar")
let draft = null;
function openFilters() {
  draft = JSON.parse(JSON.stringify(S.f));
  renderDraft();
  openSheet('filterSheet');
}
function renderDraft() {
  $('#fClass').innerHTML = CLS.map((c, i) =>
    `<button class="tg${draft.cls.includes(i) ? ' on' : ''}" data-i="${i}" style="--cc:${c.c}"><i></i>${c.l}</button>`).join('');
  $('#fConn').innerHTML = MAIN_CONNS.map((k) =>
    `<button class="tg${draft.conn.includes(k) ? ' on' : ''}" data-k="${k}" style="--cc:${CONN[k].c}"><i></i>${CONN[k].n}</button>`).join('');
  $('#fKw').value = draft.kw;
  $('#fKwVal').textContent = draft.kw ? `≥ ${KW_STEPS[draft.kw]} kW` : 'qualquer';
  $('#fOp').value = draft.op;
  $('#fFree').checked = draft.free;
  $('#f24').checked = draft.h24;
  $('#fPublic').checked = draft.hidePrivate;
  let n = 0;
  for (const s of S.all.values()) if (passes(s, draft)) n++;
  $('#fCount').textContent = fmt(n);
}
$('#fClass').addEventListener('click', (e) => {
  const b = e.target.closest('.tg'); if (!b) return;
  const i = +b.dataset.i;
  draft.cls = draft.cls.includes(i) ? draft.cls.filter((x) => x !== i) : [...draft.cls, i].sort();
  renderDraft();
});
$('#fConn').addEventListener('click', (e) => {
  const b = e.target.closest('.tg'); if (!b) return;
  const k = b.dataset.k;
  draft.conn = draft.conn.includes(k) ? draft.conn.filter((x) => x !== k) : [...draft.conn, k];
  renderDraft();
});
$('#fKw').addEventListener('input', (e) => { draft.kw = +e.target.value; renderDraft(); });
$('#fOp').addEventListener('change', (e) => { draft.op = e.target.value; renderDraft(); });
$('#fFree').addEventListener('change', (e) => { draft.free = e.target.checked; renderDraft(); });
$('#f24').addEventListener('change', (e) => { draft.h24 = e.target.checked; renderDraft(); });
$('#fPublic').addEventListener('change', (e) => { draft.hidePrivate = e.target.checked; renderDraft(); });
$('#fReset').addEventListener('click', () => {
  draft = { cls: [0, 1, 2, 3], conn: [], kw: 0, op: '', free: false, h24: false, hidePrivate: true };
  renderDraft();
});
$('#fApply').addEventListener('click', () => { S.f = draft; applyFilters(); closeSheets(); });
$('#filterBtn').addEventListener('click', openFilters);

// ---------------------------------------------------------------- folhas (bottom sheets)
const sheetStack = [];
function openSheet(id) {
  const el = document.getElementById(id);
  if (!sheetStack.includes(id)) sheetStack.push(id);
  el.classList.add('on');
  el.querySelector('.sheet-body').scrollTop = 0;
  $('#backdrop').classList.add('on');
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('on');
  const i = sheetStack.indexOf(id);
  if (i >= 0) sheetStack.splice(i, 1);
  if (!sheetStack.length) $('#backdrop').classList.remove('on');
  if (id === 'stationSheet') selectMarker(null);
}
function closeSheets() { [...sheetStack].forEach(closeSheet); }
$('#backdrop').addEventListener('click', () => sheetStack.length && closeSheet(sheetStack[sheetStack.length - 1]));

// arrastar para baixo para fechar
$$('.sheet').forEach((sh) => {
  let y0 = null, dy = 0;
  const body = sh.querySelector('.sheet-body');
  sh.addEventListener('touchstart', (e) => {
    if (body.scrollTop > 0 && !e.target.classList.contains('grab')) return;
    y0 = e.touches[0].clientY; dy = 0;
    sh.style.transition = 'none';
  }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) sh.style.transform = `translateY(${dy}px)`;
    else { y0 = null; sh.style.transform = ''; sh.style.transition = ''; }
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    sh.style.transition = ''; sh.style.transform = '';
    if (dy > 110) closeSheet(sh.id);
    y0 = null;
  });
});

// ---------------------------------------------------------------- detalhes da estação
function selectMarker(id) {
  if (S.selected && S.markers.get(S.selected)) {
    const m = S.markers.get(S.selected);
    m.setIcon(ICONS[m.options.k][0]);
  }
  S.selected = id;
  if (id && S.markers.get(id)) {
    const m = S.markers.get(id);
    m.setIcon(ICONS[m.options.k][1]);
  }
}

const ACCESS = { private: 'Privado', customers: 'Só clientes', no: 'Fechado', permissive: 'Liberado', destination: 'Visitantes' };

function stationTitle(s) { return s.n || (s.op ? 'Eletroposto ' + s.op : 'Eletroposto'); }

function openStation(id, fly = false) {
  const s = S.all.get(id);
  if (!s) return;
  selectMarker(id);
  if (fly) {
    const z = Math.max(map.getZoom(), 16);
    map.flyTo([s.a - 0.0009 * Math.pow(2, 16 - z), s.o], z, { duration: 0.6 });
  }
  const k = visualCls(s);
  const dist = S.me ? distTxt(haversine(S.me.lat, S.me.lon, s.a, s.o)) : null;
  const conns = Object.entries(s.c || {});
  const cks = S.checkins[id] || [];
  const fav = S.favs.has(id);

  const rows = [];
  if (s.h) rows.push(['Horário', esc(s.h === '24/7' ? 'Aberto 24 horas' : s.h)]);
  rows.push(['Custo', s.f === 0 ? '<span style="color:var(--up)">Gratuito</span>' : s.f === 1 ? (s.pr ? esc(s.pr) : 'Pago') : (s.pr ? esc(s.pr) : 'Não informado')]);
  if (s.ac) rows.push(['Acesso', ACCESS[s.ac] || esc(s.ac)]);
  if (s.q) rows.push(['Vagas', s.q]);
  if (s.ph) rows.push(['Telefone', `<a href="tel:${esc(s.ph.replace(/[^\d+]/g, ''))}">${esc(s.ph)}</a>`]);
  if (s.w) rows.push(['Site', `<a href="#" data-url="${esc(/^https?:/.test(s.w) ? s.w : 'https://' + s.w)}">${esc(s.w.replace(/^https?:\/\//, '').slice(0, 40))}</a>`]);
  if (s.d) rows.push(['Obs.', esc(s.d)]);

  $('#stationBody').innerHTML = `
    <div class="st-head ${'k' + k}">
      <div style="min-width:0">
        <div class="label">${esc(s.op || 'Operadora não informada')}${dist ? ' · ' + dist : ''}</div>
        <h2>${esc(stationTitle(s))}</h2>
        ${s.ad ? `<div class="st-addr">${esc(s.ad)}</div>` : ''}
      </div>
    </div>
    <div class="st-power k${k}">
      ${s.p ? `<div class="big">${kwTxt(s.p)}</div><div class="unit">kW máx</div>` : '<div class="big" style="color:var(--dim)">?</div><div class="unit">potência não informada</div>'}
      <div class="kbadge">${s.u ? 'SEU PONTO' : CLS[s.x].l.toUpperCase()}</div>
    </div>
    <div class="glow-rule k${k}" style="background:linear-gradient(90deg,var(--kc),transparent)"></div>

    <div class="label" style="margin-bottom:8px">CONECTORES</div>
    ${conns.length ? `<div class="conns">${conns.map(([c, n]) => `
      <div class="conn">
        <div class="nm">${esc(CONN[c]?.n || c)}</div>
        <div class="sub"><b>${n}×</b>${s.k && s.k[c] ? ' · ' + kwTxt(s.k[c]) + ' kW' : ''} · ${CONN[c]?.dc ? 'DC' : 'AC'}</div>
      </div>`).join('')}</div>` : '<div class="st-addr">Tipos de conector não informados.</div>'}

    <div class="info">${rows.map(([a, b]) => `<div><span class="k">${a}</span><span class="v">${b}</span></div>`).join('')}</div>

    <div class="actions">
      <button class="btn primary wide" data-act="nav">
        <svg class="ico" viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z"/></svg>Traçar rota</button>
      <button class="btn" data-act="waze">Waze</button>
      <button class="btn${fav ? ' on' : ''}" data-act="fav">
        <svg class="ico" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>${fav ? 'Salvo' : 'Salvar'}</button>
      <button class="btn" data-act="share">Compartilhar</button>
      ${s.u ? '<button class="btn bad" data-act="del">Excluir ponto</button>' : s.i[0] === 'c' ? '<button class="btn" data-act="ocm">Ver no OCM</button>' : '<button class="btn" data-act="osm">Corrigir no OSM</button>'}
    </div>

    <div class="checkins">
      <div class="label">CHECK-INS${cks.length ? ' · ' + cks.length : ''}</div>
      <div class="ck-btns">
        <button class="btn ok" data-act="ck-ok">✓ Carreguei aqui</button>
        <button class="btn bad" data-act="ck-bad">✕ Com problema</button>
      </div>
      <div>${cks.slice().reverse().slice(0, 6).map((c) => `
        <div class="ck"><i style="background:${c.ok ? 'var(--up)' : 'var(--down)'};box-shadow:0 0 8px ${c.ok ? 'var(--up)' : 'var(--down)'}"></i>
        <div><div>${c.ok ? 'Funcionou' : 'Com problema'}${c.note ? ' — ' + esc(c.note) : ''}</div>
        <div class="when">${new Date(c.t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div></div></div>`).join('')}</div>
    </div>

    <div class="src">${s.u ? 'Adicionado por você · salvo neste aparelho' : s.i[0] === 'c' ? `Fonte: Open Charge Map #${esc(s.i.slice(1))} (CC BY 4.0)` : `Fonte: OpenStreetMap ${esc(s.i)} · © colaboradores do OSM (ODbL)`}</div>
  `;
  $('#stationBody').dataset.id = id;
  openSheet('stationSheet');
}

$('#stationBody').addEventListener('click', (e) => {
  const a = e.target.closest('[data-url]');
  if (a) { e.preventDefault(); openUrl(a.dataset.url); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = $('#stationBody').dataset.id;
  const s = S.all.get(id);
  if (!s) return;
  switch (b.dataset.act) {
    case 'nav': openUrl(`https://www.google.com/maps/dir/?api=1&destination=${s.a},${s.o}`); break;
    case 'waze': openUrl(`https://waze.com/ul?ll=${s.a},${s.o}&navigate=yes`); break;
    case 'osm': {
      const type = s.i[0] === 'w' ? 'way' : 'node';
      openUrl(`https://www.openstreetmap.org/${type}/${s.i.slice(1)}`); break;
    }
    case 'ocm': openUrl(`https://map.openchargemap.io/?id=${s.i.slice(1)}`); break;
    case 'share': {
      const txt = `${stationTitle(s)}${s.p ? ' · ' + kwTxt(s.p) + ' kW' : ''}\nhttps://www.google.com/maps/search/?api=1&query=${s.a},${s.o}`;
      if (window.Android && Android.share) Android.share(txt);
      else if (navigator.share) navigator.share({ text: txt }).catch(() => {});
      else { navigator.clipboard?.writeText(txt); toast('Copiado'); }
      break;
    }
    case 'fav':
      if (S.favs.has(id)) S.favs.delete(id); else S.favs.add(id);
      store.set('favs', [...S.favs]);
      toast(S.favs.has(id) ? 'Salvo nos seus pontos' : 'Removido dos salvos');
      openStation(id);
      break;
    case 'ck-ok':
    case 'ck-bad': {
      const ok = b.dataset.act === 'ck-ok';
      const note = prompt(ok ? 'Comentário (opcional): como foi a recarga?' : 'O que aconteceu? (opcional)') || '';
      (S.checkins[id] = S.checkins[id] || []).push({ t: Date.now(), ok, note: note.slice(0, 140) });
      store.set('ck', S.checkins);
      toast('Check-in registrado');
      openStation(id);
      break;
    }
    case 'del':
      if (!confirm('Excluir este ponto que você adicionou?')) return;
      S.user = S.user.filter((u) => u.i !== id);
      store.set('user', S.user);
      S.favs.delete(id); store.set('favs', [...S.favs]);
      closeSheet('stationSheet');
      removeStation(id);
      applyFilters(false);
      toast('Ponto excluído');
      break;
  }
});

// ---------------------------------------------------------------- busca
let searchT;
const qEl = $('#q');
qEl.addEventListener('input', () => {
  $('#qClear').classList.toggle('hidden', !qEl.value);
  clearTimeout(searchT);
  searchT = setTimeout(renderSearch, 160);
});
qEl.addEventListener('focus', () => qEl.value && renderSearch());
qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); geocode(qEl.value); } });
$('#qClear').addEventListener('click', () => { qEl.value = ''; $('#qClear').classList.add('hidden'); closeResults(); });
function closeResults() { $('#results').classList.add('hidden'); }

function renderSearch() {
  const q = norm(qEl.value);
  const el = $('#results');
  if (q.length < 2) { closeResults(); return; }
  const words = q.split(/\s+/);
  const hits = [];
  const cities = new Map();
  for (const s of S.all.values()) {
    const hay = norm([s.n, s.op, s.ad, s.ci].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    if (s.ci && norm(s.ci).includes(q)) {
      const c = cities.get(s.ci) || []; c.push(s); cities.set(s.ci, c);
    }
    if (hits.length < 40) hits.push(s);
  }
  if (S.me) hits.sort((a, b) => haversine(S.me.lat, S.me.lon, a.a, a.o) - haversine(S.me.lat, S.me.lon, b.a, b.o));
  const cityRows = [...cities].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  el.innerHTML =
    cityRows.map(([c, list]) => `<button class="res" data-city="${esc(c)}">
      <div class="badge-ico"><svg class="ico" viewBox="0 0 24 24"><path d="M4 21V9l5-3v15M9 21V4l11 4v13M4 21h16"/></svg></div>
      <div><div class="t">${esc(c)}</div><div class="s">${list.length} carregadores na cidade</div></div></button>`).join('') +
    hits.slice(0, 8).map((s) => `<button class="res" data-id="${esc(s.i)}">
      <div class="badge-ico k${visualCls(s)}" style="color:var(--kc)"><svg class="ico" viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg></div>
      <div><div class="t">${esc(stationTitle(s))}</div><div class="s">${esc([s.op, s.ad || s.ci].filter(Boolean).join(' · ') || CLS[s.x].l)}</div></div>
      ${S.me ? `<span class="mono" style="font-size:11px;color:var(--muted)">${distTxt(haversine(S.me.lat, S.me.lon, s.a, s.o))}</span>` : ''}</button>`).join('') +
    `<button class="res" data-geo="1">
      <div class="badge-ico"><svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></div>
      <div><div class="t">Procurar “${esc(qEl.value)}” no mapa</div><div class="s">Endereço, bairro ou cidade (requer internet)</div></div></button>`;
  el.classList.remove('hidden');
}
$('#results').addEventListener('click', (e) => {
  const b = e.target.closest('.res'); if (!b) return;
  qEl.blur();
  closeResults();
  if (b.dataset.id) { setTab('map'); openStation(b.dataset.id, true); }
  else if (b.dataset.city) {
    const pts = [...S.all.values()].filter((s) => s.ci === b.dataset.city).map((s) => [s.a, s.o]);
    setTab('map');
    map.flyToBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 14, duration: 0.8 });
  } else if (b.dataset.geo) geocode(qEl.value);
  else if (b.dataset.lat) {
    setTab('map');
    if (b.dataset.bb) {
      const bb = b.dataset.bb.split(',').map(Number);
      map.flyToBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 15, duration: 0.8 });
    } else map.flyTo([+b.dataset.lat, +b.dataset.lon], 14, { duration: 0.8 });
  }
});

async function geocode(q) {
  if (!q.trim()) return;
  const el = $('#results');
  el.innerHTML = '<div class="res-head label">PROCURANDO…</div>';
  el.classList.remove('hidden');
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=6&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
    const list = await r.json();
    if (!list.length) { el.innerHTML = '<div class="res-head label">NADA ENCONTRADO</div>'; return; }
    el.innerHTML = '<div class="res-head label">LUGARES</div>' + list.map((p) => `<button class="res" data-lat="${p.lat}" data-lon="${p.lon}" data-bb="${(p.boundingbox || []).join(',')}">
      <div class="badge-ico"><svg class="ico" viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg></div>
      <div><div class="t">${esc(p.name || p.display_name.split(',')[0])}</div><div class="s">${esc(p.display_name)}</div></div></button>`).join('');
  } catch {
    el.innerHTML = '<div class="res-head label">SEM CONEXÃO — BUSCA DE ENDEREÇOS INDISPONÍVEL</div>';
  }
}

// ---------------------------------------------------------------- atualizar área (Overpass)
$('#areaBtn').addEventListener('click', async () => {
  const btn = $('#areaBtn');
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  const b = map.getBounds();
  const bb = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  const q = `[out:json][timeout:25];(node["amenity"="charging_station"](${bb});way["amenity"="charging_station"](${bb}););out center tags;`;
  let data = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) { data = await r.json(); break; }
    } catch { /* tenta o próximo servidor */ }
  }
  let ocmList = null;
  try { ocmList = await ocmFetch({ boundingbox: `(${b.getNorth()},${b.getWest()}),(${b.getSouth()},${b.getEast()})`, maxresults: '2000' }); } catch { /* opcional */ }
  btn.classList.remove('loading');
  if (!data && !ocmList) { toast('Não foi possível atualizar agora. Tente de novo.'); return; }
  data = data || { elements: [] };
  let added = 0, updated = 0;
  if (ocmList) {
    const byId = new Map(S.ocm.map((x) => [x.i, x]));
    for (const s of ocmList) {
      if (s.off) continue;
      if (S.all.has(s.i)) updated++; else added++;
      addStation(s); byId.set(s.i, s);
    }
    S.ocm = [...byId.values()];
    store.set('ocm', S.ocm);
  }
  const liveById = new Map(S.live.map((s) => [s.i, s]));
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const s = fromOsm((el.type === 'way' ? 'w' : 'n') + el.id, lat, lon, el.tags || {});
    if (S.all.has(s.i)) updated++; else added++;
    addStation(s);
    liveById.set(s.i, s);
  }
  S.live = [...liveById.values()].slice(-6000);
  store.set('live', S.live);
  applyFilters(false);
  toast(added ? `${added} novo${added > 1 ? 's' : ''} carregador${added > 1 ? 'es' : ''} nesta área` : `Área atualizada · ${updated} pontos conferidos`);
});

// ---------------------------------------------------------------- adicionar ponto
$('#addBtn').addEventListener('click', () => {
  S.placing = true;
  closeSheets();
  if (map.getZoom() < 15) {
    const c = S.me ? [S.me.lat, S.me.lon] : map.getCenter();
    map.setView(c, 16);
  }
  $('#crosshair').classList.remove('hidden');
  $('#placeBar').classList.remove('hidden');
  $('#mapUi').classList.add('hidden');
  $('#top').classList.add('hidden');
});
function endPlacing() {
  S.placing = false;
  $('#crosshair').classList.add('hidden');
  $('#placeBar').classList.add('hidden');
  $('#mapUi').classList.remove('hidden');
  $('#top').classList.remove('hidden');
}
$('#placeCancel').addEventListener('click', endPlacing);
let addConn = [];
$('#placeOk').addEventListener('click', () => {
  const c = map.getCenter();
  $('#addForm').reset();
  $('#addForm').dataset.lat = c.lat;
  $('#addForm').dataset.lon = c.lng;
  $('#addCoords').textContent = `NOVO · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  addConn = [];
  renderAddConn();
  endPlacing();
  openSheet('addSheet');
});
function renderAddConn() {
  $('#addConn').innerHTML = MAIN_CONNS.map((k) =>
    `<button type="button" class="tg${addConn.includes(k) ? ' on' : ''}" data-k="${k}" style="--cc:${CONN[k].c}"><i></i>${CONN[k].n}</button>`).join('');
}
$('#addConn').addEventListener('click', (e) => {
  const b = e.target.closest('.tg'); if (!b) return;
  const k = b.dataset.k;
  addConn = addConn.includes(k) ? addConn.filter((x) => x !== k) : [...addConn, k];
  renderAddConn();
});
$('#addCancel').addEventListener('click', () => closeSheet('addSheet'));
$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const s = { i: 'u' + Date.now().toString(36), u: 1, a: +(+e.target.dataset.lat).toFixed(6), o: +(+e.target.dataset.lon).toFixed(6) };
  s.n = fd.get('n').trim();
  if (fd.get('op').trim()) s.op = fd.get('op').trim();
  const p = parseFloat(String(fd.get('p')).replace(',', '.'));
  if (p > 0) s.p = p;
  if (addConn.length) s.c = Object.fromEntries(addConn.map((k) => [k, 1]));
  const q = parseInt(fd.get('q'), 10);
  if (q > 0) s.q = q;
  if (fd.get('h').trim()) s.h = fd.get('h').trim();
  if (fd.get('free')) s.f = 0;
  if (fd.get('d').trim()) s.d = fd.get('d').trim();
  s.x = classify(s.p, s.c);
  S.user.push(s);
  if (!store.set('user', S.user)) toast('Atenção: não foi possível salvar no aparelho');
  addStation(s);
  applyFilters(false);
  closeSheet('addSheet');
  toast('Carregador adicionado ao mapa');
  setTimeout(() => openStation(s.i), 300);
});

// ---------------------------------------------------------------- abas
function setTab(t) {
  S.tab = t;
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['near', 'stats', 'saved'].forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== t));
  closeResults();
  if (t === 'near') renderNear();
  if (t === 'stats') renderStats();
  if (t === 'saved') renderSaved();
  if (t === 'map') setTimeout(() => map.invalidateSize(), 50);
}
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setTab(b.dataset.tab);
});

function itemHtml(s, ref) {
  const k = visualCls(s);
  const conns = Object.keys(s.c || {}).slice(0, 4).map((c) => `<span class="tag">${esc(CONN[c]?.n || c)}</span>`).join('');
  return `<button class="item k${k}" data-id="${esc(s.i)}">
    <div class="kw">${s.p ? `<b>${kwTxt(s.p)}</b><span>kW</span>` : `<svg class="ico" viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg><span>${CLS[s.x].n === '?' ? 'n/d' : CLS[s.x].n}</span>`}</div>
    <div class="meta">
      <div class="t">${esc(stationTitle(s))}</div>
      <div class="s">${esc([s.op, s.ad || s.ci].filter(Boolean).join(' · ') || CLS[s.x].l)}</div>
      <div class="tags">${conns}${s.f === 0 ? '<span class="tag g">grátis</span>' : ''}${s.h === '24/7' ? '<span class="tag">24h</span>' : ''}</div>
    </div>
    ${ref ? `<div class="dist">${distTxt(haversine(ref.lat, ref.lon, s.a, s.o))}</div>` : ''}
  </button>`;
}
function bindList(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (b) { setTab('map'); openStation(b.dataset.id, true); }
  });
}

// perto
let nearMode = 'all';
$('#nearSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  nearMode = b.dataset.v;
  $$('#nearSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderNear();
});
$('#nearLocate').addEventListener('click', async () => { if (await locate(false)) renderNear(); });
function renderNear() {
  const c = map.getCenter();
  const ref = S.me || { lat: c.lat, lon: c.lng };
  $('#nearFrom').textContent = S.me ? 'A PARTIR DA SUA LOCALIZAÇÃO' : 'A PARTIR DO CENTRO DO MAPA';
  const list = S.filtered
    .filter((s) => nearMode === 'all' || (nearMode === 'fast' ? s.x === 1 || s.x === 2 : s.f === 0))
    .map((s) => [haversine(ref.lat, ref.lon, s.a, s.o), s])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 60);
  $('#nearList').innerHTML = list.length
    ? list.map(([, s]) => itemHtml(s, ref)).join('')
    : '<div class="empty"><div class="glow-line"></div>Nenhum carregador com esses filtros.</div>';
}
bindList($('#nearList'));

// ---------------------------------------------------------------- painel (gráficos)
function smoothPath(pts, base, up = true) {
  const cl = (y) => (base == null ? y : up ? Math.min(y, base) : Math.max(y, base));
  // Catmull-Rom -> Bézier, para curvas suaves como no layout de referência
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, cl(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, cl(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function waveChart(all) {
  // eixo X: faixas de latitude de norte (+6°) a sul (-34°); curvas = conectores (em cima)
  // e classes de potência espelhadas (embaixo, em cinza)
  const bands = [];
  for (let lat = 6; lat > -34; lat -= 4) bands.push(lat);
  const series = [
    { k: 'ccs2', c: '#f5c84c' }, { k: 'type2', c: '#5ee6a0' }, { k: 'chademo', c: '#5aa9ff' },
    { k: 'gbt_dc', c: '#ff6fa8' }, { k: 'tesla', c: '#a78bfa' },
  ];
  const top = series.map(() => bands.map(() => 0));
  const bottom = [0, 1, 2].map(() => bands.map(() => 0));
  for (const s of all) {
    const bi = Math.min(bands.length - 1, Math.max(0, Math.floor((6 - s.a) / 4)));
    series.forEach((se, i) => { if (s.c && (s.c[se.k] || (se.k === 'gbt_dc' && s.c.gbt_ac))) top[i][bi]++; });
    if (s.x < 3) bottom[s.x][bi]++;
  }
  const W = 360, padL = 34, padR = 10, mid = 150, hTop = 120, hBot = 70;
  const maxT = Math.max(1, ...top.flat()), maxB = Math.max(1, ...bottom.flat());
  const niceT = Math.ceil(maxT / 4 / Math.pow(10, Math.floor(Math.log10(maxT / 4)))) * Math.pow(10, Math.floor(Math.log10(maxT / 4))) * 4 || 4;
  const x = (i) => padL + (i / (bands.length - 1)) * (W - padL - padR);
  const yT = (v) => mid - (v / niceT) * hTop;
  const yB = (v) => mid + 8 + (v / maxB) * hBot;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${mid + hBot + 26}" role="img" aria-label="Distribuição de conectores de norte a sul">
    <defs><filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  for (let g = 0; g <= 4; g++) {
    const v = (niceT / 4) * g, y = yT(v);
    svg += `<text x="4" y="${y + 3}">${fmtK(v)}</text>`;
  }
  [1, 3, 5, 7, 9].forEach((i) => {
    const lat = bands[i] - 2;
    svg += `<text x="${x(i)}" y="${mid + 4}" text-anchor="middle">${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}</text>`;
  });
  bottom.forEach((row, i) => {
    const pts = row.map((v, j) => [x(j), yB(v)]);
    svg += `<path d="${smoothPath(pts, mid + 8, false)}" fill="none" stroke="rgba(255,255,255,${0.22 + i * 0.12})" stroke-width="1.3"/>`;
  });
  top.forEach((row, i) => {
    const pts = row.map((v, j) => [x(j), yT(v)]);
    svg += `<path d="${smoothPath(pts, mid, true)}" fill="none" stroke="${series[i].c}" stroke-width="2.2" stroke-linecap="round" filter="url(#glow)"/>`;
  });
  svg += `<text x="${padL}" y="${mid + hBot + 22}">NORTE</text><text x="${W - padR}" y="${mid + hBot + 22}" text-anchor="end">SUL</text></svg>`;
  return svg + `<div class="legend">${series.map((s) => `<span style="--lc:${s.c}"><i></i>${CONN[s.k].n}</span>`).join('')}
    <span style="--lc:rgba(255,255,255,.5)"><i></i>AC · DC · Ultra (abaixo)</span></div>`;
}

function renderStats() {
  const all = [...S.all.values()];
  const n = all.length;
  const cls = [0, 0, 0, 0];
  let plugs = 0, free = 0;
  const ops = new Map();
  for (const s of all) {
    cls[s.x]++;
    plugs += Object.values(s.c || {}).reduce((a, b) => a + b, 0) || 1;
    if (s.f === 0) free++;
    if (s.op) { const k = norm(s.op); ops.set(k, (ops.get(k) || 0) + 1); }
  }
  const fast = cls[1] + cls[2];
  const topOps = [...ops].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxOp = topOps[0]?.[1] || 1;
  const nCk = Object.values(S.checkins).reduce((a, b) => a + b.length, 0);
  $('#statsSub').textContent = `DADOS OSM · ${S.generated ? S.generated.split('-').reverse().join('/') : ''}`;

  $('#statsBody').innerHTML = `
    <div class="cards2">
      <div class="card"><div class="label">Carregadores</div><div class="big">${fmt(n)}</div>
        <div class="delta"><b>+${S.user.length + S.live.length}</b> atualizados por você</div></div>
      <div class="card"><div class="label">Rápidos · DC</div><div class="big">${fmt(fast)}</div>
        <div class="delta"><b>${n ? Math.round((fast / n) * 100) : 0}%</b> do total</div></div>
    </div>
    <div class="card chart-card">
      <div class="pad"><div class="label">Pontos de recarga</div>
      <div class="big">${fmt(plugs)}</div>
      <div class="delta"><b>${fmt(free)}</b> gratuitos · conectores de norte a sul</div></div>
      ${waveChart(all)}
    </div>
    <div class="card" style="margin-top:10px">
      <div class="label">Potência</div>
      <div class="segbar">${cls.map((v, i) => v ? `<i style="flex:${v};--sc:${CLS[i].c}"></i>` : '').join('')}</div>
      <div class="legend" style="padding:0">${cls.map((v, i) => `<span style="--lc:${CLS[i].c}"><i></i>${CLS[i].l} · ${fmt(v)}</span>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="label" style="margin-bottom:4px">Maiores operadoras</div>
      ${topOps.map(([k, v]) => `<button class="bar-row" data-op="${esc(k)}" style="width:100%;text-align:left">
        <span class="nm">${esc(opLabel(k))}</span><span class="vl">${fmt(v)}</span>
        <span class="tr"><i style="width:${(v / maxOp) * 100}%"></i></span></button>`).join('') || '<div class="st-addr">Sem dados de operadora.</div>'}
    </div>
    <div class="cards2" style="margin-top:10px">
      <div class="card"><div class="label">Seus check-ins</div><div class="big">${nCk}</div></div>
      <div class="card"><div class="label">Pontos salvos</div><div class="big">${S.favs.size}</div></div>
    </div>`;
}
$('#statsBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-op]');
  if (!b) return;
  S.f.op = b.dataset.op;
  applyFilters();
  setTab('map');
  const pts = S.filtered.filter((s) => norm(s.op) === S.f.op).map((s) => [s.a, s.o]);
  if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.1), { maxZoom: 13, duration: 0.8 });
});

// ---------------------------------------------------------------- salvos
function renderSaved() {
  const favs = [...S.favs].map((id) => S.all.get(id)).filter(Boolean);
  const ref = S.me;
  $('#savedBody').innerHTML = `
    <div class="label section-t" style="margin-top:0">FAVORITOS · ${favs.length}</div>
    <div class="list">${favs.length ? favs.map((s) => itemHtml(s, ref)).join('')
      : '<div class="empty"><div class="glow-line"></div>Toque em “Salvar” num carregador para guardá-lo aqui.</div>'}</div>
    <div class="label section-t">ADICIONADOS POR VOCÊ · ${S.user.length}</div>
    <div class="list">${S.user.length ? S.user.map((s) => itemHtml(s, ref)).join('')
      : '<div class="empty"><div class="glow-line"></div>Use o botão + no mapa para cadastrar um carregador que ainda não aparece.</div>'}</div>
    <div class="actions" style="margin-top:18px">
      <button class="btn" id="exportBtn">Exportar meus dados</button>
      <button class="btn" id="aboutBtn">Sobre o app</button>
    </div>`;
  bindListOnce($('#savedBody'));
  $('#exportBtn').onclick = () => {
    const data = JSON.stringify({ adicionados: S.user, favoritos: [...S.favs], checkins: S.checkins }, null, 1);
    if (window.Android && Android.share) Android.share(data);
    else { navigator.clipboard?.writeText(data); toast('Dados copiados'); }
  };
  $('#aboutBtn').onclick = openAbout;
}
const bound = new WeakSet();
function bindListOnce(el) { if (!bound.has(el)) { bound.add(el); bindList(el); } }

function openAbout() {
  $('#aboutBody').innerHTML = `<div class="about">
    <div class="label">SOBRE</div><h2>Eletrovia 1.0</h2>
    <p>Mapa colaborativo de carregadores para veículos elétricos. ${fmt(S.all.size)} pontos no aparelho
    (snapshot de ${S.generated ? S.generated.split('-').reverse().join('/') : '—'}). Use “Atualizar esta área” no mapa para buscar novidades.</p>
    <p>Dados de carregadores: © colaboradores do <a href="#" data-url="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, licença ODbL.
    Mapa base: © Esri, HERE, Garmin e colaboradores do OpenStreetMap. Busca de endereços: Nominatim.</p>
    <p>Pontos adicionados, favoritos e check-ins ficam salvos só neste aparelho. Para que todos vejam um ponto novo,
    cadastre-o também no OpenStreetMap.</p>
    <p>Visual inspirado no estilo “unslop” (CC BY 4.0).</p>
    <div class="card" style="margin-top:16px">
      <div class="label">OPEN CHARGE MAP · ${S.ocm.length ? fmt(S.ocm.length) + ' PONTOS NO APARELHO' : 'DESATIVADO'}</div>
      <p style="margin:8px 0 12px">Para encher o mapa com milhares de carregadores (Tupi, VAPT, Shell, Zletric e outros),
      crie uma chave grátis em <a href="#" data-url="https://openchargemap.org/site/developerinfo">openchargemap.org</a>
      (Minha conta → Meus aplicativos → Registrar) e cole aqui.</p>
      <label class="field" style="margin-bottom:10px"><input id="ocmKey" placeholder="Cole sua chave da API" value="${esc(store.get('ocmKey', ''))}" autocomplete="off" spellcheck="false"></label>
      <button class="btn primary block" id="ocmSave" style="margin-top:0">Salvar e baixar dados</button>
    </div>
    <p style="font-size:12px">Dados do Open Charge Map: CC BY 4.0, openchargemap.org.</p>
  </div>`;
  $('#ocmSave').onclick = async () => {
    const k = $('#ocmKey').value.trim();
    store.set('ocmKey', k);
    if (!k) { toast('Chave removida'); return; }
    $('#ocmSave').textContent = 'Baixando…';
    const ok = await syncOcm(true);
    $('#ocmSave').textContent = ok ? 'Atualizado ✓' : 'Salvar e baixar dados';
  };
  openSheet('aboutSheet');
}
$('#aboutBody').addEventListener('click', (e) => {
  const a = e.target.closest('[data-url]');
  if (a) { e.preventDefault(); openUrl(a.dataset.url); }
});

// ---------------------------------------------------------------- botão voltar (Android)
window.onAndroidBack = () => {
  if (!$('#results').classList.contains('hidden')) { closeResults(); qEl.blur(); return true; }
  if (sheetStack.length) { closeSheet(sheetStack[sheetStack.length - 1]); return true; }
  if (S.placing) { endPlacing(); return true; }
  if (S.tab !== 'map') { setTab('map'); return true; }
  return false;
};

$('#locBtn').addEventListener('click', () => locate(true));

// ---------------------------------------------------------------- início
loadData().then(() => {
  // centraliza no usuário na primeira abertura, se ele permitir
  if (!lastView) locate(true);
});
})();
