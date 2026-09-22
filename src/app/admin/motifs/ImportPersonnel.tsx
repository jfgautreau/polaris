"use client";

import { useMemo, useRef, useState } from "react";

// Import de la « Base personnel » depuis un fichier Excel (export RH). Trois temps :
//  1. dépôt du fichier + « Analyser » -> aperçu (rapprochement avec l'effectif) ;
//  2. correspondance de chaque SECTION -> (Service, Équipe) Polaris, pré-suggérée ;
//     confirmation ligne par ligne pour les noms DOUTEUX (homonymes) ;
//  3. « Importer » -> création des personnes retenues + leur contrat initial.
// L'aperçu ne touche rien ; seul « Importer » écrit. Import ADDITIF : une
// personne existante n'est jamais modifiée. La FONCTION du fichier est ignorée.

type Ref = { id: string; nom: string };
type Candidat = { id: string; libelle: string };
type Statut = "existant" | "doute" | "nouveau";
type Personne = {
  cle: string;
  matricule: string;
  nom: string;
  prenom: string;
  sexe: "H" | "F" | null;
  typeSource: string;
  typeResolu: string;
  dateDebut: string | null;
  dateFin: string | null;
  section: string;
  statut: Statut;
  candidats: Candidat[];
};
type SectionApercu = { raw: string; atelierId: string | null; equipeId: string | null; effectif: number };
type Apercu = {
  personnes: Personne[];
  sections: SectionApercu[];
  ateliers: Ref[];
  equipes: Ref[];
  resume: { total: number; nouveaux: number; doutes: number; existants: number };
};
type Resume = { crees: number; existants: number; rapproches: number; exclus: number };

const AUCUN = "__AUCUN__";

function frDate(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

export default function ImportPersonnel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [corr, setCorr] = useState<Record<string, { atelierId: string; equipeId: string }>>({});
  // Décision par ligne : true = créer, false = ne pas créer (rapprocher/exclure).
  const [creer, setCreer] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);

  function reset() {
    setApercu(null);
    setCorr({});
    setCreer({});
    setResume(null);
    setErreur(null);
  }

  async function analyser() {
    if (!fichier) return;
    setBusy(true);
    setErreur(null);
    setResume(null);
    try {
      const fd = new FormData();
      fd.set("op", "preview");
      fd.set("fichier", fichier);
      const res = await fetch("/api/import-personnel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Analyse impossible.");
      const ap = data as Apercu;
      setApercu(ap);
      const c: Record<string, { atelierId: string; equipeId: string }> = {};
      for (const s of ap.sections) c[s.raw] = { atelierId: s.atelierId ?? "", equipeId: s.equipeId ?? "" };
      setCorr(c);
      // Par défaut : les « nouveau » sont créés ; les « doute » NON (à confirmer) ;
      // les « existant » jamais.
      const d: Record<string, boolean> = {};
      for (const p of ap.personnes) d[p.cle] = p.statut === "nouveau";
      setCreer(d);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  }

  async function importer() {
    if (!fichier || !apercu) return;
    setBusy(true);
    setErreur(null);
    try {
      const correspondances: Record<string, { atelierId: string | null; equipeId: string | null }> = {};
      for (const [raw, v] of Object.entries(corr)) {
        correspondances[raw] = { atelierId: v.atelierId || null, equipeId: v.equipeId || null };
      }
      const aCreer = apercu.personnes.filter((p) => p.statut !== "existant" && creer[p.cle]).map((p) => p.cle);
      const fd = new FormData();
      fd.set("op", "apply");
      fd.set("fichier", fichier);
      fd.set("correspondances", JSON.stringify(correspondances));
      fd.set("aCreer", JSON.stringify(aCreer));
      const res = await fetch("/api/import-personnel", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Import impossible.");
      setResume(data.resume as Resume);
      setApercu(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  }

  const nbACreer = useMemo(
    () => (apercu ? apercu.personnes.filter((p) => p.statut !== "existant" && creer[p.cle]).length : 0),
    [apercu, creer],
  );
  const sectionsSansCorr = useMemo(() => {
    if (!apercu) return [];
    const actives = new Set(apercu.personnes.filter((p) => p.statut !== "existant" && creer[p.cle]).map((p) => p.section));
    return apercu.sections.filter((s) => actives.has(s.raw) && !(corr[s.raw]?.atelierId || corr[s.raw]?.equipeId));
  }, [apercu, creer, corr]);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFichier(e.target.files?.[0] ?? null);
            reset();
          }}
        />
        <button type="button" className="btn-sm" disabled={!fichier || busy} onClick={analyser}>
          {busy && !apercu ? "Analyse…" : "Analyser"}
        </button>
        {(apercu || resume) && (
          <button
            type="button"
            className="iconbtn ghost"
            title="Réinitialiser"
            onClick={() => {
              reset();
              setFichier(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            ✕
          </button>
        )}
      </div>

      {erreur && <p style={{ color: "var(--danger)", marginTop: 12 }}>⚠️ {erreur}</p>}

      {resume && (
        <div style={{ marginTop: 14, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 12 }}>
          <strong>Import terminé.</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>{resume.crees} personne(s) créée(s)</li>
            {resume.existants > 0 && <li>{resume.existants} déjà présente(s) par matricule, laissée(s) intacte(s)</li>}
            {resume.rapproches > 0 && <li>{resume.rapproches} homonyme(s) rapproché(s) (non recréé(s))</li>}
            {resume.exclus > 0 && <li>{resume.exclus} nouvelle(s) exclue(s) par vos soins</li>}
          </ul>
        </div>
      )}

      {apercu && (
        <div style={{ marginTop: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            <strong>{apercu.resume.total}</strong> ligne(s) : <strong>{apercu.resume.nouveaux}</strong> nouvelle(s),{" "}
            <strong>{apercu.resume.doutes}</strong> à confirmer (homonyme), <strong>{apercu.resume.existants}</strong>{" "}
            déjà présente(s) par matricule.
          </p>

          {/* ---- Correspondance des sections ---- */}
          <h3 style={{ margin: "10px 0 6px" }}>Correspondance des sections</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Chaque section du fichier est rattachée à un <strong>Service</strong> et une{" "}
            <strong>Équipe</strong> Polaris (pré-suggérés). Laissez « — Aucun — » pour ne pas rattacher.
          </p>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 14 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Section (fichier)</th>
                  <th style={{ width: 70, textAlign: "center" }}>Pers.</th>
                  <th style={{ minWidth: 200 }}>Service</th>
                  <th style={{ minWidth: 200 }}>Équipe</th>
                </tr>
              </thead>
              <tbody>
                {apercu.sections.map((s) => (
                  <tr key={s.raw}>
                    <td>{s.raw}</td>
                    <td style={{ textAlign: "center" }}>{s.effectif}</td>
                    <td>
                      <select
                        value={corr[s.raw]?.atelierId || AUCUN}
                        onChange={(e) =>
                          setCorr((c) => ({
                            ...c,
                            [s.raw]: { atelierId: e.target.value === AUCUN ? "" : e.target.value, equipeId: c[s.raw]?.equipeId ?? "" },
                          }))
                        }
                        style={{ width: "100%" }}
                      >
                        <option value={AUCUN}>— Aucun —</option>
                        {apercu.ateliers.map((a) => (
                          <option key={a.id} value={a.id}>{a.nom}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={corr[s.raw]?.equipeId || AUCUN}
                        onChange={(e) =>
                          setCorr((c) => ({
                            ...c,
                            [s.raw]: { atelierId: c[s.raw]?.atelierId ?? "", equipeId: e.target.value === AUCUN ? "" : e.target.value },
                          }))
                        }
                        style={{ width: "100%" }}
                      >
                        <option value={AUCUN}>— Aucun —</option>
                        {apercu.equipes.map((eq) => (
                          <option key={eq.id} value={eq.id}>{eq.nom}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sectionsSansCorr.length > 0 && (
            <p style={{ color: "#92400e", marginTop: 0 }}>
              {sectionsSansCorr.length} section(s) avec des personnes à créer n&apos;ont ni service ni équipe : ces
              personnes seront créées sans rattachement (modifiable ensuite dans Personnel).
            </p>
          )}

          {/* ---- Personnes ---- */}
          <h3 style={{ margin: "10px 0 6px" }}>Personnes ({nbACreer} à créer)</h3>
          {apercu.resume.doutes > 0 && (
            <p className="muted" style={{ marginTop: 0 }}>
              Les lignes <strong style={{ color: "#92400e" }}>À confirmer</strong> ont un homonyme dans l&apos;effectif.
              Choisissez <em>Rapprocher</em> (même personne, ne pas créer) ou <em>Créer</em> (nouvelle personne).
            </p>
          )}
          <div style={{ maxHeight: 380, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Nom Prénom</th>
                  <th style={{ width: 80 }}>Matricule</th>
                  <th style={{ width: 40, textAlign: "center" }}>Sexe</th>
                  <th style={{ width: 90 }}>Contrat</th>
                  <th style={{ width: 80 }}>Début</th>
                  <th style={{ textAlign: "left" }}>Section</th>
                  <th style={{ minWidth: 220 }}>Décision</th>
                </tr>
              </thead>
              <tbody>
                {apercu.personnes.map((p) => {
                  const doute = p.statut === "doute";
                  const existant = p.statut === "existant";
                  const bg = existant ? "#f9fafb" : doute && !creer[p.cle] ? "#fffbeb" : undefined;
                  return (
                    <tr key={p.cle} style={{ opacity: existant ? 0.55 : 1, background: bg }}>
                      <td><strong>{p.nom}</strong> {p.prenom}</td>
                      <td>{p.matricule || <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "center" }}>{p.sexe ?? "—"}</td>
                      <td>
                        {p.typeResolu}
                        {p.typeSource && p.typeSource.toUpperCase() !== p.typeResolu && (
                          <span className="muted" style={{ fontSize: 12 }}> ({p.typeSource})</span>
                        )}
                      </td>
                      <td>{frDate(p.dateDebut)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{p.section}</td>
                      <td>
                        {existant ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            Déjà présent : {p.candidats[0]?.libelle ?? "matricule connu"}
                          </span>
                        ) : doute ? (
                          <div>
                            <select
                              value={creer[p.cle] ? "creer" : "rapprocher"}
                              onChange={(e) => setCreer((c) => ({ ...c, [p.cle]: e.target.value === "creer" }))}
                              style={{ width: "100%" }}
                            >
                              <option value="rapprocher">Rapprocher (ne pas créer)</option>
                              <option value="creer">Créer une nouvelle personne</option>
                            </select>
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                              Homonyme : {p.candidats.map((c) => c.libelle).join(" · ")}
                            </div>
                          </div>
                        ) : (
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={!!creer[p.cle]}
                              onChange={(e) => setCreer((c) => ({ ...c, [p.cle]: e.target.checked }))}
                            />
                            <span style={{ background: "#dcfce7", color: "#166534", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                              Nouvelle
                            </span>
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn-sm" disabled={busy || nbACreer === 0} onClick={importer}>
              {busy ? "Import…" : `Importer ${nbACreer} personne(s)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
