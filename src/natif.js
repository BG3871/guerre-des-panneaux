// Ce qui change quand le site tourne dans l'appli Android/iOS (Capacitor)
// plutôt que dans un navigateur.
import { Capacitor } from "@capacitor/core";

export const NATIF = Capacitor.isNativePlatform();

/** Adresse de retour des liens de connexion reçus par e-mail, ouverte par l'appli. */
export const RETOUR_APPLI = "guerredespanneaux://connexion";

/** Adresse publique du site, pour les liens à partager. */
export const SITE = "https://bg3871.github.io/guerre-des-panneaux/";

/** Où renvoyer le joueur après un clic sur le lien reçu par e-mail. */
export function adresseRetour() {
  return NATIF ? RETOUR_APPLI : location.origin + location.pathname;
}

/**
 * Lien de connexion ouvert depuis l'e-mail : le téléphone le confie à l'appli
 * (guerredespanneaux://connexion#access_token=…&refresh_token=…), on ouvre la session.
 */
export async function ecouterLiensConnexion(sb, onErreur) {
  if (!NATIF) return;
  const { App } = await import("@capacitor/app");
  const traiter = async (url) => {
    if (!url || !url.startsWith(RETOUR_APPLI)) return;
    const u = new URL(url.replace(/^guerredespanneaux:/, "https:"));
    const p = new URLSearchParams(u.hash.slice(1) || u.search.slice(1));
    if (p.get("error_description")) { onErreur?.(p.get("error_description")); return; }
    const code = new URLSearchParams(u.search.slice(1)).get("code");
    try {
      if (p.get("access_token") && p.get("refresh_token")) {
        const { error } = await sb.auth.setSession({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token") });
        if (error) throw error;
      } else if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) throw error;
      }
    } catch (e) { onErreur?.(e?.message || String(e)); }
  };
  App.addListener("appUrlOpen", (ev) => traiter(ev.url));
  // appli lancée directement par le lien (elle était fermée)
  const lancement = await App.getLaunchUrl().catch(() => null);
  if (lancement?.url) traiter(lancement.url);
}

/** Service worker : site installable et coquille disponible hors ligne (navigateur seulement). */
export function enregistrerServiceWorker() {
  if (NATIF || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("service worker", e));
  });
}
