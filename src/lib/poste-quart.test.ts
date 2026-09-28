import { describe, it, expect } from "vitest";
import { etatQuart, tourneSurQuart, effectifSurQuart, quartsDuPoste, quartPourPosteFixe, type PqMap } from "@/lib/poste-quart";
import { quartJournee } from "@/lib/quarts";

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

// ── Pré-remplissage des postes fixes : le cycle du poste décide (2026-09-28) ──
describe("quartsDuPoste / quartPourPosteFixe", () => {
  const LIB: Record<string, string> = { journee: "Journée", matin: "Matin", apres_midi: "Après-midi", nuit: "Nuit" };
  const libelle = (c: string) => LIB[c] ?? c;
  const codes = ["journee", "matin", "apres_midi", "nuit"];
  const choix = (quartsPoste: string[], quartEquipe: string, quartJournee: string | null = "journee") =>
    quartPourPosteFixe({ quartsPoste, quartEquipe, quartJournee, libelle });

  it("cycle du poste : aucune ligne = tourne, « – » = ne tourne pas", () => {
    const pq = new Map([
      ["RAFAB:matin", { actif: false, effectif: null }],
      ["RAFAB:apres_midi", { actif: false, effectif: null }],
      ["RAFAB:nuit", { actif: false, effectif: null }],
      ["RAFAB:journee", { actif: true, effectif: 1 }],
    ]);
    expect(quartsDuPoste(pq, "RAFAB", codes)).toEqual(["journee"]);
    expect(quartsDuPoste(new Map(), "NEUF", codes)).toEqual(codes);
  });

  it("le quart de l'équipe fait partie du cycle → ce quart (rotation suivie)", () => {
    expect(choix(["matin", "apres_midi"], "apres_midi")).toEqual({ quart: "apres_midi" });
  });

  it("poste de Journée seule → Journée, même pour une équipe tournante (RA Fab, équipe A)", () => {
    expect(choix(["journee"], "matin")).toEqual({ quart: "journee" });
    expect(choix(["journee"], "apres_midi")).toEqual({ quart: "journee" });
  });

  it("incohérent → pas de placement, raison nommée (Aide Broyeur Matin seul, titulaire Fixe AM)", () => {
    const r = choix(["matin"], "apres_midi");
    expect(r.quart).toBeNull();
    expect("raison" in r && r.raison).toContain("Après-midi");
    expect("raison" in r && r.raison).toContain("Matin");
  });

  it("équipe de Nuit sur un poste qui ne tourne pas la nuit → pas de placement (AT1)", () => {
    expect(choix(["journee", "matin", "apres_midi"], "nuit").quart).toBeNull();
  });

  it("poste Matin seul tenu par l'équipe Journée → pas de placement (on ne devine pas)", () => {
    expect(choix(["matin"], "journee").quart).toBeNull();
  });

  it("poste qui ne tourne sur aucun quart → pas de placement", () => {
    expect(choix([], "matin").quart).toBeNull();
  });

  it("site sans quart Journée : la règle 2 ne s'applique pas", () => {
    expect(choix(["matin"], "apres_midi", null).quart).toBeNull();
  });

  it("quartJournee : quart sans créneau au plus petit ordre, jamais le code", () => {
    // La Vraie Croix : la pleine journée porte le code `matin` (libellé « Jour »).
    expect(quartJournee([
      { code: "apres_midi", ordre: 1, creneau: "matin" },
      { code: "matin", ordre: 0, creneau: null },
      { code: "journee", ordre: 2, creneau: "aprem" },
      { code: "nuit", ordre: 3, creneau: null },
    ])).toBe("matin");
    expect(quartJournee([{ code: "matin", ordre: 0, creneau: "matin" }])).toBeNull();
  });
});
