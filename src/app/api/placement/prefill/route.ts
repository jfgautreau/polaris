import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWritePlacementData } from "@/lib/permissions";
import { getQuartsC, getRotationRefsC } from "@/lib/refdata";
import { quartParDefaut } from "@/lib/quarts";
import { rotationForWeek } from "@/lib/rotation";
import { parseMonday, weekDays, dowMon } from "@/lib/week";
import { contratCouvreLe, type Periode } from "@/lib/personne-statut";

// POST /api/placement/prefill { semaines?: string[], semaine?: string }
// Pré-remplit le planning : place chaque personne à POSTE FIXE (personne.poste_fixe_id)
// sur son poste, pour les jours ouvrés (lundi→vendredi) des semaines demandées (les 3
// semaines affichées à l'écran), SANS écraser une case déjà remplie (absence,
// non-travaillé, autre poste) ni placer une personne hors de son effectif (contrat ne
// couvrant pas le jour). `semaine` (singulier) reste accepté pour compat.
//
// Le quart n'est PLUS celui affiché : il est déduit de l'ÉQUIPE de la personne —
// quart fixe s'il existe, sinon le quart de la rotation pour cette semaine, sinon le
// quart par défaut. Une personne à poste fixe apparaît ainsi sur son bon quart quel
// que soit le quart affiché au moment du clic.
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

  const body = (await req.json().catch(() => null)) as { semaines?: unknown; semaine?: string } | null;
  const siteId = profile.siteId;
  const supabase = getAdminClient();

  // Lundis demandés : soit la liste `semaines` (les 3 semaines affichées), soit le
  // singulier `semaine` (compat). On ne garde que des dates ISO valides.
  const brutes = Array.isArray(body?.semaines) && body.semaines.length ? body.semaines : [body?.semaine];
  const mondays = [...new Set(brutes.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))];
  // Jours ouvrés lundi→vendredi, semaine par semaine (le quart dépend de la semaine
  // via la rotation). Les postes fixes (direction, maintenance…) ne travaillent pas
  // le week-end ; on ne présume pas de l'ouverture des lignes en Ordonnancement.
  const semaines = mondays.map((m) => ({ monday: m, isos: weekDays(parseMonday(m)).filter((j) => dowMon(j.iso) <= 4).map((j) => j.iso) }));
  const allIsos = [...new Set(semaines.flatMap((s) => s.isos))];
  if (!allIsos.length) return NextResponse.json({ ok: true, crees: 0 });

  const quarts = await getQuartsC();
  const quartDefaut = quartParDefaut(quarts);

  // Personnes à poste fixe, non parties, dont le poste fixe est actif (+ leur équipe).
  const { data: persD } = await supabase
    .from("personne")
    .select("id, equipe_id, poste_fixe_id, poste:poste_fixe_id(actif)")
    .eq("site_id", siteId)
    .not("poste_fixe_id", "is", null)
    .neq("statut", "PARTI")
    .returns<{ id: string; equipe_id: string | null; poste_fixe_id: string; poste: { actif: boolean } | null }[]>();
  const cibles = (persD ?? []).filter((p) => p.poste?.actif !== false);
  if (!cibles.length) return NextResponse.json({ ok: true, crees: 0 });
  const ids = cibles.map((p) => p.id);

  // Cases déjà occupées sur ces semaines (poste, absence ou non-travaillé).
  const { data: existD } = await supabase
    .from("placement")
    .select("personne_id, jour")
    .eq("site_id", siteId)
    .in("jour", allIsos)
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

  // Quart de chaque personne = quart fixe de son équipe, sinon la rotation de la
  // semaine, sinon le quart par défaut. Sans équipe : quart par défaut.
  const { data: eqD } = await supabase
    .from("equipe")
    .select("id, quart_fixe")
    .eq("site_id", siteId)
    .returns<{ id: string; quart_fixe: string | null }[]>();
  const quartFixe = new Map((eqD ?? []).map((e) => [e.id, e.quart_fixe]));
  const rotRefs = await getRotationRefsC();
  const rotByMonday = new Map(mondays.map((m) => [m, rotationForWeek(rotRefs, m)]));
  const quartDe = (equipeId: string | null, monday: string): string => {
    if (!equipeId) return quartDefaut;
    const fixe = quartFixe.get(equipeId);
    if (fixe) return fixe;
    return (rotByMonday.get(monday) ?? {})[equipeId] ?? quartDefaut;
  };

  const rows: Record<string, unknown>[] = [];
  for (const sem of semaines) {
    for (const p of cibles) {
      const cs = contratsDe.get(p.id) ?? [];
      const q = quartDe(p.equipe_id, sem.monday);
      for (const iso of sem.isos) {
        if (occ.has(`${p.id}:${iso}`)) continue;
        // Aucun contrat renseigné : on fait confiance (données historiques).
        if (cs.length && !contratCouvreLe(cs, iso)) continue;
        rows.push({
          personne_id: p.id,
          jour: iso,
          poste_id: p.poste_fixe_id,
          quart_code: q,
          equipe_id: p.equipe_id ?? null,
          created_by: profile.authId,
          site_id: siteId,
        });
      }
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
