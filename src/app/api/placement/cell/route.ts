import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { parseNumeros } from "@/lib/numeros-rotation";
import { getQuartsC } from "@/lib/refdata";
import { quartOuDefaut, memeQuart, type QuartRef } from "@/lib/quarts";

type SupabaseClient = Awaited<ReturnType<typeof getServerClient>>;

// Habilitations exigees par le poste que la personne n'a pas (ou plus). Recalcule
// ici plutot que de croire le client : le drapeau de forcage sert de trace d'audit.
async function habManquantes(supabase: SupabaseClient, personne_id: string, poste_id: string, siteId: string): Promise<string[]> {
  const { data: reqs } = await supabase
    .from("poste_competence_requise")
    .select("competence_id, competence:competence_id(nom, duree_validite_mois)")
    .eq("poste_id", poste_id)
    .eq("site_id", siteId)
    .returns<{ competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null }[]>();
  if (!reqs?.length) return [];

  const { data: det } = await supabase
    .from("personne_competence")
    .select("competence_id, date_obtention, date_expiration")
    .eq("personne_id", personne_id)
    .eq("site_id", siteId)
    .in("competence_id", reqs.map((r) => r.competence_id))
    .returns<{ competence_id: string; date_obtention: string | null; date_expiration: string | null }[]>();

  const parComp = new Map((det ?? []).map((d) => [d.competence_id, d]));
  return reqs
    .filter((r) => {
      const d = parComp.get(r.competence_id);
      if (!d) return true;
      // date_expiration est stockee a la saisie : repli sur obtention + duree.
      const exp = d.date_expiration ?? addMonthsIso(d.date_obtention, r.competence?.duree_validite_mois);
      return !habValable({ expiration: exp });
    })
    .map((r) => r.competence?.nom ?? "habilitation");
}

// Premier numero de rotation encore libre sur ce poste, ce jour et ce quart.
// `null` si le poste n'est pas numerote, ou si toutes les places numerotees sont
// prises : la personne rejoint alors la zone « sans numero » de la tuile, plutot
// que d'ecraser quelqu'un ou d'inventer un numero absent du referentiel.
async function premierNumeroLibre(
  supabase: SupabaseClient,
  poste_id: string,
  jour: string,
  quart_code: string | null,
  personne_id: string,
  quarts: QuartRef[],
  siteId: string
): Promise<string | null> {
  const { data: poste } = await supabase
    .from("poste")
    .select("numero_rotation")
    .eq("id", poste_id)
    .eq("site_id", siteId)
    .maybeSingle<{ numero_rotation: string | null }>();
  const numeros = parseNumeros(poste?.numero_rotation);
  if (!numeros.length) return null;

  const { data: occ } = await supabase
    .from("placement")
    .select("personne_id, numero_rotation, quart_code")
    .eq("jour", jour)
    .eq("poste_id", poste_id)
    .eq("site_id", siteId)
    .returns<{ personne_id: string; numero_rotation: string | null; quart_code: string | null }[]>();

  // Meme quart uniquement (le repli des placements sans `quart_code` est commun a
  // tous les ecrans, cf. src/lib/quarts.ts), et on ignore la personne qu'on est en
  // train de (re)placer.
  const q = quartOuDefaut(quart_code, quarts);
  const pris = new Set(
    (occ ?? [])
      .filter((r) => r.personne_id !== personne_id && memeQuart(r.quart_code, q, quarts) && r.numero_rotation)
      .map((r) => r.numero_rotation as string)
  );
  return numeros.find((n) => !pris.has(n)) ?? null;
}

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
  if (value === "X") non_travaille = true;
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
