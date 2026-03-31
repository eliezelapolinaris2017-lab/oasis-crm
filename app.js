const HUB_URL = "https://eliezelapolinaris2017-lab.github.io/oasis-hub/";
const LEGACY_KEY = "oasis_crm_pro_v2";
const PIN_KEY = "oasis_crm_pin_v1";
const SESSION_UNLOCK_KEY = "oasis_crm_pin_session_v1";
const IDB_NAME = "oasis_crm_pro_v3";
const IDB_VERSION = 1;
const DB_STORES = ["clients", "visits"];

const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion",
  storageBucket: "oasis-facturacion.firebasestorage.app",
  messagingSenderId: "84422038905",
  appId: "1:84422038905:web:b0eef65217d2bfc3298ba8"
};

const OWNER_EMAIL = "nexustoolspr@gmail.com";
const AUTO_SYNC_ENABLED = true;
const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000;
const AUTO_SYNC_DEBOUNCE_MS = 1200;

let fbApp = null;
let fbAuth = null;
let fbDB = null;
let _syncTimer = null;
let _syncDebounce = null;
let _syncRunning = false;
let _syncPending = false;

const state = {
  activeView: "dashboard",
  activeClientId: null,
  editingVisitId: null,
  pinBuffer: "",
  pinMode: "unlock",
  timelineLimit: 100,
  db: { clients: [], visits: [] },
  indexes: null
};

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const uid = (p = "id") => `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const isoNow = () => new Date().toISOString();

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      DB_STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutMany(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearAll() {
  const db = await openDB();
  await Promise.all(DB_STORES.map((storeName) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  })));
}

function normalizeDB(db) {
  db = db && typeof db === "object" ? db : { clients: [], visits: [] };
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.visits = Array.isArray(db.visits) ? db.visits : [];

  const now = isoNow();

  db.clients = db.clients.map((c) => {
    const tags = Array.isArray(c.tags)
      ? c.tags.map((x) => String(x).trim()).filter(Boolean)
      : String(c.tags || "").split(",").map((x) => x.trim()).filter(Boolean);

    return {
      id: c.id || uid("c"),
      name: String(c.name || "Cliente").trim() || "Cliente",
      contact: String(c.contact || "").trim(),
      addr: String(c.addr || "").trim(),
      status: ["Prospecto", "Activo", "VIP", "Pausado"].includes(c.status) ? c.status : "Prospecto",
      tags,
      note: String(c.note || "").trim(),
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || c.createdAt || now
    };
  });

  const clientIds = new Set(db.clients.map((c) => c.id));

  db.visits = db.visits
    .map((v) => ({
      id: v.id || uid("v"),
      clientId: String(v.clientId || ""),
      date: v.date || todayISO(),
      amount: Number(v.amount || 0),
      service: String(v.service || "Servicio").trim() || "Servicio",
      note: String(v.note || "").trim(),
      createdAt: v.createdAt || now,
      updatedAt: v.updatedAt || v.createdAt || now
    }))
    .filter((v) => clientIds.has(v.clientId));

  return db;
}

function buildIndexes(db) {
  const clientsById = new Map();
  const visitsByClient = new Map();
  const totalsByClient = new Map();

  db.clients.forEach((client) => clientsById.set(client.id, client));
  db.visits.forEach((visit) => {
    if (!visitsByClient.has(visit.clientId)) visitsByClient.set(visit.clientId, []);
    visitsByClient.get(visit.clientId).push(visit);
  });

  visitsByClient.forEach((items, clientId) => {
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const total = items.reduce((acc, item) => acc + Number(item.amount || 0), 0);
    totalsByClient.set(clientId, {
      total,
      count: items.length,
      last: items[0]?.date || ""
    });
  });

  return { clientsById, visitsByClient, totalsByClient };
}

async function persistState() {
  const db = normalizeDB(state.db);
  state.db = db;
  state.indexes = buildIndexes(db);
  await Promise.all([
    idbPutMany("clients", db.clients),
    idbPutMany("visits", db.visits)
  ]);
  scheduleDebouncedSync("local-change");
}

async function loadStateFromIndexedDB() {
  const [clients, visits] = await Promise.all([idbGetAll("clients"), idbGetAll("visits")]);
  state.db = normalizeDB({ clients, visits });
  state.indexes = buildIndexes(state.db);
}

async function importLegacyIfNeeded(force = false) {
  const legacyRaw = localStorage.getItem(LEGACY_KEY);
  if (!legacyRaw) return false;

  const currentHasData = state.db.clients.length || state.db.visits.length;
  if (currentHasData && !force) return false;

  try {
    const legacy = normalizeDB(JSON.parse(legacyRaw));
    state.db = legacy;
    state.indexes = buildIndexes(legacy);
    await persistState();
    return true;
  } catch (e) {
    console.error("Legacy migration error", e);
    return false;
  }
}

function clientTotals(clientId) {
  return state.indexes?.totalsByClient.get(clientId) || { total: 0, count: 0, last: "" };
}

function badge(status) {
  if (status === "VIP") return `<span class="badge vip">VIP</span>`;
  if (status === "Activo") return `<span class="badge ok">Activo</span>`;
  if (status === "Prospecto") return `<span class="badge warn">Prospecto</span>`;
  return `<span class="badge">Pausado</span>`;
}

function getStoredPin() {
  return localStorage.getItem(PIN_KEY) || "";
}
function setStoredPin(pin) {
  localStorage.setItem(PIN_KEY, pin);
}
function clearSessionUnlock() {
  sessionStorage.removeItem(SESSION_UNLOCK_KEY);
}
function setSessionUnlock() {
  sessionStorage.setItem(SESSION_UNLOCK_KEY, "1");
}
function hasSessionUnlock() {
  return sessionStorage.getItem(SESSION_UNLOCK_KEY) === "1";
}
function isValidPin(pin) {
  return /^\d{4}$/.test(String(pin || ""));
}
function updatePinStatus() {
  setText("pinStatus", getStoredPin() ? "PIN activo" : "PIN no configurado");
}
function updatePinDots() {
  document.querySelectorAll("#pinDots span").forEach((dot, i) => dot.classList.toggle("filled", i < state.pinBuffer.length));
}
function clearPinBuffer() {
  state.pinBuffer = "";
  updatePinDots();
}
function showLock(mode = "unlock") {
  state.pinMode = mode;
  clearPinBuffer();
  $("lockScreen")?.classList.add("show");
  const hasPin = !!getStoredPin();
  if (!hasPin || mode === "create" || mode === "change") {
    setText("lockModeText", mode === "change" ? "Cambiar PIN" : "Crear PIN");
    setText("lockInfo", "Define un PIN de 4 dígitos.");
  } else {
    setText("lockModeText", "Acceso seguro");
    setText("lockInfo", "Ingresa tu PIN de 4 dígitos.");
  }
}
function hideLock() {
  $("lockScreen")?.classList.remove("show");
  clearPinBuffer();
}
function processPinComplete() {
  const pin = state.pinBuffer;
  const savedPin = getStoredPin();
  if (!isValidPin(pin)) return clearPinBuffer();

  if (!savedPin || state.pinMode === "create" || state.pinMode === "change") {
    setStoredPin(pin);
    setSessionUnlock();
    hideLock();
    updatePinStatus();
    alert(state.pinMode === "change" ? "PIN actualizado ✅" : "PIN creado ✅");
    return;
  }

  if (pin === savedPin) {
    setSessionUnlock();
    hideLock();
    return;
  }

  clearPinBuffer();
  alert("PIN incorrecto.");
}
function appendPinDigit(d) {
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += String(d);
  updatePinDots();
  if (state.pinBuffer.length === 4) setTimeout(processPinComplete, 120);
}
function backspacePin() {
  state.pinBuffer = state.pinBuffer.slice(0, -1);
  updatePinDots();
}
function bindPin() {
  document.querySelectorAll("[data-pin]").forEach((btn) => btn.addEventListener("click", () => appendPinDigit(btn.dataset.pin)));
  $("btnPinClear")?.addEventListener("click", clearPinBuffer);
  $("btnPinBack")?.addEventListener("click", backspacePin);
  window.addEventListener("keydown", (e) => {
    if (!$("lockScreen")?.classList.contains("show")) return;
    if (/^\d$/.test(e.key)) appendPinDigit(e.key);
    if (e.key === "Backspace") backspacePin();
    if (e.key === "Escape") clearPinBuffer();
  });
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.remove("is-active"));
  document.querySelectorAll(".navBtn").forEach((el) => el.classList.remove("is-active"));
  $(`view-${view}`)?.classList.add("is-active");
  document.querySelector(`.navBtn[data-view="${view}"]`)?.classList.add("is-active");

  const names = {
    dashboard: "Dashboard",
    clients: "Clientes",
    timeline: "Timeline",
    reporting: "Reporte",
    settings: "Config"
  };
  setText("pageTitle", names[view] || "Oasis CRM Pro");
  refreshAll();
}

function globalFilterTokens() {
  return ($("globalSearch")?.value || "").trim().toLowerCase();
}

function passesGlobal(client, visitList = []) {
  const q = globalFilterTokens();
  if (!q) return true;
  const haystack = [
    client.name,
    client.contact,
    client.addr,
    client.note,
    (client.tags || []).join(" "),
    ...visitList.flatMap((visit) => [visit.service, visit.note, String(visit.amount), visit.date])
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

function renderDashboard() {
  const clients = state.db.clients;
  const visits = state.db.visits;
  const activeClients = clients.filter((c) => c.status === "Activo" || c.status === "VIP").length;
  const vip = clients.filter((c) => c.status === "VIP").length;
  const revenue = visits.reduce((a, v) => a + Number(v.amount || 0), 0);
  const avg = visits.length ? revenue / visits.length : 0;

  setText("kpiClients", String(clients.length));
  setText("kpiActiveClients", `${activeClients} activos`);
  setText("kpiVIP", String(vip));
  setText("kpiRevenue", money(revenue));
  setText("kpiVisits", `${visits.length} visitas`);
  setText("kpiAvgTicket", money(avg));

  const recent = [...visits]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 8);
  setText("recentCountChip", `${recent.length} registros`);

  const recentBody = $("recentActivityBody");
  recentBody.innerHTML = recent.length ? "" : `<tr><td colspan="4" class="muted">Sin actividad todavía.</td></tr>`;
  recent.forEach((visit) => {
    const client = state.indexes.clientsById.get(visit.clientId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(visit.date || "—")}</td>
      <td><strong>${escapeHtml(client?.name || "—")}</strong></td>
      <td>${escapeHtml(visit.service || "—")}</td>
      <td><strong>${money(visit.amount || 0)}</strong></td>
    `;
    recentBody.appendChild(tr);
  });

  const topClients = [...clients]
    .map((client) => ({ client, stats: clientTotals(client.id) }))
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, 6);

  const list = $("topClientsList");
  list.innerHTML = topClients.length ? "" : `<div class="listItem"><div><strong>Sin data</strong><small>Cuando entren visitas, aquí sale la liga mayor.</small></div></div>`;
  topClients.forEach(({ client, stats }) => {
    const row = document.createElement("div");
    row.className = "listItem";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(client.name)}</strong>
        <small>${escapeHtml(stats.last || "Sin visitas")}</small>
      </div>
      <strong>${money(stats.total)}</strong>
    `;
    list.appendChild(row);
  });
}

function renderClients() {
  const q = ($("clientSearch")?.value || "").trim().toLowerCase();
  const status = $("clientStatusFilter")?.value || "all";
  const sortBy = $("clientSort")?.value || "updated";

  let rows = state.db.clients
    .map((client) => ({ client, stats: clientTotals(client.id), visits: state.indexes.visitsByClient.get(client.id) || [] }))
    .filter(({ client, visits }) => passesGlobal(client, visits))
    .filter(({ client }) => !q || [client.name, client.contact, client.addr, client.note, (client.tags || []).join(" ")].join(" ").toLowerCase().includes(q))
    .filter(({ client }) => status === "all" || client.status === status);

  rows.sort((a, b) => {
    if (sortBy === "name") return a.client.name.localeCompare(b.client.name);
    if (sortBy === "revenue") return b.stats.total - a.stats.total;
    if (sortBy === "last") return String(b.stats.last || "").localeCompare(String(a.stats.last || ""));
    return String(b.client.updatedAt).localeCompare(String(a.client.updatedAt));
  });

  setText("clientsCountChip", `${rows.length} clientes`);
  const body = $("clientsBody");
  body.innerHTML = rows.length ? "" : `<tr><td colspan="5" class="muted">No hay resultados.</td></tr>`;

  rows.forEach(({ client, stats }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(client.name)}</strong>
        <div class="muted">${escapeHtml((client.tags || []).join(", ") || "Sin tags")}</div>
      </td>
      <td>${badge(client.status)}</td>
      <td>${escapeHtml(client.contact || "—")}</td>
      <td><strong>${money(stats.total)}</strong></td>
      <td>
        <div class="aBtns">
          <button class="aBtn" data-open="${client.id}" type="button">Abrir</button>
          <button class="aBtn danger" data-del="${client.id}" type="button">Borrar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => openProfile(btn.dataset.open)));
  body.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", () => deleteClient(btn.dataset.del)));
}

function openProfile(clientId) {
  const client = state.indexes.clientsById.get(clientId);
  if (!client) return;
  state.activeClientId = clientId;
  $("emptyProfileState")?.classList.add("hidden");
  $("clientProfile")?.classList.remove("hidden");

  const stats = clientTotals(clientId);
  const visitCount = stats.count;
  setText("pName", client.name || "Cliente");
  setText("profileSub", client.contact || client.addr || "Sin contacto");
  setText("pLastVisit", stats.last || "—");
  setText("pTotal", money(stats.total));
  setText("pVisitCount", String(visitCount));

  $("pNameInput").value = client.name || "";
  $("pContactInput").value = client.contact || "";
  $("pAddrInput").value = client.addr || "";
  $("pStatusInput").value = client.status || "Prospecto";
  $("pTagsInput").value = (client.tags || []).join(", ");
  $("pNoteInput").value = client.note || "";

  populateVisitClientSelect(clientId);
  renderVisits();
}

function closeProfile() {
  state.activeClientId = null;
  $("clientProfile")?.classList.add("hidden");
  $("emptyProfileState")?.classList.remove("hidden");
}

function renderVisits() {
  const body = $("visitsBody");
  const cid = state.activeClientId;
  if (!cid) {
    body.innerHTML = `<tr><td colspan="5" class="muted">Selecciona un cliente.</td></tr>`;
    return;
  }

  const q = ($("visitSearch")?.value || "").trim().toLowerCase();
  const visits = [...(state.indexes.visitsByClient.get(cid) || [])]
    .filter((visit) => !q || [visit.service, visit.note, visit.date, String(visit.amount)].join(" ").toLowerCase().includes(q));

  body.innerHTML = visits.length ? "" : `<tr><td colspan="5" class="muted">Sin visitas.</td></tr>`;

  visits.forEach((visit) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(visit.date || "—")}</td>
      <td><strong>${escapeHtml(visit.service || "—")}</strong></td>
      <td><strong>${money(visit.amount || 0)}</strong></td>
      <td>${escapeHtml(visit.note || "")}</td>
      <td>
        <div class="aBtns">
          <button class="aBtn" data-edit="${visit.id}" type="button">Editar</button>
          <button class="aBtn danger" data-delv="${visit.id}" type="button">Borrar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openVisitModal(btn.dataset.edit)));
  body.querySelectorAll("[data-delv]").forEach((btn) => btn.addEventListener("click", () => deleteVisit(btn.dataset.delv)));
}

function renderTimeline() {
  const q = ($("timelineSearch")?.value || "").trim().toLowerCase();
  const from = $("timelineFrom")?.value || "";
  const to = $("timelineTo")?.value || "";

  const rows = state.db.visits
    .map((visit) => ({ visit, client: state.indexes.clientsById.get(visit.clientId) }))
    .filter((x) => x.client)
    .filter(({ visit, client }) => passesGlobal(client, [visit]))
    .filter(({ visit, client }) => !q || [client.name, client.contact, visit.service, visit.note, visit.date, String(visit.amount)].join(" ").toLowerCase().includes(q))
    .filter(({ visit }) => !from || String(visit.date) >= from)
    .filter(({ visit }) => !to || String(visit.date) <= to)
    .sort((a, b) => String(b.visit.date).localeCompare(String(a.visit.date)) || String(b.visit.updatedAt).localeCompare(String(a.visit.updatedAt)));

  setText("timelineCountChip", `${rows.length} filas`);
  const body = $("timelineBody");
  body.innerHTML = "";

  const visible = rows.slice(0, state.timelineLimit);
  if (!visible.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">Sin resultados.</td></tr>`;
  } else {
    visible.forEach(({ visit, client }) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(visit.date || "—")}</td>
        <td><strong>${escapeHtml(client?.name || "—")}</strong></td>
        <td>${escapeHtml(visit.service || "—")}</td>
        <td><strong>${money(visit.amount || 0)}</strong></td>
        <td>${escapeHtml(visit.note || "")}</td>
      `;
      body.appendChild(tr);
    });
  }

  $("btnMoreTimeline").style.display = rows.length > state.timelineLimit ? "inline-flex" : "none";
}

function renderReporting() {
  const clients = state.db.clients;
  setText("repPros", String(clients.filter((c) => c.status === "Prospecto").length));
  setText("repAct", String(clients.filter((c) => c.status === "Activo" || c.status === "VIP").length));
  setText("repPau", String(clients.filter((c) => c.status === "Pausado").length));

  const top = [...clients]
    .map((client) => ({ client, stats: clientTotals(client.id) }))
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, 10);

  const topBody = $("topBody");
  topBody.innerHTML = top.length ? "" : `<tr><td colspan="3" class="muted">Sin data.</td></tr>`;
  top.forEach(({ client, stats }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(client.name)}</strong></td>
      <td><strong>${money(stats.total)}</strong></td>
      <td>${escapeHtml(stats.last || "—")}</td>
    `;
    topBody.appendChild(tr);
  });

  const monthMap = new Map();
  state.db.visits.forEach((visit) => {
    const monthKey = String(visit.date || "").slice(0, 7) || "Sin fecha";
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { amount: 0, count: 0 });
    const row = monthMap.get(monthKey);
    row.amount += Number(visit.amount || 0);
    row.count += 1;
  });

  const monthSummary = $("monthSummary");
  const months = [...monthMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8);
  monthSummary.innerHTML = months.length ? "" : `<div class="listItem"><div><strong>Sin resumen</strong><small>Necesitas visitas para ver tendencia.</small></div></div>`;
  months.forEach(([month, data]) => {
    const item = document.createElement("div");
    item.className = "listItem";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(month)}</strong>
        <small>${data.count} visitas</small>
      </div>
      <strong>${money(data.amount)}</strong>
    `;
    monthSummary.appendChild(item);
  });
}

function refreshAll() {
  renderDashboard();
  renderClients();
  renderTimeline();
  renderReporting();
  if (state.activeClientId) {
    if (state.indexes.clientsById.has(state.activeClientId)) openProfile(state.activeClientId);
    else closeProfile();
  }
}

function populateVisitClientSelect(selectedId = state.activeClientId) {
  const select = $("vClient");
  if (!select) return;
  const current = selectedId || select.value;
  select.innerHTML = state.db.clients
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`)
    .join("");
  if (current && state.indexes.clientsById.has(current)) select.value = current;
}

function openClientModal() {
  $("clientModal").style.display = "flex";
  ["mName", "mContact", "mAddr", "mTags", "mNote"].forEach((id) => ($(id).value = ""));
  $("mStatus").value = "Prospecto";
}
function closeClientModal() {
  $("clientModal").style.display = "none";
}

function openVisitModal(visitId = null, preferredClientId = state.activeClientId) {
  state.editingVisitId = visitId;
  populateVisitClientSelect(preferredClientId);
  $("visitModal").style.display = "flex";
  $("visitModalTitle").textContent = visitId ? "Editar visita" : "Nueva visita";
  $("vDate").value = todayISO();
  $("vService").value = "";
  $("vAmount").value = "";
  $("vNote").value = "";

  if (visitId) {
    const visit = state.db.visits.find((x) => x.id === visitId);
    if (!visit) return;
    $("vClient").value = visit.clientId;
    $("vDate").value = visit.date || todayISO();
    $("vService").value = visit.service || "";
    $("vAmount").value = visit.amount ?? 0;
    $("vNote").value = visit.note || "";
  }
}
function closeVisitModal() {
  $("visitModal").style.display = "none";
  state.editingVisitId = null;
}

async function createClient() {
  const name = $("mName").value.trim();
  if (!name) return alert("Nombre requerido.");
  const now = isoNow();
  state.db.clients.unshift({
    id: uid("c"),
    name,
    contact: $("mContact").value.trim(),
    addr: $("mAddr").value.trim(),
    status: $("mStatus").value || "Prospecto",
    tags: $("mTags").value.split(",").map((x) => x.trim()).filter(Boolean),
    note: $("mNote").value.trim(),
    createdAt: now,
    updatedAt: now
  });
  await persistState();
  closeClientModal();
  refreshAll();
  openProfile(state.db.clients[0].id);
}

async function saveClientEdits() {
  const client = state.db.clients.find((x) => x.id === state.activeClientId);
  if (!client) return;

  client.name = $("pNameInput").value.trim() || client.name;
  client.contact = $("pContactInput").value.trim();
  client.addr = $("pAddrInput").value.trim();
  client.status = $("pStatusInput").value || "Prospecto";
  client.tags = $("pTagsInput").value.split(",").map((x) => x.trim()).filter(Boolean);
  client.note = $("pNoteInput").value.trim();
  client.updatedAt = isoNow();

  await persistState();
  refreshAll();
  openProfile(client.id);
}

async function deleteClient(id) {
  if (!id) return;
  if (!confirm("¿Borrar cliente y su historial?")) return;

  state.db.clients = state.db.clients.filter((c) => c.id !== id);
  const visitIds = state.db.visits.filter((v) => v.clientId === id).map((v) => v.id);
  state.db.visits = state.db.visits.filter((v) => v.clientId !== id);

  await idbDelete("clients", id);
  for (const visitId of visitIds) await idbDelete("visits", visitId);
  state.indexes = buildIndexes(state.db);
  scheduleDebouncedSync("local-change");

  if (state.activeClientId === id) closeProfile();
  refreshAll();
}

async function saveVisit() {
  const clientId = $("vClient").value;
  if (!clientId) return alert("Selecciona un cliente.");

  const amount = Number($("vAmount").value);
  if (Number.isNaN(amount)) return alert("Monto inválido.");

  const now = isoNow();
  if (state.editingVisitId) {
    const visit = state.db.visits.find((x) => x.id === state.editingVisitId);
    if (!visit) return;
    visit.clientId = clientId;
    visit.date = $("vDate").value || todayISO();
    visit.service = $("vService").value.trim() || "Servicio";
    visit.amount = amount;
    visit.note = $("vNote").value.trim();
    visit.updatedAt = now;
  } else {
    state.db.visits.unshift({
      id: uid("v"),
      clientId,
      date: $("vDate").value || todayISO(),
      service: $("vService").value.trim() || "Servicio",
      amount,
      note: $("vNote").value.trim(),
      createdAt: now,
      updatedAt: now
    });
  }

  const client = state.db.clients.find((x) => x.id === clientId);
  if (client) client.updatedAt = now;

  await persistState();
  closeVisitModal();
  refreshAll();
  openProfile(clientId);
}

async function deleteVisit(id) {
  if (!confirm("¿Borrar visita?")) return;
  state.db.visits = state.db.visits.filter((v) => v.id !== id);
  await idbDelete("visits", id);
  state.indexes = buildIndexes(state.db);
  scheduleDebouncedSync("local-change");
  refreshAll();
  if (state.activeClientId) openProfile(state.activeClientId);
}

function exportBackup() {
  const payload = {
    exportedAt: isoNow(),
    app: "oasis_crm_pro_v3",
    db: state.db
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oasis_crm_v3_backup_${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 700);
}

async function restoreBackup(file) {
  try {
    const txt = await file.text();
    const data = JSON.parse(txt);
    const db = normalizeDB(data?.db || data);
    state.db = db;
    await idbClearAll();
    await persistState();
    closeProfile();
    refreshAll();
    alert("Backup restaurado ✅");
  } catch (e) {
    console.error(e);
    alert("No se pudo restaurar el backup.");
  }
}

async function resetAll() {
  if (!confirm("¿Borrar todo local?")) return;
  state.db = { clients: [], visits: [] };
  await idbClearAll();
  state.indexes = buildIndexes(state.db);
  closeProfile();
  refreshAll();
}

function fbStatus(text) {
  setText("fbStatus", `Estado: ${text}`);
  setText("syncStatus", text.startsWith("online") ? "Firebase" : text.startsWith("sync") ? "Sync..." : "Local");
}
function fbReady() { return !!(window.firebase && fbApp && fbAuth && fbDB); }
function fbUser() { return fbAuth?.currentUser || null; }
function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent || ""); }
function requireOwner(user) { return !!(user?.email && user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()); }
function canAutoSync() {
  if (!AUTO_SYNC_ENABLED || !fbReady()) return false;
  const user = fbUser();
  return !!(user && requireOwner(user));
}
function clientCol(uidVal) { return fbDB.collection("users").doc(uidVal).collection("oasis_crm_v3").doc("clients").collection("items"); }
function visitCol(uidVal) { return fbDB.collection("users").doc(uidVal).collection("oasis_crm_v3").doc("visits").collection("items"); }
function metaRef(uidVal) { return fbDB.collection("users").doc(uidVal).collection("oasis_crm_v3").doc("meta").collection("items").doc("state"); }

async function testWrite(uidVal) {
  await metaRef(uidVal).set({ lastPingAt: isoNow(), app: "oasis_crm_v3" }, { merge: true });
}

async function pullFirebaseToLocal() {
  const user = fbUser();
  if (!user || !requireOwner(user)) throw new Error("Cuenta no autorizada.");
  const uidVal = user.uid;

  const [clientsSnap, visitsSnap] = await Promise.all([clientCol(uidVal).get(), visitCol(uidVal).get()]);
  const remote = normalizeDB({
    clients: clientsSnap.docs.map((d) => d.data()).filter(Boolean),
    visits: visitsSnap.docs.map((d) => d.data()).filter(Boolean)
  });

  const localClients = new Map(state.db.clients.map((c) => [c.id, c]));
  const localVisits = new Map(state.db.visits.map((v) => [v.id, v]));

  remote.clients.forEach((remoteClient) => {
    const local = localClients.get(remoteClient.id);
    if (!local || String(remoteClient.updatedAt || remoteClient.createdAt) > String(local.updatedAt || local.createdAt)) {
      localClients.set(remoteClient.id, remoteClient);
    }
  });
  remote.visits.forEach((remoteVisit) => {
    const local = localVisits.get(remoteVisit.id);
    if (!local || String(remoteVisit.updatedAt || remoteVisit.createdAt) > String(local.updatedAt || local.createdAt)) {
      localVisits.set(remoteVisit.id, remoteVisit);
    }
  });

  state.db = normalizeDB({ clients: [...localClients.values()], visits: [...localVisits.values()] });
  await idbClearAll();
  await persistState();
}

async function pushLocalToFirebase() {
  const user = fbUser();
  if (!user || !requireOwner(user)) throw new Error("Cuenta no autorizada.");
  const uidVal = user.uid;
  await testWrite(uidVal);

  const ops = [];
  state.db.clients.forEach((client) => ops.push({ ref: clientCol(uidVal).doc(client.id), doc: client }));
  state.db.visits.forEach((visit) => ops.push({ ref: visitCol(uidVal).doc(visit.id), doc: visit }));

  for (let i = 0; i < ops.length; i += 450) {
    const batch = fbDB.batch();
    ops.slice(i, i + 450).forEach((item) => batch.set(item.ref, item.doc, { merge: true }));
    await batch.commit();
  }
}

async function safeSyncNow(reason = "manual") {
  if (!canAutoSync()) return;
  if (_syncRunning) {
    _syncPending = true;
    return;
  }
  _syncRunning = true;
  _syncPending = false;
  try {
    fbStatus(`sync ${reason}...`);
    await pullFirebaseToLocal();
    await pushLocalToFirebase();
    refreshAll();
    const user = fbUser();
    fbStatus(user ? `online (${user.email})` : "offline");
  } catch (e) {
    console.error("SYNC ERROR:", e);
    const user = fbUser();
    fbStatus(user ? `online (${user.email})` : "offline");
  } finally {
    _syncRunning = false;
    if (_syncPending) setTimeout(() => safeSyncNow("pending"), 400);
  }
}

function startAutoSyncLoop() {
  stopAutoSyncLoop();
  if (AUTO_SYNC_ENABLED) _syncTimer = setInterval(() => safeSyncNow("interval"), AUTO_SYNC_INTERVAL_MS);
}
function stopAutoSyncLoop() {
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = null;
}
function scheduleDebouncedSync(reason = "local-change") {
  if (!canAutoSync()) return;
  clearTimeout(_syncDebounce);
  _syncDebounce = setTimeout(() => safeSyncNow(reason), AUTO_SYNC_DEBOUNCE_MS);
}

async function fbLogin() {
  if (!fbReady()) return alert("Firebase no está listo.");
  const provider = new firebase.auth.GoogleAuthProvider();
  if (isIOS()) return fbAuth.signInWithRedirect(provider);
  const res = await fbAuth.signInWithPopup(provider);
  if (!requireOwner(res.user)) {
    await fbAuth.signOut();
    throw new Error("Cuenta no autorizada.");
  }
}
async function fbHandleRedirectResult() {
  if (!fbReady()) return;
  try {
    const res = await fbAuth.getRedirectResult();
    if (res?.user && !requireOwner(res.user)) {
      await fbAuth.signOut();
      throw new Error("Cuenta no autorizada.");
    }
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    if (msg && !msg.includes("redirect") && !msg.includes("no redirect")) alert("Login redirect falló: " + (e?.message || e));
  }
}
async function fbLogout() {
  if (!fbReady()) return;
  await fbAuth.signOut();
}
async function exitCRM() {
  try {
    clearSessionUnlock();
    if (fbReady() && fbUser()) await fbAuth.signOut();
  } catch (e) {
    console.error(e);
  } finally {
    window.location.href = HUB_URL;
  }
}

function bindUI() {
  document.querySelectorAll(".navBtn").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  $("globalSearch")?.addEventListener("input", refreshAll);
  $("clientSearch")?.addEventListener("input", renderClients);
  $("clientStatusFilter")?.addEventListener("change", renderClients);
  $("clientSort")?.addEventListener("change", renderClients);
  $("visitSearch")?.addEventListener("input", renderVisits);
  $("timelineSearch")?.addEventListener("input", () => { state.timelineLimit = 100; renderTimeline(); });
  $("timelineFrom")?.addEventListener("change", () => { state.timelineLimit = 100; renderTimeline(); });
  $("timelineTo")?.addEventListener("change", () => { state.timelineLimit = 100; renderTimeline(); });
  $("btnClearTimelineFilters")?.addEventListener("click", () => {
    $("timelineSearch").value = "";
    $("timelineFrom").value = "";
    $("timelineTo").value = "";
    state.timelineLimit = 100;
    renderTimeline();
  });
  $("btnMoreTimeline")?.addEventListener("click", () => {
    state.timelineLimit += 100;
    renderTimeline();
  });

  $("btnNewClient")?.addEventListener("click", openClientModal);
  $("btnCloseModal")?.addEventListener("click", closeClientModal);
  $("btnCreateClient")?.addEventListener("click", createClient);

  $("btnOpenQuickVisit")?.addEventListener("click", () => openVisitModal(null));
  $("btnAddVisit")?.addEventListener("click", () => openVisitModal(null, state.activeClientId));
  $("btnCloseVisitModal")?.addEventListener("click", closeVisitModal);
  $("btnSaveVisit")?.addEventListener("click", saveVisit);

  $("btnCloseProfile")?.addEventListener("click", closeProfile);
  $("btnSaveClient")?.addEventListener("click", saveClientEdits);
  $("btnDeleteClient")?.addEventListener("click", () => deleteClient(state.activeClientId));

  $("btnExportBackup")?.addEventListener("click", exportBackup);
  $("btnRestoreBackup")?.addEventListener("click", () => $("restoreBackupFile").click());
  $("restoreBackupFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await restoreBackup(file);
    e.target.value = "";
  });
  $("btnMigrateLegacy")?.addEventListener("click", async () => {
    const ok = await importLegacyIfNeeded(true);
    refreshAll();
    alert(ok ? "Migración legacy completada ✅" : "No encontré data legacy para migrar.");
  });
  $("btnResetAll")?.addEventListener("click", resetAll);

  $("btnChangePin")?.addEventListener("click", () => {
    clearSessionUnlock();
    showLock("change");
  });

  $("btnLogin")?.addEventListener("click", async () => {
    try { await fbLogin(); } catch (e) { alert(e?.message || e); }
  });
  $("btnLogout")?.addEventListener("click", async () => {
    try { await fbLogout(); } catch (e) { alert(e?.message || e); }
  });
  $("btnSyncNow")?.addEventListener("click", () => safeSyncNow("manual"));
  $("btnExitCRM")?.addEventListener("click", exitCRM);
}

function initFirebase() {
  try {
    if (!window.firebase) return fbStatus("offline");
    if (!firebase.apps || !firebase.apps.length) fbApp = firebase.initializeApp(firebaseConfig);
    else fbApp = firebase.app();

    fbAuth = firebase.auth();
    fbDB = firebase.firestore();

    fbAuth.onAuthStateChanged(async (user) => {
      if (!user) {
        fbStatus("offline");
        stopAutoSyncLoop();
        return;
      }
      if (!requireOwner(user)) {
        fbStatus("offline");
        stopAutoSyncLoop();
        try { await fbAuth.signOut(); } catch {}
        alert("Cuenta no autorizada.");
        return;
      }
      fbStatus(`online (${user.email})`);
      await safeSyncNow("login");
      startAutoSyncLoop();
    });

    fbHandleRedirectResult();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") safeSyncNow("background");
    });
    window.addEventListener("pagehide", () => safeSyncNow("pagehide"));
  } catch (e) {
    console.error("Firebase init error", e);
    fbStatus("offline");
  }
}

(async function boot() {
  bindUI();
  bindPin();
  updatePinStatus();
  await loadStateFromIndexedDB();
  await importLegacyIfNeeded(false);
  populateVisitClientSelect();
  initFirebase();
  setView("dashboard");
  refreshAll();

  const hasPin = !!getStoredPin();
  if (!hasPin) showLock("create");
  else if (!hasSessionUnlock()) showLock("unlock");
  else hideLock();
})();
