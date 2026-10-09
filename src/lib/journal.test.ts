import { describe, it, expect } from "vitest";
import { champsMontres, decrireElement, minuitParis, valeurLisible, idsReferences, type EntreeJournal } from "./journal";

const base: EntreeJournal = {
  id: 1, app_user_id: "u1", action: "INSERT", table_name: "placement", record_id: "r1",
  old_values: null, new_values: null, created_at: "2026-10-09T08:00:00Z", impersonated_by: null, lot: null, lot_libelle: null,
};
const noms = { p1: "DUPONT Jean", po1: "Conducteur L1", matin: "Matin", u1: "Marie" };

describe("journal — élément en clair", () => {
  it("placement : personne · jour · quart · poste", () => {
    const e = { ...base, new_values: { personne_id: "p1", jour: "2026-10-12", quart_code: "matin", poste_id: "po1" } };
    expect(decrireElement(e, noms)).toBe("DUPONT Jean · 12/10/2026 · Matin · Conducteur L1");
  });
  it("suppression : lit les valeurs d'avant ; référence disparue signalée", () => {
    const e = { ...base, action: "DELETE", old_values: { personne_id: "inconnu", poste_id: "po1" } };
    expect(decrireElement(e, noms)).toBe("(supprimé) · Conducteur L1");
  });
  it("personne : nom, prénom, matricule", () => {
    const e = { ...base, table_name: "personne", new_values: { nom: "MARTIN", prenom: "Léa", matricule: "123" } };
    expect(decrireElement(e, noms)).toBe("MARTIN Léa · 123");
  });
  it("lot : son libellé", () => {
    expect(decrireElement({ ...base, action: "LOT", table_name: "lot", lot_libelle: "Copie du 08/10" }, noms)).toBe("Copie du 08/10");
  });
});

describe("journal — champs et valeurs", () => {
  it("modification : seuls les champs métier changés", () => {
    const e = { ...base, action: "UPDATE", old_values: { poste_id: "a", date_maj: "x", site_id: "s" }, new_values: { poste_id: "b", date_maj: "y", site_id: "s" } };
    expect(champsMontres(e)).toEqual([{ k: "poste_id", avant: "a", apres: "b" }]);
  });
  it("valeurs lisibles", () => {
    expect(valeurLisible("poste_id", "po1", noms)).toBe("Conducteur L1");
    expect(valeurLisible("poste_id", "zz", noms)).toBe("(supprimé)");
    expect(valeurLisible("jour", "2026-10-12", noms)).toBe("12/10/2026");
    expect(valeurLisible("actif", false, noms)).toBe("non");
    expect(valeurLisible("x", null, noms)).toBe("∅");
  });
  it("références à résoudre : clés *_id, auteur, support", () => {
    const e = { ...base, impersonated_by: "sa", new_values: { personne_id: "p1", nom: "x" } };
    expect(idsReferences(e).sort()).toEqual(["p1", "sa", "u1"]);
  });
});

describe("journal — minuit à Paris", () => {
  it("été UTC+2, hiver UTC+1", () => {
    expect(minuitParis("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
    expect(minuitParis("2026-12-01")).toBe("2026-11-30T23:00:00.000Z");
  });
});
