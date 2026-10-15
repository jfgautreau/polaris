import { describe, it, expect } from "vitest";
import { numerosPourSemaine } from "./numeros-prefill";

const pris = (m: Record<string, string[]>) => (iso: string) => new Set(m[iso] ?? []);
const J = ["lun", "mar", "mer"];

describe("numéro de rotation du pré-remplissage", () => {
  it("premier numéro libre toute la semaine", () => {
    expect(numerosPourSemaine(["12", "15", "16"], J, pris({ mar: ["12"] }), [])).toEqual({ lun: "15", mar: "15", mer: "15" });
  });
  it("reprend son dernier numéro s'il est libre", () => {
    expect(numerosPourSemaine(["12", "15", "16"], J, pris({}), [null, "16"])).toEqual({ lun: "16", mar: "16", mer: "16" });
  });
  it("le numéro tenu cette semaine passe avant le dernier", () => {
    expect(numerosPourSemaine(["12", "15", "16"], J, pris({}), ["15", "16"])).toEqual({ lun: "15", mar: "15", mer: "15" });
  });
  it("dernier numéro pris un jour : un autre libre toute la semaine", () => {
    expect(numerosPourSemaine(["12", "15"], J, pris({ mer: ["12"] }), ["12"])).toEqual({ lun: "15", mar: "15", mer: "15" });
  });
  it("un numéro qui n'existe plus au Référentiel est ignoré", () => {
    expect(numerosPourSemaine(["12"], ["lun"], pris({}), ["99"])).toEqual({ lun: "12" });
  });
  it("aucun numéro libre toute la semaine : jour par jour, sinon null", () => {
    expect(numerosPourSemaine(["12", "15"], J, pris({ lun: ["12"], mar: ["15"], mer: ["12", "15"] }), [])).toEqual({
      lun: "15",
      mar: "12",
      mer: null,
    });
  });
});
