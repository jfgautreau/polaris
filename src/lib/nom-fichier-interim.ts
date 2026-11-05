// Nom du fichier Excel des Synthèses intérim (2026-11-05), réglé dans Param. RH
// (`parametre_rh.interim_nom_fichier`, migration 0093). Pur et testé.
//
// Balises : {agence} {semaine} {annee} {date} {heure} {site}. {date} est en
// AAAA-MM-JJ (les fichiers se trient dans l'ordre) et {heure} en 14h05 : deux
// extractions du même jour ne portent pas le même nom. L'extension .xlsx est
// ajoutée d'office ; les caractères refusés par Windows sont remplacés.

export const NOM_FICHIER_INTERIM_DEFAUT = "Planning intérim {agence} S{semaine} {annee} - {date} {heure}";
export const NOM_FICHIER_INTERIM_MAX = 150;
export const BALISES_NOM_FICHIER = ["{agence}", "{semaine}", "{annee}", "{date}", "{heure}", "{site}"] as const;

export type ContexteNomFichier = {
  agence: string; // « toutes agences » pour l'extraction globale
  semaine: number;
  annee: number; // année ISO de la semaine
  site: string;
  maintenant: Date;
};

const d2 = (n: number) => String(n).padStart(2, "0");

export function nomFichierInterim(forme: string | null | undefined, c: ContexteNomFichier): string {
  const gabarit = (forme ?? "").trim() || NOM_FICHIER_INTERIM_DEFAUT;
  const m = c.maintenant;
  const valeurs: Record<string, string> = {
    agence: c.agence,
    semaine: d2(c.semaine),
    annee: String(c.annee),
    date: `${m.getFullYear()}-${d2(m.getMonth() + 1)}-${d2(m.getDate())}`,
    heure: `${d2(m.getHours())}h${d2(m.getMinutes())}`,
    site: c.site,
  };
  const brut = gabarit.replace(/\{(agence|semaine|annee|date|heure|site)\}/gi, (_, k: string) => valeurs[k.toLowerCase()] ?? "");
  const nom = brut
    // Caractères interdits par Windows, et caractères de contrôle.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 180);
  return `${nom || "Planning intérim"}.xlsx`;
}
