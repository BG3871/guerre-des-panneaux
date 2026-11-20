import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Écrit dist/sw.js avec la liste des fichiers du build, pour que l'appli
// installée s'ouvre hors ligne et se mette à jour à chaque mise en ligne.
function serviceWorker() {
  return {
    name: "service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const fichiers = ["./", "./index.html", "./manifest.webmanifest",
        "./icons/icone-192.png", "./icons/icone-512.png",
        ...Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "index.html").map((f) => "./" + f)];
      const version = Date.now().toString(36);
      const source = readFileSync(new URL("./sw/sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version).replace("__FICHIERS__", JSON.stringify(fichiers, null, 1));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// base relative : le site fonctionne aussi bien à la racine d'un domaine
// que sous https://<compte>.github.io/guerre-des-panneaux/ et dans l'appli Android/iOS
export default defineConfig({
  base: "./",
  plugins: [serviceWorker()],
  test: { environment: "node" },
});
