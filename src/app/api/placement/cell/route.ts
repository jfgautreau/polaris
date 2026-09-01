import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { quartOuDefaut } from "@/lib/quarts";
import { habManquantes, premierNumeroLibre } from "@/lib/placement-helpers";

// POST /api/placement/cell { personne_id, jour, equipe_id, value, forcer }
//   value = ""  -> efface le placement
//   value = "X" -> jour non travaille
//   value = <poste_id> -> affecte au poste
//   forcer = true -> accepte le poste malgre une habilitation manquante/expiree
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifie" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    personne_id?: string;
    jour?: string;
    equipe_id?: string | null;
    quart?: string | null;
    value?: string;
    forcer?: boolean;
    numero?: string | null;
  } | null;

  const personne_id = body?.personne_id;
  const jour = body?.jour;
  const value = body?.value ?? "";
  if (!personne_id || !jour) {
    return NextResponse.json({ error: "Parametres manquants" }, { status: 400 });
  }

  // Ecriture complete (droit Planning OU Placement) -> client admin ; sinon RLS
  // (admin ou chef de l'équipe de la personne). Cette route sert les DEUX ecrans.
  const supabase = (await canWritePlacementData(profile.role)) ? getAdminClient() : await getServerClient();
  // Repli des placements historiques sans `quart_code` (cf. src/lib/quarts.ts).
  const quarts = await getQuartsC();

  if (value === "") {
    const { error } = await supabase
      .from("placement")
      .delete()
      .eq("site_id", profile.siteId)
      .eq("personne_id", personne_id)
      .eq("jour", jour);
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  let poste_id: string | null = null;
  let motif_absence_id: string | null = null;
  let non_travaille = false;
  // « TP » = temps partiel matérialisé (jour entier off). Comme le « NT », ce
  // n'est ni un poste ni une absence : une vraie ligne, donc déplaçable.
  let tp = false;
  if (value === "X") non_travaille = true;
  else if (value === "TP") tp = true;
  else if (value.startsWith("m:")) motif_absence_id = value.slice(2);
  else poste_id = value;

  // Le quart ne s'applique qu'a un placement sur poste (une absence/NT vaut
  // pour toute la journee, tous quarts). Idem pour le numero de rotation.
  const quart_code = poste_id ? (body?.quart ?? null) : null;
  let numero_rotation = poste_id ? String(body?.numero ?? "").trim() || null : null;

  // Le Planning affecte a un POSTE sans choisir de place : le champ `numero` est
  // alors ABSENT de la requete, et on prend le premier numero libre dans l'ordre du
  // referentiel. L'ecran Placement, lui, envoie toujours `numero` — une valeur pour
  // une case numerotee, `null` pour la zone « sans numero ». Tester `undefined` et
  // non la faussete distingue les deux : sinon un depot volontaire hors numero se
  // verrait attribuer une place automatiquement.
  if (poste_id && body?.numero === undefined) {
    numero_rotation = await premierNumeroLibre(supabase, poste_id, jour, quart_code, personne_id, quarts, profile.siteId);
  }

  // Une personne placee sur un poste un quart ne peut pas etre placee sur un
  // poste d'un autre quart le meme jour (legacy quart null = matin).
  if (poste_id) {
    const { data: existing } = await supabase
      .from("placement")
      .select("poste_id, quart_code")
      .eq("personne_id", personne_id)
      .eq("jour", jour)
      .eq("site_id", profile.siteId)
      .maybeSingle<{ poste_id: string | null; quart_code: string | null }>();
    if (existing?.poste_id) {
      const exQ = quartOuDefaut(existing.quart_code, quarts);
      const newQ = quartOuDefaut(quart_code, quarts);
      if (exQ !== newQ) {
        return NextResponse.json(
          { error: "Personne deja placee sur un autre quart ce jour-la." },
          { status: 409 }
        );
      }
    }
  }

  // Habilitations exigees par le poste. Sans confirmation explicite du client, on
  // refuse et on renvoie ce qui manque : c'est ce qui alimente la modale de forcage.
  const manquantes = poste_id ? await habManquantes(supabase, personne_id, poste_id, profile.siteId) : [];
  const forcer = body?.forcer === true;
  if (manquantes.length && !forcer) {
    return NextResponse.json({ error: "Habilitation manquante", manquantes }, { status: 428 });
  }

  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const { error } = await supabase.from("placement").upsert(
    {
      personne_id,
      jour,
      equipe_id: body?.equipe_id ?? null,
      poste_id,
      motif_absence_id,
      non_travaille,
      tp,
      quart_code,
      numero_rotation,
      created_by: profile.authId,
      // Trace d'audit : seul un placement reellement en manque compte comme force.
      forcage_habilitation: manquantes.length > 0,
      forcage_auteur_app_user_id: manquantes.length ? profile.authId : null,
      forcage_le: manquantes.length ? new Date().toISOString() : null,
      site_id: profile.siteId,
    },
    { onConflict: "personne_id,jour" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
