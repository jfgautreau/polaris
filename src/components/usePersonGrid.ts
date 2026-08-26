"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Comportements communs aux grilles « personnes x colonnes » (Matrice,
 * Habilitations) :
 *   - le panneau d'en-tetes suit horizontalement la liste ;
 *   - la colonne survolee est peinte via le fond du `<col>` et une classe sur
 *     son en-tete, ecrits directement dans le DOM. Aucun rendu React, donc
 *     aucun cout sur une grille de plusieurs milliers de cellules.
 *   - **virtualisation des lignes** (facultative, via `virt`) : seules les
 *     lignes visibles a l'ecran sont rendues, plus une marge (`overscan`).
 *     Deux « cales » (rangees vides d'une hauteur calculee) preservent la
 *     course de l'ascenseur. Toutes les lignes ayant la meme hauteur fixe
 *     (`--grid-row-h`, 32 px), savoir quelles lignes sont visibles n'est
 *     qu'un calcul (scrollTop / hauteur) — ni mesure ni librairie externe.
 *     Les colonnes, elles, ne sont PAS virtualisees : colonne des noms figee,
 *     en-tetes collants et survol en croix continuent de marcher a l'identique.
 *
 * `colHeadRow` = index (1-based) de la rangee de `thead` qui porte les
 * en-tetes de colonne : 2 pour la Matrice (ligne / poste), 3 pour les
 * Habilitations (categorie / groupe / formation).
 *
 * `virt` (facultatif) : `{ rowCount, rowHeight?, overscan? }`.
 *   - `rowCount` = nombre de lignes REELLEMENT affichees (apres filtre de
 *     recherche) ; le hook s'y adapte automatiquement.
 *   - `rowHeight` = hauteur d'une ligne en px (defaut 32, = `--grid-row-h`).
 *   - `overscan` = lignes rendues en marge au-dessus/en dessous (defaut 8).
 * En retour, `virtual` = `{ start, end, padTop, padBottom }` : l'appelant rend
 * `items.slice(start, end)` encadre de deux cales de hauteur `padTop`/`padBottom`.
 */
type VirtOpts = { rowCount: number; rowHeight?: number; overscan?: number };
type VirtWindow = { start: number; end: number; padTop: number; padBottom: number };

// Fenetre rendue au tout premier rendu (avant mesure du viewport). Assez large
// pour remplir un ecran haut, assez petite pour que le HTML initial reste leger.
const INITIAL_ROWS = 40;

export function usePersonGrid(colHoverClass: string, colHeadRow: number, virt?: VirtOpts) {
  const headCardRef = useRef<HTMLDivElement>(null);
  const headTableRef = useRef<HTMLTableElement>(null);
  const rowsTableRef = useRef<HTMLTableElement>(null);
  const rowsCardRef = useRef<HTMLDivElement>(null);
  const hoverCol = useRef(-1);

  const rowCount = virt?.rowCount ?? 0;
  const rowH = virt?.rowHeight ?? 32;
  // Marge de lignes rendues au-dela du viewport. Assez large pour qu'un
  // defilement rapide ne devoile pas une cale vide avant le re-rendu React
  // (le flash « lignes qui se chargent »), le surcout de ~16 lignes restant
  // negligeable face aux milliers de la grille complete.
  const overscan = virt?.overscan ?? 16;

  // Fenetre visible [start, end[. Etat initial deterministe (identique serveur
  // et client -> pas de desynchro d'hydratation) : les INITIAL_ROWS premieres.
  const [range, setRange] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: Math.min(rowCount, INITIAL_ROWS),
  }));

  // Recalcule la fenetre depuis la position et la hauteur du conteneur defilant.
  const recompute = useCallback(() => {
    const el = rowsCardRef.current;
    if (!el || !virt) return;
    const viewH = el.clientHeight || 1;
    const visible = Math.ceil(viewH / rowH);
    let start = Math.floor(el.scrollTop / rowH) - overscan;
    // Borne le debut : si l'on filtre alors qu'on etait defile bas, scrollTop
    // reste grand une frame de plus que le contenu -> eviter une fenetre vide.
    start = Math.max(0, Math.min(start, Math.max(0, rowCount - visible)));
    const end = Math.min(rowCount, start + visible + overscan * 2);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [virt, rowH, overscan, rowCount]);

  // Mesure au montage puis a chaque changement de rowCount (filtre de recherche).
  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  // Reagit au redimensionnement de la fenetre / du conteneur.
  useEffect(() => {
    const el = rowsCardRef.current;
    if (!el || !virt) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recompute, virt]);

  function paintCol(index: number, on: boolean) {
    for (const t of [headTableRef.current, rowsTableRef.current]) {
      const col = t?.querySelector("colgroup")?.children[index] as HTMLElement | undefined;
      if (col) col.style.background = on ? "var(--col-hover)" : "";
    }
    const th = headTableRef.current?.querySelectorAll(`thead tr:nth-child(${colHeadRow}) th`)[index - 1];
    th?.classList.toggle(colHoverClass, on);
  }

  function hoverAt(index: number) {
    if (hoverCol.current === index) return;
    if (hoverCol.current > 0) paintCol(hoverCol.current, false);
    hoverCol.current = index;
    if (index > 0) paintCol(index, true);
  }

  // La liste est le seul ascenseur visible ; l'en-tete la suit, et la fenetre
  // virtualisee se recalcule (l'evenement scroll couvre les deux axes).
  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    const head = headCardRef.current;
    if (head) head.scrollLeft = e.currentTarget.scrollLeft;
    if (virt) recompute();
  }

  // A etaler sur le conteneur scrollable de la liste.
  const rowsCardProps = {
    ref: rowsCardRef,
    onScroll: syncScroll,
    onMouseOver: (e: React.MouseEvent) => hoverAt((e.target as HTMLElement).closest("td")?.cellIndex ?? -1),
    onMouseLeave: () => hoverAt(-1),
  };

  const virtual: VirtWindow | null = virt
    ? {
        start: range.start,
        end: range.end,
        padTop: range.start * rowH,
        padBottom: Math.max(0, (rowCount - range.end) * rowH),
      }
    : null;

  return { headCardRef, headTableRef, rowsTableRef, rowsCardProps, virtual };
}
