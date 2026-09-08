"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Atelier = { id: string; nom: string };

export default function ReportAtelierFilter({
  ateliers,
  atelier,
  avecTous = true,
}: {
  ateliers: Atelier[];
  atelier: string;
  // Certains rapports n'ont de sens que par atelier (Adequation charge/capacite) :
  // melanger les besoins de tous les ateliers n'y veut rien dire.
  avecTous?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function go(a: string) {
    const p = new URLSearchParams(sp.toString());
    if (a) p.set("atelier", a);
    else p.delete("atelier");
    const qs = p.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  if (ateliers.length === 0) return null;

  return (
    <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span className="muted" style={{ fontWeight: 600 }}>Service :</span>
      <div className="segments">
        {avecTous && (
          <button type="button" className={atelier === "" ? "seg active" : "seg"} onClick={() => go("")}>
            Tous
          </button>
        )}
        {ateliers.map((a) => (
          <button key={a.id} type="button" className={atelier === a.id ? "seg active" : "seg"} onClick={() => go(a.id)}>
            {a.nom}
          </button>
        ))}
      </div>
    </div>
  );
}
