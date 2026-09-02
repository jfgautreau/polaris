import { COULEUR_NIVEAU_DEFAUT } from "@/lib/couleurs-niveau";

// Valeur sentinelle : restriction medicale / physique (en plus de l'echelle 0..4).
export const RESTRICT = -1;

// Couleurs PAR DÉFAUT des niveaux (échelle historique), 0 = contour seul.
// Chaque site peut les personnaliser (competence_niveau_libelle.couleur, 0063) :
// le rendu reçoit alors une map `couleurs` qui surcharge celle-ci.
export const FILL: Record<number, string | null> = {
  0: null,
  ...COULEUR_NIVEAU_DEFAUT,
};

// `max` = nombre de niveaux positifs activés pour le site (1..max, défaut 4).
// La FRACTION du camembert vaut lvl/max : le niveau le plus haut activé se lit
// comme un disque plein, même quand le site n'active que 2 ou 3 niveaux. La
// COULEUR reste indexée sur le niveau absolu (FILL) — un site à 4 niveaux est
// donc rendu strictement à l'identique.
export function Pie({
  level,
  max = 4,
  couleurs = FILL,
}: {
  level: number;
  max?: number;
  couleurs?: Record<number, string | null>;
}) {
  const size = 28, r = 11, cx = 14, cy = 14;
  const lvl = Math.max(0, Math.min(max, level));
  const f = lvl / max;
  const fill = couleurs[lvl] ?? null;

  let inner = null;
  if (fill && f >= 1) {
    inner = <circle cx={cx} cy={cy} r={r} fill={fill} />;
  } else if (fill && f > 0) {
    const ang = -90 + 360 * f;
    const rad = (d: number) => (d * Math.PI) / 180;
    const x = cx + r * Math.cos(rad(ang));
    const y = cy + r * Math.sin(rad(ang));
    const large = f > 0.5 ? 1 : 0;
    inner = <path d={`M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${large} 1 ${x},${y} Z`} fill={fill} />;
  }
  // Ordre de peinture : fond blanc → couleur (disque/camembert) → CONTOUR EN
  // DERNIER. Dessiner le contour par-dessus la couleur garde le liseré gris net
  // sur toute sa largeur ; sinon la couleur (même rayon r) recouvrait sa moitié
  // interne et paraissait déborder du cercle (surtout avec une teinte saturée).
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="#fff" />
      {inner}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#64748b" strokeWidth={1.5} />
    </svg>
  );
}

// Croix rouge : restriction (medicale / physique) sur ce poste.
export function RestrictionMark() {
  const size = 28, r = 11, cx = 14, cy = 14;
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="#fee2e2" stroke="#dc2626" strokeWidth={1.5} />
      <path d="M9,9 L19,19 M19,9 L9,19" stroke="#dc2626" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}

// Rend soit la croix de restriction (niveau -1), soit le camembert 0..max.
export function LevelMark({
  level,
  max = 4,
  couleurs = FILL,
}: {
  level: number;
  max?: number;
  couleurs?: Record<number, string | null>;
}) {
  return level === RESTRICT ? <RestrictionMark /> : <Pie level={level} max={max} couleurs={couleurs} />;
}
