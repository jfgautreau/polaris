// Mise en page des PDF de placement (2026-11-05, migration 0094). Pur et testé.
//
// Une mise en page par service et par PDF : format (A4 / A3), orientation, et
// des blocs posés sur une grille de 12 × 12 cases — en-tête, légende, absents du
// jour, et une ligne de production par bloc (ses postes restent dedans, dans
// l'ordre choisi). Le jour J, si un bloc reçoit plus de noms que sa place, TOUTE
// la page rétrécit (proportions gardées). Sans mise en page enregistrée, le PDF
// garde sa disposition automatique.

export const GRILLE = 12;

export type PdfPlacement = "manager" | "affich" | "affich_heures";
export const PDF_LIBELLES: Record<PdfPlacement, string> = {
  manager: "PDF Manager",
  affich: "PDF pour Affich.",
  affich_heures: "PDF pour Affich. + heures",
};
export const PDFS: PdfPlacement[] = ["manager", "affich", "affich_heures"];

export type FormatPdf = "A4" | "A3";
export type OrientationPdf = "paysage" | "portrait";
export type TypeBloc = "entete" | "legende" | "absents" | "ligne";
export type Bloc = { type: TypeBloc; ligne_id?: string; x: number; y: number; w: number; h: number; postes?: string[] };
export type MiseEnPage = { format: FormatPdf; orientation: OrientationPdf; blocs: Bloc[] };

/** Mode d'impression du Placement → PDF de la mise en page. */
export function pdfDuMode(mode: "ce" | "simple" | "heures"): PdfPlacement {
  return mode === "ce" ? "manager" : mode === "heures" ? "affich_heures" : "affich";
}

// Feuille imprimée (px @ 96 dpi, marges 8 mm) et hauteur utile du contenu, avec
// la même marge de sécurité que la disposition automatique (cf. PlacementBoard,
// L42) ; classe posée sur <body> pour la page nommée de globals.css.
export function feuille(format: FormatPdf, orientation: OrientationPdf): { l: number; h: number; utileH: number; classe: string | null } {
  if (format === "A3") return orientation === "portrait" ? { l: 1020, h: 1480, utileH: 1420, classe: "print-a3p" } : { l: 1480, h: 980, utileH: 920, classe: "print-a3" };
  return orientation === "portrait" ? { l: 700, h: 990, utileH: 930, classe: "print-a4p" } : { l: 1020, h: 650, utileH: 600, classe: null };
}

/** Postes d'une ligne dans l'ordre choisi ; ceux qui manquent à l'ordre (créés depuis) suivent, dans l'ordre par défaut. */
export function ordonnerPostes<T extends { id: string }>(postes: T[], ordre: string[] | undefined): T[] {
  if (!ordre?.length) return postes;
  const rang = new Map(ordre.map((id, i) => [id, i]));
  return postes
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rang.get(a.p.id) ?? ordre.length + a.i) - (rang.get(b.p.id) ?? ordre.length + b.i))
    .map((x) => x.p);
}

const entier = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);

/**
 * Contrôle d'une mise en page reçue du navigateur. `lignes` = lignes du service
 * (id → ids de ses postes). Rend la mise en page nettoyée, ou un message.
 * Un bloc sort de la grille → refus ; en-tête / légende / absents une fois
 * chacun ; une ligne une fois, et seulement une ligne du service.
 */
export function validerMiseEnPage(
  brut: unknown,
  lignes: Map<string, Set<string>>,
): { ok: true; valeur: MiseEnPage } | { ok: false; erreur: string } {
  if (!brut || typeof brut !== "object") return { ok: false, erreur: "Mise en page illisible." };
  const { format, orientation, blocs } = brut as { format?: unknown; orientation?: unknown; blocs?: unknown };
  if (format !== "A4" && format !== "A3") return { ok: false, erreur: "Format inconnu." };
  if (orientation !== "paysage" && orientation !== "portrait") return { ok: false, erreur: "Orientation inconnue." };
  if (!Array.isArray(blocs) || blocs.length > 200) return { ok: false, erreur: "Blocs illisibles." };
  const vus = new Set<string>();
  const propres: Bloc[] = [];
  for (const b of blocs as Record<string, unknown>[]) {
    const type = b?.type;
    if (type !== "entete" && type !== "legende" && type !== "absents" && type !== "ligne") return { ok: false, erreur: "Type de bloc inconnu." };
    const x = entier(b.x), y = entier(b.y), w = entier(b.w), h = entier(b.h);
    if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRILLE || y + h > GRILLE) {
      return { ok: false, erreur: "Un bloc sort de la grille." };
    }
    const bloc: Bloc = { type, x, y, w, h };
    let cle: string = type;
    if (type === "ligne") {
      const id = typeof b.ligne_id === "string" ? b.ligne_id : "";
      const postes = lignes.get(id);
      if (!postes) return { ok: false, erreur: "Ligne inconnue pour ce service." };
      bloc.ligne_id = id;
      cle = `ligne:${id}`;
      const ordre = Array.isArray(b.postes) ? (b.postes as unknown[]).filter((p): p is string => typeof p === "string" && postes.has(p)) : [];
      if (ordre.length) bloc.postes = [...new Set(ordre)];
    }
    if (vus.has(cle)) return { ok: false, erreur: "Un bloc figure deux fois." };
    vus.add(cle);
    propres.push(bloc);
  }
  return { ok: true, valeur: { format, orientation, blocs: propres } };
}

/** Disposition de départ de l'éditeur : en-tête, lignes sur deux colonnes, absents à droite, légende en bas. */
export function dispositionDepart(ligneIds: string[], avecAbsents = true): Bloc[] {
  const blocs: Bloc[] = [{ type: "entete", x: 0, y: 0, w: GRILLE, h: 1 }];
  const largeurPlan = avecAbsents ? GRILLE - 3 : GRILLE;
  const parRangee = ligneIds.length > 4 ? 2 : 1;
  const w = Math.floor(largeurPlan / parRangee);
  const rangees = Math.max(1, Math.ceil(ligneIds.length / parRangee));
  const h = Math.max(1, Math.floor((GRILLE - 2) / rangees));
  ligneIds.forEach((id, i) => {
    const y = 1 + Math.floor(i / parRangee) * h;
    if (y + h <= GRILLE - 1) blocs.push({ type: "ligne", ligne_id: id, x: (i % parRangee) * w, y, w, h });
  });
  if (avecAbsents) blocs.push({ type: "absents", x: GRILLE - 3, y: 1, w: 3, h: GRILLE - 2 });
  blocs.push({ type: "legende", x: 0, y: GRILLE - 1, w: GRILLE, h: 1 });
  return blocs;
}
