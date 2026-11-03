// Mode local : tout est gardé dans le navigateur (localStorage). Sert à essayer l'appli
// sans backend. Démarre avec des données d'exemple fictives.
import { BaseStore } from "./base.js";
import { makeDemo } from "../demo.js";
import { playerPoints } from "../game.js";

const KEY = "gdp-local-v1";
const day = (t) => new Date(t).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class LocalStore extends BaseStore {
  constructor() {
    super();
    this.kind = "local";
    this.canWrite = true;
  }

  async init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
    this.db = saved && saved.v === 1 ? saved : this._fresh();
    this.me = this.db.me;
    this.pseudo = this.db.pseudos[this.me] || null;
    this._rebuild();
  }

  _fresh() {
    const d = makeDemo();
    return { v: 1, me: "moi-" + uid(), demo: true, ...d };
  }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch {} }
  _rebuild() {
    this.cands = []; this.panels = new Map(); this.statuts = new Map();
    this.db.cands.forEach((c) => this.putCand(c));
    this.db.panels.forEach((p) => this.putPanel(p));
    this.db.releves.forEach((r) => this.putStatut(r));
    this.changed();
  }
  get isDemo() { return !!this.db.demo; }

  /** Vide les données d'exemple pour repartir d'une carte blanche (toujours locale). */
  async reset(withDemo) {
    const me = this.me, pseudo = this.pseudo;
    this.db = withDemo ? this._fresh() : { v: 1, me, demo: false, cands: [], panels: [], releves: [], pseudos: {} };
    this.db.me = me;
    if (pseudo) this.db.pseudos[me] = pseudo;
    this._save(); this._rebuild();
  }

  async signIn(pseudo) { this.pseudo = pseudo; this.db.pseudos[this.me] = pseudo; this._save(); }
  get signedIn() { return !!this.pseudo; }

  async addCandidat({ nom, couleur }) {
    const c = { id: "c-" + uid(), nom, couleur, by: this.me, at: Date.now() };
    this.db.cands.push(c); this._save(); this.putCand(c); this.changed();
    return c.id;
  }
  async addPanel({ lat, lng, lieu, commune }) {
    const p = { id: "p-" + uid(), lat, lng, lieu, commune, source: "contrib", by: this.me, at: Date.now() };
    this.db.panels.push(p); this._save(); this.putPanel(p); this.changed();
    return p.id;
  }
  async removePanel(id) {
    this.db.panels = this.db.panels.filter((p) => p.id !== id);
    this.db.releves = this.db.releves.filter((r) => r.p !== id);
    this._save(); this.delPanel(id); this.changed();
  }
  async setReleve(pid, cid, ok) {
    const at = Date.now(), j = day(at);
    // un seul relevé (donc un point) par panneau, candidat, joueur et jour : on remplace celui du jour
    this.db.releves = this.db.releves.filter((r) => !(r.p === pid && r.c === cid && r.by === this.me && day(r.at) === j));
    const r = { p: pid, c: cid, ok, at, by: this.me };
    this.db.releves.push(r); this._save(); this.putStatut(r); this.changed();
  }
  async leaderboard(limit = 8) {
    const pts = playerPoints(this.db.panels, this.db.releves);
    return [...pts].sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([id, points]) => ({ id, points, pseudo: this.db.pseudos[id] || "Quelqu'un" }));
  }
}
