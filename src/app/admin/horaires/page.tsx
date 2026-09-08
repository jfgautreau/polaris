import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import HoraireEditor from "./HoraireEditor";

type PosteRow = { id: string; nom: string; actif: boolean; ordre_affichage: number };
type LigneRow = { id: string; nom: string; ordre_affichage: number; atelier: { id: string; nom: string } | null; poste: PosteRow[] };
type Quart = { code: string; libelle: string };
type HoraireRow = { poste_id: string; quart_code: string; jour: number; debut: string | null; fin: string | null };

export default async function HorairesPage() {
  const { profile, perms } = await requireModule("horaires", "read");

  const supabase = await getServerClient();
  const [{ data: lignesD }, { data: quartsD }, { data: pqOffD }] = await Promise.all([
    supabase
      .from("ligne")
      .select("id, nom, ordre_affichage, atelier:atelier_id(id, nom), poste(id, nom, actif, ordre_affichage)")
      .eq("actif", true)
      .order("nom")
      .returns<LigneRow[]>(),
    supabase.from("quart").select("code, libelle").order("ordre").returns<Quart[]>(),
    // Desactivations poste x quart (defaut actif : la table ne stocke que les off).
    supabase.from("poste_quart").select("poste_id, quart_code").eq("actif", false).returns<{ poste_id: string; quart_code: string }[]>(),
  ]);

  const quarts = (quartsD ?? []).map((q) => ({ code: q.code, libelle: q.libelle }));
  const pqOff = new Set((pqOffD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`));

  // Lignes (avec leurs postes actifs), triees par atelier puis par N° d'affichage
  // (comme le referentiel, le planning et les TV) ; le nom ne departage que les ex aequo.
  // Chaque poste porte la liste de ses quarts ACTIFS (parametres dans le referentiel) :
  // seuls ces quarts sont affiches et editables.
  const ordreThenNom = <T extends { ordre: number; nom: string }>(a: T, b: T) => a.ordre - b.ordre || a.nom.localeCompare(b.nom);
  const lignes = (lignesD ?? [])
    .map((l) => ({
      ligneId: l.id,
      ligneNom: l.nom,
      ligneOrdre: l.ordre_affichage ?? 0,
      atelierId: l.atelier?.id ?? "",
      atelierNom: l.atelier?.nom ?? "(Sans service)",
      postes: [...(l.poste ?? [])]
        .filter((p) => p.actif)
        .sort((a, b) => ordreThenNom({ ordre: a.ordre_affichage ?? 0, nom: a.nom }, { ordre: b.ordre_affichage ?? 0, nom: b.nom }))
        .map((p) => ({ id: p.id, nom: p.nom, quarts: quarts.filter((q) => !pqOff.has(`${p.id}:${q.code}`)).map((q) => q.code) })),
    }))
    .filter((l) => l.postes.length > 0)
    .sort(
      (a, b) =>
        a.atelierNom.localeCompare(b.atelierNom) ||
        ordreThenNom({ ordre: a.ligneOrdre, nom: a.ligneNom }, { ordre: b.ligneOrdre, nom: b.ligneNom })
    );

  const ateliersMap = new Map<string, string>();
  for (const l of lignes) if (l.atelierId) ateliersMap.set(l.atelierId, l.atelierNom);
  const ateliers = [...ateliersMap].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom));

  const allPosteIds = lignes.flatMap((l) => l.postes.map((p) => p.id));

  const initial: Record<string, { debut: string; fin: string }> = {};
  if (allPosteIds.length) {
    const { data: h } = await supabase
      .from("horaire_poste")
      .select("poste_id, quart_code, jour, debut, fin")
      .in("poste_id", allPosteIds)
      .returns<HoraireRow[]>();
    for (const r of h ?? [])
      initial[`${r.poste_id}:${r.quart_code}:${r.jour}`] = { debut: r.debut ?? "", fin: r.fin ?? "" };
  }

  return (
    <>
      <AppHeader role={profile.role} active="/admin/horaires" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <h1>Horaires des postes</h1>
        <p className="muted" style={{ marginBottom: 12 }}>
          Horaires propres à chaque poste, par quart et par jour de la semaine. Seuls les
          quarts activés pour un poste dans le référentiel sont affichés. Affichés à côté de
          chaque personne sur les écrans TV selon le quart où elle est placée. Filtrez par
          atelier, repliez les lignes, copiez/collez un poste vers un autre (même entre
          lignes), recopiez le lundi sur la semaine, ou videz un jour / un quart.
          <strong> Chaque modification est enregistrée automatiquement.</strong>
        </p>

        <LectureSeule actif={!canWrite(perms, "horaires")}>
          <HoraireEditor ateliers={ateliers} lignes={lignes} quarts={quarts} initial={initial} />
        </LectureSeule>
      </div>
    </>
  );
}
