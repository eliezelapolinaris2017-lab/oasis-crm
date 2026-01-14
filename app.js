<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<script>
/* ================= FIREBASE ================= */
const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion",
  storageBucket: "oasis-facturacion.firebasestorage.app",
  messagingSenderId: "84422038905",
  appId: "1:84422038905:web:b0eef65217d2bfc3298ba8"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ================= AUTH ================= */
let CURRENT_USER = null;

auth.onAuthStateChanged(user => {
  if (!user) {
    const email = prompt("Email CRM");
    const pass = prompt("Password");
    auth.signInWithEmailAndPassword(email, pass)
      .catch(e => alert(e.message));
    return;
  }
  CURRENT_USER = user.uid;
  loadFromFirebase();
});

/* ================= HELPERS ================= */
const HUB_URL = "https://eliezelapolinaris2017-lab.github.io/oasis-hub/";
const KEY = "oasis_crm_cache";

const $ = id => document.getElementById(id);
const uid = p => `${p}_${Date.now()}`;
const money = n => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"});

/* ================= LOCAL CACHE ================= */
function cacheSave(data){
  localStorage.setItem(KEY, JSON.stringify(data));
}
function cacheLoad(){
  return JSON.parse(localStorage.getItem(KEY) || '{"clients":[],"visits":[]}');
}

/* ================= FIREBASE SYNC ================= */
async function loadFromFirebase(){
  const snapC = await db.collection("crm_clients")
    .where("userId","==",CURRENT_USER).get();
  const snapV = await db.collection("crm_visits")
    .where("userId","==",CURRENT_USER).get();

  const data = {
    clients: snapC.docs.map(d=>d.data()),
    visits: snapV.docs.map(d=>d.data())
  };
  cacheSave(data);
  refreshAll();
}

async function saveClientFB(client){
  client.userId = CURRENT_USER;
  await db.collection("crm_clients").doc(client.id).set(client);
}
async function saveVisitFB(visit){
  visit.userId = CURRENT_USER;
  await db.collection("crm_visits").doc(visit.id).set(visit);
}
async function deleteClientFB(id){
  await db.collection("crm_clients").doc(id).delete();
}
async function deleteVisitFB(id){
  await db.collection("crm_visits").doc(id).delete();
}

/* ================= STATE ================= */
let state = {
  activeClientId:null
};

/* ================= DATA ================= */
function getDB(){ return cacheLoad(); }

/* ================= CRUD CLIENT ================= */
async function createClient(){
  const dbx = getDB();
  const c = {
    id: uid("c"),
    name: $("mName").value,
    contact: $("mContact").value,
    addr: $("mAddr").value,
    status: $("mStatus").value,
    tags: $("mTags").value.split(","),
    note: $("mNote").value,
    createdAt: new Date().toISOString()
  };
  dbx.clients.unshift(c);
  cacheSave(dbx);
  await saveClientFB(c);
  refreshAll();
}

async function deleteClient(id){
  if(!confirm("Borrar cliente?")) return;
  const dbx = getDB();
  dbx.clients = dbx.clients.filter(c=>c.id!==id);
  dbx.visits = dbx.visits.filter(v=>v.clientId!==id);
  cacheSave(dbx);
  await deleteClientFB(id);
  refreshAll();
}

/* ================= VISITS ================= */
async function saveVisit(){
  const dbx = getDB();
  const v = {
    id: uid("v"),
    clientId: state.activeClientId,
    date: $("vDate").value,
    service: $("vService").value,
    amount: Number($("vAmount").value||0),
    note: $("vNote").value,
    createdAt: new Date().toISOString()
  };
  dbx.visits.unshift(v);
  cacheSave(dbx);
  await saveVisitFB(v);
  refreshAll();
}

/* ================= RENDER ================= */
function refreshAll(){
  const dbx = getDB();
  $("kpiClients").textContent = dbx.clients.length;
  $("kpiRevenue").textContent =
    money(dbx.visits.reduce((a,v)=>a+v.amount,0));
}

/* ================= BOOT ================= */
document.addEventListener("DOMContentLoaded",()=>{
  $("hubBackBtn").href = HUB_URL;
  refreshAll();
});
</script>
