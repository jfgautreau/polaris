// Petits pictogrammes SVG partagés (héritent la couleur via `currentColor`,
// donc suivent le `color` du bouton parent). Un seul endroit à retoucher.

type P = { size?: number; color?: string };

// Disquette « Enregistrer » — variante « pleine, deux tons » (choix du 24/07/2026).
// Corps en `currentColor` ; le curseur et l'étiquette sont évidés avec la couleur
// du FOND du bouton (`hole`, blanc par défaut car les boutons Enregistrer ont un
// fond blanc). Les deux traits de l'étiquette reprennent `currentColor`.
export function SaveIcon({ size = 15, hole = "#fff" }: { size?: number; hole?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path fill="currentColor" d="M4 4.6C4 3.7 4.7 3 5.6 3H16l4 4v11.4c0 .9-.7 1.6-1.6 1.6H5.6C4.7 20 4 19.3 4 18.4V4.6Z" />
      <path fill={hole} d="M9 4.6h5.5v2.9c0 .3-.2.5-.5.5H9.5c-.3 0-.5-.2-.5-.5V4.6Z" />
      <rect fill={hole} x="7" y="13" width="10" height="6" rx=".8" />
      <path stroke="currentColor" fill="none" strokeWidth="1.3" strokeLinecap="round" d="M9 15.4h6M9 17.1h4" />
    </svg>
  );
}

// Crayon « Modifier ».
export function EditIcon({ size = 15, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

// Validation (coche) — remplace le crayon en mode édition inline d'un paramètre.
export function CheckIcon({ size = 16, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Loupe « Contrats / périodes » — variante A (choix du 24/07/2026).
export function SearchIcon({ size = 16, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5l-4.3-4.3" />
    </svg>
  );
}

// Information « Commentaire » — variante A (cercle + « i »).
export function InfoIcon({ size = 16, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5" />
      <circle cx="12" cy="7.9" r="1" fill={color} stroke="none" />
    </svg>
  );
}

// Paramètres « RGPD » — variante A (engrenage).
export function GearIcon({ size = 16, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Impression / PDF — imprimante « ligne » (choix du 2026-09-09, refonte).
// Style trait pur (comme EditIcon/SearchIcon/GearIcon), pour cohabiter sans
// heurt avec les autres icônes du bandeau Planning. ViewBox 24×24 pleinement
// occupé mais avec des marges internes (x∈[3,21], y∈[3,21]) qui protègent
// contre le rognage du bouton parent 30×30. Trois parties empilées verticalement,
// mêmes largeurs de traits, symétriques :
//   1. feuille d'entrée en haut (rectangle plus étroit)
//   2. corps de l'imprimante (rectangle plus large, avec LED)
//   3. feuille de sortie en bas (rectangle plus étroit, 2 lignes de « texte »)
// `hole` conservé pour compatibilité mais inutilisé (rendu 100% en trait).
export function PrintIcon({ size = 16, color = "currentColor" }: P & { hole?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
      {/* Feuille d'entrée */}
      <path d="M7 3h10v6H7z" />
      {/* Corps de l'imprimante */}
      <path d="M5 9h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v-4H6v4H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" />
      {/* LED (petit point plein) */}
      <circle cx="17.5" cy="12.5" r="0.8" fill={color} stroke="none" />
      {/* Feuille de sortie */}
      <path d="M6 14h12v7H6z" />
      {/* Lignes de texte sur la feuille de sortie */}
      <path d="M8.5 17h7M8.5 19h4.5" strokeWidth="1.3" />
    </svg>
  );
}

// Absence (menu Personnel) — variante B « calendrier + pastille × » (choix du 24/07/2026).
export function AbsenceIcon({ size = 16, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 11V6a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
      <circle cx="17.5" cy="17.5" r="4" />
      <path d="M16.1 16.1l2.8 2.8M18.9 16.1l-2.8 2.8" />
    </svg>
  );
}

// Remplissage « Pré-remplir » — pot de peinture (paint-bucket, style Lucide).
export function FillIcon({ size = 15, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
      <path d="m5 2 5 5" />
      <path d="M2 13h15" />
      <path d="M21.5 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
    </svg>
  );
}

// « Opérateur qualifié » — silhouette + étoile (variante D, choix du 2026-09-09).
// Utilisé par le bouton bascule « Conducteurs » du Planning et par la checkbox
// équivalente du Placement (filtre : personnes ayant au moins une compétence
// niveau ≥ 1 sur un poste `categorie = 'conducteur'` actif). Monochrome, suit
// `currentColor` → passe naturellement du bleu (inactif, fond blanc) au blanc
// (actif, fond bleu) sans configuration supplémentaire.
export function OperateurIcon({ size = 18, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-3px" }}>
      <circle cx="10" cy="7" r="3.5" />
      <path d="M3 21c0-4 3.5-7 7-7s7 3 7 7" />
      <path d="M19 2.5 20.3 5l2.7.4-2 1.8.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.8 2.7-.4L19 2.5z" fill={color} stroke="none" />
    </svg>
  );
}

// Corbeille — proposition retenue (variante « couvercle + fûts »).
export function TrashIcon({ size = 15, color = "currentColor" }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: "-2px" }}>
      <path d="M4 7h16" />
      <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
