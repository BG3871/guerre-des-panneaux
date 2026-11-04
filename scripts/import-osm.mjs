#!/usr/bin/env node
// Importe des panneaux OpenStreetMap dans Supabase, sans doublons (clé : osm_id).
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npm run import-osm [fichier]
//
// Fichier par défaut : data/panneaux-osm.json. Formats acceptés :
//   - liste [{osm_id, lat, lng, lieu, commune}] (format de data/panneaux-osm.json)
//   - réponse Overpass JSON ({elements:[{type, id, lat, lon, center, tags}]})
//   - GeoJSON FeatureCollection de points (properties.osm_id ou "@id", name, commune / addr:city)
// La clé « service_role » contourne les droits : ne l'utilisez qu'ici, jamais dans le site.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const file = process.argv[2] || "data/panneaux-osm.json";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Il manque SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY dans l'environnement.");
  process.exit(1);
}

const raw = JSON.parse(await readFile(file, "utf8"));
const LIEU = "Panneau d'affichage libre";
let rows;
if (Array.isArray(raw)) {
  rows = raw.map((r) => ({ osm_id: r.osm_id || r.osm, lat: r.lat, lng: r.lng ?? r.lon, lieu: r.lieu || LIEU, commune: r.commune || "" }));
} else if (raw.elements) {
  rows = raw.elements.map((e) => {
    const t = e.tags || {};
    return { osm_id: `${e.type}/${e.id}`, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
      lieu: t.name || t.description || LIEU, commune: t["addr:city"] || "" };
  });
} else if (raw.features) {
  rows = raw.features.filter((f) => f.geometry?.type === "Point").map((f) => {
    const p = f.properties || {};
    return { osm_id: p.osm_id || p["@id"] || f.id, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
      lieu: p.name || p.lieu || LIEU, commune: p.commune || p["addr:city"] || "" };
  });
} else {
  console.error("Format de fichier non reconnu."); process.exit(1);
}

const ok = rows.filter((r) => r.osm_id && r.lat > 41 && r.lat < 51.5 && r.lng > -5.5 && r.lng < 10)
  .map((r) => ({ ...r, osm_id: String(r.osm_id), lieu: String(r.lieu).slice(0, 120), commune: String(r.commune).slice(0, 80),
    source: "osm", cree_par: null }));
console.log(`${ok.length} panneaux à importer (${rows.length - ok.length} ignorés : hors métropole ou sans identifiant OSM).`);

const sb = createClient(url, key, { auth: { persistSession: false } });
for (let i = 0; i < ok.length; i += 500) {
  const chunk = ok.slice(i, i + 500);
  // ignoreDuplicates : un panneau déjà importé n'est pas modifié (ses relevés sont conservés)
  const { error } = await sb.from("panneaux").upsert(chunk, { onConflict: "osm_id", ignoreDuplicates: true });
  if (error) { console.error("Erreur :", error.message); process.exit(1); }
  console.log(`  ${Math.min(i + 500, ok.length)} / ${ok.length}`);
}
console.log("Import terminé.");
