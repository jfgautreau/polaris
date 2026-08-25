// Regroupement des jours d'absence en PÉRIODES lisibles.
//
// Pourquoi ce module. Les absences vivent sous deux formes en base :
//   - `absence` : une période déclarée (début, fin, motif), matérialisée
//     ensuite en un `placement` par jour ;
//   - `placement.motif_absence_id` seul : une absence posée directement dans le
//     Planning ou le Placement, jour par jour, sans période déclarée.
// Relevé du 23/07/2026 : 401 jours sur 421 relèvent de la seconde forme. Lire
// la seule table `absence` afficherait donc une liste quasi vide.
//
// On part donc des JOURS (source unique et exhaustive) et on reconstruit les
// périodes : jours consécutifs de même motif = une ligne.

export type JourAbsence = {
  jour: string;            // 'YYYY-MM-DD'
  motif_absence_id: string | null;
  absence_id?: string | null; // non nul = issu d'une période déclarée
};

export type PeriodeAbsence = {
  motif_absence_id: string | null;
  debut: string;
  fin: string;
  /** Jours réellement posés (une période qui enjambe un week-end en compte moins
   *  que l'écart entre ses bornes). */
  jours: number;
  /** Vrai si au moins un jour provient d'une période déclarée. */
  declaree: boolean;
  /** Id de la période déclarée si tous ses jours en proviennent (édition possible).
   *  Null pour un regroupement de jours saisis au planning ou hétérogène. */
  absence_id: string | null;
};

const AU_JOUR = 86_400_000;
const enJours = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / AU_JOUR;

// Nombre de jours calendaires séparant deux dates ISO (b - a).
export function ecartJours(a: string, b: string): number {
  return Math.round(enJours(b) - enJours(a));
}

/**
 * Regroupe des jours d'absence en périodes, du plus récent au plus ancien.
 *
 * `ecartTolere` : écart maximal, en jours calendaires, entre deux jours posés
 * successifs pour qu'ils restent dans la même période. Défaut 3 — de quoi
 * enjamber un week-end (vendredi → lundi = 3 jours) sans réunir deux absences
 * réellement distinctes séparées d'une semaine de travail.
 *
 * Deux jours de MOTIFS différents ne sont jamais réunis, même consécutifs.
 */
export function grouperAbsences(jours: JourAbsence[], ecartTolere = 3): PeriodeAbsence[] {
  const valides = jours.filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.jour));
  if (!valides.length) return [];

  // Tri chronologique croissant, motif en second pour que deux motifs le même
  // jour restent groupés de façon déterministe.
  const tri = [...valides].sort(
    (a, b) => a.jour.localeCompare(b.jour) || String(a.motif_absence_id).localeCompare(String(b.motif_absence_id))
  );

  const out: PeriodeAbsence[] = [];
  let cur: PeriodeAbsence | null = null;
  let dernier = "";
  // Id de l'absence déclarée qui ancre le groupe courant (première rencontrée).
  let curDecl: string | null = null;

  for (const j of tri) {
    const memeMotif = cur && cur.motif_absence_id === j.motif_absence_id;
    const contigu = cur && ecartJours(dernier, j.jour) <= ecartTolere;
    // Deux périodes DÉCLARÉES distinctes ne se fondent jamais, même contiguës et
    // de même motif : deux arrêts maladie saisis séparément gardent leur détail
    // (et leur absence_id, donc restent éditables via maj_absence — sans quoi
    // « réduire » l'un rematérialisait tout et laissait la queue de l'autre).
    // On ne coupe que si les DEUX côtés sont déclarés avec des id différents ;
    // un jour saisi au planning (absence_id null) rejoint le groupe comme avant.
    const frontiereDeclaree = !!j.absence_id && !!curDecl && j.absence_id !== curDecl;

    if (cur && memeMotif && contigu && !frontiereDeclaree) {
      // Un même jour répété (deux lignes) ne compte qu'une fois.
      if (j.jour !== dernier) {
        cur.jours += 1;
        cur.fin = j.jour;
      }
      cur.declaree = cur.declaree || !!j.absence_id;
      // Absence_id partagé : reste éditable ; sinon on invalide (hétérogène).
      if (cur.absence_id !== (j.absence_id ?? null)) cur.absence_id = null;
      if (j.absence_id && !curDecl) curDecl = j.absence_id;
    } else {
      cur = {
        motif_absence_id: j.motif_absence_id,
        debut: j.jour,
        fin: j.jour,
        jours: 1,
        declaree: !!j.absence_id,
        absence_id: j.absence_id ?? null,
      };
      out.push(cur);
      curDecl = j.absence_id ?? null;
    }
    dernier = j.jour;
  }

  // Du plus récent au plus ancien (sur la date de début).
  return out.sort((a, b) => b.debut.localeCompare(a.debut));
}

/** Libellé court d'une période : « 04/09 → 12/09/2026 » ou « 11/07/2026 ». */
export function libellePeriode(p: PeriodeAbsence): string {
  const fr = (iso: string) => iso.split("-").reverse().join("/");
  if (p.debut === p.fin) return fr(p.debut);
  const [ad, am] = [p.debut.slice(8, 10), p.debut.slice(5, 7)];
  // Même année : on ne la répète pas sur la borne de gauche.
  if (p.debut.slice(0, 4) === p.fin.slice(0, 4)) return `${ad}/${am} → ${fr(p.fin)}`;
  return `${fr(p.debut)} → ${fr(p.fin)}`;
}

/** État d'un départ prévu, pour la pastille de l'écran Personnel. */
export type EtatDepart = "aucun" | "a_venir" | "depasse";

export function etatDepart(dateDepart: string | null | undefined, aujourdhui: string): EtatDepart {
  if (!dateDepart) return "aucun";
  return dateDepart < aujourdhui ? "depasse" : "a_venir";
}
