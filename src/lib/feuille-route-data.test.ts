import { describe, it, expect } from "vitest";
import {
  ajouteJours,
  lundiIsoDe,
  numeroSemaineIso,
  construireSemaines,
  personneEnEffectifLundi,
  semainePleineAbsence,
  habilitationValideAu,
  maxParCategorieAuJour,
  calculerGrille,
  type Params,
} from "./feuille-route-data";

describe("dates", () => {
  it("lundiIsoDe : lundi 2026-09-07 est son propre lundi", () => {
    expect(lundiIsoDe(new Date("2026-09-07T00:00:00"))).toBe("2026-09-07");
  });
  it("lundiIsoDe : dimanche 2026-09-13 remonte au 2026-09-07", () => {
    expect(lundiIsoDe(new Date("2026-09-13T00:00:00"))).toBe("2026-09-07");
  });
  it("ajouteJours : +7 depuis 2026-09-07 = 2026-09-14", () => {
    expect(ajouteJours("2026-09-07", 7)).toBe("2026-09-14");
  });
  it("numeroSemaineIso : 2026-09-07 est S37", () => {
    expect(numeroSemaineIso("2026-09-07").num).toBe(37);
  });
  it("construireSemaines : 12 semaines strictement consécutives", () => {
    const s = construireSemaines("2026-09-07", 12);
    expect(s).toHaveLength(12);
    expect(s[0].lundi).toBe("2026-09-07");
    expect(s[11].lundi).toBe("2026-11-23");
  });
});

describe("prédicats métier", () => {
  it("personneEnEffectifLundi : contrat couvrant retourne true", () => {
    expect(personneEnEffectifLundi([{ personne_id: "p1", date_debut: "2026-01-01", date_fin: null }], "2026-09-07")).toBe(true);
  });
  it("personneEnEffectifLundi : contrat fini avant le lundi retourne false", () => {
    expect(personneEnEffectifLundi([{ personne_id: "p1", date_debut: "2026-01-01", date_fin: "2026-08-31" }], "2026-09-07")).toBe(false);
  });
  it("personneEnEffectifLundi : contrat démarrant après le lundi retourne false", () => {
    expect(personneEnEffectifLundi([{ personne_id: "p1", date_debut: "2026-09-14", date_fin: null }], "2026-09-07")).toBe(false);
  });
  it("semainePleineAbsence : 5 jours ouvrés absents = true", () => {
    const jours = new Set(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(semainePleineAbsence(jours, "2026-09-07")).toBe(true);
  });
  it("semainePleineAbsence : 4 jours seulement (jeudi manquant) = false", () => {
    const jours = new Set(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11"]);
    expect(semainePleineAbsence(jours, "2026-09-07")).toBe(false);
  });
  it("semainePleineAbsence : les weekends ne comptent pas", () => {
    // Personne absente uniquement samedi et dimanche : pas de « semaine pleine ».
    const jours = new Set(["2026-09-12", "2026-09-13"]);
    expect(semainePleineAbsence(jours, "2026-09-07")).toBe(false);
  });
  it("habilitationValideAu : pas d'expiration = toujours valide", () => {
    expect(habilitationValideAu(null, "2026-09-07")).toBe(true);
  });
  it("habilitationValideAu : expiration future = valide", () => {
    expect(habilitationValideAu("2027-01-01", "2026-09-07")).toBe(true);
  });
  it("habilitationValideAu : expiration passée = invalide", () => {
    expect(habilitationValideAu("2026-08-01", "2026-09-07")).toBe(false);
  });
});

describe("maxParCategorieAuJour", () => {
  const posteReq = new Map<string, string[]>();
  const compsPers = new Map<string, Map<string, string | null>>();

  it("MAX par catégorie : niv.1 + niv.3 sur conducteur = 3", () => {
    const idx = new Map([
      ["p1", [
        { posteId: "po-a", niveau: 1, cat: "conducteur" },
        { posteId: "po-b", niveau: 3, cat: "conducteur" },
      ]],
    ]);
    const r = maxParCategorieAuJour("p1", "2026-09-07", idx, posteReq, compsPers, false);
    expect(r.get("conducteur")).toBe(3);
  });

  it("multi-catégories : conducteur=2, opérateur=4 sont bien séparés", () => {
    const idx = new Map([
      ["p1", [
        { posteId: "po-a", niveau: 2, cat: "conducteur" },
        { posteId: "po-b", niveau: 4, cat: "operateur" },
      ]],
    ]);
    const r = maxParCategorieAuJour("p1", "2026-09-07", idx, posteReq, compsPers, false);
    expect(r.get("conducteur")).toBe(2);
    expect(r.get("operateur")).toBe(4);
  });

  it("mode strict : poste dont l'habilitation a expiré est retiré du calcul", () => {
    // p1 : niveau 3 sur po-a (habilitation « chariot » expirée),
    // niveau 1 sur po-b (aucune habilitation exigée). Max effectif = 1.
    const idx = new Map([
      ["p1", [
        { posteId: "po-a", niveau: 3, cat: "conducteur" },
        { posteId: "po-b", niveau: 1, cat: "conducteur" },
      ]],
    ]);
    const req = new Map([["po-a", ["chariot"]]]);
    const persComps = new Map([
      ["p1", new Map([["chariot", "2026-01-01"]])],
    ]);
    const r = maxParCategorieAuJour("p1", "2026-09-07", idx, req, persComps, true);
    expect(r.get("conducteur")).toBe(1);
  });

  it("mode non-strict : les expirations n'affectent pas le max", () => {
    const idx = new Map([
      ["p1", [{ posteId: "po-a", niveau: 3, cat: "conducteur" }]],
    ]);
    const req = new Map([["po-a", ["chariot"]]]);
    const persComps = new Map([["p1", new Map([["chariot", "2026-01-01"]])]]);
    const r = maxParCategorieAuJour("p1", "2026-09-07", idx, req, persComps, false);
    expect(r.get("conducteur")).toBe(3);
  });
});

describe("calculerGrille — intégration", () => {
  const base: Params = {
    personnes: [
      { id: "p1", atelier_id: "at-condi", equipe_id: "eq-a" },
      { id: "p2", atelier_id: "at-condi", equipe_id: "eq-b" },
      { id: "p3", atelier_id: "at-fab", equipe_id: "eq-a" },
    ],
    postes: [
      { id: "po-cond-1", actif: true, categorie: "conducteur", objectif_cible: 4 },
      { id: "po-cond-2", actif: true, categorie: "conducteur", objectif_cible: 3 },
      { id: "po-ope-1", actif: true, categorie: "operateur", objectif_cible: 6 },
    ],
    matrice: [
      { personne_id: "p1", poste_id: "po-cond-1", niveau_actuel: 2 },
      { personne_id: "p1", poste_id: "po-cond-2", niveau_actuel: 3 },
      { personne_id: "p2", poste_id: "po-ope-1", niveau_actuel: 1 },
      { personne_id: "p3", poste_id: "po-cond-1", niveau_actuel: 4 },
    ],
    contratsParPersonne: new Map([
      ["p1", [{ personne_id: "p1", date_debut: "2026-01-01", date_fin: null }]],
      ["p2", [{ personne_id: "p2", date_debut: "2026-01-01", date_fin: null }]],
      ["p3", [{ personne_id: "p3", date_debut: "2026-01-01", date_fin: null }]],
    ]),
    absencesParPersonne: new Map(),
    posteCompRequise: new Map(),
    competencesPersonne: new Map(),
    ateliers: [
      { id: "at-condi", nom: "Conditionnement" },
      { id: "at-fab", nom: "Fabrication" },
    ],
    semaines: construireSemaines("2026-09-07", 2),
    nbNiveaux: 4,
    seuilCompetent: 2,
    habilitationStricte: false,
  };

  it("compte p1 en Conducteurs niv.3 dans Condi (max de 2 et 3)", () => {
    const g = calculerGrille(base);
    const condi = g.services.find((s) => s.atelierId === "at-condi")!;
    const cond = condi.blocs.find((b) => b.cat === "conducteur")!;
    // niv.3 = 1 personne (p1), niv.2 = 0, niv.1 = 0 : le max prime.
    expect(cond.niveaux[2].parSemaine[0]).toBe(1); // niv.3
    expect(cond.niveaux[1].parSemaine[0]).toBe(0); // niv.2
    expect(cond.niveaux[0].parSemaine[0]).toBe(0); // niv.1
  });

  it("service = affectation : p3 (Fab) même sur poste Condi compte dans Fab", () => {
    const g = calculerGrille(base);
    const fab = g.services.find((s) => s.atelierId === "at-fab")!;
    const cond = fab.blocs.find((b) => b.cat === "conducteur")!;
    expect(cond.niveaux[3].parSemaine[0]).toBe(1); // niv.4
  });

  it("filtre équipe restreint la population", () => {
    const g = calculerGrille({ ...base, equipesFiltre: ["eq-a"] });
    const condi = g.services.find((s) => s.atelierId === "at-condi")!;
    const ope = condi.blocs.find((b) => b.cat === "operateur")!;
    // p2 est en eq-b → filtrée, donc opérateur niv.1 = 0
    expect(ope.niveaux[0].parSemaine[0]).toBe(0);
  });

  it("cible agrégée au seuil compétent", () => {
    const g = calculerGrille(base);
    const condi = g.services.find((s) => s.atelierId === "at-condi")!;
    const cond = condi.blocs.find((b) => b.cat === "conducteur")!;
    // 4 (po-cond-1) + 3 (po-cond-2) = 7, positionné au niv.2 (seuil).
    expect(cond.cible).toEqual({ niveau: 2, valeur: 7 });
  });

  it("absence pleine semaine retire la personne du décompte", () => {
    const abs = new Map([[
      "p1",
      new Set(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]),
    ]]);
    const g = calculerGrille({ ...base, absencesParPersonne: abs });
    const condi = g.services.find((s) => s.atelierId === "at-condi")!;
    const cond = condi.blocs.find((b) => b.cat === "conducteur")!;
    expect(cond.niveaux[2].parSemaine[0]).toBe(0); // S1 (p1 absente)
    expect(cond.niveaux[2].parSemaine[1]).toBe(1); // S2 (p1 revient)
  });

  it("contrat terminé → personne exclue à partir de la semaine suivante", () => {
    const contrats = new Map([
      ["p1", [{ personne_id: "p1", date_debut: "2026-01-01", date_fin: "2026-09-10" }]],
      ["p2", [{ personne_id: "p2", date_debut: "2026-01-01", date_fin: null }]],
      ["p3", [{ personne_id: "p3", date_debut: "2026-01-01", date_fin: null }]],
    ]);
    const g = calculerGrille({ ...base, contratsParPersonne: contrats });
    const condi = g.services.find((s) => s.atelierId === "at-condi")!;
    const cond = condi.blocs.find((b) => b.cat === "conducteur")!;
    expect(cond.niveaux[2].parSemaine[0]).toBe(1); // S1 encore présent (fin le 10)
    expect(cond.niveaux[2].parSemaine[1]).toBe(0); // S2 (14/09) contrat fini
  });
});
