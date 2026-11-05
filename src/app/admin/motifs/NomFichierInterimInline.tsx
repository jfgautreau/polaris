"use client";

import { useRef, useState } from "react";
import {
  BALISES_NOM_FICHIER,
  NOM_FICHIER_INTERIM_DEFAUT,
  NOM_FICHIER_INTERIM_MAX,
  nomFichierInterim,
} from "@/lib/nom-fichier-interim";

// Réglage « Nom du fichier Excel intérim » (Param. RH, 0093), enregistré
// automatiquement 500 ms après la dernière frappe. Un clic sur une balise
// l'ajoute à la fin. Aperçu avec des valeurs d'exemple.
export default function NomFichierInterimInline({ initial, site }: { initial: string | null; site: string }) {
  const [valeur, setValeur] = useState(initial ?? "");
  const [enregistre, setEnregistre] = useState(initial ?? "");
  const [etat, setEtat] = useState<"idle" | "saving" | "saved">("idle");
  const [erreur, setErreur] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function planifier(v: string) {
    setValeur(v);
    setErreur(null);
    if (timer.current) clearTimeout(timer.current);
    setEtat("saving");
    timer.current = setTimeout(async () => {
      const res = await fetch("/api/parametre-rh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interim_nom_fichier: v }),
      }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        // Refus : on revient à la valeur enregistrée et on dit pourquoi.
        setErreur(j?.error ?? "Enregistrement impossible.");
        setValeur(enregistre);
        setEtat("idle");
        return;
      }
      setEnregistre(v);
      setEtat("saved");
      setTimeout(() => setEtat("idle"), 1500);
    }, 500);
  }

  const apercu = nomFichierInterim(valeur, {
    agence: "Adecco",
    semaine: 46,
    annee: 2026,
    site,
    maintenant: new Date(2026, 10, 9, 14, 5),
  });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Forme du nom</span>
        <input
          id="interim-nom-fichier"
          value={valeur}
          maxLength={NOM_FICHIER_INTERIM_MAX}
          placeholder={NOM_FICHIER_INTERIM_DEFAUT}
          onChange={(e) => planifier(e.target.value)}
          style={{ width: "100%", maxWidth: 640 }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span className="muted">Balises :</span>
        {BALISES_NOM_FICHIER.map((b) => (
          <button
            key={b}
            type="button"
            className="btn-sm btn-ghost"
            onClick={() => planifier(`${valeur}${valeur && !valeur.endsWith(" ") ? " " : ""}${b}`)}
            title={`Ajouter ${b} à la fin`}
            style={{ width: "auto", margin: 0, color: "#1d4ed8", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          >
            {b}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13 }}>
        <span className="muted">Exemple : </span>
        <strong style={{ wordBreak: "break-all" }}>{apercu}</strong>
        <span className="muted" style={{ marginLeft: 8 }}>
          {etat === "saving" ? "Enregistrement…" : etat === "saved" ? "Enregistré" : ""}
        </span>
      </div>
      {erreur && (
        <div role="alert" style={{ color: "#991b1b", fontSize: 13, fontWeight: 600 }}>
          {erreur}
        </div>
      )}
    </div>
  );
}
