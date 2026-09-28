// Lance une lecture MAINTENANT pour l'attendre plus tard (perf P5, 2026-09-28).
//
// Les requêtes Supabase sont « paresseuses » : le builder ne part qu'au premier
// `await`/`then`. Une page qui enchaîne `await a; … await b; … await c;` paie donc
// la somme des allers-retours, même quand b et c ne dépendent pas de a. On démarre
// ici la requête (Promise.resolve déclenche le `then`) et on la récupère au moment
// où le calcul en a besoin.
//
// Le `catch` vide ne masque RIEN : il évite seulement qu'une erreur survenue avant
// l'`await` soit signalée comme « rejet non géré » (ce qui ferait tomber le
// processus Node). L'`await` ultérieur reçoit toujours l'erreur.
export function enAvance<T>(p: PromiseLike<T>): Promise<T> {
  const q = Promise.resolve(p);
  q.catch(() => {});
  return q;
}
