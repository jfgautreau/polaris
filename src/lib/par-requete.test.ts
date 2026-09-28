import { describe, it, expect, vi, beforeEach } from "vitest";

// L'objet cookies de Next identifie la requête : on le simule.
let jarCourant: object | null = {};
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!jarCourant) throw new Error("hors requête");
    return jarCourant;
  },
}));

const { parRequete } = await import("./par-requete");

describe("parRequete", () => {
  beforeEach(() => {
    jarCourant = {};
  });

  it("mémorise dans une même requête (appels simultanés compris)", async () => {
    const fn = vi.fn(async (role: string) => `droits:${role}`);
    const m = parRequete(fn);
    const [a, b] = await Promise.all([m("admin"), m("admin")]);
    expect(await m("admin")).toBe("droits:admin");
    expect(a).toBe(b);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("distingue les arguments", async () => {
    const fn = vi.fn(async (role: string) => role);
    const m = parRequete(fn);
    await m("admin");
    await m("rh");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ne partage RIEN entre deux requêtes (deux utilisateurs)", async () => {
    let n = 0;
    const m = parRequete(async () => ++n);
    jarCourant = {};
    expect(await m()).toBe(1);
    jarCourant = {}; // nouvelle requête
    expect(await m()).toBe(2);
  });

  it("ne mémorise pas un échec", async () => {
    let n = 0;
    const m = parRequete(async () => {
      n++;
      if (n === 1) throw new Error("réseau");
      return "ok";
    });
    await expect(m()).rejects.toThrow("réseau");
    expect(await m()).toBe("ok");
  });

  it("hors requête : exécute quand même la fonction", async () => {
    jarCourant = null;
    const m = parRequete(async (x: number) => x * 2);
    expect(await m(21)).toBe(42);
  });
});
