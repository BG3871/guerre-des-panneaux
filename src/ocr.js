// Lecture du texte d'une affiche, directement dans le navigateur (Tesseract.js, modèle français).
// Le moteur et le modèle de langue (quelques Mo) ne sont chargés qu'à la première photo.
let workerP = null;

function worker() {
  if (!workerP) {
    workerP = import("tesseract.js")
      .then(async ({ createWorker }) => {
        const w = await createWorker("fra");
        // « texte épars » : une affiche n'est pas une page, les mots sont posés n'importe où
        await w.setParameters({ tessedit_pageseg_mode: "11" });
        return w;
      })
      .catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** Précharge le moteur pendant que le joueur cadre sa photo. */
export function prechargerOcr() { worker().catch(() => {}); }

/** Copie en niveaux de gris, inversée ou non (le nom est souvent en clair sur fond foncé). */
function gris(src, inverse) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    if (inverse) g = 255 - g;
    a[i] = a[i + 1] = a[i + 2] = g;
  }
  x.putImageData(d, 0, 0);
  return c;
}

/** Texte lu sur l'image (un canvas) : deux lectures, texte foncé puis texte clair, mises bout à bout. */
export async function lireAffiche(canvas) {
  const w = await worker();
  const textes = [];
  for (const inv of [false, true]) {
    const { data } = await w.recognize(gris(canvas, inv));
    textes.push((data?.text || "").replace(/\s+/g, " ").trim());
  }
  return [...new Set(textes.filter(Boolean))].join(" / ");
}
