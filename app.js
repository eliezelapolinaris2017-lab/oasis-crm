// 🔐 Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const ALLOWED = "nexustoolspr@gmail.com";
let UID = null;

// ===== AUTH =====
auth.onAuthStateChanged(async user=>{
  if(!user){
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    return;
  }
  if(user.email !== ALLOWED){
    alert("Acceso denegado");
    auth.signOut();
    return;
  }
  UID = user.uid;
  loadAll();
});

// ===== HELPERS =====
const $ = id => document.getElementById(id);
const money = n => `$${Number(n||0).toFixed(2)}`;

// ===== DATA =====
async function loadAll(){
  const snap = await db.collection("users").doc(UID).collection("clients").get();
  const clients = [];
  const visits = [];

  for(const c of snap.docs){
    clients.push({id:c.id,...c.data()});
    const vs = await db.collection("users").doc(UID)
      .collection("clients").doc(c.id)
      .collection("visits").get();
    vs.forEach(v=>visits.push({...v.data(),client:c.data().name}));
  }

  renderClients(clients,visits);
  renderTimeline(visits);
  updateKPIs(clients,visits);
}

// ===== CLIENTS =====
async function addClient(){
  const name = $("cName").value.trim();
  if(!name) return;
  await db.collection("users").doc(UID)
    .collection("clients")
    .add({name,contact:$("cContact").value});
  $("cName").value="";
  $("cContact").value="";
  loadAll();
}

function renderClients(clients,visits){
  $("clientsBody").innerHTML="";
  clients.forEach(c=>{
    const total = visits
      .filter(v=>v.client===c.name)
      .reduce((a,b)=>a+Number(b.amount||0),0);
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${c.name}</td>
      <td>${c.contact||""}</td>
      <td><strong>${money(total)}</strong></td>
      <td><button onclick="addVisit('${c.id}','${c.name}')">+ Visita</button></td>`;
    $("clientsBody").appendChild(tr);
  });
}

// ===== VISITS =====
async function addVisit(cid,name){
  const service = prompt("Servicio");
  const amount = prompt("Monto");
  if(!service) return;
  await db.collection("users").doc(UID)
    .collection("clients").doc(cid)
    .collection("visits")
    .add({
      service,
      amount:Number(amount||0),
      date:new Date().toISOString().slice(0,10),
      name
    });
  loadAll();
}

// ===== TIMELINE =====
function renderTimeline(visits){
  $("timelineBody").innerHTML="";
  visits.sort((a,b)=>b.date.localeCompare(a.date))
    .forEach(v=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${v.date}</td>
        <td>${v.client}</td>
        <td>${v.service}</td>
        <td><strong>${money(v.amount)}</strong></td>`;
      $("timelineBody").appendChild(tr);
    });
}

// ===== KPIs =====
function updateKPIs(clients,visits){
  $("kpiClients").textContent=clients.length;
  $("kpiRevenue").textContent=money(
    visits.reduce((a,b)=>a+Number(b.amount||0),0)
  );
}

// ===== EVENTS =====
$("btnAddClient").onclick = addClient;

document.querySelectorAll(".tab").forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    b.classList.add("active");
    $(`view-${b.dataset.view}`).classList.add("active");
  };
});
