"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import { FillIcon } from "@/components/icons";

type Jour = { iso: string; nom: string; num: string; firstOfWeek?: boolean };
type Item = { id: string; label: string };
type Quart = { code: string; libelle: string };
type WeekBlock = { num: number; year: number; span: number };
type Profil = { id: string; nom: string; par_defaut: boolean };

const FIRST_W = 240; // assez large pour « Support · Sécurité / Environnement » (34 car.)
const DAY_W = 34;

export default function OrdoGrid({
  days,
  weekBlocks = [],
  todayIso,
  currentWeekIsos = [],
  quarts,
  linesByQuart,
  jourQuartState,
  ouvertureState,
  profils = [],
  canEdit = true,
}: {
  days: Jour[];
  weekBlocks?: WeekBlock[];
  todayIso: string;
  currentWeekIsos?: string[];
  quarts: Quart[];
  linesByQuart: Record<string, Item[]>;
  jourQuartState: Record<string, boolean>;
  ouvertureState: Record<string, boolean>;
  profils?: Profil[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [jq, setJq] = useState<Record<string, boolean>>(jourQuartState);
  const [ov, setOv] = useState<Record<string, boolean>>(ouvertureState);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Semaine en cours d'initialisation -> modale de choix du profil.
  const [initIsos, setInitIsos] = useState<string[] | null>(null);
  // Fermeture bloquee par des affectations -> modale « fermer quand meme ».
  const [conflit, setConflit] = useState<{
    affectes: { nom: string; prenom: string }[];
    body: object;
    reapply: () => void;
    rollback: () => void;
    quart: boolean; // quart (true) ou ligne (false), pour le libelle
  } | null>(null);
  // Re-initialisation bloquee par des affectations -> modale « reinitialiser quand meme ».
  const [conflitReset, setConflitReset] = useState<{
    affectes: { nom: string; prenom: string }[];
    isos: string[];
    profilId?: string;
  } | null>(null);

  // Plus de remplissage par defaut : un jour sans ligne explicite est FERME.
  // La semaine type ne s'applique qu'a l'initialisation (bouton), donc modifier
  // la semaine type ensuite n'est pas retroactif sur les semaines deja initialisees.
  const quartActif = (code: string, iso: string) => jq[`${code}:${iso}`] ?? false;

  // Un jour est "initialise" s'il porte au moins une ligne jour_quart explicite.
  const dayInitialized = (iso: string) => quarts.some((q) => `${q.code}:${iso}` in jq);

  // ISO de chaque bloc-semaine (pour le bouton "Initialiser").
  const blockIsos: string[][] = [];
  {
    let idx = 0;
    for (const w of weekBlocks) {
      blockIsos.push(days.slice(idx, idx + w.span).map((d) => d.iso));
      idx += w.span;
    }
  }

  // Clic sur "Initialiser" -> confirmation si deja initialisee, puis modale profil.
  function resetWeek(isos: string[]) {
    if (!canEdit || !isos.length) return;
    const dejaInit = isos.some((iso) => dayInitialized(iso));
    if (dejaInit && !window.confirm("Cette semaine est déjà initialisée. La ré-initialiser (écraser) avec un profil de semaine type ?")) return;
    setInitIsos(isos);
  }

  // Applique un profil a la semaine choisie ; le serveur renvoie l'instantané.
  // `force` : réinitialise QUAND MÊME en retirant les affectations en conflit.
  async function applyProfil(isos: string[], profilId?: string, force = false) {
    setInitIsos(null);
    setSaving(true);
    setErreur(null);
    try {
      const res = await fetch("/api/ordonnancement/reset-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isos, profil_id: profilId, force }),
      });
      if (res.status === 409) {
        // Affectations existantes : proposer « réinitialiser quand même ».
        const jc = (await res.json().catch(() => ({}))) as { conflit?: boolean; affectes?: { nom: string; prenom: string }[]; error?: string };
        if (jc.conflit && Array.isArray(jc.affectes)) {
          setConflitReset({ affectes: jc.affectes, isos, profilId });
        } else {
          setErreur(jc.error ?? "Échec.");
        }
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { jq?: Record<string, boolean>; fermetures?: string[]; error?: string };
      if (res.ok) {
        const set = new Set(isos);
        setJq((s) => ({ ...s, ...(j.jq ?? {}) }));
        setOv((s) => {
          const n = { ...s };
          for (const k of Object.keys(n)) if (set.has(k.slice(-10))) delete n[k]; // efface les surcharges de la semaine
          for (const key of j.fermetures ?? []) n[key] = false;
          return n;
        });
        // Invalide le cache RSC : sans ca, une navigation « menu autre puis
        // retour » servait la page mise en cache AVANT l'initialisation, et
        // l'ecran redemarrait vide alors que la base etait bien ecrite.
        router.refresh();
      } else {
        setErreur(j.error ?? "Échec.");
      }
    } finally {
      setSaving(false);
    }
  }
  // Apres initialisation : ligne ouverte par defaut (absence) tant que le quart
  // est actif ; les fermetures explicites portent une ligne ouverture_quart=false.
  const ligneOuverte = (code: string, lg: string, iso: string) =>
    quartActif(code, iso) ? (ov[`${code}:${lg}:${iso}`] ?? true) : false;

  // `reapply` : ré-applique l'état optimiste (utile après un rollback si l'on
  // reprend l'action en `force`). `quart` : type d'élément fermé, pour le libellé
  // de la modale de conflit.
  async function post(body: object, rollback: () => void, reapply: () => void, quart: boolean) {
    setSaving(true);
    setErreur(null);
    try {
      const res = await fetch("/api/ordonnancement/quart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        // Fermeture bloquee par des affectations. Deux formes de reponse :
        //   { conflit, affectes } -> proposition « fermer quand meme » ;
        //   { error }             -> ancien mur (repli).
        const j = (await res.json().catch(() => ({}))) as { conflit?: boolean; affectes?: { nom: string; prenom: string }[]; error?: string };
        rollback();
        if (j.conflit && Array.isArray(j.affectes)) {
          setConflit({ affectes: j.affectes, body, reapply, rollback, quart });
        } else {
          setErreur(j.error ?? "Échec.");
        }
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        rollback();
        setErreur(j.error ?? "Échec.");
        return;
      }
      // Meme raison qu'apres applyProfil : invalide le cache RSC pour
      // qu'un aller-retour de menu revoie l'etat frais depuis la base.
      router.refresh();
    } finally {
      setSaving(false);
    }
  }
  // Rejoue la fermeture en `force` : le serveur retire les affectations puis ferme.
  async function forcerFermeture() {
    const c = conflit;
    setConflit(null);
    if (!c) return;
    c.reapply();
    await post({ ...c.body, force: true }, c.rollback, c.reapply, c.quart);
  }
  function toggleQuart(code: string, iso: string) {
    if (!canEdit) return;
    const prev = quartActif(code, iso);
    const next = !prev;
    const cle = `${code}:${iso}`;
    const apply = () => setJq((s) => ({ ...s, [cle]: next }));
    const rollback = () => setJq((s) => ({ ...s, [cle]: prev }));
    apply();
    post({ type: "quart", quart_code: code, jour: iso, value: next }, rollback, apply, true);
  }
  function toggleLigne(code: string, lg: string, iso: string) {
    if (!canEdit || !quartActif(code, iso)) return;
    const prev = ligneOuverte(code, lg, iso);
    const next = !prev;
    const cle = `${code}:${lg}:${iso}`;
    const apply = () => setOv((s) => ({ ...s, [cle]: next }));
    const rollback = () => setOv((s) => ({ ...s, [cle]: prev }));
    apply();
    post({ type: "ligne", quart_code: code, ligne_id: lg, jour: iso, value: next }, rollback, apply, false);
  }

  const sep = (d: Jour) => (d.firstOfWeek ? { borderLeft: "2px solid #cbd5e1" } : {});
  const currentSet = new Set(currentWeekIsos);
  const currentBlockIdx = blockIsos.findIndex((isos) => isos.some((iso) => currentSet.has(iso)));
  const dayBg = (iso: string) =>
    iso === todayIso ? "#dbeafe" : currentSet.has(iso) ? "#eff6ff" : undefined;

  const tableStyle: React.CSSProperties = {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    width: "100%",
    minWidth: FIRST_W + days.length * DAY_W,
  };

  const Header = ({ label, showReset = false }: { label: string; showReset?: boolean }) => (
    <thead>
      {weekBlocks.length > 0 && (
        <tr>
          <th style={{ width: FIRST_W }}></th>
          {weekBlocks.map((w, i) => {
            const isCurrent = i === currentBlockIdx;
            return (
            <th
              key={i}
              colSpan={w.span}
              style={{
                textAlign: "center",
                fontSize: 12,
                borderLeft: "2px solid #cbd5e1",
                background: isCurrent ? "#dbeafe" : "#f8fafc",
                fontWeight: isCurrent ? 700 : undefined,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {w.year} · S{w.num}
                {isCurrent && <span className="muted" style={{ fontWeight: 400 }}>(en cours)</span>}
                {showReset && canEdit && (
                  <button
                    type="button"
                    className="btn-sm btn-ghost"
                    onClick={() => resetWeek(blockIsos[i] ?? [])}
                    title="Initialiser cette semaine avec la semaine type (ré-applique / écrase si déjà fait)"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px", fontSize: 12, lineHeight: 1.2 }}
                  >
                    <FillIcon size={13} /> Initialiser
                  </button>
                )}
              </span>
            </th>
            );
          })}
        </tr>
      )}
      <tr>
        <th style={{ width: FIRST_W, textAlign: "left" }}>{label}</th>
        {days.map((d) => (
          <th key={d.iso} style={{ textAlign: "center", ...sep(d), background: dayBg(d.iso) }}>
            {d.nom.slice(0, 2)}
            <br />
            <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>{d.num}</span>
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="gridband scroll">
      {erreur && (
        <div role="alert" style={{ margin: "0 0 10px", padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", fontSize: 13, fontWeight: 600 }}>
          {erreur}
          <button type="button" onClick={() => setErreur(null)} style={{ float: "right", background: "transparent", border: "none", color: "#991b1b", cursor: "pointer", fontSize: 14, width: "auto", margin: 0, padding: 0 }}>✕</button>
        </div>
      )}
      <div className="card section" style={{ overflowX: "auto" }}>
        <h2 style={{ marginTop: 0 }}>
          Quarts actifs par jour {saving && <span className="muted" style={{ fontSize: 12 }}>· enregistrement…</span>}
        </h2>
        <table className="matrix rowh" style={tableStyle}>
          <Header label="Quart" showReset />
          <tbody>
            {quarts.map((q) => (
              <tr key={q.code}>
                <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{q.libelle}</td>
                {days.map((d) => {
                  const on = quartActif(q.code, d.iso);
                  const init = dayInitialized(d.iso);
                  return (
                    <td key={d.iso} style={{ textAlign: "center", background: on ? undefined : init ? "#fee2e2" : "#f1f5f9", ...sep(d) }}>
                      <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggleQuart(q.code, d.iso)} style={{ width: "auto", cursor: canEdit ? "pointer" : "default" }} title={init ? undefined : "Semaine non initialisée"} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>Lignes ouvertes par quart</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Rien n&apos;est rempli par défaut : utilisez <strong>« ⚙️ Initialiser »</strong>{" "}
        en haut d&apos;une semaine pour appliquer la semaine type. Une fois initialisée, désactiver un quart ferme et verrouille ses lignes ce jour-là.
        Modifier la semaine type ensuite n&apos;affecte pas les semaines déjà initialisées (ré-initialisez pour écraser).
      </p>
      {quarts.map((q) => {
        const qLignes = linesByQuart[q.code] ?? [];
        return (
          <div key={q.code} className="card section" style={{ overflowX: "auto" }}>
            <h2 style={{ marginTop: 0 }}>{q.libelle}</h2>
            <table className="matrix rowh" style={tableStyle}>
              <Header label="Ligne" />
              <tbody>
                {qLignes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{l.label}</td>
                    {days.map((d) => {
                      const active = quartActif(q.code, d.iso);
                      const on = ligneOuverte(q.code, l.id, d.iso);
                      return (
                        <td key={d.iso} style={{ textAlign: "center", background: !active ? "#f1f5f9" : on ? undefined : "#fee2e2", ...sep(d) }}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canEdit || !active}
                            onChange={() => toggleLigne(q.code, l.id, d.iso)}
                            style={{ width: "auto", cursor: canEdit && active ? "pointer" : "not-allowed" }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {qLignes.length === 0 && (
                  <tr>
                    <td colSpan={days.length + 1} className="muted">Aucune ligne activée sur ce quart (référentiel).</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      {quarts.length === 0 && <p className="muted">Aucun quart configuré.</p>}

      {/* Modale : choix du profil de semaine type à appliquer. */}
      {initIsos && (
        <ModaleDeplacable onClose={() => setInitIsos(null)} largeur={460}>
            <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
              <h2 style={{ margin: 0 }}>Initialiser — choisir un profil</h2>
              <button type="button" className="btn-sm btn-ghost" onClick={() => setInitIsos(null)} style={{ width: "auto" }}>✕</button>
            </div>
            {profils.length === 0 ? (
              <>
                <p className="muted">Aucun profil de semaine type défini.</p>
                <button type="button" className="btn-sm" style={{ width: "auto" }} onClick={() => applyProfil(initIsos)}>Appliquer le défaut</button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {profils.map((p) => (
                  <button key={p.id} type="button" className="btn-sm" style={{ width: "auto", textAlign: "left" }} onClick={() => applyProfil(initIsos, p.id)}>
                    {p.nom}{p.par_defaut ? "  · par défaut" : ""}
                  </button>
                ))}
              </div>
            )}
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              La semaine sélectionnée sera (ré)initialisée avec le profil choisi.
            </p>
        </ModaleDeplacable>
      )}

      {/* Fermeture bloquee par des affectations : proposer de fermer quand meme. */}
      {conflit && (
        <ModaleDeplacable onClose={() => setConflit(null)} largeur={460}>
          <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
            <h2 style={{ margin: 0, color: "#b45309" }}>⚠ {conflit.quart ? "Quart occupé" : "Ligne occupée"}</h2>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setConflit(null)} style={{ width: "auto" }}>✕</button>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            {conflit.affectes.length === 1 ? "Une personne est affectée" : `${conflit.affectes.length} personnes sont affectées`}{" "}
            sur {conflit.quart ? "ce quart" : "cette ligne"} ce jour-là. Fermer{" "}
            {conflit.quart ? "le quart" : "la ligne"} retirera {conflit.affectes.length === 1 ? "son affectation" : "leurs affectations"} (les absences sont conservées) :
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13, maxHeight: 220, overflowY: "auto" }}>
            {conflit.affectes.map((p, i) => (
              <li key={i}>{p.nom} {p.prenom}</li>
            ))}
          </ul>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={() => setConflit(null)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn-sm"
              style={{ width: "auto", background: "#b45309", border: "1px solid #b45309" }}
              onClick={forcerFermeture}
            >
              Fermer quand même et retirer
            </button>
          </div>
        </ModaleDeplacable>
      )}

      {/* Re-initialisation bloquee par des affectations : proposer de forcer. */}
      {conflitReset && (
        <ModaleDeplacable onClose={() => setConflitReset(null)} largeur={480}>
          <div className="toolbar mdd-drag" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "grab" }}>
            <h2 style={{ margin: 0, color: "#b45309" }}>⚠ Semaine occupée</h2>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setConflitReset(null)} style={{ width: "auto" }}>✕</button>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            {conflitReset.affectes.length === 1 ? "Une personne est affectée" : `${conflitReset.affectes.length} personnes sont affectées`}{" "}
            sur cette semaine. La réinitialiser retirera {conflitReset.affectes.length === 1 ? "son affectation" : "leurs affectations"} sur poste (les absences sont conservées) :
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 13, maxHeight: 220, overflowY: "auto" }}>
            {conflitReset.affectes.map((p, i) => (
              <li key={i}>{p.nom} {p.prenom}</li>
            ))}
          </ul>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn-sm btn-ghost" style={{ width: "auto" }} onClick={() => setConflitReset(null)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn-sm"
              style={{ width: "auto", background: "#b45309", border: "1px solid #b45309" }}
              onClick={() => {
                const c = conflitReset;
                setConflitReset(null);
                if (c) applyProfil(c.isos, c.profilId, true);
              }}
            >
              Réinitialiser quand même et retirer
            </button>
          </div>
        </ModaleDeplacable>
      )}
    </div>
  );
}
