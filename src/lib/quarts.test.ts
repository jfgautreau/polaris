import { describe, it, expect } from "vitest";
import { quartParDefaut, quartLegacy, quartOuDefaut, memeQuart } from "./quarts";

// Le parametrage reel du site 1 au 23/07/2026. `journee` porte l'ordre 0 : c'est
// tout l'interet de ces tests, `quartCodes[0]` ne vaut PAS « matin ».
const REELS = [
  { code: "journee", ordre: 0 },
  { code: "matin", ordre: 1 },
  { code: "apres_midi", ordre: 2 },
  { code: "nuit", ordre: 3 },
];

describe("quartParDefaut", () => {
  it("prefere « matin » meme s'il n'est pas premier dans l'ordre", () => {
    // Comportement historique a preserver (cf. CLAUDE.md « Defaut planning =
    // matin »). Prendre bêtement le premier ouvrirait le Planning sur Journee.
    expect(quartParDefaut(REELS)).toBe("matin");
  });

  it("retombe sur le premier dans l'ordre quand « matin » n'existe pas", () => {
    // Un site aux quarts differents : plus rien a changer dans le code.
    expect(quartParDefaut([{ code: "vsd", ordre: 2 }, { code: "sd", ordre: 1 }])).toBe("sd");
  });

  it("choisit le quart du CRENEAU matin, pas le code littéral (décalage code↔libellé)", () => {
    // Cas La Vraie Croix : le code `matin` porte le libellé « Jour » (creneau
    // null) et c'est le code `apres_midi` qui est le vrai matin (creneau matin).
    // Le défaut doit suivre le créneau, donc « apres_midi », pas « matin ».
    const lvc = [
      { code: "matin", ordre: 1, creneau: null }, // libellé « Jour »
      { code: "apres_midi", ordre: 2, creneau: "matin" }, // libellé « Matin »
      { code: "journee", ordre: 3, creneau: "aprem" }, // libellé « Après-midi »
      { code: "nuit", ordre: 4, creneau: null },
    ];
    expect(quartParDefaut(lvc)).toBe("apres_midi");
  });

  it("respecte l'ordre, pas l'ordre d'arrivee du tableau", () => {
    expect(quartParDefaut([{ code: "c", ordre: 3 }, { code: "a", ordre: 1 }, { code: "b", ordre: 2 }])).toBe("a");
  });

  it("tolere l'absence d'ordre (tableau deja trie par la requete)", () => {
    expect(quartParDefaut([{ code: "premier" }, { code: "second" }])).toBe("premier");
  });

  it("rend une chaine vide sur un site sans aucun quart", () => {
    expect(quartParDefaut([])).toBe("");
  });
});

describe("quartOuDefaut — placements historiques sans quart", () => {
  it("laisse passer un quart renseigne", () => {
    expect(quartOuDefaut("nuit", REELS)).toBe("nuit");
  });

  it("comble null et undefined par le quart par defaut", () => {
    expect(quartOuDefaut(null, REELS)).toBe("matin");
    expect(quartOuDefaut(undefined, REELS)).toBe("matin");
  });

  it("REGRESSION : un seul repli pour TOUS les ecrans", () => {
    // /planning lisait `quartCodes[0]` — « journee » — quand /placement,
    // /api/placement/cell, la copie de journee et la TV lisaient « matin ».
    // Les memes placements s'affichaient donc sous deux quarts differents.
    expect(quartLegacy(REELS)).toBe(quartOuDefaut(null, REELS));
    expect(quartLegacy(REELS)).not.toBe(REELS[0].code); // et surtout pas « journee »
  });
});

describe("memeQuart", () => {
  it("compare un quart renseigne", () => {
    expect(memeQuart("nuit", "nuit", REELS)).toBe(true);
    expect(memeQuart("nuit", "matin", REELS)).toBe(false);
  });

  it("rattache un placement historique au quart par defaut", () => {
    expect(memeQuart(null, "matin", REELS)).toBe(true);
    expect(memeQuart(null, "journee", REELS)).toBe(false);
  });

  it("est coherent avec quartOuDefaut sur tous les quarts", () => {
    for (const q of [...REELS.map((r) => r.code), null]) {
      const attendu = quartOuDefaut(q, REELS);
      for (const cible of REELS.map((r) => r.code)) {
        expect(memeQuart(q, cible, REELS)).toBe(attendu === cible);
      }
    }
  });
});

describe("aucun code de quart n'est fige dans la logique", () => {
  it("un site aux quarts entierement differents fonctionne", () => {
    const autre = [{ code: "jour", ordre: 0 }, { code: "nuit_longue", ordre: 1 }];
    expect(quartParDefaut(autre)).toBe("jour");
    expect(quartOuDefaut(null, autre)).toBe("jour");
    expect(memeQuart(null, "jour", autre)).toBe(true);
    expect(memeQuart("nuit_longue", "nuit_longue", autre)).toBe(true);
  });
});
