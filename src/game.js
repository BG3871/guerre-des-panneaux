// Règles du jeu, sans dépendance à la carte : testables avec `npm test`.

export const STALE_MS = 14 * 864e5; // un relevé de plus de 14 jours est « pâli »
export const POINTS_RELEVE = 1;
export const POINTS_PANNEAU = 3;
export const SEUIL_CONQUETE = 0.5;

/* ---------- projection Web Mercator (même repère que Leaflet / EPSG:3857) ---------- */
const R = 6378137;
const D = Math.PI / 180;
export function project(lat, lng) {
  const s = Math.max(Math.min(Math.sin(lat * D), 0.9999999999), -0.9999999999);
  return { x: R * lng * D, y: (R * Math.log((1 + s) / (1 - s))) / 2 };
}
export function unproject(x, y) {
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D, lng: x / R / D };
}

/* ---------- secteurs hexagonaux ---------- */
const SQ3 = Math.sqrt(3);

/** Taille d'un secteur (rayon, en mètres Mercator) selon le niveau de zoom. */
export function hexSize(z) {
  return z < 7 ? 60000 : z < 10 ? 15000 : z < 12 ? 4000 : z < 14 ? 1000 : 250;
}
export function hexLabel(s) {
  return s >= 1000 ? (s / 1000).toLocaleString("fr-FR") + " km" : s + " m";
}

/** Clé "q,r" du secteur (coordonnées axiales, hexagones pointe en haut). */
export function hexKey(lat, lng, s) {
  const p = project(lat, lng);
  const q = ((SQ3 / 3) * p.x - p.y / 3) / s;
  const r = ((2 / 3) * p.y) / s;
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return rx + "," + (rz + 0); // +0 évite "-0"
}

/** Sommets [lat, lng] de l'hexagone d'un secteur. */
export function hexPolygon(key, s) {
  const [q, r] = key.split(",").map(Number);
  const cx = s * SQ3 * (q + r / 2), cy = s * 1.5 * r;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = D * (60 * i + 30);
    const u = unproject(cx + s * Math.cos(a), cy + s * Math.sin(a));
    pts.push([u.lat, u.lng]);
  }
  return pts;
}

/** Regroupe les panneaux par secteur. */
export function sectors(panels, s) {
  const g = new Map();
  for (const p of panels) {
    const k = hexKey(p.lat, p.lng, s);
    let l = g.get(k);
    if (!l) g.set(k, (l = []));
    l.push(p);
  }
  return g;
}

/* ---------- relevés ---------- */
/** statuts : Map(panneauId -> Map(candidatId -> {ok, at, by})) */
export function present(statuts, pid, cid) {
  const v = statuts.get(pid)?.get(cid);
  return v ? v.ok : null;
}

/** Part des panneaux du secteur portant l'affiche de chaque candidat. */
export function shares(list, cands, statuts) {
  const out = {};
  for (const c of cands) {
    let k = 0;
    for (const p of list) if (present(statuts, p.id, c.id) === true) k++;
    out[c.id] = list.length ? k / list.length : 0;
  }
  return out;
}

/** Candidat qui tient le secteur en vue Bataille : le mieux affiché, au-dessus du seuil, sans égalité. */
export function leader(sh, cands) {
  let best = null, bv = 0, tie = false;
  for (const c of cands) {
    const v = sh[c.id] || 0;
    if (v > bv) { bv = v; best = c; tie = false; }
    else if (v === bv && bv > 0) tie = true;
  }
  return best && bv >= SEUIL_CONQUETE && !tie ? { cand: best, share: bv } : null;
}

/** Nombre de secteurs conquis (≥ 50 %) par candidat. */
export function territories(sec, cands, statuts) {
  const terr = Object.fromEntries(cands.map((c) => [c.id, 0]));
  for (const list of sec.values()) {
    const sh = shares(list, cands, statuts);
    for (const c of cands) if (sh[c.id] >= SEUIL_CONQUETE) terr[c.id]++;
  }
  return terr;
}

/** Couverture d'un candidat sur tous les panneaux. */
export function coverage(panels, statuts, cid) {
  let ok = 0, no = 0;
  for (const p of panels) {
    const v = present(statuts, p.id, cid);
    if (v === true) ok++;
    else if (v === false) no++;
  }
  return { ok, no, unknown: panels.length - ok - no, total: panels.length };
}

/**
 * Points des joueurs : 1 par relevé (un par panneau, candidat et jour),
 * 3 par panneau signalé. Les panneaux importés (sans auteur) ne rapportent rien.
 */
export function playerPoints(panels, releves) {
  const pts = new Map();
  const add = (id, n) => { if (id) pts.set(id, (pts.get(id) || 0) + n); };
  for (const p of panels) add(p.by, POINTS_PANNEAU);
  for (const r of releves) add(r.by, POINTS_RELEVE);
  return pts;
}

/* ---------- saisie ---------- */
/** Lit des coordonnées collées ("48.85661, 2.35222", "48,85661 2,35222", lien geo:…). France métropolitaine et Corse. */
export function parseCoord(str) {
  const s = String(str).trim().replace(/^geo:/i, "");
  let m = s.match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) m = s.match(/(-?\d{1,2},\d+)\s*[; ]\s*(-?\d{1,3},\d+)/);
  if (!m) m = s.match(/(-?\d{1,2})\s*[,; ]\s*(-?\d{1,3})(?!\d)/);
  if (!m) return null;
  const la = parseFloat(m[1].replace(",", ".")), lo = parseFloat(m[2].replace(",", "."));
  if (!(la > 41 && la < 51.5 && lo > -5.5 && lo < 10)) return null;
  return [la, lo];
}

/** Distance approximative en mètres (suffisante à l'échelle d'une rue). */
export function distance(a, b) {
  const x = (b[1] - a[1]) * D * Math.cos(((a[0] + b[0]) / 2) * D);
  const y = (b[0] - a[0]) * D;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** Panneau existant à moins de `m` mètres (pour éviter les doublons). */
export function nearby(panels, ll, m = 15) {
  let best = null, bd = m;
  for (const p of panels) {
    const d = distance(ll, [p.lat, p.lng]);
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}

export function ago(t, now = Date.now()) {
  if (!t) return "";
  const d = Math.floor((now - t) / 864e5);
  return d <= 0 ? "aujourd'hui" : d === 1 ? "hier" : "il y a " + d + " j";
}

/* ---------- reconnaissance d'une affiche (texte lu par OCR) ---------- */
export const SEUIL_PHOTO = 0.8;   // score à partir duquel le nom est jugé reconnu
export const DISTANCE_PHOTO = 50; // mètres maximum entre le joueur et le panneau

/** Majuscules sans accents, chiffres confondus avec les lettres qu'ils imitent, mots séparés par une espace. */
export function normTexte(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    // un chiffre collé à une lettre est sans doute une lettre mal lue (DUP0NT) ; « 2027 » reste un nombre
    .replace(/(?<=[A-Z])[0158]|[0158](?=[A-Z])/g, (d) => ({ 0: "O", 1: "I", 5: "S", 8: "B" })[d])
    .replace(/[^A-Z]+/g, " ").trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
/** Similarité de 0 à 1 entre deux chaînes. */
export function similarite(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Ce qu'on cherche sur l'affiche : le nom complet, le nom de famille (dernier mot) et les alias. */
export function ciblesCandidat(c) {
  const out = new Set();
  const nom = normTexte(c.nom);
  if (nom) out.add(nom);
  const mots = nom.split(" ").filter((m) => m.length >= 3);
  if (mots.length > 1) out.add(mots[mots.length - 1]);
  for (const a of c.alias || []) { const n = normTexte(a); if (n.length >= 3) out.add(n); }
  return [...out];
}

/**
 * Score de 0 à 1 : meilleure ressemblance entre une cible du candidat et un groupe de mots
 * consécutifs du texte lu (même nombre de mots, ou collés si l'OCR a mangé les espaces).
 */
export function scoreCandidat(texte, c) {
  const mots = normTexte(texte).split(" ").filter(Boolean);
  if (!mots.length) return 0;
  let best = 0;
  for (const cible of ciblesCandidat(c)) {
    const k = cible.split(" ").length, colle = cible.replace(/ /g, "");
    for (let i = 0; i + k <= mots.length; i++) {
      const g = mots.slice(i, i + k);
      best = Math.max(best, similarite(g.join(" "), cible), similarite(g.join(""), colle));
    }
    // nom coupé en deux par l'OCR (« DU PONT ») : on essaie aussi deux mots collés
    if (k === 1) for (let i = 0; i + 2 <= mots.length; i++) best = Math.max(best, similarite(mots[i] + mots[i + 1], colle));
    if (best === 1) break;
  }
  return Math.round(best * 100) / 100;
}

/** Candidats triés par score décroissant. */
export function classerCandidats(texte, cands) {
  return cands.map((c) => ({ cand: c, score: scoreCandidat(texte, c) })).sort((a, b) => b.score - a.score);
}
