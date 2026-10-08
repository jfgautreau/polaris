"use client";

import Link from "next/link";
import { useState } from "react";
import { PrintIcon, TvIcon } from "@/components/icons";

// Choix des services à afficher / imprimer ensemble (A3 portrait, chaque service
// sur une nouvelle page, cf. /affichage/impression). Chaque service garde son
// lien « Écran TV » : un écran de couloir affiche UN service, rafraîchi
// automatiquement.
export default function SelectionServices({ ateliers }: { ateliers: { id: string; nom: string }[] }) {
  const [coches, setCoches] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const tous = coches.length === ateliers.length && ateliers.length > 0;

  const basculer = (id: string) =>
    setCoches((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  // Ordre de la liste conservé, quel que soit l'ordre des clics.
  const href = (() => {
    const p = new URLSearchParams();
    for (const a of ateliers) if (coches.includes(a.id)) p.append("atelier", a.id);
    if (date) p.set("date", date);
    return `/affichage/impression?${p.toString()}`;
  })();

  if (ateliers.length === 0) return <p className="muted">Aucun service.</p>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={tous}
          onChange={() => setCoches(tous ? [] : ateliers.map((a) => a.id))}
          style={{ width: 18, height: 18, margin: 0 }}
        />
        Tous les services
      </label>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {ateliers.map((a) => (
          <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, fontSize: 17, cursor: "pointer" }}>
              <input type="checkbox" checked={coches.includes(a.id)} onChange={() => basculer(a.id)} style={{ width: 18, height: 18, margin: 0 }} />
              {a.nom}
            </label>
            <Link
              href={`/affichage/atelier/${a.id}`}
              prefetch={false}
              title={`Écran TV du service ${a.nom} (un service, rafraîchi toutes les 5 minutes)`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#1d4ed8", textDecoration: "none", fontSize: 14 }}
            >
              <TvIcon size={16} /> Écran TV
            </Link>
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          Date de référence
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Vide = aujourd'hui" />
        </label>
        {coches.length > 0 ? (
          <Link
            href={href}
            prefetch={false}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#1d4ed8", color: "#fff", borderRadius: 9, fontWeight: 600, textDecoration: "none" }}
          >
            <PrintIcon /> Imprimer {coches.length} service{coches.length > 1 ? "s" : ""}
          </Link>
        ) : (
          <span className="muted" style={{ fontSize: 14 }}>Cochez les services à imprimer (A3 portrait, chaque service sur une nouvelle page).</span>
        )}
      </div>
    </div>
  );
}
