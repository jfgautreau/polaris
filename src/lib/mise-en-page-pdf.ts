// Mise en page des PDF de placement (2026-11-05, migration 0094). Pur et testé.
//
// Une mise en page par service et par PDF : format (A4 / A3), orientation, et
// des blocs posés sur une grille de 15 × 15 cases — en-tête, légende, absents du
// jour, et un CADRE par ligne de production. Dans son cadre, chaque poste occupe
// des cases de la même grille (1 case par défaut, agrandissable), avec des cases
// vides possibles ; un poste ne sort jamais du cadre de sa ligne.
//
// Le jour J, un poste qui reçoit plus de noms que sa case s'étire vers le bas sur
// les cases VIDES de son cadre ; s'il ne tient toujours pas, TOUTE la page
// rétrécit (proportions gardées). Un poste sans case (créé depuis, ou jamais
// placé) prend la première case libre de son cadre. Sans mise en page
// enregistrée, le PDF garde sa disposition automatique.

// Grille de 15 × 15 cases depuis le 2026-11-05 (12 × 12 au départ ; aucune mise
// en page n'était encore enregistrée, rien à convertir). Le commentaire de la
// migration 0094 parle encore de 0-11 : la base ne contrôle pas ces bornes.
export const GRILLE = 15;

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
// Case d'un poste, en cases de la grille, RELATIVE au cadre de sa ligne.
export type Place = { poste_id: string; x: number; y: number; w: number; h: number };
export type Bloc = { type: TypeBloc; ligne_id?: string; x: number; y: number; w: number; h: number; places?: Place[] };
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

const chevauche = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Une case (x, y, w, h) est-elle libre dans un cadre w × h, hors `sauf` ? */
export function caseLibre(places: Place[], cadre: { w: number; h: number }, c: { x: number; y: number; w: number; h: number }, sauf?: string): boolean {
  if (c.x < 0 || c.y < 0 || c.x + c.w > cadre.w || c.y + c.h > cadre.h) return false;
  return places.every((p) => p.poste_id === sauf || !chevauche(p, c));
}

/**
 * Cases des postes d'une ligne dans son cadre : celles enregistrées (postes
 * encore présents), puis chaque poste sans case sur la 1re case libre (ligne par
 * ligne, de gauche à droite). `sansPlace` = postes pour qui le cadre est plein.
 */
export function placerPostes(bloc: { w: number; h: number; places?: Place[] }, posteIds: string[]): { places: Place[]; sansPlace: string[] } {
  const ids = new Set(posteIds);
  const places = (bloc.places ?? []).filter((p) => ids.has(p.poste_id));
  const deja = new Set(places.map((p) => p.poste_id));
  const sansPlace: string[] = [];
  for (const id of posteIds) {
    if (deja.has(id)) continue;
    let pose = false;
    for (let y = 0; y < bloc.h && !pose; y++)
      for (let x = 0; x < bloc.w && !pose; x++)
        if (caseLibre(places, bloc, { x, y, w: 1, h: 1 })) {
          places.push({ poste_id: id, x, y, w: 1, h: 1 });
          pose = true;
        }
    if (!pose) sansPlace.push(id);
  }
  return { places, sansPlace };
}

/** Hauteur disponible de chaque poste (en cases) : sa hauteur + les cases vides contiguës SOUS lui dans le cadre. */
export function hauteursDisponibles(places: Place[], cadreH: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of places) {
    let h = p.h;
    while (p.y + h < cadreH && places.every((q) => q === p || !chevauche(q, { x: p.x, y: p.y + h, w: p.w, h: 1 }))) h++;
    out.set(p.poste_id, h);
  }
  return out;
}

const entier = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);
const rectOk = (x: number, y: number, w: number, h: number, maxW: number, maxH: number) =>
  [x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= maxW && y + h <= maxH;

/**
 * Contrôle d'une mise en page reçue du navigateur. `lignes` = lignes du service
 * (id → ids de ses postes). Rend la mise en page nettoyée, ou un message.
 * Un bloc sort de la grille → refus ; en-tête / légende / absents une fois
 * chacun ; une ligne une fois, et seulement une ligne du service ; ses postes
 * dans son cadre, sans se chevaucher, chacun une fois.
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
    if (!rectOk(x, y, w, h, GRILLE, GRILLE)) return { ok: false, erreur: "Un bloc sort de la grille." };
    const bloc: Bloc = { type, x, y, w, h };
    let cle: string = type;
    if (type === "ligne") {
      const id = typeof b.ligne_id === "string" ? b.ligne_id : "";
      const postes = lignes.get(id);
      if (!postes) return { ok: false, erreur: "Ligne inconnue pour ce service." };
      bloc.ligne_id = id;
      cle = `ligne:${id}`;
      const places: Place[] = [];
      for (const p of Array.isArray(b.places) ? (b.places as Record<string, unknown>[]) : []) {
        const pid = typeof p?.poste_id === "string" ? p.poste_id : "";
        if (!postes.has(pid)) continue; // poste retiré de la ligne depuis : ignoré
        const c = { poste_id: pid, x: entier(p.x), y: entier(p.y), w: entier(p.w), h: entier(p.h) };
        if (!rectOk(c.x, c.y, c.w, c.h, w, h)) return { ok: false, erreur: "Un poste sort du cadre de sa ligne." };
        if (places.some((q) => q.poste_id === pid)) return { ok: false, erreur: "Un poste figure deux fois." };
        if (places.some((q) => chevauche(q, c))) return { ok: false, erreur: "Deux postes se chevauchent." };
        places.push(c);
      }
      if (places.length) bloc.places = places;
    }
    if (vus.has(cle)) return { ok: false, erreur: "Un bloc figure deux fois." };
    vus.add(cle);
    propres.push(bloc);
  }
  return { ok: true, valeur: { format, orientation, blocs: propres } };
}

/**
 * Disposition de départ de l'éditeur : en-tête, cadres des lignes sur une ou deux
 * colonnes (postes rangés case par case), absents à droite, légende en bas.
 * `lignes` = id de la ligne → ids de ses postes, dans l'ordre d'affichage.
 */
export function dispositionDepart(lignes: { id: string; postes: string[] }[], avecAbsents = true): Bloc[] {
  const blocs: Bloc[] = [{ type: "entete", x: 0, y: 0, w: GRILLE, h: 1 }];
  const largeurPlan = avecAbsents ? GRILLE - 4 : GRILLE;
  const parRangee = lignes.length > 4 ? 2 : 1;
  const w = Math.floor(largeurPlan / parRangee);
  const rangees = Math.max(1, Math.ceil(lignes.length / parRangee));
  const h = Math.max(1, Math.floor((GRILLE - 2) / rangees));
  lignes.forEach((l, i) => {
    const y = 1 + Math.floor(i / parRangee) * h;
    if (y + h > GRILLE - 1) return;
    const cadre = { x: (i % parRangee) * w, y, w, h };
    blocs.push({ type: "ligne", ligne_id: l.id, ...cadre, places: placerPostes(cadre, l.postes).places });
  });
  if (avecAbsents) blocs.push({ type: "absents", x: GRILLE - 4, y: 1, w: 4, h: GRILLE - 2 });
  blocs.push({ type: "legende", x: 0, y: GRILLE - 1, w: GRILLE, h: 1 });
  return blocs;
}
