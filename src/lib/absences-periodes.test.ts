import { describe, it, expect } from "vitest";
import { grouperAbsences, libellePeriode, ecartJours, etatDepart } from "./absences-periodes";

const j = (jour: string, motif = "cp", absence_id: string | null = null) => ({ jour, motif_absence_id: motif, absence_id });

describe("ecartJours", () => {
  it("compte les jours calendaires entre deux dates", () => {
    expect(ecartJours("2026-09-04", "2026-09-07")).toBe(3); // vendredi -> lundi
    expect(ecartJours("2026-09-04", "2026-09-05")).toBe(1);
    expect(ecartJours("2026-09-04", "2026-09-04")).toBe(0);
  });

  it("ne derive pas sur un changement d'heure", () => {
    // 29/03/2026 : passage a l'heure d'ete. Un calcul en heure locale rendrait
    // 0,958 jour et un arrondi malheureux.
    expect(ecartJours("2026-03-28", "2026-03-29")).toBe(1);
    expect(ecartJours("2026-10-24", "2026-10-25")).toBe(1);
  });
});

describe("grouperAbsences — jours consecutifs", () => {
  it("reunit des jours qui se suivent", () => {
    const p = grouperAbsences([j("2026-09-07"), j("2026-09-08"), j("2026-09-09")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: "2026-09-07", fin: "2026-09-09", jours: 3 });
  });

  it("ENJAMBE un week-end : vendredi + lundi = une seule periode", () => {
    // Choix retenu le 23/07/2026 : c'est ainsi qu'on parle d'un conge.
    const p = grouperAbsences([j("2026-09-04"), j("2026-09-07"), j("2026-09-08")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: "2026-09-04", fin: "2026-09-08", jours: 3 });
  });

  it("compte les jours POSES, pas l'ecart entre les bornes", () => {
    // 3 jours poses sur une plage de 5 jours calendaires.
    expect(grouperAbsences([j("2026-09-04"), j("2026-09-07"), j("2026-09-08")])[0].jours).toBe(3);
  });

  it("coupe quand l'ecart depasse la tolerance", () => {
    // Une semaine de travail entiere separe les deux : ce sont deux absences.
    const p = grouperAbsences([j("2026-09-01"), j("2026-09-10")]);
    expect(p).toHaveLength(2);
  });

  it("ne reunit JAMAIS deux motifs differents, meme consecutifs", () => {
    const p = grouperAbsences([j("2026-09-07", "cp"), j("2026-09-08", "am")]);
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.motif_absence_id)).toEqual(["am", "cp"]); // plus recent d'abord
  });

  it("classe du plus recent au plus ancien", () => {
    const p = grouperAbsences([j("2026-07-11"), j("2026-09-04"), j("2026-08-18")]);
    expect(p.map((x) => x.debut)).toEqual(["2026-09-04", "2026-08-18", "2026-07-11"]);
  });

  it("rend une periode d'un seul jour", () => {
    const p = grouperAbsences([j("2026-07-11")]);
    expect(p[0]).toMatchObject({ debut: "2026-07-11", fin: "2026-07-11", jours: 1 });
  });

  it("marque `declaree` des qu'un jour vient d'une periode declaree", () => {
    const p = grouperAbsences([j("2026-09-07", "cp", "abs-1"), j("2026-09-08", "cp")]);
    expect(p[0].declaree).toBe(true);
    expect(grouperAbsences([j("2026-09-07")])[0].declaree).toBe(false);
  });

  it("ne fusionne pas deux periodes DECLAREES distinctes, meme contigues", () => {
    // Bug reel : deux arrets maladie saisis separement (01-10 puis 11-30) etaient
    // affiches comme une seule periode 01-30 (detail perdu, absence_id null donc
    // reduction impossible). On garde deux lignes editables.
    const jours = [
      ...["01", "02", "03"].map((d) => j(`2026-07-${d}`, "maladie", "abs-A")),
      ...["04", "05", "06"].map((d) => j(`2026-07-${d}`, "maladie", "abs-B")),
    ];
    const p = grouperAbsences(jours);
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.absence_id)).toEqual(["abs-B", "abs-A"]); // recent d'abord
    expect(p.find((x) => x.absence_id === "abs-A")).toMatchObject({ debut: "2026-07-01", fin: "2026-07-03" });
    expect(p.find((x) => x.absence_id === "abs-B")).toMatchObject({ debut: "2026-07-04", fin: "2026-07-06" });
  });

  it("un jour saisi au planning rejoint quand meme la periode declaree voisine", () => {
    // Frontiere seulement entre deux DECLAREES : un jour null reste absorbe.
    const p = grouperAbsences([j("2026-09-07", "cp", "abs-1"), j("2026-09-08", "cp"), j("2026-09-09", "cp", "abs-1")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: "2026-09-07", fin: "2026-09-09", jours: 3 });
  });

  it("ne compte pas deux fois un jour en double", () => {
    const p = grouperAbsences([j("2026-09-07"), j("2026-09-07"), j("2026-09-08")]);
    expect(p[0].jours).toBe(2);
  });

  it("tolere l'ordre d'arrivee quelconque", () => {
    const desordre = grouperAbsences([j("2026-09-09"), j("2026-09-07"), j("2026-09-08")]);
    expect(desordre).toHaveLength(1);
    expect(desordre[0]).toMatchObject({ debut: "2026-09-07", fin: "2026-09-09", jours: 3 });
  });

  it("traverse un changement de mois et d'annee", () => {
    const p = grouperAbsences([j("2026-12-30"), j("2026-12-31"), j("2027-01-01")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: "2026-12-30", fin: "2027-01-01", jours: 3 });
  });

  it("ignore les dates invalides et le tableau vide", () => {
    expect(grouperAbsences([])).toEqual([]);
    expect(grouperAbsences([{ jour: "n'importe quoi", motif_absence_id: "cp" }])).toEqual([]);
  });

  it("reconstitue le cas reel de BOSSARD Olivier", () => {
    // Jours releves en base : 04, 05, 07..12 septembre (le 06 est un dimanche).
    const jours = ["04", "05", "07", "08", "09", "10", "11", "12"].map((d) => j(`2026-09-${d}`));
    const p = grouperAbsences(jours);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ debut: "2026-09-04", fin: "2026-09-12", jours: 8 });
  });
});

describe("libellePeriode", () => {
  it("affiche un seul jour sans fleche", () => {
    expect(libellePeriode({ motif_absence_id: "cp", debut: "2026-07-11", fin: "2026-07-11", jours: 1, declaree: false, absence_id: null })).toBe("11/07/2026");
  });

  it("ne repete pas l'annee quand elle est la meme", () => {
    expect(libellePeriode({ motif_absence_id: "cp", debut: "2026-09-04", fin: "2026-09-12", jours: 7, declaree: false, absence_id: null })).toBe("04/09 → 12/09/2026");
  });

  it("affiche les deux annees a cheval sur le nouvel an", () => {
    expect(libellePeriode({ motif_absence_id: "cp", debut: "2026-12-30", fin: "2027-01-02", jours: 4, declaree: false, absence_id: null })).toBe("30/12/2026 → 02/01/2027");
  });
});

describe("etatDepart", () => {
  it("rend « aucun » sans date", () => {
    expect(etatDepart(null, "2026-07-23")).toBe("aucun");
    expect(etatDepart(undefined, "2026-07-23")).toBe("aucun");
  });

  it("distingue a venir et depasse", () => {
    expect(etatDepart("2026-09-30", "2026-07-23")).toBe("a_venir");
    expect(etatDepart("2026-07-01", "2026-07-23")).toBe("depasse");
  });

  it("le jour meme du depart compte comme a venir", () => {
    expect(etatDepart("2026-07-23", "2026-07-23")).toBe("a_venir");
  });
});
