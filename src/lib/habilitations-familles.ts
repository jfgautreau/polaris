// Sous-droits des habilitations par FAMILLE de formation (2026-11-05).
//
// La famille d'une formation = `competence.groupe` (Param. Habilitation :
// Conduite d'engin, Secours, Qualité…). Dans l'écran Droits, sous la ligne
// « Habilitations », chaque rôle peut se voir RETIRER le droit d'actualiser une
// famille. Stockage sans migration : une ligne `role_permission` de module
// `habfam:<famille>` et de niveau `none` (refus) ou `write` (rétabli).
//
// Règle : actualiser une habilitation (saisie, recyclage, suppression,
// autorisation, commentaire) exige le droit « Habilitations » en écriture ET
// une famille non refusée. Par défaut (aucune ligne) toutes les familles sont
// ouvertes : rien ne change pour un rôle tant qu'on ne décoche rien. Le
// périmètre RLS du chef d'équipe (son équipe) s'applique en plus.
// Pur : partagé par le serveur et l'écran.

export const PREFIXE_FAMILLE = "habfam:";
export const LIBELLE_SANS_FAMILLE = "Sans famille";

/** Clé `role_permission.module` d'une famille ; groupe vide = « Sans famille ». */
export function cleFamille(groupe: string | null | undefined): string {
  return PREFIXE_FAMILLE + (groupe ?? "").trim().toLowerCase();
}

export function estCleFamille(module: string): boolean {
  return module.startsWith(PREFIXE_FAMILLE) && module.length <= PREFIXE_FAMILLE.length + 100;
}

/** Familles distinctes des formations, dans l'ordre alphabétique, « Sans famille » en dernier. */
export function famillesDe(groupes: (string | null | undefined)[]): { cle: string; libelle: string }[] {
  const vues = new Map<string, string>();
  let sans = false;
  for (const g of groupes) {
    const t = (g ?? "").trim();
    if (!t) sans = true;
    else if (!vues.has(cleFamille(t))) vues.set(cleFamille(t), t);
  }
  const liste = [...vues].map(([cle, libelle]) => ({ cle, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle));
  if (sans) liste.push({ cle: cleFamille(""), libelle: LIBELLE_SANS_FAMILLE });
  return liste;
}

/** Ce rôle peut-il actualiser une formation de ce groupe ? */
export function peutActualiser(ecritHabilitations: boolean, refusees: Iterable<string>, groupe: string | null | undefined): boolean {
  if (!ecritHabilitations) return false;
  const cle = cleFamille(groupe);
  for (const r of refusees) if (r === cle) return false;
  return true;
}
