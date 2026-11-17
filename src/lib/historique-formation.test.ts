import { describe, it, expect } from "vitest";
import { evenementsFormation, valeurChamp, type LigneAudit, type LotAudit } from "./historique-formation";

const ligne = (id: number, created_at: string, action: string, old_values: LigneAudit["old_values"], new_values: LigneAudit["new_values"]): LigneAudit => ({
  id,
  created_at,
  action,
  app_user_id: "u1",
  old_values,
  new_values,
});

describe("historique d'une formation", () => {
  it("décrit création, modification (journal compact) et suppression, du plus récent au plus ancien", () => {
    const evts = evenementsFormation(
      [
        ligne(1, "2026-07-01T08:00:00Z", "INSERT", null, { nom: "Hygiène", categorie: "reglementaire", actif: true, duree_validite_mois: null }),
        ligne(2, "2026-11-16T09:00:00Z", "UPDATE", { nom: "Hygiène", groupe: null }, { nom: "Hygiène", groupe: "Qualité" }),
        ligne(3, "2026-11-17T09:00:00Z", "DELETE", { nom: "Hygiène" }, null),
      ],
      [],
    );
    expect(evts.map((e) => e.action)).toEqual(["suppression", "modification", "creation"]);
    expect(evts[1].changements).toEqual([{ champ: "Groupe", avant: "—", apres: "Qualité" }]);
    expect(evts[2].changements.map((c) => c.champ)).toEqual(["Nom", "Catégorie", "Actif"]);
  });

  it("ignore une modification sans changement de réglage (ancien format : ligne entière)", () => {
    const tout = { nom: "SST", duree_validite_mois: 24, updated_at: "a" };
    const evts = evenementsFormation([ligne(1, "2026-10-01T08:00:00Z", "UPDATE", tout, { ...tout, updated_at: "b" })], []);
    expect(evts).toEqual([]);
  });

  it("rattache le recalcul des échéances à la modification de durée qui l'a causé", () => {
    const lots: LotAudit[] = [
      { id: 10, created_at: "2026-11-17T09:00:01Z", lot_libelle: "Échéances recalculées : Autre (4)", new_values: { lignes: 4 } },
      { id: 11, created_at: "2026-11-17T09:00:02Z", lot_libelle: "Échéances recalculées : Hygiène (113)", new_values: { lignes: 113 } },
      { id: 12, created_at: "2026-11-17T10:00:00Z", lot_libelle: "Échéances recalculées : Hygiène (5)", new_values: { lignes: 5 } },
    ];
    const evts = evenementsFormation(
      [ligne(1, "2026-11-17T09:00:00Z", "UPDATE", { nom: "Hygiène", duree_validite_mois: 24 }, { nom: "Hygiène", duree_validite_mois: 36 })],
      lots,
    );
    expect(evts[0].changements).toEqual([{ champ: "Validité", avant: "24 mois", apres: "36 mois" }]);
    expect(evts[0].echeancesRecalculees).toBe(113);
  });

  it("formate les valeurs", () => {
    expect(valeurChamp("duree_validite_mois", null)).toBe("sans échéance");
    expect(valeurChamp("categorie", "interne")).toBe("Interne");
    expect(valeurChamp("actif", false)).toBe("Non");
  });
});
