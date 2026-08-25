"use client";

import { useCallback, useEffect, useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { EditIcon, TrashIcon, SaveIcon } from "@/components/icons";
import { rotationForWeek, type RotationRef } from "@/lib/rotation";
import { mondayOf, isoDate, addDays } from "@/lib/week";

const JOURS = [
  { dow: 1, label: "Lundi" },
  { dow: 2, label: "Mardi" },
  { dow: 3, label: "Mercredi" },
  { dow: 4, label: "Jeudi" },
  { dow: 5, label: "Vendredi" },
  { dow: 6, label: "Samedi" },
  { dow: 7, label: "Dimanche" },
];
type HMap = Record<string, { debut: string; fin: string }>;
type DemiCfg = { mode: string; source: string; matin?: HMap; aprem?: HMap };
type TpConfig = { demi?: DemiCfg; off?: Record<string, string[]>; horaires?: HMap };
type Pers = { id: string; label: string; temps_partiel: boolean; tp_type: string | null; tp_config: TpConfig | null };
type TpPeriode = {
  id: string;
  personne_id: string;
  date_debut: string;
  date_fin: string | null;
  tp_config: TpConfig;
  created_at: string;
};

const emptyH = (): Record<number, { debut: string; fin: string }> => {
  const o: Record<number, { debut: string; fin: string }> = {};
  for (const j of JOURS) o[j.dow] = { debut: "", fin: "" };
  return o;
};
const fromHMap = (m?: HMap) => {
  const o = emptyH();
  if (m) for (const j of JOURS) if (m[String(j.dow)]) o[j.dow] = { ...m[String(j.dow)] };
  return o;
};
const toHMap = (o: Record<number, { debut: string; fin: string }>): HMap => {
  const m: HMap = {};
  for (const j of JOURS) if (o[j.dow].debut || o[j.dow].fin) m[String(j.dow)] = o[j.dow];
  return m;
};

// Statut d'une période par rapport à aujourd'hui.
type PeriodeStatut = "past" | "current" | "future";
function statutPeriode(p: TpPeriode, today: string): PeriodeStatut {
  if (p.date_fin && p.date_fin < today) return "past";
  if (p.date_debut > today) return "future";
  return "current";
}
const statutLabel: Record<PeriodeStatut, string> = { past: "Terminée", current: "En cours", future: "À venir" };
const statutColor: Record<PeriodeStatut, string> = { past: "#94a3b8", current: "#16a34a", future: "#2563eb" };

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");
const todayIso = () => new Date().toISOString().slice(0, 10);

// --- Cas types -------------------------------------------------------
type Preset = {
  cle: string;
  titre: string;
  detail: string;
  applique: () => { off: Record<number, { matin: boolean; aprem: boolean }>; demiMode?: "matin" | "aprem" | "tournant" };
};
const offVide = () => {
  const o: Record<number, { matin: boolean; aprem: boolean }> = {};
  for (const j of JOURS) o[j.dow] = { matin: false, aprem: false };
  return o;
};
const offSemaine = (creneau: "matin" | "aprem") => {
  const o = offVide();
  for (const j of JOURS) if (j.dow <= 5) o[j.dow][creneau] = true;
  return o;
};

const PRESETS: Preset[] = [
  {
    cle: "mt-matin",
    titre: "Mi-temps matin",
    detail: "Travaille les matins, du lundi au vendredi.",
    applique: () => ({ off: offSemaine("aprem"), demiMode: "tournant" }),
  },
  {
    cle: "mt-aprem",
    titre: "Mi-temps après-midi",
    detail: "Travaille les après-midi, du lundi au vendredi.",
    applique: () => ({ off: offSemaine("matin"), demiMode: "tournant" }),
  },
  {
    cle: "jours",
    titre: "Jour(s) non travaillé(s)",
    detail: "Journées entières en moins (ex. le mercredi).",
    applique: () => ({ off: offVide() }),
  },
  {
    cle: "horaires",
    titre: "Horaires réduits",
    detail: "Présente tous les jours, mais sur des horaires propres.",
    applique: () => ({ off: offVide() }),
  },
];

// ── Éditeur de config TP (extraite au top-level, pas de composant imbriqué) ──
// Renvoie le JSX de l'éditeur de configuration (presets, sections, aperçu).
function renderConfigEditor(props: {
  demiOn: boolean; setDemiOn: (v: boolean) => void;
  demiMode: "matin" | "aprem" | "tournant"; setDemiMode: (v: "matin" | "aprem" | "tournant") => void;
  demiSource: "quart" | "horaires"; setDemiSource: (v: "quart" | "horaires") => void;
  demiMatin: Record<number, { debut: string; fin: string }>; setDemiMatin: React.Dispatch<React.SetStateAction<Record<number, { debut: string; fin: string }>>>;
  demiAprem: Record<number, { debut: string; fin: string }>; setDemiAprem: React.Dispatch<React.SetStateAction<Record<number, { debut: string; fin: string }>>>;
  offOn: boolean; setOffOn: (v: boolean) => void;
  off: Record<number, { matin: boolean; aprem: boolean }>; setOff: React.Dispatch<React.SetStateAction<Record<number, { matin: boolean; aprem: boolean }>>>;
  horOn: boolean; setHorOn: (v: boolean) => void;
  hor: Record<number, { debut: string; fin: string }>; setHor: React.Dispatch<React.SetStateAction<Record<number, { debut: string; fin: string }>>>;
  avance: boolean; setAvance: (v: boolean | ((prev: boolean) => boolean)) => void;
  equipe: { id: string; nom: string; quart_fixe?: string | null } | null;
  quarts: { code: string; libelle: string; creneau?: string | null }[];
  rotationRefs: RotationRef[];
  readOnly: boolean;
}) {
  const { demiOn, setDemiOn, demiMode, setDemiMode, demiSource, setDemiSource,
    demiMatin, setDemiMatin, demiAprem, setDemiAprem,
    offOn, setOffOn, off, setOff,
    horOn, setHorOn, hor, setHor,
    avance, setAvance, equipe, quarts, rotationRefs, readOnly } = props;

  const cell: React.CSSProperties = { padding: "3px 8px", textAlign: "center" };
  const timeInp: React.CSSProperties = { fontSize: 13, padding: "3px 4px", width: 96 };
  const showMatin = demiMode !== "aprem";
  const showAprem = demiMode !== "matin";

  function appliquerPreset(p: Preset) {
    if (readOnly) return;
    const r = p.applique();
    setOff(r.off);
    const aDesOff = JOURS.some((j) => r.off[j.dow].matin || r.off[j.dow].aprem);
    setOffOn(aDesOff);
    if (r.demiMode) {
      setDemiOn(true);
      setDemiMode(r.demiMode);
      setDemiSource("quart");
    } else {
      setDemiOn(false);
    }
    setHorOn(p.cle === "horaires");
    setAvance(p.cle === "jours" || p.cle === "horaires");
  }

  // Synthèse.
  const ouvres = JOURS.filter((j) => j.dow <= 5);
  // Créneau (demi-journée) d'un quart : explicite en base (quart.creneau),
  // plus codé en dur sur matin/apres_midi.
  const creneauDe = (code: string | null): "matin" | "aprem" | null => {
    const c = code ? quarts.find((q) => q.code === code)?.creneau : null;
    return c === "matin" || c === "aprem" ? c : null;
  };
  const postesSemaine = (quartEquipe: string | null) => {
    if (!offOn) return ouvres.length;
    const cle = creneauDe(quartEquipe);
    if (!cle) return ouvres.filter((j) => !(off[j.dow].matin && off[j.dow].aprem)).length;
    return ouvres.filter((j) => !off[j.dow][cle]).length;
  };
  const tousMatinsOff = offOn && ouvres.every((j) => off[j.dow].matin);
  const tousApremOff = offOn && ouvres.every((j) => off[j.dow].aprem);
  const creneau: "matin" | "apres_midi" | null =
    tousApremOff && !tousMatinsOff ? "matin" : tousMatinsOff && !tousApremOff ? "apres_midi" : null;
  const lundi0 = isoDate(mondayOf());
  const semaines = [0, 1].map((k) => {
    const iso = isoDate(addDays(mondayOf(), k * 7));
    const quartEquipe = equipe ? equipe.quart_fixe ?? rotationForWeek(rotationRefs, iso)[equipe.id] ?? null : null;
    const postes = postesSemaine(quartEquipe);
    return { iso, quartEquipe, postes, travaille: postes > 0 };
  });
  const quartLib = (c: string | null) => (c ? quarts.find((q) => q.code === c)?.libelle ?? c : "—");
  const fmtLundi = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
  const alterne = !!equipe && !equipe.quart_fixe && semaines[0].postes !== semaines[1].postes;
  const postesQuinzaine = semaines[0].postes + semaines[1].postes;
  const taux = Math.round((postesQuinzaine / 10) * 100);
  const resume = (() => {
    if (!demiOn && !offOn && !horOn) return "Aucune option cochée — le temps partiel ne s'appliquera pas.";
    const bouts: string[] = [];
    if (creneau === "matin") bouts.push("quart du matin uniquement");
    else if (creneau === "apres_midi") bouts.push("quart d'après-midi uniquement");
    else if (offOn && semaines[0].postes < ouvres.length) bouts.push(`${ouvres.length - semaines[0].postes} jour(s) en moins par semaine`);
    if (alterne) bouts.push("une semaine sur deux (rotation de l'équipe)");
    if (demiOn && demiSource === "horaires") bouts.push("demi-journées (taux réel inférieur)");
    if (horOn) bouts.push("horaires spécifiques");
    return bouts.length ? bouts.join(" · ") : "Temps plein sur les jours ouvrés.";
  })();

  return (
    <>
      {/* Cas types */}
      {!readOnly && (
        <>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
            Choisissez un cas type, puis ajustez si besoin.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {PRESETS.map((p) => (
              <button
                key={p.cle}
                type="button"
                onClick={() => appliquerPreset(p)}
                title={p.detail}
                className="btn-sm"
                style={{ background: "#fff", color: "var(--text)", border: "1px solid var(--border)", textAlign: "left" }}
              >
                {p.titre}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAvance((v: boolean) => !v)}
              className="btn-sm btn-ghost"
              style={{ marginLeft: "auto" }}
            >
              {avance ? "▴ Masquer le détail" : "▾ Sur mesure"}
            </button>
          </div>
        </>
      )}

      {/* Synthèse + aperçu de la quinzaine */}
      <div className="card section" style={{ background: "#f8fafc", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>≈ {taux} %</strong>
          <span className="muted" style={{ fontSize: 12 }}>({postesQuinzaine} postes sur 10 par quinzaine)</span>
          <span style={{ fontSize: 13 }}>{resume}</span>
        </div>
        {equipe ? (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              Deux prochaines semaines — équipe {equipe.nom}
              {equipe.quart_fixe ? ` (quart fixe : ${quartLib(equipe.quart_fixe)})` : " (tournante)"}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {semaines.map((sm) => (
                <div
                  key={sm.iso}
                  style={{
                    flex: "1 1 180px",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor: sm.travaille ? "#16a34a" : "#cbd5e1",
                    background: sm.travaille ? "#f0fdf4" : "#f1f5f9",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Semaine du {fmtLundi(sm.iso)}
                    {sm.iso === lundi0 && <span className="muted" style={{ fontWeight: 400 }}> (en cours)</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>Équipe en {quartLib(sm.quartEquipe)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: sm.travaille ? "#166534" : "#64748b" }}>
                    {sm.travaille ? `Travaille — ${sm.postes} poste${sm.postes > 1 ? "s" : ""}` : "Ne travaille pas"}
                  </div>
                </div>
              ))}
            </div>
            {alterne && (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                L&apos;alternance vient de la <strong>rotation de l&apos;équipe</strong>, pas du temps partiel :
                la personne ne travaille que les semaines où son équipe est sur son créneau.
              </p>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            Aucune équipe affectée : l&apos;aperçu de la rotation n&apos;est pas calculable.
          </p>
        )}
      </div>

      {(avance || readOnly) && (
      <fieldset disabled={readOnly} style={{ border: "none", padding: 0, margin: 0 }}>
        {!readOnly && <p className="muted" style={{ marginTop: 0 }}>Options cumulables. Cochez celles qui s&apos;appliquent.</p>}

        {/* Section 1 : demi-journée */}
        <div className="card section" style={{ background: demiOn ? "#f0f9ff" : undefined }}>
          <label style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={demiOn} onChange={(e) => setDemiOn(e.target.checked)} style={{ width: "auto" }} />
            Demi-journée (ne travaille qu&apos;une demi-journée)
          </label>
          {demiOn && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span className="muted">Créneau :</span>
                <div className="segments">
                  <button type="button" className={demiMode === "matin" ? "seg active" : "seg"} onClick={() => setDemiMode("matin")}>Matin (fixe)</button>
                  <button type="button" className={demiMode === "aprem" ? "seg active" : "seg"} onClick={() => setDemiMode("aprem")}>Après-midi (fixe)</button>
                  <button type="button" className={demiMode === "tournant" ? "seg active" : "seg"} onClick={() => setDemiMode("tournant")} title="La personne suit le quart de son équipe ; aucune demi-journée n'est imposée par le temps partiel.">Suit le quart de l&apos;équipe</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span className="muted">Horaire :</span>
                <div className="segments">
                  <button type="button" className={demiSource === "quart" ? "seg active" : "seg"} onClick={() => setDemiSource("quart")}>Quart système</button>
                  <button type="button" className={demiSource === "horaires" ? "seg active" : "seg"} onClick={() => setDemiSource("horaires")}>Horaires saisis</button>
                </div>
              </div>
              {demiSource === "horaires" && (
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Jour</th>
                      {showMatin && <th style={cell} colSpan={2}>Matin</th>}
                      {showAprem && <th style={cell} colSpan={2}>Après-midi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {JOURS.map((j) => (
                      <tr key={j.dow}>
                        <td>{j.label}</td>
                        {showMatin && (
                          <>
                            <td style={cell}><input type="time" value={demiMatin[j.dow].debut} onChange={(e) => setDemiMatin((h) => ({ ...h, [j.dow]: { ...h[j.dow], debut: e.target.value } }))} style={timeInp} /></td>
                            <td style={cell}><input type="time" value={demiMatin[j.dow].fin} onChange={(e) => setDemiMatin((h) => ({ ...h, [j.dow]: { ...h[j.dow], fin: e.target.value } }))} style={timeInp} /></td>
                          </>
                        )}
                        {showAprem && (
                          <>
                            <td style={cell}><input type="time" value={demiAprem[j.dow].debut} onChange={(e) => setDemiAprem((h) => ({ ...h, [j.dow]: { ...h[j.dow], debut: e.target.value } }))} style={timeInp} /></td>
                            <td style={cell}><input type="time" value={demiAprem[j.dow].fin} onChange={(e) => setDemiAprem((h) => ({ ...h, [j.dow]: { ...h[j.dow], fin: e.target.value } }))} style={timeInp} /></td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Fixe : bloqué sur l&apos;autre demi-journée dans le planning. Tournant : suit le quart où elle est placée.
              </p>
            </div>
          )}
        </div>

        {/* Section 2 : jours non travaillés */}
        <div className="card section" style={{ background: offOn ? "#f0f9ff" : undefined }}>
          <label style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={offOn} onChange={(e) => setOffOn(e.target.checked)} style={{ width: "auto" }} />
            Jours / demi-journées non travaillés
          </label>
          {offOn && (
            <table style={{ width: "100%", marginTop: 8 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Jour</th><th style={cell}>Matin</th><th style={cell}>Après-midi</th></tr></thead>
              <tbody>
                {JOURS.map((j) => (
                  <tr key={j.dow}>
                    <td>{j.label}</td>
                    <td style={cell}><input type="checkbox" checked={off[j.dow].matin} onChange={(e) => setOff((o) => ({ ...o, [j.dow]: { ...o[j.dow], matin: e.target.checked } }))} style={{ width: "auto" }} /></td>
                    <td style={cell}><input type="checkbox" checked={off[j.dow].aprem} onChange={(e) => setOff((o) => ({ ...o, [j.dow]: { ...o[j.dow], aprem: e.target.checked } }))} style={{ width: "auto" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 3 : horaires journée entière */}
        <div className="card section" style={{ background: horOn ? "#f0f9ff" : undefined }}>
          <label style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={horOn} onChange={(e) => setHorOn(e.target.checked)} style={{ width: "auto" }} />
            Horaires spécifiques (journée entière)
          </label>
          {horOn && (
            <table style={{ width: "100%", marginTop: 8 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Jour</th><th style={cell}>Début</th><th style={cell}>Fin</th></tr></thead>
              <tbody>
                {JOURS.map((j) => (
                  <tr key={j.dow}>
                    <td>{j.label}</td>
                    <td style={cell}><input type="time" value={hor[j.dow].debut} onChange={(e) => setHor((h) => ({ ...h, [j.dow]: { ...h[j.dow], debut: e.target.value } }))} style={timeInp} /></td>
                    <td style={cell}><input type="time" value={hor[j.dow].fin} onChange={(e) => setHor((h) => ({ ...h, [j.dow]: { ...h[j.dow], fin: e.target.value } }))} style={timeInp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </fieldset>
      )}
    </>
  );
}

// ── Composant principal ──────────────────────────────────────────────────

export default function TempsPartielModal({
  personne,
  equipe = null,
  quarts = [],
  rotationRefs = [],
  onClose,
  onSaved,
}: {
  personne: Pers;
  equipe?: { id: string; nom: string; quart_fixe?: string | null } | null;
  quarts?: { code: string; libelle: string; creneau?: string | null }[];
  rotationRefs?: RotationRef[];
  onClose: () => void;
  onSaved: (p: { temps_partiel: boolean; tp_type: string | null; tp_config: TpConfig | null }) => void;
}) {
  const [periodes, setPeriodes] = useState<TpPeriode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Édition : null = vue liste, objet = formulaire de création/édition.
  const [editing, setEditing] = useState<{
    mode: "new" | "edit";
    id?: string;
    dateDebut: string;
    dateFin: string;
    statut: PeriodeStatut;
  } | null>(null);

  // États de la config TP (réinitialisés à chaque ouverture d'édition).
  const [demiOn, setDemiOn] = useState(false);
  const [demiMode, setDemiMode] = useState<"matin" | "aprem" | "tournant">("matin");
  const [demiSource, setDemiSource] = useState<"quart" | "horaires">("quart");
  const [demiMatin, setDemiMatin] = useState(emptyH());
  const [demiAprem, setDemiAprem] = useState(emptyH());
  const [offOn, setOffOn] = useState(false);
  const [off, setOff] = useState(offVide());
  const [horOn, setHorOn] = useState(false);
  const [hor, setHor] = useState(emptyH());
  const [avance, setAvance] = useState(false);

  // Charger les périodes au montage.
  const loadPeriodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "tp-periode-list", personne_id: personne.id }),
      });
      if (res.ok) {
        const j = await res.json();
        setPeriodes(j.periodes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [personne.id]);

  useEffect(() => { loadPeriodes(); }, [loadPeriodes]);

  // Initialiser l'éditeur de config depuis un tp_config existant.
  function initConfig(cfg: TpConfig | null) {
    const c = cfg ?? {};
    setDemiOn(!!c.demi);
    setDemiMode((c.demi?.mode as "matin" | "aprem" | "tournant") ?? "matin");
    setDemiSource((c.demi?.source as "quart" | "horaires") ?? "quart");
    setDemiMatin(fromHMap(c.demi?.matin));
    setDemiAprem(fromHMap(c.demi?.aprem));
    const hasOff = !!c.off && Object.keys(c.off).length > 0;
    setOffOn(hasOff);
    const o = offVide();
    if (c.off) {
      for (const j of JOURS) {
        const list = c.off[String(j.dow)] ?? [];
        o[j.dow] = { matin: list.includes("matin"), aprem: list.includes("aprem") };
      }
    }
    setOff(o);
    setHorOn(!!c.horaires && Object.keys(c.horaires).length > 0);
    setHor(fromHMap(c.horaires));
    setAvance(!!cfg);
  }

  // Construire le tp_config depuis les états courants.
  function buildConfig(): TpConfig {
    const tp_config: TpConfig = {};
    if (demiOn) {
      const d: DemiCfg = { mode: demiMode, source: demiSource };
      if (demiSource === "horaires") {
        if (demiMode !== "aprem") d.matin = toHMap(demiMatin);
        if (demiMode !== "matin") d.aprem = toHMap(demiAprem);
      }
      tp_config.demi = d;
    }
    if (offOn) {
      const o: Record<string, string[]> = {};
      for (const j of JOURS) {
        const list: string[] = [];
        if (off[j.dow].matin) list.push("matin");
        if (off[j.dow].aprem) list.push("aprem");
        if (list.length) o[String(j.dow)] = list;
      }
      tp_config.off = o;
    }
    if (horOn) tp_config.horaires = toHMap(hor);
    return tp_config;
  }

  // Ouvrir l'éditeur pour une nouvelle période.
  function ouvrirCreation() {
    const today = todayIso();
    initConfig(null);
    setEditing({ mode: "new", dateDebut: today, dateFin: "", statut: "current" });
    setErr("");
  }

  // Ouvrir l'éditeur pour modifier une période existante.
  function ouvrirEdition(p: TpPeriode) {
    const st = statutPeriode(p, todayIso());
    initConfig(p.tp_config);
    setEditing({ mode: "edit", id: p.id, dateDebut: p.date_debut, dateFin: p.date_fin ?? "", statut: st });
    setErr("");
  }

  // Enregistrer (créer ou modifier).
  async function sauvegarder() {
    if (!editing) return;
    if (!editing.dateDebut) { setErr("Date de début requise."); return; }
    if (editing.dateFin && editing.dateFin < editing.dateDebut) { setErr("La date de fin doit être ≥ date de début."); return; }
    const config = buildConfig();
    if (!demiOn && !offOn && !horOn) { setErr("Aucune option cochée — le temps partiel ne s'appliquera pas."); return; }
    setBusy(true);
    setErr("");
    try {
      const isNew = editing.mode === "new";
      const payload: Record<string, unknown> = isNew
        ? {
            op: "tp-periode-create",
            personne_id: personne.id,
            date_debut: editing.dateDebut,
            date_fin: editing.dateFin || null,
            tp_config: config,
          }
        : {
            op: "tp-periode-update",
            id: editing.id,
            personne_id: personne.id,
            ...(editing.statut !== "current" ? { date_debut: editing.dateDebut } : {}),
            date_fin: editing.dateFin || null,
            tp_config: config,
          };
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Échec de l'enregistrement."); return; }
      setEditing(null);
      await loadPeriodes();
      // Notifier le parent avec la config de la période courante (pour mise à jour immédiate).
      onSaved({ temps_partiel: true, tp_type: null, tp_config: config });
    } finally {
      setBusy(false);
    }
  }

  // Supprimer une période future.
  async function supprimer(p: TpPeriode) {
    if (!window.confirm(`Supprimer la période du ${fmtDate(p.date_debut)} ?`)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "tp-periode-delete", id: p.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Échec de la suppression.");
        return;
      }
      await loadPeriodes();
      // Notifier le parent.
      const remaining = periodes.filter((x) => x.id !== p.id);
      const current = remaining.find((x) => statutPeriode(x, todayIso()) === "current");
      onSaved({ temps_partiel: !!current, tp_type: null, tp_config: current?.tp_config ?? null });
    } finally {
      setBusy(false);
    }
  }

  const today = todayIso();

  return (
    <ModaleDeplacable onClose={onClose} largeur={680}>
      <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
        <h2 style={{ margin: 0 }}>Temps partiel — {personne.label}</h2>
        <button type="button" className="btn-sm btn-ghost" onClick={onClose} style={{ width: "auto" }}>✕</button>
      </div>

      {/* ── Vue liste ────────────────────────────────────────────── */}
      {!editing && (
        <>
          {loading ? (
            <p className="muted">Chargement…</p>
          ) : periodes.length === 0 ? (
            <p className="muted">Aucune période de temps partiel enregistrée.</p>
          ) : (
            <div style={{ maxHeight: 260, overflow: "auto", marginBottom: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Début</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Fin</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Statut</th>
                    <th style={{ textAlign: "right", padding: "6px 8px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {periodes.map((p) => {
                    const st = statutPeriode(p, today);
                    const canEdit = st !== "past";
                    const canDelete = st === "future";
                    return (
                      <tr key={p.id} style={{ opacity: st === "past" ? 0.55 : 1 }}>
                        <td style={{ padding: "5px 8px" }}>{fmtDate(p.date_debut)}</td>
                        <td style={{ padding: "5px 8px" }}>{p.date_fin ? fmtDate(p.date_fin) : "—"}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ color: statutColor[st], fontWeight: 600, fontSize: 12 }}>
                            {statutLabel[st]}
                          </span>
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right" }}>
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            {canEdit && (
                              <button type="button" className="iconbtn edit" onClick={() => ouvrirEdition(p)} title="Modifier">
                                <EditIcon />
                              </button>
                            )}
                            {st === "past" && (
                              <button type="button" className="iconbtn" onClick={() => ouvrirEdition(p)} title="Consulter">
                                <span style={{ fontSize: 14 }}>👁</span>
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" className="iconbtn del" onClick={() => supprimer(p)} title="Supprimer" disabled={busy}>
                                <TrashIcon />
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {err && <p style={{ color: "var(--danger)", fontWeight: 600, fontSize: 13 }}>{err}</p>}

          <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" onClick={ouvrirCreation} style={{ width: "auto", padding: "8px 18px" }}>
              + Nouvelle période
            </button>
          </div>
        </>
      )}

      {/* ── Vue édition ──────────────────────────────────────────── */}
      {editing && (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setEditing(null)} style={{ width: "auto" }}>
              ← Retour
            </button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {editing.mode === "new" ? "Nouvelle période" : editing.statut === "past" ? "Consultation (période terminée)" : "Modifier la période"}
            </span>
          </div>

          {/* Dates */}
          <div className="card section" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Date de début</span>
                <input
                  type="date"
                  value={editing.dateDebut}
                  onChange={(e) => setEditing({ ...editing, dateDebut: e.target.value })}
                  // Verrou seulement sur une période EXISTANTE déjà commencée (en
                  // cours) ou terminée : son passé est déjà appliqué. À la création,
                  // la date de début reste libre — on peut la poser dans le futur
                  // pour anticiper un changement de rythme.
                  disabled={editing.mode === "edit" && (editing.statut === "current" || editing.statut === "past")}
                  style={{ fontSize: 14, padding: "5px 8px" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Date de fin <span className="muted" style={{ fontWeight: 400 }}>(vide = ouverte)</span></span>
                <input
                  type="date"
                  value={editing.dateFin}
                  onChange={(e) => setEditing({ ...editing, dateFin: e.target.value })}
                  disabled={editing.statut === "past"}
                  style={{ fontSize: 14, padding: "5px 8px" }}
                />
              </label>
            </div>
            {editing.mode === "edit" && editing.statut === "current" && (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                Période en cours : la date de début n&apos;est plus modifiable.
              </p>
            )}
            {editing.statut === "past" && (
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
                Période terminée : consultation seule.
              </p>
            )}
          </div>

          {/* Config TP */}
          {renderConfigEditor({
            demiOn, setDemiOn, demiMode, setDemiMode, demiSource, setDemiSource,
            demiMatin, setDemiMatin, demiAprem, setDemiAprem,
            offOn, setOffOn, off, setOff,
            horOn, setHorOn, hor, setHor,
            avance, setAvance,
            equipe, quarts, rotationRefs,
            readOnly: editing.statut === "past",
          })}

          {err && <p style={{ color: "var(--danger)", fontWeight: 600, fontSize: 13 }}>{err}</p>}

          {editing.statut !== "past" && (
            <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setEditing(null)} style={{ width: "auto" }}>
                Annuler
              </button>
              <button type="button" disabled={busy} onClick={sauvegarder} style={{ width: "auto", padding: "9px 22px" }}>
                <SaveIcon /> {busy ? "..." : "Enregistrer"}
              </button>
            </div>
          )}
        </>
      )}
    </ModaleDeplacable>
  );
}
