import { describe, it, expect } from "vitest";
import {
  MaxFlow,
  buildJourFlow,
  aggregerSemaine,
  type BesoinPoste,
  type PersonneDispo,
} from "./projection-capacite";

// Raccourci : un besoin (poste, quart) avec effectif requis.
const bes = (posteId: string, quart: string, eff: number, gabarit = false): BesoinPoste => ({
  cle: `${posteId}:${quart}`,
  posteId,
  quart,
  effectifRequis: eff,
  gabarit,
});
// Raccourci : une personne et les cles qu'elle peut tenir.
const pers = (id: string, ...cles: string[]): PersonneDispo => ({ id, peutTenir: cles });

describe("MaxFlow", () => {
  it("achemine le flot maximum sur un petit reseau", () => {
    // source(0) -> a(1) cap 3 ; a -> puits(2) cap 2  => flot 2.
    const mf = new MaxFlow(3);
    mf.addEdge(0, 1, 3);
    mf.addEdge(1, 2, 2);
    expect(mf.maxflow(0, 2)).toBe(2);
    expect(mf.residualToSink(1, 2)).toBe(0); // arc sature
  });

  it("laisse une capacite residuelle quand l'arc n'est pas sature", () => {
    const mf = new MaxFlow(3);
    mf.addEdge(0, 1, 1);
    mf.addEdge(1, 2, 5);
    expect(mf.maxflow(0, 2)).toBe(1);
    expect(mf.residualToSink(1, 2)).toBe(4); // 5 requis - 1 achemine
  });
});

describe("buildJourFlow — dedoublonnage (le probleme central)", () => {
  it("une personne polyvalente sur 5 postes ne compte que pour UNE place", () => {
    // Un seul agent, habilite sur 5 postes distincts, chacun a besoin de 1.
    const besoins = ["p1", "p2", "p3", "p4", "p5"].map((p) => bes(p, "matin", 1));
    const p = pers("solo", ...besoins.map((b) => b.cle));
    const r = buildJourFlow([p], besoins);
    expect(r.besoin).toBe(5);
    expect(r.couvrable).toBe(1); // et surtout PAS 5
    expect(r.ruptures.map((x) => x.manque).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("couvre tout quand chaque poste a son titulaire dedie", () => {
    const besoins = ["p1", "p2", "p3"].map((p) => bes(p, "matin", 1));
    const gens = [pers("a", "p1:matin"), pers("b", "p2:matin"), pers("c", "p3:matin")];
    const r = buildJourFlow(gens, besoins);
    expect(r.couvrable).toBe(3);
    expect(r.ruptures).toEqual([]);
  });

  it("affecte au mieux : 2 polyvalents sur 2 postes => 2 couverts", () => {
    const besoins = [bes("p1", "matin", 1), bes("p2", "matin", 1)];
    const gens = [pers("a", "p1:matin", "p2:matin"), pers("b", "p1:matin", "p2:matin")];
    const r = buildJourFlow(gens, besoins);
    expect(r.couvrable).toBe(2);
    expect(r.ruptures).toEqual([]);
  });

  it("respecte l'effectif requis > 1 et localise la rupture", () => {
    // Poste p1 a besoin de 3 conducteurs, seuls 2 sont habilites.
    const besoins = [bes("p1", "matin", 3)];
    const gens = [pers("a", "p1:matin"), pers("b", "p1:matin")];
    const r = buildJourFlow(gens, besoins);
    expect(r.besoin).toBe(3);
    expect(r.couvrable).toBe(2);
    expect(r.ruptures).toEqual([{ cle: "p1:matin", posteId: "p1", quart: "matin", manque: 1 }]);
  });

  it("un agent doit choisir entre deux quarts : une seule place par jour", () => {
    // p1 au matin ET p2 la nuit, un seul agent habilite sur les deux : il ne
    // peut servir qu'un des deux le meme jour.
    const besoins = [bes("p1", "matin", 1), bes("p2", "nuit", 1)];
    const r = buildJourFlow([pers("a", "p1:matin", "p2:nuit")], besoins);
    expect(r.couvrable).toBe(1);
    expect(r.ruptures).toHaveLength(1);
  });

  it("besoin nul => aucun calcul", () => {
    expect(buildJourFlow([pers("a", "p1:matin")], [])).toEqual({
      besoin: 0,
      couvrable: 0,
      ruptures: [],
    });
  });

  it("une personne sans aucune habilitation servable ne couvre rien", () => {
    // La qualification datee (habilitation expiree) est appliquee EN AMONT par
    // l'appelant : ici l'agent arrive avec peutTenir vide.
    const besoins = [bes("p1", "matin", 1)];
    const r = buildJourFlow([pers("expire")], besoins);
    expect(r.couvrable).toBe(0);
    expect(r.ruptures).toEqual([{ cle: "p1:matin", posteId: "p1", quart: "matin", manque: 1 }]);
  });
});

describe("aggregerSemaine", () => {
  it("somme les jours et calcule le taux", () => {
    const j1 = buildJourFlow([pers("a", "p1:matin")], [bes("p1", "matin", 1)]); // 1/1
    const j2 = buildJourFlow([pers("a", "p1:matin")], [bes("p1", "matin", 2)]); // 1/2
    const s = aggregerSemaine("2026-09-07", [j1, j2], false);
    expect(s.besoin).toBe(3);
    expect(s.couvrable).toBe(2);
    expect(s.taux).toBeCloseTo(2 / 3);
    expect(s.postesEnRupture).toEqual(["p1:matin"]); // union, sans doublon
    expect(s.gabarit).toBe(false);
  });

  it("taux = 1 sur une semaine sans besoin (usine fermee)", () => {
    const s = aggregerSemaine("2026-09-07", [], false);
    expect(s.taux).toBe(1);
    expect(s.postesEnRupture).toEqual([]);
  });

  it("marque la semaine comme gabarit quand elle repose sur la semaine-type", () => {
    const s = aggregerSemaine("2026-12-07", [], true);
    expect(s.gabarit).toBe(true);
  });
});
