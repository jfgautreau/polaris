import { describe, it, expect } from "vitest";
import { validerMiseEnPage, ordonnerPostes, dispositionDepart, feuille, pdfDuMode, GRILLE } from "./mise-en-page-pdf";

const LIGNES = new Map([
  ["l1", new Set(["p1", "p2", "p3"])],
  ["l2", new Set(["p4"])],
]);

describe("mise en page des PDF de placement", () => {
  it("valide et nettoie : ordre des postes borné à la ligne", () => {
    const r = validerMiseEnPage(
      { format: "A3", orientation: "paysage", blocs: [{ type: "ligne", ligne_id: "l1", x: 0, y: 1, w: 6, h: 3, postes: ["p3", "p9", "p1", "p3"] }, { type: "entete", x: 0, y: 0, w: 12, h: 1 }] },
      LIGNES,
    );
    expect(r.ok && r.valeur.blocs[0]).toEqual({ type: "ligne", ligne_id: "l1", x: 0, y: 1, w: 6, h: 3, postes: ["p3", "p1"] });
  });
  it("refuse un bloc hors grille, une ligne d'un autre service, un doublon", () => {
    const base = { format: "A4", orientation: "portrait" };
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "entete", x: 6, y: 0, w: 7, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "ligne", ligne_id: "zz", x: 0, y: 0, w: 1, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "legende", x: 0, y: 0, w: 1, h: 1 }, { type: "legende", x: 1, y: 0, w: 1, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ format: "A5", orientation: "portrait", blocs: [] }, LIGNES).ok).toBe(false);
  });
  it("postes : ordre choisi d'abord, les nouveaux à la suite", () => {
    const p = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(ordonnerPostes(p, ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(ordonnerPostes(p, undefined).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("disposition de départ dans la grille", () => {
    const b = dispositionDepart(["l1", "l2", "l3"]);
    expect(b.every((x) => x.x + x.w <= GRILLE && x.y + x.h <= GRILLE)).toBe(true);
    expect(b.filter((x) => x.type === "ligne")).toHaveLength(3);
  });
  it("feuille et mode", () => {
    expect(feuille("A3", "portrait").classe).toBe("print-a3p");
    expect(feuille("A4", "paysage").classe).toBeNull();
    expect(pdfDuMode("heures")).toBe("affich_heures");
  });
});
