"use client";

import { useRef, useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";
import {
  CATEGORIES,
  HEURES_NUIT_MIN,
  LIBELLE_CATEGORIE,
  MAX_LEGAL,
  MOTIFS_SIR,
  PLAGE_NUIT,
  heuresDeNuit,
  type CategorieVisite,
  type Parametres,
  type Regime,
  type RegimeCode,
} from "@/lib/visites";

export type QuartRow = { code: string; libelle: string; ordre: number; debut: string | null; fin: string | null; rotation: boolean; nuit: boolean };
export type PosteRow = {
  id: string;
  nom: string;
  actif: boolean;
  suivi_renforce: boolean;
  suivi_motif: string | null;
  anci_usage: string | null;
  ligne: { nom: string; atelier: { nom: string } | null } | null;
};
export type CompRow = { id: string; nom: string; groupe: string | null; suivi_renforce: boolean; anci_usage: string | null; a_autorisation_conduite: boolean };
export type MotifRow = { id: string; libelle: string; code_court: string; visite_reprise: boolean };
export type TypeRow = { id: string; code: string; libelle: string; categorie: CategorieVisite; actif: boolean; ordre: number };
export type UsageRow = { id: string; code: string; libelle: string; actif: boolean; ordre: number };

type Onglet = "regimes" | "declencheurs" | "catalogue" | "alertes";
const ONGLETS: { key: Onglet; label: string }[] = [
  { key: "regimes", label: "Régimes et plafonds" },
  { key: "declencheurs", label: "Déclencheurs" },
  { key: "catalogue", label: "Types de visite et attestations" },
  { key: "alertes", label: "Alertes" },
];

export default function VisitesParamEditor(props: {
  params: Parametres;
  regimes: Regime[];
  types: TypeRow[];
  usages: UsageRow[];
  quarts: QuartRow[];
  postes: PosteRow[];
  comps: CompRow[];
  motifs: MotifRow[];
}) {
  const [onglet, setOnglet] = useState<Onglet>("regimes");
  const [params, setParams] = useState(props.params);
  const [regimes, setRegimes] = useState(props.regimes);
  const [types, setTypes] = useState(props.types);
  const [usages, setUsages] = useState(props.usages);
  const [quarts, setQuarts] = useState(props.quarts);
  const [postes, setPostes] = useState(props.postes);
  const [comps, setComps] = useState(props.comps);
  const [motifs, setMotifs] = useState(props.motifs);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function post(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setSave("saving");
    setMsg(null);
    const res = await fetch("/api/visites-param", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    if (!res || !res.ok) {
      const j = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      setSave("error");
      setMsg(j.error ?? "Échec de l'enregistrement.");
      savedTimer.current = setTimeout(() => setSave("idle"), 4000);
      return null;
    }
    setSave("saved");
    savedTimer.current = setTimeout(() => setSave("idle"), 1500);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  function differer(cle: string, fn: () => void, delai = 500) {
    if (timers.current[cle]) clearTimeout(timers.current[cle]);
    timers.current[cle] = setTimeout(fn, delai);
  }

  const usagesActifs = usages.filter((u) => u.actif);

  // ---- Régimes --------------------------------------------------------------
  function majRegime(code: RegimeCode, champ: "mois" | "moisInter", valeur: string) {
    const n = valeur === "" ? null : Number(valeur);
    setRegimes((rs) => rs.map((r) => (r.code === code ? { ...r, [champ]: n } : r)));
    differer(`regime:${code}:${champ}`, () =>
      void post({
        op: "regime.set",
        code,
        ...(champ === "mois" ? { mois_renouvellement: n ?? 1 } : { mois_intermediaire: valeur }),
      }),
    );
  }

  // ---- Réglages simples -----------------------------------------------------
  function majParam(cle: keyof Parametres, valeur: number | boolean, instant = false) {
    setParams((p) => ({ ...p, [cle]: valeur }));
    differer(`param:${cle}`, () => void post({ op: "param.set", cle, valeur }), instant ? 0 : 500);
  }

  const styleNombre = (hs = false): React.CSSProperties => ({
    width: 64,
    fontSize: 13,
    padding: "3px 5px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    borderColor: hs ? "var(--danger)" : undefined,
    background: hs ? "#fde8e8" : undefined,
  });

  const saveLabel = save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? (msg ?? "Échec") : "";
  const saveColor = save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)";

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {ONGLETS.map((o) => (
          <button
            key={o.key}
            type="button"
            className="btn-sm"
            onClick={() => setOnglet(o.key)}
            style={
              onglet === o.key
                ? { background: "var(--primary)", color: "#fff", border: "1px solid var(--primary)", margin: 0 }
                : { background: "#fff", color: "var(--text)", border: "1px solid var(--border)", margin: 0 }
            }
          >
            {o.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: saveColor, alignSelf: "center", maxWidth: 420, textAlign: "right" }}>
          {saveLabel}
        </span>
      </div>

      {/* ------------------------------------------------ RÉGIMES ---------- */}
      {onglet === "regimes" && (
        <div className="card section">
          <h2 style={{ marginTop: 0 }}>Régimes de suivi et plafonds</h2>
          <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
            Les durées du Code du travail sont des <strong>maxima</strong>, jamais des cibles : vous
            pouvez les raccourcir si votre service de santé au travail l&apos;a prévu. Une valeur
            au-delà du maximum légal s&apos;affiche en rouge — elle reste enregistrée, c&apos;est
            votre décision. Une date fixée par le professionnel sur l&apos;avis l&apos;emporte
            toujours si elle est plus proche.
          </p>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 170 }}>Régime</th>
                <th>Qui est concerné</th>
                <th style={{ width: 130 }}>Renouvellement</th>
                <th style={{ width: 150 }}>Visite intermédiaire</th>
                <th style={{ width: 210 }}>Maximum légal</th>
              </tr>
            </thead>
            <tbody>
              {regimes.map((r) => {
                const max = MAX_LEGAL[r.code];
                return (
                  <tr key={r.code}>
                    <td style={{ fontWeight: 600 }}>{r.libelle}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {r.code === "simple" && "Tout salarié sans déclencheur particulier."}
                      {r.code === "adapte" && "Travailleurs de nuit, et toute personne cochée « suivi adapté »."}
                      {r.code === "renforce" && "Postes à risques particuliers et habilitations à risque."}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={r.mois}
                        onChange={(e) => majRegime(r.code, "mois", e.target.value)}
                        style={styleNombre(r.mois > max.mois)}
                        title={r.mois > max.mois ? `Au-delà du maximum légal (${max.mois} mois)` : ""}
                      />{" "}
                      <span className="muted" style={{ fontSize: 12 }}>mois</span>
                    </td>
                    <td>
                      {max.moisInter === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <input
                            type="number"
                            min={1}
                            value={r.moisInter ?? ""}
                            onChange={(e) => majRegime(r.code, "moisInter", e.target.value)}
                            style={styleNombre((r.moisInter ?? 0) > max.moisInter)}
                          />{" "}
                          <span className="muted" style={{ fontSize: 12 }}>mois</span>
                        </>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {r.code === "simple" && "60 mois · R4624-16"}
                      {r.code === "adapte" && "36 mois · R4624-17"}
                      {r.code === "renforce" && "48 mois et 24 mois · R4624-28"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 style={{ fontSize: 15, marginTop: 22 }}>Visite d&apos;embauche</h3>
          <p style={{ fontSize: 13, margin: 0 }}>
            En suivi simple, la première visite est due{" "}
            <input
              type="number"
              min={1}
              value={params.embaucheMois}
              onChange={(e) => majParam("embaucheMois", Number(e.target.value) || 1)}
              style={styleNombre(params.embaucheMois > 3)}
            />{" "}
            mois après la prise de poste (<span className="muted">maximum 3 mois · R4624-10</span>). En
            suivi adapté ou renforcé, elle est due <strong>avant l&apos;affectation</strong>.
          </p>
        </div>
      )}

      {/* ------------------------------------------- DÉCLENCHEURS ---------- */}
      {onglet === "declencheurs" && (
        <>
          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Quarts de nuit</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Un quart coché « de nuit » fait passer en <strong>suivi adapté</strong> toutes les
              personnes qui le travaillent : celles des équipes à quart fixe sur ce quart, et
              celles de toutes les équipes tournantes si le quart fait partie du cycle de rotation.
              La colonne « heures de nuit » compte les heures du quart comprises entre{" "}
              {PLAGE_NUIT.debut} h et {PLAGE_NUIT.fin} h (L3122-2) ; à partir de {HEURES_NUIT_MIN} h,
              le quart relève de la définition légale.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Quart</th>
                  <th style={{ width: 150 }}>Horaires</th>
                  <th style={{ width: 160 }}>Heures de nuit</th>
                  <th style={{ width: 130 }}>Dans la rotation</th>
                  <th style={{ width: 120, textAlign: "center" }}>Quart de nuit</th>
                </tr>
              </thead>
              <tbody>
                {quarts.map((q) => {
                  const h = heuresDeNuit(q.debut, q.fin);
                  return (
                    <tr key={q.code}>
                      <td style={{ fontWeight: 600 }}>{q.libelle}</td>
                      <td className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {q.debut && q.fin ? `${q.debut.slice(0, 5)} – ${q.fin.slice(0, 5)}` : "—"}
                      </td>
                      <td>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: Math.round(h * 8),
                            height: 8,
                            borderRadius: 2,
                            background: h >= HEURES_NUIT_MIN ? "#4338ca" : "#cbd5e1",
                            marginRight: 8,
                            verticalAlign: "middle",
                          }}
                        />
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{h} h</span>
                      </td>
                      <td className="muted">{q.rotation ? "oui" : "non"}</td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={q.nuit}
                          onChange={(e) => {
                            const nuit = e.target.checked;
                            setQuarts((qs) => qs.map((x) => (x.code === q.code ? { ...x, nuit } : x)));
                            void post({ op: "quart.set", code: q.code, nuit });
                          }}
                          style={{ width: "auto" }}
                          aria-label={`${q.libelle} est un quart de nuit`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Postes à risques particuliers</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Un poste coché fait passer en <strong>suivi renforcé</strong> celui qui le tient :
              titulaire du poste, ou personne placée dessus au moins{" "}
              <input
                type="number"
                min={1}
                value={params.postePlacements}
                onChange={(e) => majParam("postePlacements", Number(e.target.value) || 1)}
                style={{ ...styleNombre(), width: 48 }}
              />{" "}
              fois sur les{" "}
              <input
                type="number"
                min={1}
                value={params.posteSemaines}
                onChange={(e) => majParam("posteSemaines", Number(e.target.value) || 1)}
                style={{ ...styleNombre(), width: 48 }}
              />{" "}
              dernières semaines. La liste complémentaire de l&apos;employeur exige l&apos;avis du
              médecin du travail et du CSE, et se transmet chaque année au service de prévention
              (R4624-23).
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Service · Ligne</th>
                  <th>Poste</th>
                  <th style={{ width: 110, textAlign: "center" }}>Suivi renforcé</th>
                  <th style={{ width: 330 }}>Motif réglementaire</th>
                  <th style={{ width: 200 }}>Attestation exigée</th>
                </tr>
              </thead>
              <tbody>
                {postes.map((p) => (
                  <tr key={p.id} style={{ opacity: p.suivi_renforce || p.anci_usage ? 1 : 0.75 }}>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {p.ligne?.atelier?.nom ?? "—"} · {p.ligne?.nom ?? "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>{p.nom}</td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={p.suivi_renforce}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setPostes((ps) => ps.map((x) => (x.id === p.id ? { ...x, suivi_renforce: v } : x)));
                          void post({ op: "poste.set", id: p.id, suivi_renforce: v });
                        }}
                        style={{ width: "auto" }}
                        aria-label={`${p.nom} à suivi renforcé`}
                      />
                    </td>
                    <td>
                      <select
                        value={p.suivi_motif ?? ""}
                        disabled={!p.suivi_renforce}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPostes((ps) => ps.map((x) => (x.id === p.id ? { ...x, suivi_motif: v || null } : x)));
                          void post({ op: "poste.set", id: p.id, suivi_motif: v });
                        }}
                        style={{ fontSize: 12.5, width: "100%" }}
                      >
                        <option value="">—</option>
                        {MOTIFS_SIR.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.libelle}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={p.anci_usage ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPostes((ps) => ps.map((x) => (x.id === p.id ? { ...x, anci_usage: v || null } : x)));
                          void post({ op: "poste.set", id: p.id, anci_usage: v });
                        }}
                        style={{ fontSize: 12.5, width: "100%" }}
                      >
                        <option value="">aucune</option>
                        {usagesActifs.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.libelle}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {postes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Aucun poste actif.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Habilitations</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Détenir l&apos;habilitation suffit à déclencher le régime, même sans poste coché.
              L&apos;<strong>attestation de non contre-indication</strong> est ce qui distingue deux
              visites simples : la conduite d&apos;engin et l&apos;habilitation électrique en exigent
              une, délivrée lors d&apos;une visite et valable jusqu&apos;à la visite suivante.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Groupe</th>
                  <th>Habilitation</th>
                  <th style={{ width: 110, textAlign: "center" }}>Suivi renforcé</th>
                  <th style={{ width: 220 }}>Attestation exigée</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.id}>
                    <td className="muted" style={{ fontSize: 12.5 }}>{c.groupe ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>{c.nom}</td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={c.suivi_renforce}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setComps((cs) => cs.map((x) => (x.id === c.id ? { ...x, suivi_renforce: v } : x)));
                          void post({ op: "competence.set", id: c.id, suivi_renforce: v });
                        }}
                        style={{ width: "auto" }}
                        aria-label={`${c.nom} à suivi renforcé`}
                      />
                    </td>
                    <td>
                      <select
                        value={c.anci_usage ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setComps((cs) => cs.map((x) => (x.id === c.id ? { ...x, anci_usage: v || null } : x)));
                          void post({ op: "competence.set", id: c.id, anci_usage: v });
                        }}
                        style={{ fontSize: 12.5, width: "100%" }}
                      >
                        <option value="">aucune</option>
                        {usagesActifs.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.libelle}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {comps.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">Aucune habilitation paramétrée.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Absences donnant lieu à une visite de reprise</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              La visite de reprise est due dès{" "}
              <input
                type="number"
                min={1}
                value={params.repriseJours}
                onChange={(e) => majParam("repriseJours", Number(e.target.value) || 1)}
                style={styleNombre()}
              />{" "}
              jours calendaires d&apos;absence continue sur l&apos;un des motifs cochés, et doit
              avoir lieu dans les{" "}
              <input
                type="number"
                min={1}
                value={params.repriseDelaiJours}
                onChange={(e) => majParam("repriseDelaiJours", Number(e.target.value) || 1)}
                style={styleNombre(params.repriseDelaiJours > 8)}
              />{" "}
              jours suivant le retour (R4624-31). Le Code du travail retient 60 jours pour une
              maladie ou un accident non professionnel, 30 jours pour un accident du travail, et
              toute durée pour une maladie professionnelle ou un congé de maternité : si vous
              distinguez ces motifs, cochez-les tous et laissez le seuil au plus court.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Code</th>
                  <th>Motif d&apos;absence</th>
                  <th style={{ width: 160, textAlign: "center" }}>Compte pour la reprise</th>
                </tr>
              </thead>
              <tbody>
                {motifs.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{m.code_court}</td>
                    <td style={{ fontWeight: 600 }}>{m.libelle}</td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={m.visite_reprise}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setMotifs((ms) => ms.map((x) => (x.id === m.id ? { ...x, visite_reprise: v } : x)));
                          void post({ op: "motif.set", id: m.id, visite_reprise: v });
                        }}
                        style={{ width: "auto" }}
                        aria-label={`${m.libelle} compte pour la visite de reprise`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* --------------------------------------------- CATALOGUE ---------- */}
      {onglet === "catalogue" && (
        <>
          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Types de visite</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Le libellé est libre ; c&apos;est la <strong>catégorie</strong> qui fixe le
              comportement. « Périodique » arme le compteur du régime, « intermédiaire » celui du
              suivi renforcé, « reprise » répond à une absence longue, « ponctuelle » n&apos;a aucune
              échéance (pré-reprise, visite à la demande, fin de carrière).
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th style={{ width: 190 }}>Catégorie</th>
                  <th style={{ width: 80 }}>N° aff.</th>
                  <th style={{ width: 70, textAlign: "center" }}>Actif</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {[...types]
                  .sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle))
                  .map((t) => (
                    <tr key={t.id} style={{ opacity: t.actif ? 1 : 0.5 }}>
                      <td>
                        <input
                          value={t.libelle}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTypes((ts) => ts.map((x) => (x.id === t.id ? { ...x, libelle: v } : x)));
                            differer(`type:${t.id}:libelle`, () => void post({ op: "type.update", id: t.id, patch: { libelle: v } }));
                          }}
                          style={{ width: "100%", fontSize: 13, padding: "3px 5px" }}
                        />
                      </td>
                      <td>
                        <select
                          value={t.categorie}
                          onChange={(e) => {
                            const v = e.target.value as CategorieVisite;
                            setTypes((ts) => ts.map((x) => (x.id === t.id ? { ...x, categorie: v } : x)));
                            void post({ op: "type.update", id: t.id, patch: { categorie: v } });
                          }}
                          style={{ width: "100%", fontSize: 12.5 }}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {LIBELLE_CATEGORIE[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={t.ordre}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setTypes((ts) => ts.map((x) => (x.id === t.id ? { ...x, ordre: v } : x)));
                            differer(`type:${t.id}:ordre`, () => void post({ op: "type.update", id: t.id, patch: { ordre: v } }));
                          }}
                          style={{ ...styleNombre(), width: 56 }}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <ToggleSwitch
                          on={t.actif}
                          onChange={(v) => {
                            setTypes((ts) => ts.map((x) => (x.id === t.id ? { ...x, actif: v } : x)));
                            void post({ op: "type.update", id: t.id, patch: { actif: v } });
                          }}
                          title="Actif / inactif"
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn-sm btn-ghost"
                          title="Supprimer"
                          style={{ color: "var(--danger)", margin: 0 }}
                          onClick={async () => {
                            if (!window.confirm(`Supprimer « ${t.libelle} » ?`)) return;
                            const r = await post({ op: "type.delete", id: t.id });
                            if (r) setTypes((ts) => ts.filter((x) => x.id !== t.id));
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn-sm btn-ghost"
                onClick={async () => {
                  const r = await post({ op: "type.create", categorie: "ponctuelle", libelle: "Nouvelle visite" });
                  if (r?.row) setTypes((ts) => [...ts, r.row as TypeRow]);
                }}
              >
                ＋ Ajouter un type de visite
              </button>
            </div>
          </div>

          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Attestations de non contre-indication</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Un usage relie une exigence à une délivrance : le poste ou l&apos;habilitation{" "}
              <strong>exige</strong> l&apos;attestation, la visite la <strong>délivre</strong>. Elle
              reste valable jusqu&apos;à la prochaine visite due de la personne. Supprimer un usage
              retire l&apos;exigence partout où elle était posée.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Usage</th>
                  <th style={{ width: 200 }}>Exigé par</th>
                  <th style={{ width: 80 }}>N° aff.</th>
                  <th style={{ width: 70, textAlign: "center" }}>Actif</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {[...usages]
                  .sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle))
                  .map((u) => {
                    const n = postes.filter((p) => p.anci_usage === u.code).length + comps.filter((c) => c.anci_usage === u.code).length;
                    return (
                      <tr key={u.id} style={{ opacity: u.actif ? 1 : 0.5 }}>
                        <td>
                          <input
                            value={u.libelle}
                            onChange={(e) => {
                              const v = e.target.value;
                              setUsages((us) => us.map((x) => (x.id === u.id ? { ...x, libelle: v } : x)));
                              differer(`usage:${u.id}`, () => void post({ op: "usage.update", id: u.id, patch: { libelle: v } }));
                            }}
                            style={{ width: "100%", fontSize: 13, padding: "3px 5px" }}
                          />
                        </td>
                        <td className="muted" style={{ fontSize: 12.5 }}>
                          {n === 0 ? "aucun poste ni habilitation" : `${n} poste(s) ou habilitation(s)`}
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            value={u.ordre}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setUsages((us) => us.map((x) => (x.id === u.id ? { ...x, ordre: v } : x)));
                              differer(`usage:${u.id}:ordre`, () => void post({ op: "usage.update", id: u.id, patch: { ordre: v } }));
                            }}
                            style={{ ...styleNombre(), width: 56 }}
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <ToggleSwitch
                            on={u.actif}
                            onChange={(v) => {
                              setUsages((us) => us.map((x) => (x.id === u.id ? { ...x, actif: v } : x)));
                              void post({ op: "usage.update", id: u.id, patch: { actif: v } });
                            }}
                            title="Actif / inactif"
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn-sm btn-ghost"
                            title="Supprimer"
                            style={{ color: "var(--danger)", margin: 0 }}
                            onClick={async () => {
                              if (!window.confirm(`Supprimer l'usage « ${u.libelle} » ?`)) return;
                              const r = await post({ op: "usage.delete", id: u.id });
                              if (r) setUsages((us) => us.filter((x) => x.id !== u.id));
                            }}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn-sm btn-ghost"
                onClick={async () => {
                  const r = await post({ op: "usage.create", libelle: "Nouvel usage" });
                  if (r?.row) setUsages((us) => [...us, r.row as UsageRow]);
                }}
              >
                ＋ Ajouter un usage
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Usages en place : {usagesActifs.map((u) => u.libelle).join(" · ") || "aucun"}.
            </p>
          </div>
        </>
      )}

      {/* ----------------------------------------------- ALERTES ---------- */}
      {onglet === "alertes" && (
        <>
          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Quand prévenir</h2>
            <table style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <td style={{ width: "60%" }}>Une échéance passe « à planifier »</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={params.alerteJours}
                      onChange={(e) => majParam("alerteJours", Number(e.target.value) || 1)}
                      style={styleNombre()}
                    />{" "}
                    jours avant son terme
                  </td>
                </tr>
                <tr>
                  <td>Arrivée d&apos;une personne soumise à une visite avant affectation</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={params.alerteArriveeJours}
                      onChange={(e) => majParam("alerteArriveeJours", Number(e.target.value) || 0)}
                      style={styleNombre()}
                    />{" "}
                    jours avant l&apos;arrivée
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card section">
            <h2 style={{ marginTop: 0 }}>Avertissement au Placement</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: "85ch" }}>
              Le module est réservé aux RH : personne d&apos;autre ne voit une date de visite ni un
              avis. Les cas cochés ci-dessous font toutefois apparaître, au Placement et au Planning,
              une demande de confirmation <strong>sans aucun détail</strong> — « à vérifier avec les
              RH ». Le placement reste possible après confirmation.
            </p>
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Cas</th>
                  <th style={{ width: 380 }}>Ce que voit le chef d&apos;équipe</th>
                  <th style={{ width: 90, textAlign: "center" }}>Avertir</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["alertePlacementContrainte", "Contrainte d'affectation", "« Contrainte d'affectation sur ce quart / ce poste. »"],
                    ["alertePlacementAnci", "Attestation de non contre-indication manquante", "« Point à vérifier avec les RH avant de placer. »"],
                    ["alertePlacementSir", "Aptitude échue sur un poste à risque", "« Point à vérifier avec les RH avant de placer. »"],
                    ["alertePlacementReprise", "Visite de reprise non enregistrée", "« Point à vérifier avec les RH avant de placer. »"],
                  ] as [keyof Parametres, string, string][]
                ).map(([cle, label, vu]) => (
                  <tr key={cle}>
                    <td style={{ fontWeight: 600 }}>{label}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{vu}</td>
                    <td style={{ textAlign: "center" }}>
                      <ToggleSwitch
                        on={params[cle] as boolean}
                        onChange={(v) => majParam(cle, v, true)}
                        title="Avertir au Placement"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12 }}>
              La contrainte d&apos;affectation ne porte jamais de motif : elle dit « pas ce quart »,
              jamais pourquoi. Les trois autres cas ne nomment même pas ce qui manque.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
