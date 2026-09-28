"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon, NAV_COLOR } from "@/components/NavIcons";
import { COOKIE_QUART, COOKIE_PLACEMENT_SERVICE, ecrireCookieSession } from "@/lib/filtres-session";

type L = { key: string; href: string; label: string };

// Report CONTEXTUEL des filtres quand on bascule d'un écran à l'autre par le
// menu (décisions produit 2026-09-15 puis 2026-09-28). Le filtre ne suit que ce
// saut précis ; la persistance au-delà est portée par les cookies de session
// (quart, dernier service de Placement — cf. src/lib/filtres-session.ts).
//
// Chaque écran déclare les filtres qu'il comprend et le NOM de son paramètre :
//   - service : `service` côté Personnel, `atelier` partout ailleurs ;
//   - équipe  : deux dialectes. « planning » (Planning, Placement) : absent =
//     automatique (équipes du quart), `all` = toutes, sinon un id. « simple »
//     (Personnel, Matrice, Habilitations) : absent = toutes, sinon un id ;
//   - quart   : Planning, Placement, Bilans. Pris dans l'URL courante, sinon dans
//     la mémoire de session (`quartSession`, lue par AppHeader côté serveur).
// Bilans : service + quart seulement (le Cockpit les transmet aux rapports).
type Ecran = { search?: boolean; equipe?: "planning" | "simple"; service?: string; quart?: boolean };
const ECRANS: Record<string, Ecran> = {
  "/planning": { search: true, equipe: "planning", service: "atelier", quart: true },
  "/placement": { search: true, equipe: "planning", service: "atelier", quart: true },
  "/personnel": { search: true, equipe: "simple", service: "service" },
  "/matrice": { search: true, equipe: "simple", service: "atelier" },
  "/habilitations": { search: true, equipe: "simple", service: "atelier" },
  "/absences-specifiques": { search: true, service: "atelier" },
  "/bilans": { service: "atelier", quart: true },
};
// Les rapports (/bilans/xxx) comptent comme l'écran Bilans.
const ecranDe = (path: string) => (path.startsWith("/bilans/") ? "/bilans" : path);

export default function MainNav({
  links,
  active,
  quartSession = "",
}: {
  links: L[];
  active?: string;
  quartSession?: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  // Mémoire de session : le quart choisi dans Planning / Placement, et le plan
  // (service) affiché dans Placement.
  const quartUrl = sp.get("quart") ?? "";
  const atelierUrl = sp.get("atelier") ?? "";
  useEffect(() => {
    if ((pathname === "/planning" || pathname === "/placement") && quartUrl) ecrireCookieSession(COOKIE_QUART, quartUrl);
    if (pathname === "/placement" && atelierUrl) ecrireCookieSession(COOKIE_PLACEMENT_SERVICE, atelierUrl);
  }, [pathname, quartUrl, atelierUrl]);

  function hrefFor(l: L): string {
    const srcKey = ecranDe(pathname);
    const src = ECRANS[srcKey];
    const dst = ECRANS[l.href];
    // On ne reporte que lorsqu'on QUITTE l'un de ces écrans vers un AUTRE.
    if (!src || !dst || srcKey === l.href) return l.href;
    const p = new URLSearchParams();

    const search = src.search ? sp.get("search") : null;
    if (search && dst.search) p.set("search", search);

    // Équipe : traduction entre les deux dialectes.
    const equipe = src.equipe ? sp.get("equipe") ?? "" : "";
    if (equipe && dst.equipe) {
      if (equipe !== "all") p.set("equipe", equipe);
      else if (src.equipe === "planning" && dst.equipe === "planning") p.set("equipe", "all");
    }

    const service = src.service ? sp.get(src.service) : null;
    if (service && dst.service) p.set(dst.service, service);

    if (dst.quart) {
      const quart = (src.quart ? sp.get("quart") : null) || quartSession;
      if (quart) p.set("quart", quart);
    }

    const qs = p.toString();
    return qs ? `${l.href}?${qs}` : l.href;
  }

  return (
    <>
      {links.map((l) => {
        const tile = NAV_COLOR[l.key];
        return (
          <Link
            key={l.href}
            href={hrefFor(l)}
            className={active === l.href ? "navlink active" : "navlink"}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {tile && (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  background: tile,
                  flexShrink: 0,
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
                }}
              >
                <NavIcon name={l.key} />
              </span>
            )}
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
