"use client";

import { useState } from "react";

// Bouton « Pré-remplir postes fixes » : place chaque personne à poste fixe sur son
// poste, pour les 3 semaines affichées (lundi→vendredi), sur le quart de son équipe
// (quart fixe ou rotation de la semaine) — indépendamment du quart affiché — sans
// écraser les cases déjà remplies. Écrit via /api/placement/prefill.
export default function PrefillButton({
  semaines,
  weekLabel,
}: {
  semaines: string[];
  weekLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const lancer = async () => {
    if (busy) return;
    if (!confirm(`Pré-remplir les postes fixes des 3 semaines affichées (${weekLabel}) ?\n\nChaque personne est placée sur son poste, au quart de son équipe (tous quarts confondus). Les cases déjà remplies (absence, autre poste) ne sont pas touchées.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/placement/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ semaines }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Échec du pré-remplissage.");
        setBusy(false);
        setTimeout(() => setMsg(null), 4000);
        return;
      }
      const n = j?.crees ?? 0;
      if (n === 0) {
        setMsg("Rien à pré-remplir (tout est déjà rempli).");
        setBusy(false);
        setTimeout(() => setMsg(null), 4000);
        return;
      }
      // La grille garde son état local (useState initialisé une fois) : router.refresh()
      // ne la met pas à jour. On recharge la vue pour afficher les nouvelles cases.
      setMsg(`${n} case${n > 1 ? "s" : ""} pré-remplie${n > 1 ? "s" : ""} ✓ — actualisation…`);
      setTimeout(() => window.location.reload(), 650);
    } catch {
      setMsg("Erreur réseau.");
      setBusy(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  return (
    <div style={{ position: "relative", display: "flex" }}>
      <button
        type="button"
        onClick={lancer}
        disabled={busy}
        title="Pré-remplir postes fixes — placer les personnes à poste fixe sur leur poste, sur les 3 semaines affichées et au quart de leur équipe (sans écraser les cases remplies)"
        aria-label="Pré-remplir postes fixes"
        className="navlink"
        style={{ width: 34, height: 34, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "…" : "📌"}
      </button>
      {msg && (
        <span style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, fontSize: 12, fontWeight: 600, color: msg.includes("✓") ? "var(--ok)" : "var(--muted)", whiteSpace: "nowrap", background: "#fff", padding: "2px 6px", borderRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,.12)", zIndex: 5 }}>
          {msg}
        </span>
      )}
    </div>
  );
}
