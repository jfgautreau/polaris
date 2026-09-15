"use client";

import { useEffect, useRef, useState } from "react";

type Periode = {
  id: string;
  personne_id: string;
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  motif: string | null;
  motif_fin: string | null;
  commentaire: string | null;
};

type TypeContrat = { code: string; libelle: string; avec_agence?: boolean };
const CONTRATS_FALLBACK: TypeContrat[] = [
  { code: "CDI", libelle: "CDI" },
  { code: "CDD", libelle: "CDD" },
  { code: "INTERIM", libelle: "Intérim", avec_agence: true },
];

// Reflet recalcule par l'API sur `personne` apres chaque changement de periode.
// Il alimente les colonnes Contrat / Fin de contrat et l'alerte des 18 mois de la
// liste : sans lui, l'ecran principal resterait sur les anciennes valeurs.
export type RefletContrat = {
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  contrat_debut: string | null;
};

export default function PeriodesEditor({
  personneId,
  bare = false,
  onSync,
}: {
  personneId: string;
  bare?: boolean;
  onSync?: (reflet: RefletContrat) => void;
}) {
  const [rows, setRows] = useState<Periode[]>([]);
  // Agences parametrees dans Param. RH. Vide = migration 0034 non appliquee :
  // on retombe alors sur la saisie libre (cf. le rendu de la colonne Agence).
  const [agences, setAgences] = useState<string[]>([]);
  const [types, setTypes] = useState<TypeContrat[]>(CONTRATS_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function post(op: string, payload: Record<string, unknown>) {
    setSave("saving");
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...payload }),
      });
      if (!res.ok) throw new Error();
      setSave("saved");
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        row?: Periode;
        rows?: Periode[];
        personne?: RefletContrat | null;
      };
      // Remonte le reflet des que l'API l'a recalcule : la liste derriere la
      // modale se met a jour sans qu'on ait a la recharger.
      if (j.personne) onSync?.(j.personne);
      return j;
    } catch {
      setSave("error");
      return null;
    } finally {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSave("idle"), 1500);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const call = (payload: Record<string, unknown>) =>
      fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json().catch(() => ({})));
    (async () => {
      const [periodes, ag, tp] = await Promise.all([
        call({ op: "periode-list", personne_id: personneId }) as Promise<{ rows?: Periode[] }>,
        call({ op: "agences" }) as Promise<{ agences?: string[] }>,
        call({ op: "types-contrat" }) as Promise<{ types?: TypeContrat[] }>,
      ]);
      if (!cancelled) {
        setRows(periodes.rows ?? []);
        setAgences(ag.agences ?? []);
        if (tp.types?.length) setTypes(tp.types);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personneId]);

  // Codes de contrat pilotés par agence (drapeau avec_agence, 0072) : le champ
  // Agence n'est activé que pour eux. Généralise l'ancien test « === INTERIM ».
  // INTERIM reste toujours inclus (défensif).
  const agenceSet = new Set<string>(types.filter((t) => t.avec_agence).map((t) => t.code).concat("INTERIM"));

  function patchLocal(id: string, p: Partial<Periode>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function edit(id: string, key: keyof Periode, value: string, instant = false) {
    patchLocal(id, { [key]: value } as Partial<Periode>);
    const k = `${id}:${key}`;
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(
      () => post("periode-update", { id, personne_id: personneId, patch: { [key]: value } }),
      instant ? 0 : 500
    );
  }

  async function add() {
    const j = await post("periode-create", { personne_id: personneId, type_contrat: "INTERIM" });
    // En tete de liste : le bouton est au-dessus du tableau, la ligne creee doit
    // apparaitre juste en dessous, sous les yeux. Le tri du serveur place lui aussi
    // les periodes sans date de debut en premier (cf. op periode-list).
    if (j?.row) setRows((rs) => [j.row as Periode, ...rs]);
  }

  async function remove(id: string) {
    if (!window.confirm("Supprimer cette période de contrat ?")) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    await post("periode-delete", { id, personne_id: personneId });
  }

  const th: React.CSSProperties = { textAlign: "left", padding: "4px 8px", fontSize: 12, color: "var(--muted)" };
  const inp: React.CSSProperties = { width: "100%", fontSize: 13, padding: "4px 6px" };

  return (
    <div className={bare ? undefined : "card"} style={bare ? undefined : { marginTop: 24 }}>
      <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
        {bare ? <span /> : <h2 style={{ margin: 0 }}>Contrats / périodes</h2>}
        <span style={{ fontSize: 12, fontWeight: 600, color: save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)" }}>
          {save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? "Échec" : ""}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Historique complet des contrats. La <strong>fin du contrat le plus récent</strong> est ce qui s&apos;affiche dans la liste Personnel.
      </p>

      {/* Au-dessus du tableau : la ligne creee apparait juste en dessous du bouton,
          sans avoir a chercher le bas d'un historique qui peut etre long. */}
      <button type="button" onClick={add} style={{ width: "auto", margin: "0 0 10px", padding: "8px 16px" }}>
        + Ajouter une période
      </button>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 130 }}>Type</th>
              <th style={{ ...th, width: 200 }}>Agence (si intérim)</th>
              <th style={{ ...th, width: 140 }}>Début</th>
              <th style={{ ...th, width: 140 }}>Fin</th>
              <th style={{ ...th, width: 170 }}>Motif début</th>
              <th style={{ ...th, width: 200 }}>Motif fin</th>
              <th style={th}>Commentaire</th>
              <th style={{ ...th, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <select value={r.type_contrat} onChange={(e) => edit(r.id, "type_contrat", e.target.value, true)} style={inp}>
                    {types.map((c) => (
                      <option key={c.code} value={c.code}>{c.libelle}</option>
                    ))}
                    {/* Code historique absent de la liste : on le garde en option
                        pour ne pas l'effacer a l'ouverture. */}
                    {r.type_contrat && !types.some((c) => c.code === r.type_contrat) && (
                      <option value={r.type_contrat}>{r.type_contrat} (hors liste)</option>
                    )}
                  </select>
                </td>
                <td>
                  {agences.length === 0 ? (
                    // Aucune agence parametree (ou migration 0034 non appliquee) :
                    // saisie libre, comme avant, plutot qu'un menu vide inutilisable.
                    <input
                      value={r.agence_interim ?? ""}
                      disabled={!agenceSet.has(r.type_contrat)}
                      onChange={(e) => edit(r.id, "agence_interim", e.target.value)}
                      style={{ ...inp, opacity: agenceSet.has(r.type_contrat) ? 1 : 0.5 }}
                    />
                  ) : (
                    <select
                      value={r.agence_interim ?? ""}
                      disabled={!agenceSet.has(r.type_contrat)}
                      onChange={(e) => edit(r.id, "agence_interim", e.target.value, true)}
                      style={{ ...inp, opacity: agenceSet.has(r.type_contrat) ? 1 : 0.5 }}
                    >
                      <option value="">—</option>
                      {agences.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                      {/* Valeur historique saisie en texte libre, absente de la liste :
                          on la garde en option pour ne pas l'effacer a l'ouverture. */}
                      {r.agence_interim && !agences.includes(r.agence_interim) && (
                        <option value={r.agence_interim}>{r.agence_interim} (hors liste)</option>
                      )}
                    </select>
                  )}
                </td>
                <td><input type="date" min="1900-01-01" max="2200-12-31" value={r.date_debut ?? ""} onChange={(e) => edit(r.id, "date_debut", e.target.value, true)} style={inp} /></td>
                <td><input type="date" min="1900-01-01" max="2200-12-31" value={r.date_fin ?? ""} onChange={(e) => edit(r.id, "date_fin", e.target.value, true)} style={inp} /></td>
                <td><input value={r.motif ?? ""} onChange={(e) => edit(r.id, "motif", e.target.value)} placeholder="ex. remplacement, surcroît…" style={inp} /></td>
                <td><input value={r.motif_fin ?? ""} onChange={(e) => edit(r.id, "motif_fin", e.target.value)} placeholder="ex. retraite, démission, fin de mission" style={inp} title="Motif de fin de ce contrat. Le motif_fin du dernier contrat vaut motif de départ de la personne." /></td>
                <td><input value={r.commentaire ?? ""} onChange={(e) => edit(r.id, "commentaire", e.target.value)} style={inp} /></td>
                <td style={{ textAlign: "center" }}>
                  <button type="button" className="btn-sm btn-ghost" onClick={() => remove(r.id)} title="Supprimer cette période" style={{ color: "var(--danger)" }}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">Aucune période. Ajoutez-en une.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
