import { NextResponse, type NextRequest } from "next/server";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { quartOuDefaut } from "@/lib/quarts";
import { habManquantes, premierNumeroLibre, posteNeTournePas, MSG_HORS_CYCLE } from "@/lib/placement-helpers";
import { verifierIdSite } from "@/lib/verifier-site";

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
  const numeroSaisi = poste_id ? String(body?.numero ?? "").trim() || null : null;

  // Le Planning affecte a un POSTE sans choisir de place : le champ `numero` est
  // alors ABSENT de la requete, et on prend le premier numero libre dans l'ordre du
  // referentiel. L'ecran Placement, lui, envoie toujours `numero` — une valeur pour
  // une case numerotee, `null` pour la zone « sans numero ». Tester `undefined` et
  // non la faussete distingue les deux : sinon un depot volontaire hors numero se
  // verrait attribuer une place automatiquement.
  const numeroAuto = !!poste_id && body?.numero === undefined;

  // Perf (2026-09-28) : toutes les LECTURES de controle sont independantes — elles
  // partent ENSEMBLE (un aller-retour au lieu de sept a neuf en serie). Les
  // verdicts sont ensuite examines dans le MEME ORDRE qu'avant : meme reponse,
  // memes codes d'erreur. Aucune ecriture n'a lieu avant ces verdicts.
  //
  // Validation cross-site (audit S2) : les UUID injectes par le client doivent
  // appartenir au site de l'appelant. Sans ca, le service_role ecrirait un
  // placement rattache a un poste/equipe d'un autre site (grille silencieusement
  // cassee cote lecture). Les lectures annexes (numero, placement existant,
  // habilitations) sont toutes bornees par site_id : rien ne fuit d'un autre site
  // meme si un identifiant est refuse ensuite.
  const siteId = profile.siteId;
  const quartVise = poste_id ? quartOuDefaut(quart_code, quarts) : null;
  const [errPers, errPo, errEq, errMo, numeroLibre, existingRes, manquantes, cycleRes] = await Promise.all([
    verifierIdSite(supabase, "personne", personne_id, siteId, "Personne"),
    poste_id ? verifierIdSite(supabase, "poste", poste_id, siteId, "Poste") : null,
    body?.equipe_id ? verifierIdSite(supabase, "equipe", body.equipe_id, siteId, "Equipe") : null,
    motif_absence_id ? verifierIdSite(supabase, "motif_absence", motif_absence_id, siteId, "Motif") : null,
    numeroAuto && poste_id ? premierNumeroLibre(supabase, poste_id, jour, quart_code, personne_id, quarts, siteId) : null,
    poste_id
      ? supabase
          .from("placement")
          .select("poste_id, quart_code")
          .eq("personne_id", personne_id)
          .eq("jour", jour)
          .eq("site_id", siteId)
          .maybeSingle<{ poste_id: string | null; quart_code: string | null }>()
      : null,
    poste_id ? habManquantes(supabase, personne_id, poste_id, siteId) : ([] as string[]),
    poste_id && quartVise ? posteNeTournePas(supabase, poste_id, quartVise, siteId) : false,
  ]);
  if (errPers) return NextResponse.json({ error: errPers }, { status: 400 });
  if (errPo) return NextResponse.json({ error: errPo }, { status: 400 });
  if (errEq) return NextResponse.json({ error: errEq }, { status: 400 });
  if (errMo) return NextResponse.json({ error: errMo }, { status: 400 });
  // Cycle du poste (2026-09-28) : un poste marqué « – » sur ce quart au Référentiel
  // n'existe pas sur ce quart. L'écran ne le propose pas ; le serveur le refuse
  // aussi — sinon la personne devient invisible au Placement (poste non dessiné).
  // 422 et non 409 : au Placement, 409 signifie « déjà placé sur un autre quart ».
  if (cycleRes) return NextResponse.json({ error: MSG_HORS_CYCLE }, { status: 422 });
  const numero_rotation = numeroAuto ? numeroLibre : numeroSaisi;

  // Une personne placee sur un poste un quart ne peut pas etre placee sur un
  // poste d'un autre quart le meme jour (legacy quart null = matin).
  if (poste_id) {
    const existing = existingRes?.data;
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
  // (`manquantes` lu avec les autres controles ci-dessus.)
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
