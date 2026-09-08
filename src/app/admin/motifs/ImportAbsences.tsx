"use client";

import { useRef, useState } from "react";

// Import des absences depuis le CSV du logiciel RH (GT). Trois temps :
//  1. dépôt du fichier + « Analyser » -> aperçu (appariement par nom, motifs à
//     créer, fenêtre couverte) ;
//  2. résolution des noms douteux (menu déroulant par personne) ;
//  3. « Importer » -> écriture (remplace les jours d'absence sur la fenêtre).
// L'aperçu ne touche rien ; seul « Importer » écrit.

type Candidat = { personneId: string; libelle: string; score: number };
type Resultat = {
  matriculeRh: string;
  nomComplet: string;
  section: string;
  nbJours: number;
  statut: "appris" | "auto" | "ambigu" | "inconnu";
  personneId: string | null;
  ignorer: boolean;
  candidats: Candidat[];
};
type Apercu = {
  fenetre: { min: string | null; max: string | null };
  personnes: Resultat[];
  motifsACreer: { codeGt: string; libelle: string }[];
  effectif: { id: string; libelle: string }[];
};
type Resume = {
  personnesImportees: number;
  joursImportes: number;
  motifsCrees: number;
  ignores: number;
  nonResolus: number;
  jamaisMappes: number;
  fenetre: { min: string | null; max: string | null };
};

const IGNORE = "__IGNORE__";
const CHOISIR = "__CHOISIR__";

const BADGE: Record<Resultat["statut"], { texte: string; bg: string; fg: string }> = {
  appris: { texte: "Appris", bg: "#dbeafe", fg: "#1e40af" },
  auto: { texte: "Auto", bg: "#dcfce7", fg: "#166534" },
  ambigu: { texte: "À vérifier", bg: "#fef3c7", fg: "#92400e" },
  inconnu: { texte: "Non trouvé", bg: "#fee2e2", fg: "#991b1b" },
};

function frDate(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
}

export default function ImportAbsences() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [choix, setChoix] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);

  function reset() {
    setApercu(null);
    setChoix({});
    setResume(null);
    setErreur(null);
  }

  function valeurDefaut(r: Resultat): string {
    if (r.statut === "appris" && r.ignorer) return IGNORE;
    if (r.personneId) return r.personneId;
    return CHOISIR;
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
      const res = await fetch("/api/import-absences", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Analyse impossible.");
      const ap = data as Apercu;
      setApercu(ap);
      const init: Record<string, string> = {};
      for (const r of ap.personnes) init[r.matriculeRh] = valeurDefaut(r);
      setChoix(init);
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
      // Traduction des sentinelles vers le format serveur : '' = ignorer, une
      // ligne non choisie est OMISE (le serveur reprend alors son défaut =
      // non résolue, non importée).
      const resolutions: Record<string, string> = {};
      for (const [mat, v] of Object.entries(choix)) {
        if (v === CHOISIR) continue;
        resolutions[mat] = v === IGNORE ? "" : v;
      }
      const fd = new FormData();
      fd.set("op", "apply");
      fd.set("fichier", fichier);
      fd.set("resolutions", JSON.stringify(resolutions));
      const res = await fetch("/api/import-absences", { method: "POST", body: fd });
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

  const nbAVerifier = apercu?.personnes.filter(
    (r) => (choix[r.matriculeRh] ?? CHOISIR) === CHOISIR,
  ).length ?? 0;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
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

      {erreur && (
        <p style={{ color: "var(--danger)", marginTop: 12 }}>⚠️ {erreur}</p>
      )}

      {resume && (
        <div style={{ marginTop: 14, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 12 }}>
          <strong>Import terminé.</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>{resume.personnesImportees} personne(s), {resume.joursImportes} jour(s) d&apos;absence sur {frDate(resume.fenetre.min)} → {frDate(resume.fenetre.max)}</li>
            {resume.motifsCrees > 0 && <li>{resume.motifsCrees} motif(s) créé(s) depuis les codes GT</li>}
            {resume.ignores > 0 && <li>{resume.ignores} matricule(s) ignoré(s)</li>}
            {resume.nonResolus > 0 && <li style={{ color: "#92400e" }}>{resume.nonResolus} personne(s) non résolue(s) — relancez l&apos;analyse pour les rattacher</li>}
          </ul>
        </div>
      )}

      {apercu && (
        <div style={{ marginTop: 14 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Fenêtre couverte : <strong>{frDate(apercu.fenetre.min)} → {frDate(apercu.fenetre.max)}</strong>.
            Les jours d&apos;absence existants de ces personnes sur cette fenêtre seront <strong>remplacés</strong> par le fichier.
          </p>

          {apercu.motifsACreer.length > 0 && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
              <strong>Motifs à créer</strong> (codes GT non encore rattachés) :{" "}
              {apercu.motifsACreer.map((m) => `${m.codeGt} — ${m.libelle}`).join(" · ")}
            </div>
          )}

          {nbAVerifier > 0 && (
            <p style={{ color: "#92400e", marginTop: 0 }}>
              {nbAVerifier} personne(s) restent « À choisir » : sélectionnez la personne Polaris ou « Ignorer ».
            </p>
          )}

          <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Nom (fichier RH)</th>
                  <th style={{ width: 90, textAlign: "center" }}>Jours</th>
                  <th style={{ width: 100 }}>Statut</th>
                  <th style={{ minWidth: 260 }}>Personne Polaris</th>
                </tr>
              </thead>
              <tbody>
                {apercu.personnes.map((r) => {
                  const b = BADGE[r.statut];
                  const val = choix[r.matriculeRh] ?? CHOISIR;
                  return (
                    <tr key={r.matriculeRh} style={{ background: val === CHOISIR ? "#fffbeb" : undefined }}>
                      <td>
                        {r.nomComplet}
                        {r.section && <span className="muted" style={{ fontSize: 12 }}> · {r.section}</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>{r.nbJours}</td>
                      <td>
                        <span style={{ background: b.bg, color: b.fg, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
                          {b.texte}
                        </span>
                      </td>
                      <td>
                        <select
                          value={val}
                          onChange={(e) => setChoix((c) => ({ ...c, [r.matriculeRh]: e.target.value }))}
                          style={{ width: "100%" }}
                        >
                          <option value={CHOISIR}>— À choisir —</option>
                          <option value={IGNORE}>Ignorer cette personne</option>
                          {/* Candidats suggérés d'abord, puis tout l'effectif. */}
                          {r.candidats.length > 0 && (
                            <optgroup label="Suggestions">
                              {r.candidats.map((c) => (
                                <option key={`c-${c.personneId}`} value={c.personneId}>{c.libelle}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Tout l'effectif">
                            {apercu.effectif.map((p) => (
                              <option key={p.id} value={p.id}>{p.libelle}</option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn-sm" disabled={busy} onClick={importer}>
              {busy ? "Import…" : "Importer les absences"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
