"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FEUILLE_L, FEUILLE_H, ENTETE_H, PIED_H, ECART_H } from "./feuilles-impression";

// Impression de l'affichage TV (2026-11-05) : UNE feuille A3 portrait par section
// (Matin, Après-midi, Nuit), chacune agrandie ou réduite pour occuper le plus de
// place possible en largeur ET en hauteur.
//
// Au `beforeprint` (bouton, impression automatique ou Ctrl+P), chaque
// `.aff-zoom` est mesuré à plusieurs largeurs de mise en page : on retient celle
// qui donne la plus grande échelle `min(largeur page / largeur, hauteur page /
// hauteur)`, puis `transform: scale()` (jamais `zoom`). Une section dense est mise
// en page large puis réduite ; une section courte, étroite puis agrandie.
// `afterprint` rend l'écran TV tel quel.

// Cible de hauteur VOLONTAIREMENT plus courte que la place restante : le rendu
// imprimé est toujours un peu plus haut que la mesure faite à l'écran (cf.
// ajusterFeuille du Placement).
const CIBLE_H = FEUILLE_H - ENTETE_H - ECART_H - PIED_H - 50;
const LARGEURS_ESSAI = [560, 640, 720, 820, 940, 1080, 1240, 1440, 1680, 1960, 2300, 2700, 3200];
// Au-delà, quelques noms donnent des pavés démesurés.
const ECHELLE_MAX = 2;

function ajuster(racine: HTMLElement) {
  for (const zoom of racine.querySelectorAll<HTMLElement>(".aff-zoom")) {
    zoom.style.transform = "none";
    let meilleur = { f: 0, w: FEUILLE_L };
    for (const w of LARGEURS_ESSAI) {
      zoom.style.width = `${w}px`;
      const h = zoom.scrollHeight;
      if (!h) continue;
      const f = Math.min(ECHELLE_MAX, FEUILLE_L / w, CIBLE_H / h);
      if (f > meilleur.f) meilleur = { f, w };
    }
    zoom.style.width = `${meilleur.w}px`;
    zoom.style.transformOrigin = "top left";
    zoom.style.transform = `scale(${meilleur.f || 1})`;
  }
}

function retablir(racine: HTMLElement) {
  for (const zoom of racine.querySelectorAll<HTMLElement>(".aff-zoom")) {
    zoom.style.width = "";
    zoom.style.transform = "";
    zoom.style.transformOrigin = "";
  }
}

export default function FeuillesImpression({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const avant = () => ref.current && ajuster(ref.current);
    const apres = () => ref.current && retablir(ref.current);
    window.addEventListener("beforeprint", avant);
    window.addEventListener("afterprint", apres);
    return () => {
      window.removeEventListener("beforeprint", avant);
      window.removeEventListener("afterprint", apres);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
