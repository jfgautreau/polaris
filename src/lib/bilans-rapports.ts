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
  { key: "bilan:polyvalence", slug: "polyvalence", href: "/bilans/polyvalence", ic: "🎯", t: "Polyvalence & compétences", d: "Compétence moyenne par atelier, postes fragiles, écarts cible, habilitations.", garde: "matrice" },
  { key: "bilan:montee-competence", slug: "montee-competence", href: "/bilans/montee-competence", ic: "📈", t: "Plan de montée en compétence", d: "Actuel vs cible en global, puis qui former sur quel poste, atelier par atelier.", garde: "matrice" },
  { key: "bilan:couverture", slug: "couverture", href: "/bilans/couverture", ic: "🛡️", t: "Adéquation Charge / capacité", d: "Besoin d'après l'ordonnancement vs présents, par quart et par atelier.", garde: "bilans" },
  { key: "bilan:anticipation", slug: "anticipation", href: "/bilans/anticipation", ic: "🔭", t: "Anticipation", d: "Capacité vs charge à venir, impact des absences et des fins de contrat.", garde: "bilans" },
  { key: "bilan:projection", slug: "projection", href: "/bilans/projection", ic: "🧮", t: "Projection de capacité", d: "Tenue semaine par semaine sur 4/8/12 sem. : une personne polyvalente compte pour une seule place (affectation optimale). Habilitations expirées déduites.", garde: "bilans" },
  { key: "bilan:competences-critiques", slug: "competences-critiques", href: "/bilans/competences-critiques", ic: "🕳️", t: "Compétences critiques", d: "Postes à relève unique croisés avec les départs, retraites et expirations d'habilitation. Les savoir-faire que vous êtes sur le point de perdre.", garde: "bilans" },
];

export const CLES_RAPPORTS_BILAN: string[] = RAPPORTS_BILAN.map((r) => r.key);

// Clé de masquage d'un rapport à partir de son slug d'URL (segment de route).
export function cleRapport(slug: string): string {
  return `bilan:${slug}`;
}
