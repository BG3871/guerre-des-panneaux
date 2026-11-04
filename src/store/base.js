// État partagé par les deux sources de données (Supabase ou mode local).
// cands   : [{id, nom, couleur, at}]
// panels  : Map(id -> {id, lat, lng, lieu, commune, source, by, at})
// statuts : Map(panneauId -> Map(candidatId -> {ok, at, by}))   (dernier relevé connu)

export class BaseStore {
  constructor() {
    this.cands = [];
    this.panels = new Map();
    this.statuts = new Map();
    this.me = null;
    this.pseudo = null;
    this._subs = new Set();
    this._t = null;
  }
  onChange(cb) { this._subs.add(cb); return () => this._subs.delete(cb); }
  /** Prévient l'interface, regroupé pour ne pas redessiner 1000 fois pendant un chargement. */
  changed() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this._subs.forEach((cb) => cb()), 30);
  }
  panelList() { return [...this.panels.values()]; }

  putCand(c) {
    if (!c || !c.nom) return;
    const i = this.cands.findIndex((x) => x.id === c.id);
    if (i >= 0) this.cands[i] = c; else this.cands.push(c);
    this.cands.sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  delCand(id) {
    this.cands = this.cands.filter((c) => c.id !== id);
    for (const m of this.statuts.values()) m.delete(id);
  }
  putPanel(p) {
    if (p && typeof p.lat === "number" && typeof p.lng === "number") this.panels.set(p.id, p);
  }
  delPanel(id) { this.panels.delete(id); this.statuts.delete(id); }
  /**
   * r = {id, p, c, ok, at, by, v} (v = vérifié par photo) ; ne garde que le relevé le plus récent,
   * sauf qu'un relevé vérifié de moins de 24 h n'est pas remplacé par un relevé sans photo.
   */
  putStatut(r) {
    let m = this.statuts.get(r.p);
    if (!m) this.statuts.set(r.p, (m = new Map()));
    const old = m.get(r.c), at = r.at || 0;
    // même règle que la vue statut_actuel ; la correction d'un même relevé (même id) passe toujours
    const protege = old && old.v && !r.v && r.id !== old.id && at - old.at < 864e5;
    if (!old || (!protege && at >= (old.at || 0))) {
      m.set(r.c, { id: r.id ?? null, ok: !!r.ok, at, by: r.by || null, v: !!r.v });
    }
  }
}
