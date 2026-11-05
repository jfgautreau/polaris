"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FEUILLE_L, FEUILLE_H, ENTETE_H, PIED_H, ECART_H } from "./feuilles-impression";

// Impression de l'affichage TV (2026-11-05) : UNE feuille A3 portrait par section
// (Matin, Après-midi, Nuit), chacune remplie au mieux en largeur ET en hauteur.
//
// Au `beforeprint` (bouton, impression automatique ou Ctrl+P), chaque
// `.aff-zoom` est mesuré, puis mis à l'échelle par `transform: scale()` (jamais
// `zoom`) ; `afterprint` rend l'écran TV tel quel.
//  - Section DENSE : la largeur de mise en page est cherchée par dichotomie
//    jusqu'au point où le tableau réduit touche À LA FOIS le bord droit et le
//    bas (largeur page / largeur = hauteur page / hauteur). Une liste de largeurs
//    fixes laissait une marge d'un côté ou de l'autre.
//  - Section COURTE : jamais de mise en page plus étroite qu'une colonne de jour
//    lisible (JOUR_MIN) — c'est ce qui hachait les noms de poste, ensuite agrandis
//    et illisibles. L'échelle reste donc proche de 1 et ce sont les RANGÉES qui
//    s'étirent (au plus ETIREMENT_MAX × leur hauteur) pour occuper la page.

// Petite réserve en bas : le rendu imprimé peut dépasser d'un rien la mesure
// faite à l'écran, et la feuille coupe ce qui déborde.
const CIBLE_H = FEUILLE_H - ENTETE_H - ECART_H - PIED_H - 16;
const NOM_W = 260; // colonne des noms (largeur fixe du tableau)
const JOUR_MIN = 120; // colonne de jour la plus étroite admise
const ECHELLE_MAX = 1.25;
const ETIREMENT_MAX = 1.8;

function ajusterZoom(zoom: HTMLElement) {
  retablirZoom(zoom);
  if (!zoom.offsetParent) return; // élément masqué : rien à mesurer
  const nJours = Math.max(1, (zoom.querySelector("thead tr")?.children.length ?? 2) - 1);
  const wMin = NOM_W + nJours * JOUR_MIN;
  const echelles = (w: number) => {
    zoom.style.width = `${w}px`;
    const h = zoom.scrollHeight || 1;
    return { fl: FEUILLE_L / w, fh: CIBLE_H / h };
  };

  // L'échelle permise par la largeur décroît avec la largeur de mise en page,
  // celle permise par la hauteur croît (moins de retours à la ligne) : l'optimum
  // est leur croisement, ou la largeur minimale si la hauteur n'est pas limitante.
  let w = wMin;
  let e = echelles(w);
  if (e.fh < e.fl) {
    let lo = wMin;
    let hi = Math.max(4000, wMin * 3);
    if (echelles(hi).fh < echelles(hi).fl) {
      w = hi; // contenu démesuré : on prend la plus large, bornée par la hauteur
    } else {
      while (hi - lo > 4) {
        const mid = (lo + hi) / 2;
        const m = echelles(mid);
        if (m.fh >= m.fl) hi = mid;
        else lo = mid;
      }
      w = hi;
    }
    e = echelles(w);
  }
  const f = Math.min(ECHELLE_MAX, e.fl, e.fh);
  zoom.style.width = `${w}px`;
  zoom.style.transformOrigin = "top left";
  zoom.style.transform = `scale(${f})`;

  // Place restante en bas : on étire les rangées de personnes (bornées).
  const h = zoom.scrollHeight;
  const surplus = CIBLE_H / f - h;
  const rangees = [...zoom.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  if (surplus > 8 && rangees.length) {
    const naturel = rangees.reduce((s, tr) => s + tr.offsetHeight, 0) || 1;
    const k = Math.min(ETIREMENT_MAX, 1 + surplus / naturel);
    for (const tr of rangees) tr.style.height = `${Math.floor(tr.offsetHeight * k)}px`;
    zoom.classList.add("aff-etire");
  }
}

function retablirZoom(zoom: HTMLElement) {
  zoom.style.width = "";
  zoom.style.transform = "";
  zoom.style.transformOrigin = "";
  zoom.classList.remove("aff-etire");
  for (const tr of zoom.querySelectorAll<HTMLTableRowElement>("tbody tr")) tr.style.height = "";
}

export default function FeuillesImpression({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const zooms = () => [...(ref.current?.querySelectorAll<HTMLElement>(".aff-zoom") ?? [])];
    const avant = () => zooms().forEach(ajusterZoom);
    const apres = () => zooms().forEach(retablirZoom);
    window.addEventListener("beforeprint", avant);
    window.addEventListener("afterprint", apres);
    return () => {
      window.removeEventListener("beforeprint", avant);
      window.removeEventListener("afterprint", apres);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
