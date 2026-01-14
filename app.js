/* ===============================
   Oasis CRM — Firebase Silent Auth
   =============================== */

const firebaseConfig = {
  apiKey: "AIzaSyBm67RjL0QzMRLfo6zUYCI0bak1eGJAR-U",
  authDomain: "oasis-facturacion.firebaseapp.com",
  projectId: "oasis-facturacion",
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

/* 🔐 CREDENCIALES INTERNAS */
const INTERNAL_EMAIL = "nexustoolspr@gmail.com";
const INTERNAL_PASSWORD = "OasisCRM@2026"; // misma que facturación

/* ====== BOOT ====== */
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    try {
      await auth.signInWithEmailAndPassword(INTERNAL_EMAIL, INTERNAL_PASSWORD);
    } catch (e) {
      alert("Error crítico de autenticación");
      console.error(e);
      return;
    }
  }

  document.getElementById("bootLoader").style.display = "none";
  document.getElementById("app").style.display = "block";
  loadClients();
});

/* ====== CRM ====== */
const clientsRef = db.collection("crm_clients");
const visitsRef = db.collection("crm_visits");

function money(n){
  return Number(n || 0).toLocaleString("en-US",{style:"currency",currency:"USD"});
}

async function loadClients(){
  const snap = await clientsRef.get();
  const body = document.getElementById("clientsBody");
  body.innerHTML = "";

  let total = 0;
  let vip = 0;

  snap.forEach(doc=>{
    const c = doc.data();
    total++;
    if (c.status === "VIP") vip++;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.name}</strong></td>
      <td>${c.contact || "—"}</td>
      <td>${c.status}</td>
      <td>${money(c.total || 0)}</td>
      <td><button class="btn ghost">Abrir</button></td>
    `;
    body.appendChild(tr);
  });

  document.getElementById("kpiClients").textContent = total;
  document.getElementById("kpiVIP").textContent = vip;
}

/* ====== NUEVO CLIENTE ====== */
document.getElementById("btnNewClient").addEventListener("click", async ()=>{
  const name = prompt("Nombre del cliente");
  if (!name) return;

  await clientsRef.add({
    name,
    status:"Prospecto",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    total: 0
  });

  loadClients();
});
