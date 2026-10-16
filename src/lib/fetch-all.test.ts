import { describe, it, expect } from "vitest";
import { fetchAll, PAGE_SIZE } from "./fetch-all";

// Fausse requête PostgREST : sert `total` lignes numérotées, tronque chaque
// réponse à PAGE_SIZE comme `db-max-rows`, et compte les appels.
function fausseTable(total: number, erreurA?: number) {
  const appels: number[] = [];
  const makeQuery = () => ({
    range(from: number, to: number) {
      appels.push(from);
      if (erreurA !== undefined && from === erreurA) return Promise.resolve({ data: null, error: { message: "boom" } });
      const data: number[] = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) data.push(i);
      return Promise.resolve({ data, error: null });
    },
  });
  return { makeQuery, appels };
}

describe("fetchAll", () => {
  it("un seul appel sous le plafond", async () => {
    const t = fausseTable(420);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(420);
    expect(t.appels).toEqual([0]);
  });

  it("table vide", async () => {
    const t = fausseTable(0);
    expect(await fetchAll(t.makeQuery)).toEqual([]);
    expect(t.appels).toEqual([0]);
  });

  it("toutes les lignes, dans l'ordre, sans doublon (grand volume)", async () => {
    const total = 22_345;
    const t = fausseTable(total);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(total);
    expect(rows.every((v, i) => v === i)).toBe(true);
  });

  it("multiple exact du plafond : s'arrête sur la tranche vide", async () => {
    const t = fausseTable(PAGE_SIZE * 3);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(PAGE_SIZE * 3);
  });

  it("juste au-dessus du plafond : 1 + 3 appels, pas 1 + 8", async () => {
    const t = fausseTable(1306);
    expect(await fetchAll(t.makeQuery)).toHaveLength(1306);
    expect(t.appels).toEqual([0, 1000, 2000, 3000]);
  });

  it("jusqu'à 4 000 lignes : toujours 4 appels", async () => {
    const t = fausseTable(3177);
    expect(await fetchAll(t.makeQuery)).toHaveLength(3177);
    expect(t.appels).toHaveLength(4);
  });

  it("au-delà : vagues de 8 après la première de 3", async () => {
    const t = fausseTable(4500);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(4500);
    expect(rows.every((v, i) => v === i)).toBe(true);
    expect(t.appels).toHaveLength(1 + 3 + 8);
  });

  it("propage l'erreur d'une tranche", async () => {
    const t = fausseTable(5000, 2000);
    await expect(fetchAll(t.makeQuery)).rejects.toThrow("boom");
  });
});

// Fausse requête « postgrest-js » : comprend `setHeader("Prefer", "count=exact")`
// et renvoie alors le total avec la tranche. `totalVu` simule un total devenu
// faux pendant la lecture (lignes ajoutées ou retirées entre deux tranches).
function fausseTableComptee(total: number, totalVu = total, preferExistant?: string) {
  const appels: number[] = [];
  const prefers: string[] = [];
  const makeQuery = () => {
    const headers = new Headers(preferExistant ? { Prefer: preferExistant } : {});
    let compter = false;
    const q = {
      headers,
      setHeader(name: string, value: string) {
        headers.set(name, value);
        if (name === "Prefer") {
          prefers.push(value);
          compter = /count=exact/.test(value);
        }
        return q;
      },
      range(from: number, to: number) {
        appels.push(from);
        const data: number[] = [];
        for (let i = from; i <= Math.min(to, total - 1); i++) data.push(i);
        return Promise.resolve({ data, error: null, count: compter ? totalVu : null });
      },
    };
    return q;
  };
  return { makeQuery, appels, prefers };
}

describe("fetchAll avec le total (Prefer: count=exact)", () => {
  it("sous le plafond : un seul appel, le total est demandé", async () => {
    const t = fausseTableComptee(420);
    expect(await fetchAll(t.makeQuery)).toHaveLength(420);
    expect(t.appels).toEqual([0]);
    expect(t.prefers).toEqual(["count=exact"]);
  });

  it("exactement les tranches utiles, aucune vide (5 646 lignes = 6 appels)", async () => {
    const t = fausseTableComptee(5646);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(5646);
    expect(rows.every((v, i) => v === i)).toBe(true);
    expect(t.appels).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });

  it("multiple exact du plafond : pas de tranche vide pour conclure", async () => {
    const t = fausseTableComptee(PAGE_SIZE * 3);
    expect(await fetchAll(t.makeQuery)).toHaveLength(PAGE_SIZE * 3);
    expect(t.appels).toEqual([0, 1000, 2000]);
    const u = fausseTableComptee(PAGE_SIZE);
    expect(await fetchAll(u.makeQuery)).toHaveLength(PAGE_SIZE);
    expect(u.appels).toEqual([0]);
  });

  it("grand volume : tout, dans l'ordre, sans tranche de trop", async () => {
    const t = fausseTableComptee(22_345);
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(22_345);
    expect(rows.every((v, i) => v === i)).toBe(true);
    expect(t.appels).toHaveLength(23);
  });

  it("lignes ajoutées après le 1er appel : lecture arrêtée au total annoncé", async () => {
    // Même résultat qu'une lecture faite juste avant l'ajout (cf. fetch-all.ts).
    const t = fausseTableComptee(3500, 3000); // total annoncé 3 000, 3 500 ensuite
    const rows = await fetchAll(t.makeQuery);
    expect(rows).toHaveLength(3000);
    expect(rows.every((v, i) => v === i)).toBe(true);
    expect(t.appels).toEqual([0, 1000, 2000]);
  });

  it("lignes retirées pendant la lecture : arrêt sur la tranche incomplète", async () => {
    const t = fausseTableComptee(2500, 4200); // total annoncé 4 200, 2 500 en réalité
    expect(await fetchAll(t.makeQuery)).toHaveLength(2500);
    expect(t.appels).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it("complète un en-tête Prefer existant au lieu de l'écraser", async () => {
    const t = fausseTableComptee(10, 10, "handling=strict");
    await fetchAll(t.makeQuery);
    expect(t.prefers).toEqual(["handling=strict,count=exact"]);
  });

  it("en-tête ignoré par le serveur (total absent) : découverte par vagues comme avant", async () => {
    const t = fausseTableComptee(4500);
    // Le serveur ne renvoie pas le total : on neutralise le comptage.
    const sansTotal = () => {
      const q = t.makeQuery();
      const range = q.range;
      return { ...q, range: (a: number, b: number) => range(a, b).then((r) => ({ ...r, count: null })) };
    };
    expect(await fetchAll(sansTotal)).toHaveLength(4500);
    expect(t.appels).toHaveLength(1 + 3 + 8);
  });
});
