import { describe, expect, it } from "vitest";
import { construireCampagne, ecartJours, etatA, lireInterim, lireSession, type PersonneC } from "./campagne-formation";

const p = (id: string, nom: string, extra: Partial<PersonneC> = {}): PersonneC => ({
  id,
  nom,
  prenom: "X",
  type_contrat: "CDI",
  atelier_id: null,
  equipe_id: null,
  poste_fixe_id: null,
  depart: null,
  ...extra,
});

describe("campagne de formation", () => {
  it("écart de jours et état à la date de session", () => {
    expect(ecartJours("2026-12-01", "2026-12-31")).toBe(30);
    expect(etatA(null)).toBe("permanente");
    expect(etatA(-1)).toBe("expiree");
    expect(etatA(0)).toBe("a_recycler");
    expect(etatA(90)).toBe("a_recycler");
    expect(etatA(91)).toBe("valide");
  });

  it("sépare formés et non formés, juge à la date de session", () => {
    const formation = { id: "f", nom: "SST", duree_validite_mois: 24 };
    const c = construireCampagne(
      formation,
      [
        { personne_id: "a", date_obtention: "2024-11-01", date_expiration: null }, // échue 2026-11-01
        { personne_id: "b", date_obtention: "2025-06-01", date_expiration: null }, // 2027-06-01 : valide
        { personne_id: "c", date_obtention: "2025-01-15", date_expiration: "2027-01-15" }, // 45 j après
      ],
      [
        { personne_id: "d", date_obtention: "2020-01-01", created_at: "2023-01-01T10:00:00Z" },
        { personne_id: "d", date_obtention: "2021-01-01", created_at: "2024-05-02T10:00:00Z" },
      ],
      [p("a", "A"), p("b", "B"), p("c", "C"), p("d", "D"), p("e", "E"), p("f", "F", { depart: "2026-11-20" }), p("g", "G")],
      { session: "2026-12-01", absences: new Map([["e", "Maladie"]]), tp: new Set(["g"]) },
    );
    expect(c.formes.map((l) => [l.personne.id, l.etat])).toEqual([
      ["a", "expiree"],
      ["c", "a_recycler"],
      ["b", "valide"],
    ]);
    // Disponibles d'abord (D), puis indisponibles (E absent, F parti, G en TP).
    expect(c.nonFormes.map((l) => l.personne.id)).toEqual(["d", "e", "f", "g"]);
    expect(c.nonFormes[0].ancienne).toEqual({ supprimeeLe: "2024-05-02", obtention: "2021-01-01" });
    expect(c.nonFormes[1].indispo[0]).toContain("Maladie");
    expect(c.nonFormes[2].indispo[0]).toContain("Fin de contrat");
    expect(c.nonFormes[3].indispo[0]).toContain("Temps partiel");
  });

  it("paramètres d'URL", () => {
    expect(lireSession("2027-03-10", "2026-11-19")).toBe("2027-03-10");
    expect(lireSession("n'importe", "2026-11-19")).toBe("2026-12-19");
    expect(lireInterim("oui")).toBe(true);
    expect(lireInterim(undefined)).toBe(false);
  });
});
