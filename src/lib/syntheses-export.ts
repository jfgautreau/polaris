// Exports PDF et Excel des « Synthèses hebdomadaires » (2026-10-20) — règles
// pures : mêmes données que l'écran, mises en forme pour `pdf.ts` / `xlsx.ts`.
// Construits dans le navigateur au clic (aucun aller-retour serveur).

import type { DocumentPdf, BlocPdf, CellulePdf } from "@/lib/pdf";
import type { FeuilleXlsx, CelluleXlsx } from "@/lib/xlsx";
import type { Absences4, GroupeAgence, LigneInterim } from "@/lib/synthese-data";
import { INTERIM_BG } from "@/lib/interim";

export type JourExport = { iso: string; nom: string; num: string };

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// Intérimaires sans aucune ligne au Planning de la semaine (cf. placeInterimaire).
export const LIBELLE_SANS_AFFECTATION = "Sans affectation cette semaine";
export const PRECISION_SANS_AFFECTATION = "aucune ligne au Planning cette semaine : ni poste, ni JNT, ni absence";

// Contenu d'une case intérim : horaire, poste, service — plusieurs affectations
// le même jour séparées par une ligne vide.
export function texteCaseInterim(p: LigneInterim, iso: string): string {
  return (p.cells[iso] ?? []).map((c) => [c.horaire, c.posteNom, c.atelierNom].filter(Boolean).join("\n")).join("\n\n");
}

export function edition(maintenant = new Date()): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `Polaris · édité le ${d(maintenant.getDate())}/${d(maintenant.getMonth() + 1)}/${maintenant.getFullYear()} à ${d(maintenant.getHours())}:${d(maintenant.getMinutes())}`;
}

// ── Vue Intérim ──────────────────────────────────────────────────────────────

export function pdfInterim(groupes: GroupeAgence[], jours: JourExport[], semaineLabel: string, maintenant?: Date): DocumentPdf {
  const blocs: BlocPdf[] = [];
  groupes.forEach((g, i) => {
    const sansAff = g.sansAffectation.length ? ` · ${g.sansAffectation.length} sans affectation` : "";
    blocs.push({ type: "titre", texte: `${g.agence} — ${pluriel(g.lignes.length, "placé")}${sansAff}`, nouvellePage: i > 0 });
    if (g.lignes.length) {
      blocs.push({
        type: "tableau",
        colonnes: [{ titre: "Intérimaire", largeur: 1.5 }, ...jours.map((j) => ({ titre: `${j.nom.slice(0, 3)} ${j.num}`, largeur: 1, align: "c" as const }))],
        lignes: g.lignes.map((p): CellulePdf[] => [
          { texte: `${p.nom} ${p.prenom}`, fond: INTERIM_BG, gras: true },
          ...jours.map((j) => texteCaseInterim(p, j.iso)),
        ]),
      });
    }
    if (g.sansAffectation.length) {
      blocs.push({ type: "texte", texte: `${LIBELLE_SANS_AFFECTATION} (${PRECISION_SANS_AFFECTATION}) : ${g.sansAffectation.map((p) => `${p.nom} ${p.prenom}`).join(", ")}.` });
    }
  });
  const agence = groupes.length === 1 ? ` · ${groupes[0].agence}` : "";
  return {
    titre: "Planning prévisionnel des intérimaires",
    sousTitre: `Semaine ${semaineLabel}${agence}`,
    edition: edition(maintenant),
    blocs,
  };
}

export function xlsxInterim(groupes: GroupeAgence[], jours: JourExport[], semaineLabel: string): FeuilleXlsx[] {
  const lignes: CelluleXlsx[][] = [];
  for (const g of groupes) {
    for (const p of g.lignes) {
      const cases = jours.map((j) => texteCaseInterim(p, j.iso));
      lignes.push([g.agence, p.nom, p.prenom, p.atelierNom === "—" ? "" : p.atelierNom, ...cases, cases.filter(Boolean).length, ""]);
    }
    // Sans affectation : la ligne reste (l'agence sait qui n'est pas appelé), jours vides.
    for (const p of g.sansAffectation) lignes.push([g.agence, p.nom, p.prenom, "", ...jours.map(() => ""), 0, LIBELLE_SANS_AFFECTATION]);
  }
  return [
    {
      nom: `Intérim ${semaineLabel.split(" ")[0]}`,
      colonnes: [
        { titre: "Agence", largeur: 18 },
        { titre: "Nom", largeur: 18 },
        { titre: "Prénom", largeur: 14 },
        { titre: "Service d'affectation", largeur: 18 },
        ...jours.map((j) => ({ titre: `${j.nom.slice(0, 3)} ${j.num}`, largeur: 20 })),
        { titre: "Jours placés", largeur: 12 },
        { titre: "Observation", largeur: 30 },
      ],
      lignes,
    },
  ];
}

// ── Vue Absences (4 semaines) ────────────────────────────────────────────────

export type ColonneAbsence = JourExport & { premierDeSemaine: boolean; weekNo: number };

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const jourCourt = (c: ColonneAbsence, i: number) => JOURS_COURTS[i % 5] ?? c.nom.slice(0, 3);

export function pdfAbsences(abs: Absences4, colonnes: ColonneAbsence[], rangeLabel: string, filtres: string, maintenant?: Date): DocumentPdf {
  const blocs: BlocPdf[] = [
    {
      type: "tableau",
      colonnes: [
        { titre: "Personne", largeur: 4.6 },
        ...colonnes.map((c, i) => ({ titre: `${c.premierDeSemaine ? `S${c.weekNo}` : " "}\n${jourCourt(c, i)}\n${c.num.slice(0, 2)}`, largeur: 1, align: "c" as const })),
        { titre: "Tot.", largeur: 1.1, align: "c" as const },
      ],
      lignes: abs.lignes.map((l): CellulePdf[] => [
        { texte: `${l.nom} ${l.prenom}\n${l.atelierNom}${l.equipeNom !== "—" ? ` · ${l.equipeNom}` : ""}` },
        ...colonnes.map((c): CellulePdf => {
          const cell = l.jours[c.iso];
          return cell ? { texte: cell.abbr, fond: cell.couleur ?? "#94a3b8", couleur: "#ffffff", gras: true } : "";
        }),
        { texte: String(l.total), gras: true },
      ]),
    },
    { type: "texte", texte: `Une case colorée = un jour d'absence (code du motif). ${pluriel(abs.lignes.length, "personne")} concernée${abs.lignes.length > 1 ? "s" : ""}.` },
    { type: "titre", texte: "Par motif" },
    {
      type: "tableau",
      colonnes: [{ titre: "Code", largeur: 1, align: "c" }, { titre: "Motif", largeur: 6 }, { titre: "Personnes", largeur: 1.5, align: "c" }, { titre: "Jours", largeur: 1.5, align: "c" }],
      lignes: abs.recap.map((m): CellulePdf[] => [
        { texte: m.abbr, fond: m.couleur ?? "#94a3b8", couleur: "#ffffff", gras: true },
        m.libelle,
        String(m.personnes),
        { texte: String(m.jours), gras: true },
      ]),
    },
  ];
  return {
    titre: "Absences à venir — 4 semaines (hors intérim)",
    sousTitre: `${rangeLabel}${filtres ? ` · ${filtres}` : ""}`,
    edition: edition(maintenant),
    blocs,
  };
}

export function xlsxAbsences(abs: Absences4, colonnes: ColonneAbsence[]): FeuilleXlsx[] {
  return [
    {
      nom: "Absences",
      colonnes: [
        { titre: "Nom", largeur: 18 },
        { titre: "Prénom", largeur: 14 },
        { titre: "Service", largeur: 16 },
        { titre: "Équipe", largeur: 10 },
        ...colonnes.map((c, i) => ({ titre: `${jourCourt(c, i)} ${c.num}`, largeur: 9 })),
        { titre: "Total jours", largeur: 11 },
      ],
      lignes: abs.lignes.map((l): CelluleXlsx[] => [
        l.nom,
        l.prenom,
        l.atelierNom === "—" ? "" : l.atelierNom,
        l.equipeNom === "—" ? "" : l.equipeNom,
        ...colonnes.map((c): CelluleXlsx => {
          const cell = l.jours[c.iso];
          return cell ? { texte: cell.abbr, fond: cell.couleur ?? "#94a3b8", gras: true } : null;
        }),
        l.total,
      ]),
    },
    {
      nom: "Par motif",
      colonnes: [{ titre: "Code", largeur: 8 }, { titre: "Motif", largeur: 30 }, { titre: "Personnes", largeur: 11 }, { titre: "Jours", largeur: 9 }],
      lignes: abs.recap.map((m): CelluleXlsx[] => [{ texte: m.abbr, fond: m.couleur ?? "#94a3b8", gras: true }, m.libelle, m.personnes, m.jours]),
    },
  ];
}
