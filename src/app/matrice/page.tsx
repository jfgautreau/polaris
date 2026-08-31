import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import { getAteliersC, getEquipesC, getNiveauxC, getNbNiveauxC, getSeuilCompetentC } from "@/lib/refdata";
import { fetchAll } from "@/lib/fetch-all";
import MatricePanel from "./MatricePanel";

type PosteRow = {
  id: string;
  nom: string;
  actif: boolean;
  objectif_polyvalence: number;
  objectif_cible: number;
  ordre_affichage: number;
};
type LigneRow = { id: string; nom: string; atelier_id: string; ordre_affichage: number; poste: PosteRow[] };
type Atelier = { id: string; nom: string };
type Equipe = { id: string; nom: string };
type Personne = { id: string; nom: string; prenom: string; equipe_id: string | null; atelier_id: string | null; type_contrat: string; statut: string };
type MatriceRow = {
  personne_id: string;
  poste_id: string;
  niveau_actuel: number;
  niveau_cible: number;
};

export default async function MatricePage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; equipe?: string }>;
}) {
  const { profile, perms } = await requireModule("matrice", "read");

  const sp = await searchParams;
  const supabase = await getServerClient();
  // Pas de raccourci « role === admin » : c'est la matrice qui accorde le droit,
  // l'admin l'obtient par elle. canEditMatrice ci-dessous en decoule.
  // Droit "matrice: write" (hors chef) : édition complète. Le chef d'équipe garde
  // uniquement son périmètre (via chefEquipes ci-dessous).
  const canEditMatrice = canWrite(perms, "matrice") && profile.role !== "chef_equipe";

  // Lignes (+ postes) eventuellement filtrees par atelier
  let ligneQ = supabase
    .from("ligne")
    .select("id, nom, atelier_id, ordre_affichage, poste(id, nom, actif, objectif_polyvalence, objectif_cible, ordre_affichage)")
    .eq("actif", true)
    .order("nom");
  if (sp.atelier) ligneQ = ligneQ.eq("atelier_id", sp.atelier);

  // Personnes : filtre equipe ET filtre atelier (affectation par defaut du module personnel).
  let persQ = supabase
    .from("personne")
    .select("id, nom, prenom, equipe_id, atelier_id, type_contrat, statut")
    // Actifs + personnes À venir (déjà recrutées, pas encore arrivées) : on veut
    // pouvoir préparer/renseigner leur polyvalence avant l'arrivée.
    .in("statut", ["ACTIF", "A_VENIR"])
    .order("nom");
  if (sp.equipe) persQ = persQ.eq("equipe_id", sp.equipe);
  if (sp.atelier) persQ = persQ.eq("atelier_id", sp.atelier);

  // Vague 1 : tout ce qui est independant part en parallele.
  // Donnees de reference (atelier / equipe / niveaux) servies par le cache.
  const [
    ateliers,
    equipesC,
    { data: lignesData },
    { data: persData },
    { data: chefData },
    niveauLibelles,
    nbNiveaux,
    seuilCompetent,
  ] = await Promise.all([
    getAteliersC(),
    getEquipesC(),
    ligneQ.returns<LigneRow[]>(),
    persQ.returns<Personne[]>(),
    canEditMatrice
      ? Promise.resolve({ data: [] as { equipe_id: string }[] })
      : supabase.from("equipe_chef").select("equipe_id").eq("app_user_id", profile.authId).returns<{ equipe_id: string }[]>(),
    getNiveauxC(),
    getNbNiveauxC(),
    getSeuilCompetentC(),
  ]);
  const equipes: Equipe[] = equipesC.map((e) => ({ id: e.id, nom: e.nom }));
  const personnes = persData ?? [];
  const chefEquipes = new Set((chefData ?? []).map((r) => r.equipe_id));

  // Ordre du referentiel : lignes puis postes par ordre_affichage (fallback nom).
  const byOrdre = <T extends { ordre_affichage?: number; nom: string }>(a: T, b: T) =>
    (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) || a.nom.localeCompare(b.nom);
  const groups = (lignesData ?? [])
    .map((l) => ({
      ligneId: l.id,
      ligneNom: l.nom,
      ligneOrdre: l.ordre_affichage ?? 0,
      postes: [...(l.poste ?? [])]
        .filter((p) => p.actif)
        .sort(byOrdre)
        .map((p) => ({
          id: p.id,
          nom: p.nom,
          objectifActuel: p.objectif_polyvalence ?? 0,
          objectifCible: p.objectif_cible ?? 0,
        })),
    }))
    .filter((g) => g.postes.length > 0)
    .sort((a, b) => a.ligneOrdre - b.ligneOrdre || a.ligneNom.localeCompare(b.ligneNom));

  const posteIds = groups.flatMap((g) => g.postes.map((p) => p.id));

  // Niveaux existants (vague 2 : depend des postes affiches et des personnes)
  const initial: Record<string, { a: number; c: number }> = {};
  if (posteIds.length && personnes.length) {
    const m = await fetchAll<MatriceRow>(() =>
      supabase
        .from("matrice")
        .select("personne_id, poste_id, niveau_actuel, niveau_cible")
        .in("personne_id", personnes.map((p) => p.id))
        .in("poste_id", posteIds)
        .order("id")
        .returns<MatriceRow[]>()
    );
    for (const r of m) {
      initial[`${r.personne_id}:${r.poste_id}`] = { a: r.niveau_actuel, c: r.niveau_cible };
    }
  }

  // Drapeau « sans compétence » — calculé sur TOUS les postes actifs du site,
  // indépendamment du filtre atelier : une personne peut être toute blanche dans
  // l'atelier affiché mais compétente ailleurs. On n'alerte que celles qui n'ont
  // aucun niveau actuel ≥ 1 nulle part. `.gte("niveau_actuel", 1)` exclut d'office
  // le blanc (0) ET la restriction (−1) : une restriction n'est pas une compétence.
  const avecCompetence = new Set<string>();
  if (personnes.length) {
    const rows = await fetchAll<{ personne_id: string }>(() =>
      supabase
        .from("matrice")
        .select("personne_id, poste!inner(actif)")
        .eq("poste.actif", true)
        .gte("niveau_actuel", 1)
        .in("personne_id", personnes.map((p) => p.id))
        .order("id")
        .returns<{ personne_id: string }[]>()
    );
    for (const r of rows) avecCompetence.add(r.personne_id);
  }

  // Perimetre d'edition (chefEquipes recupere en vague 1)
  const gridPersonnes = personnes.map((p) => ({
    id: p.id,
    label: `${p.nom} ${p.prenom}`,
    interim: p.type_contrat === "INTERIM",
    avenir: p.statut === "A_VENIR",
    editable: canEditMatrice || (p.equipe_id != null && chefEquipes.has(p.equipe_id)),
    // Alerte réservée aux ACTIFS : une personne « À venir » sans compétence est normale.
    sansCompetence: p.statut === "ACTIF" && !avecCompetence.has(p.id),
  }));

  return (
    <>
      <div className="pagecol">
        <AppHeader role={profile.role} active="/matrice" />

        {/* La grille, elle, s'etale sur toute la largeur de la fenetre. */}
        <MatricePanel
          groups={groups}
          personnes={gridPersonnes}
          initial={initial}
          canEditObjectif={canEditMatrice}
          ateliers={ateliers.map((a) => ({ id: a.id, label: a.nom }))}
          equipes={equipes.map((e) => ({ id: e.id, label: e.nom }))}
          atelier={sp.atelier ?? ""}
          equipe={sp.equipe ?? ""}
          niveauLibelles={niveauLibelles}
          nbNiveaux={nbNiveaux}
          seuilCompetent={seuilCompetent}
        />
      </div>
    </>
  );
}
