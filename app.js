/* =========================================================
   Oasis CRM — Firebase Ready (AUTH CONTROLLED)
   - Auth email/password
   - Arranque seguro
   - Botones SIEMPRE activos
   ========================================================= */

// ================= FIREBASE =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion",
  storageBucket: "oasis-facturacion.firebasestorage.app",
  messagingSenderId: "84422038905",
  appId: "1:84422038905:web:b0eef65217d2bfc3298ba8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ================= ESTADO =================
let CURRENT_UID = null;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);
const money = (n) => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const uid = () => crypto.randomUUID();
const todayISO = () => new Date().toISOString().slice(0,10);

// ================= AUTH UI SIMPLE =================
function showLogin(){
  document.body.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#050505;color:#fff">
      <div style="width:320px;padding:22px;border:1px solid rgba(255,255,255,.15);border-radius:18px">
        <h3 style="margin:0 0 14px">Oasis CRM</h3>
        <input id="email" placeholder="Email" style="width:100%;padding:10px;margin-bottom:10px">
        <input id="pass" type="password" placeholder="Password" style="width:100%;padding:10px">
        <button id="loginBtn" style="width:100%;margin-top:12px;padding:10px">Entrar</button>
        <p id="err" style="color:#ef4444;font-size:13px"></p>
      </div>
    </div>
  `;

  $("loginBtn").onclick = async () => {
    try{
      await signInWithEmailAndPassword(auth, $("email").value, $("pass").value);
    }catch(e){
      $("err").textContent = e.message;
    }
  };
}

// ================= FIREBASE DB =================
async function loadDB(){
  const snap = await getDocs(collection(db, "crm_clients", CURRENT_UID, "data"));
  const clients = [];
  snap.forEach(d => clients.push(d.data()));
  return clients;
}

async function saveClient(client){
  await setDoc(doc(db, "crm_clients", CURRENT_UID, "data", client.id), client);
}

async function deleteClientFB(id){
  await deleteDoc(doc(db, "crm_clients", CURRENT_UID, "data", id));
}

// ================= CRM CORE =================
let CLIENTS = [];

function renderClients(){
  const body = $("clientsBody");
  body.innerHTML = "";

  if(!CLIENTS.length){
    body.innerHTML = `<tr><td colspan="7">Sin clientes</td></tr>`;
    return;
  }

  CLIENTS.forEach(c=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.name}</strong></td>
      <td>${c.contact||"—"}</td>
      <td>${c.status}</td>
      <td>${(c.tags||[]).join(", ")}</td>
      <td>${c.last||"—"}</td>
      <td><strong>${money(c.total||0)}</strong></td>
      <td>
        <button data-del="${c.id}">Borrar</button>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick = async ()=> {
      await deleteClientFB(b.dataset.del);
      CLIENTS = CLIENTS.filter(c=>c.id!==b.dataset.del);
      renderClients();
    };
  });
}

function updateKPIs(){
  $("kpiClients").textContent = CLIENTS.length;
  $("kpiVIP").textContent = CLIENTS.filter(c=>c.status==="VIP").length;
  $("kpiRevenue").textContent = money(
    CLIENTS.reduce((a,c)=>a+(c.total||0),0)
  );
}

// ================= BOOT =================
async function bootCRM(){
  CLIENTS = await loadDB();
  renderClients();
  updateKPIs();

  $("btnNewClient").onclick = async () => {
    const c = {
      id: uid(),
      name: prompt("Nombre cliente"),
      status:"Activo",
      total:0,
      createdAt:new Date().toISOString()
    };
    if(!c.name) return;
    CLIENTS.push(c);
    await saveClient(c);
    renderClients();
    updateKPIs();
  };
}

// ================= AUTH LISTENER =================
onAuthStateChanged(auth, user=>{
  if(!user){
    showLogin();
    return;
  }
  CURRENT_UID = user.uid;
  document.body.style.display = "";
  bootCRM();
});
