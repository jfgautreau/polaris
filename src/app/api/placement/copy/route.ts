import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { memeQuart } from "@/lib/quarts";

// POST /api/placement/copy { source, cible, quart, mode }
// Copie les affectations SUR POSTE d'un quart depuis un jour source vers un jour
// cible (upsert par personne/jour). Les absences ne sont pas copiees (specifiques
// au jour). Perimetre : planning:write -> admin ; sinon RLS (chef -> son equipe).
//
// mode = "ecraser"   : la journee cible prend l'etat du jour source (defaut) ;
//        "completer" : ne touche a AUCUNE ligne deja saisie ce jour-la — ni un
//        placement sur poste, ni une absence. Sert a completer un debut de saisie
//        sans defaire ce qui vient d'etre fait a la main.
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { source?: string; cible?: string; quart?: string; mode?: string } | null;
  const source = String(body?.source ?? "");
  const cible = String(body?.cible ?? "");
  const quart = String(body?.quart ?? "");
  const completer = String(body?.mode ?? "") === "completer";
  if (!isDate(source) || !isDate(cible) || !quart) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  if (source === cible) return NextResponse.json({ error: "Jours identiques" }, { status: 400 });

  const supabase = (await canWritePlacementData(profile.role)) ? getAdminClient() : await getServerClient();
  // Repli des placements historiques sans `quart_code` (cf. src/lib/quarts.ts).
  const quarts = await getQuartsC();

  // Placements sur poste du quart, jour source.
  // `numero_rotation` fait partie de la copie : la place occupee dans le poste
  // est une donnee du plan, pas un detail d'affichage. Cette route ayant ete
  // ecrite AVANT la migration 0033 qui l'a introduite, elle la perdait — apres
  // « copier le jour precedent », tout le monde retombait dans la zone « sans
  // numero » et le plan imprime changeait de forme sans raison visible.
  const { data: src, error: e1 } = await supabase
    .from("placement")
    .select("personne_id, poste_id, equipe_id, quart_code, numero_rotation")
    .eq("site_id", profile.siteId)
    .eq("jour", source)
    .not("poste_id", "is", null)
    .returns<{ personne_id: string; poste_id: string; equipe_id: string | null; quart_code: string | null; numero_rotation: string | null }[]>();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 403 });

  // Mode « completer » : on releve d'abord qui a DEJA une ligne le jour cible —
  // poste comme absence — pour ne pas y toucher.
  const dejaSaisi = new Set<string>();
  if (completer) {
    const { data: cbl, error: e0 } = await supabase
      .from("placement")
      .select("personne_id")
      .eq("site_id", profile.siteId)
      .eq("jour", cible)
      .returns<{ personne_id: string }[]>();
    if (e0) return NextResponse.json({ error: e0.message }, { status: 403 });
    for (const r of cbl ?? []) dejaSaisi.add(r.personne_id);
  }

  const rows = (src ?? [])
    .filter((r) => memeQuart(r.quart_code, quart, quarts))
    .filter((r) => !completer || !dejaSaisi.has(r.personne_id))
    .map((r) => ({
      personne_id: r.personne_id,
      jour: cible,
      poste_id: r.poste_id,
      equipe_id: r.equipe_id,
      quart_code: quart,
      numero_rotation: r.numero_rotation,
      motif_absence_id: null,
      non_travaille: false,
      created_by: profile.authId,
      site_id: profile.siteId,
    }));

  if (!rows.length) return NextResponse.json({ ok: true, copied: 0, ignores: dejaSaisi.size });

  const { error: e2 } = await supabase.from("placement").upsert(rows, { onConflict: "personne_id,jour" });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 403 });
  return NextResponse.json({
    ok: true,
    copied: rows.length,
    ignores: dejaSaisi.size,
    rows: rows.map((r) => ({ personne_id: r.personne_id, poste_id: r.poste_id })),
  });
}
