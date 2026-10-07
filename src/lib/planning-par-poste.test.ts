import { describe, it, expect } from "vitest";
import { attribuerRangees, classerCandidat, type Occupant, type SituationCandidat } from "./planning-par-poste";

const o = (pid: string, numero: string | null = null): Occupant => ({ pid, numero });
const jours = (r: { jours: (string | null)[] }) => r.jours;

describe("attribuerRangees", () => {
  it("crée autant de rangées que l'effectif, vides si personne", () => {
    const r = attribuerRangees({ effectif: 2, numeros: [], attente: false }, [[], []], 2);
    expect(r).toHaveLength(2);
    expect(r.every((x) => !x.sur && x.jours.every((j) => j === null))).toBe(true);
  });

  it("garde une personne sur la même rangée d'un jour à l'autre", () => {
    // B arrive le 2e jour avant A dans l'ordre : A doit rester sur sa rangée.
    const r = attribuerRangees({ effectif: 2, numeros: [], attente: false }, [[o("A"), o("B")], [o("B"), o("A")]], 2);
    expect(jours(r[0])).toEqual(["A", "A"]);
    expect(jours(r[1])).toEqual(["B", "B"]);
  });

  it("reprend la rangée après un jour d'absence", () => {
    const r = attribuerRangees({ effectif: 2, numeros: [], attente: false }, [[o("A"), o("B")], [o("B")], [o("B"), o("A")]], 3);
    expect(jours(r[0])).toEqual(["A", null, "A"]);
    expect(jours(r[1])).toEqual(["B", "B", "B"]);
  });

  it("place selon le numéro de rotation", () => {
    const r = attribuerRangees({ effectif: 2, numeros: ["12", "13"], attente: false }, [[o("A", "13"), o("B", "12")]], 1);
    expect(r[0]).toMatchObject({ numero: "12", jours: ["B"] });
    expect(r[1]).toMatchObject({ numero: "13", jours: ["A"] });
  });

  it("ajoute des rangées de surnombre au-delà de l'effectif", () => {
    const r = attribuerRangees({ effectif: 1, numeros: [], attente: false }, [[o("A"), o("B"), o("C")]], 1);
    expect(r.map((x) => x.sur)).toEqual([false, true, true]);
    expect(r.map((x) => x.jours[0])).toEqual(["A", "B", "C"]);
  });

  it("remonte un surnombre sur une place requise restée vide", () => {
    const r = attribuerRangees({ effectif: 1, numeros: [], attente: false }, [[o("A"), o("B")], [o("B")]], 2);
    expect(jours(r[0])).toEqual(["A", "B"]);
    expect(jours(r[1])).toEqual(["B", null]);
  });

  it("zone d'attente : aucune place requise, une rangée par personne", () => {
    const r = attribuerRangees({ effectif: 3, numeros: [], attente: true }, [[o("A"), o("B")], [o("B")]], 2);
    expect(r.every((x) => x.sur)).toBe(true);
    expect(jours(r[0])).toEqual(["A", null]);
    expect(jours(r[1])).toEqual(["B", "B"]);
  });

  it("effectif 0 (tourne à 0) : tout le monde en surnombre", () => {
    const r = attribuerRangees({ effectif: 0, numeros: [], attente: false }, [[o("A")]], 1);
    expect(r).toEqual([{ sur: true, numero: null, jours: ["A"] }]);
  });
});

describe("classerCandidat", () => {
  const base: SituationCandidat = {
    editable: true, indispo: null, posteOccupe: null, posteOccupeAttente: false, posteOccupeNom: "",
    niveau: 3, niveauMin: 2, habManquantes: [],
  };
  it("disponible et compétent", () => {
    expect(classerCandidat("P", base)).toEqual({ groupe: "competent", raison: "" });
  });
  it("hors périmètre du chef d'équipe : jamais proposé", () => {
    expect(classerCandidat("P", { ...base, editable: false }).groupe).toBe("exclu");
  });
  it("absent, TP, hors effectif ou autre quart : jamais proposé, avec la raison", () => {
    expect(classerCandidat("P", { ...base, indispo: "absent (CP)" })).toEqual({ groupe: "exclu", raison: "absent (CP)" });
  });
  it("déjà sur ce poste : non proposé", () => {
    expect(classerCandidat("P", { ...base, posteOccupe: "P" }).groupe).toBe("exclu");
  });
  it("en zone d'attente : groupe en tête, même sans le niveau", () => {
    expect(classerCandidat("P", { ...base, posteOccupe: "CDT", posteOccupeAttente: true, niveau: 0 }))
      .toEqual({ groupe: "attente", raison: "niveau insuffisant" });
  });
  it("placé sur un autre poste du quart : à déplacer", () => {
    expect(classerCandidat("P", { ...base, posteOccupe: "Q", posteOccupeNom: "OP L1" }))
      .toEqual({ groupe: "deplacer", raison: "sur OP L1" });
  });
  it("habilitation manquante avant niveau insuffisant", () => {
    expect(classerCandidat("P", { ...base, habManquantes: ["CACES 3"], niveau: 0 }))
      .toEqual({ groupe: "habilitation", raison: "sans CACES 3" });
  });
  it("niveau insuffisant ou restriction", () => {
    expect(classerCandidat("P", { ...base, niveau: 1 }).raison).toBe("niveau insuffisant");
    expect(classerCandidat("P", { ...base, niveau: -1 }).raison).toBe("restriction");
  });
});
