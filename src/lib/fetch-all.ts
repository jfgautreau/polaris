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
export const PAGE_SIZE = 1000;
const PREMIERE_VAGUE = 3;
const VAGUE = 8;

type Page<T> = { data: T[] | null; error: { message: string } | null };
type Rangeable<T> = { range(from: number, to: number): PromiseLike<Page<T>> };

async function tranche<T>(makeQuery: () => Rangeable<T>, index: number): Promise<T[]> {
  const from = index * PAGE_SIZE;
  const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAll<T>(makeQuery: () => Rangeable<T>): Promise<T[]> {
  const out: T[] = await tranche(makeQuery, 0);
  if (out.length < PAGE_SIZE) return out;
  for (let debut = 1, taille = PREMIERE_VAGUE; ; debut += taille, taille = VAGUE) {
    const pages = await Promise.all(Array.from({ length: taille }, (_, i) => tranche(makeQuery, debut + i)));
    for (const batch of pages) {
      out.push(...batch);
      // Tranche incomplete = fin des donnees : les suivantes de la vague sont vides.
      if (batch.length < PAGE_SIZE) return out;
    }
  }
}
