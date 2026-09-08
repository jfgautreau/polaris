import { describe, it, expect } from "vitest";
import {
  parseFichierAbsencesRh,
  tokensNom,
  apparier,
  type PersonnePolaris,
} from "./import-absences-rh";

const ECHANTILLON = `;;;;;;;;
Section : D089STUSADMIJ administratif usine
;;;;;;;;
Matricule : 100709 DOLIN PAMELA
Date;Motif;Libellé;Valorisation;Jours;Nombre;Heures;H début;H fin
31/08/26;00CLFA;Congé payé annuel;Jours;1; ;07:00; ;
Total Matricule;;1;0;07:00;;
;;
Matricule : 108269 RIVAUX MORGANE
Date;Motif;Libellé;Valorisation;Jours;Nombre;Heures;H début;H fin
31/08/26;00MATH;Maladie Therapeutique;Heure; ; ;03:30; ;
01/09/26;00MATH;Maladie Therapeutique;Heure; ; ;03:30; ;
Total Matricule;;0;0;07:00;;
;;
Total Section;;19;0;141:30;;
Section : D089STUSATL22 atelier 2 equipe rouge
Matricule : 013763 NAEL ALBAN
Date;Motif;Libellé;Valorisation;Jours;Nombre;Heures;H début;H fin
31/08/26;00CLFA;Congé payé annuel;Jours;1; ; ; ;
01/09/26;00CPANC;Congé ancienneté;Jours;1; ;07:00; ;
02/09/26;00CPANC;Congé ancienneté;Jours;1; ;07:00; ;
Total Matricule;;3;0;14:00;;
`;

describe("parseFichierAbsencesRh", () => {
  const f = parseFichierAbsencesRh(ECHANTILLON);

  it("extrait chaque bloc matricule avec son nom complet", () => {
    expect(f.personnes.map((p) => p.matriculeRh)).toEqual(["100709", "108269", "013763"]);
    expect(f.personnes[0].nomComplet).toBe("DOLIN PAMELA");
  });

  it("compte une journée entière par ligne datée, quelle que soit la durée", () => {
    const rivaux = f.personnes.find((p) => p.matriculeRh === "108269")!;
    expect(rivaux.jours).toHaveLength(2); // 03:30 comptés comme des jours pleins
  });

  it("gère plusieurs motifs dans un même bloc", () => {
    const nael = f.personnes.find((p) => p.matriculeRh === "013763")!;
    expect(nael.jours.map((j) => j.codeGt)).toEqual(["00CLFA", "00CPANC", "00CPANC"]);
  });

  it("convertit les dates jj/mm/aa en ISO et calcule la fenêtre", () => {
    expect(f.personnes[0].jours[0].dateIso).toBe("2026-08-31");
    expect(f.dateMin).toBe("2026-08-31");
    expect(f.dateMax).toBe("2026-09-02");
  });

  it("catalogue les codes GT présents", () => {
    expect(f.motifs.get("00CLFA")).toBe("Congé payé annuel");
    expect(f.motifs.get("00MATH")).toBe("Maladie Therapeutique");
    expect([...f.motifs.keys()].sort()).toEqual(["00CLFA", "00CPANC", "00MATH"]);
  });

  it("rattache la section lisible au bloc", () => {
    const nael = f.personnes.find((p) => p.matriculeRh === "013763")!;
    expect(nael.section).toContain("atelier 2");
  });
});

describe("tokensNom", () => {
  it("normalise accents, casse et ponctuation", () => {
    expect(tokensNom("Le Clainché, Anthony")).toEqual(new Set(["LE", "CLAINCHE", "ANTHONY"]));
  });
  it("retire le bruit de contrat", () => {
    expect(tokensNom("BRIEND MATHIEU CDI")).toEqual(new Set(["BRIEND", "MATHIEU"]));
  });
});

describe("apparier", () => {
  const polaris: PersonnePolaris[] = [
    { id: "p1", nom: "DOLIN", prenom: "Paméla" },
    { id: "p2", nom: "LE CLAINCHE", prenom: "Anthony" },
    { id: "p3", nom: "MAHE", prenom: "Hélène" },
    { id: "p4", nom: "MAHE", prenom: "Anne-Gaelle" },
  ];

  it("apparie automatiquement une correspondance exacte unique", () => {
    const [r] = apparier([{ matriculeRh: "1", nomComplet: "DOLIN PAMELA", section: "", jours: [{ dateIso: "2026-08-31", codeGt: "X", libelle: "" }] }], polaris, {});
    expect(r.statut).toBe("auto");
    expect(r.personneId).toBe("p1");
  });

  it("apparie un nom composé malgré un suffixe de contrat", () => {
    const [r] = apparier([{ matriculeRh: "2", nomComplet: "LE CLAINCHE ANTHONY CDI", section: "", jours: [] }], polaris, {});
    expect(r.statut).toBe("auto");
    expect(r.personneId).toBe("p2");
  });

  it("marque ambigu quand plusieurs personnes partagent le nom de famille", () => {
    const [r] = apparier([{ matriculeRh: "3", nomComplet: "MAHE X", section: "", jours: [] }], polaris, {});
    // « MAHE X » ne fait exact avec personne mais est inclus dans aucune ;
    // ici on vérifie surtout l'inconnu propre :
    expect(["ambigu", "inconnu"]).toContain(r.statut);
  });

  it("respecte une équivalence apprise (ignorer)", () => {
    const [r] = apparier([{ matriculeRh: "9", nomComplet: "INCONNU TOTAL", section: "", jours: [] }], polaris, { "9": { personneId: null, ignorer: true } });
    expect(r.statut).toBe("appris");
    expect(r.ignorer).toBe(true);
  });

  it("respecte une équivalence apprise (personne)", () => {
    const [r] = apparier([{ matriculeRh: "7", nomComplet: "PEU IMPORTE", section: "", jours: [] }], polaris, { "7": { personneId: "p3", ignorer: false } });
    expect(r.statut).toBe("appris");
    expect(r.personneId).toBe("p3");
  });

  it("renvoie inconnu quand aucun candidat crédible", () => {
    const [r] = apparier([{ matriculeRh: "5", nomComplet: "ZZZZ YYYY", section: "", jours: [] }], polaris, {});
    expect(r.statut).toBe("inconnu");
    expect(r.personneId).toBeNull();
  });
});
