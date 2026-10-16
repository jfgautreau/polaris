import { describe, it, expect, vi, beforeEach } from "vitest";

// Cache de données Next.js neutralisé : seule la mémoire du processus et le
// repli sont testés ici.
vi.mock("next/cache", () => ({ unstable_cache: <F>(fn: F) => fn }));

const CLE = { kty: "EC", alg: "ES256", kid: "k1", crv: "P-256", x: "x", y: "y" };

async function charger() {
  vi.resetModules();
  return import("./jwks");
}

describe("jwks partagées pour getClaims", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projet.supabase.co";
    vi.restoreAllMocks();
  });

  it("lit une fois puis sert la mémoire du processus", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ keys: [CLE] })));
    const { optionsClaims } = await charger();
    expect(await optionsClaims()).toEqual({ jwks: { keys: [CLE] } });
    expect(await optionsClaims()).toEqual({ jwks: { keys: [CLE] } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("https://projet.supabase.co/auth/v1/.well-known/jwks.json");
  });

  it("échec réseau : aucune option, getClaims fait comme avant", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));
    const { optionsClaims } = await charger();
    expect(await optionsClaims()).toBeUndefined();
  });

  it("réponse en erreur ou sans clé : jamais retenue", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("oups", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [CLE] })));
    const { optionsClaims } = await charger();
    expect(await optionsClaims()).toBeUndefined();
    expect(await optionsClaims()).toBeUndefined();
    // Rien n'a été mémorisé : la lecture suivante est retentée.
    expect(await optionsClaims()).toEqual({ jwks: { keys: [CLE] } });
    expect(f).toHaveBeenCalledTimes(3);
  });
});
