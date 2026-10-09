import { describe, it, expect } from "vitest";
import { resoudreHoraire, horaireTxt, dowLundi, type MapsHoraire } from "./horaires";

const quarts = [
  { code: "journee", ordre: 0, creneau: null },
  { code: "matin", ordre: 1, creneau: "matin" },
  { code: "apres_midi", ordre: 2, creneau: "aprem" },
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

  it("un debut specifique sans fin reprend la fin de l'horaire standard du poste", () => {
    const excMap = new Map([["X:" + LUNDI, { debut: "09:00", fin: null }]]);
    const r = resoudreHoraire(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI);
    expect(r).toEqual({ debut: "09:00", fin: "14:00" });
    expect(horaireTxt(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI)).toBe("09:00-14:00");
  });

  it("une fin specifique sans debut reprend le debut de l'horaire standard", () => {
    const excMap = new Map([["X:" + LUNDI, { debut: null, fin: "12:00" }]]);
    expect(resoudreHoraire(maps({ horMap, excMap }), quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: "06:00", fin: "12:00" });
  });

  it("la borne manquante vient du temps partiel s'il est renseigne", () => {
    const horV = new Map([[`P1:matin:${dowLundi(VENDREDI)}`, { debut: "06:00", fin: "14:00" }]]);
    const tpCfgMap = new Map([["X", { horaires: { "5": { debut: "07:00", fin: "11:00" } } }]]);
    const excMap = new Map([["X:" + VENDREDI, { debut: "08:00", fin: null }]]);
    expect(resoudreHoraire(maps({ horMap: horV, tpCfgMap, excMap }), quarts, "X", "P1", "matin", VENDREDI)).toEqual({ debut: "08:00", fin: "11:00" });
  });

  it("sans horaire standard, la borne manquante reste inconnue (« ? »)", () => {
    const excMap = new Map([["X:" + LUNDI, { debut: "09:00", fin: null }]]);
    expect(horaireTxt(maps({ excMap }), quarts, "X", "P1", "matin", LUNDI)).toBe("09:00-?");
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

describe("resoudreHoraire — après une nuit (0087)", () => {
  const k = `P1:matin:${dowLundi(LUNDI)}`;
  const horMap = new Map([[k, { debut: "05:00", fin: "13:00" }]]);
  const apresNuitMap = new Map([[k, { debut: "06:00", fin: null }]]);
  const avecNuit = (oui: boolean, p?: Partial<MapsHoraire>): MapsHoraire => ({
    ...maps({ horMap, ...p }),
    apresNuitMap,
    nuitAvant: () => oui,
  });
  it("sans nuit avant : horaire standard", () => {
    expect(resoudreHoraire(avecNuit(false), quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: "05:00", fin: "13:00" });
  });
  it("après une nuit : la variante remplace, borne vide = borne standard", () => {
    expect(resoudreHoraire(avecNuit(true), quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: "06:00", fin: "13:00" });
  });
  it("le temps partiel garde son horaire", () => {
    const tpCfgMap = new Map([["X", { horaires: { "1": { debut: "08:00", fin: "12:00" } } }]]);
    expect(resoudreHoraire(avecNuit(true, { tpCfgMap }), quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: "08:00", fin: "12:00" });
  });
  it("l'horaire spécifique du jour reste prioritaire", () => {
    const excMap = new Map([[`X:${LUNDI}`, { debut: "07:30", fin: null }]]);
    expect(resoudreHoraire(avecNuit(true, { excMap }), quarts, "X", "P1", "matin", LUNDI)).toEqual({ debut: "07:30", fin: "13:00" });
  });
});

describe("resoudreHoraire — horaire par place (0088)", () => {
  const k = `P1:matin:${dowLundi(LUNDI)}`;
  const horMap = new Map([[k, { debut: "05:00", fin: "13:00" }]]);
  const apresNuitMap = new Map([[k, { debut: "06:00", fin: null }]]);
  const placeMap = new Map([
    ["P1:matin:12", { debut: "05:30", fin: "13:30", debutN: "06:30", finN: null }],
    ["P1:matin:15", { debut: "05:45", fin: null, debutN: null, finN: null }],
  ]);
  const m = (nuit: boolean): MapsHoraire => ({ ...maps({ horMap }), apresNuitMap, placeMap, nuitAvant: () => nuit });
  it("la place l'emporte sur le poste, toute la semaine", () => {
    expect(resoudreHoraire(m(false), quarts, "X", "P1", "matin", LUNDI, "12")).toEqual({ debut: "05:30", fin: "13:30" });
    expect(resoudreHoraire(m(false), quarts, "X", "P1", "matin", VENDREDI, "12")).toEqual({ debut: "05:30", fin: "13:30" });
  });
  it("borne vide de la place = borne du poste", () => {
    expect(resoudreHoraire(m(false), quarts, "X", "P1", "matin", LUNDI, "15")).toEqual({ debut: "05:45", fin: "13:00" });
  });
  it("après une nuit : variante de la place d'abord, puis place, puis variante du poste", () => {
    expect(resoudreHoraire(m(true), quarts, "X", "P1", "matin", LUNDI, "12")).toEqual({ debut: "06:30", fin: "13:30" });
    expect(resoudreHoraire(m(true), quarts, "X", "P1", "matin", LUNDI, "15")).toEqual({ debut: "05:45", fin: "13:00" });
  });
  it("sans place ou place inconnue : horaire du poste", () => {
    expect(resoudreHoraire(m(true), quarts, "X", "P1", "matin", LUNDI, null)).toEqual({ debut: "06:00", fin: "13:00" });
    expect(resoudreHoraire(m(false), quarts, "X", "P1", "matin", LUNDI, "99")).toEqual({ debut: "05:00", fin: "13:00" });
  });
});
