import AppHeader from "@/components/AppHeader";
import PageTitle from "@/components/PageTitle";
import { getServerClient } from "@/lib/supabase-server";
import { requireModule , canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { fetchAll } from "@/lib/fetch-all";
import { getNbNiveauxC } from "@/lib/refdata";
import { chargerPosteQuart } from "@/lib/poste-quart";
import { chargerValidites, type Validite } from "@/lib/referentiel-validite";
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
  imprimable: boolean;
  zone_attente?: boolean;
  actif: boolean;
};
type Ligne = { id: string; nom: string; actif: boolean; ordre_affichage: number; regroupement: string | null; couleur: string | null; poste: Poste[] };
type Atelier = { id: string; nom: string; actif: boolean; ligne: Ligne[] };
type Quart = { code: string; libelle: string };
type Comp = { id: string; nom: string; a_recycler: boolean };

export default async function ReferentielPage() {
  const { profile, perms } = await requireModule("referentiel", "read");

  const supabase = await getServerClient();
  // Lecture tolérante à l'absence de `poste.zone_attente` (0077) puis de
  // `poste.imprimable` (0073) : sélectionner une colonne absente ferait échouer
  // TOUTE la requête imbriquée (L19) et viderait l'écran. On réessaie sans la
  // colonne la plus récente, puis sans les deux (défauts : false, true).
  const posteEmbed = (extra: string) =>
    `id, nom, actif, ligne(id, nom, actif, ordre_affichage, regroupement, couleur, poste(id, nom, nom_court, categorie, effectif_requis, difficulte_formation, niveau_min_requis, ordre_affichage, numero_rotation, remplacable${extra}, actif))`;
  const lireAteliers = async () => {
    const colonneAbsente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
    const avec = await supabase.from("atelier").select(posteEmbed(", imprimable, zone_attente")).order("nom").returns<Atelier[]>();
    if (!colonneAbsente(avec.error)) return avec;
    const sans0077 = await supabase.from("atelier").select(posteEmbed(", imprimable")).order("nom").returns<Atelier[]>();
    if (!colonneAbsente(sans0077.error)) return sans0077;
    return supabase.from("atelier").select(posteEmbed("")).order("nom").returns<Atelier[]>();
  };
  const [{ data }, { data: quartsD }, pqMap, { data: compsD }, pcrD, { data: persD }, nbNiveaux, ligneValMap, posteValMap] = await Promise.all([
    lireAteliers(),
    supabase.from("quart").select("code, libelle").order("ordre").returns<Quart[]>(),
    chargerPosteQuart(supabase),
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
    chargerValidites(supabase, "ligne"),
    chargerValidites(supabase, "poste"),
  ]);

  const ateliers = (data ?? []).map((a) => ({
    ...a,
    ligne: [...(a.ligne ?? [])]
      .sort((x, y) => (x.ordre_affichage ?? 0) - (y.ordre_affichage ?? 0) || x.nom.localeCompare(y.nom))
      .map((l) => ({
        ...l,
        poste: [...(l.poste ?? [])]
          // Défaut si la migration 0073 n'est pas encore passée (colonne absente).
          .map((p) => ({ ...p, imprimable: p.imprimable ?? true, zone_attente: p.zone_attente ?? false }))
          .sort((x, y) => (x.ordre_affichage ?? 0) - (y.ordre_affichage ?? 0) || x.nom.localeCompare(y.nom)),
      })),
  }));
  // Effectif par quart (trois états) transmis au client sous forme d'objet simple.
  const pq: Record<string, { actif: boolean; effectif: number | null }> = {};
  for (const [k, v] of pqMap) pq[k] = v;
  // Dates d'ouverture/fermeture (migration 0071) par ligne et par poste.
  const ligneVal: Record<string, Validite> = {};
  for (const [k, v] of ligneValMap) ligneVal[k] = v;
  const posteVal: Record<string, Validite> = {};
  for (const [k, v] of posteValMap) posteVal[k] = v;
  const pcr = pcrD.map((r) => `${r.poste_id}:${r.competence_id}`);
  // Regroupements déjà saisis sur le site (0069) : alimentent l'autocomplétion
  // du champ « Regroupement » de chaque ligne (réutiliser une valeur = zéro
  // faute de frappe, donc regroupement fiable dans le bilan).
  const regroupements = Array.from(
    new Set(
      ateliers.flatMap((a) => a.ligne.map((l) => (l.regroupement ?? "").trim()).filter(Boolean))
    )
  ).sort((x, y) => x.localeCompare(y));

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
        <PageTitle module="referentiel">Référentiel : services, lignes, postes</PageTitle>
        <p className="muted" style={{ marginBottom: 16 }}>
          Saisie directe : modifiez un champ, il s&apos;enregistre tout seul (aucun bouton
          à valider). Cochez « Actif » pour activer/désactiver. La <strong>catégorie</strong>{" "}
          (Manager / Conducteur / Opérateur) sert aux bilans. <strong>Rempl.</strong>{" "}
          marque un poste <strong>PTNR</strong> (non remplaçable, un seul titulaire par
          conception) : il est alors exclu des rapports de fragilité/relève et isolé dans les
          compétences critiques. Les <strong>colonnes de quart</strong> portent l&apos;
          <strong>effectif requis par quart</strong> : vide « – » = le poste ne tourne pas
          sur ce quart, 0 = tourne à 0, N = N personnes. Le <strong>N° Rot</strong>{" "}
          est libre : un poste à plusieurs positions porte plusieurs numéros (« 12, 13 »).
          Les <strong>habilitations requises</strong>{" "}
          déclenchent une demande de confirmation au placement d&apos;une personne qui ne
          les a pas (ou plus). Le <strong>Titulaire</strong> désigne la personne à
          <strong> poste fixe</strong> : elle est pré-remplie sur ce poste dans le planning
          (même donnée que le sélecteur de la fiche Personnel).
        </p>

        <LectureSeule actif={!canWrite(perms, "referentiel")}>
          <ReferentielEditor initial={ateliers} quarts={quartsD ?? []} pq={pq} ligneVal={ligneVal} posteVal={posteVal} comps={compsD ?? []} pcr={pcr} persons={persons} titulaires={titulaires} nbNiveaux={nbNiveaux} regroupements={regroupements} />
        </LectureSeule>
      </div>
    </>
  );
}
