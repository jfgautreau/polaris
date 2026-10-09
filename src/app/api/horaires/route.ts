import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

// POST /api/horaires { cells: [{ poste_id, quart_code, jour, debut, fin, debutN?, finN? }] }
// Enregistrement dynamique (par case ou par lot). Une case porte l'horaire
// standard ET sa variante « après une nuit » (0087, debutN / finN) : l'écran
// envoie toujours les quatre, rien n'est écrasé par omission. Tout vide => la
// case est effacee. RLS horaire_poste = admin only en ecriture -> client admin, apres
// controle admin ou droit "horaires: write".
type Cell = { poste_id?: string; quart_code?: string; jour?: number; debut?: string; fin?: string; debutN?: string; finN?: string };
// Horaire d'une PLACE (0088) : numéro de rotation du poste, toute la semaine.
type Place = { poste_id?: string; quart_code?: string; numero?: string; debut?: string; fin?: string; debutN?: string; finN?: string };

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  const ok = profile && (await canWriteModule(profile.role, "horaires"));
  if (!ok) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { cells?: Cell[]; places?: Place[] } | null;
  const cells = body?.cells ?? [];
  const places = body?.places ?? [];

  const supabase = getAdminClient();
  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const site_id = profile!.siteId;

  const ups: {
    poste_id: string;
    quart_code: string;
    jour: number;
    debut: string | null;
    fin: string | null;
    debut_apres_nuit: string | null;
    fin_apres_nuit: string | null;
    site_id: string;
  }[] = [];
  const dels: { poste_id: string; quart_code: string; jour: number }[] = [];
  for (const c of cells) {
    const poste_id = String(c.poste_id ?? "");
    const quart_code = String(c.quart_code ?? "");
    const jour = Number(c.jour);
    if (!poste_id || !quart_code || !Number.isInteger(jour) || jour < 0 || jour > 6) continue;
    const debut = String(c.debut ?? "").trim();
    const fin = String(c.fin ?? "").trim();
    const debutN = String(c.debutN ?? "").trim();
    const finN = String(c.finN ?? "").trim();
    if (debut || fin || debutN || finN)
      ups.push({ poste_id, quart_code, jour, debut: debut || null, fin: fin || null, debut_apres_nuit: debutN || null, fin_apres_nuit: finN || null, site_id });
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

  // Horaires par place (0088) : même règle, quatre bornes, tout vide = retrait.
  const upsPl: { poste_id: string; quart_code: string; numero: string; debut: string | null; fin: string | null; debut_apres_nuit: string | null; fin_apres_nuit: string | null; site_id: string }[] = [];
  const delsPl: { poste_id: string; quart_code: string; numero: string }[] = [];
  for (const p of places) {
    const poste_id = String(p.poste_id ?? "");
    const quart_code = String(p.quart_code ?? "");
    const numero = String(p.numero ?? "").trim();
    if (!poste_id || !quart_code || !numero) continue;
    const v = (x?: string) => String(x ?? "").trim() || null;
    const ligne = { debut: v(p.debut), fin: v(p.fin), debut_apres_nuit: v(p.debutN), fin_apres_nuit: v(p.finN) };
    if (ligne.debut || ligne.fin || ligne.debut_apres_nuit || ligne.fin_apres_nuit) upsPl.push({ poste_id, quart_code, numero, ...ligne, site_id });
    else delsPl.push({ poste_id, quart_code, numero });
  }
  if (upsPl.length) {
    // MULTI-SITE : les postes viennent du client, le client est en service_role.
    const { data: connus, error: eP } = await supabase
      .from("poste")
      .select("id")
      .eq("site_id", site_id)
      .in("id", [...new Set(upsPl.map((p) => p.poste_id))])
      .returns<{ id: string }[]>();
    if (eP) return NextResponse.json({ error: eP.message }, { status: 500 });
    const ok = new Set((connus ?? []).map((p) => p.id));
    const valides = upsPl.filter((p) => ok.has(p.poste_id));
    if (valides.length) {
      const { error } = await supabase.from("horaire_place").upsert(valides, { onConflict: "site_id,poste_id,quart_code,numero" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  const effPl = await Promise.all(
    delsPl.map((d) =>
      supabase.from("horaire_place").delete().eq("site_id", site_id).eq("poste_id", d.poste_id).eq("quart_code", d.quart_code).eq("numero", d.numero)
    )
  );
  const ratePl = effPl.find((r) => r.error);
  if (ratePl?.error) return NextResponse.json({ error: ratePl.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, saved: ups.length + upsPl.length, cleared: dels.length + delsPl.length });
}
