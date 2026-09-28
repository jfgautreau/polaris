"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Garde-fou du cache de navigation (perf P8, 2026-09-28).
//
// `experimental.staleTimes.dynamic` (next.config.ts) garde 30 s dans le navigateur
// le rendu d'une page déjà visitée : y revenir est instantané. Revers : les saisies
// de l'application passent par des appels API (fetch), qui ne purgent PAS ce
// cache — revenir sur une page visitée avant une saisie réafficherait l'état
// d'AVANT (ex. Placement : jour J, saisie, jour J+1, retour à J → saisies absentes).
//
// Règle : on retient l'heure de chaque page vue et l'heure de la dernière écriture
// (toute requête non-GET : routes API ET server actions). Une navigation vers une
// page dont la version en cache est ANTÉRIEURE à la dernière écriture et encore
// dans la fenêtre de 30 s devient un chargement complet — donc frais. Toutes les
// autres navigations profitent du cache. Couvre les liens (clic) et les
// navigations programmées (`router.push` / `router.replace` des filtres).
// Ne change rien au retour arrière du navigateur, que Next sert toujours depuis
// son cache (comportement antérieur inchangé).
const FENETRE_MS = 30_000; // = staleTimes.dynamic

const vues = new Map<string, number>();
let derniereEcriture = 0;
let installe = false;

function cle(href: string): string | null {
  try {
    const u = new URL(href, window.location.href);
    return u.origin === window.location.origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}
function cachePerime(href: string): boolean {
  const k = cle(href);
  if (!k) return false;
  const vue = vues.get(k);
  return vue !== undefined && vue <= derniereEcriture && Date.now() - vue < FENETRE_MS;
}

export default function GardeCacheNavigation() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();

  const qs = sp.toString();
  useEffect(() => {
    vues.set(pathname + (qs ? `?${qs}` : ""), Date.now());
  }, [pathname, qs]);

  useEffect(() => {
    if (installe) return;
    installe = true;

    // 1) Toute requête d'écriture date la « dernière écriture ».
    const fetchOrig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (methode !== "GET" && methode !== "HEAD") derniereEcriture = Date.now();
      return fetchOrig(input, init);
    };

    // 2) Clic sur un lien interne vers une page au cache périmé : chargement complet.
    document.addEventListener(
      "click",
      (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
        if (!cachePerime(a.href)) return;
        e.preventDefault();
        e.stopPropagation();
        window.location.assign(a.href);
      },
      true
    );

    // 3) Navigations programmées (filtres, calendrier…) : même règle.
    try {
      const pushOrig = router.push.bind(router);
      const replaceOrig = router.replace.bind(router);
      router.push = (href, options) => (cachePerime(href) ? window.location.assign(href) : pushOrig(href, options));
      router.replace = (href, options) => (cachePerime(href) ? window.location.replace(href) : replaceOrig(href, options));
    } catch {
      // Instance non modifiable : les liens restent couverts par (2).
    }
  }, [router]);

  return null;
}
