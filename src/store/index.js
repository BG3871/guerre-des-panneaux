import { LocalStore } from "./local.js";

/** Carte partagée si Supabase est configuré, sinon mode local dans le navigateur. */
export async function openStore() {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    const { SupabaseStore } = await import("./supabase.js");
    const s = new SupabaseStore(url, key);
    await s.init();
    return s;
  }
  const s = new LocalStore();
  await s.init();
  return s;
}
