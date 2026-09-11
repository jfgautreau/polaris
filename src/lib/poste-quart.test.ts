import { describe, it, expect } from "vitest";
import { etatQuart, tourneSurQuart, effectifSurQuart, type PqMap } from "@/lib/poste-quart";

// Trois états d'une case (poste × quart) :
//   aucune ligne = repli sur l'effectif par défaut du poste ;
//   { actif:false } = « – » (ne tourne pas) ;
//   { actif:true, effectif } = tourne à 0 ou N.
describe("poste-quart — trois états", () => {
  const pq: PqMap = new Map([
    ["p1:matin", { actif: true, effectif: 2 }], // tourne à 2
    ["p1:aprem", { actif: true, effectif: 1 }], // tourne à 1
    ["p1:nuit", { actif: false, effectif: null }], // ne tourne pas
    ["p2:matin", { actif: true, effectif: 0 }], // tourne à 0 (distinct de « – »)
    ["p3:matin", { actif: true, effectif: null }], // effectif non renseigné → repli poste
  ]);

  it("aucune ligne = repli sur l'effectif par défaut du poste", () => {
    expect(etatQuart(pq, "inconnu", "matin", 3)).toEqual({ tourne: true, effectif: 3 });
    expect(effectifSurQuart(pq, "inconnu", "matin", 3)).toBe(3);
    expect(tourneSurQuart(pq, "inconnu", "matin", 3)).toBe(true);
  });

  it("effectif explicite par quart", () => {
    expect(effectifSurQuart(pq, "p1", "matin", 5)).toBe(2);
    expect(effectifSurQuart(pq, "p1", "aprem", 5)).toBe(1);
  });

  it("« – » (actif:false) = ne tourne pas, effectif 0", () => {
    expect(etatQuart(pq, "p1", "nuit", 5)).toEqual({ tourne: false, effectif: 0 });
    expect(tourneSurQuart(pq, "p1", "nuit", 5)).toBe(false);
    expect(effectifSurQuart(pq, "p1", "nuit", 5)).toBe(0);
  });

  it("« 0 » (actif:true, effectif 0) = tourne mais 0 requis — distinct de « – »", () => {
    expect(etatQuart(pq, "p2", "matin", 5)).toEqual({ tourne: true, effectif: 0 });
    expect(tourneSurQuart(pq, "p2", "matin", 5)).toBe(true);
    expect(effectifSurQuart(pq, "p2", "matin", 5)).toBe(0);
  });

  it("ligne active sans effectif renseigné = repli sur le défaut du poste", () => {
    expect(effectifSurQuart(pq, "p3", "matin", 4)).toBe(4);
  });
});
