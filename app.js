import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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

/* AUTH */
const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("app");

document.getElementById("btnLogin").onclick = async ()=>{
  try{
    await signInWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );
  }catch(e){
    authError.textContent = "Error de acceso";
  }
};

document.getElementById("btnLogout").onclick = ()=>signOut(auth);

onAuthStateChanged(auth,user=>{
  if(user){
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    loadAll();
  }else{
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
  }
});

/* DATA */
const clientsCol = collection(db,"clients");
const visitsCol = collection(db,"visits");

async function loadAll(){
  loadClients();
  loadVisits();
}

/* CLIENTS */
async function loadClients(){
  const snap = await getDocs(clientsCol);
  clientsBody.innerHTML = "";
  vClient.innerHTML = "";
  let count=0;
  snap.forEach(d=>{
    count++;
    const c = d.data();
    clientsBody.innerHTML += `
      <tr>
        <td>${c.name}</td>
        <td>${c.contact||""}</td>
        <td>$${c.total||0}</td>
        <td>-</td>
      </tr>`;
    vClient.innerHTML += `<option value="${d.id}">${c.name}</option>`;
  });
  kClients.textContent = count;
}

btnAddClient.onclick = async ()=>{
  if(!cName.value) return;
  await addDoc(clientsCol,{
    name:cName.value,
    contact:cContact.value,
    total:0,
    createdAt:new Date()
  });
  cName.value="";cContact.value="";
  loadClients();
};

/* VISITS */
async function loadVisits(){
  const q = query(visitsCol,orderBy("createdAt","desc"));
  const snap = await getDocs(q);
  timelineBody.innerHTML="";
  let revenue=0,visits=0;
  snap.forEach(d=>{
    const v = d.data();
    revenue += Number(v.amount||0);
    visits++;
    timelineBody.innerHTML += `
      <tr>
        <td>${new Date(v.createdAt.seconds*1000).toLocaleDateString()}</td>
        <td>${v.clientName}</td>
        <td>${v.service}</td>
        <td>$${v.amount}</td>
      </tr>`;
  });
  kRevenue.textContent = "$"+revenue;
  kVisits.textContent = visits;
}

btnAddVisit.onclick = async ()=>{
  if(!vClient.value||!vAmount.value) return;
  const name = vClient.options[vClient.selectedIndex].text;
  await addDoc(visitsCol,{
    clientId:vClient.value,
    clientName:name,
    service:vService.value,
    amount:Number(vAmount.value),
    createdAt:new Date()
  });
  vService.value="";vAmount.value="";
  loadVisits();
};
