import { cache } from "react";
import { cookies } from "next/headers";

// Mémoïsation PAR REQUÊTE HTTP, valable partout (perf, 2026-09-28).
//
// `cache()` de React ne mémorise QUE pendant le rendu d'un composant serveur :
// hors rendu (routes API /api/*, et selon les cas server actions), il appelle la
// fonction à chaque fois — vérifié dans react.react-server (« if (!dispatcher)
// return fn.apply(...) »). Conséquence : dans une route, getCurrentProfile /
// getCurrentSite / getPermissions étaient relus 3 à 6 fois pour UNE requête
// (un clic de saisie au Planning coûtait ~13 allers-retours en série).
//
// Clé de la requête : l'objet cookies de Next. `await cookies()` renvoie le MÊME
// objet pendant toute une requête (Next le met lui-même en cache dans une
// WeakMap par requête) et un objet différent pour chaque requête. La WeakMap
// ci-dessous le libère avec la requête : aucune fuite, aucun partage entre
// utilisateurs. Hors requête (cookies() lève, ex. génération statique), repli
// sur `cache()` de React.
//
// ⚠️ Arguments : valeurs primitives uniquement (sérialisées en clé).
// ⚠️ Comme `cache()`, la valeur est figée pour la requête : ne pas l'utiliser
// pour une donnée que la MÊME requête modifie puis relit.
type Primitif = string | number | boolean | null | undefined;

export function parRequete<A extends Primitif[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const enRendu = cache(fn);
  const memos = new WeakMap<object, Map<string, Promise<R>>>();
  return async (...args: A): Promise<R> => {
    let jar: object;
    try {
      jar = (await cookies()) as unknown as object;
    } catch {
      return enRendu(...args);
    }
    let m = memos.get(jar);
    if (!m) {
      m = new Map();
      memos.set(jar, m);
    }
    const k = JSON.stringify(args);
    let p = m.get(k);
    if (!p) {
      p = fn(...args);
      m.set(k, p);
      // Un échec n'est pas mémorisé : un nouvel appel dans la requête retente.
      const memo = m;
      p.catch(() => memo.delete(k));
    }
    return p;
  };
}
