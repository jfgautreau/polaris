import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { tropLongue, MSG_TROP_LONGUE } from "@/lib/absence";
import { messageErreur } from "@/lib/erreurs";

// POST /api/absence { op, ... }
// op = "save"   { personne_id, date_debut, date_fin, motif_absence_id, commentaire }
//      -> cree une absence (plage) et materialise un placement par jour (motif).
// op = "delete" { id }  -> supprime l'absence (cascade : placements lies effaces).
const s = (v: unknown) => String(v ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  const supabase = (await canWriteModule(profile.role, "planning")) ? getAdminClient() : await getServerClient();

  try {
    if (op === "save") {
      const personne_id = s(body.personne_id);
      const date_debut = s(body.date_debut);
      const date_fin = s(body.date_fin);
      const motif_absence_id = orNull(s(body.motif_absence_id));
      const commentaire = orNull(s(body.commentaire));
      if (!personne_id || !date_debut || !date_fin) {
        return NextResponse.json({ error: "Personne, date de début et de fin requises." }, { status: 400 });
      }
      if (date_fin < date_debut) {
        return NextResponse.json({ error: "La date de fin doit être après la date de début." }, { status: 400 });
      }
      if (!motif_absence_id) {
        return NextResponse.json({ error: "Motif d'absence requis." }, { status: 400 });
      }
      if (tropLongue(date_debut, date_fin)) {
        return NextResponse.json({ error: MSG_TROP_LONGUE }, { status: 400 });
      }

      // Creation de la plage ET materialisation d'un placement par jour, en UNE
      // transaction (fonction `creer_absence`, migration 0037). L'ancien rollback
      // manuel — supprimer l'absence si la materialisation echouait — pouvait
      // lui-meme echouer et laisser une absence sans jours.
      const { data: id, error } = await supabase.rpc("creer_absence", {
        p_personne: personne_id,
        p_motif: motif_absence_id,
        p_debut: date_debut,
        p_fin: date_fin,
        p_commentaire: commentaire,
        p_auteur: profile.authId,
        // Multi-site : la fonction SQL exige un site_id. En service_role
        // (getAdminClient), auth.uid() est NULL donc current_site_id()
        // ne peut pas le trouver — on le passe explicitement depuis le
        // profil de l'utilisateur (cf. 0044).
        p_site: profile.siteId,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, row: { id, personne_id, motif_absence_id, date_debut, date_fin, commentaire } });
    }

    if (op === "update") {
      const id = s(body.id);
      const date_debut = s(body.date_debut);
      const date_fin = s(body.date_fin);
      const motif_absence_id = orNull(s(body.motif_absence_id));
      const commentaire = orNull(s(body.commentaire));
      if (!id || !date_debut || !date_fin) {
        return NextResponse.json({ error: "id et dates requis." }, { status: 400 });
      }
      if (date_fin < date_debut) {
        return NextResponse.json({ error: "La date de fin doit être après la date de début." }, { status: 400 });
      }
      if (!motif_absence_id) {
        return NextResponse.json({ error: "Motif d'absence requis." }, { status: 400 });
      }
      if (tropLongue(date_debut, date_fin)) {
        return NextResponse.json({ error: MSG_TROP_LONGUE }, { status: 400 });
      }

      // Mise a jour de la plage ET rematerialisation des jours, en UNE
      // transaction (fonction `maj_absence`, migration 0037). Auparavant, la
      // suppression des anciens jours precedait leur recreation en deux requetes
      // distinctes : un echec laissait l'absence visible dans sa liste mais
      // DISPARUE du planning, sans message.
      const { error } = await supabase.rpc("maj_absence", {
        p_id: id,
        p_motif: motif_absence_id,
        p_debut: date_debut,
        p_fin: date_fin,
        p_commentaire: commentaire,
        p_auteur: profile.authId,
        // Idem creer_absence : contexte site explicite en service_role.
        p_site: profile.siteId,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // Suppression d'une periode NON declaree : la personne a des jours d'absence
    // saisis directement au planning, on efface les placements correspondants
    // dans l'intervalle (motif optionnel, pour ne pas emporter une autre absence
    // qui commencerait le meme jour).
    if (op === "delete-jours") {
      const personne_id = s(body.personne_id);
      const date_debut = s(body.date_debut);
      const date_fin = s(body.date_fin);
      const motif_absence_id = orNull(s(body.motif_absence_id));
      if (!personne_id || !date_debut || !date_fin) {
        return NextResponse.json({ error: "Personne et dates requises." }, { status: 400 });
      }
      let q = supabase
        .from("placement")
        .delete()
        .eq("site_id", profile.siteId)
        .eq("personne_id", personne_id)
        .gte("jour", date_debut)
        .lte("jour", date_fin)
        .not("motif_absence_id", "is", null);
      if (motif_absence_id) q = q.eq("motif_absence_id", motif_absence_id);
      const { error } = await q;
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (op === "conflits") {
      // Vérifie s'il existe déjà des affectations sur poste pour cette personne
      // dans l'intervalle proposé. On IGNORE les jours déjà pris par des
      // absences (motif_absence_id != null) et on peut ignorer une absence
      // précise (édition d'une période existante).
      const personne_id = s(body.personne_id);
      const date_debut = s(body.date_debut);
      const date_fin = s(body.date_fin);
      const excludeAbsenceId = orNull(s(body.exclure_absence_id));
      if (!personne_id || !date_debut || !date_fin) {
        return NextResponse.json({ error: "Personne et dates requises." }, { status: 400 });
      }
      let q = supabase
        .from("placement")
        .select("jour, poste_id, absence_id")
        .eq("site_id", profile.siteId)
        .eq("personne_id", personne_id)
        .gte("jour", date_debut)
        .lte("jour", date_fin)
        .not("poste_id", "is", null)
        .is("motif_absence_id", null);
      if (excludeAbsenceId) q = q.neq("absence_id", excludeAbsenceId);
      const { data, error } = await q;
      if (error) throw error;
      const jours = (data ?? []).map((r) => r.jour as string);
      return NextResponse.json({ ok: true, jours });
    }

    if (op === "delete") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      // Cascade : les placements lies (absence_id) sont supprimes par la FK.
      const { error } = await supabase.from("absence").delete().eq("id", id).eq("site_id", profile.siteId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
  } catch (e) {
    // Les erreurs Supabase portent un `code` : on le traduit plutot que de
    // renvoyer le message brut de Postgres a l'ecran.
    const pg = e as { code?: string; message?: string; details?: string | null };
    const msg = messageErreur({ code: pg?.code, message: pg?.message ?? "Erreur", details: pg?.details ?? null });
    return NextResponse.json({ error: msg ?? "Erreur" }, { status: 403 });
  }
}
