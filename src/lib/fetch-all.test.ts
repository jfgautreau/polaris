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

  it("propage l'erreur d'une tranche", async () => {
    const t = fausseTable(5000, 2000);
    await expect(fetchAll(t.makeQuery)).rejects.toThrow("boom");
  });
});
