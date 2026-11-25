"use client";

import { useState } from "react";
import Link from "next/link";
import { TrashIcon } from "@/components/icons";
import {
  MOIS_COURTS,
  MOTIFS_DEPART,
  PALIERS,
  coefEtp,
  joursRetenus,
  saturationLigne,
  semainesSubies,
  type Hypotheses,
  type LigneCapa,
} from "@/lib/gpec";
import type { DepartAffiche } from "@/lib/gpec-data";

type Reponse = { ok: boolean; error?: string; id?: string };

// Appel de la route : ne lève jamais, rend toujours { ok, error }.
async function envoyer(corps: Record<string, unknown>): Promise<Reponse> {
  const res = await fetch("/api/gpec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }).catch(() => null);
  if (!res) return { ok: false, error: "Réseau indisponible : la valeur n'est pas enregistrée." };
  const j = (await res.json().catch(() => null)) as Reponse | null;
  if (!res.ok || !j) return { ok: false, error: j?.error ?? "Enregistrement refusé." };
  return { ...j, ok: true };
}

const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const lire = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
const fmtDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const COULEUR_PALIER: Record<number, string> = { 1: "#e0f2fe", 2: "#dcfce7", 3: "#fef3c7", 4: "#fee2e2" };

const champ: React.CSSProperties = { width: 110, textAlign: "right" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 600, padding: "4px 8px" };
const td: React.CSSProperties = { padding: "4px 8px", verticalAlign: "middle" };

// Case numérique enregistrée en quittant le champ. Refus → retour à la valeur enregistrée.
function CaseNombre({ valeur, onValide, style, placeholder, title }: { valeur: number | null; onValide: (n: number | null) => Promise<boolean>; style?: React.CSSProperties; placeholder?: string; title?: string }) {
  const [saisie, setSaisie] = useState(txt(valeur));
  const [enregistre, setEnregistre] = useState(valeur);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={saisie}
      placeholder={placeholder}
      title={title}
      style={{ ...champ, ...style }}
      onChange={(e) => setSaisie(e.target.value)}
      onBlur={async () => {
        const n = lire(saisie);
        if (Number.isNaN(n)) { setSaisie(txt(enregistre)); return; }
        if (n === enregistre) { setSaisie(txt(enregistre)); return; }
        if (await onValide(n)) { setEnregistre(n); setSaisie(txt(n)); }
        else setSaisie(txt(enregistre));
      }}
    />
  );
}

type SubiProp = { atelierId: string; nom: string; effectif: number };

export default function GpecEditor(props: {
  annee: number;
  hyp: Hypotheses;
  capas: LigneCapa[];
  quarts: { code: string; libelle: string }[];
  subi: SubiProp[];
  joursSubisParMotif: Record<string, Record<string, number>>;
  motifs: { id: string; libelle: string }[];
  lignesRef: { id: string; nom: string; atelierNom: string }[];
  postesRef: { id: string; nom: string; ligne: string }[];
  personnesRef: { id: string; nom: string; poste: string }[];
  departs: DepartAffiche[];
}) {
  const { annee, quarts } = props;
  const [hyp, setHyp] = useState(props.hyp);
  const [capas, setCapas] = useState(props.capas);
  const [departs, setDeparts] = useState(props.departs);
  const [erreur, setErreur] = useState("");
  const [nouveauNom, setNouveauNom] = useState("");
  const [mensuel, setMensuel] = useState<Record<string, boolean>>(() => Object.fromEntries(props.capas.map((c) => [c.id, !!c.volumesMois])));
  // Formulaire d'ajout d'un départ
  const [dType, setDType] = useState<"personne" | "poste">("personne");
  const [dCible, setDCible] = useState("");
  const [dDate, setDDate] = useState("");
  const [dMotif, setDMotif] = useState(MOTIFS_DEPART[0]);
  const [dComm, setDComm] = useState("");

  const ecrire = async (corps: Record<string, unknown>): Promise<Reponse> => {
    const r = await envoyer(corps);
    setErreur(r.ok ? "" : r.error ?? "Enregistrement refusé.");
    return r;
  };

  // ---- Réglages simples ----
  const regler = (cle: keyof Hypotheses, champApi: string, facteur = 1) => async (n: number | null) => {
    if (n === null) { setErreur("Cette valeur est obligatoire."); return false; }
    const r = await ecrire({ op: "hyp.set", annee, champ: champApi, valeur: n / facteur });
    if (r.ok) setHyp((h) => ({ ...h, [cle]: n / facteur }));
    return r.ok;
  };

  // ---- Absentéisme subi ----
  const exclus = new Set(hyp.motifsExclus);
  const semProgramme = hyp.semConges + hyp.semModulation;
  const basculerMotif = async (id: string, exclu: boolean) => {
    const r = await ecrire({ op: "hyp.motif", annee, motif_id: id, exclu });
    if (r.ok) setHyp((h) => ({ ...h, motifsExclus: exclu ? [...h.motifsExclus, id] : h.motifsExclus.filter((m) => m !== id) }));
  };
  const forcerSubi = (atelierId: string) => async (n: number | null) => {
    const r = await ecrire({ op: "hyp.subi", annee, atelier_id: atelierId, valeur: n });
    if (r.ok) setHyp((h) => {
      const subiForce = { ...h.subiForce };
      if (n === null) delete subiForce[atelierId];
      else subiForce[atelierId] = n;
      return { ...h, subiForce };
    });
    return r.ok;
  };

  // ---- Lignes capacitaires ----
  const majCapa = async (id: string, patchApi: Record<string, unknown>, patchLocal: Partial<LigneCapa>) => {
    const r = await ecrire({ op: "capa.update", id, ...patchApi });
    if (r.ok) setCapas((cs) => cs.map((c) => (c.id === id ? { ...c, ...patchLocal } : c)));
    return r.ok;
  };
  const creerCapa = async () => {
    const nom = nouveauNom.trim();
    if (!nom) return;
    const r = await ecrire({ op: "capa.create", annee, nom });
    if (r.ok && r.id) {
      setCapas((cs) => [...cs, { id: r.id!, nom, capaciteJour: null, volumeAnnuel: null, volumesMois: null, lignes: [], paliers: {} }]);
      setNouveauNom("");
    }
  };
  const supprimerCapa = async (c: LigneCapa) => {
    if (!window.confirm(`Supprimer la ligne capacitaire « ${c.nom} » et ses volumes ?`)) return;
    const r = await ecrire({ op: "capa.delete", id: c.id });
    if (r.ok) setCapas((cs) => cs.filter((x) => x.id !== c.id));
  };
  const priseAilleurs = (ligneId: string, capaId: string) => capas.find((c) => c.id !== capaId && c.lignes.includes(ligneId))?.nom ?? null;
  const basculerLigne = (c: LigneCapa, ligneId: string, coche: boolean) => {
    const lignes = coche ? [...c.lignes, ligneId] : c.lignes.filter((l) => l !== ligneId);
    void majCapa(c.id, { lignes }, { lignes });
  };
  const basculerQuart = (c: LigneCapa, palier: number, code: string, coche: boolean) => {
    const actuels = c.paliers[String(palier)] ?? quarts.map((q) => q.code);
    const liste = coche ? [...actuels, code] : actuels.filter((q) => q !== code);
    const paliers = { ...c.paliers, [String(palier)]: liste };
    void majCapa(c.id, { paliers }, { paliers });
  };
  const majMois = (c: LigneCapa, i: number) => async (n: number | null) => {
    const mois = Array.from({ length: 12 }, (_, k) => c.volumesMois?.[k] ?? null);
    mois[i] = n;
    const volumesMois = mois.every((v) => v === null) ? null : mois;
    return majCapa(c.id, { volumes_mois: mois }, { volumesMois });
  };

  // Revenir au volume annuel efface les mois saisis (sinon leur somme primerait
  // sur le volume annuel sans que rien ne le montre).
  const basculerMensuel = async (c: LigneCapa, coche: boolean) => {
    if (!coche && c.volumesMois) {
      if (!window.confirm("Revenir au volume annuel efface les volumes mensuels saisis. Continuer ?")) return;
      if (!(await majCapa(c.id, { volumes_mois: Array(12).fill(null) }, { volumesMois: null }))) return;
    }
    setMensuel((m) => ({ ...m, [c.id]: coche }));
  };

  // ---- Départs ----
  const ajouterDepart = async () => {
    if (!dCible) { setErreur(dType === "personne" ? "Choisir une personne." : "Choisir un poste."); return; }
    const r = await ecrire({ op: "depart.create", annee, [dType === "personne" ? "personne_id" : "poste_id"]: dCible, date_prevue: dDate, motif: dMotif, commentaire: dComm });
    if (!r.ok || !r.id) return;
    const pers = props.personnesRef.find((p) => p.id === dCible);
    const poste = props.postesRef.find((p) => p.id === dCible);
    const nouveau: DepartAffiche = dType === "personne"
      ? { id: r.id, personneId: dCible, nom: pers?.nom ?? "?", poste: pers?.poste ?? "—", service: "", date: dDate || null, motif: dMotif, commentaire: dComm, source: "saisi" }
      : { id: r.id, personneId: null, nom: "Départ sans nom", poste: poste?.nom ?? "—", service: "", date: dDate || null, motif: dMotif, commentaire: dComm, source: "saisi" };
    // Un départ saisi remplace la fin de contrat déjà listée pour la même personne.
    setDeparts((ds) => [...ds.filter((d) => !(nouveau.personneId && d.personneId === nouveau.personneId)), nouveau]);
    setDCible(""); setDDate(""); setDComm("");
  };
  const retirerDepart = async (d: DepartAffiche) => {
    if (!d.id) return;
    const r = await ecrire({ op: "depart.delete", id: d.id });
    if (r.ok) setDeparts((ds) => ds.filter((x) => x.id !== d.id));
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="muted" style={{ fontWeight: 600 }}>Année projetée :</span>
        <div className="segments">
          {[annee - 1, annee, annee + 1].map((a) => (
            <Link key={a} href={`/admin/gpec?annee=${a}`} className={a === annee ? "seg active" : "seg"} prefetch={false}>{a}</Link>
          ))}
        </div>
      </div>

      {erreur && (
        <div role="alert" style={{ position: "sticky", top: 8, zIndex: 5, padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#b91c1c", fontWeight: 600 }}>
          {erreur}
        </div>
      )}

      {/* 1 — Année */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>1 · Calendrier et absences programmées</h3>
        <table>
          <tbody>
            <tr>
              <td style={td}>Jours ouvrés de l&apos;année</td>
              <td style={td}><CaseNombre valeur={hyp.joursOuvres} onValide={regler("joursOuvres", "jours_ouvres")} /> jours</td>
              <td style={td} className="muted">Calendrier de l&apos;usine : fériés et fermetures déduits.</td>
            </tr>
            <tr>
              <td style={td}>Congés payés</td>
              <td style={td}><CaseNombre valeur={hyp.semConges} onValide={regler("semConges", "semaines_conges")} /> semaines</td>
              <td style={td} className="muted">Par salarié et par an.</td>
            </tr>
            <tr>
              <td style={td}>Modulation</td>
              <td style={td}><CaseNombre valeur={hyp.semModulation} onValide={regler("semModulation", "semaines_modulation")} /> semaines</td>
              <td style={td} className="muted">Absence programmée propre à l&apos;année. Total programmé : <strong>{txt(semProgramme)} semaines</strong>.</td>
            </tr>
            <tr>
              <td style={td}>Seuils des paliers de saturation</td>
              <td style={td} colSpan={2}>
                palier 1 jusqu&apos;à <CaseNombre valeur={Math.round(hyp.seuil1 * 100)} onValide={regler("seuil1", "seuil1", 100)} style={{ width: 60 }} /> % · palier 2 jusqu&apos;à{" "}
                <CaseNombre valeur={Math.round(hyp.seuil2 * 100)} onValide={regler("seuil2", "seuil2", 100)} style={{ width: 60 }} /> % · palier 3 jusqu&apos;à{" "}
                <CaseNombre valeur={Math.round(hyp.seuil3 * 100)} onValide={regler("seuil3", "seuil3", 100)} style={{ width: 60 }} /> % · au-delà : palier 4
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 2 — Lignes capacitaires */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>2 · Volumes et capacité des lignes</h3>
        <p className="muted" style={{ marginTop: 0, maxWidth: "95ch" }}>
          Une ligne capacitaire porte un volume et une capacité par jour ; on y rattache les lignes du Référentiel qui en dépendent
          (une fabrication et son conditionnement, deux lignes jumelles…). La saturation donne le palier, et le palier dit quels
          quarts sont ouverts : le besoin en postes est alors l&apos;effectif du Référentiel sur ces quarts. Une ligne du Référentiel
          rattachée à rien garde son organisation actuelle.
        </p>
        {capas.length === 0 && <p className="muted">Aucune ligne capacitaire pour {annee} : tous les postes sont comptés sur leur organisation actuelle.</p>}
        {capas.map((c) => {
          const sat = saturationLigne(c, hyp);
          const parMois = mensuel[c.id];
          return (
            <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <input
                  type="text"
                  defaultValue={c.nom}
                  maxLength={60}
                  style={{ width: 180, fontWeight: 700 }}
                  onBlur={(e) => { const nom = e.target.value.trim(); if (nom && nom !== c.nom) void majCapa(c.id, { nom }, { nom }); else e.target.value = c.nom; }}
                />
                <label>Capacité <CaseNombre valeur={c.capaciteJour} onValide={(n) => majCapa(c.id, { capacite_jour: n }, { capaciteJour: n })} /> / jour</label>
                {!parMois && <label>Volume annuel <CaseNombre valeur={c.volumeAnnuel} onValide={(n) => majCapa(c.id, { volume_annuel: n }, { volumeAnnuel: n })} style={{ width: 130 }} /></label>}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={!!parMois} onChange={(e) => basculerMensuel(c, e.target.checked)} style={{ width: "auto", margin: 0 }} />
                  budget mensualisé
                </label>
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontWeight: 700, background: sat.palier ? COULEUR_PALIER[sat.palier] : "#f1f5f9" }}>
                    {sat.palier ? `Saturation ${pct(sat.saturation)} · palier ${sat.palier}` : "Saturation non calculable"}
                  </span>
                  <button type="button" className="iconbtn del" title="Supprimer cette ligne capacitaire" onClick={() => void supprimerCapa(c)}><TrashIcon /></button>
                </span>
              </div>

              {parMois && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(70px, 1fr))", gap: 6, marginTop: 10 }}>
                  {MOIS_COURTS.map((m, i) => {
                    const sm = sat.mensuel?.[i];
                    return (
                      <div key={m} style={{ textAlign: "center" }}>
                        <div className="muted" style={{ fontSize: 12 }}>{m}</div>
                        <CaseNombre valeur={c.volumesMois?.[i] ?? null} onValide={majMois(c, i)} style={{ width: "100%" }} />
                        <div style={{ fontSize: 11, marginTop: 2, borderRadius: 4, background: sm?.palier ? COULEUR_PALIER[sm.palier] : "transparent" }}>{sm?.saturation != null ? pct(sm.saturation) : " "}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {parMois && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Dès qu&apos;un mois est saisi, le volume de l&apos;année est la somme des mois{sat.volume !== null ? ` : ${Math.round(sat.volume).toLocaleString("fr-FR")}` : ""}.</div>}

              <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(320px, 1.2fr)", gap: 16, marginTop: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Lignes du Référentiel rattachées</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                    {props.lignesRef.map((l) => {
                      const ailleurs = priseAilleurs(l.id, c.id);
                      return (
                        <label key={l.id} title={ailleurs ? `Déjà rattachée à « ${ailleurs} »` : l.atelierNom} style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: ailleurs ? 0.45 : 1 }}>
                          <input type="checkbox" checked={c.lignes.includes(l.id)} disabled={!!ailleurs} onChange={(e) => basculerLigne(c, l.id, e.target.checked)} style={{ width: "auto", margin: 0 }} />
                          {l.nom}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Quarts ouverts selon le palier</div>
                  <table>
                    <thead>
                      <tr>
                        <th style={th}>Palier</th>
                        {quarts.map((q) => <th key={q.code} style={{ ...th, textAlign: "center" }}>{q.libelle}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {PALIERS.map((p) => (
                        <tr key={p} style={{ background: sat.palier === p ? COULEUR_PALIER[p] : undefined, fontWeight: sat.palier === p ? 700 : 400 }}>
                          <td style={td}>{p}{sat.palier === p ? " ← retenu" : ""}</td>
                          {quarts.map((q) => (
                            <td key={q.code} style={{ ...td, textAlign: "center" }}>
                              <input type="checkbox" checked={(c.paliers[String(p)] ?? quarts.map((x) => x.code)).includes(q.code)} onChange={(e) => basculerQuart(c, p, q.code, e.target.checked)} style={{ width: "auto", margin: 0 }} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" value={nouveauNom} maxLength={60} placeholder="Nom (ex. C5/C6)" onChange={(e) => setNouveauNom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void creerCapa(); }} style={{ width: 200 }} />
          <button type="button" onClick={() => void creerCapa()} disabled={!nouveauNom.trim()} style={{ margin: 0, width: "auto" }}>Ajouter une ligne capacitaire</button>
        </div>
      </div>

      {/* 3 — Absentéisme subi */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>3 · Absentéisme subi par service</h3>
        <p className="muted" style={{ marginTop: 0, maxWidth: "95ch" }}>
          Calculé sur les 12 derniers mois d&apos;absences non planifiées saisies au Planning, hors intérim, en semaines par salarié.
          Une valeur forcée remplace le calcul ; la vider y revient.
        </p>
        <table>
          <thead>
            <tr>
              <th style={th}>Service</th>
              <th style={{ ...th, textAlign: "right" }}>Effectif</th>
              <th style={{ ...th, textAlign: "right" }}>Calculé (sem.)</th>
              <th style={th}>Forcé (sem.)</th>
              <th style={{ ...th, textAlign: "right" }}>Coefficient ETP</th>
            </tr>
          </thead>
          <tbody>
            {props.subi.map((s) => {
              const auto = semainesSubies(joursRetenus(props.joursSubisParMotif[s.atelierId], exclus), s.effectif);
              const force = hyp.subiForce[s.atelierId];
              const retenu = typeof force === "number" ? force : auto;
              return (
                <tr key={s.atelierId}>
                  <td style={td}>{s.nom}</td>
                  <td style={{ ...td, textAlign: "right" }}>{s.effectif}</td>
                  <td style={{ ...td, textAlign: "right", opacity: typeof force === "number" ? 0.45 : 1 }}>{txt(auto)}</td>
                  <td style={td}><CaseNombre valeur={typeof force === "number" ? force : null} onValide={forcerSubi(s.atelierId)} placeholder="calcul" style={{ width: 80 }} /></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }} title={`52 ÷ (52 − ${txt(semProgramme)} − ${txt(retenu)})`}>{coefEtp(semProgramme, retenu).toFixed(3).replace(".", ",")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {props.motifs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Motifs exclus du calcul (longue maladie, accident du travail…)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              {props.motifs.map((m) => (
                <label key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <input type="checkbox" checked={exclus.has(m.id)} onChange={(e) => void basculerMotif(m.id, e.target.checked)} style={{ width: "auto", margin: 0 }} />
                  {m.libelle}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 4 — Départs prévus */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>4 · Départs prévus jusqu&apos;à fin {annee}</h3>
        <p className="muted" style={{ marginTop: 0, maxWidth: "95ch" }}>
          Les fins de contrat connues sont reprises du Personnel. Les autres départs (retraite, mobilité…) se saisissent ici :
          pour une personne, ou sans nom sur un poste. Aucune date de naissance n&apos;est enregistrée.
        </p>
        <table>
          <thead>
            <tr>
              <th style={th}>Personne</th>
              <th style={th}>Poste titulaire</th>
              <th style={th}>Date prévue</th>
              <th style={th}>Motif</th>
              <th style={th}>Commentaire</th>
              <th style={th}>Origine</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {departs.length === 0 && (
              <tr><td style={td} colSpan={7} className="muted">Aucun départ prévu.</td></tr>
            )}
            {departs.map((d, i) => (
              <tr key={d.id ?? `c${i}`}>
                <td style={{ ...td, fontWeight: 600 }}>{d.nom}</td>
                <td style={td}>{d.poste}</td>
                <td style={td}>{fmtDate(d.date)}</td>
                <td style={td}>{d.motif}</td>
                <td style={td} className="muted">{d.commentaire || "—"}</td>
                <td style={td} className="muted">{d.source === "contrat" ? "Contrat (Personnel)" : "Saisi ici"}</td>
                <td style={td}>
                  {d.source === "saisi" && (
                    <button type="button" className="iconbtn del" title="Retirer ce départ" onClick={() => void retirerDepart(d)}><TrashIcon /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
          <select value={dType} onChange={(e) => { setDType(e.target.value === "poste" ? "poste" : "personne"); setDCible(""); }} style={{ width: "auto" }}>
            <option value="personne">Une personne</option>
            <option value="poste">Sans nom, sur un poste</option>
          </select>
          <select value={dCible} onChange={(e) => setDCible(e.target.value)} style={{ width: 280 }}>
            <option value="">{dType === "personne" ? "Choisir la personne…" : "Choisir le poste…"}</option>
            {dType === "personne"
              ? props.personnesRef.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.poste !== "—" ? ` — ${p.poste}` : ""}</option>)
              : props.postesRef.map((p) => <option key={p.id} value={p.id}>{p.nom} — {p.ligne}</option>)}
          </select>
          <input type="date" value={dDate} max={`${annee}-12-31`} onChange={(e) => setDDate(e.target.value)} style={{ width: "auto" }} title="Date prévue (facultative)" />
          <select value={dMotif} onChange={(e) => setDMotif(e.target.value)} style={{ width: "auto" }}>
            {MOTIFS_DEPART.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="text" value={dComm} maxLength={200} placeholder="Commentaire (facultatif)" onChange={(e) => setDComm(e.target.value)} style={{ width: 240 }} />
          <button type="button" onClick={() => void ajouterDepart()} style={{ margin: 0, width: "auto" }}>Ajouter le départ</button>
        </div>
      </div>
    </div>
  );
}
