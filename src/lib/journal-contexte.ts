import { cookies } from "next/headers";
import { parRequete } from "@/lib/par-requete";

// Contexte du journal d'audit transmis à la base par en-têtes HTTP (migration
// 0086). PostgREST les expose dans `current_setting('request.headers')`, que lit
// le déclencheur `audit_trigger()`.
//
//   x-polaris-auteur  UUID de l'utilisateur de la requête. Joint aux écritures
//                     du client service_role, qui n'ont pas de session : sans
//                     lui, le journal les signait « Système » (36 % des entrées,
//                     dont tous les changements de droits).
//   x-polaris-lot     UUID d'une opération de masse en cours (copie, import…) :
//                     ses lignes sont regroupées en une seule au Journal.
//
// Portée : la requête HTTP en cours, repérée comme dans par-requete.ts par
// l'objet cookies de Next (même objet pendant toute la requête, libéré avec
// elle). Hors requête (cache de données, génération statique), rien n'est joint.

export const ENTETE_AUTEUR = "x-polaris-auteur";
export const ENTETE_LOT = "x-polaris-lot";

type Lot = { id: string; libelle: string };
const lotsParRequete = new WeakMap<object, Lot>();

async function jarCourant(): Promise<object | null> {
  try {
    return (await cookies()) as unknown as object;
  } catch {
    return null;
  }
}

// Auteur = sujet du jeton de session, vérifié par getClaims() (clés
// asymétriques, sans appel réseau). Client RLS, jamais le client service_role :
// celui-ci passe par ce module pour ses écritures, ce serait circulaire.
const auteurDeRequete = parRequete(async function auteurDeRequete(): Promise<string | null> {
  try {
    const { getServerClient } = await import("@/lib/supabase-server");
    const sb = await getServerClient();
    const { data } = await sb.auth.getClaims();
    const sub = data?.claims?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
});

const ECRITURE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * En-têtes à joindre à une requête PostgREST. Seulement pour une écriture
 * (les lectures n'alimentent pas le journal) et seulement dans une requête
 * HTTP. `avecAuteur` : pour le client service_role ; le client RLS a déjà
 * auth.uid().
 */
export async function entetesJournal(methode: string | undefined, avecAuteur: boolean): Promise<Record<string, string>> {
  if (!ECRITURE.has((methode ?? "GET").toUpperCase())) return {};
  const jar = await jarCourant();
  if (!jar) return {};
  const h: Record<string, string> = {};
  const lot = lotsParRequete.get(jar);
  if (lot) h[ENTETE_LOT] = lot.id;
  if (avecAuteur) {
    const auteur = await auteurDeRequete();
    if (auteur) h[ENTETE_AUTEUR] = auteur;
  }
  return h;
}

/** `fetch` qui joint les en-têtes du journal ; à passer à `createClient`. */
export function fetchJournal(avecAuteur: boolean): typeof fetch {
  return async (input, init) => {
    const methode = init?.method ?? (input instanceof Request ? input.method : undefined);
    const h = await entetesJournal(methode, avecAuteur);
    if (Object.keys(h).length === 0) return fetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(h)) headers.set(k, v);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Exécute une opération de masse comme UN lot du journal : toutes ses
 * écritures portent le même identifiant, puis une ligne de synthèse
 * (`libelle`, nombre de lignes) est ajoutée. Sans effet hors requête.
 */
export async function avecLotJournal<T>(siteId: string, libelle: string, fn: () => Promise<T>): Promise<T> {
  const jar = await jarCourant();
  if (!jar || lotsParRequete.has(jar)) return fn(); // lot déjà ouvert : on s'y range
  const lot: Lot = { id: crypto.randomUUID(), libelle: libelle.slice(0, 200) };
  lotsParRequete.set(jar, lot);
  try {
    return await fn();
  } finally {
    lotsParRequete.delete(jar);
    try {
      const { getAdminClient } = await import("@/lib/supabase-server");
      const auteur = await auteurDeRequete();
      // Synthèse best-effort : un échec ici ne doit pas faire échouer l'opération.
      await getAdminClient().rpc("journal_clore_lot", {
        p_site: siteId,
        p_lot: lot.id,
        p_libelle: lot.libelle,
        p_auteur: auteur,
      });
    } catch {
      /* journal seulement */
    }
  }
}
