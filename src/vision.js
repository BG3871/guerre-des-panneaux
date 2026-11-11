// Reconnaissance visuelle des affiches, entièrement dans le navigateur (gratuit, sans serveur).
//
// Méthode classique de reconnaissance d'un objet plat (ORB + RANSAC, bibliothèque jsfeat, MIT) :
// 1. on repère sur l'image des points saillants (coins, bords de lettres, détails de la photo) ;
// 2. chaque point est résumé par une « signature » de 256 bits (comparaisons de luminosité
//    autour du point) ;
// 3. on apparie les signatures de la photo à celles de chaque affiche de référence ;
// 4. on garde les appariements cohérents avec une même perspective (homographie, RANSAC).
//    Une dizaine de points cohérents suffit : le hasard n'en aligne presque jamais autant.
//
// Seules les signatures (points + bits) des affiches de référence sont livrées avec l'appli,
// pas les images : on ne peut pas reconstituer l'affiche à partir d'elles.
//
// Les fonctions prennent une image brute { width, height, data } (RGBA, comme ImageData),
// ce qui permet de les tester hors navigateur.
import jsfeat from "jsfeat";

/** Côté maximal de la photo analysée (au-delà, plus lent sans gain net). */
export const COTE_PHOTO = 960;
/** Hauteurs (px) auxquelles chaque affiche de référence est apprise (l'affiche peut être loin ou près). */
export const HAUTEURS_REF = [480, 330, 230, 160];
const MAX_POINTS_REF = 220; // par niveau
const MAX_POINTS_PHOTO = 900;
const BORD = 17; // un point doit être à 16 px au moins du bord (taille du motif ORB)
const DIST_MAX = 64; // distance de Hamming maximale d'un appariement (sur 256 bits)
const RATIO = 0.85; // le meilleur appariement doit nettement battre le second

jsfeat.yape06.laplacian_threshold = 25;
jsfeat.yape06.min_eigen_value_threshold = 20;

const U_MAX = new Int32Array([15, 15, 15, 15, 14, 14, 14, 13, 13, 12, 11, 10, 9, 8, 6, 3, 0]);
/** Orientation d'un point (centroïde des intensités), pour reconnaître une affiche un peu penchée. */
function angle(img, px, py) {
  const src = img.data, step = img.cols, c = py * step + px;
  let m01 = 0, m10 = 0;
  for (let u = -15; u <= 15; u++) m10 += u * src[c + u];
  for (let v = 1; v <= 15; v++) {
    let vs = 0;
    const d = U_MAX[v];
    for (let u = -d; u <= d; u++) {
      const p = src[c + u + v * step], m = src[c + u - v * step];
      vs += p - m; m10 += u * (p + m);
    }
    m01 += v * vs;
  }
  return Math.atan2(m01, m10);
}

/** Niveaux de gris légèrement adoucis (les signatures ORB n'aiment pas le bruit). */
function gris(img) {
  const g = new jsfeat.matrix_t(img.width, img.height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.grayscale(img.data, img.width, img.height, g, jsfeat.COLOR_RGBA2GRAY);
  const b = new jsfeat.matrix_t(img.width, img.height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.gaussian_blur(g, b, 5, 0);
  return b;
}

let cornersCache = [];
/** Points saillants et signatures : { n, xy: Float32Array, desc: Int32Array (8 mots par point) }. */
function signatures(g, max) {
  const n0 = g.cols * g.rows;
  while (cornersCache.length < n0) cornersCache.push(new jsfeat.keypoint_t(0, 0, 0, 0, -1));
  const corners = cornersCache;
  let n = jsfeat.yape06.detect(g, corners, BORD);
  // les plus marqués d'abord
  const pts = corners.slice(0, n).sort((a, b) => b.score - a.score).slice(0, max);
  n = pts.length;
  for (const p of pts) p.angle = angle(g, p.x, p.y);
  const m = new jsfeat.matrix_t(32, Math.max(1, n), jsfeat.U8_t | jsfeat.C1_t);
  if (n) jsfeat.orb.describe(g, pts, n, m);
  const xy = new Float32Array(2 * n);
  pts.forEach((p, i) => { xy[2 * i] = p.x; xy[2 * i + 1] = p.y; });
  return { n, xy, desc: new Int32Array(m.data.buffer.slice(0, n * 32)) };
}

/** Redimensionne une image RGBA (plus proche voisin moyenné 2×2, suffisant ici). */
export function redimensionner(img, w, h) {
  const out = new Uint8ClampedArray(w * h * 4), sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const X = Math.min(img.width - 1, Math.floor((x + dx) * sx)), Y = Math.min(img.height - 1, Math.floor((y + dy) * sy));
        s += img.data[(Y * img.width + X) * 4 + c];
      }
      out[o + c] = s / 4;
    }
    out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

const b64 = (u8) => (typeof Buffer !== "undefined" ? Buffer.from(u8).toString("base64") : btoa(String.fromCharCode(...u8)));
const deB64 = (s) => (typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(s, "base64")) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/**
 * Empreinte d'une affiche de référence (image recadrée au ras de l'affiche) : signatures à
 * plusieurs tailles, positions ramenées en fraction de la hauteur de l'affiche.
 * Format compact pour le JSON : { ratio, n, pts (base64 Uint16 x,y en 1/10000), desc (base64) }.
 */
export function empreinteReference(img) {
  const ratio = img.width / img.height, xs = [], ds = [];
  for (const h of HAUTEURS_REF) {
    const w = Math.round(h * ratio), s = signatures(gris(redimensionner(img, w, h)), MAX_POINTS_REF);
    for (let i = 0; i < s.n; i++) xs.push(Math.round((s.xy[2 * i] / h) * 10000), Math.round((s.xy[2 * i + 1] / h) * 10000));
    ds.push(new Uint8Array(s.desc.buffer));
  }
  const desc = new Uint8Array(ds.reduce((a, d) => a + d.length, 0));
  let o = 0; for (const d of ds) { desc.set(d, o); o += d.length; }
  return { ratio: Math.round(ratio * 1000) / 1000, n: xs.length / 2, pts: b64(new Uint8Array(new Uint16Array(xs).buffer)), desc: b64(desc) };
}

/** Empreinte JSON → structure de recherche. */
export function chargerReference(e) {
  const p = deB64(e.pts), d = deB64(e.desc);
  const u16 = new Uint16Array(p.buffer, p.byteOffset, p.byteLength / 2);
  return { n: e.n, ratio: e.ratio, xy: Float32Array.from(u16, (v) => v / 10000), desc: new Int32Array(d.buffer, d.byteOffset, d.byteLength / 4) };
}

function popcnt(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Appariements photo → référence (meilleur voisin, test du rapport au second). */
function apparier(s, ref) {
  const from = [], to = [];
  for (let i = 0; i < s.n; i++) {
    let b1 = 999, b2 = 999, j1 = -1;
    const o = i * 8;
    for (let j = 0; j < ref.n; j++) {
      const q = j * 8;
      let d = 0;
      for (let k = 0; k < 8 && d < b2; k++) d += popcnt(s.desc[o + k] ^ ref.desc[q + k]);
      if (d < b1) { b2 = b1; b1 = d; j1 = j; } else if (d < b2) b2 = d;
    }
    if (j1 >= 0 && b1 <= DIST_MAX && b1 < RATIO * b2) {
      from.push({ x: ref.xy[2 * j1], y: ref.xy[2 * j1 + 1] });
      to.push({ x: s.xy[2 * i], y: s.xy[2 * i + 1] });
    }
  }
  return { from, to };
}

/** Coins de l'affiche projetés sur la photo : refuse les formes absurdes (croisées, minuscules). */
function formePlausible(H, ratio, W, Hh) {
  const m = H.data, pts = [[0, 0], [ratio, 0], [ratio, 1], [0, 1]].map(([x, y]) => {
    const z = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
  });
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return false;
  let aire = 0, signe = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (signe && Math.sign(cr) !== signe) return false; // non convexe
    signe = Math.sign(cr);
    aire += a[0] * b[1] - b[0] * a[1];
  }
  aire = Math.abs(aire) / 2;
  return aire > 0.02 * W * Hh && aire < 4 * W * Hh;
}

const kernel = new jsfeat.motion_model.homography2d();
const params = new jsfeat.ransac_params_t(4, 4, 0.5, 0.995);

/** Nombre de points cohérents entre la photo (signatures) et une référence. */
function inliers(s, ref, W, H) {
  const { from, to } = apparier(s, ref), n = from.length;
  if (n < 6) return 0;
  const model = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
  const mask = new jsfeat.matrix_t(n, 1, jsfeat.U8_t | jsfeat.C1_t);
  // les positions de référence sont en fraction de hauteur : on les ramène à ~480 px pour le seuil
  const F = from.map((p) => ({ x: p.x * 480, y: p.y * 480 }));
  if (!jsfeat.motion_estimator.ransac(params, kernel, F, to, n, model, mask, 1000)) return 0;
  // modèle exprimé pour des coordonnées ×480 : on le ramène à des coordonnées en fraction de hauteur
  const m = model.data;
  for (const i of [0, 1, 3, 4, 6, 7]) m[i] *= 480;
  if (!formePlausible(model, ref.ratio, W, H)) return 0;
  let k = 0;
  for (let i = 0; i < n; i++) k += mask.data[i];
  return k;
}

/**
 * Points cohérents → score de 0 à 1. Sur 180 photos simulées, une photo sans l'affiche n'a
 * jamais dépassé 6 points cohérents : 10 points (0,5) = « probable », 20 points (0,8) = sûr.
 */
export function scoreVisuel(k) {
  return k < 10 ? 0 : Math.min(0.95, Math.round((0.5 + (k - 10) * 0.03) * 100) / 100);
}

/**
 * Cherche chaque affiche de référence sur la photo.
 * @param img image RGBA { width, height, data }, déjà réduite (COTE_PHOTO)
 * @param refs [{ id, ref (chargerReference) }]
 * @returns [{ id, points, score }] trié par score décroissant
 */
export function chercherAffiches(img, refs) {
  const s = signatures(gris(img), MAX_POINTS_PHOTO);
  return refs.map(({ id, ref }) => {
    const k = inliers(s, ref, img.width, img.height);
    return { id, points: k, score: scoreVisuel(k) };
  }).sort((a, b) => b.score - a.score || b.points - a.points);
}

/** Copie réduite (côté max COTE_PHOTO) d'un canvas, au format ImageData. */
export function imageDeTravail(canvas) {
  const k = Math.min(1, COTE_PHOTO / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(canvas, 0, 0, c.width, c.height);
  return x.getImageData(0, 0, c.width, c.height);
}
