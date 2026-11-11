import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import {
  STALE_MS, hexSize, hexLabel, hexPolygon, sectors, shares, leader, territories, coverage,
  present, parseCoord, nearby, ago, distance, classerCandidats, ficheDe, SEUIL_PHOTO, DISTANCE_PHOTO,
} from "./game.js";
import { openStore } from "./store/index.js";

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- état de l'interface ---------- */
const S = { store: null, sel: lsGet("gdp-sel"), mode: lsGet("gdp-mode") === "all" ? "all" : "cand", placing: false, pending: null, here: null };

/* ---------- carte ---------- */
const map = L.map("map", { preferCanvas: true, zoomSnap: 1, minZoom: 5, maxZoom: 19 }).setView([46.6, 2.4], document.getElementById("map").clientWidth < 600 ? 5 : 6);
map.setMaxBounds([[38, -12], [54, 17]]);
map.attributionControl.setPrefix(false);
L.tileLayer(import.meta.env.VITE_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: import.meta.env.VITE_TILE_ATTRIBUTION || '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>',
}).addTo(map);
const hexLayer = L.layerGroup().addTo(map);
const dotLayer = L.layerGroup().addTo(map);
const meLayer = L.layerGroup().addTo(map);
let pendingMarker = null;

/* ---------- rendu ---------- */
let lastTerr = {}, lastSecCount = 0;
function render() {
  const st = S.store; if (!st) return;
  const cands = st.cands, statuts = st.statuts, panels = st.panelList();
  if (!cands.find((c) => c.id === S.sel)) S.sel = cands[0]?.id || null;
  const z = map.getZoom(), s = hexSize(z);
  $("scaleTag").textContent = "Secteurs de " + hexLabel(s);
  hexLayer.clearLayers(); dotLayer.clearLayers();
  const G = css("--vert"), R = css("--rouge"), Gr = css("--gris"), ring = css("--panel");
  const view = map.getBounds().pad(0.15);

  const sec = sectors(panels, s);
  const terr = territories(sec, cands, statuts);
  for (const [k, list] of sec) {
    const poly = hexPolygon(k, s);
    if (!view.intersects(L.latLngBounds(poly))) continue;
    const sh = shares(list, cands, statuts);
    let fill, op;
    if (S.mode === "cand" && !S.sel) { fill = Gr; op = 0.12; }
    else if (S.mode === "cand") {
      const v = sh[S.sel], won = v >= 0.5;
      fill = won ? G : R; op = won ? 0.18 + 0.3 * v : 0.1 + 0.2 * (1 - v);
    } else {
      const lead = leader(sh, cands);
      if (lead) { fill = lead.cand.couleur; op = 0.18 + 0.3 * lead.share; } else { fill = Gr; op = 0.12; }
    }
    L.polygon(poly, { color: fill, weight: 1.2, opacity: 0.75, fillColor: fill, fillOpacity: op, interactive: false }).addTo(hexLayer);
  }

  const inView = panels.filter((p) => view.contains([p.lat, p.lng]));
  if (z >= 11 || inView.length < 400) {
    const r = z < 11 ? 5 : z < 15 ? 7 : 9, now = Date.now();
    for (const p of inView) {
      const v = S.sel ? statuts.get(p.id)?.get(S.sel) : null;
      let col = Gr;
      if (S.mode === "cand" && v) col = v.ok ? G : R;
      if (S.mode === "all") {
        const ok = cands.filter((c) => present(statuts, p.id, c.id) === true);
        col = ok.length === 1 ? ok[0].couleur : ok.length > 1 ? css("--ink") : Gr;
      }
      const stale = S.mode === "cand" && v && now - v.at > STALE_MS;
      const m = L.circleMarker([p.lat, p.lng], { radius: r, color: ring, weight: 1.5, fillColor: col, fillOpacity: stale ? 0.45 : 1 });
      m.on("click", () => openPopup(p, m));
      m.addTo(dotLayer);
    }
  }
  lastTerr = terr; lastSecCount = sec.size;
  renderSide(panels);
}

function renderSide(panels) {
  const st = S.store, cands = st.cands, c = cands.find((x) => x.id === S.sel);
  // candidats
  const box = $("cands"); box.replaceChildren();
  for (const k of cands) {
    const b = el("button", "chip"); b.setAttribute("aria-pressed", String(k.id === S.sel));
    const i = el("i"); i.style.background = k.couleur; b.append(i, document.createTextNode(k.nom));
    b.onclick = () => { S.sel = k.id; lsSet("gdp-sel", k.id); map.closePopup(); if (S.mode !== "cand") setMode("cand"); else render(); };
    box.append(b);
  }
  if (st.canWrite) {
    const a = el("button", "chip add", st.isAdmin ? "+ candidat" : "+ proposer un candidat");
    a.onclick = openCandForm; box.append(a);
  }

  // score
  const cov = coverage(panels, st.statuts, S.sel), tot = cov.total;
  $("scoreTitle").textContent = c ? "Score de " + c.nom : "Score";
  $("sCov").textContent = tot && c ? Math.round((cov.ok / tot) * 100) + " %" : "–";
  $("sTerr").textContent = lastSecCount && c ? (lastTerr[S.sel] || 0) + " / " + lastSecCount : "–";
  $("sTerrLbl").textContent = "secteurs conquis (" + hexLabel(hexSize(map.getZoom())) + ")";
  const bar = $("sBar"); bar.classList.toggle("unk", !tot);
  const a = tot ? (cov.ok / tot) * 100 : 0, b = tot ? ((cov.ok + cov.no) / tot) * 100 : 0;
  bar.firstElementChild.style.width = a + "%";
  bar.style.background = tot ? `linear-gradient(90deg,transparent ${a}%, color-mix(in srgb,var(--rouge) 70%,transparent) ${a}% ${b}%, var(--line) ${b}%)` : "";
  $("sDetail").textContent = tot
    ? `${cov.ok} avec affiche, ${cov.no} sans, ${cov.unknown} pas encore relevés sur ${tot} panneaux.`
    : "Aucun panneau signalé pour l'instant. Soyez le premier : « Signaler un panneau ».";

  // classement des candidats
  const rc = $("rankCands"); rc.replaceChildren();
  const rows = cands.map((k) => ({ k, n: coverage(panels, st.statuts, k.id).ok })).sort((x, y) => y.n - x.n);
  rows.forEach((x, i) => {
    const li = el("li");
    const w = el("span", "who"), d = el("i"); d.style.background = x.k.couleur; w.append(d, el("span", null, x.k.nom));
    const t = lastTerr[x.k.id] || 0;
    const pts = el("span", "pts", x.n + " · " + t + " sect."); pts.title = x.n + " panneaux avec affiche, " + t + " secteurs conquis";
    li.append(el("span", "n", String(i + 1)), w, pts); rc.append(li);
  });
  if (!rows.length) rc.append(el("li", "hint", st.isAdmin ? "Ajoutez un candidat avec « + candidat » en haut."
    : "Aucun candidat pour l'instant. Proposez-en un avec « + proposer un candidat » en haut."));

  // bandeaux
  const empty = $("emptyBanner");
  empty.textContent = st.kind === "supabase" && !panels.length && !cands.length
    ? "La carte partagée est vide pour l'instant. Ajoutez les candidats suivis, puis signalez les panneaux de votre commune." : "";
  schedulePlayers();
  scheduleDemandes();
  scheduleValidation();
}

let playersT = null;
function schedulePlayers() { clearTimeout(playersT); playersT = setTimeout(renderPlayers, 400); }
async function renderPlayers() {
  let top = [];
  try { top = await S.store.leaderboard(8); } catch { return; }
  const ul = $("rankPlayers"); ul.replaceChildren();
  top.forEach((r, i) => {
    const li = el("li");
    const w = el("span", "who"), d = el("i"); d.style.background = r.id === S.store.me ? "var(--accent)" : "var(--gris)";
    w.append(d, el("span", null, r.pseudo + (r.id === S.store.me ? " (vous)" : "")));
    li.append(el("span", "n", String(i + 1)), w, el("span", "pts", r.points + " pts")); ul.append(li);
  });
  if (!top.length) ul.append(el("li", "hint", "Personne n'a encore marqué de points."));
  $("meLine").textContent = S.store.pseudo
    ? `Vous jouez sous le pseudo « ${S.store.pseudo} »${S.store.isAdmin ? " (organisateur)" : ""}. 1 point par vérification, 3 par panneau signalé.`
    : "1 point par vérification, 3 points par panneau signalé.";
  $("emailBtn").hidden = !S.store.lienEmail;
  $("emailBtn").textContent = S.store.email ? "Compte rattaché à " + S.store.email : "Retrouver mon compte sur un autre appareil";
}

/* ---------- demandes d'ajout de candidat ---------- */
let demT = null, demSig = "";
function scheduleDemandes() { clearTimeout(demT); demT = setTimeout(renderDemandes, 500); }
async function renderDemandes(force) {
  const st = S.store;
  if (!st.canRequest) return;
  // ne recharge que si la liste des candidats, le compte ou le rôle ont changé
  const sig = [st.me, st.isAdmin, st.cands.length].join("|");
  if (!force && sig === demSig) return;
  let list;
  try { list = await st.demandes(); } catch (e) { console.error(e); return; }
  demSig = sig;
  const ul = $("demList"); ul.replaceChildren();
  $("demSec").hidden = !list.length && !st.isAdmin;
  for (const d of list) {
    const li = el("li"), top = el("div", "top"), dot = el("i");
    dot.style.background = d.couleur || "var(--gris)";
    top.append(dot, el("b", null, d.nom), el("span", "n", d.nb_soutiens + (d.nb_soutiens > 1 ? " soutiens" : " soutien")));
    li.append(top);
    const meta = el("div", "meta");
    if (d.parti) meta.append(document.createTextNode(d.parti));
    if (d.source_url) {
      if (d.parti) meta.append(document.createTextNode(" · "));
      const a = el("a", null, "source ↗"); a.href = d.source_url; a.target = "_blank"; a.rel = "noopener nofollow"; meta.append(a);
    }
    if (d.statut !== "en_attente") {
      meta.append(el("span", "st-" + d.statut, (meta.childNodes.length ? " · " : "")
        + (d.statut === "acceptee" ? "acceptée" : "refusée" + (d.motif ? " : " + d.motif : ""))));
    }
    if (meta.childNodes.length) li.append(meta);
    if (d.statut === "en_attente") {
      const acts = el("div", "acts");
      const plus = el("button", "btn small ghost", d.soutenu ? "Soutenue ✓" : "+1 je soutiens");
      plus.disabled = d.soutenu;
      plus.onclick = () => supportDemande(d);
      acts.append(plus);
      if (st.isAdmin) {
        const ok = el("button", "btn small", "Accepter"), no = el("button", "btn small ghost", "Refuser");
        ok.onclick = () => acceptDemande(d, ok);
        no.onclick = () => {
          const inp = el("input"); inp.placeholder = "Motif (facultatif)"; inp.maxLength = 200;
          const conf = el("button", "btn small", "Confirmer le refus");
          conf.onclick = () => refuseDemande(d, inp.value.trim(), conf);
          acts.replaceChildren(inp, conf); inp.focus();
        };
        acts.append(ok, no);
      }
      li.append(acts);
    }
    ul.append(li);
  }
  if (st.isAdmin && !list.length) ul.append(el("li", "hint", "Aucune demande en attente."));
  $("demHint").hidden = st.isAdmin;
}
async function supportDemande(d) {
  if (!(await needAccount())) return;
  try { await S.store.soutenir(d.id); toast("Soutien enregistré pour " + d.nom); renderDemandes(true); }
  catch (e) { toast(explain(e)); }
}
async function acceptDemande(d, btn) {
  btn.disabled = true;
  try {
    const id = await S.store.accepterDemande(d, d.couleur || PALETTE[S.store.cands.length % PALETTE.length]);
    S.sel = id; lsSet("gdp-sel", id); toast(d.nom + " ajouté à la liste"); render(); renderDemandes(true);
  } catch (e) { toast(explain(e)); btn.disabled = false; }
}
async function refuseDemande(d, motif, btn) {
  btn.disabled = true;
  try { await S.store.refuserDemande(d.id, motif); toast("Demande refusée"); renderDemandes(true); }
  catch (e) { toast(explain(e)); btn.disabled = false; }
}

/* ---------- compte par e-mail ---------- */
$("emailBtn").onclick = async () => {
  const st = S.store, dlg = $("emailDlg"), err = $("eErr"), inp = $("eMail");
  // sans compte sur cet appareil, on se connecte directement à un compte existant (pas de pseudo à choisir)
  err.hidden = true; inp.value = st.email || "";
  $("eHint").textContent = st.email
    ? "Votre compte est rattaché à cette adresse. Sur un autre appareil, entrez-la ici : vous recevrez un lien de connexion."
    : !st.signedIn
    ? "Entrez l'adresse e-mail de votre compte : vous recevrez un lien de connexion à ouvrir dans ce navigateur."
    : "Entrez votre adresse : vous recevrez un lien à ouvrir pour la confirmer. Ensuite, sur un autre appareil, la même adresse vous redonnera ce compte, avec vos points. Si l'adresse a déjà un compte, le lien vous y reconnectera.";
  dlg.showModal(); inp.focus();
};
$("eCancel").onclick = () => $("emailDlg").close();
$("emailForm").onsubmit = async (e) => {
  e.preventDefault();
  const v = $("eMail").value.trim(), err = $("eErr");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = "Adresse e-mail invalide."; err.hidden = false; return; }
  $("eOk").disabled = true;
  try {
    // déjà connecté avec cette adresse : on envoie un lien de connexion pour un autre appareil
    const mode = await S.store.lienEmail(v);
    $("emailDlg").close();
    toast(mode === "rattache" ? "Lien envoyé à " + v + ". Ouvrez-le pour confirmer votre adresse."
      : "Lien de connexion envoyé à " + v + ". Ouvrez-le dans ce navigateur pour retrouver votre compte.");
  } catch (x) {
    err.textContent = /rate|security purposes/i.test(String(x?.message)) ? "Trop de demandes, réessayez dans une minute."
      : /not found|signups not allowed/i.test(String(x?.message)) ? "Aucun compte n'est rattaché à cette adresse."
      : explain(x);
    err.hidden = false;
  } finally { $("eOk").disabled = false; }
};

/* ---------- popup d'un panneau ---------- */
function openPopup(p, marker) {
  const st = S.store, box = el("div", "pp");
  box.append(el("h4", null, p.lieu || "Panneau d'affichage libre"),
    el("p", "meta", (p.commune || "Commune inconnue") + " · " + p.lat.toFixed(5) + ", " + p.lng.toFixed(5)));
  const c = st.cands.find((x) => x.id === S.sel);
  if (c) {
    const v = st.statuts.get(p.id)?.get(c.id);
    box.append(el("p", "q", "L'affiche de " + c.nom + " est-elle sur ce panneau ?"));
    const acts = el("div", "acts");
    const yes = el("button", "yes", "✓ Présente"), no = el("button", "no", "✗ Absente");
    yes.setAttribute("aria-pressed", String(v?.ok === true)); no.setAttribute("aria-pressed", String(v?.ok === false));
    yes.onclick = () => setStatus(p, c, true); no.onclick = () => setStatus(p, c, false);
    acts.append(yes, no); box.append(acts);
    if (st.canPhoto) {
      const ph = el("button", "photo", "📷 Prouver par une photo");
      ph.onclick = () => { map.closePopup(); openPhoto(p, c); };
      const a2 = el("div", "acts"); a2.append(ph); box.append(a2);
    }
  }
  const ul = el("ul");
  for (const k of st.cands) {
    const v = st.statuts.get(p.id)?.get(k.id), li = el("li");
    const etat = el("span", null, v ? (v.ok ? "présente" : "absente") + " · " + ago(v.at) : "pas relevé");
    if (v?.v) { const b = el("span", "badge", "photo"); b.title = "Vérifié par une photo"; etat.append(b); }
    li.append(el("b", null, k.nom), etat);
    ul.append(li);
  }
  if (st.cands.length) box.append(ul);
  const links = el("div", "links");
  const a = el("a", null, "Itinéraire / OSM ↗");
  a.href = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=19/${p.lat}/${p.lng}`; a.target = "_blank"; a.rel = "noopener";
  links.append(a);
  if (p.by && p.by === st.me) {
    const del = el("button", null, "Supprimer"); let armed = false;
    del.onclick = async () => { if (!armed) { armed = true; del.textContent = "Confirmer la suppression"; return; } await removePanel(p); map.closePopup(); };
    links.append(del);
  }
  box.append(links);
  L.popup({ maxWidth: 300, autoPanPadding: [20, 20] }).setLatLng(marker.getLatLng()).setContent(box).openOn(map);
}

/* ---------- compte joueur ---------- */
function askPseudo() {
  return new Promise((resolve) => {
    const dlg = $("pseudoDlg"), inp = $("pNom"), err = $("pErr");
    inp.value = S.store.pseudo || ""; err.hidden = true;
    const done = (v) => { dlg.close(); $("pseudoForm").onsubmit = null; $("pCancel").onclick = null; resolve(v); };
    $("pCancel").onclick = () => done(false);
    $("pseudoForm").onsubmit = async (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (v.length < 2) { err.textContent = "Au moins 2 caractères."; err.hidden = false; return; }
      $("pOk").disabled = true;
      try { await S.store.signIn(v); done(true); schedulePlayers(); }
      catch (x) { err.textContent = explain(x); err.hidden = false; }
      finally { $("pOk").disabled = false; }
    };
    dlg.showModal(); inp.focus();
  });
}
async function needAccount() { return S.store.signedIn || (await askPseudo()); }

/* ---------- écritures ---------- */
function toast(t) { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), 2600); }
function explain(e) {
  const code = e?.code || "", msg = String(e?.message || "");
  if (code === "23505") return "Cet élément existe déjà.";
  if (code === "42501" || /row-level security/i.test(msg)) return "Vous n'avez pas le droit de faire ça.";
  if (/anonymous/i.test(msg)) return "Les comptes anonymes ne sont pas activés sur le serveur.";
  if (/fetch|network/i.test(msg)) return "Pas de connexion. Réessayez quand vous aurez du réseau.";
  return "Enregistrement impossible pour le moment, réessayez.";
}
async function setStatus(p, c, ok) {
  if (!(await needAccount())) return;
  try { await S.store.setReleve(p.id, c.id, ok); toast(ok ? "Affiche présente, noté ! +1" : "Affiche absente, noté. +1"); map.closePopup(); }
  catch (e) { toast(explain(e)); }
}
async function removePanel(p) {
  try { await S.store.removePanel(p.id); toast("Panneau supprimé."); } catch (e) { toast(explain(e)); }
}

/* ---------- géolocalisation ---------- */
function locate(then) {
  if (!navigator.geolocation) { toast("La géolocalisation n'est pas disponible sur cet appareil."); return; }
  $("locate").classList.add("busy");
  navigator.geolocation.getCurrentPosition((pos) => {
    $("locate").classList.remove("busy"); $("locate").classList.add("on");
    const ll = [pos.coords.latitude, pos.coords.longitude], acc = pos.coords.accuracy;
    S.here = { ll, acc };
    meLayer.clearLayers();
    L.circle(ll, { radius: acc, color: css("--accent"), weight: 1, fillOpacity: 0.08, interactive: false }).addTo(meLayer);
    L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2.5, fillColor: css("--accent"), fillOpacity: 1, interactive: false }).addTo(meLayer);
    map.setView(ll, Math.max(map.getZoom(), 16));
    then?.(ll, acc);
  }, (err) => {
    $("locate").classList.remove("busy");
    toast(err.code === 1 ? "Autorisez la localisation dans votre navigateur pour l'utiliser." : "Position introuvable pour le moment.");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
$("locate").onclick = () => locate();

/* ---------- ajout d'un panneau ---------- */
let communeReq = 0;
async function fillCommune(ll) {
  const req = ++communeReq;
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${ll[0]}&lon=${ll[1]}&fields=nom&format=json`);
    const j = await r.json();
    if (req === communeReq && j[0]?.nom && !$("fCommune").dataset.touched) $("fCommune").value = j[0].nom;
  } catch {}
}
function setPending(ll, fromMap) {
  S.pending = ll;
  if (pendingMarker) pendingMarker.remove();
  pendingMarker = L.circleMarker(ll, { radius: 10, color: css("--accent"), weight: 3, fillColor: css("--panel"), fillOpacity: 1 }).addTo(map);
  if (fromMap) $("fCoord").value = ll[0].toFixed(6) + ", " + ll[1].toFixed(6);
  $("tip")?.remove();
  const dup = nearby(S.store.panelList(), ll, 15), w = $("fWarn");
  w.replaceChildren();
  if (dup) {
    w.append(document.createTextNode("Un panneau est déjà signalé à quelques mètres. "));
    const b = el("button", null, "Le voir"); b.type = "button";
    b.onclick = () => { closeAdd(); map.setView([dup.lat, dup.lng], 18); setTimeout(render, 50); };
    w.append(b);
  }
  w.hidden = !dup;
  fillCommune(ll);
}
async function openAdd() {
  if (!(await needAccount())) return;
  $("addForm").hidden = false; $("addBtn").hidden = true; $("candForm").hidden = true;
  S.placing = true; $("app").classList.add("placing");
  const tip = el("div", "placing-tip", "Touchez la carte à l'endroit du panneau"); tip.id = "tip"; $("map").append(tip);
  $("addForm").scrollIntoView({ block: "nearest" });
}
function closeAdd() {
  $("addForm").hidden = true; $("addBtn").hidden = false; $("fErr").hidden = true; $("fWarn").hidden = true;
  S.placing = false; S.pending = null; $("app").classList.remove("placing"); $("tip")?.remove();
  if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
  ["fCoord", "fLieu", "fCommune"].forEach((i) => ($(i).value = ""));
  delete $("fCommune").dataset.touched;
}
map.on("click", (e) => { if (S.placing) setPending([e.latlng.lat, e.latlng.lng], true); });
$("fHere").onclick = () => locate((ll, acc) => {
  setPending(ll, true);
  if (acc > 50) toast(`Position précise à ${Math.round(acc)} m : ajustez en touchant la carte si besoin.`);
});
$("fCoord").addEventListener("input", () => { const c = parseCoord($("fCoord").value); if (c) { setPending(c, false); map.setView(c, Math.max(map.getZoom(), 17)); } });
$("fCommune").addEventListener("input", () => ($("fCommune").dataset.touched = "1"));
$("addBtn").onclick = openAdd; $("fCancel").onclick = closeAdd;
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ll = S.pending || parseCoord($("fCoord").value), err = $("fErr");
  if (!ll) { err.textContent = "Placez le panneau sur la carte ou collez des coordonnées en France métropolitaine (ex. 48.85661, 2.35222)."; err.hidden = false; return; }
  const lieu = $("fLieu").value.trim(), commune = $("fCommune").value.trim();
  if (!commune) { err.textContent = "Indiquez la commune du panneau."; err.hidden = false; return; }
  $("fSave").disabled = true;
  try { await S.store.addPanel({ lat: +ll[0].toFixed(6), lng: +ll[1].toFixed(6), lieu, commune }); toast("Panneau ajouté : +3 points"); closeAdd(); }
  catch (x) { err.textContent = explain(x); err.hidden = false; }
  finally { $("fSave").disabled = false; }
});

/* ---------- ajout d'un candidat ---------- */
const PALETTE = ["#2b3cc4", "#c2410c", "#7c3aed", "#0f766e", "#be185d", "#a16207", "#1d4ed8", "#4d7c0f"];
async function openCandForm() {
  if (!(await needAccount())) return;
  const admin = S.store.isAdmin;
  $("cTitle").textContent = admin ? "Ajouter un candidat" : "Proposer un candidat";
  $("cHint").hidden = admin; $("cSourceF").hidden = admin;
  $("cOk").textContent = admin ? "Ajouter" : "Envoyer la demande";
  $("candForm").hidden = false; $("addForm").hidden = true;
  $("cCouleur").value = PALETTE[S.store.cands.length % PALETTE.length];
  $("candForm").scrollIntoView({ block: "nearest" }); $("cNom").focus();
}
$("cCancel").onclick = () => { $("candForm").hidden = true; $("cErr").hidden = true; $("cNom").value = ""; $("cParti").value = ""; $("cSource").value = ""; };
$("candForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("cNom").value.trim(), err = $("cErr");
  if (nom.length < 2) { err.textContent = "Indiquez le nom du candidat."; err.hidden = false; return; }
  if (S.store.cands.some((c) => c.nom.toLowerCase() === nom.toLowerCase())) { err.textContent = "Ce candidat est déjà dans la liste."; err.hidden = false; return; }
  const parti = $("cParti").value.trim(), couleur = $("cCouleur").value;
  $("cOk").disabled = true;
  try {
    if (S.store.isAdmin) {
      const id = await S.store.addCandidat({ nom, couleur, parti });
      S.sel = id; lsSet("gdp-sel", id); $("cCancel").click(); toast(nom + " ajouté"); render();
    } else {
      const source = $("cSource").value.trim();
      if (source && !/^https?:\/\/\S+$/.test(source)) { err.textContent = "Le lien doit commencer par https://"; err.hidden = false; return; }
      const r = await S.store.demanderCandidat({ nom, parti, source_url: source, couleur });
      if (r === "doublon") {
        const d = (await S.store.demandes()).find((x) => x.statut === "en_attente" && x.nom.trim().toLowerCase() === nom.toLowerCase());
        if (d && !d.soutenu) await S.store.soutenir(d.id);
        toast("Ce candidat est déjà demandé : votre soutien est ajouté.");
      } else toast("Demande envoyée. Elle apparaît dans « Candidats demandés ».");
      $("cCancel").click(); renderDemandes(true);
    }
  }
  catch (x) { err.textContent = explain(x); err.hidden = false; }
  finally { $("cOk").disabled = false; }
});

/* ---------- modes ---------- */
function setMode(m) {
  S.mode = m; lsSet("gdp-mode", m);
  $("m-cand").setAttribute("aria-pressed", String(m === "cand")); $("m-all").setAttribute("aria-pressed", String(m === "all"));
  render();
}
$("m-cand").onclick = () => setMode("cand"); $("m-all").onclick = () => setMode("all");
map.on("zoomend moveend", () => render());
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => render());

/* ---------- démarrage ---------- */
setMode(S.mode);
(async () => {
  try { S.store = await openStore(); }
  catch (e) {
    $("loading").textContent = "Impossible de charger la carte partagée. Vérifiez votre connexion puis rechargez la page.";
    console.error(e); return;
  }
  $("loading").hidden = true;
  const st = S.store;
  $("shootBtn").hidden = !st.canPhoto;
  $("shootBtn").onclick = () => openPhoto();
  if (st.kind === "local") {
    const upd = () => {
      $("localBanner").hidden = false;
      $("localWhy").textContent = (st.isDemo ? "Les panneaux, candidats et relevés affichés sont fictifs, pour montrer le principe du jeu. " : "")
        + "Vos ajouts restent dans ce navigateur : la carte partagée n'est pas encore branchée (voir le README).";
      $("localEmpty").hidden = !st.isDemo; $("localDemo").hidden = st.isDemo;
    };
    $("localEmpty").onclick = async () => { await st.reset(false); upd(); };
    $("localDemo").onclick = async () => { await st.reset(true); upd(); };
    upd();
  }
  st.onChange(render);
  render();
  const panels = st.panelList();
  // Panneaux regroupés sur une petite zone : on zoome dessus. Sinon, vue de toute la France.
  if (st.kind === "supabase" && panels.length && panels.length < 2000) {
    const bb = L.latLngBounds(panels.map((p) => [p.lat, p.lng]));
    if (bb.getNorth() - bb.getSouth() < 4) { try { map.fitBounds(bb.pad(0.2), { maxZoom: 14 }); } catch {} }
  }
})();

/* ---------- vérification par photo ---------- */
const AUCUN = "aucun"; // choix « aucune affiche de candidat sur ce panneau »
const PH = { libre: false, aucun: false, ll: null, p: null, c: null, stream: null, geo: null, watch: null, blob: null, source: "camera", texte: "", score: 0, busy: false };
let ocrMod = null;
const ocr = () => (ocrMod ||= import("./ocr.js"));
// affiches des candidats déclarés (empreintes visuelles, slogans) et moteur de reconnaissance à l'image,
// chargés seulement quand on photographie
let affMod = null;
const affiches = () => (affMod ||= Promise.all([import("./vision.js"), import("./affiches-2027.json")])
  .then(([vision, j]) => ({ vision, fiches: (j.default || j).candidats })).catch((e) => { affMod = null; throw e; }));
let refsCache = { sig: "", refs: [] };
/** Références visuelles des candidats suivis sur la carte (calculées une fois par liste de candidats). */
function refsAffiches(vision, fiches) {
  const cands = S.store.cands, sig = cands.map((c) => c.id + c.nom).join("|");
  if (refsCache.sig !== sig) {
    const refs = [];
    for (const c of cands) {
      const f = ficheDe(c, fiches);
      (f?.affiches || []).forEach((a, i) => refs.push({ id: c.id + "#" + i, cand: c.id, titre: a.titre, ref: vision.chargerReference(a.empreinte) }));
    }
    refsCache = { sig, refs };
  }
  return refsCache.refs;
}
/** Reconnaissance à l'image : id candidat → { score, titre, points } (meilleure de ses affiches). */
async function reconnaitreAffiches(cv) {
  const { vision, fiches } = await affiches(), refs = refsAffiches(vision, fiches), out = new Map();
  if (!refs.length) return { out, fiches };
  for (const r of vision.chercherAffiches(vision.imageDeTravail(cv), refs)) {
    const ref = refs.find((x) => x.id === r.id), b = out.get(ref.cand);
    if (r.score > 0 && (!b || r.score > b.score)) out.set(ref.cand, { score: r.score, titre: ref.titre, points: r.points });
  }
  return { out, fiches };
}
/** Pourquoi ce candidat : nom lu, slogan/parti lu ou affiche reconnue à l'image. */
function raison(r) {
  return r.par === "affiche" ? "affiche « " + r.affiche + " » reconnue à l'image"
    : r.par === "indice" ? "slogan ou parti lu sur l'affiche, sans le nom" : "nom lu";
}

/**
 * Sans panneau ni candidat (bouton principal) : le panneau est le plus proche de la position GPS
 * (créé s'il n'y en a aucun à moins de DISTANCE_PHOTO) et le candidat est celui que lit l'OCR.
 */
async function openPhoto(p = null, c = null) {
  if (!(await needAccount())) return;
  Object.assign(PH, { libre: !p, aucun: false, ll: null, p, c, geo: null, blob: null, source: "camera", texte: "", score: 0, vu: null, busy: false });
  $("phTitle").textContent = p ? "Affiche de " + c.nom : "Photographier une affiche";
  $("phHint").textContent = p ? "Cadrez l'affiche entière, bien en face. Restez près du panneau."
    : "Placez-vous devant le panneau et cadrez une affiche entière, bien en face. Le panneau et le candidat sont trouvés automatiquement. Aucune affiche électorale ? Prenez le panneau en photo et choisissez « Aucun candidat ».";
  $("phCandF").hidden = true;
  $("phErr").hidden = true; $("phRes").hidden = true; $("phImg").hidden = true;
  $("phShoot").hidden = false; $("phShoot").disabled = true; $("phSend").hidden = true; $("phRetake").hidden = true;
  $("phGeo").textContent = "Recherche de votre position…";
  $("photoDlg").showModal();
  ocr().then((m) => m.prechargerOcr()).catch(() => {});
  affiches().catch(() => {});
  // position du joueur, comparée à celle du panneau
  if (navigator.geolocation) {
    PH.watch = navigator.geolocation.watchPosition((pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      PH.ll = ll;
      if (PH.libre) {
        PH.p = nearby(S.store.panelList(), ll, DISTANCE_PHOTO);
        PH.geo = { d: PH.p ? distance(ll, [PH.p.lat, PH.p.lng]) : 0, acc: pos.coords.accuracy };
        $("phGeo").textContent = PH.p
          ? "📍 Panneau : " + (PH.p.lieu || "panneau d'affichage libre") + (PH.p.commune ? ", " + PH.p.commune : "") + " (à " + Math.round(PH.geo.d) + " m)."
          : pos.coords.accuracy <= DISTANCE_PHOTO ? "📍 Aucun panneau connu ici : il sera ajouté à votre position (+3 points)."
          : "⚠ Position imprécise (" + Math.round(pos.coords.accuracy) + " m). Attendez quelques secondes ou sortez à découvert.";
        return;
      }
      PH.geo = { d: distance(ll, [p.lat, p.lng]), acc: pos.coords.accuracy };
      const ok = PH.geo.d <= DISTANCE_PHOTO;
      $("phGeo").textContent = (ok ? "📍 " : "⚠ ") + "Vous êtes à " + Math.round(PH.geo.d) + " m du panneau (précision " + Math.round(PH.geo.acc) + " m)"
        + (ok ? "." : ". Rapprochez-vous à moins de " + DISTANCE_PHOTO + " m pour que la photo compte d'office.");
    }, () => { $("phGeo").textContent = "⚠ Position indisponible : la photo sera validée par les autres joueurs."; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  } else $("phGeo").textContent = "⚠ Position indisponible sur cet appareil.";
  await startCamera();
}
async function startCamera() {
  const v = $("phVideo"), msg = $("phCamMsg");
  msg.hidden = false; msg.textContent = "Ouverture de l'appareil photo…";
  try {
    PH.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    v.srcObject = PH.stream; v.hidden = false; await v.play();
    msg.hidden = true; $("phShoot").disabled = false; PH.source = "camera";
  } catch {
    // pas d'accès direct à la caméra : on passe par le sélecteur de fichier (la photo ira en validation)
    v.hidden = true; msg.textContent = "Appareil photo direct indisponible. Touchez « Prendre la photo » pour utiliser l'appareil du téléphone.";
    $("phShoot").disabled = false; PH.source = "fichier";
  }
}
function stopPhoto() {
  if (PH.stream) { PH.stream.getTracks().forEach((t) => t.stop()); PH.stream = null; }
  if (PH.watch != null) { navigator.geolocation.clearWatch(PH.watch); PH.watch = null; }
  $("phVideo").srcObject = null;
}
$("photoDlg").addEventListener("close", stopPhoto);
$("phCancel").onclick = () => $("photoDlg").close();

/** Image réduite à 1600 px au plus grand côté, en JPEG (ce qui retire aussi les métadonnées EXIF). */
function toCanvas(src, w, h) {
  const k = Math.min(1, 1600 / Math.max(w, h)), cv = document.createElement("canvas");
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
$("phShoot").onclick = async () => {
  if (PH.source === "fichier") { $("phFile").value = ""; $("phFile").click(); return; }
  const v = $("phVideo");
  if (!v.videoWidth) return;
  await analyse(toCanvas(v, v.videoWidth, v.videoHeight));
};
$("phFile").onchange = async () => {
  const f = $("phFile").files?.[0]; if (!f) return;
  const img = new Image(); img.src = URL.createObjectURL(f);
  try { await img.decode(); } catch { showPhErr("Image illisible."); return; }
  await analyse(toCanvas(img, img.naturalWidth, img.naturalHeight));
  URL.revokeObjectURL(img.src);
};
$("phRetake").onclick = () => {
  $("phCandF").hidden = true;
  $("phImg").hidden = true; $("phRes").hidden = true; $("phErr").hidden = true;
  $("phSend").hidden = true; $("phRetake").hidden = true; $("phShoot").hidden = false;
  if (PH.source === "camera") $("phVideo").hidden = false; else $("phCamMsg").hidden = false;
};
function showPhErr(t) { $("phErr").textContent = t; $("phErr").hidden = false; }

async function analyse(cv) {
  PH.blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
  $("phImg").src = cv.toDataURL("image/jpeg", 0.7); $("phImg").hidden = false; $("phVideo").hidden = true; $("phCamMsg").hidden = true;
  $("phShoot").hidden = true; $("phRetake").hidden = false; $("phErr").hidden = true;
  const res = $("phRes"); res.hidden = false; res.textContent = "Lecture de l'affiche…";
  try {
    PH.texte = await (await ocr()).lireAffiche(cv);
  } catch (e) {
    console.error(e); PH.texte = "";
    res.textContent = "La lecture automatique n'a pas pu se lancer (connexion ?). Vous pouvez envoyer la photo : elle sera validée par les autres joueurs.";
  }
  let visuel = null, fiches = [];
  try { ({ out: visuel, fiches } = await reconnaitreAffiches(cv)); } catch (e) { console.error(e); }
  const cands = S.store.cands, ranked = classerCandidats(PH.texte, cands, { visuel, fiches });
  PH.vu = visuel; // gardé pour la trace envoyée avec la photo
  if (PH.libre) { choixCandidat(ranked); $("phSend").hidden = false; return; }
  const moi = ranked.find((r) => r.cand.id === PH.c.id);
  PH.score = moi?.score || 0;
  const autre = ranked[0] && ranked[0].cand.id !== PH.c.id && ranked[0].score >= SEUIL_PHOTO && ranked[0].score > PH.score ? ranked[0].cand : null;
  const lu = PH.texte ? " Texte lu : « " + PH.texte.slice(0, 120) + (PH.texte.length > 120 ? "…" : "") + " »" : "";
  if (PH.score > 0 || PH.texte) {
    const pct = Math.round(PH.score * 100) + " %";
    res.textContent = (PH.score >= SEUIL_PHOTO ? "✓ " + PH.c.nom + " reconnu (" + pct + ", " + raison(moi) + ")."
      : PH.score >= 0.5 ? PH.c.nom + " peut-être reconnu (" + pct + ", " + raison(moi) + ") : la photo sera validée par les autres joueurs."
      : "Le nom de " + PH.c.nom + " n'a pas été lu (" + pct + "). Reprenez la photo de plus près, ou envoyez-la quand même.")
      + (autre ? " On dirait plutôt l'affiche de " + autre.nom + "." : "") + lu;
  } else if (!res.textContent.startsWith("La lecture")) {
    res.textContent = "Aucun texte lu ni affiche reconnue. Reprenez la photo en vous approchant, affiche bien en face.";
  }
  $("phSend").hidden = false;
}
/** Mode libre : le candidat le mieux lu est proposé, le joueur peut le corriger. */
function choixCandidat(ranked) {
  PH.ranked = ranked;
  const best = ranked[0] && ranked[0].score >= 0.5 ? ranked[0] : null, sel = $("phCand");
  sel.replaceChildren(el("option", null, "— choisir —"));
  sel.firstChild.value = "";
  const aucun = el("option", null, "Aucun candidat (pas d'affiche électorale)"); aucun.value = AUCUN; sel.append(aucun);
  for (const r of ranked) { const o = el("option", null, r.cand.nom); o.value = r.cand.id; sel.append(o); }
  sel.value = best ? best.cand.id : "";
  $("phCandF").hidden = false;
  majCandidat();
}
function majCandidat() {
  const id = $("phCand").value, r = PH.ranked?.find((x) => x.cand.id === id), res = $("phRes");
  PH.aucun = id === AUCUN; PH.c = r?.cand || null; PH.score = r?.score || 0;
  const pourquoi = r && r.score > 0 ? ", " + raison(r) : "";
  const lu = PH.texte ? " Texte lu : « " + PH.texte.slice(0, 120) + (PH.texte.length > 120 ? "…" : "") + " »" : "";
  const pct = Math.round(PH.score * 100) + " %", n = S.store.cands.length;
  // texte lu sans aucun nom de candidat : souvent du bruit (décor, affiches de concert…), inutile de l'afficher
  res.textContent = PH.aucun ? (n
      ? "Aucune affiche de candidat : " + (n > 1 ? "les " + n + " candidats seront notés absents" : "le candidat sera noté absent") + " sur ce panneau (+" + n + " point" + (n > 1 ? "s" : "") + "). La photo n'est pas envoyée."
      : "Aucun candidat n'est encore suivi : seul le panneau sera enregistré.")
    : !PH.c ? (PH.texte
      ? "Aucun nom de candidat lu sur la photo. S'il n'y a pas d'affiche électorale (concerts, pubs…), choisissez « Aucun candidat » ci-dessous. Sinon choisissez le candidat, ou reprenez la photo plus près de l'affiche."
      : "Aucun texte lu. Choisissez le candidat, ou « Aucun candidat » s'il n'y a pas d'affiche électorale, ou reprenez la photo en vous approchant.")
    : PH.score >= SEUIL_PHOTO ? "✓ Affiche de " + PH.c.nom + " reconnue (" + pct + pourquoi + ")." + lu
    : PH.score >= 0.5 ? "Affiche de " + PH.c.nom + " peut-être (" + pct + pourquoi + ") : la photo sera validée par les autres joueurs." + lu
    : "Le nom de " + PH.c.nom + " n'a pas été lu (" + pct + ") : la photo sera validée par les autres joueurs." + lu;
}
$("phCand").onchange = majCandidat;
async function communeDe(ll) {
  try {
    const r = await fetch(`https://geo.api.gouv.fr/communes?lat=${ll[0]}&lon=${ll[1]}&fields=nom&format=json`);
    return (await r.json())[0]?.nom || "";
  } catch { return ""; }
}
$("phSend").onclick = async () => {
  if (PH.busy || !PH.blob) return;
  if (PH.libre) {
    if (!PH.c && !PH.aucun) { showPhErr("Choisissez le candidat de l'affiche, ou « Aucun candidat »."); return; }
    if (!PH.ll) { showPhErr("Position inconnue : autorisez la localisation pour retrouver le panneau."); return; }
    if (!PH.p && PH.geo?.acc > DISTANCE_PHOTO) { showPhErr("Position trop imprécise pour placer le panneau. Réessayez dans quelques secondes."); return; }
  }
  PH.busy = true; $("phSend").disabled = true; $("phSend").textContent = "Envoi…";
  try {
    let nouveau = false;
    if (PH.libre && !PH.p) {
      const ll = PH.ll, id = await S.store.addPanel({ lat: +ll[0].toFixed(6), lng: +ll[1].toFixed(6), lieu: "", commune: await communeDe(ll) });
      PH.p = S.store.panels.get(id) || { id, lat: ll[0], lng: ll[1] }; PH.geo.d = 0; nouveau = true;
    }
    if (PH.aucun) {
      // pas d'affiche électorale : chaque candidat suivi est noté absent ; la photo, sans candidat, n'est pas gardée
      const ids = S.store.cands.map((k) => k.id);
      if (ids.length) await S.store.setAbsents(PH.p.id, ids);
      $("photoDlg").close();
      toast((ids.length ? "Aucun candidat sur ce panneau, noté : +" + ids.length + " point" + (ids.length > 1 ? "s" : "") : "Panneau enregistré")
        + (nouveau ? (ids.length ? " (et +3 pour le nouveau panneau)" : " : +3 points") : ""));
      map.setView([PH.p.lat, PH.p.lng], Math.max(map.getZoom(), 17));
      return;
    }
    const r = await S.store.envoyerPhoto({
      panneauId: PH.p.id, candidatId: PH.c.id, blob: PH.blob, source: PH.source,
      distance: PH.geo?.d ?? null, precision: PH.geo?.acc ?? null, score: PH.score,
      // texte lu + affiche reconnue à l'image, pour ceux qui valideront la photo
      texte: [PH.texte, PH.vu?.get(PH.c.id) ? "[affiche reconnue : « " + PH.vu.get(PH.c.id).titre + " », " + PH.vu.get(PH.c.id).points + " points]" : ""].filter(Boolean).join(" ").slice(0, 2000),
    });
    $("photoDlg").close();
    toast((PH.libre ? PH.c.nom + " · " : "") + (r.statut === "verifiee" ? "Affiche vérifiée par photo : +3 points"
      : r.statut === "a_valider" ? "Photo envoyée, les autres joueurs vont la valider : +1 point"
      : "Photo enregistrée, mais le nom n'a pas été reconnu : +1 point")
      + (nouveau ? " (et +3 pour le nouveau panneau)" : ""));
    if (PH.libre) map.setView([PH.p.lat, PH.p.lng], Math.max(map.getZoom(), 17));
  } catch (e) { console.error(e); showPhErr(explain(e)); }
  finally { PH.busy = false; $("phSend").disabled = false; $("phSend").textContent = "Envoyer"; }
};

/* ---------- photos à valider par les joueurs ---------- */
let valT = null, valSig = "";
function scheduleValidation() { clearTimeout(valT); valT = setTimeout(renderValidation, 700); }
async function renderValidation(force) {
  const st = S.store;
  if (!st.canPhoto || !st.me) { $("valSec").hidden = true; return; }
  const sig = [st.me, st.cands.length, Math.floor(Date.now() / 60000)].join("|");
  if (!force && sig === valSig) return;
  valSig = sig;
  let list;
  try { list = await st.photosAValider(5); } catch (e) { console.error(e); return; }
  const ul = $("valList"); ul.replaceChildren();
  $("valSec").hidden = !list.length;
  for (const ph of list) {
    const c = st.cands.find((k) => k.id === ph.candidat_id), p = st.panels.get(ph.panneau_id);
    const li = el("li");
    if (ph.url) { const img = el("img"); img.src = ph.url; img.alt = "Photo d'un panneau"; img.loading = "lazy"; li.append(img); }
    const txt = el("div", "txt");
    txt.append(el("b", null, "Est-ce l'affiche de " + (c?.nom || "ce candidat") + " ?"),
      el("span", "hint", (p ? (p.lieu || "Panneau") + " · " + (p.commune || "") + " · " : "") + "texte lu : « " + (ph.texte_lu || "rien").slice(0, 80) + " »"));
    li.append(txt);
    const acts = el("div", "acts");
    for (const [v, lbl, cls] of [["oui", "✓ Oui", "btn small"], ["non", "✗ Non", "btn small ghost"], ["illisible", "Illisible", "btn small ghost"]]) {
      const b = el("button", cls, lbl);
      b.onclick = async () => {
        if (!(await needAccount())) return;
        acts.querySelectorAll("button").forEach((x) => (x.disabled = true));
        try { await st.voter(ph.id, v); toast("Merci, avis enregistré."); }
        catch (e) { toast(e?.code === "42501" ? "Cette photo ne peut plus recevoir d'avis." : explain(e)); }
        renderValidation(true);
      };
      acts.append(b);
    }
    li.append(acts); ul.append(li);
  }
}

