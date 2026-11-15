/* Мостик – портал дашбордов Айсберг 8 (most.iceberg8.ru)
   Данные и права – Supabase: каждый пользователь получает только то, что ему разрешено,
   фильтрация делается на стороне базы (функции most_*). */
"use strict";

const CONFIG = {
  url: "https://zbfywzattceseyajtuno.supabase.co",
  key: "sb_publishable_RBcl-kbni198r5-psLfamQ_tMDKQD3c",
};
const sb = supabase.createClient(CONFIG.url, CONFIG.key);

// Ответственные Омского отдела по умолчанию для роли РОП (можно изменить в админке)
const OMSK_SEGMENTS = ["Марендыч", "Шклярук", "Гордеев", "Трифонов", "Сети (Королькова)", "Не распределено"];
const ROLE_NAMES = { admin: "Администратор", rop: "РОП", manager: "Менеджер", marketing: "Маркетинг" };
const ROLE_PRESETS = {
  admin:     { segments: null,          show_margin: true,  show_clients: true,  show_people: true,  only_rnd: false },
  rop:       { segments: OMSK_SEGMENTS, show_margin: false, show_clients: true,  show_people: true,  only_rnd: false },
  manager:   { segments: [],            show_margin: false, show_clients: true,  show_people: true,  only_rnd: false },
  marketing: { segments: null,          show_margin: false, show_clients: false, show_people: false, only_rnd: true },
};
// Индексы полей строки данных
const F = { d: 0, seg: 1, mgr: 2, cat: 3, prod: 4, cli: 5, qty: 6, kg: 7, rev: 8, mg: 9 };
const DIM = {
  seg:  { idx: F.seg,  title: "Ответственный" },
  mgr:  { idx: F.mgr,  title: "Менеджер" },
  cli:  { idx: F.cli,  title: "Клиент" },
  cat:  { idx: F.cat,  title: "Категория" },
  prod: { idx: F.prod, title: "Товар" },
};

const S = {
  me: null, meta: null, tab: "overview",
  preset: "month", from: null, to: null,
  filters: {},          // { seg: "...", cli: "..." }
  cur: [], prev: [], monthly: false, prevFrom: null, prevTo: null,
  sort: {}, charts: [],
};

/* ---------- утилиты ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
function money(v) {
  if (v == null || isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return nf1.format(v / 1e9) + " млрд ₽";
  if (a >= 1e6) return nf1.format(v / 1e6) + " млн ₽";
  if (a >= 1e4) return nf0.format(v / 1e3) + " тыс ₽";
  return nf0.format(v) + " ₽";
}
const rub = (v) => (v == null ? "–" : nf0.format(v) + " ₽");
const kg = (v) => (v == null ? "–" : nf0.format(v) + " кг");
const pct = (v) => (v == null || !isFinite(v) ? "–" : nf1.format(v) + "%");
function delta(cur, prev) {
  if (!prev) return { txt: "нет данных для сравнения", cls: "" };
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return { txt: (d >= 0 ? "+" : "") + nf1.format(d) + "% к пред. периоду", cls: d >= 0 ? "up" : "down", v: d };
}
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const ruDate = (s) => (s ? s.split("-").reverse().join(".") : "");
const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 3500); }
function loading(on) { $("loader").classList.toggle("hidden", !on); }
function genPassword() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", d = "23456789";
  const r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  let p = ""; for (let i = 0; i < 9; i++) p += r(a); for (let i = 0; i < 3; i++) p += r(d);
  return p;
}

/* ---------- вход ---------- */
async function boot() {
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(); else showLogin();
}
function showLogin() { $("app").classList.add("hidden"); $("login").classList.remove("hidden"); }

$("loginForm").onsubmit = async (e) => {
  e.preventDefault(); $("lErr").textContent = "";
  loading(true);
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  loading(false);
  if (error) { $("lErr").textContent = "Неверная почта или пароль"; return; }
  await enter();
};
$("bootLink").onclick = (e) => { e.preventDefault(); $("loginForm").classList.toggle("hidden"); $("bootForm").classList.toggle("hidden"); };
$("bootForm").onsubmit = async (e) => {
  e.preventDefault(); $("bErr").textContent = "";
  const email = $("bEmail").value.trim(), password = $("bPass").value;
  loading(true);
  const { data, error } = await sb.functions.invoke("most-admin", { body: { action: "bootstrap", code: $("bCode").value, email, password, full_name: $("bName").value.trim() } });
  if (error || data?.error) { loading(false); $("bErr").textContent = (await fnError(error, data)); return; }
  const r = await sb.auth.signInWithPassword({ email, password });
  loading(false);
  if (r.error) { $("bErr").textContent = "Учётная запись создана, войдите с почтой и паролем"; return; }
  await enter();
};
async function fnError(error, data) {
  if (data?.error) return data.error;
  try { const j = await error.context.json(); return j.error || error.message; } catch { return error?.message || "Ошибка"; }
}

async function enter() {
  loading(true);
  const [me, meta] = await Promise.all([sb.rpc("most_me"), sb.rpc("most_meta")]);
  loading(false);
  if (me.error || !me.data) {
    await sb.auth.signOut();
    showLogin(); $("lErr").textContent = "Доступ к Мостику не выдан или отключён. Обратитесь к администратору.";
    return;
  }
  S.me = me.data; S.meta = meta.data || {};
  if (S.me.dash) S.tab = "dash";
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userBtn").textContent = shortName(S.me.full_name) + " ▾";
  renderTabs(); renderPeriods(); renderFresh();
  await setPreset(S.preset);
}
const shortName = (n) => { const p = String(n || "").split(/\s+/); return p.length >= 2 ? `${p[1]} ${p[0][0]}.` : n; };

$("userBtn").onclick = () => $("userMenu").classList.toggle("hidden");
document.addEventListener("click", (e) => { if (!e.target.closest(".user")) $("userMenu").classList.add("hidden"); });
$("logoutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };
$("pwBtn").onclick = () => {
  $("userMenu").classList.add("hidden");
  openModal(`<h2>Сменить пароль</h2>
    <label>Новый пароль (от 10 символов, буквы и цифры)<input type="password" id="np1" autocomplete="new-password"></label>
    <label>Повторите пароль<input type="password" id="np2" autocomplete="new-password"></label>
    <p class="err" id="npErr"></p>
    <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn primary" id="npSave">Сохранить</button></div>`);
  $("npSave").onclick = async () => {
    const a = $("np1").value, b = $("np2").value;
    if (a !== b) return ($("npErr").textContent = "Пароли не совпадают");
    if (a.length < 10 || !/\d/.test(a) || !/\D/.test(a)) return ($("npErr").textContent = "От 10 символов, буквы и цифры");
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return ($("npErr").textContent = error.message);
    closeModal(); toast("Пароль изменён");
  };
};

/* ---------- вкладки ---------- */
function tabList() {
  const t = [];
  if (S.me.dash) t.push(["dash", S.me.role === "admin" ? "Дашборд компании" : "Дашборд"]);
  t.push(["overview", S.me.dash ? "Продажи" : "Обзор"]);
  if (S.me.show_people) t.push(["seg", "Ответственные"], ["mgr", "Менеджеры"]);
  if (S.me.show_clients) t.push(["cli", "Клиенты"]);
  t.push(["cat", S.me.only_rnd ? "Новинки RND" : "Товары"]);
  if (S.me.role === "admin") t.push(["admin", "Админка"]);
  return t;
}
function renderTabs() {
  $("tabs").innerHTML = tabList().map(([k, n]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${n}</button>`).join("");
  $("tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; renderTabs(); render(); }));
  const dataTab = S.tab !== "admin" && S.tab !== "dash";
  document.body.classList.toggle("dash-mode", S.tab === "dash");
  $("toolbar").classList.toggle("hidden", !dataTab);
  $("chips").classList.toggle("hidden", !dataTab);
}

/* ---------- период ---------- */
const PRESETS = [
  ["month", "Этот месяц"], ["lastmonth", "Прошлый месяц"], ["d7", "7 дней"], ["d30", "30 дней"],
  ["quarter", "Квартал"], ["ytd", "С начала года"], ["y12", "12 месяцев"], ["custom", "Свой период"],
];
function renderPeriods() {
  $("periods").innerHTML = PRESETS.map(([k, n]) => `<button data-p="${k}" class="${S.preset === k ? "on" : ""}">${n}</button>`).join("");
  $("periods").querySelectorAll("button").forEach((b) => (b.onclick = () => setPreset(b.dataset.p)));
}
function renderFresh() {
  const md = S.meta.max_date;
  if (!md) { $("fresh").textContent = ""; return; }
  const lag = daysBetween(md, iso(new Date()));
  $("fresh").textContent = `Данные по ${ruDate(md)}` + (lag > 3 ? ` – отстают на ${lag} дн.` : "");
  $("fresh").classList.toggle("stale", lag > 3);
}
async function setPreset(p) {
  S.preset = p;
  const today = new Date();
  let from, to = today;
  switch (p) {
    case "month": from = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case "lastmonth": from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0); break;
    case "d7": from = addDays(today, -6); break;
    case "d30": from = addDays(today, -29); break;
    case "quarter": from = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1); break;
    case "ytd": from = new Date(today.getFullYear(), 0, 1); break;
    case "y12": from = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1); break;
    case "custom":
      $("customRange").classList.remove("hidden");
      $("dFrom").value = S.from || iso(addDays(today, -29)); $("dTo").value = S.to || iso(today);
      renderPeriods(); return;
  }
  $("customRange").classList.add("hidden");
  renderPeriods();
  await load(iso(from), iso(to));
}
$("applyRange").onclick = () => {
  const a = $("dFrom").value, b = $("dTo").value;
  if (!a || !b || a > b) return toast("Проверьте даты периода");
  if (daysBetween(a, b) > 400) return toast("Период не больше 400 дней");
  load(a, b);
};

async function fetchRows(from, to) {
  const { data, error } = await sb.rpc("most_data", { p_from: from, p_to: to });
  if (error) {
    if (/JWT|session|Нет доступа/i.test(error.message)) { await sb.auth.signOut(); location.reload(); }
    throw error;
  }
  return data;
}
async function load(from, to) {
  S.from = from; S.to = to;
  // Сравнение – с предыдущим периодом той же длины; для календарного месяца – с предыдущим месяцем целиком
  const len = daysBetween(from, to);
  let pTo = iso(addDays(parse(from), -1)), pFrom = iso(addDays(parse(pTo), -len));
  if (["month", "lastmonth"].includes(S.preset)) {
    const f = parse(from); const pf = new Date(f.getFullYear(), f.getMonth() - 1, 1);
    pFrom = iso(pf);
    pTo = S.preset === "month" ? iso(addDays(pf, len)) : iso(new Date(f.getFullYear(), f.getMonth(), 0));
  }
  S.prevFrom = pFrom; S.prevTo = pTo;
  loading(true);
  try {
    const [c, p] = await Promise.all([fetchRows(from, to), fetchRows(pFrom, pTo)]);
    S.cur = c.rows; S.monthly = c.monthly; S.prev = p.rows;
  } catch (e) { toast("Не удалось загрузить данные: " + e.message); S.cur = []; S.prev = []; }
  loading(false);
  render();
}

/* ---------- фильтры (переход в детали по клику) ---------- */
function applyFilters(rows) {
  const f = Object.entries(S.filters);
  if (!f.length) return rows;
  return rows.filter((r) => f.every(([k, v]) => r[DIM[k].idx] === v));
}
function drill(dim, value, goTab) {
  S.filters[dim] = value;
  if (dim === "cat") delete S.filters.prod;
  S.tab = goTab || "overview";
  renderTabs(); render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderChips() {
  const f = Object.entries(S.filters);
  $("chips").innerHTML = f.map(([k, v]) => `<span class="chip">${DIM[k].title}: <b>${esc(v)}</b><button data-k="${k}" title="Убрать">×</button></span>`).join("")
    + (f.length > 1 ? `<button class="chip clear btn ghost" id="clearAll">Сбросить всё</button>` : "");
  $("chips").querySelectorAll("button[data-k]").forEach((b) => (b.onclick = () => { delete S.filters[b.dataset.k]; render(); }));
  if ($("clearAll")) $("clearAll").onclick = () => { S.filters = {}; render(); };
}

/* ---------- агрегаты ---------- */
function totals(rows) {
  const t = { rev: 0, kg: 0, mg: 0, qty: 0, cli: new Set(), hasMg: false };
  for (const r of rows) {
    t.rev += r[F.rev]; t.kg += r[F.kg]; t.qty += r[F.qty];
    if (r[F.mg] != null) { t.mg += r[F.mg]; t.hasMg = true; }
    if (r[F.cli]) t.cli.add(r[F.cli]);
  }
  t.mgPct = t.rev ? (t.mg / t.rev) * 100 : null;
  return t;
}
function groupBy(rows, idx) {
  const m = new Map();
  for (const r of rows) {
    const k = r[idx] ?? "–";
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, rev: 0, kg: 0, mg: 0, qty: 0, cli: new Set(), prev: 0 }));
    g.rev += r[F.rev]; g.kg += r[F.kg]; g.qty += r[F.qty]; g.mg += r[F.mg] ?? 0;
    if (r[F.cli]) g.cli.add(r[F.cli]);
  }
  return m;
}
function groupWithPrev(idx) {
  const cur = groupBy(applyFilters(S.cur), idx);
  const prev = groupBy(applyFilters(S.prev), idx);
  for (const [k, g] of cur) g.prev = prev.get(k)?.rev || 0;
  return { cur, prev };
}

/* ---------- отрисовка ---------- */
function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
function render() {
  destroyCharts();
  renderChips();
  if (S.tab === "admin") return renderAdmin();
  if (S.tab === "dash") return renderDash();
  if (S.tab === "overview") return renderOverview();
  return renderDim(S.tab);
}

function periodLabel() {
  return `${ruDate(S.from)} – ${ruDate(S.to)}, сравнение с ${ruDate(S.prevFrom)} – ${ruDate(S.prevTo)}`;
}

function renderOverview() {
  const rows = applyFilters(S.cur), prows = applyFilters(S.prev);
  const t = totals(rows), p = totals(prows);
  const dr = delta(t.rev, p.rev), dk = delta(t.kg, p.kg);
  const kpis = [
    `<div class="card kpi"><div class="l">Выручка</div><div class="v">${money(t.rev)}</div><div class="d ${dr.cls}">${dr.txt}</div></div>`,
    `<div class="card kpi"><div class="l">Отгружено</div><div class="v">${nf0.format(t.kg / 1000 >= 10 ? t.kg / 1000 : t.kg)} ${t.kg / 1000 >= 10 ? "т" : "кг"}</div><div class="d ${dk.cls}">${dk.txt}</div></div>`,
  ];
  if (S.me.show_margin) {
    const dm = delta(t.mg, p.mg);
    kpis.push(`<div class="card kpi"><div class="l">Валовая маржа</div><div class="v">${money(t.mg)}</div><div class="d ${dm.cls}">${dm.txt}</div></div>`);
    const dpp = t.mgPct != null && p.mgPct != null ? t.mgPct - p.mgPct : null;
    kpis.push(`<div class="card kpi"><div class="l">Маржинальность</div><div class="v">${pct(t.mgPct)}</div><div class="d ${dpp == null ? "" : dpp >= 0 ? "up" : "down"}">${dpp == null ? "" : (dpp >= 0 ? "+" : "") + nf1.format(dpp) + " п.п. к пред. периоду"}</div></div>`);
  }
  if (S.me.show_clients) {
    const dc = delta(t.cli.size, p.cli.size);
    kpis.push(`<div class="card kpi"><div class="l">Клиентов с покупкой</div><div class="v">${nf0.format(t.cli.size)}</div><div class="d ${dc.cls}">${dc.txt}</div></div>`);
  }

  const tops = [];
  if (S.me.show_people && !S.filters.seg) tops.push(["seg", "Ответственные"]);
  if (S.me.show_people && !S.filters.mgr) tops.push(["mgr", "Менеджеры"]);
  if (S.me.show_clients && !S.filters.cli) tops.push(["cli", "Клиенты"]);
  tops.push(S.filters.cat ? ["prod", "Товары"] : ["cat", "Категории"]);
  if (S.filters.cat && !S.filters.prod) {} // уже товары
  else if (!S.filters.cat) tops.push(["prod", "Товары"]);

  $("view").innerHTML = `
    <div class="section-title"><h2>Обзор</h2><span class="note">${periodLabel()}${S.monthly ? " · по месяцам" : ""}</span></div>
    <div class="grid kpis">${kpis.join("")}</div>
    <div class="card" style="margin-top:16px"><h3>Выручка ${S.monthly ? "по месяцам" : "по дням"}</h3><div class="chartbox"><canvas id="chMain"></canvas></div></div>
    <div class="grid two" style="margin-top:16px">${tops.map(([d, n]) => `<div class="card"><h3>${n}: топ-10</h3><div id="top_${d}"></div></div>`).join("")}</div>
    ${rows.length ? "" : `<div class="card empty" style="margin-top:16px">За выбранный период продаж нет.</div>`}`;

  drawMainChart(rows, prows);
  for (const [d] of tops) topTable(d, $("top_" + d));
}

function drawMainChart(rows, prows) {
  const byD = (rs) => { const m = new Map(); for (const r of rs) m.set(r[F.d], (m.get(r[F.d]) || 0) + r[F.rev]); return m; };
  const cm = byD(rows), pm = byD(prows);
  const labels = [], cur = [], prev = [];
  if (S.monthly) {
    const f = parse(S.from), t = parse(S.to);
    for (let d = new Date(f.getFullYear(), f.getMonth(), 1); d <= t; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      labels.push(d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" })); cur.push(cm.get(iso(d)) || 0);
    }
    const pf = parse(S.prevFrom);
    for (let i = 0, d = new Date(pf.getFullYear(), pf.getMonth(), 1); i < labels.length; i++, d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) prev.push(pm.get(iso(d)) || 0);
  } else {
    const n = daysBetween(S.from, S.to);
    for (let i = 0; i <= n; i++) {
      const d = addDays(parse(S.from), i), pd = addDays(parse(S.prevFrom), i);
      labels.push(d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }));
      cur.push(cm.get(iso(d)) || 0); prev.push(pm.get(iso(pd)) || 0);
    }
  }
  S.charts.push(new Chart($("chMain"), {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Текущий период", data: cur, backgroundColor: "#1e7bc6", borderRadius: 4, order: 2 },
        { type: "line", label: "Предыдущий период", data: prev, borderColor: "#7fb8e6", backgroundColor: "#7fb8e6", borderDash: [5, 4], pointRadius: 0, tension: 0.25, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${rub(c.raw)}` } } },
      scales: { y: { ticks: { callback: (v) => money(v) }, grid: { color: "#eef3f8" } }, x: { grid: { display: false } } },
    },
  }));
}

function topTable(dim, el) {
  const { cur } = groupWithPrev(DIM[dim].idx);
  const arr = [...cur.values()].sort((a, b) => b.rev - a.rev).slice(0, 10);
  const max = arr[0]?.rev || 1;
  if (!arr.length) { el.innerHTML = `<div class="empty">Нет данных</div>`; return; }
  el.innerHTML = `<table class="mini"><tbody>${arr.map((g) => {
    const d = delta(g.rev, g.prev);
    return `<tr class="click" data-v="${esc(g.key)}"><td>${esc(g.key)}<div class="bar" style="width:${Math.max(2, (g.rev / max) * 100)}%"></div></td>
      <td class="num">${money(g.rev)}<div class="${d.cls}" style="font-size:11px">${g.prev ? (d.v >= 0 ? "+" : "") + nf0.format(d.v) + "%" : "новый"}</div></td></tr>`;
  }).join("")}</tbody></table>`;
  el.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => drill(dim, tr.dataset.v)));
}

/* Вкладки-разрезы: Ответственные, Менеджеры, Клиенты, Товары */
function renderDim(tab) {
  let dim = tab;
  if (tab === "cat" && S.filters.cat) dim = "prod";
  const { cur, prev } = groupWithPrev(DIM[dim].idx);
  const total = [...cur.values()].reduce((s, g) => s + g.rev, 0);
  const arr = [...cur.values()];
  const cols = [
    { k: "key", t: DIM[dim].title, f: (g) => esc(g.key) },
    { k: "rev", t: "Выручка", num: 1, f: (g) => rub(g.rev) },
    { k: "dlt", t: "Δ к пред.", num: 1, v: (g) => (g.prev ? ((g.rev - g.prev) / Math.abs(g.prev)) * 100 : Infinity),
      f: (g) => { if (!g.prev) return `<span class="up">новый</span>`; const d = delta(g.rev, g.prev); return `<span class="${d.cls}">${(d.v >= 0 ? "+" : "") + nf0.format(d.v)}%</span>`; } },
    { k: "share", t: "Доля", num: 1, v: (g) => g.rev, f: (g) => pct(total ? (g.rev / total) * 100 : null) },
    { k: "kg", t: "Кг", num: 1, f: (g) => nf0.format(g.kg) },
  ];
  if (S.me.show_margin) {
    cols.push({ k: "mg", t: "Маржа", num: 1, f: (g) => rub(g.mg) });
    cols.push({ k: "mgp", t: "Маржа %", num: 1, v: (g) => (g.rev ? g.mg / g.rev : -1e9), f: (g) => pct(g.rev ? (g.mg / g.rev) * 100 : null) });
  }
  if (S.me.show_clients && dim !== "cli") cols.push({ k: "ncli", t: "Клиентов", num: 1, v: (g) => g.cli.size, f: (g) => nf0.format(g.cli.size) });

  const titles = { seg: "Ответственные", mgr: "Менеджеры", cli: "Клиенты", cat: "Категории товаров", prod: "Товары" };
  const hint = dim === "seg" ? "Ответственный за клиента или филиал (поле «Сегмент» в 1С). Нажмите на строку – откроется вся картина по нему."
    : dim === "mgr" ? "Сотрудник, оформивший документ в 1С. Нажмите на строку – детали." : "Нажмите на строку – детали.";

  let lost = "";
  if (dim === "cli") {
    const gone = [...prev.values()].filter((g) => !cur.has(g.key) && g.rev > 0).sort((a, b) => b.rev - a.rev);
    if (gone.length) {
      lost = `<div class="section-title"><h2>Не купили в этом периоде</h2><span class="note">Покупали в предыдущем: ${nf0.format(gone.length)} клиентов на ${money(gone.reduce((s, g) => s + g.rev, 0))}</span></div>
      <div class="card tbl-wrap"><table><thead><tr><th>Клиент</th><th class="num">Выручка в пред. периоде</th></tr></thead><tbody>
      ${gone.slice(0, 50).map((g) => `<tr class="click" data-v="${esc(g.key)}"><td>${esc(g.key)}</td><td class="num">${rub(g.rev)}</td></tr>`).join("")}
      </tbody></table></div>`;
    }
  }

  $("view").innerHTML = `
    <div class="section-title"><h2>${titles[dim]}${S.filters.cat && dim === "prod" ? ": " + esc(S.filters.cat) : ""}</h2><span class="note">${periodLabel()}</span></div>
    <p class="hint">${hint}</p>
    <div class="card tbl-wrap"><div id="tbl"></div></div>${lost}`;
  drawTable($("tbl"), arr, cols, tab, (v) => drill(dim, v, dim === "cat" ? "cat" : "overview"));
  $("view").querySelectorAll(".section-title ~ .card tr.click[data-v]").forEach((tr) => {
    if (!tr.closest("#tbl")) tr.onclick = () => drill("cli", tr.dataset.v);
  });
}

function drawTable(el, arr, cols, sortKey, onClick) {
  const st = S.sort[sortKey] || (S.sort[sortKey] = { k: "rev", asc: false });
  const col = cols.find((c) => c.k === st.k) || cols[1];
  const val = col.v || ((g) => g[col.k]);
  arr.sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "string" ? x.localeCompare(y, "ru") : x - y; return st.asc ? r : -r; });
  const max = arr.reduce((m, g) => Math.max(m, g.rev), 0) || 1;
  const shown = arr.slice(0, 300);
  el.innerHTML = `<table><thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.num ? "num" : ""} ${st.k === c.k ? "sorted" + (st.asc ? " asc" : "") : ""}">${c.t}</th>`).join("")}</tr></thead>
    <tbody>${shown.map((g) => `<tr class="click" data-v="${esc(g.key)}">${cols.map((c, i) => `<td class="${c.num ? "num" : ""}">${c.f(g)}${i === 0 ? `<div class="bar" style="width:${Math.max(1, (g.rev / max) * 100)}%"></div>` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table>
    ${arr.length > shown.length ? `<p class="hint">Показаны первые 300 из ${nf0.format(arr.length)}. Сузьте период или фильтр.</p>` : ""}
    ${arr.length ? "" : `<div class="empty">Нет данных за период</div>`}`;
  el.querySelectorAll("th").forEach((th) => (th.onclick = () => {
    st.asc = st.k === th.dataset.k ? !st.asc : th.dataset.k === "key"; st.k = th.dataset.k; drawTable(el, arr, cols, sortKey, onClick);
  }));
  el.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => onClick(tr.dataset.v)));
}

/* ---------- дашборд, собранный Маком (тот же, что в Claude), выдаётся по правам ---------- */
let DASH = null;
async function renderDash() {
  $("view").innerHTML = `<div class="empty">Загружаю дашборд…</div>`;
  if (!DASH) {
    const { data, error } = await sb.functions.invoke("most-dash", { body: {} });
    if (error || data?.error) {
      const msg = await fnError(error, data);
      $("view").innerHTML = `<div class="card empty">${esc(msg)}.<br>Пока можно смотреть вкладку «Продажи».</div>`;
      return;
    }
    DASH = data;
  }
  if (S.tab !== "dash") return;
  const upd = DASH.updated ? new Date(DASH.updated).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "";
  $("view").innerHTML = `<p class="hint dash-note">Обновлён ${esc(upd)} · собирается Маком каждое утро из 1С</p><iframe id="dashFrame" class="dash-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" title="Дашборд компании"></iframe>`;
  $("dashFrame").srcdoc = DASH.html;
}

/* ---------- админка ---------- */
let SEGMENTS = null;
async function renderAdmin() {
  $("view").innerHTML = `<div class="section-title"><h2>Пользователи</h2><button class="btn primary" id="addUser">+ Добавить пользователя</button></div><div class="card tbl-wrap" id="users"><div class="empty">Загрузка…</div></div>
    <p class="hint">Права проверяются в базе данных: сотрудник физически не получает чужие цифры, даже если откроет код страницы.</p>`;
  $("addUser").onclick = () => userForm(null);
  if (!SEGMENTS) { const r = await sb.rpc("most_segments"); SEGMENTS = r.data || []; }
  const { data, error } = await sb.rpc("most_users");
  if (error) { $("users").innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const users = data || [];
  $("users").innerHTML = `<table><thead><tr><th>Сотрудник</th><th>Роль</th><th>Что видит</th><th>Права</th><th>Последний вход</th><th></th></tr></thead><tbody>
    ${users.map((u, i) => `<tr>
      <td><b>${esc(u.full_name)}</b><br><span class="hint">${esc(u.email)}</span></td>
      <td>${ROLE_NAMES[u.role] || u.role}${u.active ? "" : ` <span class="tag off">отключён</span>`}</td>
      <td>${u.segments ? u.segments.map((s) => `<span class="tag">${esc(s)}</span>`).join("") : `<span class="tag">Вся компания</span>`}</td>
      <td>${[u.only_rnd && "только новинки RND", u.show_margin && "маржа", u.show_clients && "клиенты", u.show_people && "сотрудники"].filter(Boolean).join(", ") || "только товары"}</td>
      <td>${u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "ещё не входил"}</td>
      <td style="white-space:nowrap"><button class="btn small" data-edit="${i}">Изменить</button> <button class="btn small" data-pw="${i}">Пароль</button></td></tr>`).join("")}
    </tbody></table>`;
  $("users").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => userForm(users[b.dataset.edit])));
  $("users").querySelectorAll("[data-pw]").forEach((b) => (b.onclick = () => resetPassword(users[b.dataset.pw])));
}

function userForm(u) {
  const isNew = !u;
  const v = u || { full_name: "", email: "", role: "manager", ...ROLE_PRESETS.manager, active: true };
  openModal(`<h2>${isNew ? "Новый пользователь" : "Изменить доступ"}</h2>
    <div class="form-grid">
      <label>ФИО<input id="uName" value="${esc(v.full_name)}" placeholder="Фамилия Имя Отчество"></label>
      <label>Почта (логин)<input id="uEmail" type="email" value="${esc(v.email)}" ${isNew ? "" : "disabled"}></label>
      <label>Роль<select id="uRole">${Object.entries(ROLE_NAMES).map(([k, n]) => `<option value="${k}" ${v.role === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    </div>
    <label style="margin-bottom:4px">Что видит</label>
    <div class="checks"><label><input type="checkbox" id="uAll" ${v.segments ? "" : "checked"}> Вся компания</label></div>
    <div class="seg-box" id="segBox"><div class="checks">${SEGMENTS.map((s) => `<label><input type="checkbox" class="segc" value="${esc(s)}" ${v.segments?.includes(s) ? "checked" : ""}> ${esc(s)}</label>`).join("")}</div></div>
    <div class="checks">
      <label><input type="checkbox" id="uMargin" ${v.show_margin ? "checked" : ""}> Маржа и себестоимость</label>
      <label><input type="checkbox" id="uClients" ${v.show_clients ? "checked" : ""}> Клиенты</label>
      <label><input type="checkbox" id="uPeople" ${v.show_people ? "checked" : ""}> Ответственные и менеджеры</label>
      <label><input type="checkbox" id="uRnd" ${v.only_rnd ? "checked" : ""}> Только новинки RND</label>
      ${isNew ? "" : `<label><input type="checkbox" id="uActive" ${v.active ? "checked" : ""}> Доступ включён</label>`}
    </div>
    ${isNew ? `<div class="pw-row"><label>Временный пароль<input id="uPass" value="${genPassword()}"></label><button class="btn" id="uGen">Другой</button></div>` : ""}
    <p class="err" id="uErr"></p>
    <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn primary" id="uSave">${isNew ? "Создать" : "Сохранить"}</button></div>`);

  const syncAll = () => $("segBox").classList.toggle("hidden", $("uAll").checked);
  $("uAll").onchange = syncAll; syncAll();
  $("uRole").onchange = () => {
    const p = ROLE_PRESETS[$("uRole").value];
    $("uAll").checked = p.segments === null;
    document.querySelectorAll(".segc").forEach((c) => (c.checked = !!p.segments?.includes(c.value)));
    $("uMargin").checked = p.show_margin; $("uClients").checked = p.show_clients; $("uPeople").checked = p.show_people; $("uRnd").checked = p.only_rnd;
    syncAll();
  };
  if ($("uGen")) $("uGen").onclick = () => ($("uPass").value = genPassword());

  $("uSave").onclick = async () => {
    const segs = $("uAll").checked ? null : [...document.querySelectorAll(".segc:checked")].map((c) => c.value);
    if (segs && !segs.length) return ($("uErr").textContent = "Отметьте, что видит сотрудник, или выберите «Вся компания»");
    const name = $("uName").value.trim();
    if (!name) return ($("uErr").textContent = "Укажите ФИО");
    const payload = { full_name: name, role: $("uRole").value, segments: segs, show_margin: $("uMargin").checked, show_clients: $("uClients").checked, show_people: $("uPeople").checked };
    loading(true);
    if (isNew) {
      const email = $("uEmail").value.trim(), password = $("uPass").value;
      const { data, error } = await sb.functions.invoke("most-admin", { body: { action: "create_user", email, password, ...payload } });
      loading(false);
      if (error || data?.error) return ($("uErr").textContent = await fnError(error, data));
      const r = await sb.rpc("most_set_rnd", { p_user: data.user_id, p_only_rnd: $("uRnd").checked });
      if (r.error) toast("Пользователь создан, но признак «новинки RND» не сохранился: " + r.error.message);
      showCreds(name, email, password);
    } else {
      const { error } = await sb.rpc("most_update_user", { p_user: u.user_id, p_full_name: name, p_role: payload.role, p_segments: segs,
        p_show_margin: payload.show_margin, p_show_clients: payload.show_clients, p_show_people: payload.show_people, p_active: $("uActive").checked });
      const r = error ? null : await sb.rpc("most_set_rnd", { p_user: u.user_id, p_only_rnd: $("uRnd").checked });
      loading(false);
      if (error || r?.error) return ($("uErr").textContent = (error || r.error).message);
      closeModal(); toast("Сохранено");
    }
    renderAdmin();
  };
}

function showCreds(name, email, password) {
  const text = `Здравствуйте, ${name.split(/\s+/)[1] || name}!\nДля вас открыт доступ в Мостик – портал цифр Айсберг 8.\n\nАдрес: https://most.iceberg8.ru\nЛогин: ${email}\nВременный пароль: ${password}\n\nПожалуйста, после первого входа смените пароль (меню с вашим именем справа вверху). Спасибо!`;
  openModal(`<h2>Пользователь создан</h2><p class="hint">Передайте сотруднику лично или в личные сообщения:</p><div class="creds" id="credsText">${esc(text)}</div>
    <div class="modal-actions"><button class="btn" id="copyCreds">Скопировать</button><button class="btn primary" data-close>Готово</button></div>`);
  $("copyCreds").onclick = async () => { try { await navigator.clipboard.writeText(text); toast("Скопировано"); } catch { toast("Выделите текст и скопируйте вручную"); } };
}

function resetPassword(u) {
  openModal(`<h2>Новый пароль: ${esc(u.full_name)}</h2>
    <div class="pw-row"><label>Временный пароль<input id="rPass" value="${genPassword()}"></label><button class="btn" id="rGen">Другой</button></div>
    <p class="err" id="rErr"></p>
    <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn primary" id="rSave">Установить</button></div>`);
  $("rGen").onclick = () => ($("rPass").value = genPassword());
  $("rSave").onclick = async () => {
    loading(true);
    const pw = $("rPass").value;
    const { data, error } = await sb.functions.invoke("most-admin", { body: { action: "set_password", user_id: u.user_id, password: pw } });
    loading(false);
    if (error || data?.error) return ($("rErr").textContent = await fnError(error, data));
    showCreds(u.full_name, u.email, pw);
  };
}

/* ---------- модальное окно ---------- */
function openModal(html) {
  $("modalCard").innerHTML = html; $("modal").classList.remove("hidden");
  $("modalCard").querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
}
function closeModal() { $("modal").classList.add("hidden"); }
$("modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") showLogin(); });
boot();
