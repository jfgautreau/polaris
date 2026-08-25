import { describe, it, expect } from "vitest";
import { resoudreHoraire, horaireTxt, dowLundi, type MapsHoraire } from "./horaires";

const quarts = [
  { code: "journee", ordre: 0 },
  { code: "matin", ordre: 1 },
  { code: "apres_midi", ordre: 2 },
];

const vide: MapsHoraire = { horMap: new Map(), excMap: new Map(), tpCfgMap: new Map() };
const maps = (p?: Partial<MapsHoraire>): MapsHoraire => ({
  horMap: p?.horMap ?? new Map(),
  excMap: p?.excMap ?? new Map(),
  tpCfgMap: p?.tpCfgMap ?? new Map(),
});

// 2026-08-24 = lundi -> dowLundi 0 ; 2026-08-28 = vendredi -> dowLundi 4.
const LUNDI = "2026-08-24";
const VENDREDI = "2026-08-28";

describe("dowLundi", () => {
  it("place lundi a 0 et dimanche a 6", () => {
    expect(dowLundi(LUNDI)).toBe(0);
    expect(dowLundi("2026-08-30")).toBe(6); // dimanche
  });
});

describe("resoudreHoraire — horaire standard du poste", () => {
  it("lit horMap avec la cle poste:quart:dow, quart par defaut = matin", () => {
    const horMap = new Map([[`P1:matin:${dowLundi(LUNDI)}`, { debut: "06:00", fin: "14:00" }]]);
    const r = resoudreHoraire(maps({ horMap }), quarts, "X", "P1", null, LUNDI);
    expect(r).toEqual({ debut: "06:00", fin: "14:00" });
  });
  it("respecte le quart_code explicite", () => {
    const horMap = new Map([[`P1:apres_midi:${dowLundi(LUNDI)}`, { debut: "14:00", fin: "22:00" }]]);
    const r = resoudreHoraire(maps({ horMap }), quarts, "X", "P1", "apres_midi", LUNDI);
    expect(r).toEqual({ debut: "14:00", fin: "22:00" });
  });
  it("rend null/null quand rien n'est renseigne", () => {
    expect(resoudreHoraire(vide, quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: null, fin: null });
    expect(horaireTxt(vide, quarts, "X", "P1", "matin", LUNDI)).toBe("");
  });
});

describe("resoudreHoraire — priorite des sources", () => {
  const horMap = new Map([[`P1:matin:${dowLundi(LUNDI)}`, { debut: "06:00", fin: "14:00" }]]);

  it("l'exception ponctuelle prime sur le standard", () => {
    const excMap = new Map([["X:" + LUNDI, { debut: "08:00", fin: "12:00" }]]);
    const r = resoudreHoraire(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI);
    expect(r).toEqual({ debut: "08:00", fin: "12:00" });
  });

  it("prend LES DEUX bornes de la source retenue, pas borne par borne", () => {
    // Exception cote debut seul : on ne doit PAS recomposer « 09:00 - 14:00 ».
    const excMap = new Map([["X:" + LUNDI, { debut: "09:00", fin: null }]]);
    const r = resoudreHoraire(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI);
    expect(r).toEqual({ debut: "09:00", fin: null });
    expect(horaireTxt(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI)).toBe("09:00-?");
  });

  it("le temps partiel (journee entiere) prime sur le standard, sous l'exception", () => {
    const tpCfgMap = new Map([["X", { horaires: { "5": { debut: "07:00", fin: "11:00" } } }]]); // vendredi = 5
    const r = resoudreHoraire(maps({ horMap, tpCfgMap }), quarts, "X", "P1", "matin", VENDREDI);
    expect(r).toEqual({ debut: "07:00", fin: "11:00" });
  });

  it("le temps partiel par demi-journee suit le quart du placement", () => {
    const tpCfgMap = new Map([
      ["X", { demi: { source: "horaires", matin: { "5": { debut: "06:00", fin: "10:00" } }, aprem: { "5": { debut: "14:00", fin: "18:00" } } } }],
    ]);
    const m = maps({ tpCfgMap });
    expect(resoudreHoraire(m, quarts, "X", "P1", "matin", VENDREDI)).toEqual({ debut: "06:00", fin: "10:00" });
    expect(resoudreHoraire(m, quarts, "X", "P1", "apres_midi", VENDREDI)).toEqual({ debut: "14:00", fin: "18:00" });
  });
});
