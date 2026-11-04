import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import {
  STALE_MS, hexSize, hexLabel, hexPolygon, sectors, shares, leader, territories, coverage,
  present, parseCoord, nearby, ago,
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
  if (st.canWrite) { const a = el("button", "chip add", "+ candidat"); a.onclick = openCandForm; box.append(a); }

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
  if (!rows.length) rc.append(el("li", "hint", "Ajoutez un candidat avec « + candidat » en haut."));

  // bandeaux
  const empty = $("emptyBanner");
  empty.textContent = st.kind === "supabase" && !panels.length && !cands.length
    ? "La carte partagée est vide pour l'instant. Ajoutez les candidats suivis, puis signalez les panneaux de votre commune." : "";
  schedulePlayers();
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
    ? `Vous jouez sous le pseudo « ${S.store.pseudo} ». 1 point par vérification, 3 par panneau signalé.`
    : "1 point par vérification, 3 points par panneau signalé.";
}

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
  }
  const ul = el("ul");
  for (const k of st.cands) {
    const v = st.statuts.get(p.id)?.get(k.id), li = el("li");
    li.append(el("b", null, k.nom), el("span", null, v ? (v.ok ? "présente" : "absente") + " · " + ago(v.at) : "pas relevé"));
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
  $("candForm").hidden = false; $("addForm").hidden = true;
  $("cCouleur").value = PALETTE[S.store.cands.length % PALETTE.length];
  $("candForm").scrollIntoView({ block: "nearest" }); $("cNom").focus();
}
$("cCancel").onclick = () => { $("candForm").hidden = true; $("cErr").hidden = true; $("cNom").value = ""; };
$("candForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("cNom").value.trim(), err = $("cErr");
  if (nom.length < 2) { err.textContent = "Indiquez le nom du candidat."; err.hidden = false; return; }
  if (S.store.cands.some((c) => c.nom.toLowerCase() === nom.toLowerCase())) { err.textContent = "Ce candidat est déjà dans la liste."; err.hidden = false; return; }
  try { const id = await S.store.addCandidat({ nom, couleur: $("cCouleur").value }); S.sel = id; lsSet("gdp-sel", id); $("cCancel").click(); toast(nom + " ajouté"); render(); }
  catch (x) { err.textContent = explain(x); err.hidden = false; }
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
