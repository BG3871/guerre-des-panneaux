import { defineConfig } from "vite";

// base relative : le site fonctionne aussi bien à la racine d'un domaine
// que sous https://<compte>.github.io/guerre-des-panneaux/
export default defineConfig({
  base: "./",
  test: { environment: "node" },
});
