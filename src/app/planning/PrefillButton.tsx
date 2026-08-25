"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Bouton « Pré-remplir postes fixes » : place chaque personne à poste fixe sur son
// poste, pour la semaine affichée (lundi→vendredi) et le quart affiché, sans
// écraser les cases déjà remplies. Écrit via /api/placement/prefill puis rafraîchit.
export default function PrefillButton({
  semaine,
  quart,
  quartLabel,
  weekLabel,
}: {
  semaine: string;
  quart: string;
  quartLabel: string;
  weekLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lancer = async () => {
    if (busy) return;
    if (!confirm(`Pré-remplir les postes fixes de la semaine ${weekLabel} sur le quart « ${quartLabel} » ?\n\nLes cases déjà remplies (absence, autre poste) ne sont pas touchées.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/placement/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semaine, quart }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Échec du pré-remplissage.");
      } else {
        const n = j?.crees ?? 0;
        setMsg(n === 0 ? "Rien à pré-remplir (tout est déjà rempli)." : `${n} case${n > 1 ? "s" : ""} pré-remplie${n > 1 ? "s" : ""} ✓`);
        router.refresh();
      }
    } catch {
      setMsg("Erreur réseau.");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  return (
    <div style={{ position: "relative", flex: 1, display: "flex" }}>
      <button
        type="button"
        onClick={lancer}
        disabled={busy}
        title="Placer les personnes à poste fixe sur leur poste, pour cette semaine et ce quart (sans écraser les cases remplies)"
        className="navlink"
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 15, fontWeight: 600, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 10, whiteSpace: "nowrap", background: "#fff", color: "var(--text)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        📌 {busy ? "…" : "Pré-remplir postes fixes"}
      </button>
      {msg && (
        <span style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, fontSize: 12, fontWeight: 600, color: msg.includes("✓") ? "var(--ok)" : "var(--muted)", whiteSpace: "nowrap", background: "#fff", padding: "2px 6px", borderRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,.12)", zIndex: 5 }}>
          {msg}
        </span>
      )}
    </div>
  );
}
