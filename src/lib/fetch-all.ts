// PostgREST plafonne chaque reponse a 1000 lignes (reglage `db-max-rows` du
// projet Supabase). Au-dela, les lignes excedentaires sont omises **sans
// erreur** : `data` contient 1000 lignes, `error` vaut null, et la page affiche
// silencieusement des donnees incompletes.
//
// `fetchAll` rejoue la requete par tranches jusqu'a epuisement. La fabrique
// `makeQuery` doit poser un `.order(...)` deterministe, sinon deux tranches
// successives peuvent se recouvrir ou sauter des lignes.
//
// Perf (P6, 2026-09-28) : la 1re tranche seule (cas courant : < 1000 lignes →
// un aller-retour, comme avant). Si elle est pleine, les suivantes partent par
// VAGUES de `VAGUE` requetes en parallele au lieu d'une a la fois : la matrice
// (~22 000 lignes) passe d'environ 23 allers-retours en serie a 1 + 3 vagues.
// Une vague s'arrete des qu'une tranche revient incomplete ; les tranches
// au-dela (vides) sont ignorees — au pire VAGUE-1 requetes vides de trop.
//
// 2026-10-14 (journaux Supabase) : la 1re vague ne compte plus que PREMIERE_VAGUE
// tranches. Les tables lues ici dépassent souvent 1 000 lignes de peu (matrice :
// 1 306 à La Vraie Croix, 3 177 au Bignon) : 8 tranches d'un coup donnaient 9
// appels pour 2 utiles, chacun journalisé avec sa longue URL. Avec 3, jusqu'à
// 4 000 lignes tiennent en 4 appels et toujours 2 allers-retours (mesuré : 116 ms
// contre 144-180 ms à LVC, 130 ms contre 147-164 ms au Bignon). Au-delà de
// 4 000 lignes, un aller-retour de plus qu'avant (rapports des Bilans).
// 2026-10-16 (journaux Supabase) : la 1re tranche demande le TOTAL
// (`Prefer: count=exact`, rendu dans la même réponse — aucun appel de plus) et
// les tranches restantes partent alors toutes, par vagues de `VAGUE`, sans
// tranche vide : 5 646 lignes = 6 appels au lieu de 12 (1 + 3 + 8). Total absent
// (fausse requête, en-tête ignoré) : on retombe sur la découverte par vagues
// ci-dessus, qui s'arrête à la première tranche incomplète. Une tranche
// incomplète arrête aussi la lecture planifiée (lignes retirées entre-temps).
export const PAGE_SIZE = 1000;
const PREMIERE_VAGUE = 3;
const VAGUE = 8;

type Page<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
type Rangeable<T> = {
  range(from: number, to: number): PromiseLike<Page<T>>;
  /** Constructeur PostgREST (postgrest-js) : permet de demander le total. */
  setHeader?(name: string, value: string): unknown;
};

async function tranche<T>(makeQuery: () => Rangeable<T>, index: number, compter = false): Promise<{ rows: T[]; total: number | null }> {
  const from = index * PAGE_SIZE;
  const q = makeQuery();
  if (compter && typeof q.setHeader === "function") {
    // `setHeader` remplace l'en-tête : on complète un éventuel Prefer existant.
    const avant = (q as { headers?: Headers }).headers?.get?.("Prefer");
    q.setHeader("Prefer", avant ? `${avant},count=exact` : "count=exact");
  }
  const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: typeof count === "number" ? count : null };
}

export async function fetchAll<T>(makeQuery: () => Rangeable<T>): Promise<T[]> {
  const premiere = await tranche(makeQuery, 0, true);
  const out: T[] = premiere.rows;
  if (out.length < PAGE_SIZE) return out;
  // Total connu : exactement les tranches qui restent, par vagues de VAGUE.
  if (premiere.total !== null) {
    const restantes = Math.ceil(premiere.total / PAGE_SIZE) - 1;
    for (let debut = 1; debut <= restantes; ) {
      const n = Math.min(VAGUE, restantes - debut + 1);
      const pages = await Promise.all(Array.from({ length: n }, (_, i) => tranche(makeQuery, debut + i)));
      for (const p of pages) {
        out.push(...p.rows);
        if (p.rows.length < PAGE_SIZE) return out; // fin des données (lignes retirées entre-temps)
      }
      debut += n;
    }
    // Total atteint. Une ligne ajoutée APRÈS le 1er appel n'est pas lue : même
    // résultat qu'une lecture faite un instant plus tôt (l'ancienne découverte par
    // vagues n'offrait pas mieux, ses tranches pouvant aussi se décaler).
    return out;
  }
  // Découverte par vagues (total inconnu).
  for (let debut = 1, taille = PREMIERE_VAGUE; ; debut += taille, taille = VAGUE) {
    const pages = await Promise.all(Array.from({ length: taille }, (_, i) => tranche(makeQuery, debut + i)));
    for (const p of pages) {
      out.push(...p.rows);
      // Tranche incomplete = fin des donnees : les suivantes de la vague sont vides.
      if (p.rows.length < PAGE_SIZE) return out;
    }
  }
}
