import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decodeImpersonation, IMPERSONATE_COOKIE, IMPERSONATE_HEADER } from "@/lib/impersonation";

// Convention Next.js 16 : "proxy" (ex-"middleware").
// Rafraichit la session Supabase, resout le site (multi-tenant) et protege
// les routes non publiques.
//
// MULTI-SITE (V1a, cf. tasks/multi-site.md) :
//   - Domaine unique en V1 (bigplann.vercel.app). Le middleware pose un
//     `x-site-id` vers le site historique (SITE_LEBIGNON_ID) sans lecture
//     Supabase — evite un aller-retour DB sur chaque requete.
//   - /platform : back-office super_admin. Protege par verification du
//     profil (est_super_admin=true), sinon redirection vers /login.
//   - Impersonation : le super_admin qui a clique « Entrer » sur un site
//     obtient un cookie `polaris-impersonate` signe. On le lit ici, on
//     verifie sa signature et son TTL, et on pose un header
//     `x-impersonate-site` propage vers PostgREST par getServerClient.
//     `current_site_id()` en SQL n'honore ce header que si l'appelant est
//     super_admin (defense en profondeur, migration 0048).

const SITE_LEBIGNON_ID = "00000000-0000-4000-8000-00000000c0de";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // -------- Résolution du site + header d'impersonation --------
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-site-id", SITE_LEBIGNON_ID);

  const rawImp = req.cookies.get(IMPERSONATE_COOKIE)?.value;
  const impPayload = decodeImpersonation(rawImp);
  if (impPayload) {
    requestHeaders.set(IMPERSONATE_HEADER, impPayload.siteId);
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
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
