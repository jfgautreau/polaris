// Gabarit de la feuille imprimée de l'affichage TV (A3 portrait, marges 10 mm :
// zone imprimable ~1047 × 1512 px). Partagé entre le CSS d'impression
// (AtelierPlanning, composant serveur) et la mise à l'échelle
// (FeuillesImpression, composant client) : un module sans « use client », sinon
// le serveur recevrait des références au lieu des nombres.
export const FEUILLE_L = 1020;
export const FEUILLE_H = 1480;
// En-tête (semaine en gros, service, section) et pied (légende), hors zone mise
// à l'échelle, à hauteur fixe.
export const ENTETE_H = 104;
export const PIED_H = 30;
// Écart entre l'en-tête et le tableau.
export const ECART_H = 10;
