// Mémoire de SESSION des filtres (décision produit 2026-09-28).
//
// Deux cookies de session (sans Max-Age : effacés à la fermeture du navigateur),
// écrits côté client par `MainNav` dès que l'URL de Planning / Placement porte la
// valeur, relus côté serveur comme DÉFAUT quand l'URL ne la précise pas :
//   - le QUART : Planning et Placement ouverts sans ?quart reprennent le dernier
//     quart choisi — y compris après un passage par Personnel / Matrice /
//     Habilitations, qui n'ont pas de notion de quart ;
//   - le dernier SERVICE vu dans Placement : Placement exige UN service (c'est le
//     plan affiché) ; arriver du Planning en « Service : tous » rouvre ce plan-là.
//
// ⚠️ Valeurs non fiables (écrites par le navigateur) : toujours les VALIDER contre
// les codes de quart / ateliers du site courant avant usage. Elles ne servent que
// de défaut d'affichage, jamais de droit ni de périmètre.
export const COOKIE_QUART = "polaris-quart";
export const COOKIE_PLACEMENT_SERVICE = "polaris-placement-service";

// Écriture côté client (cookie de session, SameSite=Lax).
export function ecrireCookieSession(nom: string, valeur: string) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${nom}=${encodeURIComponent(valeur)}; Path=/; SameSite=Lax${secure}`;
}

// Lecture côté serveur : valeur validée contre une liste, ou "".
export function valeurValide(brut: string | undefined, autorisees: readonly string[]): string {
  if (!brut) return "";
  let v = brut;
  try {
    v = decodeURIComponent(brut);
  } catch {
    return "";
  }
  return autorisees.includes(v) ? v : "";
}
