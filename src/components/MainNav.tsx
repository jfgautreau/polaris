"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon, NAV_COLOR } from "@/components/NavIcons";

type L = { key: string; href: string; label: string };

// Report CONTEXTUEL des filtres entre Planning et Personnel : quand on bascule
// de l'un à l'autre par le menu, le nom recherché, l'équipe et le service
// voyagent. Décision produit (2026-09-15) : contextuel, PAS collant — le filtre
// ne suit que ce saut précis, jamais tous les écrans. Le « service » change de
// nom de paramètre selon l'écran : `atelier` côté Planning, `service` côté
// Personnel. Le quart (Planning) et le statut/fiche (Personnel) NE voyagent pas.
const PONT = new Set(["/planning", "/personnel"]);

export default function MainNav({ links, active }: { links: L[]; active?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefFor(l: L): string {
    // On ne reporte que lorsqu'on QUITTE Planning/Personnel vers l'AUTRE des deux.
    if (!PONT.has(pathname) || !PONT.has(l.href) || pathname === l.href) return l.href;
    const p = new URLSearchParams();
    const search = sp.get("search");
    const equipe = sp.get("equipe");
    // Service : lu sous `atelier` (Planning) ou `service` (Personnel), réécrit
    // sous le nom attendu par l'écran cible.
    const service = pathname === "/planning" ? sp.get("atelier") : sp.get("service");
    if (search) p.set("search", search);
    if (equipe) p.set("equipe", equipe);
    if (service) p.set(l.href === "/planning" ? "atelier" : "service", service);
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
