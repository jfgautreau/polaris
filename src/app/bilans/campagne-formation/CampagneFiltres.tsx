"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Filtres propres au bilan « Campagne de formation », portés par l'URL (le serveur
// les lit) : formation, date de la session, intérimaires inclus ou non.
export default function CampagneFiltres({
  formation,
  session,
  interim,
  formations,
}: {
  formation: string;
  session: string;
  interim: boolean;
  formations: { id: string; nom: string; groupe: string | null }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();
  const [enCours, demarrer] = useTransition();

  function go(patch: Record<string, string>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    demarrer(() => router.push(qs ? `${path}?${qs}` : path));
  }

  // Formations regroupées par famille (`competence.groupe`) dans le menu.
  const groupes: { nom: string; items: typeof formations }[] = [];
  for (const f of formations) {
    const nom = f.groupe ?? "Autres";
    const g = groupes.find((x) => x.nom === nom);
    if (g) g.items.push(f);
    else groupes.push({ nom, items: [f] });
  }

  const ligne: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" };
  return (
    <div className="noprint" style={{ opacity: enCours ? 0.6 : 1, transition: "opacity .15s" }}>
      <div style={ligne}>
        <span className="muted" style={{ fontWeight: 600 }}>Formation :</span>
        <select
          value={formation}
          onChange={(e) => go({ formation: e.target.value })}
          style={{ width: "auto", minWidth: 280, margin: 0 }}
        >
          <option value="">— Choisir une formation —</option>
          {groupes.map((g) => (
            <optgroup key={g.nom} label={g.nom}>
              {g.items.map((f) => (
                <option key={f.id} value={f.id}>{f.nom}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="muted" style={{ fontWeight: 600, marginLeft: 12 }}>Date de la session :</span>
        <input
          type="date"
          defaultValue={session}
          key={session}
          onBlur={(e) => e.target.value && e.target.value !== session && go({ session: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          style={{ width: "auto", margin: 0 }}
          title="L'état de chaque habilitation est jugé à cette date"
        />
        <span className="muted" style={{ fontWeight: 600, marginLeft: 12 }}>Intérimaires :</span>
        <div className="segments">
          <button type="button" className={interim ? "seg active" : "seg"} onClick={() => go({ interim: "oui" })}>Oui</button>
          <button type="button" className={!interim ? "seg active" : "seg"} onClick={() => go({ interim: "" })}>Non</button>
        </div>
      </div>
    </div>
  );
}
