/* =========================================================
   Oasis CRM — app.js (GitHub Pages Ready)
   - LocalStorage: clientes + visitas
   - CRUD + búsqueda + timeline + reportes
   - Export/Import JSON
   - Hub FAB fijo (editas HUB_URL)
   - Normalización / migración suave (sin romper data vieja)
   ========================================================= */

const HUB_URL = "https://eliezelapolinaris2017-lab.github.io/oasis-hub/"; // <-- cambia esto
const KEY = "oasis_crm_v1";

const $ = (id) => document.getElementById(id);
const money = (n) => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const uid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const todayISO = () => new Date().toISOString().slice(0,10);

function saveDB(db){
  localStorage.setItem(KEY, JSON.stringify(db));
}

/* ===== Normaliza DB (clientes/visitas) — AÑADIDO ===== */
function normalizeDB(db){
  db = db && typeof db === "object" ? db : { clients: [], visits: [] };
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.visits  = Array.isArray(db.visits)  ? db.visits  : [];

  // Clientes
  db.clients.forEach(c=>{
    if (!c.id) c.id = uid("c");
    if (!c.status) c.status = "Prospecto";

    if (!Array.isArray(c.tags)) {
      c.tags = String(c.tags||"").split(",").map(x=>x.trim()).filter(Boolean);
    }

    if (c.note == null) c.note = "";
    if (c.addr == null) c.addr = "";
    if (c.contact == null) c.contact = "";
    if (c.name == null) c.name = "Cliente";
  });

  // Visitas
  db.visits.forEach(v=>{
    if (!v.id) v.id = uid("v");
    if (!v.clientId) v.clientId = "";
    if (!v.date) v.date = todayISO();
    v.amount = Number(v.amount || 0);
    if (v.service == null) v.service = "Servicio";
    if (v.note == null) v.note = "";
  });

  // Limpia huérfanas
  const clientIds = new Set(db.clients.map(c=>c.id));
  db.visits = db.visits.filter(v=>clientIds.has(v.clientId));

  return db;
}

/* ===== loadDB robusto — AÑADIDO ===== */
function loadDB(){
  try{
    const raw = localStorage.getItem(KEY);
    const db = raw ? JSON.parse(raw) : { clients: [], visits: [] };
    const normalized = normalizeDB(db);
    // Guardar normalizado para evitar inconsistencias futuras
    saveDB(normalized);
    return normalized;
  }catch(e){
    const clean = { clients: [], visits: [] };
    saveDB(clean);
    return clean;
  }
}

const state = {
  activeClientId: null,
  editingVisitId: null
};

/* ====== NAV ====== */
function setView(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("is-active"));
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("is-active"));
  $(`view-${view}`)?.classList.add("is-active");
  document.querySelector(`.tab[data-view="${view}"]`)?.classList.add("is-active");
  refreshAll();
}

/* ====== KPIs ====== */
function badge(status){
  if (status === "VIP") return `<span class="badge vip">VIP</span>`;
  if (status === "Activo") return `<span class="badge ok">Activo</span>`;
  if (status === "Prospecto") return `<span class="badge warn">Prospecto</span>`;
  return `<span class="badge">Pausado</span>`;
}

function clientTotals(db, clientId){
  const vs = db.visits.filter(v=>v.clientId===clientId);
  const total = vs.reduce((a,v)=>a + Number(v.amount||0), 0);
  const last = vs.length
    ? vs.slice().sort((a,b)=> (String(b.date||"")).localeCompare(String(a.date||"")))[0].date
    : "";
  return { total, last, count: vs.length };
}

function updateKPIs(){
  const db = loadDB();
  const totalClients = db.clients.length;
  const vip = db.clients.filter(c=>c.status==="VIP").length;
  const revenue = db.visits.reduce((a,v)=>a + Number(v.amount||0), 0);

  $("kpiClients").textContent = String(totalClients);
  $("kpiVIP").textContent = String(vip);
  $("kpiRevenue").textContent = money(revenue);

  // Reporting
  $("repPros").textContent = String(db.clients.filter(c=>c.status==="Prospecto").length);
  $("repAct").textContent = String(db.clients.filter(c=>c.status==="Activo"||c.status==="VIP").length);
  $("repPau").textContent = String(db.clients.filter(c=>c.status==="Pausado").length);

  // Top
  const top = db.clients.map(c=>{
    const t = clientTotals(db, c.id);
    return { name:c.name, total:t.total, last:t.last };
  }).sort((a,b)=>b.total-a.total).slice(0,20);

  const topBody = $("topBody");
  topBody.innerHTML = top.length ? "" : `<tr><td colspan="3" style="opacity:.7;padding:14px">Sin data.</td></tr>`;
  top.forEach(x=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${escapeHtml(x.name)}</strong></td><td><strong>${money(x.total)}</strong></td><td>${escapeHtml(x.last||"—")}</td>`;
    topBody.appendChild(tr);
  });
}

/* ====== RENDER CLIENTS ====== */
function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderClients(){
  const db = loadDB();
  const q = ($("clientSearch").value||"").trim().toLowerCase();

  const rows = db.clients
    .map(c=>{
      const tags = (c.tags||[]).join(", ");
      const match = !q ||
        (c.name||"").toLowerCase().includes(q) ||
        (c.contact||"").toLowerCase().includes(q) ||
        tags.toLowerCase().includes(q);

      if (!match) return null;

      const t = clientTotals(db, c.id);
      return { c, t, tags };
    })
    .filter(Boolean)
    .sort((a,b)=> (b.t.total - a.t.total));

  const body = $("clientsBody");
  body.innerHTML = "";

  if (!rows.length){
    body.innerHTML = `<tr><td colspan="7" style="opacity:.7;padding:14px">Sin clientes todavía. Dale “+ Cliente”.</td></tr>`;
    return;
  }

  rows.forEach(({c,t,tags})=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name)}</strong><div style="opacity:.7;font-size:12px">${escapeHtml(c.note||"")}</div></td>
      <td>${escapeHtml(c.contact||"—")}<div style="opacity:.7;font-size:12px">${escapeHtml(c.addr||"")}</div></td>
      <td>${badge(c.status||"Prospecto")}</td>
      <td>${escapeHtml(tags||"—")}</td>
      <td>${escapeHtml(t.last||"—")}</td>
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

  body.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click", ()=>openProfile(b.dataset.open)));
  body.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>deleteClient(b.dataset.del)));
}

/* ====== PROFILE ====== */
function openProfile(clientId){
  const db = loadDB();
  const c = db.clients.find(x=>x.id===clientId);
  if (!c) return;

  state.activeClientId = clientId;
  $("clientProfile").style.display = "block";

  $("pName").textContent = c.name || "Cliente";
  $("pMeta").textContent = `${c.status||"Prospecto"} · ${c.contact||"—"}`;

  $("pNameInput").value = c.name||"";
  $("pContactInput").value = c.contact||"";
  $("pAddrInput").value = c.addr||"";
  $("pStatusInput").value = c.status||"Prospecto";
  $("pTagsInput").value = (c.tags||[]).join(", ");
  $("pNoteInput").value = c.note||"";

  renderVisits();
}

function closeProfile(){
  state.activeClientId = null;
  $("clientProfile").style.display = "none";
}

function saveClientEdits(){
  const db = loadDB();
  const c = db.clients.find(x=>x.id===state.activeClientId);
  if (!c) return;

  c.name = ($("pNameInput").value||"").trim() || c.name;
  c.contact = ($("pContactInput").value||"").trim();
  c.addr = ($("pAddrInput").value||"").trim();
  c.status = $("pStatusInput").value || "Prospecto";
  c.tags = ($("pTagsInput").value||"").split(",").map(x=>x.trim()).filter(Boolean);
  c.note = ($("pNoteInput").value||"").trim();
  c.updatedAt = new Date().toISOString();

  saveDB(db);
  openProfile(c.id);
  renderClients();
  updateKPIs();
}

function deleteClient(id){
  if (!confirm("¿Borrar cliente y su historial?")) return;
  const db = loadDB();
  db.clients = db.clients.filter(c=>c.id!==id);
  db.visits = db.visits.filter(v=>v.clientId!==id);
  saveDB(db);

  if (state.activeClientId === id) closeProfile();
  renderClients();
  renderTimeline();
  updateKPIs();
}

/* ====== VISITS ====== */
function renderVisits(){
  const db = loadDB();
  const cid = state.activeClientId;
  const q = ($("visitSearch").value||"").trim().toLowerCase();

  const vs = db.visits
    .filter(v=>v.clientId===cid)
    .filter(v=>{
      if (!q) return true;
      return (v.service||"").toLowerCase().includes(q) ||
             (v.note||"").toLowerCase().includes(q) ||
             String(v.amount||"").includes(q) ||
             String(v.date||"").includes(q);
    })
    .sort((a,b)=> (String(b.date||"")).localeCompare(String(a.date||"")));

  const body = $("visitsBody");
  body.innerHTML = "";

  if (!vs.length){
    body.innerHTML = `<tr><td colspan="5" style="opacity:.7;padding:14px">Sin visitas todavía.</td></tr>`;
    return;
  }

  vs.forEach(v=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.date||"—")}</td>
      <td><strong>${escapeHtml(v.service||"—")}</strong></td>
      <td><strong>${money(v.amount||0)}</strong></td>
      <td>${escapeHtml(v.note||"")}</td>
      <td>
        <div class="aBtns">
          <button class="aBtn" data-edit="${v.id}" type="button">Editar</button>
          <button class="aBtn danger" data-delv="${v.id}" type="button">Borrar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>openVisitModal(b.dataset.edit)));
  body.querySelectorAll("[data-delv]").forEach(b=>b.addEventListener("click", ()=>deleteVisit(b.dataset.delv)));
}

function openVisitModal(visitId=null){
  state.editingVisitId = visitId;
  $("visitModal").style.display = "flex";

  $("vDate").value = todayISO();
  $("vAmount").value = "";
  $("vService").value = "";
  $("vNote").value = "";
  $("visitModalTitle").textContent = visitId ? "Editar Visita" : "Nueva Visita";

  if (visitId){
    const db = loadDB();
    const v = db.visits.find(x=>x.id===visitId);
    if (v){
      $("vDate").value = v.date || todayISO();
      $("vAmount").value = v.amount ?? 0;
      $("vService").value = v.service || "";
      $("vNote").value = v.note || "";
    }
  }
}

function closeVisitModal(){
  $("visitModal").style.display = "none";
  state.editingVisitId = null;
}

function saveVisit(){
  const cid = state.activeClientId;
  if (!cid) return alert("Abre un cliente primero.");

  const date = $("vDate").value || todayISO();

  const amountRaw = $("vAmount").value;
  const amount = Number(amountRaw);
  if (Number.isNaN(amount)) return alert("Monto inválido.");

  const service = ($("vService").value||"").trim() || "Servicio";
  const note = ($("vNote").value||"").trim();

  const db = loadDB();

  if (state.editingVisitId){
    const v = db.visits.find(x=>x.id===state.editingVisitId);
    if (!v) return;
    v.date = date;
    v.amount = amount;
    v.service = service;
    v.note = note;
    v.updatedAt = new Date().toISOString();
  } else {
    db.visits.unshift({
      id: uid("v"),
      clientId: cid,
      date,
      amount,
      service,
      note,
      createdAt: new Date().toISOString()
    });
  }

  saveDB(db);
  closeVisitModal();
  renderVisits();
  renderClients();
  renderTimeline();
  updateKPIs();
}

function deleteVisit(id){
  if (!confirm("¿Borrar visita?")) return;
  const db = loadDB();
  db.visits = db.visits.filter(v=>v.id!==id);
  saveDB(db);
  renderVisits();
  renderClients();
  renderTimeline();
  updateKPIs();
}

/* ====== TIMELINE ====== */
function renderTimeline(){
  const db = loadDB();
  const q = ($("timelineSearch").value||"").trim().toLowerCase();

  const rows = db.visits
    .map(v=>{
      const c = db.clients.find(x=>x.id===v.clientId);
      return { v, c };
    })
    .filter(x=>x.c)
    .filter(({v,c})=>{
      if (!q) return true;
      return (c.name||"").toLowerCase().includes(q) ||
             (v.service||"").toLowerCase().includes(q) ||
             (v.note||"").toLowerCase().includes(q) ||
             String(v.amount||"").includes(q) ||
             String(v.date||"").includes(q);
    })
    .sort((a,b)=> (String(b.v.date||"")).localeCompare(String(a.v.date||"")))
    .slice(0, 250);

  const body = $("timelineBody");
  body.innerHTML = "";

  if (!rows.length){
    body.innerHTML = `<tr><td colspan="5" style="opacity:.7;padding:14px">Sin actividad.</td></tr>`;
    return;
  }

  rows.forEach(({v,c})=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.date||"—")}</td>
      <td><strong>${escapeHtml(c.name||"—")}</strong></td>
      <td>${escapeHtml(v.service||"—")}</td>
      <td><strong>${money(v.amount||0)}</strong></td>
      <td>${escapeHtml(v.note||"")}</td>
    `;
    body.appendChild(tr);
  });
}

/* ====== EXPORT / IMPORT ====== */
function exportJSON(){
  const db = loadDB();
  const payload = { exportedAt: new Date().toISOString(), db };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oasis_crm_${todayISO()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 500);
}

async function importJSON(file){
  try{
    const txt = await file.text();
    const data = JSON.parse(txt);
    const db = data.db || data;
    if (!db.clients || !db.visits) return alert("Archivo inválido.");
    const normalized = normalizeDB({ clients: db.clients, visits: db.visits });
    saveDB(normalized);
    refreshAll();
    alert("Importado ✅");
  }catch{
    alert("No se pudo importar.");
  }
}

/* ====== CREATE CLIENT ====== */
function openClientModal(){
  $("clientModal").style.display = "flex";
  $("mName").value = "";
  $("mContact").value = "";
  $("mAddr").value = "";
  $("mStatus").value = "Prospecto";
  $("mTags").value = "";
  $("mNote").value = "";
}
function closeClientModal(){ $("clientModal").style.display = "none"; }

function createClient(){
  const name = ($("mName").value||"").trim();
  if (!name) return alert("Nombre requerido.");

  const db = loadDB();
  const c = {
    id: uid("c"),
    name,
    contact: ($("mContact").value||"").trim(),
    addr: ($("mAddr").value||"").trim(),
    status: $("mStatus").value || "Prospecto",
    tags: ($("mTags").value||"").split(",").map(x=>x.trim()).filter(Boolean),
    note: ($("mNote").value||"").trim(),
    createdAt: new Date().toISOString()
  };
  db.clients.unshift(c);
  saveDB(db);

  closeClientModal();
  renderClients();
  updateKPIs();
  openProfile(c.id);
}

/* ====== RESET ====== */
function resetAll(){
  if (!confirm("¿Borrar TODO (clientes + visitas) de este navegador?")) return;
  localStorage.removeItem(KEY);
  closeProfile();
  refreshAll();
}

/* ====== REFRESH ====== */
function refreshAll(){
  updateKPIs();
  renderClients();
  renderTimeline();
  if (state.activeClientId) openProfile(state.activeClientId);
}

/* ====== Boot ====== */
(function boot(){
  // Hub
  $("hubBackBtn").href = HUB_URL;

  // Tabs
  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=>setView(b.dataset.view));
  });

  // Top buttons
  $("btnNewClient").addEventListener("click", openClientModal);
  $("btnExport").addEventListener("click", exportJSON);
  $("btnImport").addEventListener("click", ()=>$("importFile").click());
  $("importFile").addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = "";
  });

  // Modal client
  $("btnCloseModal").addEventListener("click", closeClientModal);
  $("btnCreateClient").addEventListener("click", createClient);

  // Profile actions
  $("btnCloseProfile").addEventListener("click", closeProfile);
  $("btnSaveClient").addEventListener("click", saveClientEdits);
  $("btnDeleteClient").addEventListener("click", ()=> deleteClient(state.activeClientId));
  $("btnAddVisit").addEventListener("click", ()=>openVisitModal(null));

  // Visit modal
  $("btnCloseVisitModal").addEventListener("click", closeVisitModal);
  $("btnSaveVisit").addEventListener("click", saveVisit);
  $("vDate").value = todayISO();

  // Searches
  $("clientSearch").addEventListener("input", renderClients);
  $("visitSearch").addEventListener("input", renderVisits);
  $("timelineSearch").addEventListener("input", renderTimeline);

  // Reset
  $("btnResetAll").addEventListener("click", resetAll);

  // First paint
  refreshAll();
})();
