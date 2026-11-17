// Historique d'une formation (Param. Habilitation) reconstruit depuis le journal
// d'audit : la table `competence` y est journalisée depuis la 0004, aucune
// table dédiée n'est nécessaire. Règles pures, testées.
//
// Une modification de la durée de validité déclenche un recalcul des échéances
// déjà saisies (`recalculerEcheances`), journalisé en LOT « Échéances
// recalculées : <nom> (N) ». On le rattache à la modification qui l'a causé :
// même nom de formation, au plus quelques minutes après.

export type LigneAudit = {
  id: number;
  created_at: string;
  action: string; // INSERT | UPDATE | DELETE
  app_user_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

export type LotAudit = {
  id: number;
  created_at: string;
  lot_libelle: string | null;
  new_values: Record<string, unknown> | null;
};

export type ChangementFormation = { champ: string; avant: string; apres: string };

export type EvenementFormation = {
  id: number;
  le: string;
  action: "creation" | "modification" | "suppression";
  auteurId: string | null;
  changements: ChangementFormation[];
  echeancesRecalculees: number | null;
};

// Champs montrés, dans l'ordre de l'écran. Les autres (horodatages, site,
// type…) ne sont pas des réglages de la formation.
const CHAMPS: { k: string; label: string }[] = [
  { k: "nom", label: "Nom" },
  { k: "groupe", label: "Groupe" },
  { k: "categorie", label: "Catégorie" },
  { k: "duree_validite_mois", label: "Validité" },
  { k: "a_autorisation_conduite", label: "Autorisation" },
  { k: "ordre", label: "N° aff." },
  { k: "actif", label: "Actif" },
];

const CATEGORIES: Record<string, string> = { reglementaire: "Règlementaire", interne: "Interne" };

export function valeurChamp(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") {
    return k === "duree_validite_mois" ? "sans échéance" : "—";
  }
  if (k === "duree_validite_mois") return `${v} mois`;
  if (k === "categorie") return CATEGORIES[String(v)] ?? String(v);
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  return String(v);
}

const meme = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const LOT_DELAI_MS = 5 * 60 * 1000;
const PREFIXE_LOT = "Échéances recalculées : ";

/** Lignes du journal (table competence, une formation) → événements lisibles, du plus récent au plus ancien. */
export function evenementsFormation(lignes: LigneAudit[], lots: LotAudit[]): EvenementFormation[] {
  const lotsLibres = [...lots].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const pris = new Set<number>();
  const chrono = [...lignes].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const out: EvenementFormation[] = [];

  for (const l of chrono) {
    const avant = l.old_values ?? {};
    const apres = l.new_values ?? {};
    if (l.action === "INSERT") {
      out.push({
        id: l.id,
        le: l.created_at,
        action: "creation",
        auteurId: l.app_user_id,
        changements: CHAMPS.filter((c) => apres[c.k] !== undefined && apres[c.k] !== null && apres[c.k] !== "").map((c) => ({
          champ: c.label,
          avant: "",
          apres: valeurChamp(c.k, apres[c.k]),
        })),
        echeancesRecalculees: null,
      });
      continue;
    }
    if (l.action === "DELETE") {
      out.push({ id: l.id, le: l.created_at, action: "suppression", auteurId: l.app_user_id, changements: [], echeancesRecalculees: null });
      continue;
    }
    if (l.action !== "UPDATE") continue;
    // Journal compact (0090) : seuls les champs modifiés diffèrent ; avant la
    // 0090, la ligne entière — la comparaison couvre les deux formats.
    const changements = CHAMPS.filter((c) => (c.k in avant || c.k in apres) && !meme(avant[c.k], apres[c.k])).map((c) => ({
      champ: c.label,
      avant: valeurChamp(c.k, avant[c.k]),
      apres: valeurChamp(c.k, apres[c.k]),
    }));
    if (!changements.length) continue;

    let echeances: number | null = null;
    if (!meme(avant.duree_validite_mois, apres.duree_validite_mois)) {
      const nom = String(apres.nom ?? avant.nom ?? "");
      const t = Date.parse(l.created_at);
      const lot = lotsLibres.find((x) => {
        if (pris.has(x.id)) return false;
        const dt = Date.parse(x.created_at) - t;
        return dt >= 0 && dt <= LOT_DELAI_MS && (x.lot_libelle ?? "").startsWith(`${PREFIXE_LOT}${nom} (`);
      });
      if (lot) {
        pris.add(lot.id);
        const n = Number(lot.new_values?.lignes);
        echeances = Number.isFinite(n) ? n : null;
      }
    }
    out.push({ id: l.id, le: l.created_at, action: "modification", auteurId: l.app_user_id, changements, echeancesRecalculees: echeances });
  }
  return out.reverse();
}
