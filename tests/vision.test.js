import { describe, it, expect } from "vitest";
import { empreinteReference, chargerReference, chercherAffiches, redimensionner, scoreVisuel } from "../src/vision.js";

// Images de test fabriquées (aucune vraie affiche dans le dépôt) : des « affiches » faites de
// rectangles de couleurs au hasard, posées sur un fond bruité.
function hasard(graine) {
  let s = graine >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function affiche(graine, w = 360, h = 500) {
  const r = hasard(graine), d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let k = 0; k < 90; k++) {
    const x0 = Math.floor(r() * w), y0 = Math.floor(r() * h), bw = 6 + Math.floor(r() * 60), bh = 6 + Math.floor(r() * 60);
    const c = [r() * 255, r() * 255, r() * 255];
    for (let y = y0; y < Math.min(h, y0 + bh); y++) for (let x = x0; x < Math.min(w, x0 + bw); x++) d.set(c, (y * w + x) * 4);
  }
  return { width: w, height: h, data: d };
}
function scene(poster, W = 900, H = 700, x0 = 300, y0 = 120, ph = 420, graine = 9) {
  const r = hasard(graine), d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { const g = 90 + r() * 60; d.set([g, g, g, 255], i * 4); }
  if (poster) {
    const p = redimensionner(poster, Math.round((ph * poster.width) / poster.height), ph);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const o = (y * p.width + x) * 4, k = ((y + y0) * W + x + x0) * 4;
      // un peu plus sombre : éclairage différent de l'original
      d.set([p.data[o] * 0.8, p.data[o + 1] * 0.8, p.data[o + 2] * 0.8, 255], k);
    }
  }
  return { width: W, height: H, data: d };
}

describe("reconnaissance visuelle des affiches", () => {
  const A = affiche(1), B = affiche(2);
  const refs = [
    { id: "A", ref: chargerReference(JSON.parse(JSON.stringify(empreinteReference(A)))) },
    { id: "B", ref: chargerReference(empreinteReference(B)) },
  ];
  it("retrouve l'affiche posée sur le panneau, plus petite et plus sombre", () => {
    const r = chercherAffiches(scene(A), refs);
    expect(r[0].id).toBe("A");
    expect(r[0].score).toBeGreaterThanOrEqual(0.8);
    expect(r.find((x) => x.id === "B").score).toBe(0);
  });
  it("ne voit rien sur un panneau sans ces affiches", () => {
    const r = chercherAffiches(scene(affiche(3)), refs);
    expect(r.every((x) => x.score === 0)).toBe(true);
  });
  it("convertit les points cohérents en score", () => {
    expect(scoreVisuel(5)).toBe(0);
    expect(scoreVisuel(10)).toBe(0.5);
    expect(scoreVisuel(20)).toBe(0.8);
    expect(scoreVisuel(200)).toBe(0.95);
  });
});
