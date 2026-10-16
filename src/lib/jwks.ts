import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

// Clés publiques de signature des jetons Supabase (JWKS), passées à
// `getClaims()` (2026-10-16, journaux Supabase : `/auth/v1/.well-known/jwks.json`
// relu ~6 % des appels). La bibliothèque les garde 10 min en mémoire, mais PAR
// PROCESSUS : chaque instance Vercel (proxy, fonctions) qui démarre les relit,
// jusqu'à 6 fois pour un seul chargement de page.
//
// Trois niveaux, du plus proche au plus loin :
//   1. mémoire du processus (10 min, comme la bibliothèque) ;
//   2. cache de données Next.js, PARTAGÉ entre instances (1 h) ;
//   3. en cas d'échec (cache indisponible, réseau…) : `undefined`, et
//      `getClaims()` fait exactement comme avant (sa propre lecture).
// Sécurité inchangée : ce sont des clés PUBLIQUES, la signature reste vérifiée
// par `getClaims()`. Rotation : si le `kid` d'un jeton est absent des clés
// fournies, la bibliothèque va le chercher elle-même (aucune déconnexion).

type Jwks = NonNullable<NonNullable<Parameters<SupabaseClient["auth"]["getClaims"]>[1]>["jwks"]>;

const TTL_MEMOIRE_MS = 10 * 60 * 1000;
let memoire: { jwks: Jwks; lu: number } | null = null;

// Donnée globale au projet Supabase (une seule paire de clés pour tous les
// sites) : clé = URL du projet, pas de site (cf. whitelist de refdata-cache).
const lireJwks = unstable_cache(
  async (projet: string): Promise<Jwks> => {
    const res = await fetch(`${projet}/auth/v1/.well-known/jwks.json`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`jwks: HTTP ${res.status}`);
    const j = (await res.json()) as { keys?: unknown };
    // Une réponse vide ou inattendue LÈVE : jamais mise en cache.
    if (!Array.isArray(j.keys) || j.keys.length === 0) throw new Error("jwks: aucune clé");
    return { keys: j.keys } as Jwks;
  },
  ["supabase-jwks"],
  { revalidate: 3600 },
);

/** JWKS à passer à `getClaims(undefined, { jwks })`, ou `undefined` (repli). */
export async function jwksPartage(): Promise<Jwks | undefined> {
  if (memoire && Date.now() - memoire.lu < TTL_MEMOIRE_MS) return memoire.jwks;
  try {
    const jwks = await lireJwks(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    memoire = { jwks, lu: Date.now() };
    return jwks;
  } catch {
    return undefined;
  }
}

/** Options de `getClaims()` : les clés partagées si on les a, sinon rien. */
export async function optionsClaims(): Promise<{ jwks: Jwks } | undefined> {
  const jwks = await jwksPartage();
  return jwks ? { jwks } : undefined;
}
