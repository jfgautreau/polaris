// Numeros de rotation d'un poste (poste.numero_rotation, saisi libre au Referentiel).
// Un poste tenu par plusieurs personnes porte plusieurs numeros ; chacun devient un
// emplacement ou deposer quelqu'un sur l'ecran Placement.

// Garde-fou : « 1-9999 » ne doit pas fabriquer des milliers de cases.
const MAX_NUMEROS = 30;

// Longueur maximale du champ entier (toutes les places). Referentiel et API.
export const NUMERO_ROTATION_MAX = 150;

// « n° 12 » pour un numero, « « Ailes » » pour un nom de place.
export function libellePlace(n: string): string {
  return /^\d/.test(n) ? `n° ${n}` : `« ${n} »`;
}

// « 12, 15-17 » -> ["12", "15", "16", "17"]. Separateurs : virgule, point-virgule.
// Un tiret entre deux nombres est une plage ; ailleurs le libelle est garde tel
// quel : un numero est en fait un NOM DE PLACE (« 12b », « A-3 », « Aide
// palettisation »). Depuis le 2026-10-19, l'espace ne separe plus — sauf entre
// nombres seuls (« 12 13 » reste deux places, ancienne saisie).
export function parseNumeros(txt: string | null | undefined): string[] {
  if (!txt) return [];
  const out: string[] = [];
  // Les espaces autour d'un tiret sont resserres d'abord : « 15 - 17 » est une plage.
  const parts = txt
    .replace(/\s*-\s*/g, "-")
    .split(/[,;]+/)
    .flatMap((p) => (/^\s*\d+(\s+\d+)+\s*$/.test(p) ? p.trim().split(/\s+/) : [p]));
  for (const part of parts) {
    const t = part.trim().replace(/\s+/g, " ");
    if (!t) continue;
    const plage = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (plage) {
      const [a, b] = [Number(plage[1]), Number(plage[2])];
      if (a <= b && b - a < MAX_NUMEROS) {
        for (let n = a; n <= b; n++) out.push(String(n));
        continue;
      }
    }
    out.push(t);
  }
  // Doublons ecartes : deux cases identiques seraient indistinguables a l'ecran
  // comme en base (placement.numero_rotation stocke le libelle).
  return [...new Set(out)].slice(0, MAX_NUMEROS);
}
