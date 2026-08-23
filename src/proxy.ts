import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeImpersonation, IMPERSONATE_COOKIE, IMPERSONATE_HEADER } from "@/lib/impersonation";

// Convention Next.js 16 : "proxy" (ex-"middleware").
// Rafraichit la session Supabase, resout le site (multi-tenant) et protege
// les routes non publiques.
//
// MULTI-SITE (cf. tasks/multi-site.md) :
//   - Domaine unique (bigplann.vercel.app), PAS de sous-domaine. Le site
//     courant est deduit du COMPTE CONNECTE : on pose `x-site-id` depuis
//     `user.app_metadata.site_id`. C'est ce header que getCurrentSite()
//     (src/lib/current-site.ts) lit pour l'affichage et le bornage des
//     routes getAdminClient().
//     ⚠️ On lit app_metadata et NON user_metadata : app_metadata n'est
//     modifiable qu'en service_role (a la creation du compte), jamais par
//     l'utilisateur via supabase.auth.updateUser(). Deriver le site de
//     user_metadata laisserait un compte du site A se declarer site B et
//     lire/ecrire ses donnees via les routes getAdminClient (qui bornent
//     par getCurrentSite().id). app_metadata etant deja dans le JWT rendu
//     par getUser(), la lecture reste gratuite (aucun aller-retour DB).
//     Repli sur le site historique quand il n'y a pas de compte (routes
//     publiques) ou tant que le backfill app_metadata n'a pas tourne.
//   - /platform : back-office super_admin. Protege par verification du
//     profil (est_super_admin=true), sinon redirection vers /login.
//   - Impersonation : le super_admin qui a clique « Entrer » sur un site
//     obtient un cookie `polaris-impersonate` signe. On le lit ici, on
//     verifie sa signature et son TTL, et on pose un header
//     `x-impersonate-site` propage vers PostgREST par getServerClient.
//     `current_site_id()` en SQL n'honore ce header que si l'appelant est
//     super_admin (defense en profondeur, migration 0048). getCurrentSite()
//     lui donne priorite sur `x-site-id`.

const SITE_LEBIGNON_ID = "00000000-0000-4000-8000-00000000c0de";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // -------- En-tetes propages vers le rendu (site + impersonation) --------
  // `x-site-id` est pose PLUS BAS, une fois le compte connu (on a besoin de
  // getUser() pour connaitre son site). Les cookies de session rafraichie
  // sont captures ici puis reportes sur la reponse construite ensuite.
  const requestHeaders = new Headers(req.headers);

  const rawImp = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  const impPayload = decodeImpersonation(rawImp);
  if (impPayload) {
    requestHeaders.set(IMPERSONATE_HEADER, impPayload.siteId);
  }

  let refreshedCookies: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          refreshedCookies = cookiesToSet;
        },
      },
    }
  );

  // Routes publiques (flux d'authentification).
  const isPublic =
    pathname === "/login" ||
    pathname === "/forgot" ||
    pathname === "/reset" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/affichage");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Site courant = site du compte connecte (app_metadata, inviolable).
  const siteFromAccount =
    (user?.app_metadata?.site_id as string | undefined) ?? SITE_LEBIGNON_ID;
  requestHeaders.set("x-site-id", siteFromAccount);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  refreshedCookies.forEach(({ name, value, options }) =>
    res.cookies.set(name, value, options)
  );

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // -------- /platform : super_admin uniquement --------
  // On vérifie le flag `est_super_admin` directement en DB. Un cache
  // d'une seconde côté cookie serait possible mais le middleware
  // s'exécute rarement pour /platform (peu de trafic) : on garde simple.
  if (pathname.startsWith("/platform") && user) {
    const { data: prof } = await supabase
      .from("app_user")
      .select("est_super_admin")
      .eq("user_id", user.id)
      .single<{ est_super_admin: boolean }>();
    if (!prof?.est_super_admin) {
      // Refus discret : redirect vers l'accueil (pas de message pour ne
      // pas révéler l'existence de /platform à un curieux).
      // On efface aussi un éventuel cookie d'impersonation qui traînerait.
      const redirect = NextResponse.redirect(new URL("/", req.url));
      redirect.cookies.delete(IMPERSONATE_COOKIE);
      return redirect;
    }
  }

  // Sécurité : si un cookie d'impersonation existe mais que l'user
  // courant n'est PAS super_admin (ex. dégradation de compte), on
  // efface le cookie sur toute requête protégée.
  if (impPayload && user && !pathname.startsWith("/api/") && !pathname.startsWith("/platform")) {
    const { data: prof } = await supabase
      .from("app_user")
      .select("est_super_admin")
      .eq("user_id", user.id)
      .single<{ est_super_admin: boolean }>();
    if (!prof?.est_super_admin) {
      res.cookies.delete(IMPERSONATE_COOKIE);
    }
  }

  // Affichage couloir (ecran 24/7) : on interdit tout cache en aval (navigateur
  // de la TV, proxy reseau) pour que le F5 / rafraichissement auto montre
  // toujours la derniere version. La page est deja "force-dynamic" cote serveur.
  if (pathname.startsWith("/affichage")) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
