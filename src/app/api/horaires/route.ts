import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

// POST /api/horaires { cells: [{ poste_id, quart_code, jour, debut, fin }] }
// Enregistrement dynamique (par case ou par lot). debut/fin vides => la case est
// effacee. RLS horaire_poste = admin only en ecriture -> client admin, apres
// controle admin ou droit "horaires: write".
type Cell = { poste_id?: string; quart_code?: string; jour?: number; debut?: string; fin?: string };

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  const ok = profile && (await canWriteModule(profile.role, "horaires"));
  if (!ok) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { cells?: Cell[] } | null;
  const cells = body?.cells ?? [];

  const supabase = getAdminClient();
  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const site_id = profile!.siteId;

  const ups: { poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null; site_id: string }[] = [];
  const dels: { poste_id: string; quart_code: string; jour: number }[] = [];
  for (const c of cells) {
    const poste_id = String(c.poste_id ?? "");
    const quart_code = String(c.quart_code ?? "");
    const jour = Number(c.jour);
    if (!poste_id || !quart_code || !Number.isInteger(jour) || jour < 0 || jour > 6) continue;
    const debut = String(c.debut ?? "").trim();
    const fin = String(c.fin ?? "").trim();
    if (debut || fin) ups.push({ poste_id, quart_code, jour, debut: debut || null, fin: fin || null, site_id });
    else dels.push({ poste_id, quart_code, jour });
  }
  if (ups.length) {
    const { error } = await supabase.from("horaire_poste").upsert(ups, { onConflict: "poste_id,quart_code,jour" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Suppressions en parallele (une case videe = ligne retiree). Leurs erreurs
  // etaient ignorees : vider une case pouvait echouer sans que rien ne le dise,
  // et l'horaire restait affiche au rechargement.
  const effacements = await Promise.all(
    dels.map((d) =>
      supabase.from("horaire_poste").delete().eq("site_id", site_id).eq("poste_id", d.poste_id).eq("quart_code", d.quart_code).eq("jour", d.jour)
    )
  );
  const rate = effacements.find((r) => r.error);
  if (rate?.error) return NextResponse.json({ error: rate.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: ups.length, cleared: dels.length });
}
