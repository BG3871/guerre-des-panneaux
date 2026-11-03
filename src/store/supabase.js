// Carte partagée : base Supabase (Postgres + comptes anonymes + temps réel).
// Le schéma est dans supabase/schema.sql.
import { createClient } from "@supabase/supabase-js";
import { BaseStore } from "./base.js";

const PAGE = 1000;
const ts = (v) => (v ? Date.parse(v) : 0);
const toCand = (r) => ({ id: r.id, nom: r.nom, couleur: r.couleur, by: r.cree_par, at: ts(r.cree_le) });
const toPanel = (r) => ({ id: r.id, lat: r.lat, lng: r.lng, lieu: r.lieu || "", commune: r.commune || "",
  source: r.source, by: r.cree_par, at: ts(r.cree_le) });
const toStatut = (r) => ({ p: r.panneau_id, c: r.candidat_id, ok: r.present, by: r.auteur, at: ts(r.cree_le) });

export class SupabaseStore extends BaseStore {
  constructor(url, key) {
    super();
    this.kind = "supabase";
    this.isDemo = false;
    this.canWrite = true;
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async init() {
    const { data } = await this.sb.auth.getSession();
    if (data.session) {
      this.me = data.session.user.id;
      const { data: prof } = await this.sb.from("profils").select("pseudo").eq("id", this.me).maybeSingle();
      this.pseudo = prof?.pseudo || null;
    }
    await this._loadAll();
    this._listen();
  }

  async _all(table, cols, map) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select(cols).order("id").range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data.map(map));
      if (data.length < PAGE) return out;
    }
  }
  async _loadAll() {
    const [cands, panels, statuts] = await Promise.all([
      this._all("candidats", "id,nom,couleur,cree_par,cree_le", toCand),
      this._all("panneaux", "id,lat,lng,lieu,commune,source,cree_par,cree_le", toPanel),
      this._all("statut_actuel", "id,panneau_id,candidat_id,present,auteur,cree_le", toStatut),
    ]);
    cands.forEach((c) => this.putCand(c));
    panels.forEach((p) => this.putPanel(p));
    statuts.forEach((s) => this.putStatut(s));
    this.changed();
  }

  _listen() {
    this.sb.channel("carte")
      .on("postgres_changes", { event: "*", schema: "public", table: "candidats" }, (e) => {
        if (e.eventType === "DELETE") this.delCand(e.old.id); else this.putCand(toCand(e.new));
        this.changed();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "panneaux" }, (e) => {
        if (e.eventType === "DELETE") this.delPanel(e.old.id); else this.putPanel(toPanel(e.new));
        this.changed();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "releves" }, (e) => {
        if (e.eventType !== "DELETE") { this.putStatut(toStatut(e.new)); this.changed(); }
      })
      .subscribe();
  }

  get signedIn() { return !!(this.me && this.pseudo); }

  /** Crée un compte anonyme (pas d'e-mail) au premier geste, avec le pseudo choisi. */
  async signIn(pseudo) {
    if (!this.me) {
      const { data, error } = await this.sb.auth.signInAnonymously();
      if (error) throw error;
      this.me = data.user.id;
    }
    const { error } = await this.sb.from("profils").upsert({ id: this.me, pseudo });
    if (error) throw error;
    this.pseudo = pseudo;
  }

  async addCandidat({ nom, couleur }) {
    const { data, error } = await this.sb.from("candidats").insert({ nom, couleur }).select().single();
    if (error) throw error;
    this.putCand(toCand(data)); this.changed();
    return data.id;
  }
  async addPanel({ lat, lng, lieu, commune }) {
    const { data, error } = await this.sb.from("panneaux").insert({ lat, lng, lieu, commune }).select().single();
    if (error) throw error;
    this.putPanel(toPanel(data)); this.changed();
    return data.id;
  }
  async removePanel(id) {
    const { error } = await this.sb.from("panneaux").delete().eq("id", id);
    if (error) throw error;
    this.delPanel(id); this.changed();
  }
  async setReleve(pid, cid, ok) {
    // un relevé par panneau, candidat, joueur et jour : refaire le relevé le même jour le corrige
    const { data, error } = await this.sb.from("releves")
      .upsert({ panneau_id: pid, candidat_id: cid, present: ok, auteur: this.me },
        { onConflict: "panneau_id,candidat_id,auteur,jour" })
      .select().single();
    if (error) throw error;
    this.putStatut(toStatut(data)); this.changed();
  }
  async leaderboard(limit = 8) {
    const { data, error } = await this.sb.from("classement").select("id,pseudo,points").order("points", { ascending: false }).limit(limit);
    if (error) throw error;
    return data.map((r) => ({ id: r.id, pseudo: r.pseudo || "Quelqu'un", points: r.points }));
  }
}
