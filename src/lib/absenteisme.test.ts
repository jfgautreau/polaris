import { describe, it, expect } from "vitest";
import { estNonPlanifie, bradford, palierBradford } from "./absenteisme";

describe("estNonPlanifie", () => {
  it("classe maladie / accident / injustifié en non planifié", () => {
    expect(estNonPlanifie({ libelle: "Absence Maladie" })).toBe(true);
    expect(estNonPlanifie({ code_court: "AT", libelle: "Accident de travail" })).toBe(true);
    expect(estNonPlanifie({ code_court: "AT" })).toBe(true);
    expect(estNonPlanifie({ libelle: "Absence injustifiée" })).toBe(true);
  });
  it("classe congés, RTT, formation… en planifié", () => {
    expect(estNonPlanifie({ code_court: "CP", libelle: "Congés Payés" })).toBe(false);
    expect(estNonPlanifie({ code_court: "RTT", libelle: "Réduction du Temps de Travail" })).toBe(false);
    expect(estNonPlanifie({ libelle: "Formation" })).toBe(false);
    expect(estNonPlanifie({ libelle: "Compte Epargne Temps" })).toBe(false);
    expect(estNonPlanifie({ libelle: "Journée Non Travaillée" })).toBe(false);
  });
  it("le flag explicite (migration 0060) l'emporte sur l'heuristique", () => {
    // Libellé « maladie » mais marqué planifié à la main -> planifié.
    expect(estNonPlanifie({ libelle: "Absence Maladie", non_planifie: false })).toBe(false);
    // Libellé neutre mais marqué non planifié -> non planifié.
    expect(estNonPlanifie({ libelle: "Convenance personnelle", non_planifie: true })).toBe(true);
  });
});

describe("bradford", () => {
  it("pénalise les absences fréquentes plus que les longues", () => {
    // Même total de 10 jours : 1 épisode vs 5 épisodes.
    expect(bradford(1, 10)).toBe(10);
    expect(bradford(5, 10)).toBe(250);
    expect(bradford(10, 10)).toBe(1000);
  });
  it("vaut 0 sans absence", () => {
    expect(bradford(0, 0)).toBe(0);
  });
});

describe("palierBradford", () => {
  it("applique les seuils usuels", () => {
    expect(palierBradford(0)).toBe("ok");
    expect(palierBradford(50)).toBe("ok");
    expect(palierBradford(51)).toBe("surveiller");
    expect(palierBradford(200)).toBe("alerte");
    expect(palierBradford(500)).toBe("critique");
  });
});
