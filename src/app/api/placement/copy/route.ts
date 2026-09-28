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
// ⚠️ Dans LES DEUX modes, une ligne du jour cible qui n'est pas sur poste —
// absence, non travaille (NT) ou temps partiel materialise (TP) — n'est JAMAIS
// touchee (2026-09-28). Avant, « ecraser » remplacait l'absence du jour cible
// par le poste du jour source des qu'on y etait place.
//
// mode = "ecraser"   : les affectations SUR POSTE du jour source remplacent celles
//        deja en place pour les memes personnes (defaut). Rien n'est supprime :
//        une personne placee le jour cible mais absente de la source garde son
//        affectation ;
//        "completer" : ne touche a AUCUNE ligne deja saisie ce jour-la, poste
//        compris. Sert a completer un debut de saisie sans defaire ce qui vient
//        d'etre fait a la main.
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

  // Etat du jour cible, dans les deux modes : une ligne SANS poste (absence, NT,
  // TP) est protegee ; une ligne SUR poste n'est protegee qu'en mode « completer ».
  const protegees = new Set<string>();
  const placees = new Set<string>();
  const { data: cbl, error: e0 } = await supabase
    .from("placement")
    .select("personne_id, poste_id")
    .eq("site_id", profile.siteId)
    .eq("jour", cible)
    .returns<{ personne_id: string; poste_id: string | null }[]>();
  if (e0) return NextResponse.json({ error: e0.message }, { status: 403 });
  for (const r of cbl ?? []) (r.poste_id ? placees : protegees).add(r.personne_id);

  // Cycle des postes (2026-09-28) : une affectation source sur un poste marqué
  // « – » pour ce quart (ne tourne pas) n'est PAS recopiée — sinon la copie
  // propagerait une erreur invisible au Placement de jour en jour.
  const postesSource = [...new Set((src ?? []).map((r) => r.poste_id))];
  const horsCycleIds = new Set<string>();
  if (postesSource.length) {
    const { data: pqD, error: ePq } = await supabase
      .from("poste_quart")
      .select("poste_id")
      .eq("site_id", profile.siteId)
      .eq("quart_code", quart)
      .eq("actif", false)
      .in("poste_id", postesSource)
      .returns<{ poste_id: string }[]>();
    if (ePq) return NextResponse.json({ error: ePq.message }, { status: 403 });
    for (const r of pqD ?? []) horsCycleIds.add(r.poste_id);
  }

  let absencesConservees = 0;
  let dejaPlacees = 0;
  let horsCycle = 0;
  const rows = (src ?? [])
    .filter((r) => memeQuart(r.quart_code, quart, quarts))
    .filter((r) => {
      if (horsCycleIds.has(r.poste_id)) { horsCycle++; return false; }
      if (protegees.has(r.personne_id)) { absencesConservees++; return false; }
      if (completer && placees.has(r.personne_id)) { dejaPlacees++; return false; }
      return true;
    })
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

  if (!rows.length) return NextResponse.json({ ok: true, copied: 0, absencesConservees, dejaPlacees, horsCycle });

  const { error: e2 } = await supabase.from("placement").upsert(rows, { onConflict: "personne_id,jour" });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 403 });
  return NextResponse.json({
    ok: true,
    copied: rows.length,
    absencesConservees,
    dejaPlacees,
    horsCycle,
    rows: rows.map((r) => ({ personne_id: r.personne_id, poste_id: r.poste_id })),
  });
}
