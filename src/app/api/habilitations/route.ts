import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerClient, getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { addMonthsIso } from "@/lib/habilitations";

// POST /api/habilitations { personne_id, competence_id, date_obtention, date_autorisation_conduite? }
// Enregistre (ou recycle) une habilitation. Pendant longtemps c'etait une server
// action ; la saisie se fait desormais au clic sur une pastille de la grille, donc
// depuis un composant client -> route API (cf. CLAUDE.md : un <select> controle ne se
// serialise pas de facon fiable dans un <form action={serverAction}>).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    personne_id?: string;
    competence_id?: string;
    date_obtention?: string;
    // Autorisation « remise » : boolean cote client. On stocke la date d'obtention
    // dans date_autorisation_conduite quand coche, null sinon (cf. CLAUDE.md :
    // pas de migration de schema pour un besoin qui tient dans le vieux champ).
    autorisation_remise?: boolean;
    commentaire?: string | null;
  } | null;

  const personne_id = String(body?.personne_id ?? "").trim();
  const competence_id = String(body?.competence_id ?? "").trim();
  const date_obtention = String(body?.date_obtention ?? "").trim();
  const autorisation_remise = body?.autorisation_remise === true;
  const commentaire = (body?.commentaire ?? "").toString().trim() || null;
  if (!personne_id || !competence_id || !date_obtention) {
    return NextResponse.json({ error: "Personne, formation et date de passage sont requises." }, { status: 400 });
  }

  // Ecriture complete (admin / rh) -> client admin ; sinon RLS (chef sur son equipe).
  const supabase = (await canWriteModule(profile.role, "habilitations")) ? getAdminClient() : await getServerClient();

  const { data: comp } = await supabase
    .from("competence")
    .select("duree_validite_mois, type")
    .eq("id", competence_id)
    .eq("site_id", profile.siteId)
    .single<{ duree_validite_mois: number | null; type: string }>();

  // L'echeance est figee a la saisie (cf. CLAUDE.md) : recalculee ici a partir de
  // la duree de validite en vigueur au moment ou l'on enregistre.
  const date_expiration = addMonthsIso(date_obtention, comp?.duree_validite_mois);

  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const { error } = await supabase.from("personne_competence").upsert(
    {
      personne_id,
      competence_id,
      date_obtention,
      date_expiration,
      // Case cochee = on inscrit la date d'obtention comme date d'autorisation ;
      // decochee = null. Aucun champ date propre a l'autorisation cote UI.
      date_autorisation_conduite: autorisation_remise ? date_obtention : null,
      commentaire,
      acquis: comp?.type === "ACQUIS" ? true : null,
      auteur_app_user_id: profile.authId,
      date_maj: new Date().toISOString(),
      site_id: profile.siteId,
    },
    { onConflict: "personne_id,competence_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  revalidatePath("/habilitations");
  return NextResponse.json({ ok: true });
}

// DELETE /api/habilitations { personne_id, competence_id }
// Retire l'habilitation : erreur de saisie, ou perte de l'habilitation a la suite
// d'un incident. On supprime la ligne plutot que de la marquer expiree — une
// habilitation expiree se recycle, une habilitation retiree n'a jamais existe.
export async function DELETE(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    personne_id?: string;
    competence_id?: string;
  } | null;

  const personne_id = String(body?.personne_id ?? "").trim();
  const competence_id = String(body?.competence_id ?? "").trim();
  if (!personne_id || !competence_id) {
    return NextResponse.json({ error: "Personne et formation sont requises." }, { status: 400 });
  }

  const supabase = (await canWriteModule(profile.role, "habilitations")) ? getAdminClient() : await getServerClient();

  const { error } = await supabase
    .from("personne_competence")
    .delete()
    .eq("personne_id", personne_id)
    .eq("competence_id", competence_id)
    .eq("site_id", profile.siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  revalidatePath("/habilitations");
  return NextResponse.json({ ok: true });
}
