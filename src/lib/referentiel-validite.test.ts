import { describe, it, expect } from "vitest";
import { actifLe } from "@/lib/referentiel-validite";

describe("referentiel-validite — actifLe", () => {
  it("aucune info de validité → visible", () => {
    expect(actifLe(undefined, "2027-06-01")).toBe(true);
  });

  it("actif=false coupe toujours", () => {
    expect(actifLe({ actif: false, date_ouverture: null, date_fermeture: null }, "2027-06-01")).toBe(false);
  });

  it("dates nulles → visible", () => {
    expect(actifLe({ date_ouverture: null, date_fermeture: null }, "2027-06-01")).toBe(true);
  });

  it("avant l'ouverture prévue → masqué", () => {
    expect(actifLe({ date_ouverture: "2027-01-01", date_fermeture: null }, "2026-12-31")).toBe(false);
    expect(actifLe({ date_ouverture: "2027-01-01", date_fermeture: null }, "2027-01-01")).toBe(true);
  });

  it("après la fermeture prévue → masqué (le jour même reste visible)", () => {
    expect(actifLe({ date_ouverture: null, date_fermeture: "2027-12-01" }, "2027-12-01")).toBe(true);
    expect(actifLe({ date_ouverture: null, date_fermeture: "2027-12-01" }, "2027-12-02")).toBe(false);
  });

  it("dans la fenêtre [ouverture, fermeture] → visible", () => {
    expect(actifLe({ date_ouverture: "2027-01-01", date_fermeture: "2027-12-01" }, "2027-06-15")).toBe(true);
  });
});
