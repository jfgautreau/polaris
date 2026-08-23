import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

// POST /api/personnel/merge { keep_id, dup_id }
// Fusionne deux personnes : repointe tous les rattachements du doublon vers la
// personne gardee, complete les champs vides de celle-ci, puis supprime le
// doublon. Sur conflit d'unicite (meme jour / poste / formation), la personne
// gardee l'emporte (la ligne du doublon est jetee). Reserve a l'ecriture
// complete du module Personnel (admin, ou droit "personnel: write").
const CHUNK = 150;
const chunks = <T>(a: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += CHUNK) out.push(a.slice(i, i + CHUNK));
  return out;
};

type IdRow = { id: string } & Record<string, unknown>;

// Table avec contrainte unique (personne_id, secondaryCol) : on jette les lignes
// du doublon en conflit avec la personne gardee, on repointe les autres.
async function mergeUnique(sb: SupabaseClient, table: string, secondaryCol: string, keep: string, dup: string) {
  const { data: kRows } = await sb.from(table).select(secondaryCol).eq("personne_id", keep).returns<Record<string, unknown>[]>();
  const kSet = new Set((kRows ?? []).map((r) => r[secondaryCol]));
  const { data: dRows } = await sb.from(table).select(`id, ${secondaryCol}`).eq("personne_id", dup).returns<IdRow[]>();
  const toDrop = (dRows ?? []).filter((r) => kSet.has(r[secondaryCol])).map((r) => r.id);
  const toMove = (dRows ?? []).filter((r) => !kSet.has(r[secondaryCol])).map((r) => r.id);
  for (const c of chunks(toDrop)) await sb.from(table).delete().in("id", c);
  for (const c of chunks(toMove)) await sb.from(table).update({ personne_id: keep }).in("id", c);
  return { moved: toMove.length, dropped: toDrop.length };
}
// Table sans unicite : on repointe tout.
async function mergeAll(sb: SupabaseClient, table: string, keep: string, dup: string) {
  const { data } = await sb.from(table).select("id").eq("personne_id", dup).returns<IdRow[]>();
  const ids = (data ?? []).map((r) => r.id);
  for (const c of chunks(ids)) await sb.from(table).update({ personne_id: keep }).in("id", c);
  return { moved: ids.length, dropped: 0 };
}

const IDENT = ["matricule", "numero_badge", "equipe_id", "atelier_id", "date_livret_accueil", "pointure", "commentaire", "sexe", "date_debut", "date_fin"];
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
  const sb = getAdminClient();
  // MULTI-SITE : borne le SELECT initial par site_id. Le service_role
  // bypass la RLS, sans cette borne on pourrait fusionner deux
  // personnes de deux sites différents. Les tables filles étant
  // repointées par personne_id (UUID unique global), la garde ici
  // suffit : si l'un des deux ids appartient à un autre site, le
  // SELECT renvoie < 2 lignes et on refuse.
  const cols = "id, nom, prenom, " + IDENT.join(", ") + ", temps_partiel, tp_type, tp_config, type_contrat";
  const { data: pair } = await sb
    .from("personne")
    .select(cols)
    .in("id", [keep, dup])
    .eq("site_id", profile.siteId)
    .returns<Record<string, unknown>[]>();
  const K = (pair ?? []).find((p) => p.id === keep);
  const D = (pair ?? []).find((p) => p.id === dup);
  if (!K || !D) return NextResponse.json({ error: "Personne introuvable." }, { status: 404 });

  try {
    const moved: Record<string, { moved: number; dropped: number }> = {};
    moved.placement = await mergeUnique(sb, "placement", "jour", keep, dup);
    moved.matrice = await mergeUnique(sb, "matrice", "poste_id", keep, dup);
    moved.personne_competence = await mergeUnique(sb, "personne_competence", "competence_id", keep, dup);
    moved.horaire_exception = await mergeUnique(sb, "horaire_exception", "jour", keep, dup);
    moved.contrat_periode = await mergeAll(sb, "contrat_periode", keep, dup);
    moved.absence = await mergeAll(sb, "absence", keep, dup);

    // Complete les champs vides de la personne gardee avec le doublon.
    const patch: Record<string, unknown> = {};
    for (const c of IDENT) if (empty(K[c]) && !empty(D[c])) patch[c] = D[c];
    if (!K.temps_partiel && D.temps_partiel) {
      patch.temps_partiel = true;
      patch.tp_type = D.tp_type;
      patch.tp_config = D.tp_config;
    }
    if (Object.keys(patch).length) await sb.from("personne").update(patch).eq("id", keep).eq("site_id", profile.siteId);

    // Supprime le doublon (ses rattachements ont ete deplaces).
    const { error } = await sb.from("personne").delete().eq("id", dup).eq("site_id", profile.siteId);
    if (error) throw error;

    return NextResponse.json({ ok: true, moved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
