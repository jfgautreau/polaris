"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { addDays, isoDate } from "@/lib/week";

// Barre d'actions de l'ecran TV : choix de la semaine affichee, impression PDF
// et retour a l'application. Masquee a l'impression (`noprint`).
//
// Impression (2026-09-15, refonte) : on n'ecrase plus tout le planning sur UNE
// page A3 (rognait la derniere ligne des services denses). On imprime en A3
// PORTRAIT, les colonnes ajustees a la LARGEUR de la feuille (`table width:100%`),
// et le contenu COULE sur plusieurs pages : chaque rangee reste entiere
// (`break-inside: avoid` sur les `tr`) et l'en-tete des jours se repete en haut
// de chaque page (`thead { display: table-header-group }`). Plus de mise a
// l'echelle mesuree — le navigateur pagine tout seul.

// Gabarit commun aux commandes : le bouton porte une bordure, le logo n'en a pas.
const TAILLE = 42;

function jjmm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export default function AffichageBarre({
  cadreId,
  contenuId,
  pivotIso,
  debutIso,
  finIso,
  estCourant,
}: {
  cadreId: string;
  contenuId: string;
  pivotIso: string;
  debutIso: string;
  finIso: string;
  estCourant: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Navigation de semaine : `?date` deplace le pivot de la fenetre d'affichage
  // (cf. joursDeFenetre). ± 7 jours = semaine precedente / suivante ; « cette
  // semaine » retire le parametre (retour au pivot = aujourd'hui).
  const pivot = new Date(pivotIso + "T00:00");
  const allerA = (iso: string | null) =>
    router.push(iso ? `${pathname}?date=${iso}` : pathname);

  return (
    <>
      {/* Regles d'impression propres a cet ecran. Le @page global est en A4
          paysage ; declare ici APRES, celui-ci l'emporte. Le cadre ne borne plus
          la hauteur a une page : le contenu coule sur plusieurs feuilles. */}
      <style>{`
        @media print {
          @page { size: A3 portrait; margin: 10mm; }
          #${cadreId} { width: auto !important; height: auto !important; overflow: visible !important; padding: 0 !important; }
          #${contenuId} { transform: none !important; width: auto !important; }
          #${cadreId} table { page-break-inside: auto; }
          #${cadreId} thead { display: table-header-group; }
          #${cadreId} tr { break-inside: avoid; page-break-inside: avoid; }
          #${cadreId} section { break-inside: auto; }
        }
      `}</style>

      <div className="noprint" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Selecteur de semaine : precedente / periode affichee / suivante. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => allerA(isoDate(addDays(pivot, -7)))}
            title="Semaine précédente"
            aria-label="Semaine précédente"
            style={btnFleche}
          >
            &lsaquo;
          </button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2, minWidth: 120 }}>
            <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>
              {jjmm(debutIso)} → {jjmm(finIso)}
            </span>
            {estCourant ? (
              <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Semaine en cours</span>
            ) : (
              <button
                type="button"
                onClick={() => allerA(null)}
                style={{ width: "auto", margin: 0, padding: 0, border: "none", background: "transparent", color: "#1d4ed8", fontSize: 11, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
              >
                Revenir à cette semaine
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => allerA(isoDate(addDays(pivot, 7)))}
            title="Semaine suivante"
            aria-label="Semaine suivante"
            style={btnFleche}
          >
            &rsaquo;
          </button>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          title="Imprimer / enregistrer en PDF (A3 portrait, plusieurs pages si besoin)"
          aria-label="Imprimer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Meme gabarit que le logo Polaris a cote.
            width: TAILLE,
            height: TAILLE,
            padding: 0,
            margin: 0,
            // Fond clair : la couleur doit etre posee explicitement, le style
            // global des boutons impose du blanc (cf. CLAUDE.md).
            background: "#fff",
            color: "#1d4ed8",
            border: "1px solid var(--border)",
            borderRadius: 9,
            cursor: "pointer",
          }}
        >
          {/* Imprimante : capot, corps, feuille qui sort. */}
          <svg viewBox="0 0 24 24" width={Math.round(TAILLE * 0.62)} height={Math.round(TAILLE * 0.62)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 9V3h10v6" />
            <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
            <rect x="7" y="15" width="10" height="6" rx="1" />
          </svg>
        </button>

        <Link
          href="/"
          title="Revenir à Polaris"
          aria-label="Revenir à l'application"
          style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
        >
          <Logo size={TAILLE} id="affichage" />
        </Link>
      </div>
    </>
  );
}

const btnFleche: React.CSSProperties = {
  width: 34,
  height: 34,
  padding: 0,
  margin: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1,
  background: "#fff",
  color: "#1d4ed8",
  border: "1px solid var(--border)",
  borderRadius: 9,
  cursor: "pointer",
};
