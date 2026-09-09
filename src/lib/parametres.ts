import { getServerClient } from "@/lib/supabase-server";
import { mondayOf, addDays, isoDate, type Jour } from "@/lib/week";

// Parametres d'affichage du planning (fenetre glissante autour d'aujourd'hui
// OU cadrage absolu en semaines calendaires). Une ligne par site (PK site_id
// depuis la migration 0051). La RLS filtre sur le site courant.
//
// Deux modes (migration 0067) :
//   - 'relatif' (historique)  : fenêtre glissante `jours_avant` / `jours_apres`
//                               autour du pivot (aujourd'hui, ou `?date` sur TV).
//   - 'absolu'  (2026-09-09)  : `nb_semaines` semaines calendaires à partir du
//                               LUNDI de la semaine courante (S, S+1, S+2…).
//                               `jours_avant`/`jours_apres` sont ignorés.
export type ModeAffichage = "relatif" | "absolu";
export type FenetreAffichage = {
  mode: ModeAffichage;
  jours_avant: number;
  jours_apres: number;
  nb_semaines: number;
};

export const FENETRE_DEFAUT: FenetreAffichage = {
  mode: "relatif",
  jours_avant: 1,
  jours_apres: 4,
  nb_semaines: 2,
};

export async function getFenetreAffichage(): Promise<FenetreAffichage> {
  try {
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from("parametre_affichage")
      .select("mode, jours_avant, jours_apres, nb_semaines")
      .maybeSingle<Partial<FenetreAffichage>>();
    if (error || !data) return FENETRE_DEFAUT;
    // Repli tolérant si les colonnes 0067 ne sont pas encore appliquées
    // (l'écran TV ne doit jamais tomber en 500 pour un défaut manquant).
    return {
      mode: (data.mode === "absolu" ? "absolu" : "relatif") as ModeAffichage,
      jours_avant: typeof data.jours_avant === "number" ? data.jours_avant : FENETRE_DEFAUT.jours_avant,
      jours_apres: typeof data.jours_apres === "number" ? data.jours_apres : FENETRE_DEFAUT.jours_apres,
      nb_semaines: typeof data.nb_semaines === "number" ? data.nb_semaines : FENETRE_DEFAUT.nb_semaines,
    };
  } catch {
    return FENETRE_DEFAUT;
  }
}

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// Convertit une `FenetreAffichage` en liste de jours à afficher sur l'écran TV,
// avec `pivot` = date courante ou date pilotée par `?date` (mode relatif). En
// mode absolu on ignore le pivot : on part du lundi de la semaine du pivot.
export function joursDeFenetre(fen: FenetreAffichage, pivot: Date): Jour[] {
  if (fen.mode === "absolu") {
    const lun = mondayOf(pivot);
    const nb = Math.max(1, Math.min(6, fen.nb_semaines));
    return Array.from({ length: nb * 7 }, (_, i) => {
      const d = addDays(lun, i);
      return {
        iso: isoDate(d),
        nom: JOURS[(d.getDay() + 6) % 7],
        num: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      };
    });
  }
  // Mode relatif : `joursAutour` mais réimplémenté ici pour éviter le cycle
  // d'import (parametres → week → parametres). Identique à `joursAutour`.
  const avant = Math.max(0, fen.jours_avant);
  const apres = Math.max(0, fen.jours_apres);
  const debut = addDays(pivot, -avant);
  return Array.from({ length: avant + apres + 1 }, (_, i) => {
    const d = addDays(debut, i);
    return {
      iso: isoDate(d),
      nom: JOURS[(d.getDay() + 6) % 7],
      num: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
    };
  });
}
