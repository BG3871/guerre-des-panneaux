// Génère les icônes PNG de l'appli à partir de assets/icone.svg (Chromium via Playwright).
// Usage : node scripts/icones.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const lire = (f) => readFileSync(new URL("../assets/" + f, import.meta.url), "utf8");
const icone = lire("icone.svg"), avant = lire("icone-avant.svg");
const fond = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#18213a"/></svg>';
// écran de lancement : l'icône au centre, sur le fond de l'appli
const ecranAccueil = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#18213a"/>`
  + `<g transform="translate(1066 1066) scale(1.171875)">${avant.replace(/^<svg[^>]*>|<\/svg>\s*$/g, "")}</g></svg>`;
// [fichier, taille, svg] — les trois derniers servent à « npx @capacitor/assets generate » (icônes Android)
const sorties = [
  ["public/icons/icone-192.png", 192, icone],
  ["public/icons/icone-512.png", 512, icone],
  ["public/icons/apple-touch-icon.png", 180, icone],
  ["assets/icon-only.png", 1024, icone],
  ["assets/icon-foreground.png", 1024, avant],
  ["assets/icon-background.png", 1024, fond],
  ["assets/splash.png", 2732, ecranAccueil],
  ["assets/splash-dark.png", 2732, ecranAccueil],
];
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
for (const [fichier, t, svg] of sorties) {
  const page = await browser.newPage({ viewport: { width: t, height: t }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${t}px;height:${t}px}</style>${svg}`);
  await page.screenshot({ path: fichier, omitBackground: true });
  await page.close();
  console.log(fichier, t);
}
await browser.close();
