// Gabarit de la feuille imprimée de l'affichage TV (A3 portrait, marges 10 mm :
// zone imprimable 277 × 400 mm ≈ 1047 × 1512 px). Partagé entre le CSS
// d'impression (AtelierPlanning, composant serveur) et la mise à l'échelle
// (FeuillesImpression, composant client) : un module sans « use client », sinon
// le serveur recevrait des références au lieu des nombres.
// Feuille à quelques pixels près de la zone imprimable (2026-11-05 : à 1020 ×
// 1480, une marge blanche restait à droite et en bas).
export const FEUILLE_L = 1044;
export const FEUILLE_H = 1504;
// En-tête (semaine en gros, service, section) et pied (légende), hors zone mise
// à l'échelle, à hauteur fixe.
export const ENTETE_H = 104;
export const PIED_H = 30;
// Écart entre l'en-tête et le tableau.
export const ECART_H = 10;
