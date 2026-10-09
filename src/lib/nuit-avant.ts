// « Nuit avant » : la ligne a-t-elle tourné de nuit la veille ? (0087, pur.)
//
// Le jour J, une ligne sort d'une nuit si un quart de NUIT (`quart.nuit`)
// était ACTIVÉ la veille J-1 (jour_quart), que la ligne n'y était pas FERMÉE
// (ouverture_quart, défaut ouvert) et qu'au moins un de ses postes TOURNE sur
// ce quart (poste_quart, cf. poste-quart.ts). La nuit compte sur le jour où
// elle commence : la nuit du lundi soir précède le mardi matin.

export type DonneesNuit = {
  /** Codes des quarts de nuit du site. */
  quartsNuit: string[];
  /** `${quart}:${iso}` des quarts activés ce jour-là. */
  quartsActifs: ReadonlySet<string>;
  /** `${quart}:${ligne}:${iso}` des lignes fermées par l'ordo ce jour-là. */
  lignesFermees: ReadonlySet<string>;
  /** `${quart}:${ligne}` des lignes dont au moins un poste tourne sur ce quart de nuit. */
  lignesQuiTournent: ReadonlySet<string>;
};

export function veille(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function ligneSortDUneNuit(d: DonneesNuit, ligneId: string, iso: string): boolean {
  const v = veille(iso);
  return d.quartsNuit.some(
    (q) =>
      d.quartsActifs.has(`${q}:${v}`) &&
      !d.lignesFermees.has(`${q}:${ligneId}:${v}`) &&
      d.lignesQuiTournent.has(`${q}:${ligneId}`),
  );
}
