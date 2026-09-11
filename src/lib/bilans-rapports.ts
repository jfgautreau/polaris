// Source unique des rapports détaillés du menu Bilans.
//
// Lue par le Cockpit (`/bilans`, qui rend les navcards) ET par l'écran
// plateforme (`/platform/[id]`, qui pilote leur masquage par site). Chaque
// rapport peut être masqué site par site — même mécanisme que les menus
// (table `site_module`, présence d'une ligne = masqué), mais avec des clés
// dédiées préfixées `bilan:` pour ne pas collisionner avec `MODULE_KEYS`.
//
// `garde` = le module de permission que la page du rapport exige en lecture
// (la plupart `bilans`, deux exceptions historiques sur `matrice`). Le
// masquage par rapport est une couche AU-DESSUS de ce droit et du masquage
// du menu Bilans lui-même : indépendant, jamais un contournement.

export type RapportBilan = {
  key: string; // clé site_module, ex. "bilan:absenteisme"
  slug: string; // dernier segment de l'URL
  href: string;
  ic: string;
  t: string;
  d: string;
  garde: "bilans" | "matrice";
};

export const RAPPORTS_BILAN: RapportBilan[] = [
  { key: "bilan:syntheses", slug: "syntheses", href: "/bilans/syntheses", ic: "📋", t: "Synthèses hebdomadaires", d: "Absences de la semaine (hors intérim) et planning prévisionnel des intérimaires par agence — exports PDF.", garde: "bilans" },
  { key: "bilan:personnel", slug: "personnel", href: "/bilans/personnel", ic: "👥", t: "Personnel", d: "Effectif, contrats, absentéisme, mouvements.", garde: "bilans" },
  { key: "bilan:absenteisme", slug: "absenteisme", href: "/bilans/absenteisme", ic: "🌡️", t: "Absentéisme", d: "Tendance 12 mois planifié / non planifié, facteur de Bradford (absences courtes répétées), taux par équipe.", garde: "bilans" },
  { key: "bilan:polyvalence", slug: "polyvalence", href: "/bilans/polyvalence", ic: "🎯", t: "Polyvalence & compétences", d: "Constat → risque → action : polyvalence par service, postes critiques/fragiles (relève opérationnelle), départs & habilitations à échéance, plan de formation prioritaire.", garde: "matrice" },
  { key: "bilan:couverture", slug: "couverture", href: "/bilans/couverture", ic: "🛡️", t: "Adéquation Charge / capacité", d: "Besoin d'après l'ordonnancement vs présents, par quart et par service.", garde: "bilans" },
  { key: "bilan:assez-competences", slug: "assez-competences", href: "/bilans/assez-competences", ic: "🧑‍🏭", t: "Assez de compétences ?", d: "Aide à la validation des congés : par service et par jour sur 2 semaines, les postes tenables une fois les absences, temps partiels et fins de contrat déduits — sans compter deux fois un polyvalent.", garde: "bilans" },
  { key: "bilan:anticipation", slug: "anticipation", href: "/bilans/anticipation", ic: "🔭", t: "Anticipation", d: "Capacité vs charge à venir, impact des absences et des fins de contrat.", garde: "bilans" },
  { key: "bilan:projection", slug: "projection", href: "/bilans/projection", ic: "🧮", t: "Projection de capacité", d: "Tenue semaine par semaine sur 4/8/12 sem. : une personne polyvalente compte pour une seule place (affectation optimale). Habilitations expirées déduites.", garde: "bilans" },
  { key: "bilan:feuille-route", slug: "feuille-route", href: "/bilans/feuille-route", ic: "🗺️", t: "Projection de compétences — feuille de route", d: "Sur 12 semaines : nombre de personnes par service, catégorie et niveau exact (MAX par catégorie). Absences pleine semaine, expirations d'habilitation et fins de contrat déduites. Bascule habilitations strictes / ignorées.", garde: "matrice" },
];

export const CLES_RAPPORTS_BILAN: string[] = RAPPORTS_BILAN.map((r) => r.key);

// Clé de masquage d'un rapport à partir de son slug d'URL (segment de route).
export function cleRapport(slug: string): string {
  return `bilan:${slug}`;
}
