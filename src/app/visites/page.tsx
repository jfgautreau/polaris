import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite, canRead } from "@/lib/permissions";
import { getAteliersC, getEquipesC, getTypesAgenceC } from "@/lib/refdata";
import { chargerVisites } from "@/lib/visites-data";
import VisitesList from "./VisitesList";

// Visites médicales — écran de suivi (droit `visites`, RH par défaut).
//
// Une seule question : qui doit passer quelle visite, et avant quand ? Le régime
// de chaque personne est CALCULÉ (cf. src/lib/visites.ts) à partir des quarts,
// des postes tenus et des habilitations détenues ; rien n'est saisi à la main
// sinon les dates et le type d'avis.
//
// Les filtres service / équipe passent par l'URL et ne décident que du
// sous-ensemble affiché PAR DÉFAUT : la recherche, côté client, balaie tout
// l'effectif — même pattern que Matrice et Habilitations.
export default async function VisitesPage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; equipe?: string; search?: string }>;
}) {
  const { profile, perms } = await requireModule("visites", "read");
  const sp = await searchParams;

  const supabase = await getServerClient();
  const [donnees, ateliers, equipes] = await Promise.all([
    getTypesAgenceC().then((types) => chargerVisites(supabase, profile.siteId, types)),
    getAteliersC(),
    getEquipesC(),
  ]);

  const displayedIds = donnees.lignes
    .filter((l) => (!sp.equipe || l.equipe_id === sp.equipe) && (!sp.atelier || l.atelier_id === sp.atelier))
    .map((l) => l.id);

  // Quarts et postes servent aux contraintes d'affectation, saisies dans la fiche.
  const [{ data: quarts }, { data: postes }] = await Promise.all([
    supabase.from("quart").select("code, libelle, ordre").eq("site_id", profile.siteId).order("ordre").returns<{ code: string; libelle: string; ordre: number }[]>(),
    supabase.from("poste").select("id, nom").eq("site_id", profile.siteId).eq("actif", true).order("nom").returns<{ id: string; nom: string }[]>(),
  ]);

  return (
    <div className="pagecol">
      <AppHeader role={profile.role} active="/visites" />
      <VisitesList
        lignes={donnees.lignes}
        displayedIds={displayedIds}
        types={donnees.types}
        usages={donnees.usages}
        params={donnees.params}
        aujourdhui={donnees.aujourdhui}
        ateliers={ateliers.map((a) => ({ id: a.id, label: a.nom }))}
        equipes={equipes.map((e) => ({ id: e.id, label: e.nom }))}
        quarts={quarts ?? []}
        postes={postes ?? []}
        atelier={sp.atelier ?? ""}
        equipe={sp.equipe ?? ""}
        recherche={sp.search ?? ""}
        canEdit={canWrite(perms, "visites")}
        lienParam={canRead(perms, "visites_param")}
      />
    </div>
  );
}
