// Resolution de l'horaire AFFICHE d'une personne sur un poste, un jour donne.
//
// Cette logique vivait uniquement dans l'ecran TV (`/affichage/atelier/[…]`).
// Elle est desormais partagee avec la synthese des horaires interimaires
// (`/bilans/syntheses`), qui en a besoin a l'identique. On l'extrait ici, pure
// et testee, pour que les deux ecrans ne puissent pas diverger.
//
// Priorite des sources, dans cet ordre : exception ponctuelle (horaire
// specifique saisi au planning) > horaires de temps partiel > horaire standard
// du poste pour ce quart et ce jour de semaine.
//
// La priorite porte sur la SOURCE : la premiere qui dit quelque chose fournit
// l'horaire. Seule exception, demandee le 2026-10-07 : un horaire specifique
// saisi d'un seul cote (debut sans fin, ou fin sans debut) COMPLETE la borne
// manquante par la source suivante — temps partiel s'il est renseigne, sinon
// horaire standard du poste (module Horaires). « Arrive a 9 h » s'affiche donc
// « 09:00-14:00 » et non plus « 09:00-? ».

import { quartOuDefaut, type QuartRef } from "@/lib/quarts";

export type HM = { debut?: string | null; fin?: string | null };
export type TpHM = Record<string, { debut: string; fin: string }>;
export type TpCfg = { demi?: { source?: string; matin?: TpHM; aprem?: TpHM }; horaires?: TpHM };

// ReadonlyMap : le resolveur ne fait que lire. Un appelant peut ainsi passer
// des maps dont la valeur porte des champs en plus (ex. l'excMap de la TV stocke
// aussi le `motif` du commentaire) sans se heurter a l'invariance de Map.
export type MapsHoraire = {
  /** `${poste}:${quart}:${dow}` (dow 0=lundi..6=dimanche). */
  horMap: ReadonlyMap<string, HM>;
  /** `${personne}:${iso}` — horaire specifique ponctuel. */
  excMap: ReadonlyMap<string, HM>;
  /** personne_id -> tp_config (temps partiel). */
  tpCfgMap: ReadonlyMap<string, TpCfg>;
  /**
   * Variante « après une nuit » (0087), même clé que `horMap` ; et la règle qui
   * dit si la ligne du poste sort d'une nuit ce jour-là (src/lib/nuit-avant.ts).
   * Facultatifs : absents, l'horaire du poste reste l'horaire standard.
   */
  apresNuitMap?: ReadonlyMap<string, HM>;
  nuitAvant?: (posteId: string, iso: string) => boolean;
  /**
   * Horaire par PLACE (0088), `${poste}:${quart}:${numero}` — valable toute la
   * semaine, avec sa variante « après une nuit ». Facultatif.
   */
  placeMap?: ReadonlyMap<string, HorairePlace>;
};

export type HorairePlace = { debut: string | null; fin: string | null; debutN: string | null; finN: string | null };

/**
 * Horaire du poste ce jour-là, hors personne (ni TP ni horaire spécifique) :
 * borne par borne, place après une nuit > place > poste après une nuit > poste.
 */
export function horaireDuPoste(
  maps: MapsHoraire,
  quarts: QuartRef[],
  posteId: string,
  quartCode: string | null,
  iso: string,
  numero?: string | null,
): HM | undefined {
  const q = quartOuDefaut(quartCode, quarts);
  const cleStd = `${posteId}:${q}:${dowLundi(iso)}`;
  const base = maps.horMap.get(cleStd);
  const nuit = !!maps.nuitAvant?.(posteId, iso);
  const an = nuit ? maps.apresNuitMap?.get(cleStd) : undefined;
  const pl = numero ? maps.placeMap?.get(`${posteId}:${q}:${numero}`) : undefined;
  const borne = (...v: (string | null | undefined)[]) => v.find((x) => !!x) || null;
  const debut = borne(nuit ? pl?.debutN : null, pl?.debut, an?.debut, base?.debut);
  const fin = borne(nuit ? pl?.finN : null, pl?.fin, an?.fin, base?.fin);
  return debut || fin ? { debut, fin } : undefined;
}

// Jour de semaine base lundi : 0 = lundi .. 6 = dimanche. Cle de `horaire_poste`.
export function dowLundi(iso: string): number {
  return (new Date(iso + "T00:00").getDay() + 6) % 7;
}
// Jour de semaine base 1 : 1 = lundi .. 7 = dimanche. Cle de `tp_config`.
function isoDow(iso: string): number {
  const d = new Date(iso + "T00:00").getDay();
  return d === 0 ? 7 : d;
}

const renseigne = (h?: HM | null): boolean => !!(h && (h.debut || h.fin));

// Horaire TP applicable a ce jour / cette demi-journee, ou undefined.
// `tp_config` stocke ses demi-journees sous les clefs « matin » / « aprem », qui
// sont le vocabulaire du CRENEAU (colonne `quart.creneau`, 0057) — PAS le code du
// quart. On passe donc le creneau du quart resolu, jamais son code : sur un site
// ou le code ne colle plus au libelle (La Vraie Croix), keyer sur le code inversait
// matin/apres-midi. Un quart sans creneau (journee, nuit) -> pas d'horaire par
// demi-journee, repli sur l'horaire TP plein.
function horaireTp(cfg: TpCfg | undefined, creneau: string | null, iso: string): HM | undefined {
  if (!cfg) return undefined;
  const d = String(isoDow(iso));
  let tp: { debut: string; fin: string } | undefined;
  if (cfg.demi?.source === "horaires") {
    if (creneau === "matin") tp = cfg.demi.matin?.[d];
    else if (creneau === "aprem") tp = cfg.demi.aprem?.[d];
  }
  if (!tp && cfg.horaires) tp = cfg.horaires[d];
  return tp;
}

// Horaire resolu (bornes), ou { null, null } si aucune source ne dit rien.
export function resoudreHoraire(
  maps: MapsHoraire,
  quarts: QuartRef[],
  personId: string,
  posteId: string,
  quartCode: string | null,
  iso: string,
  numero?: string | null,
): { debut: string | null; fin: string | null } {
  const q = quartOuDefaut(quartCode, quarts);
  const creneau = quarts.find((x) => x.code === q)?.creneau ?? null;
  // Horaire du poste (place, après une nuit). Le temps partiel, prioritaire,
  // garde son horaire.
  const std = horaireDuPoste(maps, quarts, posteId, quartCode, iso, numero);
  const ex = maps.excMap.get(`${personId}:${iso}`);
  const tp = horaireTp(maps.tpCfgMap.get(personId), creneau, iso);
  const generique = renseigne(tp) ? tp : std;
  if (renseigne(ex)) return { debut: ex?.debut || generique?.debut || null, fin: ex?.fin || generique?.fin || null };
  return { debut: generique?.debut || null, fin: generique?.fin || null };
}

// Libelle court « 06:00-14:00 », ou "" si aucun horaire. Un cote manquant est
// marque « ? » (l'autre borne existe : il faut la montrer).
export function horaireTxt(
  maps: MapsHoraire,
  quarts: QuartRef[],
  personId: string,
  posteId: string,
  quartCode: string | null,
  iso: string,
  numero?: string | null,
): string {
  const { debut, fin } = resoudreHoraire(maps, quarts, personId, posteId, quartCode, iso, numero);
  if (!debut && !fin) return "";
  return `${debut ?? "?"}-${fin ?? "?"}`;
}
