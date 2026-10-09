// Règles pures de l'écran Journal (refonte 0086) : libellés, description en
// clair de l'élément touché, champs modifiés, valeurs lisibles. Sans accès à la
// base : les noms (personnes, postes…) arrivent dans un dictionnaire.

export type Json = Record<string, unknown> | null;

export type EntreeJournal = {
  id: number;
  app_user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Json;
  new_values: Json;
  created_at: string;
  impersonated_by: string | null;
  lot: string | null;
  lot_libelle: string | null;
};

export const ACTION_FR: Record<string, string> = {
  INSERT: "Création",
  UPDATE: "Modification",
  DELETE: "Suppression",
  LOT: "Opération groupée",
};

// Tables journalisées (déclencheurs 0002, 0004, 0005, 0007, 0017, 0023, 0036).
export const TABLE_FR: Record<string, string> = {
  placement: "Planning",
  matrice: "Polyvalence",
  personne_competence: "Habilitation",
  personne: "Personne",
  contrat_periode: "Contrat",
  absence: "Absence",
  poste: "Poste",
  ligne: "Ligne",
  atelier: "Service",
  equipe: "Équipe",
  equipe_chef: "Chef d'équipe",
  motif_absence: "Motif d'absence",
  app_user: "Utilisateur",
  role_permission: "Droits",
  rotation_reference: "Rotation",
  poste_quart: "Effectif par quart",
  horaire_poste: "Horaire de poste",
  quart: "Quart",
  competence: "Compétence",
  poste_competence_requise: "Habilitation exigée",
  agence_interim: "Agence d'intérim",
  semaine_type_profil: "Semaine type",
  competence_niveau_libelle: "Niveaux de compétence",
  lot: "Opération groupée",
};

/** Tables à fort volume, masquées par défaut (78 % du journal au 2026-10-09). */
export const TABLES_BRUIT = ["placement", "matrice"];

const CHAMP_FR: Record<string, string> = {
  niveau_actuel: "Niveau actuel",
  niveau_cible: "Niveau cible",
  jour: "Jour",
  quart_code: "Quart",
  poste_id: "Poste",
  personne_id: "Personne",
  equipe_id: "Équipe",
  ligne_id: "Ligne",
  atelier_id: "Service",
  competence_id: "Compétence",
  motif_absence_id: "Motif",
  absence_id: "Absence",
  non_travaille: "Non travaillé",
  commentaire: "Commentaire",
  libelle: "Libellé",
  couleur: "Couleur",
  code_court: "Code",
  code_gt: "Code GT",
  nom: "Nom",
  nom_court: "Nom court",
  prenom: "Prénom",
  matricule: "Matricule",
  actif: "Actif",
  statut: "Statut",
  date_obtention: "Date de passage",
  date_expiration: "Échéance",
  date_autorisation_conduite: "Autorisation",
  date_debut: "Début",
  date_fin: "Fin",
  date_ouverture: "Ouvre le",
  date_fermeture: "Ferme le",
  motif_fin: "Motif de fin",
  type_contrat: "Type de contrat",
  agence_interim: "Agence",
  temps_partiel: "Temps partiel",
  tp_config: "Config. temps partiel",
  tp: "Temps partiel",
  tp_charge: "TP chargé",
  numero_rotation: "N° de rotation",
  ordre_affichage: "N° d'affichage",
  regroupement: "Regroupement",
  effectif: "Effectif",
  effectif_requis: "Effectif requis",
  niveau_min_requis: "Niveau minimum",
  categorie: "Catégorie",
  remplacable: "Remplaçable",
  imprimable: "Imprimable",
  zone_attente: "Zone d'attente",
  debut: "Début",
  fin: "Fin",
  role: "Rôle",
  module: "Module",
  niveau: "Niveau",
  quart_fixe: "Quart fixe",
  semaine: "Semaine",
  poste_fixe_id: "Poste fixe",
  is_active: "Compte actif",
  email: "E-mail",
  name: "Nom",
  forcage_motif: "Forçage",
  forcage_par: "Forcé par",
  forcage_at: "Forcé le",
  visible_operateurs: "PDF pour Affich.",
  non_planifie: "Non planifié",
  avec_agence: "Avec agence",
};

/** Champs techniques, jamais montrés (ids, horodatages, auteur déjà affiché). */
export const TECH = new Set([
  "id", "created_at", "updated_at", "date_maj", "auteur_app_user_id", "created_by",
  "site_id", "anonymise_at",
]);

export function champLabel(k: string): string {
  if (CHAMP_FR[k]) return CHAMP_FR[k];
  const t = k.replace(/_id$/, "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_HORODATAGE = /^\d{4}-\d{2}-\d{2}T/;
export const dateFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Valeur en clair : booléen, date, clé étrangère résolue, objet résumé. */
export function valeurLisible(cle: string, v: unknown, noms: Record<string, string>): string {
  if (v === null || v === undefined || v === "") return "∅";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }
  const s = String(v);
  if (cle.endsWith("_id") || cle === "created_by" || cle === "quart_code" || cle === "quart_fixe") {
    if (noms[s]) return noms[s];
    if (cle.endsWith("_id")) return "(supprimé)";
  }
  if (ISO_DATE.test(s)) return dateFr(s);
  if (ISO_HORODATAGE.test(s)) return dateFr(s);
  return s;
}

/** Identifiants référencés par une entrée (à résoudre en noms). */
export function idsReferences(e: EntreeJournal): string[] {
  const out = new Set<string>();
  for (const obj of [e.old_values, e.new_values]) {
    if (!obj) continue;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v && (k.endsWith("_id") || k === "created_by")) out.add(v);
    }
  }
  if (e.app_user_id) out.add(e.app_user_id);
  if (e.impersonated_by) out.add(e.impersonated_by);
  return [...out];
}

/**
 * Élément touché, en clair : « DUPONT J. · 12/10/2026 · Matin · Conducteur L1 ».
 * Lit la ligne après modification, ou avant pour une suppression.
 */
export function decrireElement(e: EntreeJournal, noms: Record<string, string>): string {
  if (e.action === "LOT") return e.lot_libelle ?? "Opération groupée";
  const v = (e.new_values ?? e.old_values ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" && v[k] ? (v[k] as string) : null);
  const nom = (k: string) => {
    const id = str(k);
    return id ? noms[id] ?? "(supprimé)" : null;
  };
  const parts: (string | null)[] = [];
  switch (e.table_name) {
    case "personne":
      parts.push([str("nom"), str("prenom")].filter(Boolean).join(" ") || null, str("matricule"));
      break;
    case "app_user":
      parts.push(str("name") || str("email"), str("role"));
      break;
    case "role_permission":
      parts.push(str("role"), str("module"));
      break;
    default:
      parts.push(
        nom("personne_id"),
        str("jour") ? dateFr(str("jour")!) : null,
        str("quart_code") ? noms[str("quart_code")!] ?? str("quart_code") : null,
        nom("poste_id"),
        nom("motif_absence_id"),
        v.non_travaille === true ? "Non travaillé" : null,
        v.tp === true ? "Temps partiel" : null,
        nom("competence_id"),
        nom("ligne_id"),
        nom("atelier_id"),
        nom("equipe_id"),
        str("date_debut") ? `du ${dateFr(str("date_debut")!)}${str("date_fin") ? ` au ${dateFr(str("date_fin")!)}` : ""}` : null,
        str("semaine") ? `semaine du ${dateFr(str("semaine")!)}` : null,
        str("nom") ?? str("libelle"),
      );
  }
  const txt = parts.filter((p): p is string => !!p).join(" · ");
  return txt || "—";
}

export type Champ = { k: string; avant?: unknown; apres?: unknown };

/** Champs à montrer : modifiés (UPDATE) ou renseignés (création, suppression). */
export function champsMontres(e: EntreeJournal): Champ[] {
  if (e.action === "UPDATE") {
    const o = e.old_values ?? {};
    const n = e.new_values ?? {};
    const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
    const out: Champ[] = [];
    for (const k of keys) {
      if (TECH.has(k)) continue;
      if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) out.push({ k, avant: o[k], apres: n[k] });
    }
    return out;
  }
  const obj = e.action === "DELETE" ? e.old_values : e.new_values;
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([k, v]) => !TECH.has(k) && v !== null && v !== "" && v !== false)
    .map(([k, v]) => (e.action === "DELETE" ? { k, avant: v } : { k, apres: v }));
}

/** Début de journée à Paris, en ISO UTC (bornes du filtre de période). */
export function minuitParis(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Décalage de Paris ce jour-là (UTC+1 l'hiver, UTC+2 l'été).
  const test = new Date(Date.UTC(y, m - 1, d, 12));
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(test);
  const decalage = Number(p) - 12;
  return new Date(Date.UTC(y, m - 1, d, -decalage)).toISOString();
}
