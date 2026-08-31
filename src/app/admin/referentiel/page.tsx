import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import { getServerClient } from "@/lib/supabase-server";
import { requireModule , canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { fetchAll } from "@/lib/fetch-all";
import { getNbNiveauxC } from "@/lib/refdata";
import ReferentielEditor from "./ReferentielEditor";

type Poste = {
  id: string;
  nom: string;
  nom_court: string | null;
  categorie: string;
  effectif_requis: number;
  difficulte_formation: number | null;
  niveau_min_requis: number;
  ordre_affichage: number;
  numero_rotation: string | null;
  remplacable: boolean;
  actif: boolean;
};
type Ligne = { id: string; nom: string; actif: boolean; ordre_affichage: number; poste: Poste[] };
type Atelier = { id: string; nom: string; actif: boolean; ligne: Ligne[] };
type Quart = { code: string; libelle: string };
type Comp = { id: string; nom: string; a_recycler: boolean };

export default async function ReferentielPage() {
  const { profile, perms } = await requireModule("referentiel", "read");

  const supabase = await getServerClient();
  const [{ data }, { data: quartsD }, { data: pqD }, { data: compsD }, pcrD, { data: persD }, nbNiveaux] = await Promise.all([
    supabase
      .from("atelier")
      .select(
        "id, nom, actif, ligne(id, nom, actif, ordre_affichage, poste(id, nom, nom_court, categorie, effectif_requis, difficulte_formation, niveau_min_requis, ordre_affichage, numero_rotation, remplacable, actif))"
      )
      .order("nom")
      .returns<Atelier[]>(),
    supabase.from("quart").select("code, libelle").order("ordre").returns<Quart[]>(),
    supabase
      .from("poste_quart")
      .select("poste_id, quart_code")
      .eq("actif", false)
      .returns<{ poste_id: string; quart_code: string }[]>(),
    supabase.from("competence").select("id, nom, a_recycler").eq("actif", true).order("nom").returns<Comp[]>(),
    fetchAll<{ poste_id: string; competence_id: string }>(() =>
      supabase
        .from("poste_competence_requise")
        .select("poste_id, competence_id")
        .order("poste_id")
        .order("competence_id")
        .returns<{ poste_id: string; competence_id: string }[]>()
    ),
    // Personnes (pour le sélecteur « Titulaire » du poste) : non parties, plus
    // le poste fixe courant pour afficher le titulaire en face de chaque poste.
    supabase.from("personne").select("id, nom, prenom, poste_fixe_id, statut").neq("statut", "PARTI").order("nom").returns<{ id: string; nom: string; prenom: string; poste_fixe_id: string | null; statut: string }[]>(),
    getNbNiveauxC(),
  ]);

  const ateliers = (data ?? []).map((a) => ({
    ...a,
    ligne: [...(a.ligne ?? [])]
      .sort((x, y) => (x.ordre_affichage ?? 0) - (y.ordre_affichage ?? 0) || x.nom.localeCompare(y.nom))
      .map((l) => ({
        ...l,
        poste: [...(l.poste ?? [])].sort((x, y) => (x.ordre_affichage ?? 0) - (y.ordre_affichage ?? 0) || x.nom.localeCompare(y.nom)),
      })),
  }));
  const pqOff = (pqD ?? []).map((r) => `${r.poste_id}:${r.quart_code}`);
  const pcr = pcrD.map((r) => `${r.poste_id}:${r.competence_id}`);

  // Titulaire(s) par poste (poste fixe des personnes) + liste pour le sélecteur.
  const persons = (persD ?? []).map((p) => ({ id: p.id, label: `${p.nom} ${p.prenom}`.trim() }));
  const titulaires: Record<string, { id: string; label: string }[]> = {};
  for (const p of persD ?? []) {
    if (!p.poste_fixe_id) continue;
    (titulaires[p.poste_fixe_id] ??= []).push({ id: p.id, label: `${p.nom} ${p.prenom}`.trim() });
  }

  return (
    <>
      <AppHeader role={profile.role} active="/admin/referentiel" />
      <div className="container" style={{ maxWidth: "none" }}>
        <PageTitle module="referentiel">Référentiel : ateliers, lignes, postes</PageTitle>
        <p className="muted" style={{ marginBottom: 16 }}>
          Saisie directe : modifiez un champ, il s&apos;enregistre tout seul (aucun bouton
          à valider). Cochez « Actif » pour activer/désactiver. La <strong>catégorie</strong>{" "}
          (Manager / Conducteur / Opérateur) sert aux bilans. <strong>Rempl.</strong>{" "}
          marque un poste <strong>PTNR</strong> (non remplaçable, un seul titulaire par
          conception) : il est alors exclu des rapports de fragilité/relève et isolé dans les
          compétences critiques. Les colonnes de quart cochent
          sur quels quarts le poste tourne (tout coché par défaut). Le <strong>N° Rot</strong>{" "}
          est libre : un poste à plusieurs positions porte plusieurs numéros (« 12, 13 »).
          Les <strong>habilitations requises</strong>{" "}
          déclenchent une demande de confirmation au placement d&apos;une personne qui ne
          les a pas (ou plus). Le <strong>Titulaire</strong> désigne la personne à
          <strong> poste fixe</strong> : elle est pré-remplie sur ce poste dans le planning
          (même donnée que le sélecteur de la fiche Personnel).
        </p>

        <LectureSeule actif={!canWrite(perms, "referentiel")}>
          <ReferentielEditor initial={ateliers} quarts={quartsD ?? []} pqOff={pqOff} comps={compsD ?? []} pcr={pcr} persons={persons} titulaires={titulaires} nbNiveaux={nbNiveaux} />
        </LectureSeule>
      </div>
    </>
  );
}
