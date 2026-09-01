import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import { fetchAll } from "@/lib/fetch-all";
import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import { requireModule, canWrite } from "@/lib/permissions";
import { parseMonday, weekDays, isoDate, mondayOf, addDays, isoWeekNumber, dowMon, type Jour } from "@/lib/week";
import { getProfils } from "@/lib/semaine-type";
import OrdoGrid from "./OrdoGrid";
import OrdoQuinzaineNav from "./OrdoQuinzaineNav";

type Ligne = {
  id: string;
  nom: string;
  ordre_affichage: number | null;
  atelier: { id: string; nom: string } | null;
  poste: { id: string; actif: boolean }[];
};
type Quart = { code: string; libelle: string; ordre: number; creneau: string | null };

const JOURS_CIBLES = 15; // fenêtre affichée : 15 jours (2 semaines + le lundi suivant).

export default async function OrdonnancementPage({
  searchParams,
}: {
  searchParams: Promise<{ debut?: string }>;
}) {
  const { profile, perms } = await requireModule("ordonnancement", "read");
  const canEdit = canWrite(perms, "ordonnancement");

  const sp = await searchParams;
  // Fenêtre de 15 jours à partir du lundi de la semaine choisie (défaut : semaine courante).
  const start = parseMonday(sp.debut);
  const startIso = isoDate(start);
  // ⚠️ weekDays() ne pose PAS firstOfWeek — on le marque ici (chaque lundi), sans
  // quoi les blocs-semaine ne se découpent pas et le même n° de semaine s'étale
  // sur toute la fenêtre.
  const days: Jour[] = [
    ...weekDays(start),
    ...weekDays(addDays(start, 7)),
    ...weekDays(addDays(start, 14)).slice(0, JOURS_CIBLES - 14),
  ].map((d) => ({ ...d, firstOfWeek: dowMon(d.iso) === 0 }));
  const isos = days.map((d) => d.iso);

  // Blocs-semaine (annee + n0 ISO) pour l'en-tete des tableaux.
  const weekBlocks: { num: number; year: number; span: number }[] = [];
  for (const d of days) {
    if (d.firstOfWeek || weekBlocks.length === 0) {
      const mon = mondayOf(new Date(d.iso + "T00:00"));
      weekBlocks.push({ num: isoWeekNumber(mon), year: addDays(mon, 3).getFullYear(), span: 1 });
    } else {
      weekBlocks[weekBlocks.length - 1].span += 1;
    }
  }

  const supabase = await getServerClient();
  const [{ data: quartsD }, { data: lignesD }, { data: jq }, ov, { data: pqOffD }, profils] = await Promise.all([
    supabase.from("quart").select("code, libelle, ordre, creneau").order("ordre").returns<Quart[]>(),
    supabase
      .from("ligne")
      .select("id, nom, ordre_affichage, atelier:atelier_id(id, nom), poste(id, actif)")
      .eq("actif", true)
      .returns<Ligne[]>(),
    supabase
      .from("jour_quart")
      .select("jour, quart_code, actif")
      .in("jour", isos)
      .returns<{ jour: string; quart_code: string; actif: boolean }[]>(),
    fetchAll<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }>(() =>
      supabase
        .from("ouverture_quart")
        .select("jour, ligne_id, quart_code, ouverte")
        .in("jour", isos)
        .order("jour").order("ligne_id").order("quart_code")
        .returns<{ jour: string; ligne_id: string; quart_code: string; ouverte: boolean }[]>()
    ),
    supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
    getProfils(supabase),
  ]);

  const quarts = quartsD ?? [];
  // Split : la « journée » (pleine journée, mise à part en bas) = le quart sans
  // créneau au plus petit ordre. Les autres (matin / après-midi / nuit) forment
  // les colonnes. Robuste (aucun code en dur) et correct multi-site.
  const journeeQuart =
    [...quarts].filter((q) => !q.creneau).sort((a, b) => a.ordre - b.ordre)[0] ?? null;
  const columnQuarts = quarts.filter((q) => q.code !== journeeQuart?.code);

  const jourQuartState: Record<string, boolean> = {};
  for (const r of jq ?? []) jourQuartState[`${r.quart_code}:${r.jour}`] = r.actif;
  const ouvertureState: Record<string, boolean> = {};
  for (const r of ov) ouvertureState[`${r.quart_code}:${r.ligne_id}:${r.jour}`] = r.ouverte;

  // Lignes triées comme au Référentiel : atelier, puis ordre_affichage, puis nom.
  // -> lignes regroupées par atelier dans la grille.
  const ordreThenNom = (a: Ligne, b: Ligne) =>
    (a.atelier?.nom ?? "").localeCompare(b.atelier?.nom ?? "") ||
    (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) ||
    a.nom.localeCompare(b.nom);

  // Une ligne « tourne » sur un quart si elle a au moins un poste actif non
  // désactivé pour ce quart (référentiel poste_quart, défaut actif).
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));
  const quartsDeLigne = (l: Ligne) =>
    quarts
      .filter((q) => (l.poste ?? []).some((p) => p.actif && !pqOff.has(`${p.id}:${q.code}`)))
      .map((q) => q.code);

  const lignes = (lignesD ?? [])
    .slice()
    .sort(ordreThenNom)
    .map((l) => ({
      id: l.id,
      nom: l.nom,
      atelierNom: l.atelier?.nom ?? "—",
      quarts: quartsDeLigne(l),
    }))
    .filter((l) => l.quarts.length > 0);

  const todayMonday = isoDate(mondayOf());

  return (
    <>
      <div className="pagecol">
      <AppHeader role={profile.role} active="/ordonnancement" />
        <div className="headband headband-top">
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <PageTitle module="ordonnancement">Ordonnancement</PageTitle>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/ordonnancement/semaine-type" className="iconbtn" style={{ padding: "6px 12px" }}>
              ⚙️ Semaine type
            </Link>
            <Link href="/admin/equipes" className="iconbtn" style={{ padding: "6px 12px" }}>
              Rotation des équipes &rarr;
            </Link>
          </div>
        </div>
        <OrdoQuinzaineNav base="/ordonnancement" debut={startIso} todayMonday={todayMonday} days={days} />
        </div>

        <OrdoGrid
          key={startIso}
          days={days}
          weekBlocks={weekBlocks}
          todayIso={isoDate(new Date())}
          currentWeekIsos={Array.from({ length: 7 }, (_, i) => isoDate(addDays(mondayOf(), i)))}
          quarts={quarts}
          columnQuarts={columnQuarts}
          journeeQuart={journeeQuart}
          lignes={lignes}
          jourQuartState={jourQuartState}
          ouvertureState={ouvertureState}
          profils={profils}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
