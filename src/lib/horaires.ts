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
// ⚠️ La priorite porte sur la SOURCE, pas sur chaque borne prise a part :
// resoudre `debut` et `fin` independamment recomposait un horaire jamais saisi
// (une exception cote debut seul donnait « debut exception – fin du poste »). On
// choisit la premiere source qui dit quelque chose, puis on lui prend ses deux
// bornes.

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
};

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

// Horaire TP applicable a ce jour / ce quart, ou undefined.
// ⚠️ Couplage assume : `tp_config` stocke ses demi-journees sous les clefs
// « matin » / « aprem », homonymes de deux codes de quart sans etre le meme
// vocabulaire. La correspondance est ecrite ici en dur ; un site aux quarts
// autrement codes n'aurait pas d'horaires TP par demi-journee — repli silencieux.
function horaireTp(cfg: TpCfg | undefined, quart: string, iso: string): HM | undefined {
  if (!cfg) return undefined;
  const d = String(isoDow(iso));
  let tp: { debut: string; fin: string } | undefined;
  if (cfg.demi?.source === "horaires") {
    if (quart === "matin") tp = cfg.demi.matin?.[d];
    else if (quart === "apres_midi") tp = cfg.demi.aprem?.[d];
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
  iso: string
): { debut: string | null; fin: string | null } {
  const q = quartOuDefaut(quartCode, quarts);
  const std = maps.horMap.get(`${posteId}:${q}:${dowLundi(iso)}`);
  const ex = maps.excMap.get(`${personId}:${iso}`);
  const tp = horaireTp(maps.tpCfgMap.get(personId), q, iso);
  const source = renseigne(ex) ? ex : renseigne(tp) ? tp : std;
  return { debut: source?.debut || null, fin: source?.fin || null };
}

// Libelle court « 06:00-14:00 », ou "" si aucun horaire. Un cote manquant est
// marque « ? » (l'autre borne existe : il faut la montrer).
export function horaireTxt(
  maps: MapsHoraire,
  quarts: QuartRef[],
  personId: string,
  posteId: string,
  quartCode: string | null,
  iso: string
): string {
  const { debut, fin } = resoudreHoraire(maps, quarts, personId, posteId, quartCode, iso);
  if (!debut && !fin) return "";
  return `${debut ?? "?"}-${fin ?? "?"}`;
}
