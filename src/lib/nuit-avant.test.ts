import { describe, it, expect } from "vitest";
import { ligneSortDUneNuit, veille, type DonneesNuit } from "./nuit-avant";

const base: DonneesNuit = {
  quartsNuit: ["nuit"],
  quartsActifs: new Set(["nuit:2026-10-12"]),
  lignesFermees: new Set(),
  lignesQuiTournent: new Set(["nuit:L1"]),
};

describe("nuit avant", () => {
  it("la veille, y compris en changement de mois", () => {
    expect(veille("2026-10-13")).toBe("2026-10-12");
    expect(veille("2026-11-01")).toBe("2026-10-31");
  });
  it("nuit du lundi soir activée, ligne qui tourne de nuit → mardi matin après une nuit", () => {
    expect(ligneSortDUneNuit(base, "L1", "2026-10-13")).toBe(true);
  });
  it("pas de nuit activée la veille", () => {
    expect(ligneSortDUneNuit(base, "L1", "2026-10-12")).toBe(false);
  });
  it("ligne fermée par l'ordo cette nuit-là", () => {
    expect(ligneSortDUneNuit({ ...base, lignesFermees: new Set(["nuit:L1:2026-10-12"]) }, "L1", "2026-10-13")).toBe(false);
  });
  it("ligne dont aucun poste ne tourne de nuit", () => {
    expect(ligneSortDUneNuit(base, "L2", "2026-10-13")).toBe(false);
  });
  it("site sans quart de nuit", () => {
    expect(ligneSortDUneNuit({ ...base, quartsNuit: [] }, "L1", "2026-10-13")).toBe(false);
  });
});
