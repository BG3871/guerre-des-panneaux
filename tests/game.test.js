import { describe, it, expect } from "vitest";
import {
  project, unproject, hexKey, hexPolygon, hexSize, sectors, shares, leader, territories,
  coverage, playerPoints, parseCoord, nearby, distance,
} from "../src/game.js";

const st = (rows) => {
  const m = new Map();
  for (const [p, c, ok] of rows) { if (!m.has(p)) m.set(p, new Map()); m.get(p).set(c, { ok, at: 1, by: "x" }); }
  return m;
};
const A = { id: "a", nom: "A", couleur: "#000001" }, B = { id: "b", nom: "B", couleur: "#000002" };

describe("projection", () => {
  it("aller-retour Mercator", () => {
    const p = project(48.8566, 2.3522), u = unproject(p.x, p.y);
    expect(u.lat).toBeCloseTo(48.8566, 8); expect(u.lng).toBeCloseTo(2.3522, 8);
  });
});

describe("secteurs", () => {
  it("taille selon le zoom", () => {
    expect(hexSize(5)).toBe(60000); expect(hexSize(8)).toBe(15000); expect(hexSize(11)).toBe(4000);
    expect(hexSize(13)).toBe(1000); expect(hexSize(17)).toBe(250);
  });
  it("un point est dans l'hexagone de son secteur", () => {
    for (const s of [250, 1000, 60000]) {
      const k = hexKey(45.1885, 5.7245, s), poly = hexPolygon(k, s);
      const lats = poly.map((p) => p[0]), lngs = poly.map((p) => p[1]);
      expect(45.1885).toBeGreaterThan(Math.min(...lats)); expect(45.1885).toBeLessThan(Math.max(...lats));
      expect(5.7245).toBeGreaterThan(Math.min(...lngs)); expect(5.7245).toBeLessThan(Math.max(...lngs));
    }
  });
  it("deux panneaux voisins partagent le secteur, deux villes non", () => {
    const g = sectors([{ id: 1, lat: 48.8566, lng: 2.3522 }, { id: 2, lat: 48.8567, lng: 2.3523 }, { id: 3, lat: 45.764, lng: 4.8357 }], 1000);
    expect(g.size).toBe(2);
  });
});

describe("conquête", () => {
  const panels = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  it("50 % des panneaux suffit pour conquérir", () => {
    const s = st([[1, "a", true], [2, "a", true], [3, "a", false]]);
    const sh = shares(panels, [A, B], s);
    expect(sh.a).toBe(0.5);
    expect(territories(new Map([["k", panels]]), [A, B], s)).toEqual({ a: 1, b: 0 });
    expect(leader(sh, [A, B]).cand).toBe(A);
  });
  it("sous 50 % ou en cas d'égalité, personne ne tient le secteur en Bataille", () => {
    expect(leader(shares(panels, [A, B], st([[1, "a", true]])), [A, B])).toBeNull();
    const tie = st([[1, "a", true], [2, "a", true], [3, "b", true], [4, "b", true]]);
    expect(leader(shares(panels, [A, B], tie), [A, B])).toBeNull();
  });
  it("couverture", () => {
    expect(coverage(panels, st([[1, "a", true], [2, "a", false]]), "a")).toEqual({ ok: 1, no: 1, unknown: 2, total: 4 });
  });
});

describe("points", () => {
  it("1 par relevé, 3 par panneau signalé, rien pour les panneaux importés", () => {
    const pts = playerPoints([{ by: "u1" }, { by: null }], [{ by: "u1" }, { by: "u2" }, { by: "u2" }]);
    expect(pts.get("u1")).toBe(4); expect(pts.get("u2")).toBe(2); expect(pts.size).toBe(2);
  });
});

describe("coordonnées collées", () => {
  it.each([
    ["48.85661, 2.35222", [48.85661, 2.35222]],
    ["48,85661 2,35222", [48.85661, 2.35222]],
    ["geo:45.1885,5.7245", [45.1885, 5.7245]],
    ["41.9192;8.7386", [41.9192, 8.7386]],
  ])("%s", (s, want) => expect(parseCoord(s)).toEqual(want));
  it("refuse hors de France", () => { expect(parseCoord("40.7, -74.0")).toBeNull(); expect(parseCoord("bonjour")).toBeNull(); });
});

describe("doublons", () => {
  it("distance et panneau proche", () => {
    expect(distance([48.8566, 2.3522], [48.8567, 2.3522])).toBeCloseTo(11.1, 0);
    const ps = [{ id: "x", lat: 48.8566, lng: 2.3522 }];
    expect(nearby(ps, [48.85665, 2.3522])?.id).toBe("x");
    expect(nearby(ps, [48.858, 2.3522])).toBeNull();
  });
});
