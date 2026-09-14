"use client";

import { useEffect, useState } from "react";
import PeriodesEditor, { type RefletContrat } from "./PeriodesEditor";
import ModaleDeplacable from "@/components/ModaleDeplacable";
import {
  statutALaDate,
  libelleStatut,
  couleurStatut,
  deriverArriveeDepart,
  contratCouvreLe,
  type StatutPersonne,
} from "@/lib/personne-statut";

// Modale « Cycle de vie » — refonte 0050.
//
// Il n'y a plus qu'UNE source de verite : la liste des contrats. Les anciennes
// dates d'arrivee et de depart prevu, jusqu'ici saisies a part sur la personne,
// sont maintenant DERIVEES :
//   • arrivee = plus ancien contrat_periode.date_debut ;
//   • depart  = plus recent contrat_periode.date_fin, uniquement si aucun
//     contrat n'est ouvert (pas de CDI en cours).
//   • motif de depart = motif_fin du contrat le plus recent.
//
// Un encart de synthese en tete affiche ces valeurs derivees et le statut
// resultant. Le tableau des contrats laisse editer type / dates / motifs /
// commentaire pour chaque periode ; ajouter un contrat gere une bascule
// Interim -> CDD -> CDI sans discontinuite.

type Personne = {
  id: string;
  label: string;
  date_arrivee: string | null;
  date_depart_prevu: string | null;
  motif_depart: string | null;
  statut: string;
};

type Sync = {
  date_arrivee?: string | null;
  date_depart_prevu?: string | null;
  motif_depart?: string | null;
  statut?: string;
  type_contrat?: string;
  date_fin?: string | null;
  contrat_debut?: string | null;
};

export default function CycleDeVieModal({
  personne,
  canEdit,
  onClose,
  onSync,
}: {
  personne: Personne;
  canEdit: boolean;
  onClose: () => void;
  onSync: (s: Sync) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [periodes, setPeriodes] = useState<
    { date_debut: string | null; date_fin: string | null; motif_fin: string | null }[]
  >([]);

  // Rafraichissement de la liste locale de contrats : sert a la synthese
  // (dates derivees) et a la detection des trous. Rechargee a chaque
  // modification (via onSyncPeriode ci-dessous).
  const chargerPeriodes = () =>
    fetch("/api/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "periode-list", personne_id: personne.id }),
    })
      .then((r) => r.json())
      .then((j) => setPeriodes(j.rows ?? []))
      .catch(() => {});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "periode-list", personne_id: personne.id }),
    })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPeriodes(j.rows ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [personne.id]);

  // ---- Derivations ----
  const derives = deriverArriveeDepart(periodes);
  const statutCalc: StatutPersonne = statutALaDate(derives, today);
  const c = couleurStatut(statutCalc);
  const trous = detecterTrous(periodes, derives.date_arrivee, derives.date_depart_prevu);
  // Motif du depart = motif_fin du contrat le plus recent qui en porte un.
  const motifDepart = motifDuDernierContrat(periodes);

  function onSyncPeriode(reflet: RefletContrat) {
    chargerPeriodes();
    // Le trigger DB (0050) a deja mis a jour personne.statut. On propage au
    // parent le reflet type_contrat / date_fin / contrat_debut, et on lui
    // annonce les dates DERIVEES pour qu'il n'ait pas a re-fetcher.
    onSync({
      type_contrat: reflet.type_contrat,
      date_fin: reflet.date_fin,
      contrat_debut: reflet.contrat_debut,
      date_arrivee: reflet.contrat_debut,
      // Le reflet ne porte pas date_depart_prevu ; on ne le renseigne que si
      // la liste locale a deja bouge (rare, souvent une iteration en retard).
    });
  }

  return (
    <ModaleDeplacable onClose={onClose} largeur={1100}>
      {/* En-tete : nom + statut resultant */}
      <div className="mdd-drag" style={{ cursor: "move" }}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Cycle de vie — {personne.label}</h2>
            <span
              style={{
                background: c.bg,
                color: c.fg,
                fontWeight: 600,
                fontSize: 13,
                padding: "3px 10px",
                borderRadius: 999,
              }}
              title={`Statut calculé : ${libelleStatut(statutCalc)}`}
            >
              {libelleStatut(statutCalc)}
            </span>
          </div>
          <button type="button" className="btn-sm btn-ghost" onClick={onClose} style={{ width: "auto" }}>✕</button>
        </div>
      </div>

      {/* ---------- Encart SYNTHESE (derive, non editable) ---------- */}
      <section style={{ margin: "0 0 12px", padding: "10px 14px", background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontSize: 13.5 }}>
          <span title="Date d'entrée dans l'effectif — début du 1er contrat">
            <strong>Arrivée</strong>&nbsp;
            {derives.date_arrivee
              ? <span>{fmt(derives.date_arrivee)}</span>
              : <span style={{ color: "var(--muted)" }}>—</span>}
          </span>
          <span style={{ color: "var(--rule)" }}>·</span>
          <span title="Date de sortie prévue — fin du dernier contrat, si aucun contrat ouvert">
            <strong>Départ prévu</strong>&nbsp;
            {derives.date_depart_prevu
              ? <span>{fmt(derives.date_depart_prevu)}{motifDepart ? ` (${motifDepart})` : ""}</span>
              : <span style={{ color: "var(--muted)" }}>aucun</span>}
          </span>
          <span style={{ color: "var(--rule)" }}>·</span>
          {derives.date_arrivee && derives.date_arrivee > today && (
            <span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              Bascule Actif le {fmt(derives.date_arrivee)}
            </span>
          )}
          {derives.date_depart_prevu && derives.date_depart_prevu >= today && (
            <span style={{ background: "#fef3c7", color: "#b45309", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              Bascule Parti le {fmtLendemain(derives.date_depart_prevu)}
            </span>
          )}
          {derives.date_depart_prevu && derives.date_depart_prevu < today && (
            <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              Statut basculé Parti
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>
          Ces dates sont <strong>dérivées</strong> des contrats ci-dessous. Modifier un contrat les met à jour automatiquement.
        </div>
      </section>

      {/* ---------- Bloc CONTRATS (source de verite) ---------- */}
      {trous.length > 0 && (
        <div style={{ background: "#fef3c7", color: "#78350f", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", fontSize: 13, marginBottom: 10 }}>
          ⚠ <strong>Trou de contrat :</strong>{" "}
          {trous.map((t, i) => (
            <span key={i}>
              {i > 0 ? ", " : ""}
              {fmt(t.debut)} → {fmt(t.fin)} ({t.jours}&nbsp;j)
            </span>
          ))}
          . La personne ne sera pas visible au planning ces jours-là.
        </div>
      )}
      <PeriodesEditor personneId={personne.id} bare onSync={onSyncPeriode} />
    </ModaleDeplacable>
  );
}

// ---------- Utilitaires locaux ----------

function motifDuDernierContrat(periodes: { date_debut: string | null; motif_fin?: string | null }[]): string | null {
  if (!periodes.length) return null;
  const trie = [...periodes].sort((a, b) => {
    const da = a.date_debut ?? "";
    const db = b.date_debut ?? "";
    return db.localeCompare(da);
  });
  return trie[0]?.motif_fin ?? null;
}

function detecterTrous(
  contrats: { date_debut: string | null; date_fin: string | null }[],
  arrivee: string | null,
  depart: string | null,
) {
  if (!contrats.length || !arrivee) return [];
  const tries = [...contrats]
    .filter((c) => c.date_debut)
    .sort((a, b) => (a.date_debut ?? "").localeCompare(b.date_debut ?? ""));
  const fin = depart ?? new Date().toISOString().slice(0, 10);

  const trous: { debut: string; fin: string; jours: number }[] = [];
  let curseur = arrivee;
  for (const c of tries) {
    if ((c.date_debut ?? "") > curseur) {
      const veille = decale(c.date_debut!, -1);
      if (curseur <= veille && curseur <= fin && !contratCouvreLe(contrats, curseur)) {
        trous.push({ debut: curseur, fin: veille < fin ? veille : fin, jours: Math.max(1, ecart(curseur, veille < fin ? veille : fin) + 1) });
      }
    }
    if (c.date_fin) curseur = decale(c.date_fin, 1);
    else return trous; // CDI ouvert : plus de trou possible
  }
  if (curseur <= fin && !contratCouvreLe(contrats, fin)) {
    trous.push({ debut: curseur, fin, jours: Math.max(1, ecart(curseur, fin) + 1) });
  }
  return trous;
}

function decale(iso: string, jours: number): string {
  const d = new Date(iso + "T00:00");
  // Une date invalide (ex. faute de frappe sur l'annee : "262026-08-30")
  // ferait lever RangeError a toISOString() et planterait tout le rendu de
  // la modale. On la laisse telle quelle plutot que de faire tomber l'ecran.
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

function ecart(a: string, b: string): number {
  const ms = new Date(b + "T00:00").getTime() - new Date(a + "T00:00").getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.round(ms / 86_400_000);
}

function fmt(iso: string): string {
  if (!iso) return "";
  return iso.split("-").reverse().join("/");
}

function fmtLendemain(iso: string): string {
  return fmt(decale(iso, 1));
}
