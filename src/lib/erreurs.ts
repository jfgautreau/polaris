// Traduction des erreurs Postgres en messages lisibles par l'utilisateur.
//
// Jusqu'ici, 16 ecritures sur 100 ignoraient purement et simplement leur
// resultat : l'ecran se rechargeait comme si tout allait bien. Le symptome
// etait toujours le meme — « je clique sur Enregistrer et rien ne change » —
// sans le moindre indice sur la cause.
//
// Les cas reellement rencontrables ici sont peu nombreux : un code court de
// motif deja pris, une agence d'interim deja saisie a la casse pres (l'index
// unique de la migration 0034 porte sur `lower(nom)`), un matricule en double.
// Les autres codes sont rendus tels quels plutot que masques.

export type ErreurPg = { code?: string; message: string; details?: string | null } | null;

// Correspondance contrainte -> message metier. La clef est le nom de la
// contrainte ou de l'index en base, tel que Postgres le cite dans le message.
const PAR_CONTRAINTE: Record<string, string> = {
  motif_absence_code_court_key: "Ce code court est déjà utilisé par un autre motif.",
  agence_interim_nom_unique: "Cette agence existe déjà (la casse n'est pas prise en compte).",
  personne_matricule_key: "Ce matricule est déjà attribué à une autre personne.",
  equipe_chef_equipe_id_app_user_id_key: "Cette personne est déjà chef de cette équipe.",
  matrice_personne_id_poste_id_key: "Cette case de la matrice existe déjà.",
  personne_competence_personne_id_competence_id_key: "Cette habilitation est déjà enregistrée pour cette personne.",
  placement_personne_id_jour_key: "Cette personne a déjà une affectation ce jour-là.",
  horaire_exception_personne_id_jour_key: "Cette personne a déjà un horaire spécifique ce jour-là.",
  quart_pkey: "Un quart avec ce libellé existe déjà pour ce site (choisissez un libellé différent).",
};

export function messageErreur(e: ErreurPg): string | null {
  if (!e) return null;

  const brut = `${e.message} ${e.details ?? ""}`;
  for (const [contrainte, message] of Object.entries(PAR_CONTRAINTE)) {
    if (brut.includes(contrainte)) return message;
  }

  // Fonction SQL absente : la migration correspondante n'a pas ete passee.
  // Cas sans gravite — l'appel n'ayant rien execute, aucune donnee n'est
  // touchee — mais le message brut de PostgREST est incomprehensible.
  if (e.code === "PGRST202" || e.code === "42883") {
    return "Cette action nécessite une migration de base non encore appliquée (0037). Rien n'a été modifié.";
  }

  switch (e.code) {
    case "23505": // unique_violation
      return "Cette valeur existe déjà.";
    case "23503": // foreign_key_violation
      return "Cet élément est référencé ailleurs : désactivez-le plutôt que de le supprimer.";
    case "23514": // check_violation
      return "Valeur hors des bornes autorisées.";
    case "23502": // not_null_violation
      return "Un champ obligatoire est vide.";
    case "42501": // insufficient_privilege
      return "Vous n'avez pas le droit d'effectuer cette modification.";
    default:
      // Message brut : mieux vaut un texte technique qu'un echec muet.
      return e.message || "L'enregistrement a échoué.";
  }
}

// Construit l'URL de retour d'une server action. Les actions se terminent par
// un `redirect()` : c'est le seul canal dont elles disposent pour faire
// remonter quelque chose a l'ecran.
export function urlAvecErreur(path: string, message: string | null): string {
  if (!message) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}err=${encodeURIComponent(message)}`;
}
