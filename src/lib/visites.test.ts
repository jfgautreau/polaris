import { describe, it, expect } from "vitest";
import {
  REGIMES_DEFAUT,
  MAX_LEGAL,
  PARAMETRES_DEFAUT,
  lireParametres,
  regimeDe,
  heuresDeNuit,
  ajouterMoisIso,
  ajouterJoursIso,
  plusTot,
  derniereVisite,
  echeancePeriodique,
  echeanceIntermediaire,
  echeanceReprise,
  anciManquants,
  evaluerPersonne,
  repriseDepuisPeriodes,
  contrainteApplicable,
  delaiTexte,
  type Contexte,
  type DonneesPersonne,
  type VisiteLue,
} from "@/lib/visites";

const CTX: Contexte = {
  aujourdhui: "2026-09-28",
  regimes: REGIMES_DEFAUT,
  params: PARAMETRES_DEFAUT,
};

const personne = (p: Partial<DonneesPersonne> = {}): DonneesPersonne => ({
  arrivee: "2024-01-08",
  visites: [],
  ancisRequis: [],
  reprise: null,
  ...p,
});

const visite = (v: Partial<VisiteLue> = {}): VisiteLue => ({
  date_visite: null,
  date_rdv: null,
  prochaine_date: null,
  categorie: "periodique",
  libelle: "VIP périodique",
  anci: [],
  ...v,
});

describe("dates", () => {
  it("ajoute des mois et des jours", () => {
    expect(ajouterMoisIso("2024-01-31", 1)).toBe("2024-03-02"); // débordement de février, assumé
    expect(ajouterMoisIso("2024-03-14", 60)).toBe("2029-03-14");
    expect(ajouterJoursIso("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("plusTot tolère les dates absentes", () => {
    expect(plusTot(null, "2026-01-01")).toBe("2026-01-01");
    expect(plusTot("2026-01-01", null)).toBe("2026-01-01");
    expect(plusTot("2026-05-01", "2026-01-01")).toBe("2026-01-01");
    expect(plusTot(null, null)).toBeNull();
  });

  it("dit le délai en français", () => {
    expect(delaiTexte("2026-09-28", "2026-09-28")).toBe("aujourd'hui");
    expect(delaiTexte("2026-10-03", "2026-09-28")).toBe("dans 5 j");
    expect(delaiTexte("2026-09-20", "2026-09-28")).toBe("en retard de 8 j");
  });
});

describe("heures de nuit d'un quart", () => {
  it("compte les heures comprises entre 21 h et 6 h", () => {
    expect(heuresDeNuit("22:00", "06:00")).toBe(8);
    expect(heuresDeNuit("06:00", "14:00")).toBe(0);
    expect(heuresDeNuit("14:00", "22:00")).toBe(1);
    expect(heuresDeNuit("08:00", "16:30")).toBe(0);
  });

  it("découpe un quart qui enjambe minuit", () => {
    expect(heuresDeNuit("20:00", "04:00")).toBe(7);
  });

  it("tolère les horaires absents ou vides", () => {
    expect(heuresDeNuit(null, "06:00")).toBe(0);
    expect(heuresDeNuit("22:00", null)).toBe(0);
    expect(heuresDeNuit("22:00", "22:00")).toBe(0);
  });

  it("accepte le format HH:MM:SS de Postgres", () => {
    expect(heuresDeNuit("21:30:00", "05:30:00")).toBe(8);
  });
});

describe("régime de suivi", () => {
  it("part du suivi simple", () => {
    expect(regimeDe({}).regime).toBe("simple");
  });

  it("la nuit fait passer en suivi adapté", () => {
    const r = regimeDe({ nuit: true });
    expect(r.regime).toBe("adapte");
    expect(r.raisons.map((x) => x.source)).toContain("quart");
  });

  it("le plus exigeant l'emporte, toutes les raisons restent lisibles", () => {
    const r = regimeDe({ nuit: true, suiviAdapte: true, habsSIR: ["CACES R489"] });
    expect(r.regime).toBe("renforce");
    expect(r.raisons).toHaveLength(3);
    expect(r.raisons.map((x) => x.texte)).toContain("CACES R489");
  });

  it("un poste à risque suffit", () => {
    expect(regimeDe({ postesSIR: ["Cariste quai"] }).regime).toBe("renforce");
  });

  it("le régime imposé court-circuite le calcul", () => {
    const r = regimeDe({ nuit: true, habsSIR: ["CACES"], force: "simple" });
    expect(r.regime).toBe("simple");
  });
});

describe("réglages", () => {
  it("rend les défauts quand rien n'est stocké", () => {
    expect(lireParametres(null)).toEqual(PARAMETRES_DEFAUT);
  });

  it("lit les nombres et les booléens, ignore l'inconnu", () => {
    const p = lireParametres([
      { cle: "repriseJours", valeur: "45" },
      { cle: "alertePlacementAnci", valeur: "1" },
      { cle: "alertePlacementContrainte", valeur: "0" },
      { cle: "nimportequoi", valeur: "12" },
    ]);
    expect(p.repriseJours).toBe(45);
    expect(p.alertePlacementAnci).toBe(true);
    expect(p.alertePlacementContrainte).toBe(false);
    expect(p.alerteJours).toBe(PARAMETRES_DEFAUT.alerteJours);
  });

  it("borne les valeurs aberrantes", () => {
    expect(lireParametres([{ cle: "repriseJours", valeur: "99999" }]).repriseJours).toBe(366);
    expect(lireParametres([{ cle: "repriseJours", valeur: "-5" }]).repriseJours).toBe(1);
  });
});

describe("échéance périodique", () => {
  it("compte le plafond du régime depuis la dernière visite", () => {
    const d = personne({ visites: [visite({ date_visite: "2022-06-10" })] });
    expect(echeancePeriodique(d, "simple", CTX)?.due).toBe("2027-06-10");
    expect(echeancePeriodique(d, "adapte", CTX)?.due).toBe("2025-06-10");
  });

  it("la date fixée par le professionnel l'emporte si elle est plus proche", () => {
    const d = personne({ visites: [visite({ date_visite: "2025-04-11", prochaine_date: "2027-04-11" })] });
    const e = echeancePeriodique(d, "adapte", CTX);
    expect(e?.due).toBe("2027-04-11");
    const d2 = personne({ visites: [visite({ date_visite: "2025-04-11", prochaine_date: "2026-10-01" })] });
    const e2 = echeancePeriodique(d2, "simple", CTX);
    expect(e2?.due).toBe("2026-10-01");
    expect(e2?.motif).toMatch(/professionnel/);
  });

  it("sans visite : trois mois après l'embauche en suivi simple", () => {
    const e = echeancePeriodique(personne({ arrivee: "2026-09-01" }), "simple", CTX);
    expect(e?.due).toBe("2026-12-01");
  });

  it("sans visite : avant l'affectation en suivi adapté ou renforcé", () => {
    const e = echeancePeriodique(personne({ arrivee: "2026-10-05" }), "adapte", CTX);
    expect(e?.due).toBe("2026-10-05");
    expect(e?.libelle).toMatch(/avant affectation/i);
  });

  it("sans visite ni arrivée : aucune date calculable", () => {
    expect(echeancePeriodique(personne({ arrivee: null }), "simple", CTX)?.due).toBeNull();
  });
});

describe("visite intermédiaire", () => {
  it("n'existe qu'en suivi renforcé", () => {
    const d = personne({ visites: [visite({ date_visite: "2024-01-20" })] });
    expect(echeanceIntermediaire(d, "simple", CTX)).toBeNull();
    expect(echeanceIntermediaire(d, "adapte", CTX)).toBeNull();
    expect(echeanceIntermediaire(d, "renforce", CTX)?.due).toBe("2026-01-20");
  });

  it("disparaît une fois réalisée après l'examen d'aptitude", () => {
    const d = personne({
      visites: [
        visite({ date_visite: "2024-01-20" }),
        visite({ date_visite: "2025-05-15", categorie: "intermediaire" }),
      ],
    });
    expect(echeanceIntermediaire(d, "renforce", CTX)).toBeNull();
  });

  it("réapparaît après un nouvel examen d'aptitude", () => {
    const d = personne({
      visites: [
        visite({ date_visite: "2025-05-15", categorie: "intermediaire" }),
        visite({ date_visite: "2026-01-10" }),
      ],
    });
    expect(echeanceIntermediaire(d, "renforce", CTX)?.due).toBe("2028-01-10");
  });
});

describe("visite de reprise", () => {
  it("est due huit jours après le retour", () => {
    const d = personne({ reprise: { fin: "2026-09-30", jours: 74, motif: "Absence maladie" } });
    expect(echeanceReprise(d, CTX)?.due).toBe("2026-10-08");
  });

  it("disparaît une fois la visite réalisée après le retour", () => {
    const d = personne({
      reprise: { fin: "2026-08-31", jours: 74, motif: "Absence maladie" },
      visites: [visite({ date_visite: "2026-09-02", categorie: "reprise" })],
    });
    expect(echeanceReprise(d, CTX)).toBeNull();
  });

  it("subsiste si la seule visite de reprise est antérieure à l'absence", () => {
    const d = personne({
      reprise: { fin: "2026-09-20", jours: 90, motif: "Accident du travail" },
      visites: [visite({ date_visite: "2024-03-02", categorie: "reprise" })],
    });
    expect(echeanceReprise(d, CTX)).not.toBeNull();
  });
});

describe("absence longue -> reprise", () => {
  const motifs = new Map([
    ["m-am", "Absence maladie"],
    ["m-at", "Accident du travail"],
  ]);

  it("compte les jours CALENDAIRES, week-ends compris", () => {
    const r = repriseDepuisPeriodes(
      [{ debut: "2026-07-01", fin: "2026-09-10", motif_absence_id: "m-am" }],
      motifs,
      60,
    );
    expect(r?.jours).toBe(72);
    expect(r?.motif).toBe("Absence maladie");
  });

  it("ignore un motif non coché par les RH", () => {
    const r = repriseDepuisPeriodes(
      [{ debut: "2026-01-01", fin: "2026-06-30", motif_absence_id: "m-cp" }],
      motifs,
      60,
    );
    expect(r).toBeNull();
  });

  it("ignore une absence sous le seuil", () => {
    const r = repriseDepuisPeriodes(
      [{ debut: "2026-08-01", fin: "2026-09-10", motif_absence_id: "m-am" }],
      motifs,
      60,
    );
    expect(r).toBeNull();
  });

  it("retient la plus récente quand plusieurs dépassent le seuil", () => {
    const r = repriseDepuisPeriodes(
      [
        { debut: "2024-01-01", fin: "2024-06-01", motif_absence_id: "m-am" },
        { debut: "2026-01-01", fin: "2026-05-01", motif_absence_id: "m-at" },
      ],
      motifs,
      60,
    );
    expect(r?.fin).toBe("2026-05-01");
  });

  it("un seuil abaissé par les RH attrape une absence plus courte", () => {
    const r = repriseDepuisPeriodes(
      [{ debut: "2026-08-01", fin: "2026-09-10", motif_absence_id: "m-at" }],
      motifs,
      30,
    );
    expect(r?.jours).toBe(41);
  });
});

describe("attestation de non contre-indication", () => {
  it("manque tant qu'aucune visite ne l'a délivrée", () => {
    const d = personne({ ancisRequis: ["conduite"], visites: [visite({ date_visite: "2026-01-10" })] });
    expect(anciManquants(d, "simple", CTX)).toEqual(["conduite"]);
  });

  it("est valable tant que la visite qui l'a délivrée n'est pas périmée", () => {
    const d = personne({
      ancisRequis: ["conduite"],
      visites: [visite({ date_visite: "2024-05-02", anci: ["conduite"] })],
    });
    expect(anciManquants(d, "simple", CTX)).toEqual([]); // 60 mois : valable
    expect(anciManquants(d, "adapte", CTX)).toEqual([]); // 36 mois : valable
  });

  it("périme avec le plafond du régime", () => {
    const d = personne({
      ancisRequis: ["conduite"],
      visites: [visite({ date_visite: "2021-05-02", anci: ["conduite"] })],
    });
    expect(anciManquants(d, "adapte", CTX)).toEqual(["conduite"]);
  });

  it("distingue les usages entre eux", () => {
    const d = personne({
      ancisRequis: ["conduite", "electrique"],
      visites: [visite({ date_visite: "2026-02-02", anci: ["conduite"] })],
    });
    expect(anciManquants(d, "simple", CTX)).toEqual(["electrique"]);
  });
});

describe("évaluation complète", () => {
  it("habilitation à risque fraîche : l'examen d'aptitude est dû avant affectation", () => {
    const e = evaluerPersonne(
      personne({
        nuit: true,
        habsSIR: ["CACES R489 cat. 3"],
        renforceDepuis: "2026-09-12",
        arrivee: "2025-03-03",
        visites: [visite({ date_visite: "2025-03-14", categorie: "initiale", libelle: "VIP avant affectation" })],
      }),
      CTX,
    );
    expect(e.regime).toBe("renforce");
    expect(e.prochaine?.libelle).toBe("Examen médical d'aptitude");
    expect(e.prochaine?.due).toBe("2026-09-12");
    expect(e.statut).toBe("retard");
  });

  it("une visite postérieure à l'entrée dans le suivi renforcé rouvre le cycle normal", () => {
    const e = evaluerPersonne(
      personne({
        habsSIR: ["CACES R489 cat. 3"],
        renforceDepuis: "2026-01-12",
        visites: [visite({ date_visite: "2026-02-02" })],
      }),
      CTX,
    );
    expect(e.prochaine?.libelle).toBe("Visite intermédiaire");
    expect(e.prochaine?.due).toBe("2028-02-02");
    expect(e.statut).toBe("ok");
  });

  it("à jour quand la prochaine échéance est lointaine", () => {
    const e = evaluerPersonne(
      personne({ visites: [visite({ date_visite: "2025-09-08" })] }),
      CTX,
    );
    expect(e.statut).toBe("ok");
    expect(e.derniere?.date).toBe("2025-09-08");
  });

  it("passe « à planifier » dans la fenêtre d'alerte", () => {
    const e = evaluerPersonne(
      personne({ nuit: true, visites: [visite({ date_visite: "2023-11-02" })] }),
      CTX,
    );
    expect(e.prochaine?.due).toBe("2026-11-02");
    expect(e.statut).toBe("planifier");
  });

  it("un rendez-vous pris apaise le retard", () => {
    const e = evaluerPersonne(
      personne({
        nuit: true,
        visites: [visite({ date_visite: "2022-01-02" }), visite({ date_rdv: "2026-11-18" })],
      }),
      CTX,
    );
    expect(e.rdv).toBe("2026-11-18");
    expect(e.statut).toBe("rdv");
  });

  it("un rendez-vous passé et non honoré ne compte plus", () => {
    const e = evaluerPersonne(
      personne({ nuit: true, visites: [visite({ date_visite: "2022-01-02" }), visite({ date_rdv: "2026-05-01" })] }),
      CTX,
    );
    expect(e.rdv).toBeNull();
    expect(e.statut).toBe("retard");
  });

  it("la reprise passe devant tout le reste", () => {
    const e = evaluerPersonne(
      personne({
        visites: [visite({ date_visite: "2022-01-02" })],
        reprise: { fin: "2026-10-06", jours: 74, motif: "Absence maladie" },
      }),
      CTX,
    );
    expect(e.statut).toBe("reprise");
    expect(e.prochaine?.libelle).toBe("Visite de reprise");
  });

  it("l'échéance la plus proche gagne entre intermédiaire et périodique", () => {
    const e = evaluerPersonne(
      personne({ postesSIR: ["Électromécanicien"], visites: [visite({ date_visite: "2024-01-20" })] }),
      CTX,
    );
    expect(e.prochaine?.libelle).toBe("Visite intermédiaire");
    expect(e.prochaine?.due).toBe("2026-01-20");
    expect(e.statut).toBe("retard");
  });
});

describe("contraintes d'affectation", () => {
  const c = { quart_code: "nuit", poste_id: null, date_debut: "2026-09-01", date_fin: "2026-12-02" };

  it("s'applique sur le quart visé, dans la fenêtre", () => {
    expect(contrainteApplicable(c, "2026-09-28", "nuit", "p1")).toBe(true);
    expect(contrainteApplicable(c, "2026-09-28", "matin", "p1")).toBe(false);
  });

  it("ne s'applique pas hors de la fenêtre", () => {
    expect(contrainteApplicable(c, "2026-08-30", "nuit", null)).toBe(false);
    expect(contrainteApplicable(c, "2026-12-03", "nuit", null)).toBe(false);
  });

  it("sans date de fin, elle court indéfiniment", () => {
    const ouverte = { ...c, date_fin: null };
    expect(contrainteApplicable(ouverte, "2030-01-01", "nuit", null)).toBe(true);
  });

  it("vise aussi un poste précis", () => {
    const surPoste = { quart_code: null, poste_id: "p9", date_debut: "2026-01-01", date_fin: null };
    expect(contrainteApplicable(surPoste, "2026-09-28", "matin", "p9")).toBe(true);
    expect(contrainteApplicable(surPoste, "2026-09-28", "matin", "p1")).toBe(false);
  });
});

describe("garde-fou réglementaire", () => {
  it("les plafonds par défaut sont les maxima du Code du travail", () => {
    for (const r of REGIMES_DEFAUT) {
      expect(r.mois).toBe(MAX_LEGAL[r.code].mois);
      expect(r.moisInter).toBe(MAX_LEGAL[r.code].moisInter);
    }
  });

  it("derniereVisite ignore les rendez-vous non honorés", () => {
    const v = derniereVisite([visite({ date_rdv: "2026-12-01" }), visite({ date_visite: "2025-01-01" })], [
      "periodique",
    ]);
    expect(v?.date_visite).toBe("2025-01-01");
  });
});
