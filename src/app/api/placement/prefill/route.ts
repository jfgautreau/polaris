import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { quartParDefaut } from "@/lib/quarts";
import { parseMonday, weekDays, dowMon } from "@/lib/week";
import { contratCouvreLe, type Periode } from "@/lib/personne-statut";

// POST /api/placement/prefill { semaines?: string[], semaine?: string, quart }
// Pré-remplit le planning : place chaque personne à POSTE FIXE (personne.poste_fixe_id)
// sur son poste, pour les jours ouvrés (lundi→vendredi) des semaines demandées (les 3
// semaines affichées à l'écran) et le quart affiché, SANS écraser une case déjà remplie
// (absence, non-travaillé, autre poste) ni placer une personne hors de son effectif
// (contrat ne couvrant pas le jour). `semaine` (singulier) reste accepté pour compat.
//
// Le placement est unique par (personne, jour) : « déjà rempli » = toute ligne
// existante ce jour-là. On insère donc en `ignoreDuplicates` — jamais d'écrasement.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Écriture « complète » (droit Planning OU Placement) : c'est une action de masse,
  // on exige le client admin. Le chef d'équipe (exclu par canWritePlacementData)
  // ne pré-remplit pas globalement.
  if (!(await canWritePlacementData(profile.role))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { semaines?: unknown; semaine?: string; quart?: string } | null;
  const siteId = profile.siteId;
  const supabase = getAdminClient();

  // Lundis demandés : soit la liste `semaines` (les 3 semaines affichées), soit le
  // singulier `semaine` (compat). On ne garde que des dates ISO valides.
  const brutes = Array.isArray(body?.semaines) && body.semaines.length ? body.semaines : [body?.semaine];
  const mondays = brutes.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x));
  // Jours ouvrés lundi→vendredi de chaque semaine : les postes fixes (direction,
  // maintenance…) ne travaillent pas le week-end. On ne présume pas de l'ouverture
  // des lignes en Ordonnancement : ces postes en sont souvent indépendants.
  const isos = [...new Set(mondays.flatMap((m) => weekDays(parseMonday(m)).filter((j) => dowMon(j.iso) <= 4).map((j) => j.iso)))];
  if (!isos.length) return NextResponse.json({ ok: true, crees: 0 });

  const quarts = await getQuartsC();
  const quart = body?.quart && quarts.some((q) => q.code === body.quart) ? body.quart : quartParDefaut(quarts);

  // Personnes à poste fixe, non parties, dont le poste fixe est actif.
  const { data: persD } = await supabase
    .from("personne")
    .select("id, poste_fixe_id, poste:poste_fixe_id(actif)")
    .eq("site_id", siteId)
    .not("poste_fixe_id", "is", null)
    .neq("statut", "PARTI")
    .returns<{ id: string; poste_fixe_id: string; poste: { actif: boolean } | null }[]>();
  const cibles = (persD ?? []).filter((p) => p.poste?.actif !== false);
  if (!cibles.length) return NextResponse.json({ ok: true, crees: 0 });
  const ids = cibles.map((p) => p.id);

  // Cases déjà occupées cette semaine (poste, absence ou non-travaillé).
  const { data: existD } = await supabase
    .from("placement")
    .select("personne_id, jour")
    .eq("site_id", siteId)
    .in("jour", isos)
    .in("personne_id", ids)
    .returns<{ personne_id: string; jour: string }[]>();
  const occ = new Set((existD ?? []).map((r) => `${r.personne_id}:${r.jour}`));

  // Contrats, pour ne pas placer hors effectif (avant l'arrivée, dans un trou, après le départ).
  const { data: cpD } = await supabase
    .from("contrat_periode")
    .select("personne_id, date_debut, date_fin")
    .eq("site_id", siteId)
    .in("personne_id", ids)
    .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>();
  const contratsDe = new Map<string, Periode[]>();
  for (const c of cpD ?? []) (contratsDe.get(c.personne_id) ?? contratsDe.set(c.personne_id, []).get(c.personne_id)!).push(c as Periode);

  const rows: Record<string, unknown>[] = [];
  for (const p of cibles) {
    const cs = contratsDe.get(p.id) ?? [];
    for (const iso of isos) {
      if (occ.has(`${p.id}:${iso}`)) continue;
      // Aucun contrat renseigné : on fait confiance (données historiques).
      if (cs.length && !contratCouvreLe(cs, iso)) continue;
      rows.push({
        personne_id: p.id,
        jour: iso,
        poste_id: p.poste_fixe_id,
        quart_code: quart,
        equipe_id: null,
        created_by: profile.authId,
        site_id: siteId,
      });
    }
  }
  if (!rows.length) return NextResponse.json({ ok: true, crees: 0 });

  // ignoreDuplicates : n'insère que les (personne, jour) libres, ne touche jamais
  // une case existante — filet supplémentaire au cas d'une écriture concurrente.
  const { error } = await supabase
    .from("placement")
    .upsert(rows, { onConflict: "personne_id,jour", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true, crees: rows.length });
}
