/* OCD — Frontend. Remplace les deux valeurs ci-dessous par celles de ton projet Supabase. */
const SUPABASE_URL = "https://arrkltlqhlekuwkexpxj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFycmtsdGxxaGxla3V3a2V4cHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTE5NDYsImV4cCI6MjEwNzM2Nzk0Nn0.EISwSfbgzg9nus9C7Kq5a6lwMaZpfo8x4oFzZi7zYAs";

const COUNTRIES = [
  "Bénin","Burkina Faso","Burundi","Cameroun","Cap-Vert","Comores","Congo","Côte d’Ivoire",
  "Djibouti","Érythrée","Eswatini","Éthiopie","Gabon","Gambie","Ghana","Guinée",
  "Guinée-Bissau","Guinée équatoriale","Kenya","Lesotho","Liberia","Libye","Madagascar",
  "Malawi","Mali","Maroc","Maurice","Mauritanie","Mozambique","Namibie","Niger",
  "Nigeria","Ouganda","République centrafricaine","République démocratique du Congo",
  "Rwanda","Sao Tomé-et-Principe","Sénégal","Seychelles","Sierra Leone","Somalie",
  "Soudan","Soudan du Sud","Tanzanie","Tchad","Togo","Tunisie","Zambie","Zimbabwe",
  "Afrique du Sud","Algérie","Angola","Botswana","Égypte"
].sort((a,b)=>a.localeCompare(b,"fr"));
const SECTORS = ["Événementiel","Commerce et vente","Informatique et numérique","Communication et marketing","Transport et logistique","Sécurité","Hôtellerie et restauration","Bâtiment et travaux","Agriculture","Éducation et formation","Santé","Administration","Entrepreneuriat","Arts et divertissement","Autre"];
const OP_TYPES = ["Emploi","Mission","Entrepreneuriat","Formation","Formation / bourse","Stage","Événement / recrutement"];
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
let supabaseClient = null;
let currentUser = null;
let currentProfile = null;
let currentTab = "recommended";
let adminTab = "offers";
let opportunities = [];
let myApplications = [];
let toastTimer;

const ready = () => supabaseClient && SUPABASE_URL.includes(".supabase.co") && !SUPABASE_ANON_KEY.includes("COLLE_TA_CLE");
function escapeHtml(value="") {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function notify(message) {
  const el=$("#toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),3500);
}
function showMessage(text, kind="error") {
  const el=$("#authMessage"); el.textContent=text; el.className=`message ${kind}`;
}
function showView(name) {
  $$(".view").forEach(v=>v.classList.add("hidden"));
  const target=$(`#${name}View`); if(target) target.classList.remove("hidden");
  $("#mainNav").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="dashboard" && currentUser) renderDashboard(currentTab);
  if(name==="admin" && currentUser) loadAdmin();
}
function fillCountrySelect(select, selected="") {
  if(!select) return;
  select.innerHTML='<option value="">Choisir un pays</option>'+COUNTRIES.map(c=>`<option ${c===selected?"selected":""} value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}
function fillSectorSelect(select, selected="", allowAny=false) {
  if(!select) return;
  select.innerHTML=(allowAny?'<option value="">Tous les secteurs</option>':'<option value="">Choisir un secteur</option>')+SECTORS.map(s=>`<option ${s===selected?"selected":""} value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}
function fillTypeSelect(select, selected="", allowAny=false) {
  if(!select) return;
  select.innerHTML=(allowAny?'<option value="">Tous les types</option>':'<option value="">Choisir un type</option>')+OP_TYPES.map(s=>`<option ${s===selected?"selected":""} value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}
function configReady() {
  if(ready()) return true;
  notify("Configure d'abord l'URL et la clé publique Supabase dans app.js.");
  return false;
}
function isAdmin() { return currentProfile?.role==="admin"; }
function fmtDate(value) {
  if(!value) return "Date à confirmer";
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(value));
}
function scoreOpportunity(op, profile) {
  if(!profile) return 0;
  let score=0;
  if(op.country_scope==="Tous les pays") score+=1;
  else if(profile.country && op.country_scope===profile.country) score+=100;
  else return -1;
  if(op.sector && profile.sector===op.sector) score+=30;
  else if(op.sector && profile.sector && profile.sector!==op.sector) score+=0;
  const skills=(profile.skills||"").toLocaleLowerCase("fr").split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
  const required=(op.required_skills||"").toLocaleLowerCase("fr").split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
  if(required.length) {
    const hits=required.filter(req=>skills.some(skill=>skill.includes(req)||req.includes(skill)));
    score+=Math.round(20*hits.length/required.length);
  }
  if(profile.availability && op.availability_required && profile.availability===op.availability_required) score+=5;
  return score;
}
function sortForProfile(items, profile) {
  return [...items].sort((a,b)=>scoreOpportunity(b,profile)-scoreOpportunity(a,profile));
}
function matchesCountry(op, profile) {
  return op.country_scope==="Tous les pays" || op.country_scope===profile?.country;
}
function opCard(op, showScore=false) {
  const score=currentProfile?scoreOpportunity(op,currentProfile):0;
  const isApplied=myApplications.some(a=>a.opportunity_id===op.id);
  return `<article class="op-card">
    <div class="op-top"><span class="op-type">${escapeHtml(op.type||"Opportunité")}</span><span class="op-country">⌖ ${escapeHtml(op.country_scope||"Afrique")}</span></div>
    <h3>${escapeHtml(op.title)}</h3><div class="op-org">${escapeHtml(op.organization||"Communauté OCD")} · ${escapeHtml(op.city||"À préciser")}</div>
    <p class="op-desc">${escapeHtml((op.description||"").slice(0,150))}${(op.description||"").length>150?"…":""}</p>
    <div class="op-meta"><span>${escapeHtml(op.sector||"Tous secteurs")}</span>${op.deadline?`<span>Limite : ${escapeHtml(fmtDate(op.deadline))}</span>`:""}</div>
    <div class="op-footer"><small>${showScore && score>=100?"✦ Prioritaire pour ton profil":isApplied?"✓ Candidature envoyée":"Publié le "+fmtDate(op.created_at)}</small><button class="op-apply" data-open-offer="${escapeHtml(op.id)}">${isApplied?"Voir le suivi":"Découvrir ↗"}</button></div>
  </article>`;
}
async function fetchOpportunities() {
  if(!ready()) {
    $("#homeOpportunities").innerHTML='<div class="empty-state"><b>Le site est prêt à être connecté.</b>Ajoute les identifiants de ton projet Supabase dans app.js pour afficher les offres publiées.</div>';
    return [];
  }
  const {data,error}=await supabaseClient.from("opportunities").select("*").eq("status","published").order("created_at",{ascending:false});
  if(error) { console.error(error); return []; }
  opportunities=data||[]; return opportunities;
}
async function fetchProfile() {
  if(!currentUser) return null;
  const {data,error}=await supabaseClient.from("profiles").select("*").eq("id",currentUser.id).maybeSingle();
  if(error) throw error;
  currentProfile=data; return data;
}
async function fetchApplications() {
  if(!currentUser) return [];
  const {data,error}=await supabaseClient.from("applications").select("id,opportunity_id,status,created_at,opportunities(id,title,sector,country_scope,organization)").order("created_at",{ascending:false});
  if(error) { console.error(error); return []; }
  myApplications=data||[]; return myApplications;
}
function setAuthMode(mode) {
  const signup=mode==="signup";
  $$(".auth-tab").forEach(t=>t.classList.toggle("active",t.dataset.auth===mode));
  $("#signupFields").classList.toggle("hidden",!signup);
  $("#signupFields").querySelectorAll("input,select").forEach(el=>el.required=signup);
  $("#authTitle").textContent=signup?"Rejoins OCD":"Content de te revoir";
  $("#authSubtitle").textContent=signup?"Quelques informations pour commencer.":"Connecte-toi pour retrouver ton espace.";
  $("#authSubmit").innerHTML=signup?'Créer mon compte <span>↗</span>':'Me connecter <span>↗</span>';
  $("#authForm").elements.password.autocomplete=signup?"new-password":"current-password";
  showMessage("");
}
async function handleAuth(event) {
  event.preventDefault(); if(!configReady()) return;
  const form=event.currentTarget, data=new FormData(form);
  const email=String(data.get("email")||"").trim(), password=String(data.get("password")||"");
  const signup=!$("#signupFields").classList.contains("hidden");
  const btn=$("#authSubmit"); btn.disabled=true; btn.textContent="Patiente…";
  try {
    if(signup) {
      const metadata={
        full_name:String(data.get("full_name")||"").trim(),
        age:Number(data.get("age")),
        country:String(data.get("country")||""),
        city:String(data.get("city")||"").trim(),
        phone:String(data.get("phone")||"").trim()
      };
      const {data:result,error}=await supabaseClient.auth.signUp({email,password,options:{data:metadata}});
      if(error) throw error;
      if(result.user && !result.session) {
        showMessage("Compte créé. Vérifie ton e-mail pour confirmer ton inscription, puis connecte-toi.","success");
      } else if(result.session) {
        showMessage("Compte créé. Complète maintenant ton profil.","success");
        await onSignedIn(result.user);
      } else showMessage("Vérifie ta boîte e-mail pour continuer.","success");
    } else {
      const {data:result,error}=await supabaseClient.auth.signInWithPassword({email,password});
      if(error) throw error;
      await onSignedIn(result.user);
    }
  } catch(err) { showMessage(err.message||"Impossible de traiter la demande."); }
  finally {btn.disabled=false; setAuthMode(signup?"signup":"login");}
}
async function onSignedIn(user) {
  currentUser=user;
  try { await fetchProfile(); } catch(e) { console.error(e); }
  await fetchOpportunities(); await fetchApplications();
  if(isAdmin()) { showView("admin"); notify("Bienvenue dans l'administration OCD."); }
  else { showView("dashboard"); notify("Bienvenue dans ton espace OCD."); }
}
async function logout() {
  if(ready()) { const {error}=await supabaseClient.auth.signOut(); if(error) notify(error.message); }
  currentUser=null; currentProfile=null; myApplications=[]; showView("home"); notify("Tu es déconnecté.");
}
function profileFormHtml() {
  const p=currentProfile||{};
  return `<form id="profileForm" class="profile-form">
    <h2>Mon profil</h2><p>Un profil précis aide OCD à mieux faire ressortir les opportunités adaptées à ta situation.</p>
    <div class="profile-form-grid">
      <label>Nom complet<input name="full_name" required value="${escapeHtml(p.full_name||"")}"></label>
      <label>Âge<input name="age" type="number" min="16" max="100" required value="${escapeHtml(p.age||"")}"></label>
      <label>Pays<select name="country" id="profileCountry" required></select></label>
      <label>Ville<input name="city" required value="${escapeHtml(p.city||"")}"></label>
      <label>Téléphone / WhatsApp<input name="phone" type="tel" required value="${escapeHtml(p.phone||"")}"></label>
      <label>Secteur principal<select name="sector" id="profileSector" required></select></label>
      <label class="field-wide">Compétences (séparées par des virgules)<textarea name="skills" placeholder="Ex. : accueil, vente, Excel, conduite">${escapeHtml(p.skills||"")}</textarea></label>
      <label>Expérience<select name="experience"><option value="">Choisir</option>${["Débutant","Moins d’un an","1 à 3 ans","3 ans et plus"].map(x=>`<option ${p.experience===x?"selected":""}>${x}</option>`).join("")}</select></label>
      <label>Disponibilité<select name="availability"><option value="">Choisir</option>${["Immédiate","Sous une semaine","Sous un mois","À discuter"].map(x=>`<option ${p.availability===x?"selected":""}>${x}</option>`).join("")}</select></label>
      <label class="field-wide">Présentation (facultatif)<textarea name="bio" placeholder="Présente-toi en quelques phrases">${escapeHtml(p.bio||"")}</textarea></label>
    </div><button class="btn" type="submit">Enregistrer mon profil <span>↗</span></button><div id="profileMessage" class="message"></div>
  </form>`;
}
function renderDashboard(tab="recommended") {
  currentTab=tab;
  $$(".dash-link").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  const name=currentProfile?.full_name||currentUser?.email||"Membre OCD";
  $("#sideName").textContent=name; $("#sideCountry").textContent=currentProfile?.country||"Complète ton profil";
  $("#userAvatar").textContent=name.trim().charAt(0).toUpperCase();
  const titles={recommended:"Les opportunités pour toi.",all:"Toutes les opportunités.",applications:"Mes candidatures.",profile:"Construis ton profil."};
  $("#dashTitle").textContent=titles[tab]||titles.recommended;
  const root=$("#dashContent");
  if(tab==="profile") {
    root.innerHTML=profileFormHtml(); fillCountrySelect($("#profileCountry"),currentProfile?.country||""); fillSectorSelect($("#profileSector"),currentProfile?.sector||"");
    $("#profileForm").addEventListener("submit",saveProfile); return;
  }
  if(tab==="applications") {
    if(!myApplications.length) root.innerHTML='<div class="empty-state"><b>Tu n’as pas encore candidaté.</b>Explore les opportunités et envoie ta première candidature.</div>';
    else root.innerHTML=`<div class="applications-list">${myApplications.map(a=>`<article class="application-row"><div><h3>${escapeHtml(a.opportunities?.title||"Opportunité")}</h3><p>${escapeHtml(a.opportunities?.country_scope||"")} · Candidature envoyée le ${fmtDate(a.created_at)}</p></div><span class="status-pill">${escapeHtml(statusLabel(a.status))}</span></article>`).join("")}</div>`;
    return;
  }
  let items=tab==="recommended"?sortForProfile(opportunities,currentProfile).filter(op=>matchesCountry(op,currentProfile)):opportunities;
  root.innerHTML=`<div class="dash-intro"><div><h2>${tab==="recommended"?"Ton prochain pas peut commencer ici.":"Explore les possibilités."}</h2><p>${tab==="recommended"?"Les offres correspondant à ton pays sont affichées en priorité. Le secteur et les compétences affinent ensuite le classement.":"Utilise les filtres pour trouver les offres ouvertes aux jeunes de ton pays."}</p></div><div class="big-star">✦</div></div>
    <div class="filter-row"><select class="filter-select" id="filterSector"></select><select class="filter-select" id="filterType"></select><select class="filter-select" id="filterCountry"></select></div>
    <div class="dashboard-cards" id="dashboardCards"></div>`;
  fillSectorSelect($("#filterSector"),"",true); fillTypeSelect($("#filterType"),"",true); fillCountrySelect($("#filterCountry"),"");
  $("#filterSector").addEventListener("change",applyDashFilters); $("#filterType").addEventListener("change",applyDashFilters); $("#filterCountry").addEventListener("change",applyDashFilters);
  applyDashFilters();
}
function applyDashFilters() {
  const sector=$("#filterSector")?.value||"", type=$("#filterType")?.value||"", country=$("#filterCountry")?.value||"";
  let items=currentTab==="recommended"?sortForProfile(opportunities,currentProfile).filter(op=>matchesCountry(op,currentProfile)):[...opportunities];
  if(sector) items=items.filter(o=>o.sector===sector);
  if(type) items=items.filter(o=>o.type===type);
  if(country) items=items.filter(o=>o.country_scope===country||o.country_scope==="Tous les pays");
  $("#dashboardCards").innerHTML=items.length?items.map(o=>opCard(o,currentTab==="recommended")).join(""):'<div class="empty-state"><b>Aucune offre ne correspond à ces filtres.</b>Essaie un autre secteur ou reviens plus tard.</div>';
}
async function saveProfile(event) {
  event.preventDefault();
  const form=event.currentTarget, d=new FormData(form);
  const payload={
    id:currentUser.id,
    full_name:String(d.get("full_name")||"").trim(),
    age:Number(d.get("age")),
    country:String(d.get("country")||""),
    city:String(d.get("city")||"").trim(),
    phone:String(d.get("phone")||"").trim(),
    sector:String(d.get("sector")||""),
    skills:String(d.get("skills")||"").trim(),
    experience:String(d.get("experience")||""),
    availability:String(d.get("availability")||""),
    bio:String(d.get("bio")||"").trim(),
    updated_at:new Date().toISOString()
  };
  const {error}=await supabaseClient.from("profiles").upsert(payload,{onConflict:"id"});
  const msg=$("#profileMessage");
  if(error){msg.textContent=error.message;msg.className="message error";return;}
  currentProfile={...currentProfile,...payload}; msg.textContent="Profil enregistré.";msg.className="message success";
  $("#sideName").textContent=payload.full_name; $("#sideCountry").textContent=payload.country; notify("Profil mis à jour.");
}
function statusLabel(status) {
  return ({submitted:"Envoyée",reviewing:"En cours d’examen",accepted:"Retenue",rejected:"Non retenue",withdrawn:"Retirée"})[status]||status||"Envoyée";
}
async function openOffer(id) {
  const op=opportunities.find(o=>o.id===id); if(!op) return;
  const applied=myApplications.some(a=>a.opportunity_id===id);
  $("#offerModalContent").innerHTML=`<span class="op-type">${escapeHtml(op.type||"Opportunité")}</span><h2 id="offerModalTitle">${escapeHtml(op.title)}</h2><div class="op-org">${escapeHtml(op.organization||"Communauté OCD")} · ${escapeHtml(op.city||"À préciser")} · ${escapeHtml(op.country_scope||"")}</div>
    <div class="modal-detail-meta"><span>${escapeHtml(op.sector||"Tous secteurs")}</span>${op.deadline?`<span>Date limite : ${escapeHtml(fmtDate(op.deadline))}</span>`:""}</div>
    <p>${escapeHtml(op.description||"Aucune description fournie.")}</p>
    ${op.required_skills?`<p><b>Compétences recherchées :</b> ${escapeHtml(op.required_skills)}</p>`:""}
    ${op.availability_required?`<p><b>Disponibilité demandée :</b> ${escapeHtml(op.availability_required)}</p>`:""}
    ${op.application_instructions?`<p><b>Instructions :</b> ${escapeHtml(op.application_instructions)}</p>`:""}
    <div id="offerApplyMessage" class="message"></div>
    ${currentUser?`<button class="btn btn-full" id="applyBtn" ${applied?"disabled":""}>${applied?"Candidature déjà envoyée":"Postuler à cette opportunité"} <span>↗</span></button>`:`<button class="btn btn-full" id="modalJoin">Connecte-toi pour postuler <span>↗</span></button>`}`;
  $("#offerModal").classList.remove("hidden");
  $("#applyBtn")?.addEventListener("click",()=>applyToOffer(id));
  $("#modalJoin")?.addEventListener("click",()=>{$("#offerModal").classList.add("hidden");showView("auth");setAuthMode("signup");});
}
async function applyToOffer(id) {
  if(!currentUser) {showView("auth");return;}
  if(!currentProfile?.country || !currentProfile?.sector) {
    $("#offerApplyMessage").textContent="Complète d’abord ton pays et ton secteur dans Mon profil.";$("#offerApplyMessage").className="message error";return;
  }
  const op=opportunities.find(o=>o.id===id);
  if(op && !matchesCountry(op,currentProfile)) {
    $("#offerApplyMessage").textContent="Cette offre n’est pas ouverte à ton pays.";$("#offerApplyMessage").className="message error";return;
  }
  const btn=$("#applyBtn"); if(btn){btn.disabled=true;btn.textContent="Envoi…";}
  const {error}=await supabaseClient.from("applications").insert({opportunity_id:id,user_id:currentUser.id});
  if(error) {
    $("#offerApplyMessage").textContent=error.code==="23505"?"Tu as déjà candidaté à cette offre.":error.message;
    $("#offerApplyMessage").className="message error";if(btn){btn.disabled=false;btn.textContent="Postuler à cette opportunité ↗";}return;
  }
  await fetchApplications();
  $("#offerApplyMessage").textContent="Candidature envoyée. Tu pourras suivre son statut dans ton espace.";$("#offerApplyMessage").className="message success";
  if(btn){btn.disabled=true;btn.textContent="Candidature envoyée ✓";}
  renderDashboard(currentTab);notify("Candidature envoyée.");
}
async function loadAdmin() {
  if(!isAdmin()) {showView(currentUser?"dashboard":"home");notify("Accès réservé aux administrateurs OCD.");return;}
  const [pRes,oRes,aRes]=await Promise.all([
    supabaseClient.from("profiles").select("id",{count:"exact",head:true}),
    supabaseClient.from("opportunities").select("id",{count:"exact",head:true}),
    supabaseClient.from("applications").select("id",{count:"exact",head:true})
  ]);
  $("#adminStats").innerHTML=`<div class="stat-card"><small>Membres inscrits</small><b>${pRes.count??"—"}</b></div><div class="stat-card"><small>Opportunités enregistrées</small><b>${oRes.count??"—"}</b></div><div class="stat-card"><small>Candidatures</small><b>${aRes.count??"—"}</b></div>`;
  $$(".admin-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===adminTab));
  if(adminTab==="offers") await renderAdminOffers();
  else if(adminTab==="applications") await renderAdminApplications();
  else await renderAdminMembers();
}
async function renderAdminOffers() {
  const {data,error}=await supabaseClient.from("opportunities").select("*").order("created_at",{ascending:false});
  if(error){$("#adminContent").innerHTML=`<p class="message error">${escapeHtml(error.message)}</p>`;return;}
  opportunities=data||[];
  $("#adminContent").innerHTML=`<button class="btn" id="newOfferBtn" style="margin-bottom:18px">+ Ajouter une opportunité <span>↗</span></button>
    <form id="adminOfferForm" class="admin-form" hidden>
      <h2 id="offerFormHeading">Nouvelle opportunité</h2><p>Seuls les administrateurs OCD peuvent publier des offres.</p>
      <input type="hidden" name="id">
      <div class="admin-form-grid">
        <label>Titre de l’offre<input name="title" required maxlength="140" placeholder="Ex. : Agents d’accueil pour événement"></label>
        <label>Organisation<input name="organization" placeholder="OCD ou nom de l’organisation"></label>
        <label>Type<select name="type" id="adminType" required></select></label>
        <label>Secteur<select name="sector" id="adminSector" required></select></label>
        <label>Pays concerné<select name="country_scope" id="adminCountry" required></select></label>
        <label>Ville<input name="city" placeholder="Ex. : Cotonou"></label>
        <label>Date limite<input name="deadline" type="date"></label>
        <label>Disponibilité demandée<select name="availability_required" id="adminAvailability"><option value="">Non précisée</option><option>Immédiate</option><option>Sous une semaine</option><option>Sous un mois</option><option>À discuter</option></select></label>
        <label>Compétences recherchées<input name="required_skills" placeholder="Accueil, vente, conduite…"></label>
        <label class="field-wide">Description<textarea name="description" required placeholder="Décris la mission, les conditions et le profil recherché."></textarea></label>
        <label class="field-wide">Informations complémentaires<textarea name="application_instructions" placeholder="Documents à préparer, critères particuliers ou étapes de sélection…"></textarea></label>
        <label>Statut<select name="status"><option value="published">Publié</option><option value="draft">Brouillon</option><option value="closed">Clôturé</option></select></label>
      </div>
      <div class="admin-form-actions"><button class="btn" type="submit">Enregistrer l’offre ↗</button><button class="small-action" type="button" id="cancelOfferEdit">Annuler</button></div><div id="adminOfferMessage" class="message"></div>
    </form>
    <div class="admin-offer-list">${data?.length?data.map(o=>`<article class="admin-offer"><div><h3>${escapeHtml(o.title)}</h3><p>${escapeHtml(o.country_scope)} · ${escapeHtml(o.sector)} · ${escapeHtml(o.status)}</p></div><div class="admin-actions"><button class="small-action" data-edit-offer="${escapeHtml(o.id)}">Modifier</button><button class="small-action danger" data-delete-offer="${escapeHtml(o.id)}">Supprimer</button></div></article>`).join(""):'<div class="empty-state"><b>Aucune opportunité pour le moment.</b>Crée la première offre OCD.</div>'}</div>`;
  fillTypeSelect($("#adminType"));fillSectorSelect($("#adminSector"));fillCountrySelect($("#adminCountry"));
  $("#newOfferBtn").addEventListener("click",()=>{const f=$("#adminOfferForm");f.hidden=false;f.reset();f.elements.id.value="";$("#offerFormHeading").textContent="Nouvelle opportunité";window.scrollTo({top:f.getBoundingClientRect().top+scrollY-100,behavior:"smooth"});});
  $("#cancelOfferEdit").addEventListener("click",()=>$("#adminOfferForm").hidden=true);
  $("#adminOfferForm").addEventListener("submit",saveOpportunity);
  $$("[data-edit-offer]").forEach(b=>b.addEventListener("click",()=>editOpportunity(b.dataset.editOffer)));
  $$("[data-delete-offer]").forEach(b=>b.addEventListener("click",()=>deleteOpportunity(b.dataset.deleteOffer)));
}
async function editOpportunity(id) {
  const op=opportunities.find(o=>o.id===id); if(!op)return;
  const f=$("#adminOfferForm"); f.hidden=false; f.reset();
  for(const [k,v] of Object.entries(op)) if(f.elements[k]) f.elements[k].value=v??"";
  $("#offerFormHeading").textContent="Modifier l’opportunité";
  window.scrollTo({top:f.getBoundingClientRect().top+scrollY-100,behavior:"smooth"});
}
async function saveOpportunity(event) {
  event.preventDefault(); const f=event.currentTarget,d=new FormData(f), id=String(d.get("id")||"");
  const payload={
    title:String(d.get("title")||"").trim(),organization:String(d.get("organization")||"OCD").trim(),
    type:String(d.get("type")||""),sector:String(d.get("sector")||""),country_scope:String(d.get("country_scope")||""),
    city:String(d.get("city")||"").trim(),
    deadline:d.get("deadline")||null,availability_required:String(d.get("availability_required")||""),
    required_skills:String(d.get("required_skills")||"").trim(),description:String(d.get("description")||"").trim(),
    application_instructions:String(d.get("application_instructions")||"").trim(),status:String(d.get("status")||"published"),
    created_by:currentUser.id
  };
  const msg=$("#adminOfferMessage");
  const result=id?await supabaseClient.from("opportunities").update(payload).eq("id",id).select().single():await supabaseClient.from("opportunities").insert(payload).select().single();
  if(result.error){msg.textContent=result.error.message;msg.className="message error";return;}
  notify(id?"Opportunité modifiée.":"Opportunité créée.");
  await loadAdmin();
}
async function deleteOpportunity(id) {
  if(!confirm("Supprimer cette opportunité et ses candidatures ?"))return;
  const {error}=await supabaseClient.from("opportunities").delete().eq("id",id);
  if(error){notify("Erreur : "+error.message);return;}
  notify("Opportunité supprimée.");await loadAdmin();
}
async function renderAdminApplications() {
  const {data,error}=await supabaseClient.from("applications").select("id,status,created_at,profiles(full_name,country,sector,phone),opportunities(title,country_scope,sector)").order("created_at",{ascending:false});
  if(error){$("#adminContent").innerHTML=`<p class="message error">${escapeHtml(error.message)}</p>`;return;}
  $("#adminContent").innerHTML=data?.length?`<div class="table-wrap"><table><thead><tr><th>Candidat</th><th>Pays / secteur</th><th>Opportunité</th><th>Date</th><th>Statut</th></tr></thead><tbody>${data.map(a=>`<tr><td><b>${escapeHtml(a.profiles?.full_name||"Profil")}</b><br><span class="muted">${escapeHtml(a.profiles?.phone||"")}</span></td><td>${escapeHtml(a.profiles?.country||"")}<br>${escapeHtml(a.profiles?.sector||"")}</td><td>${escapeHtml(a.opportunities?.title||"Offre supprimée")}</td><td>${fmtDate(a.created_at)}</td><td><select class="inline-select" data-app-status="${escapeHtml(a.id)}">${["submitted","reviewing","accepted","rejected","withdrawn"].map(s=>`<option value="${s}" ${a.status===s?"selected":""}>${statusLabel(s)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`:'<div class="empty-state"><b>Aucune candidature.</b>Les candidatures envoyées apparaîtront ici.</div>';
  $$("[data-app-status]").forEach(sel=>sel.addEventListener("change",async()=>{
    const {error}=await supabaseClient.from("applications").update({status:sel.value}).eq("id",sel.dataset.appStatus);
    if(error)notify(error.message);else notify("Statut de candidature mis à jour.");
  }));
}
async function renderAdminMembers() {
  const {data,error}=await supabaseClient.from("profiles").select("id,full_name,age,country,city,phone,sector,role,created_at").order("created_at",{ascending:false}).limit(300);
  if(error){$("#adminContent").innerHTML=`<p class="message error">${escapeHtml(error.message)}</p>`;return;}
  $("#adminContent").innerHTML=data?.length?`<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Pays / ville</th><th>Secteur</th><th>Téléphone</th><th>Inscrit le</th><th>Rôle</th></tr></thead><tbody>${data.map(p=>`<tr><td><b>${escapeHtml(p.full_name||"—")}</b><br><span class="muted">${escapeHtml(p.age||"")} ans</span></td><td>${escapeHtml(p.country||"")}<br>${escapeHtml(p.city||"")}</td><td>${escapeHtml(p.sector||"—")}</td><td>${escapeHtml(p.phone||"—")}</td><td>${fmtDate(p.created_at)}</td><td>${escapeHtml(p.role||"jeune")}</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:10px;margin-top:12px">Affichage limité aux 300 inscriptions les plus récentes.</p>`:'<div class="empty-state">Aucun membre.</div>';
}
async function renderHomeOffers() {
  const items=await fetchOpportunities();
  const visible=items.slice(0,3);
  $("#homeOpportunities").innerHTML=visible.length?visible.map(o=>opCard(o,false)).join(""):'<div class="empty-state"><b>Les prochaines opportunités arrivent.</b>Reviens bientôt pour découvrir les offres publiées par l’équipe OCD.</div>';
}
function openJoin() {showView("auth");setAuthMode("signup");}
function bindEvents() {
  $("#year").textContent=new Date().getFullYear();
  fillCountrySelect($("#authCountry"));
  $("#navJoin").addEventListener("click",openJoin);$("#heroJoin").addEventListener("click",openJoin);$("#introJoin").addEventListener("click",openJoin);$("#bannerJoin").addEventListener("click",openJoin);
  $("#navLogin").addEventListener("click",()=>{showView("auth");setAuthMode("login");});
  $("#seeAll").addEventListener("click",()=>{if(currentUser)showView("dashboard");else {showView("auth");setAuthMode("signup");}});
  $("#menuToggle").addEventListener("click",()=>$("#mainNav").classList.toggle("open"));
  $$("[data-view]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();showView(a.dataset.view==="home"?"home":a.dataset.view);}));
  $$(".auth-tab").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.auth)));
  $("#authForm").addEventListener("submit",handleAuth);
  $("#logoutBtn").addEventListener("click",logout);
  $("#adminBack").addEventListener("click",()=>showView("dashboard"));
  $$(".dash-link").forEach(b=>b.addEventListener("click",()=>renderDashboard(b.dataset.tab)));
  $$(".admin-tabs button").forEach(b=>b.addEventListener("click",()=>{adminTab=b.dataset.adminTab;loadAdmin();}));
  $("#offerModal").addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))$("#offerModal").classList.add("hidden");});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-open-offer]");if(b)openOffer(b.dataset.openOffer);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#offerModal").classList.add("hidden");});
}
async function init() {
  bindEvents();
  if(!ready()) {
    $("#homeOpportunities").innerHTML='<div class="empty-state"><b>Bienvenue sur OCD.</b>La maquette est prête. Connecte Supabase pour activer les comptes, les opportunités et les candidatures.</div>';
    return;
  }
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user) await onSignedIn(session.user);
  else await renderHomeOffers();
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==="SIGNED_OUT"){currentUser=null;currentProfile=null;showView("home");}
  });
}
document.addEventListener("DOMContentLoaded",init);
