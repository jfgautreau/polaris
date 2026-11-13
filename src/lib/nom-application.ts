// Nom de l'application, propre à chaque site (0095, `site.nom_application`),
// réglé dans la Plateforme. Vide = nom par défaut. Règles pures (testées) ;
// la lecture en base est dans nom-application-server.ts.

export const NOM_APPLICATION_DEFAUT = "Polaris";
export const NOM_APPLICATION_MAX = 40;

// Nom à afficher : la valeur du site, sinon le nom par défaut.
export function nomApplication(valeur: string | null | undefined): string {
  const v = (valeur ?? "").trim();
  return v ? v.slice(0, NOM_APPLICATION_MAX) : NOM_APPLICATION_DEFAUT;
}

// Saisie de la Plateforme : vide = retour au nom par défaut (null en base).
export function validerNomApplication(
  saisie: string
): { ok: true; valeur: string | null } | { ok: false; erreur: string } {
  const v = saisie.replace(/\s+/g, " ").trim();
  if (!v) return { ok: true, valeur: null };
  if (v.length > NOM_APPLICATION_MAX) {
    return { ok: false, erreur: `Nom de l'application : ${NOM_APPLICATION_MAX} caractères au plus.` };
  }
  return { ok: true, valeur: v };
}

// Lien d'une page statique du guide (public/guide.html, public/qui-fait-quoi.html) :
// le nom voyage dans l'adresse, la page le substitue à l'affichage.
export function lienGuide(nom: string, page = "/guide.html"): string {
  return nom === NOM_APPLICATION_DEFAUT ? page : `${page}?app=${encodeURIComponent(nom)}`;
}
