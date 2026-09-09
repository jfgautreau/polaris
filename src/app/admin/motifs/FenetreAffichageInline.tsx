"use client";

import { useState, useRef } from "react";

// Réglage « Fenêtre d'affichage du planning » avec enregistrement AUTOMATIQUE :
// pas de bouton « Enregistrer ». Chaque changement de valeur envoie l'action
// serveur (debouncé de 500 ms le temps que l'utilisateur finisse de taper).
//
// Deux MODES (2026-09-09, migration 0067) :
//   - Relatif : fenêtre glissante « X jours avant / Y jours après » aujourd'hui.
//   - Absolu  : N semaines calendaires à partir du lundi de la semaine courante
//               (S, S+1, S+2…). Cadrage stable, lisible sur une TV de couloir.
export default function FenetreAffichageInline({
  initial,
}: {
  initial: { mode?: "relatif" | "absolu"; jours_avant: number; jours_apres: number; nb_semaines?: number };
}) {
  const [mode, setMode] = useState<"relatif" | "absolu">(initial.mode ?? "relatif");
  const [avant, setAvant] = useState<number>(initial.jours_avant);
  const [apres, setApres] = useState<number>(initial.jours_apres);
  const [semaines, setSemaines] = useState<number>(initial.nb_semaines ?? 2);
  const [etat, setEtat] = useState<"idle" | "saving" | "saved" | "error" | "migration">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Endpoint dédié (/api/param-affichage) plutôt qu'un server action : les
  // actions serveur redirigent (via redirect()) et rechargeraient la page à
  // chaque touche, ce qui interdit l'auto-save.
  function planifier(next: { mode?: "relatif" | "absolu"; avant?: number; apres?: number; semaines?: number }) {
    if (timer.current) clearTimeout(timer.current);
    setEtat("saving");
    const payload = {
      mode: next.mode ?? mode,
      jours_avant: next.avant ?? avant,
      jours_apres: next.apres ?? apres,
      nb_semaines: next.semaines ?? semaines,
    };
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/param-affichage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        const j = await res.json().catch(() => ({}));
        if (j?.migrationNeeded) {
          setEtat("migration");
        } else {
          setEtat("saved");
          setTimeout(() => setEtat("idle"), 1500);
        }
      } catch {
        setEtat("error");
      }
    }, 500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Choix du mode — deux radios explicites, l'étiquette « Mode » précise ce
          qu'on règle (jours pivot vs semaines calendaires). */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Mode</span>
        <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="radio"
            name="mode-affichage"
            checked={mode === "relatif"}
            onChange={() => {
              setMode("relatif");
              planifier({ mode: "relatif" });
            }}
          />
          <span>Relatif (jours avant / après aujourd&apos;hui)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="radio"
            name="mode-affichage"
            checked={mode === "absolu"}
            onChange={() => {
              setMode("absolu");
              planifier({ mode: "absolu" });
            }}
          />
          <span>Absolu (semaines calendaires : S, S+1, S+2…)</span>
        </label>
      </div>

      {/* Réglages fins — un seul jeu à la fois, celui du mode actif. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        {mode === "relatif" ? (
          <>
            <div className="field">
              <span>Jours avant J (0-14)</span>
              <input
                type="number"
                min={0}
                max={14}
                value={avant}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(14, Number(e.target.value || 0)));
                  setAvant(v);
                  planifier({ avant: v });
                }}
                style={{ width: 90 }}
              />
            </div>
            <div className="field">
              <span>Jours après J (0-30)</span>
              <input
                type="number"
                min={0}
                max={30}
                value={apres}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(30, Number(e.target.value || 0)));
                  setApres(v);
                  planifier({ apres: v });
                }}
                style={{ width: 90 }}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <span>Nombre de semaines (1-6)</span>
            <input
              type="number"
              min={1}
              max={6}
              value={semaines}
              onChange={(e) => {
                const v = Math.max(1, Math.min(6, Number(e.target.value || 1)));
                setSemaines(v);
                planifier({ semaines: v });
              }}
              style={{ width: 90 }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Fenêtre : lundi de la semaine courante → dimanche de la Nᵉ semaine.
            </span>
          </div>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: etat === "error" ? "var(--danger)" : etat === "saved" ? "var(--ok)" : etat === "migration" ? "#b45309" : "var(--muted)", marginBottom: 6 }}>
          {etat === "saving"
            ? "Enregistrement…"
            : etat === "saved"
              ? "Enregistré ✓"
              : etat === "error"
                ? "Échec"
                : etat === "migration"
                  ? "Enregistré — migration 0067 requise pour le mode absolu"
                  : ""}
        </span>
      </div>
    </div>
  );
}
