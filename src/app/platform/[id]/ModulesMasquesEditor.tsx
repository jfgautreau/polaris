"use client";

import { useState, useTransition } from "react";
import { setModuleMasque } from "../actions";

// Grille de bascules « visible / masqué » par module, pour un site.
// Coché = visible ; décoché = masqué (une ligne site_module est posée).
// Optimiste + useTransition : l'état bascule tout de suite, le server action
// persiste en fond.
export default function ModulesMasquesEditor({
  siteId,
  modules,
}: {
  siteId: string;
  modules: { key: string; label: string; masque: boolean }[];
}) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(modules.map((m) => [m.key, m.masque]))
  );
  const [pending, start] = useTransition();

  function toggle(key: string) {
    const nouveauMasque = !state[key];
    setState((s) => ({ ...s, [key]: nouveauMasque }));
    start(async () => {
      try {
        await setModuleMasque(siteId, key, nouveauMasque);
      } catch {
        // Échec : on revient à l'état précédent.
        setState((s) => ({ ...s, [key]: !nouveauMasque }));
      }
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
      {modules.map((m) => {
        const visible = !state[m.key];
        return (
          <label
            key={m.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              background: visible ? "#fff" : "#f8fafc",
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.7 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={visible}
              onChange={() => toggle(m.key)}
              disabled={pending}
            />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{m.label}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 600,
                color: visible ? "#16a34a" : "#dc2626",
              }}
            >
              {visible ? "Visible" : "Masqué"}
            </span>
          </label>
        );
      })}
    </div>
  );
}
