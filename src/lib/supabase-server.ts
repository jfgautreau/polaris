import { parRequete } from "@/lib/par-requete";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getImpersonatedSiteId, IMPERSONATE_HEADER } from "@/lib/impersonation";
import { fetchJournal } from "@/lib/journal-contexte";

// Client serveur lie aux cookies de la requete (lit la session du user appelant).
// `parRequete` : un seul client instancie par requete, meme si plusieurs couches
// (getCurrentProfile, getPermissions, page) l'appellent — y compris dans les
// routes API, ou `cache()` de React ne memorise rien (cf. par-requete.ts).
//
// MULTI-SITE — IMPERSONATION : quand un super_admin est en mode support, le
// middleware (src/proxy.ts) pose un header `x-impersonate-site` sur la
// requete. On le propage vers Supabase via global.headers pour que
// PostgREST le voie via `current_setting('request.headers')`. La fonction
// SQL current_site_id() (migration 0048) l'honore uniquement si l'appelant
// est super_admin.
export const getServerClient = parRequete(async function getServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  // Impersonation lue depuis le COOKIE signé (et non le header) : le middleware
  // ne s'exécute pas sur /api/, donc le header x-impersonate-site y est absent.
  // Le cookie est présent partout. On propage x-impersonate-site vers PostgREST ;
  // current_site_id() (SQL) ne l'honore que si l'appelant est super_admin.
  const impersonatedSite = await getImpersonatedSiteId();
  const extraHeaders: Record<string, string> = impersonatedSite
    ? { [IMPERSONATE_HEADER]: impersonatedSite }
    : {};
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll appele hors contexte mutable (Server Component) -> ignorer.
          }
        },
      },
      // Lot d'une opération de masse en cours (journal, 0086). Pas d'en-tête
      // d'auteur ici : la session fournit déjà auth.uid().
      global: { headers: extraHeaders, fetch: fetchJournal(false) },
    }
  );
});

// Client service_role : bypass RLS. A utiliser UNIQUEMENT dans des routes
// serveur qui ont deja verifie l'autorisation de l'appelant.
//
// Perf (2026-09-28) : UN client partagé par instance serveur au lieu d'un par
// appel. Sans risque de mélange entre utilisateurs : ce client ne porte AUCUNE
// session ni en-tête propre à un appelant (persistSession: false), il agit
// toujours sous le service_role. Le périmètre reste posé par chaque requête
// (.eq("site_id", …)), comme avant.
let adminClient: SupabaseClient | null = null;
export function getAdminClient(): SupabaseClient {
  adminClient ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Journal (0086) : chaque ÉCRITURE porte l'auteur de la requête en cours
      // (et le lot éventuel) — le client lui-même reste sans session ni état.
      global: { fetch: fetchJournal(true) },
    }
  );
  return adminClient;
}
