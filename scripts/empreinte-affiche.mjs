// Calcule l'empreinte visuelle d'une affiche de campagne et l'ajoute à src/affiches-2027.json.
//
//   node scripts/empreinte-affiche.mjs "Nom du candidat" "Titre de l'affiche" image.jpg URL-source
//
// L'image doit être recadrée au ras de l'affiche (JPEG). Elle n'est PAS copiée dans le dépôt :
// seule son empreinte (points et signatures ORB, impossibles à retransformer en image) est gardée,
// avec l'adresse où l'affiche est publiée.
import fs from "node:fs";
import jpeg from "jpeg-js";
import { empreinteReference } from "../src/vision.js";

const [nom, titre, fichier, source] = process.argv.slice(2);
if (!nom || !titre || !fichier || !source) {
  console.error('Usage : node scripts/empreinte-affiche.mjs "Nom du candidat" "Titre" image.jpg URL-source');
  process.exit(1);
}
const FICHIER = new URL("../src/affiches-2027.json", import.meta.url);
const base = JSON.parse(fs.readFileSync(FICHIER, "utf8"));
const cand = base.candidats.find((c) => c.nom === nom);
if (!cand) { console.error("Candidat absent de src/affiches-2027.json : " + nom); process.exit(1); }

const img = jpeg.decode(fs.readFileSync(fichier), { useTArray: true, formatAsRGBA: true });
const empreinte = empreinteReference(img);
cand.affiches = (cand.affiches || []).filter((a) => a.titre !== titre);
cand.affiches.push({ titre, source, empreinte });
fs.writeFileSync(FICHIER, JSON.stringify(base, null, 1) + "\n");
console.log(`${nom} · « ${titre} » : ${empreinte.n} points (${Math.round(JSON.stringify(empreinte).length / 1024)} Ko)`);
