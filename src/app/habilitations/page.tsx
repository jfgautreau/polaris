import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { fetchAll } from "@/lib/fetch-all";
import { requireModule, canWrite, canRead } from "@/lib/permissions";
import { getAteliersC, getEquipesC } from "@/lib/refdata";
import HabilitationsList from "./HabilitationsList";

type Comp = { id: string; nom: string; duree_validite_mois: number | null; categorie: string | null; groupe: string | null; ordre: number; a_autorisation_conduite: boolean };
type Personne = { id: string; nom: string; prenom: string; equipe_id: string | null; atelier_id: string | null };
type Row = {
  id: string;
  personne_id: string;
  competence_id: string;
  date_obtention: string | null;
  date_expiration: string | null;
  date_autorisation_conduite: string | null;
  commentaire: string | null;
  personne: { nom: string; prenom: string } | null;
  competence: { nom: string; a_recycler: boolean; a_autorisation_conduite: boolean } | null;
};

export default async function HabilitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; equipe?: string }>;
}) {
  const { profile, perms } = await requireModule("habilitations", "read");
  const sp = await searchParams;
  const canEdit = canWrite(perms, "habilitations");

  const supabase = await getServerClient();
  // On charge TOUT l'effectif actif — les filtres atelier/equipe ne sont PAS
  // appliques en base. Ils decident seulement du sous-ensemble affiche PAR DEFAUT
  // (`displayedIds` plus bas) ; la recherche par nom, cote client, balaie
  // l'effectif complet et retrouve donc quelqu'un hors filtre — meme pattern que
  // Matrice de polyvalence, cf. src/app/matrice/page.tsx.
  const persQ = supabase.from("personne").select("id, nom, prenom, type_contrat, equipe_id, atelier_id").eq("statut", "ACTIF").order("nom");

  const [{ data: compsD }, { data: persD }, pcD, ateliers, equipes] = await Promise.all([
    supabase
      .from("competence")
      .select("id, nom, duree_validite_mois, categorie, groupe, ordre, a_autorisation_conduite")
      .eq("a_recycler", true)
      .eq("actif", true)
      .order("ordre")
      .order("nom")
      .returns<Comp[]>(),
    persQ.returns<Personne[]>(),
    fetchAll<Row>(() =>
      supabase
        .from("personne_competence")
        .select("id, personne_id, competence_id, date_obtention, date_expiration, date_autorisation_conduite, commentaire, personne:personne_id(nom, prenom), competence:competence_id(nom, a_recycler, a_autorisation_conduite)")
        .order("id")
        .returns<Row[]>()
    ),
    getAteliersC(),
    getEquipesC(),
  ]);

  const comps = compsD ?? [];
  const personnes = persD ?? [];
  // Sous-ensemble affiche par defaut (filtres equipe + atelier). La recherche par
  // nom (client) passe outre et balaie `personnes` en entier — meme pattern que
  // la Matrice. Toutes les personnes actives sont dans `personnes`, si bien que
  // taper le nom d'un intermittent hors atelier filtre le remonte.
  const displayedIds = personnes
    .filter((p) => (!sp.equipe || p.equipe_id === sp.equipe) && (!sp.atelier || p.atelier_id === sp.atelier))
    .map((p) => p.id);
  // La vue « Liste » repose sur les personnes actives (toutes) ; le filtre par
  // sous-ensemble se fait cote client via `displayedIds`, hors recherche.
  const actifsIds = new Set(personnes.map((p) => p.id));
  const rows = pcD
    .filter((r) => r.competence?.a_recycler && actifsIds.has(r.personne_id))
    .sort((a, b) => (a.date_expiration ?? "9999").localeCompare(b.date_expiration ?? "9999"));

  return (
    <>
      <div className="pagecol">
        <AppHeader role={profile.role} active="/habilitations" />
        {/* L'en-tete (titre, recherche, filtres) est rendu par HabilitationsList :
            la recherche est un etat client, elle doit vivre dans le meme composant.
            La saisie s'ouvre au clic sur une pastille de la grille. */}
        <HabilitationsList
          rows={rows}
          personnes={personnes}
          displayedIds={displayedIds}
          comps={comps}
          canEdit={canEdit}
          ateliers={ateliers.map((a) => ({ id: a.id, label: a.nom }))}
          equipes={equipes.map((e) => ({ id: e.id, label: e.nom }))}
          atelier={sp.atelier ?? ""}
          equipe={sp.equipe ?? ""}
          lienParam={canRead(perms, "habilitations_param")}
        />
      </div>
    </>
  );
}
