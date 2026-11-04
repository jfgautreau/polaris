import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { messageErreur } from "@/lib/erreurs";
import { syncPersonneFromPeriodes, syncPersonneTP } from "@/lib/personne-reflets";

// POST /api/personnel/merge { keep_id, dup_id }
// Fusionne deux personnes : repointe tous les rattachements du doublon vers la
// personne gardee, complete les champs vides de celle-ci, puis supprime le
// doublon. Sur conflit d'unicite (meme jour / poste / formation), la personne
// gardee l'emporte (la ligne du doublon est jetee). Reserve a l'ecriture
// complete du module Personnel (admin, ou droit "personnel: write").
//
// Toute la fusion se fait dans la fonction SQL `fusionner_personnes` (0092), en
// UNE transaction : un echec ne laisse plus de fiche a moitie fusionnee, et les
// tables filles sont decouvertes par leurs cles etrangeres vers `personne` —
// aucune n'est oubliee (avant : temps partiel, visites… partaient en cascade
// avec le doublon) ni tronquee a 1000 lignes.

const IDENT = ["matricule", "numero_badge", "equipe_id", "atelier_id", "regroupement", "date_livret_accueil", "pointure", "commentaire", "sexe", "date_debut", "date_fin"];
const empty = (v: unknown) => v === null || v === undefined || v === "";

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Meme regle que le reste de l'ecran Personnel : admin OU droit "personnel: write".
  // La fusion est destructrice (le doublon est supprime), elle reste donc reservee
  // a ceux qui peuvent modifier les fiches — pas a ceux qui les consultent.
  if (!(await canWriteModule(profile.role, "personnel"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { keep_id?: string; dup_id?: string } | null;
  const keep = String(body?.keep_id ?? "");
  const dup = String(body?.dup_id ?? "");
  if (!keep || !dup || keep === dup) return NextResponse.json({ error: "Deux personnes distinctes requises." }, { status: 400 });

  // Client admin : la fusion repointe les rattachements de DEUX personnes et
  // supprime le doublon, ce que la RLS (can_edit_personne = admin ou chef de
  // l'equipe) refuserait a un rh/codir. Le garde ci-dessus l'a deja restreint a
  // l'ecriture complete — canWriteModule exclut le chef d'equipe par construction.
  // MULTI-SITE : les deux fiches sont lues bornees au site ; la fonction SQL
  // refait la verification (p_site) avant toute ecriture.
  const sb = getAdminClient();
  const cols = "id, nom, prenom, " + IDENT.join(", ") + ", temps_partiel, tp_type, tp_config";
  const { data: pair, error: lectureErr } = await sb
    .from("personne")
    .select(cols)
    .in("id", [keep, dup])
    .eq("site_id", profile.siteId)
    .returns<Record<string, unknown>[]>();
  if (lectureErr) return NextResponse.json({ error: messageErreur(lectureErr) }, { status: 500 });
  const K = (pair ?? []).find((p) => p.id === keep);
  const D = (pair ?? []).find((p) => p.id === dup);
  if (!K || !D) return NextResponse.json({ error: "Personne introuvable." }, { status: 404 });

  // Complete les champs vides de la personne gardee avec le doublon.
  const patch: Record<string, unknown> = {};
  for (const c of IDENT) if (empty(K[c]) && !empty(D[c])) patch[c] = D[c];
  if (!K.temps_partiel && D.temps_partiel) {
    patch.temps_partiel = true;
    patch.tp_type = D.tp_type;
    patch.tp_config = D.tp_config;
  }

  const { data: moved, error } = await sb.rpc("fusionner_personnes", {
    p_keep: keep,
    p_dup: dup,
    p_site: profile.siteId,
    p_patch: patch,
  });
  if (error) return NextResponse.json({ error: messageErreur(error) }, { status: 403 });

  // La fiche gardee a recu les contrats (et periodes de temps partiel) du
  // doublon : son contrat affiche (type, agence, dates) et son temps partiel
  // sont des reflets a recalculer, comme apres une saisie au Cycle de vie. Le
  // statut, lui, est recalcule en base par trigger. Sans cela, une fiche
  // interimaire fusionnee avec la fiche CDI restait affichee « Interim ».
  try {
    await syncPersonneFromPeriodes(sb, keep, profile.siteId);
    if ((moved as Record<string, unknown> | null)?.tp_periode) await syncPersonneTP(sb, keep, profile.siteId);
  } catch (e) {
    const pg = e as { code?: string; message?: string; details?: string | null };
    return NextResponse.json({ error: `Fiches fusionnées, mais contrat affiché non recalculé : ${messageErreur({ code: pg?.code, message: pg?.message ?? "Erreur", details: pg?.details ?? null })}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, moved });
}
