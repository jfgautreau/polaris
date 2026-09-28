import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { habManquantes, premierNumeroLibre, posteNeTournePas, MSG_HORS_CYCLE, refusInactivite } from "@/lib/placement-helpers";
import { quartOuDefaut } from "@/lib/quarts";
import { alertesVisite } from "@/lib/visites-placement";

// POST /api/placement/move
//   { from:{personne_id, jour}, to:{personne_id, jour}, equipe_id, quart, forcer }
//
// DÉPLACE une affectation d'une case vers une autre (entre jours et/ou entre
// personnes) dans le Planning. Règles décidées avec l'utilisateur :
//   • DÉPLACEMENT UNIQUEMENT (la source est vidée) ; pas de copie.
//   • REFUSÉ si la cible porte déjà une ligne (jamais d'écrasement).
//   • Les ABSENCES ne se déplacent pas (défense en profondeur ; le client les
//     rend non-draggables).
//   • Un POSTE déplacé sur une autre personne re-vérifie ses habilitations
//     (428 + forçage), et se voit attribuer le premier numéro de rotation libre.
//
// L'insertion cible précède la suppression source : si l'insertion échoue
// (habilitation, conflit), la source reste en place.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    from?: { personne_id?: string; jour?: string };
    to?: { personne_id?: string; jour?: string };
    equipe_id?: string | null;
    quart?: string | null;
    forcer?: boolean;
  } | null;

  const fromPid = body?.from?.personne_id;
  const fromJour = body?.from?.jour;
  const toPid = body?.to?.personne_id;
  const toJour = body?.to?.jour;
  if (!fromPid || !fromJour || !toPid || !toJour) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }
  if (fromPid === toPid && fromJour === toJour) {
    return NextResponse.json({ ok: true }); // no-op
  }

  const supabase = (await canWritePlacementData(profile.role)) ? getAdminClient() : await getServerClient();
  const quarts = await getQuartsC();

  // Perf (2026-09-28) : ligne source et case cible lues ENSEMBLE ; verdicts
  // examinés dans le même ordre qu'avant (source d'abord, puis cible occupée).
  const [{ data: src }, { data: dst }] = await Promise.all([
    supabase
    .from("placement")
    .select("poste_id, motif_absence_id, non_travaille, tp, quart_code")
    .eq("site_id", profile.siteId)
    .eq("personne_id", fromPid)
    .eq("jour", fromJour)
    .maybeSingle<{ poste_id: string | null; motif_absence_id: string | null; non_travaille: boolean; tp: boolean | null; quart_code: string | null }>(),
    // Cible occupée (n'importe quelle ligne) -> refus, pas d'écrasement.
    supabase
      .from("placement")
      .select("personne_id")
      .eq("site_id", profile.siteId)
      .eq("personne_id", toPid)
      .eq("jour", toJour)
      .maybeSingle<{ personne_id: string }>(),
  ]);
  if (!src) return NextResponse.json({ error: "Rien à déplacer" }, { status: 400 });
  if (src.motif_absence_id) {
    return NextResponse.json({ error: "Une absence ne se déplace pas." }, { status: 400 });
  }

  if (dst) return NextResponse.json({ error: "Case occupée" }, { status: 409 });

  const poste_id = src.poste_id;
  // Le quart et le numéro ne concernent qu'un placement sur poste (une absence/NT/TP
  // vaut pour toute la journée, tous quarts). On garde le quart affiché (body.quart)
  // comme pour la saisie — le déplacement conserve la vue courante.
  const quart_code = poste_id ? (body?.quart ?? src.quart_code ?? null) : null;

  // Habilitations : un poste déplacé sur une autre personne re-vérifie ses droits.
  // Numéro libre lu en même temps (perf) ; il n'est utilisé qu'après le verdict.
  const [manquantes, numero_rotation, horsCycle, inactif, alertesRh] = await Promise.all([
    poste_id ? habManquantes(supabase, toPid, poste_id, profile.siteId) : ([] as string[]),
    poste_id ? premierNumeroLibre(supabase, poste_id, toJour, quart_code, toPid, quarts, profile.siteId) : null,
    // Cycle du poste (2026-09-28) : jamais de poste sur un quart où il ne tourne pas.
    poste_id ? posteNeTournePas(supabase, poste_id, quartOuDefaut(quart_code, quarts), profile.siteId) : false,
    // Personne d'arrivée partie / hors effectif ce jour : pas de déplacement vers elle.
    refusInactivite(supabase, toPid, toJour, profile.siteId),
    // Visites médicales : avertissement SANS détail, si les RH l'ont activé.
    poste_id
      ? alertesVisite(supabase, { personne_id: toPid, poste_id, quart: quart_code, jour: toJour, siteId: profile.siteId })
      : ([] as string[]),
  ]);
  if (inactif) return NextResponse.json({ error: inactif }, { status: 422 });
  if (horsCycle) return NextResponse.json({ error: MSG_HORS_CYCLE }, { status: 422 });
  const forcer = body?.forcer === true;
  if ((manquantes.length || alertesRh.length) && !forcer) {
    return NextResponse.json(
      { error: manquantes.length ? "Habilitation manquante" : "À vérifier avec les RH", manquantes, alertesRh },
      { status: 428 },
    );
  }

  // 1. Insertion de la cible.
  const { error: insErr } = await supabase.from("placement").upsert(
    {
      personne_id: toPid,
      jour: toJour,
      equipe_id: body?.equipe_id ?? null,
      poste_id,
      motif_absence_id: null,
      non_travaille: src.non_travaille === true && !poste_id,
      tp: src.tp === true && !poste_id,
      quart_code,
      numero_rotation,
      created_by: profile.authId,
      forcage_habilitation: manquantes.length > 0,
      forcage_auteur_app_user_id: manquantes.length ? profile.authId : null,
      forcage_le: manquantes.length ? new Date().toISOString() : null,
      site_id: profile.siteId,
    },
    { onConflict: "personne_id,jour" },
  );
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 403 });

  // 2. Suppression de la source (cible posée avec succès).
  const { error: delErr } = await supabase
    .from("placement")
    .delete()
    .eq("site_id", profile.siteId)
    .eq("personne_id", fromPid)
    .eq("jour", fromJour);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 403 });

  return NextResponse.json({ ok: true });
}
