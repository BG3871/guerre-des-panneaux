// Carte partagée : base Supabase (Postgres + comptes anonymes + temps réel).
// Le schéma est dans supabase/schema.sql.
import { createClient } from "@supabase/supabase-js";
import { BaseStore } from "./base.js";

const PAGE = 1000;
const ts = (v) => (v ? Date.parse(v) : 0);
const toCand = (r) => ({ id: r.id, nom: r.nom, couleur: r.couleur, alias: r.alias || [], by: r.cree_par, at: ts(r.cree_le) });
const toPanel = (r) => ({ id: r.id, lat: r.lat, lng: r.lng, lieu: r.lieu || "", commune: r.commune || "",
  source: r.source, by: r.cree_par, at: ts(r.cree_le) });
const DEM_COLS = "id,nom,parti,source_url,couleur,statut,motif,nb_soutiens,cree_le,traite_le";
const toStatut = (r) => ({ id: r.id, p: r.panneau_id, c: r.candidat_id, ok: r.present, by: r.auteur, at: ts(r.cree_le), v: !!r.verifie });
const PHOTO_COLS = "id,panneau_id,candidat_id,chemin,source,texte_lu,score,statut,votes_oui,votes_non,votes_illisible,cree_le";

export class SupabaseStore extends BaseStore {
  constructor(url, key) {
    super();
    this.kind = "supabase";
    this.isDemo = false;
    this.canWrite = true;
    this.canRequest = true;
    this.canPhoto = true;     // vérification des affiches par photo   // les joueurs proposent des candidats, les administrateurs les créent
    this.isAdmin = false;
    this.email = null;
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async init() {
    const { data } = await this.sb.auth.getSession();
    await this._session(data.session);
    // retour d'un lien de connexion reçu par e-mail, ou e-mail confirmé
    this.sb.auth.onAuthStateChange((ev, session) => {
      if (session?.user?.id !== this.me || (session?.user?.email || null) !== this.email) {
        setTimeout(() => this._session(session).then(() => this.changed()), 0);
      }
    });
    await this._loadAll();
    this._listen();
  }

  async _session(session) {
    this.me = session?.user?.id || null;
    this.email = session?.user?.email || null;
    this.pseudo = null; this.isAdmin = false;
    if (!this.me) return;
    const [{ data: prof }, { data: adm }] = await Promise.all([
      this.sb.from("profils").select("pseudo").eq("id", this.me).maybeSingle(),
      this.sb.from("admins").select("user_id").eq("user_id", this.me).maybeSingle(),
    ]);
    this.pseudo = prof?.pseudo || null;
    this.isAdmin = !!adm;
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
      this._all("candidats", "id,nom,couleur,alias,cree_par,cree_le", toCand),
      this._all("panneaux", "id,lat,lng,lieu,commune,source,cree_par,cree_le", toPanel),
      this._all("statut_actuel", "id,panneau_id,candidat_id,present,auteur,cree_le,verifie", toStatut),
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

  async addCandidat({ nom, couleur, parti }) {
    const { data, error } = await this.sb.from("candidats").insert({ nom, couleur, parti: parti || null }).select().single();
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

  /* ---------- demandes d'ajout de candidat ---------- */
  /** Demandes en attente, plus celles que j'ai soutenues (pour voir leur réponse). */
  async demandes() {
    const [{ data, error }, mine] = await Promise.all([
      this.sb.from("demandes_candidat").select(DEM_COLS).order("cree_le", { ascending: false }).limit(300),
      this.me ? this.sb.from("soutiens_demande").select("demande_id") : { data: [] },
    ]);
    if (error) throw error;
    const set = new Set((mine.data || []).map((r) => r.demande_id));
    return data.map((r) => ({ ...r, soutenu: set.has(r.id) }))
      .filter((r) => r.statut === "en_attente" || r.soutenu)
      .sort((a, b) => (b.statut === "en_attente") - (a.statut === "en_attente")
        || b.nb_soutiens - a.nb_soutiens || Date.parse(b.traite_le || b.cree_le) - Date.parse(a.traite_le || a.cree_le));
  }
  /** Renvoie "ok", ou "doublon" si une demande du même nom attend déjà. */
  async demanderCandidat({ nom, parti, source_url, couleur }) {
    const { error } = await this.sb.from("demandes_candidat")
      .insert({ nom, parti: parti || null, source_url: source_url || null, couleur: couleur || null });
    if (error?.code === "23505") return "doublon";
    if (error) throw error;
    return "ok";
  }
  async soutenir(id) {
    const { error } = await this.sb.from("soutiens_demande").insert({ demande_id: id });
    if (error && error.code !== "23505") throw error;
  }
  async accepterDemande(d, couleur) {
    const id = this.cands.find((c) => c.nom.toLowerCase() === d.nom.toLowerCase())?.id
      || await this.addCandidat({ nom: d.nom, couleur, parti: d.parti });
    const { error } = await this.sb.from("demandes_candidat")
      .update({ statut: "acceptee", traite_le: new Date().toISOString() }).eq("id", d.id);
    if (error) throw error;
    return id;
  }
  async refuserDemande(id, motif) {
    const { error } = await this.sb.from("demandes_candidat")
      .update({ statut: "refusee", motif: motif || null, traite_le: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }

  /* ---------- compte par e-mail (pour garder son compte sur plusieurs appareils) ---------- */
  /** Compte anonyme : rattache l'adresse (lien de confirmation). Sinon : envoie un lien de connexion. */
  async lienEmail(email) {
    const emailRedirectTo = location.origin + location.pathname;
    const { data } = await this.sb.auth.getSession();
    if (data.session?.user?.is_anonymous) {
      const { error } = await this.sb.auth.updateUser({ email }, { emailRedirectTo });
      if (!error) return "rattache";
      // adresse déjà rattachée à un autre compte : on se connecte à ce compte au lieu de la lier ici
      if (error.code !== "email_exists" && !/already (been )?registered|already exists/i.test(error.message || "")) throw error;
    }
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
    if (error) throw error;
    return "connexion";
  }

  /* ---------- vérification par photo ---------- */
  /**
   * Envoie la photo puis l'enregistre ; la base décide du statut (vérifiée, à valider, non vérifiée)
   * et met à jour le relevé du jour. Renvoie {id, statut}.
   */
  async envoyerPhoto({ panneauId, candidatId, blob, source, distance, precision, texte, score }) {
    const chemin = `${this.me}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await this.sb.storage.from("photos").upload(chemin, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await this.sb.from("photos").insert({
      panneau_id: panneauId, candidat_id: candidatId, chemin, source,
      distance_m: distance == null ? null : Math.round(distance),
      precision_m: precision == null ? null : Math.round(precision),
      texte_lu: (texte || "").slice(0, 2000), score,
    }).select("id,statut").single();
    if (error) throw error;
    this._retenirPhoto(data.id);
    await this._rechargerStatut(panneauId, candidatId);
    return data;
  }
  async _rechargerStatut(pid, cid) {
    const { data } = await this.sb.from("statut_actuel").select("id,panneau_id,candidat_id,present,auteur,cree_le,verifie")
      .eq("panneau_id", pid).eq("candidat_id", cid).maybeSingle();
    if (data) { this.putStatut(toStatut(data)); this.changed(); }
  }
  /** Photos en attente de validation, sans celles où j'ai déjà voté. Avec une adresse d'image temporaire. */
  async photosAValider(limit = 6) {
    if (!this.me) return [];
    const [{ data, error }, { data: mesVotes }] = await Promise.all([
      this.sb.from("photos").select(PHOTO_COLS).eq("statut", "a_valider").order("cree_le", { ascending: true }).limit(40),
      this.sb.from("votes_photo").select("photo_id"),
    ]);
    if (error) throw error;
    const vus = new Set((mesVotes || []).map((v) => v.photo_id));
    const mine = this._mesPhotos();
    const list = data.filter((p) => !vus.has(p.id) && !mine.has(p.id)).slice(0, limit);
    if (!list.length) return [];
    const { data: urls } = await this.sb.storage.from("photos").createSignedUrls(list.map((p) => p.chemin), 3600);
    const byPath = new Map((urls || []).map((u) => [u.path, u.signedUrl]));
    return list.map((p) => ({ ...p, url: byPath.get(p.chemin) || null }));
  }
  _mesPhotos() {
    // l'auteur des photos est caché : on se souvient localement des siennes pour ne pas se les proposer
    try { return new Set(JSON.parse(localStorage.getItem("gdp-mes-photos") || "[]")); } catch { return new Set(); }
  }
  _retenirPhoto(id) {
    try { const s = [...this._mesPhotos(), id].slice(-200); localStorage.setItem("gdp-mes-photos", JSON.stringify(s)); } catch {}
  }
  async voter(photoId, vote) {
    const { error } = await this.sb.from("votes_photo").insert({ photo_id: photoId, vote });
    if (error && error.code !== "23505") throw error;
  }
}
