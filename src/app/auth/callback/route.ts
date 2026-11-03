import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { cheminInterne } from "@/lib/redirection";

// Echange le code OTP (lien d'invitation / recuperation) contre une session,
// puis redirige vers `next` (ex: /reset pour definir le mot de passe).
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  // Chemin interne seulement : `next=//site.com` redirigeait hors de Polaris.
  const next = cheminInterne(searchParams.get("next")) ?? "/";

  if (code) {
    const supabase = await getServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
