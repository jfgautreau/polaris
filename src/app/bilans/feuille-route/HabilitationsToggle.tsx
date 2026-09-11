"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Bascule « habilitations strictes / ignorées » du rapport Feuille de route.
// Porté par l'URL (`?hab=off` = ignorées, absent = strict par défaut) pour
// que l'état survive au partage d'un lien et à un rafraîchissement, comme les
// filtres Service et Équipe.
export default function HabilitationsToggle({ strict }: { strict: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function go(next: boolean) {
    const p = new URLSearchParams(sp.toString());
    if (next) p.delete("hab"); // strict = défaut, pas de param
    else p.set("hab", "off");
    const qs = p.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span className="muted" style={{ fontWeight: 600 }}>Habilitations :</span>
      <div className="segments">
        <button
          type="button"
          className={strict ? "seg active" : "seg"}
          onClick={() => go(true)}
          title="Une personne dont une habilitation exigée a expiré redescend au max de ses autres postes."
        >
          Strictes
        </button>
        <button
          type="button"
          className={!strict ? "seg active" : "seg"}
          onClick={() => go(false)}
          title="Les expirations d'habilitation n'affectent pas le décompte."
        >
          Ignorées
        </button>
      </div>
    </div>
  );
}
