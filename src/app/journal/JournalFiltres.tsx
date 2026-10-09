"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

// Filtres du Journal, portés par l'URL (lien partageable, retour arrière
// fidèle). Tout changement repart en page 1 ; la recherche est débouncée.
export type FiltresJournal = {
  du: string;
  au: string;
  auteur: string;
  element: string;
  action: string;
  q: string;
  tout: boolean;
};

export default function JournalFiltres({
  filtres,
  auteurs,
  elements,
}: {
  filtres: FiltresJournal;
  auteurs: { id: string; nom: string }[];
  elements: { code: string; libelle: string }[];
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [q, setQ] = useState(filtres.q);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aller(patch: Partial<FiltresJournal>) {
    const f = { ...filtres, q, ...patch };
    const p = new URLSearchParams();
    if (f.du) p.set("du", f.du);
    if (f.au) p.set("au", f.au);
    if (f.auteur) p.set("auteur", f.auteur);
    if (f.element) p.set("element", f.element);
    if (f.action) p.set("action", f.action);
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.tout) p.set("tout", "1");
    const qs = p.toString();
    demarrer(() => router.push(qs ? `/journal?${qs}` : "/journal"));
  }

  const champ: React.CSSProperties = { fontSize: 13, padding: "4px 6px", width: "auto" };
  const etiquette: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 13 };
  const actifs = !!(filtres.du || filtres.au || filtres.auteur || filtres.element || filtres.action || filtres.q || filtres.tout);

  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", alignItems: "center", marginBottom: 12, opacity: enCours ? 0.6 : 1 }}>
      <input
        type="search"
        value={q}
        placeholder="Personne, poste, habilitation…"
        aria-label="Rechercher un élément"
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          if (minuterie.current) clearTimeout(minuterie.current);
          minuterie.current = setTimeout(() => aller({ q: v }), 400);
        }}
        style={{ ...champ, width: 230 }}
      />
      <label style={etiquette}>
        Du
        <input type="date" value={filtres.du} onChange={(e) => aller({ du: e.target.value })} style={champ} />
      </label>
      <label style={etiquette}>
        au
        <input type="date" value={filtres.au} onChange={(e) => aller({ au: e.target.value })} style={champ} />
      </label>
      <label style={etiquette}>
        Auteur
        <select value={filtres.auteur} onChange={(e) => aller({ auteur: e.target.value })} style={champ}>
          <option value="">Tous</option>
          <option value="systeme">Système</option>
          {auteurs.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nom}
            </option>
          ))}
        </select>
      </label>
      <label style={etiquette}>
        Élément
        <select value={filtres.element} onChange={(e) => aller({ element: e.target.value })} style={champ}>
          <option value="">Tous</option>
          {elements.map((t) => (
            <option key={t.code} value={t.code}>
              {t.libelle}
            </option>
          ))}
        </select>
      </label>
      <label style={etiquette}>
        Action
        <select value={filtres.action} onChange={(e) => aller({ action: e.target.value })} style={champ}>
          <option value="">Toutes</option>
          <option value="INSERT">Création</option>
          <option value="UPDATE">Modification</option>
          <option value="DELETE">Suppression</option>
          <option value="LOT">Opération groupée</option>
        </select>
      </label>
      <label style={{ ...etiquette, cursor: "pointer" }} title="Le Planning et la Polyvalence font l'essentiel du volume : masqués par défaut, sauf leurs opérations groupées.">
        <input type="checkbox" checked={filtres.tout} onChange={(e) => aller({ tout: e.target.checked })} style={{ width: "auto", margin: 0 }} />
        Inclure le Planning et la Polyvalence
      </label>
      {actifs && (
        <button
          type="button"
          className="btn-sm btn-ghost"
          style={{ margin: 0, width: "auto", color: "var(--text)" }}
          onClick={() => {
            setQ("");
            demarrer(() => router.push("/journal"));
          }}
        >
          Effacer les filtres
        </button>
      )}
    </div>
  );
}
