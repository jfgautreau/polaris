import { describe, it, expect } from "vitest";
import {
  grilleMois, moisSuivant, moisPrecedent, clicPlage, etatCase, libelleMois, isoAujourdhui,
} from "./calendrier";

describe("grilleMois", () => {
  it("rend 42 cases (6 semaines pleines)", () => {
    expect(grilleMois(2026, 6)).toHaveLength(42);
  });

  it("commence un LUNDI", () => {
    // Juillet 2026 : le 1er est un mercredi -> la grille démarre le lundi 29/06.
    const g = grilleMois(2026, 6);
    expect(g[0].iso).toBe("2026-06-29");
    expect(g[0].moisCourant).toBe(false);
  });

  it("marque le mois courant et les compléments", () => {
    const g = grilleMois(2026, 6);
    const juillet = g.filter((c) => c.moisCourant);
    expect(juillet).toHaveLength(31);           // juillet a 31 jours
    expect(juillet[0].iso).toBe("2026-07-01");
    expect(juillet.at(-1)!.iso).toBe("2026-07-31");
  });

  it("gère février d'une année bissextile", () => {
    const fev = grilleMois(2028, 1).filter((c) => c.moisCourant);
    expect(fev).toHaveLength(29);
    expect(fev.at(-1)!.iso).toBe("2028-02-29");
  });

  it("chaque case a un iso valide et strictement croissant", () => {
    const g = grilleMois(2026, 11); // décembre, chevauche l'année
    for (let i = 1; i < g.length; i++) expect(g[i].iso > g[i - 1].iso).toBe(true);
    expect(g.some((c) => c.iso.startsWith("2027-01"))).toBe(true);
  });
});

describe("navigation entre mois", () => {
  it("avance sans déborder de l'année", () => {
    expect(moisSuivant(2026, 5)).toEqual([2026, 6]);
    expect(moisSuivant(2026, 11)).toEqual([2027, 0]);
  });
  it("recule sans déborder de l'année", () => {
    expect(moisPrecedent(2026, 6)).toEqual([2026, 5]);
    expect(moisPrecedent(2026, 0)).toEqual([2025, 11]);
  });
});

describe("clicPlage — sélection en deux clics", () => {
  const vide = { debut: null, fin: null };

  it("premier clic pose le début", () => {
    expect(clicPlage(vide, "2026-08-03")).toEqual({ debut: "2026-08-03", fin: null });
  });

  it("second clic après le début pose la fin", () => {
    expect(clicPlage({ debut: "2026-08-03", fin: null }, "2026-08-13"))
      .toEqual({ debut: "2026-08-03", fin: "2026-08-13" });
  });

  it("le même jour deux fois = plage d'un seul jour", () => {
    expect(clicPlage({ debut: "2026-08-03", fin: null }, "2026-08-03"))
      .toEqual({ debut: "2026-08-03", fin: "2026-08-03" });
  });

  it("un second clic AVANT le début redémarre la sélection", () => {
    expect(clicPlage({ debut: "2026-08-13", fin: null }, "2026-08-03"))
      .toEqual({ debut: "2026-08-03", fin: null });
  });

  it("un clic sur une plage COMPLÈTE recommence à zéro", () => {
    expect(clicPlage({ debut: "2026-08-03", fin: "2026-08-13" }, "2026-08-20"))
      .toEqual({ debut: "2026-08-20", fin: null });
  });
});

describe("etatCase", () => {
  const c = (iso: string, moisCourant = true) => ({ iso, jour: +iso.slice(8), moisCourant });
  const plage = { debut: "2026-08-03", fin: "2026-08-13" };

  it("distingue début, fin, intérieur et dehors", () => {
    expect(etatCase(c("2026-08-03"), plage)).toBe("debut");
    expect(etatCase(c("2026-08-13"), plage)).toBe("fin");
    expect(etatCase(c("2026-08-07"), plage)).toBe("dans");
    expect(etatCase(c("2026-08-20"), plage)).toBe("aucun");
  });

  it("les bornes ne sont pas comptées comme intérieur", () => {
    expect(etatCase(c("2026-08-03"), plage)).not.toBe("dans");
    expect(etatCase(c("2026-08-13"), plage)).not.toBe("dans");
  });

  it("une case d'un mois voisin est toujours « hors »", () => {
    expect(etatCase(c("2026-08-03", false), plage)).toBe("hors");
  });

  it("gère une plage incomplète (début seul)", () => {
    const p = { debut: "2026-08-03", fin: null };
    expect(etatCase(c("2026-08-03"), p)).toBe("debut");
    expect(etatCase(c("2026-08-07"), p)).toBe("aucun");
  });
});

describe("libelleMois", () => {
  it("nomme le mois en français", () => {
    expect(libelleMois(2026, 6)).toBe("juillet 2026");
    expect(libelleMois(2026, 7)).toBe("août 2026");
  });
});

describe("isoAujourdhui", () => {
  it("rend la date LOCALE, pas UTC (00 h 30 le 1er juillet reste le 1er)", () => {
    expect(isoAujourdhui(new Date(2026, 6, 1, 0, 30))).toBe("2026-07-01");
    expect(isoAujourdhui(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
  });
});
