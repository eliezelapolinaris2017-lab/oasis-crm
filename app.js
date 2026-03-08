const HUB_URL = "https://eliezelapolinaris2017-lab.github.io/oasis-hub/";
const KEY = "oasis_crm_pro_v2";
const PIN_KEY = "oasis_crm_pin_v1";
const SESSION_UNLOCK_KEY = "oasis_crm_pin_session_v1";

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

let _syncTimer = null;
let _syncDebounce = null;
let _syncRunning = false;
let _syncPending = false;

let fbApp = null;
let fbAuth = null;
let fbDB = null;

const state = {
  activeView: "dashboard",
  activeClientId: null,
  editingVisitId: null,
  pinBuffer: "",
  pinMode: "unlock"
};

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const uid = (p = "id") => `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

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

/* =========================
   PIN
========================= */
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
  const dots = document.querySelectorAll("#pinDots span");
  dots.forEach((dot, i) => dot.classList.toggle("filled", i < state.pinBuffer.length));
}

function clearPinBuffer() {
  state.pinBuffer = "";
  updatePinDots();
}

function showLock(mode = "unlock") {
  state.pinMode = mode;
  clearPinBuffer();

  const lock = $("lockScreen");
  if (lock) lock.classList.add("show");

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
  const lock = $("lockScreen");
  if (lock) lock.classList.remove("show");
  clearPinBuffer();
}

function processPinComplete() {
  const pin = state.pinBuffer;
  const savedPin = getStoredPin();

  if (!isValidPin(pin)) {
    clearPinBuffer();
    return;
  }

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

  if (state.pinBuffer.length === 4) {
    setTimeout(processPinComplete, 100);
  }
}

function backspacePin() {
  state.pinBuffer = state.pinBuffer.slice(0, -1);
  updatePinDots();
}

function bindPin() {
  document.querySelectorAll("[data-pin]").forEach((btn) => {
    btn.addEventListener("click", () => appendPinDigit(btn.dataset.pin));
  });

  $("btnPinClear")?.addEventListener("click", clearPinBuffer);
  $("btnPinBack")?.addEventListener("click", backspacePin);

  window.addEventListener("keydown", (e) => {
    const lockVisible = $("lockScreen")?.classList.contains("show");
    if (!lockVisible) return;

    if (/^\d$/.test(e.key)) appendPinDigit(e.key);
    if (e.key === "Backspace") backspacePin();
    if (e.key === "Escape") clearPinBuffer();
  });
}

/* =========================
   DB LOCAL
========================= */
function normalizeDB(db) {
  db = db && typeof db === "object" ? db : { clients: [], visits: [] };
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.visits = Array.isArray(db.visits) ? db.visits : [];

  const now = new Date().toISOString();

  db.clients.forEach((c) => {
    if (!c.id) c.id = uid("c");
    if (!c.name) c.name = "Cliente";
    if (!c.status) c.status = "Prospecto";
    if (!Array.isArray(c.tags)) {
      c.tags = String(c.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
    }
    if (c.contact == null) c.contact = "";
    if (c.addr == null) c.addr = "";
    if (c.note == null) c.note = "";
    if (!c.createdAt) c.createdAt = now;
    if (!c.updatedAt) c.updatedAt = c.createdAt;
  });

  db.visits.forEach((v) => {
    if (!v.id) v.id = uid("v");
    if (!v.clientId) v.clientId = "";
    if (!v.date) v.date = todayISO();
    v.amount = Number(v.amount || 0);
    if (!v.service) v.service = "Servicio";
    if (v.note == null) v.note = "";
    if (!v.createdAt) v.createdAt = now;
    if (!v.updatedAt) v.updatedAt = v.createdAt;
  });

  const clientIds = new Set(db.clients.map((c) => c.id));
  db.visits = db.visits.filter((v) => clientIds.has(v.clientId));

  return db;
}

function loadDB() {
  try {
    const raw = localStorage.getItem(KEY);
    const db = raw ? JSON.parse(raw) : { clients: [], visits: [] };
    const normalized = normalizeDB(db);
    localStorage.setItem(KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const clean = { clients: [], visits: [] };
    localStorage.setItem(KEY, JSON.stringify(clean));
    return clean;
  }
}

function saveDB(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeDB(db)));
    scheduleDebouncedSync("local-change");
  } catch (e) {
    alert("No se pudo guardar localmente.");
    throw e;
  }
}

/* =========================
   HELPERS
========================= */
function badge(status) {
  if (status === "VIP") return `<span class="badge vip">VIP</span>`;
  if (status === "Activo") return `<span class="badge ok">Activo</span>`;
  if (status === "Prospecto") return `<span class="badge warn">Prospecto</span>`;
  return `<span class="badge">Pausado</span>`;
}

function clientTotals(db, clientId) {
  const vs = db.visits.filter((v) => v.clientId === clientId);
  const total = vs.reduce((a, v) => a + Number(v.amount || 0), 0);
  const last = vs.length
    ? vs.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0].date
    : "";
  return { total, last, count: vs.length };
}

/* =========================
   VIEWS
========================= */
function setView(view) {
  state.activeView = view;

  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelectorAll(".sideLink").forEach((t) => t.classList.remove("is-active"));

  $(`view-${view}`)?.classList.add("is-active");
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.add("is-active");
  document.querySelector(`.sideLink[data-view="${view}"]`)?.classList.add("is-active");

  refreshAll();
}

/* =========================
   KPIS + DASHBOARD
========================= */
function renderRecentActivity() {
  const db = loadDB();
  const recent = db.visits
    .map((v) => {
      const c = db.clients.find((x) => x.id === v.clientId);
      return { v, c };
    })
    .filter((x) => x.c)
    .sort((a, b) => String(b.v.date || "").localeCompare(String(a.v.date || "")))
    .slice(0, 8);

  const body = $("recentActivityBody");
  if (!body) return;

  body.innerHTML = "";

  if (!recent.length) {
    body.innerHTML = `<tr><td colspan="4" style="opacity:.7;padding:14px">Sin actividad.</td></tr>`;
    return;
  }

  recent.forEach(({ v, c }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.date || "—")}</td>
      <td><strong>${escapeHtml(c.name || "—")}</strong></td>
      <td>${escapeHtml(v.service || "—")}</td>
      <td><strong>${money(v.amount || 0)}</strong></td>
    `;
    body.appendChild(tr);
  });
}

function updateKPIs() {
  const db = loadDB();

  const clientsCount = db.clients.length;
  const vipCount = db.clients.filter((c) => c.status === "VIP").length;
  const revenue = db.visits.reduce((a, v) => a + Number(v.amount || 0), 0);

  setText("kpiClients", String(clientsCount));
  setText("kpiVIP", String(vipCount));
  setText("kpiRevenue", money(revenue));

  setText("kpiClientsView", String(clientsCount));
  setText("kpiVIPView", String(vipCount));
  setText("kpiRevenueView", money(revenue));

  setText("repPros", String(db.clients.filter((c) => c.status === "Prospecto").length));
  setText("repAct", String(db.clients.filter((c) => c.status === "Activo" || c.status === "VIP").length));
  setText("repPau", String(db.clients.filter((c) => c.status === "Pausado").length));

  const top = db.clients
    .map((c) => {
      const t = clientTotals(db, c.id);
      return { name: c.name, total: t.total, last: t.last };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const topBody = $("topBody");
  if (topBody) {
    topBody.innerHTML = top.length ? "" : `<tr><td colspan="3" style="opacity:.7;padding:14px">Sin data.</td></tr>`;
    top.forEach((x) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(x.name)}</strong></td>
        <td><strong>${money(x.total)}</strong></td>
        <td>${escapeHtml(x.last || "—")}</td>
      `;
      topBody.appendChild(tr);
    });
  }

  renderRecentActivity();
}

function updateProfileKPIs() {
  const db = loadDB();
  const cid = state.activeClientId;
  if (!cid) return;

  const t = clientTotals(db, cid);
  setText("pLastVisit", t.last ? t.last : "—");
  setText("pTotal", money(t.total));
}

/* =========================
   CLIENTES
========================= */
function renderClients() {
  const db = loadDB();
  const q = ($("clientSearch")?.value || "").trim().toLowerCase();

  const rows = db.clients
    .map((c) => {
      const tags = (c.tags || []).join(", ");
      const match =
        !q ||
        (c.name || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        tags.toLowerCase().includes(q);

      if (!match) return null;

      const t = clientTotals(db, c.id);
      return { c, t, tags };
    })
    .filter(Boolean)
    .sort((a, b) => b.t.total - a.t.total);

  const body = $("clientsBody");
  if (!body) return;

  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" style="opacity:.7;padding:14px">Sin clientes.</td></tr>`;
    return;
  }

  rows.forEach(({ c, t, tags }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td>${escapeHtml(c.contact || "—")}</td>
      <td>${badge(c.status || "Prospecto")}</td>
      <td>${escapeHtml(tags || "—")}</td>
      <td>${escapeHtml(t.last || "—")}</td>
      <td><strong>${money(t.total)}</strong></td>
      <td>
        <div class="aBtns">
          <button class="aBtn" data-open="${c.id}" type="button">Abrir</button>
          <button class="aBtn danger" data-del="${c.id}" type="button">Borrar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-open]").forEach((b) => {
    b.addEventListener("click", () => openProfile(b.dataset.open));
  });

  body.querySelectorAll("[data-del]").forEach((b) => {
    b.addEventListener("click", () => deleteClient(b.dataset.del));
  });
}

function openProfile(clientId) {
  const db = loadDB();
  const c = db.clients.find((x) => x.id === clientId);
  if (!c) return;

  state.activeClientId = clientId;
  setView("clients");

  const panel = $("clientProfile");
  if (panel) panel.style.display = "block";

  setText("pName", c.name || "Cliente");

  if ($("pNameInput")) $("pNameInput").value = c.name || "";
  if ($("pContactInput")) $("pContactInput").value = c.contact || "";
  if ($("pAddrInput")) $("pAddrInput").value = c.addr || "";
  if ($("pStatusInput")) $("pStatusInput").value = c.status || "Prospecto";
  if ($("pTagsInput")) $("pTagsInput").value = (c.tags || []).join(", ");
  if ($("pNoteInput")) $("pNoteInput").value = c.note || "";

  renderVisits();
  updateProfileKPIs();
}

function closeProfile() {
  state.activeClientId = null;
  const panel = $("clientProfile");
  if (panel) panel.style.display = "none";
}

function saveClientEdits() {
  const db = loadDB();
  const c = db.clients.find((x) => x.id === state.activeClientId);
  if (!c) return;

  c.name = ($("pNameInput")?.value || "").trim() || c.name;
  c.contact = ($("pContactInput")?.value || "").trim();
  c.addr = ($("pAddrInput")?.value || "").trim();
  c.status = $("pStatusInput")?.value || "Prospecto";
  c.tags = ($("pTagsInput")?.value || "").split(",").map((x) => x.trim()).filter(Boolean);
  c.note = ($("pNoteInput")?.value || "").trim();
  c.updatedAt = new Date().toISOString();

  saveDB(db);
  openProfile(c.id);
  renderClients();
  updateKPIs();
}

function createClient() {
  const name = ($("mName")?.value || "").trim();
  if (!name) return alert("Nombre requerido.");

  const db = loadDB();
  const now = new Date().toISOString();

  const c = {
    id: uid("c"),
    name,
    contact: ($("mContact")?.value || "").trim(),
    addr: ($("mAddr")?.value || "").trim(),
    status: $("mStatus")?.value || "Prospecto",
    tags: ($("mTags")?.value || "").split(",").map((x) => x.trim()).filter(Boolean),
    note: ($("mNote")?.value || "").trim(),
    createdAt: now,
    updatedAt: now
  };

  db.clients.unshift(c);
  saveDB(db);

  closeClientModal();
  refreshAll();
  openProfile(c.id);
}

function deleteClient(id) {
  if (!id) return;
  if (!confirm("¿Borrar cliente y su historial?")) return;

  const db = loadDB();
  db.clients = db.clients.filter((c) => c.id !== id);
  db.visits = db.visits.filter((v) => v.clientId !== id);
  saveDB(db);

  if (state.activeClientId === id) closeProfile();
  refreshAll();
}

/* =========================
   VISITAS
========================= */
function renderVisits() {
  const db = loadDB();
  const cid = state.activeClientId;
  const q = ($("visitSearch")?.value || "").trim().toLowerCase();

  const vs = db.visits
    .filter((v) => v.clientId === cid)
    .filter((v) => {
      if (!q) return true;
      return (
        (v.service || "").toLowerCase().includes(q) ||
        (v.note || "").toLowerCase().includes(q) ||
        String(v.amount || "").includes(q) ||
        String(v.date || "").includes(q)
      );
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const body = $("visitsBody");
  if (!body) return;

  body.innerHTML = "";

  if (!vs.length) {
    body.innerHTML = `<tr><td colspan="5" style="opacity:.7;padding:14px">Sin visitas.</td></tr>`;
    return;
  }

  vs.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.date || "—")}</td>
      <td><strong>${escapeHtml(v.service || "—")}</strong></td>
      <td><strong>${money(v.amount || 0)}</strong></td>
      <td>${escapeHtml(v.note || "")}</td>
      <td>
        <div class="aBtns">
          <button class="aBtn" data-edit="${v.id}" type="button">Editar</button>
          <button class="aBtn danger" data-delv="${v.id}" type="button">Borrar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => openVisitModal(b.dataset.edit));
  });

  body.querySelectorAll("[data-delv]").forEach((b) => {
    b.addEventListener("click", () => deleteVisit(b.dataset.delv));
  });
}

function openVisitModal(visitId = null) {
  state.editingVisitId = visitId;

  const modal = $("visitModal");
  if (modal) modal.style.display = "flex";

  if ($("vDate")) $("vDate").value = todayISO();
  if ($("vAmount")) $("vAmount").value = "";
  if ($("vService")) $("vService").value = "";
  if ($("vNote")) $("vNote").value = "";

  setText("visitModalTitle", visitId ? "Editar visita" : "Nueva visita");

  if (visitId) {
    const db = loadDB();
    const v = db.visits.find((x) => x.id === visitId);
    if (v) {
      if ($("vDate")) $("vDate").value = v.date || todayISO();
      if ($("vAmount")) $("vAmount").value = v.amount ?? 0;
      if ($("vService")) $("vService").value = v.service || "";
      if ($("vNote")) $("vNote").value = v.note || "";
    }
  }
}

function closeVisitModal() {
  const modal = $("visitModal");
  if (modal) modal.style.display = "none";
  state.editingVisitId = null;
}

function saveVisit() {
  const cid = state.activeClientId;
  if (!cid) return alert("Abre un cliente primero.");

  const date = $("vDate")?.value || todayISO();
  const amount = Number($("vAmount")?.value);

  if (Number.isNaN(amount)) return alert("Monto inválido.");

  const service = ($("vService")?.value || "").trim() || "Servicio";
  const note = ($("vNote")?.value || "").trim();

  const db = loadDB();
  const now = new Date().toISOString();

  if (state.editingVisitId) {
    const v = db.visits.find((x) => x.id === state.editingVisitId);
    if (!v) return;

    v.date = date;
    v.amount = amount;
    v.service = service;
    v.note = note;
    v.updatedAt = now;
  } else {
    db.visits.unshift({
      id: uid("v"),
      clientId: cid,
      date,
      amount,
      service,
      note,
      createdAt: now,
      updatedAt: now
    });
  }

  saveDB(db);
  closeVisitModal();
  refreshAll();
  if (state.activeClientId) openProfile(state.activeClientId);
}

function deleteVisit(id) {
  if (!confirm("¿Borrar visita?")) return;
  const db = loadDB();
  db.visits = db.visits.filter((v) => v.id !== id);
  saveDB(db);
  refreshAll();
  if (state.activeClientId) openProfile(state.activeClientId);
}

/* =========================
   TIMELINE
========================= */
function renderTimeline() {
  const db = loadDB();
  const q = ($("timelineSearch")?.value || "").trim().toLowerCase();

  const rows = db.visits
    .map((v) => {
      const c = db.clients.find((x) => x.id === v.clientId);
      return { v, c };
    })
    .filter((x) => x.c)
    .filter(({ v, c }) => {
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (v.service || "").toLowerCase().includes(q) ||
        (v.note || "").toLowerCase().includes(q) ||
        String(v.amount || "").includes(q) ||
        String(v.date || "").includes(q)
      );
    })
    .sort((a, b) => String(b.v.date || "").localeCompare(String(a.v.date || "")))
    .slice(0, 250);

  const body = $("timelineBody");
  if (!body) return;

  body.innerHTML = "";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" style="opacity:.7;padding:14px">Sin actividad.</td></tr>`;
    return;
  }

  rows.forEach(({ v, c }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.date || "—")}</td>
      <td><strong>${escapeHtml(c.name || "—")}</strong></td>
      <td>${escapeHtml(v.service || "—")}</td>
      <td><strong>${money(v.amount || 0)}</strong></td>
      <td>${escapeHtml(v.note || "")}</td>
    `;
    body.appendChild(tr);
  });
}

/* =========================
   BACKUP LOCAL
========================= */
function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "oasis_crm_pro",
    db: loadDB()
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `oasis_crm_backup_${todayISO()}.json`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 700);
}

async function restoreBackup(file) {
  try {
    const txt = await file.text();
    const data = JSON.parse(txt);
    const db = data?.db || data;

    if (!db || !Array.isArray(db.clients) || !Array.isArray(db.visits)) {
      alert("Archivo inválido.");
      return;
    }

    const normalized = normalizeDB(db);
    localStorage.setItem(KEY, JSON.stringify(normalized));
    refreshAll();
    closeProfile();
    alert("Backup restaurado ✅");
  } catch (e) {
    console.error(e);
    alert("No se pudo restaurar el backup.");
  }
}

/* =========================
   MODALES
========================= */
function openClientModal() {
  const modal = $("clientModal");
  if (modal) modal.style.display = "flex";

  if ($("mName")) $("mName").value = "";
  if ($("mContact")) $("mContact").value = "";
  if ($("mAddr")) $("mAddr").value = "";
  if ($("mStatus")) $("mStatus").value = "Prospecto";
  if ($("mTags")) $("mTags").value = "";
  if ($("mNote")) $("mNote").value = "";
}

function closeClientModal() {
  const modal = $("clientModal");
  if (modal) modal.style.display = "none";
}

/* =========================
   RESET
========================= */
function resetAll() {
  if (!confirm("¿Borrar todo local?")) return;
  localStorage.removeItem(KEY);
  closeProfile();
  refreshAll();
}

/* =========================
   REFRESH
========================= */
function refreshAll() {
  updateKPIs();
  renderClients();
  renderTimeline();

  if (state.activeClientId) {
    const db = loadDB();
    const exists = db.clients.some((c) => c.id === state.activeClientId);
    if (exists) openProfile(state.activeClientId);
    else closeProfile();
  }
}

/* =========================
   FIREBASE
========================= */
function fbStatus(text) {
  setText("fbStatus", `Estado: ${text}`);
}

function fbReady() {
  return !!(window.firebase && fbApp && fbAuth && fbDB);
}

function fbUser() {
  return fbAuth?.currentUser || null;
}

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function requireOwner(u) {
  return !!(u?.email && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase());
}

function canAutoSync() {
  if (!AUTO_SYNC_ENABLED) return false;
  if (!fbReady()) return false;
  const u = fbUser();
  if (!u) return false;
  if (!requireOwner(u)) return false;
  return true;
}

function startAutoSyncLoop() {
  if (!AUTO_SYNC_ENABLED) return;
  stopAutoSyncLoop();
  _syncTimer = setInterval(() => safeSyncNow("interval"), AUTO_SYNC_INTERVAL_MS);
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

function clientCol(uidVal) {
  return fbDB.collection("users").doc(uidVal).collection("oasis_crm").doc("clients").collection("items");
}

function visitCol(uidVal) {
  return fbDB.collection("users").doc(uidVal).collection("oasis_crm").doc("visits").collection("items");
}

function metaRef(uidVal) {
  return fbDB.collection("users").doc(uidVal).collection("oasis_crm").doc("meta").collection("items").doc("state");
}

async function testWrite(uidVal) {
  await metaRef(uidVal).set({
    lastPingAt: new Date().toISOString(),
    app: "oasis_crm"
  }, { merge: true });
}

function ts(s) {
  return String(s || "");
}

async function pullFirebaseToLocal() {
  const u = fbUser();
  if (!u) throw new Error("No estás logueado.");
  if (!requireOwner(u)) throw new Error("Cuenta no autorizada.");

  const uidVal = u.uid;

  const [clientsSnap, visitsSnap] = await Promise.all([
    clientCol(uidVal).get(),
    visitCol(uidVal).get()
  ]);

  const remoteClients = clientsSnap.docs.map((d) => d.data()).filter(Boolean);
  const remoteVisits = visitsSnap.docs.map((d) => d.data()).filter(Boolean);

  const local = loadDB();
  const localClientsMap = new Map(local.clients.map((x) => [x.id, x]));
  const localVisitsMap = new Map(local.visits.map((x) => [x.id, x]));

  remoteClients.forEach((rc) => {
    const lc = localClientsMap.get(rc.id);
    const rU = ts(rc.updatedAt || rc.createdAt);
    const lU = ts(lc?.updatedAt || lc?.createdAt);
    if (!lc || rU > lU) localClientsMap.set(rc.id, rc);
  });

  remoteVisits.forEach((rv) => {
    const lv = localVisitsMap.get(rv.id);
    const rU = ts(rv.updatedAt || rv.createdAt);
    const lU = ts(lv?.updatedAt || lv?.createdAt);
    if (!lv || rU > lU) localVisitsMap.set(rv.id, rv);
  });

  const merged = normalizeDB({
    clients: Array.from(localClientsMap.values()),
    visits: Array.from(localVisitsMap.values())
  });

  localStorage.setItem(KEY, JSON.stringify(merged));
}

async function pushLocalToFirebase() {
  const u = fbUser();
  if (!u) throw new Error("No estás logueado.");
  if (!requireOwner(u)) throw new Error("Cuenta no autorizada.");

  const uidVal = u.uid;
  const db = loadDB();

  await testWrite(uidVal);

  const ops = [];

  db.clients.forEach((c) => {
    ops.push({
      ref: clientCol(uidVal).doc(c.id),
      doc: { ...c, updatedAt: c.updatedAt || new Date().toISOString() }
    });
  });

  db.visits.forEach((v) => {
    ops.push({
      ref: visitCol(uidVal).doc(v.id),
      doc: { ...v, updatedAt: v.updatedAt || v.createdAt || new Date().toISOString() }
    });
  });

  const chunkSize = 450;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = fbDB.batch();
    ops.slice(i, i + chunkSize).forEach((x) => batch.set(x.ref, x.doc, { merge: true }));
    await batch.commit();
  }
}

async function safeSyncNow(reason = "auto") {
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

    const u = fbUser();
    fbStatus(u ? `online (${u.email})` : "offline");
  } catch (e) {
    const u = fbUser();
    fbStatus(u ? `online (${u.email})` : "offline");
    console.error("SYNC ERROR:", e);
  } finally {
    _syncRunning = false;
    if (_syncPending) {
      setTimeout(() => safeSyncNow("pending"), 400);
    }
  }
}

async function fbLogin() {
  if (!fbReady()) return alert("Firebase no está listo.");

  const provider = new firebase.auth.GoogleAuthProvider();

  if (isIOS()) {
    await fbAuth.signInWithRedirect(provider);
    return;
  }

  const res = await fbAuth.signInWithPopup(provider);
  const u = res.user;

  if (!requireOwner(u)) {
    await fbAuth.signOut();
    throw new Error("Cuenta no autorizada.");
  }
}

async function fbHandleRedirectResult() {
  if (!fbReady()) return;

  try {
    const res = await fbAuth.getRedirectResult();
    if (res && res.user) {
      const u = res.user;
      if (!requireOwner(u)) {
        await fbAuth.signOut();
        throw new Error("Cuenta no autorizada.");
      }
    }
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    if (msg && !msg.includes("redirect") && !msg.includes("no redirect")) {
      alert("Login redirect falló: " + (e?.message || e));
    }
  }
}

async function fbLogout() {
  if (!fbReady()) return alert("Firebase no está listo.");
  await fbAuth.signOut();
}

async function exitCRM() {
  try {
    clearSessionUnlock();
    if (fbReady() && fbUser()) {
      await fbAuth.signOut();
    }
  } catch (e) {
    console.error("Exit signout error:", e);
  } finally {
    window.location.href = HUB_URL;
  }
}

/* =========================
   BINDS
========================= */
function bindFirebaseButtons() {
  $("btnLogin")?.addEventListener("click", async () => {
    try {
      await fbLogin();
    } catch (e) {
      alert(e?.message || e);
    }
  });

  $("btnLogout")?.addEventListener("click", async () => {
    try {
      await fbLogout();
    } catch (e) {
      alert(e?.message || e);
    }
  });
}

function bindUI() {
  document.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });

  document.querySelectorAll(".sideLink").forEach((b) => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });

  $("btnNewClient")?.addEventListener("click", openClientModal);

  $("btnCloseModal")?.addEventListener("click", closeClientModal);
  $("btnCreateClient")?.addEventListener("click", createClient);

  $("btnCloseProfile")?.addEventListener("click", closeProfile);
  $("btnSaveClient")?.addEventListener("click", saveClientEdits);
  $("btnDeleteClient")?.addEventListener("click", () => deleteClient(state.activeClientId));
  $("btnAddVisit")?.addEventListener("click", () => openVisitModal(null));

  $("btnCloseVisitModal")?.addEventListener("click", closeVisitModal);
  $("btnSaveVisit")?.addEventListener("click", saveVisit);

  if ($("vDate")) $("vDate").value = todayISO();

  $("clientSearch")?.addEventListener("input", renderClients);
  $("visitSearch")?.addEventListener("input", renderVisits);
  $("timelineSearch")?.addEventListener("input", renderTimeline);

  $("btnResetAll")?.addEventListener("click", resetAll);

  $("btnChangePin")?.addEventListener("click", () => {
    clearSessionUnlock();
    showLock("change");
  });

  $("btnExportBackup")?.addEventListener("click", exportBackup);
  $("btnRestoreBackup")?.addEventListener("click", () => $("restoreBackupFile")?.click());

  $("restoreBackupFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await restoreBackup(file);
    e.target.value = "";
  });

  $("btnExitCRM")?.addEventListener("click", exitCRM);
}

/* =========================
   BOOT
========================= */
(function boot() {
  bindUI();
  bindPin();
  bindFirebaseButtons();
  updatePinStatus();

  try {
    if (window.firebase) {
      if (!firebase.apps || !firebase.apps.length) {
        fbApp = firebase.initializeApp(firebaseConfig);
      } else {
        fbApp = firebase.app();
      }

      fbAuth = firebase.auth();
      fbDB = firebase.firestore();

      fbAuth.onAuthStateChanged(async (u) => {
        if (!u) {
          fbStatus("offline");
          stopAutoSyncLoop();
          return;
        }

        if (!requireOwner(u)) {
          fbStatus("offline");
          stopAutoSyncLoop();
          try {
            await fbAuth.signOut();
          } catch {}
          alert("Cuenta no autorizada.");
          return;
        }

        fbStatus(`online (${u.email})`);
        await safeSyncNow("login");
        startAutoSyncLoop();
      });

      fbHandleRedirectResult();

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") safeSyncNow("background");
      });

      window.addEventListener("pagehide", () => {
        safeSyncNow("pagehide");
      });
    } else {
      fbStatus("offline");
    }
  } catch (e) {
    fbStatus("offline");
    console.error("Firebase init error:", e);
  }

  setView("dashboard");
  refreshAll();

  const hasPin = !!getStoredPin();
  if (!hasPin) {
    showLock("create");
  } else if (!hasSessionUnlock()) {
    showLock("unlock");
  } else {
    hideLock();
  }
})();
