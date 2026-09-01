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
// Pré-remplit une (ou plusieurs) semaine(s) affichée(s). Deux passes, dans cet
// ordre — d'où le libellé « TP + postes fixes » du bouton :
//
//   1. TEMPS PARTIEL : matérialise les jours de TP (jour entier off) en vraies
//      lignes `placement.tp`, et pose le marqueur `tp_charge` de la semaine.
//      Une fois la semaine « chargée », le planning n'affiche plus le TP calculé
//      mais ces lignes réelles — désormais DÉPLAÇABLES au glisser-déposer, et le
//      recalcul ne les recrée plus. La règle métier est identique à l'affichage
//      calculé (src/app/planning/page.tsx) : « TP » = journée entière off OU
//      équipe, cette semaine, sur le créneau que la personne ne travaille pas.
//   2. POSTES FIXES : place chaque personne à poste fixe (personne.poste_fixe_id)
//      sur son poste, jours ouvrés lundi→vendredi, au quart de son équipe.
//
// Les deux passes insèrent en `ignoreDuplicates` (onConflict personne,jour) :
// jamais d'écrasement. Faire le TP D'ABORD garantit qu'un jour de TP d'une
// personne à poste fixe reste un TP (le poste fixe saute la case déjà prise).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Écriture « complète » (droit Planning OU Placement) : action de masse, client
  // admin. Le chef d'équipe (exclu par canWritePlacementData) ne pré-remplit pas.
  if (!(await canWritePlacementData(profile.role))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { semaines?: unknown; semaine?: string } | null;
  const siteId = profile.siteId;
  const supabase = getAdminClient();
  try {

  // Lundis demandés : la liste `semaines`, ou le singulier `semaine` (compat).
  const brutes = Array.isArray(body?.semaines) && body.semaines.length ? body.semaines : [body?.semaine];
  const mondays = [...new Set(brutes.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))];
  if (!mondays.length) return NextResponse.json({ ok: true, crees: 0 });

  const quarts = await getQuartsC();
  const quartDefaut = quartParDefaut(quarts);
  const rotRefs = await getRotationRefsC();
  const rotByMonday = new Map(mondays.map((m) => [m, rotationForWeek(rotRefs, m)]));

  // Tous les jours (lundi→dimanche) de chaque semaine, + jours ouvrés seuls pour
  // les postes fixes. Le TP peut tomber n'importe quel jour de la semaine.
  const semaines = mondays.map((m) => {
    const jours = weekDays(parseMonday(m));
    return {
      monday: m,
      isosTous: jours.map((j) => j.iso),
      isosOuvres: jours.filter((j) => dowMon(j.iso) <= 4).map((j) => j.iso),
    };
  });
  const allIsos = [...new Set(semaines.flatMap((s) => s.isosTous))];
  if (!allIsos.length) return NextResponse.json({ ok: true, crees: 0 });
  const minIso = allIsos.reduce((a, b) => (a < b ? a : b));
  const maxIso = allIsos.reduce((a, b) => (a > b ? a : b));

  // Créneau (demi-journée) d'un quart : matin / aprem / null (plein). Piloté par
  // quart.creneau (0057), plus codé en dur. Best-effort si la colonne manque.
  const { data: quartRows } = await supabase
    .from("quart")
    .select("code, creneau")
    .eq("site_id", siteId)
    .returns<{ code: string; creneau: string | null }[]>();
  const creneauDeQuart = new Map((quartRows ?? []).map((q) => [q.code, q.creneau]));
  const creneauDe = (q?: string | null): "matin" | "aprem" | null => {
    const c = q ? creneauDeQuart.get(q) : null;
    return c === "matin" || c === "aprem" ? c : null;
  };

  // Équipes (quart fixe éventuel).
  const { data: eqD } = await supabase
    .from("equipe")
    .select("id, quart_fixe")
    .eq("site_id", siteId)
    .returns<{ id: string; quart_fixe: string | null }[]>();
  const quartFixe = new Map((eqD ?? []).map((e) => [e.id, e.quart_fixe]));
  const teamQuart = (equipeId: string | null, monday: string): string | null => {
    if (!equipeId) return null;
    return quartFixe.get(equipeId) ?? (rotByMonday.get(monday) ?? {})[equipeId] ?? null;
  };
  const quartDe = (equipeId: string | null, monday: string): string =>
    teamQuart(equipeId, monday) ?? quartDefaut;

  const isoDow = (iso: string) => {
    const d = new Date(iso + "T00:00").getDay();
    return d === 0 ? 7 : d;
  };

  // ---------- Passe 1 : TEMPS PARTIEL ----------
  type TpCfg = { off?: Record<string, string[]> } | null;
  type TpRow = { id: string; personne_id: string; date_debut: string; date_fin: string | null; tp_config: TpCfg };
  const { data: tpPeriodes } = await supabase
    .from("tp_periode")
    .select("id, personne_id, date_debut, date_fin, tp_config")
    .eq("site_id", siteId)
    .lte("date_debut", maxIso)
    .or(`date_fin.is.null,date_fin.gte.${minIso}`)
    .order("date_debut")
    .returns<TpRow[]>();
  const periodesByPers = new Map<string, TpRow[]>();
  for (const p of tpPeriodes ?? [])
    (periodesByPers.get(p.personne_id) ?? periodesByPers.set(p.personne_id, []).get(p.personne_id)!).push(p);

  // Repli personne.tp_config (personnes temps_partiel sans période migrée) +
  // équipe de tout le monde concerné.
  const { data: tpFallback } = await supabase
    .from("personne")
    .select("id, equipe_id, tp_config")
    .eq("site_id", siteId)
    .eq("temps_partiel", true)
    .returns<{ id: string; equipe_id: string | null; tp_config: TpCfg }[]>();
  const equipeDe = new Map<string, string | null>();
  const fallbackMap = new Map<string, TpCfg>();
  for (const r of tpFallback ?? []) {
    equipeDe.set(r.id, r.equipe_id);
    if (!periodesByPers.has(r.id)) fallbackMap.set(r.id, r.tp_config);
  }
  // Équipe des personnes à période mais non temps_partiel (état rare mais possible).
  const sansEquipe = [...periodesByPers.keys()].filter((id) => !equipeDe.has(id));
  if (sansEquipe.length) {
    const { data: extra } = await supabase
      .from("personne")
      .select("id, equipe_id")
      .eq("site_id", siteId)
      .in("id", sansEquipe)
      .returns<{ id: string; equipe_id: string | null }[]>();
    for (const r of extra ?? []) equipeDe.set(r.id, r.equipe_id);
  }

  const configPourJour = (persId: string, iso: string): TpCfg => {
    const periodes = periodesByPers.get(persId);
    if (periodes) {
      for (const p of periodes)
        if (p.date_debut <= iso && (!p.date_fin || p.date_fin >= iso)) return p.tp_config;
      return null; // trou entre périodes = temps plein
    }
    return fallbackMap.get(persId) ?? null;
  };
  const tpPersonIds = new Set([...periodesByPers.keys(), ...fallbackMap.keys()]);

  // ---------- Passe 2 : POSTES FIXES (personnes + poste actif) ----------
  const { data: persFixe } = await supabase
    .from("personne")
    .select("id, equipe_id, poste_fixe_id, poste:poste_fixe_id(actif)")
    .eq("site_id", siteId)
    .not("poste_fixe_id", "is", null)
    .neq("statut", "PARTI")
    .returns<{ id: string; equipe_id: string | null; poste_fixe_id: string; poste: { actif: boolean } | null }[]>();
  const cibles = (persFixe ?? []).filter((p) => p.poste?.actif !== false);

  // Contrats de toutes les personnes concernées (TP + postes fixes) : ne pas
  // placer hors effectif (avant l'arrivée, dans un trou, après le départ).
  const idsContrats = [...new Set([...tpPersonIds, ...cibles.map((p) => p.id)])];
  const contratsDe = new Map<string, Periode[]>();
  if (idsContrats.length) {
    const { data: cpD } = await supabase
      .from("contrat_periode")
      .select("personne_id, date_debut, date_fin")
      .eq("site_id", siteId)
      .in("personne_id", idsContrats)
      .returns<{ personne_id: string; date_debut: string | null; date_fin: string | null }[]>();
    for (const c of cpD ?? [])
      (contratsDe.get(c.personne_id) ?? contratsDe.set(c.personne_id, []).get(c.personne_id)!).push(c as Periode);
  }
  const dansEffectif = (persId: string, iso: string): boolean => {
    const cs = contratsDe.get(persId) ?? [];
    // Aucun contrat renseigné : on fait confiance (données historiques).
    return !cs.length || contratCouvreLe(cs, iso);
  };

  // Cases déjà occupées (toutes personnes concernées) : ni TP ni poste fixe ne
  // les touche. Recalcul implicite entre passes via ignoreDuplicates au niveau DB.
  const occ = new Set<string>();
  if (idsContrats.length) {
    const { data: existD } = await supabase
      .from("placement")
      .select("personne_id, jour")
      .eq("site_id", siteId)
      .in("jour", allIsos)
      .in("personne_id", idsContrats)
      .returns<{ personne_id: string; jour: string }[]>();
    for (const r of existD ?? []) occ.add(`${r.personne_id}:${r.jour}`);
  }

  // Construire les lignes TP.
  const tpRows: Record<string, unknown>[] = [];
  for (const persId of tpPersonIds) {
    const eq = equipeDe.get(persId) ?? null;
    for (const sem of semaines) {
      for (const iso of sem.isosTous) {
        if (occ.has(`${persId}:${iso}`)) continue;
        const cfg = configPourJour(persId, iso);
        if (!cfg) continue;
        const dayOff = cfg.off?.[String(isoDow(iso))] ?? [];
        if (!dayOff.length) continue;
        const journee = dayOff.includes("matin") && dayOff.includes("aprem");
        const cr = creneauDe(teamQuart(eq, sem.monday));
        const equipeCreneau = !!cr && dayOff.includes(cr);
        if (!(journee || equipeCreneau)) continue;
        if (!dansEffectif(persId, iso)) continue;
        occ.add(`${persId}:${iso}`); // le poste fixe sautera cette case
        tpRows.push({
          personne_id: persId,
          jour: iso,
          tp: true,
          equipe_id: eq,
          created_by: profile.authId,
          site_id: siteId,
        });
      }
    }
  }

  // Construire les lignes postes fixes.
  const posteRows: Record<string, unknown>[] = [];
  for (const sem of semaines) {
    for (const p of cibles) {
      const q = quartDe(p.equipe_id, sem.monday);
      for (const iso of sem.isosOuvres) {
        if (occ.has(`${p.id}:${iso}`)) continue;
        if (!dansEffectif(p.id, iso)) continue;
        occ.add(`${p.id}:${iso}`);
        posteRows.push({
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

  // Insertions (jamais d'écrasement) : TP puis postes fixes.
  const rows = [...tpRows, ...posteRows];
  if (rows.length) {
    const { error } = await supabase
      .from("placement")
      .upsert(rows, { onConflict: "personne_id,jour", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  }

  // Marqueur « TP chargés » de chaque semaine : coupe le calcul virtuel, ce qui
  // rend les TP déplaçables/supprimables sans qu'ils soient recréés.
  const { error: mErr } = await supabase
    .from("tp_charge")
    .upsert(
      mondays.map((m) => ({ site_id: siteId, semaine_lundi: m, charge_par: profile.authId })),
      { onConflict: "site_id,semaine_lundi" },
    );
  // Best-effort UNIQUEMENT sur « table absente / cache PostgREST pas encore
  // rechargé » (migration 0064 juste jouée) : dans ce cas les lignes TP restent
  // et le repli calculé opère. Toute AUTRE erreur du marqueur est surfacée —
  // sinon un marqueur silencieusement perdu laisse le TP non déplaçable.
  const cacheAbsent = mErr && /schema cache|does not exist|42P01|PGRST205/i.test(mErr.message);
  if (mErr && !cacheAbsent) {
    return NextResponse.json({ error: `marqueur tp_charge: ${mErr.message}` }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    crees: rows.length,
    tp: tpRows.length,
    fixe: posteRows.length,
    site: siteId,
    marqueur: mErr ? `ignoré (${mErr.message})` : "posé",
  });
  } catch (e) {
    // Toute exception non prévue est renvoyée en clair : sans ça, le bouton
    // n'affichait qu'un « Échec » muet et le TP restait non déplaçable.
    const msg = e instanceof Error ? `${e.message}` : String(e);
    return NextResponse.json({ error: `prefill: ${msg}` }, { status: 500 });
  }
}
