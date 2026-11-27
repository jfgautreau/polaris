// Couleur du TEXTE posé sur un fond coloré (motifs d'absence, 2026-11-27).
// Un motif saisi en noir dans Param. RH s'écrivait noir sur noir : le texte suit
// désormais le fond. `choisie` = couleur réglée à la main (motif_absence.
// couleur_texte, 0099) ; vide ou invalide = automatique (noir ou blanc, selon ce
// qui se lit le mieux sur le fond). Pur et testé.

const HEX = /^#([0-9a-f]{6})$/i;
export const TEXTE_SOMBRE = "#111827";
export const TEXTE_CLAIR = "#ffffff";

/** Couleur de texte valide (« #rrggbb ») ou null. */
export function couleurTexteValide(c: string | null | undefined): string | null {
  const v = (c ?? "").trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

// Luminance relative (WCAG) d'une couleur « #rrggbb » ; fond illisible = clair.
function luminance(fond: string | null | undefined): number {
  const m = HEX.exec((fond ?? "").trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const canal = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** Noir ou blanc : celui qui contraste le plus avec le fond. */
export function texteAuto(fond: string | null | undefined): string {
  const l = luminance(fond);
  // Contraste avec le blanc (1,05 / (l + 0,05)) contre le texte sombre.
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.06 ? TEXTE_CLAIR : TEXTE_SOMBRE;
}

/** Couleur du texte sur `fond` : celle choisie si elle est valide, sinon l'automatique. */
export function texteSur(fond: string | null | undefined, choisie?: string | null): string {
  return couleurTexteValide(choisie) ?? texteAuto(fond);
}
