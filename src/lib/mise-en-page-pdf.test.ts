import { describe, it, expect } from "vitest";
import { validerMiseEnPage, placerPostes, hauteursDisponibles, caseLibre, dispositionDepart, feuille, pdfDuMode, GRILLE } from "./mise-en-page-pdf";

const LIGNES = new Map([
  ["l1", new Set(["p1", "p2", "p3"])],
  ["l2", new Set(["p4"])],
]);
const base = { format: "A3", orientation: "paysage" };

describe("mise en page des PDF de placement", () => {
  it("valide un cadre de ligne et ses postes ; ignore un poste retiré de la ligne", () => {
    const r = validerMiseEnPage(
      { ...base, blocs: [{ type: "ligne", ligne_id: "l1", x: 0, y: 1, w: 6, h: 3, places: [{ poste_id: "p3", x: 0, y: 0, w: 1, h: 1 }, { poste_id: "p9", x: 2, y: 0, w: 1, h: 1 }, { poste_id: "p1", x: 3, y: 1, w: 2, h: 2 }] }] },
      LIGNES,
    );
    expect(r.ok && r.valeur.blocs[0].places).toEqual([{ poste_id: "p3", x: 0, y: 0, w: 1, h: 1 }, { poste_id: "p1", x: 3, y: 1, w: 2, h: 2 }]);
  });
  it("refuse : bloc hors grille, poste hors cadre, chevauchement, ligne d'un autre service, doublon", () => {
    const ligne = (places: unknown[]) => ({ ...base, blocs: [{ type: "ligne", ligne_id: "l1", x: 0, y: 0, w: 3, h: 2, places }] });
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "entete", x: 9, y: 0, w: 7, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage(ligne([{ poste_id: "p1", x: 2, y: 0, w: 2, h: 1 }]), LIGNES).ok).toBe(false);
    expect(validerMiseEnPage(ligne([{ poste_id: "p1", x: 0, y: 0, w: 2, h: 1 }, { poste_id: "p2", x: 1, y: 0, w: 1, h: 1 }]), LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "ligne", ligne_id: "zz", x: 0, y: 0, w: 1, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ ...base, blocs: [{ type: "legende", x: 0, y: 0, w: 1, h: 1 }, { type: "legende", x: 1, y: 0, w: 1, h: 1 }] }, LIGNES).ok).toBe(false);
    expect(validerMiseEnPage({ format: "A5", orientation: "portrait", blocs: [] }, LIGNES).ok).toBe(false);
  });
  it("poste sans case : 1re case libre du cadre, sinon signalé", () => {
    const r = placerPostes({ w: 2, h: 2, places: [{ poste_id: "a", x: 0, y: 0, w: 1, h: 2 }] }, ["a", "b", "c", "d"]);
    expect(r.places).toEqual([
      { poste_id: "a", x: 0, y: 0, w: 1, h: 2 },
      { poste_id: "b", x: 1, y: 0, w: 1, h: 1 },
      { poste_id: "c", x: 1, y: 1, w: 1, h: 1 },
    ]);
    expect(r.sansPlace).toEqual(["d"]);
  });
  it("un poste s'étire sur les cases vides sous lui", () => {
    const places = [
      { poste_id: "a", x: 0, y: 0, w: 1, h: 1 },
      { poste_id: "b", x: 1, y: 0, w: 1, h: 1 },
      { poste_id: "c", x: 1, y: 2, w: 1, h: 1 },
    ];
    const h = hauteursDisponibles(places, 4);
    expect(h.get("a")).toBe(4);
    expect(h.get("b")).toBe(2);
    expect(h.get("c")).toBe(2);
    expect(caseLibre(places, { w: 2, h: 4 }, { x: 1, y: 1, w: 1, h: 1 })).toBe(true);
    expect(caseLibre(places, { w: 2, h: 4 }, { x: 1, y: 1, w: 1, h: 2 })).toBe(false);
  });
  it("disposition de départ dans la grille, postes rangés", () => {
    const b = dispositionDepart([{ id: "l1", postes: ["p1", "p2"] }, { id: "l2", postes: ["p4"] }]);
    expect(b.every((x) => x.x + x.w <= GRILLE && x.y + x.h <= GRILLE)).toBe(true);
    expect(b.find((x) => x.ligne_id === "l1")?.places?.map((p) => p.poste_id)).toEqual(["p1", "p2"]);
  });
  it("feuille et mode", () => {
    expect(feuille("A3", "portrait").classe).toBe("print-a3p");
    expect(feuille("A4", "paysage").classe).toBeNull();
    expect(pdfDuMode("heures")).toBe("affich_heures");
  });
});
