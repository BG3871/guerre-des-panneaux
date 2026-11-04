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
  /** r = {p, c, ok, at, by} ; ne garde que le relevé le plus récent. */
  putStatut(r) {
    let m = this.statuts.get(r.p);
    if (!m) this.statuts.set(r.p, (m = new Map()));
    const old = m.get(r.c);
    if (!old || (r.at || 0) >= (old.at || 0)) m.set(r.c, { ok: !!r.ok, at: r.at || 0, by: r.by || null });
  }
}
