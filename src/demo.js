// Données d'exemple FICTIVES pour le mode local : candidats, panneaux et relevés inventés,
// générés de façon déterministe pour montrer le principe du jeu.

export const DEMO_PSEUDOS = ["Camille", "Yanis", "Léa", "Hugo", "Inès", "Malik"].map((n) => n + " (exemple)");

export function makeDemo(now = Date.now()) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += rnd(); return (u - 2) / 2; };
  const cands = [
    { id: "dA", nom: "Candidate A (exemple)", couleur: "#2b3cc4", at: 1 },
    { id: "dB", nom: "Candidat B (exemple)", couleur: "#c2410c", at: 2 },
    { id: "dC", nom: "Candidate C (exemple)", couleur: "#7c3aed", at: 3 },
  ];
  const villes = [
    ["Paris", 48.8566, 2.3522, 90, 0.06], ["Lyon", 45.764, 4.8357, 45, 0.05], ["Marseille", 43.2965, 5.3698, 40, 0.06],
    ["Toulouse", 43.6047, 1.4442, 30, 0.05], ["Lille", 50.6292, 3.0573, 30, 0.05], ["Nantes", 47.2184, -1.5536, 25, 0.05],
    ["Strasbourg", 48.5734, 7.7521, 22, 0.04], ["Bordeaux", 44.8378, -0.5792, 25, 0.05], ["Grenoble", 45.1885, 5.7245, 25, 0.04],
    ["Rennes", 48.1173, -1.6778, 20, 0.04], ["Montpellier", 43.6108, 3.8767, 20, 0.04], ["Dijon", 47.322, 5.0415, 12, 0.03],
    ["Clermont-Ferrand", 45.7772, 3.087, 12, 0.03], ["Tours", 47.3941, 0.6848, 12, 0.03], ["Brest", 48.3904, -4.4861, 10, 0.03],
    ["Limoges", 45.8336, 1.2611, 10, 0.03], ["Metz", 49.1193, 6.1757, 10, 0.03], ["Ajaccio", 41.9192, 8.7386, 6, 0.02],
  ];
  const lieux = ["Place de la mairie", "Devant l'école", "Parking de la salle des fêtes", "Angle de la rue principale",
    "Près de la gare", "Square du marché", "Entrée du gymnase", "Rond-point de la poste"];
  const panels = [], releves = [];
  let n = 0;
  for (const [nom, la, lo, cnt, sp] of villes) {
    const bias = { dA: 0.35 + rnd() * 0.5, dB: 0.2 + rnd() * 0.5, dC: 0.1 + rnd() * 0.4 };
    for (let i = 0; i < cnt; i++) {
      const id = "demo" + n++;
      panels.push({ id, lat: la + gauss() * sp, lng: lo + gauss() * sp * 1.4, lieu: lieux[Math.floor(rnd() * lieux.length)],
        commune: nom, source: "demo", by: rnd() < 0.3 ? "ex" + Math.floor(rnd() * 6) : null, at: now });
      for (const c of cands) {
        if (rnd() < 0.8) releves.push({ p: id, c: c.id, ok: rnd() < bias[c.id], at: now - rnd() * 20 * 864e5, by: "ex" + Math.floor(rnd() * 6) });
      }
    }
  }
  const pseudos = Object.fromEntries(DEMO_PSEUDOS.map((p, i) => ["ex" + i, p]));
  return { cands, panels, releves, pseudos };
}
