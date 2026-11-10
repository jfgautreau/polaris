// Exports PDF et Excel des « Synthèses hebdomadaires » (2026-10-20) — règles
// pures : mêmes données que l'écran, mises en forme pour `pdf.ts` / `xlsx.ts`.
// Construits dans le navigateur au clic (aucun aller-retour serveur).

import type { DocumentPdf, BlocPdf, CellulePdf } from "@/lib/pdf";
import type { FeuilleXlsx, CelluleXlsx } from "@/lib/xlsx";
import type { Absences4, GroupeAgence, InterimDispo, LigneInterim } from "@/lib/synthese-data";
import { INTERIM_BG } from "@/lib/interim";
import { couleurDeService } from "@/lib/service-couleurs";
import { NOM_APPLICATION_DEFAUT } from "@/lib/nom-application";

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

// `nomApp` : nom de l'application du site (0095), défaut « Polaris ».
export function edition(maintenant = new Date(), nomApp = NOM_APPLICATION_DEFAUT): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `${nomApp} · édité le ${d(maintenant.getDate())}/${d(maintenant.getMonth() + 1)}/${maintenant.getFullYear()} à ${d(maintenant.getHours())}:${d(maintenant.getMinutes())}`;
}

// ── Vue Intérim ──────────────────────────────────────────────────────────────

export function pdfInterim(groupes: GroupeAgence[], jours: JourExport[], semaineLabel: string, maintenant?: Date, nomApp?: string): DocumentPdf {
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
    edition: edition(maintenant, nomApp),
    blocs,
  };
}

// ── Excel intérim (2026-11-05) ───────────────────────────────────────────────
// Case du jour SANS le poste : horaire + service, sur fond de la couleur pastel
// du service (atelier.couleur, choisie au Référentiel). Plus de colonne « Service
// d'affectation » (elle pouvait contredire les affectations de la semaine).
// Excel d'UNE agence : comparé à la « photo » de sa dernière extraction pour la
// même semaine (export_interim_photo, /api/syntheses/extraction-interim) — les
// cases qui ont changé passent en jaune fluo, un intérimaire retiré reste en bas,
// barré.

export const JAUNE_FLUO = "#ffff00";
export const LIBELLE_RETIRE = "Retiré depuis l'extraction précédente";

export function texteCaseExcel(p: LigneInterim, iso: string): string {
  return (p.cells[iso] ?? [])
    .map((c) => [c.horaire, c.atelierNom === "—" ? "" : c.atelierNom].filter(Boolean).join("\n"))
    .join("\n\n");
}

// Photo d'une extraction : ce que l'agence a reçu, par personne (sans nom).
export type PhotoLigne = { cases: Record<string, string>; jours: number; obs: string };
export type PhotoInterim = { v: 1; lignes: Record<string, PhotoLigne> };

export function photoInterim(g: GroupeAgence, jours: JourExport[]): PhotoInterim {
  const lignes: Record<string, PhotoLigne> = {};
  for (const p of g.lignes) {
    const cases: Record<string, string> = {};
    for (const j of jours) {
      const t = texteCaseExcel(p, j.iso);
      if (t) cases[j.iso] = t;
    }
    lignes[p.personneId] = { cases, jours: jours.filter((j) => (p.cells[j.iso] ?? []).length > 0).length, obs: "" };
  }
  for (const p of g.sansAffectation) lignes[p.personneId] = { cases: {}, jours: 0, obs: LIBELLE_SANS_AFFECTATION };
  return { v: 1, lignes };
}

// Comparaison d'une agence : `precedente` = photo de la dernière extraction
// (null : première extraction de la semaine) ; `retires` = personnes de la photo
// absentes de l'extraction, noms relus par la route.
export type ComparaisonInterim =
  | { etat: "ok"; precedente: { le: string; photo: PhotoInterim } | null; retires: InterimDispo[] }
  | { etat: "indisponible" };

const fr2 = (n: number) => String(n).padStart(2, "0");
const dateHeure = (d: Date) => `${fr2(d.getDate())}/${fr2(d.getMonth() + 1)}/${d.getFullYear()} à ${fr2(d.getHours())}:${fr2(d.getMinutes())}`;

export function xlsxInterim(
  groupes: GroupeAgence[],
  jours: JourExport[],
  semaineLabel: string,
  opts: { maintenant?: Date; comparaison?: ComparaisonInterim } = {},
): FeuilleXlsx[] {
  const maintenant = opts.maintenant ?? new Date();
  const comp = opts.comparaison?.etat === "ok" ? opts.comparaison : null;
  const avant = comp?.precedente?.photo.lignes ?? null; // null = rien à comparer
  const uneAgence = groupes.length === 1;

  // Jours affichés : du lundi au vendredi toujours, le week-end seulement s'il
  // porte quelque chose (aujourd'hui ou dans la photo) — le tableau tient mieux
  // sur une feuille.
  const occupe = (iso: string) =>
    groupes.some((g) => g.lignes.some((p) => (p.cells[iso] ?? []).length > 0)) ||
    (!!avant && Object.values(avant).some((l) => !!l.cases[iso]));
  const joursX = jours.filter((j, i) => i < 5 || occupe(j.iso));

  const surligne = (texte: string, change: boolean, fond?: string | null, extra: { barre?: boolean } = {}): CelluleXlsx => {
    if (change) return { texte, fond: JAUNE_FLUO, ...extra };
    if (fond && texte) return { texte, fond, ...extra };
    return extra.barre ? { texte, barre: true } : texte;
  };
  const nombre = (n: number, change: boolean): CelluleXlsx => (change ? { texte: String(n), fond: JAUNE_FLUO } : n);

  const lignes: CelluleXlsx[][] = [];
  for (const g of groupes) {
    const col0: CelluleXlsx[] = uneAgence ? [] : [g.agence];
    for (const p of g.lignes) {
      const prec = avant ? avant[p.personneId] : undefined;
      const nouveau = !!avant && !prec;
      const cases = joursX.map((j) => texteCaseExcel(p, j.iso));
      const nb = jours.filter((j) => (p.cells[j.iso] ?? []).length > 0).length;
      lignes.push([
        ...col0,
        surligne(p.nom, nouveau),
        surligne(p.prenom, nouveau),
        ...cases.map((t, i) => {
          const iso = joursX[i].iso;
          const change = !!avant && (nouveau ? !!t : (prec?.cases[iso] ?? "") !== t);
          return surligne(t, change, couleurDeService(p.cells[iso]?.[0]?.atelierCouleur)?.code);
        }),
        nombre(nb, !!avant && (nouveau || prec?.jours !== nb)),
        surligne("", !!avant && !nouveau && (prec?.obs ?? "") !== ""),
      ]);
    }
    // Sans affectation : la ligne reste (l'agence sait qui n'est pas appelé), jours vides.
    for (const p of g.sansAffectation) {
      const prec = avant ? avant[p.personneId] : undefined;
      const nouveau = !!avant && !prec;
      lignes.push([
        ...col0,
        surligne(p.nom, nouveau),
        surligne(p.prenom, nouveau),
        ...joursX.map((j) => surligne("", !!avant && !nouveau && (prec?.cases[j.iso] ?? "") !== "")),
        nombre(0, !!avant && (nouveau || prec?.jours !== 0)),
        surligne(LIBELLE_SANS_AFFECTATION, !!avant && prec?.obs !== LIBELLE_SANS_AFFECTATION),
      ]);
    }
    // Retirés depuis l'extraction précédente : barrés, en jaune fluo, avec ce
    // qu'ils avaient reçu (pour que l'agence sache quoi annuler).
    if (uneAgence && avant && comp) {
      for (const r of comp.retires) {
        const prec = avant[r.personneId];
        lignes.push([
          { texte: r.nom, fond: JAUNE_FLUO, barre: true },
          { texte: r.prenom, fond: JAUNE_FLUO, barre: true },
          ...joursX.map((j): CelluleXlsx => (prec?.cases[j.iso] ? { texte: prec.cases[j.iso], fond: JAUNE_FLUO, barre: true } : null)),
          { texte: "0", fond: JAUNE_FLUO },
          { texte: LIBELLE_RETIRE, fond: JAUNE_FLUO },
        ]);
      }
    }
  }

  const sem = semaineLabel.split(" ")[0];
  const titres = [
    `Planning prévisionnel des intérimaires — ${uneAgence ? `${groupes[0].agence} — ` : ""}Semaine ${semaineLabel}`,
    `Extrait le ${dateHeure(maintenant)}`,
  ];
  if (opts.comparaison?.etat === "indisponible") titres.push("Comparaison avec l'extraction précédente indisponible : aucune case surlignée.");
  else if (comp && comp.precedente) titres.push(`Cases en jaune fluo : modifiées depuis l'extraction du ${dateHeure(new Date(comp.precedente.le))}.`);
  else if (comp) titres.push("Première extraction de cette agence pour cette semaine : rien à comparer.");
  titres.push(""); // ligne vide avant l'en-tête

  return [
    {
      nom: `Intérim ${sem}`,
      titres,
      colonnes: [
        ...(uneAgence ? [] : [{ titre: "Agence", largeur: 16 }]),
        { titre: "Nom", largeur: 16 },
        { titre: "Prénom", largeur: 13 },
        ...joursX.map((j) => ({ titre: `${j.nom.slice(0, 3)} ${j.num}`, largeur: 15 })),
        { titre: "Jours placés", largeur: 9 },
        { titre: "Observation", largeur: 24 },
      ],
      lignes,
    },
  ];
}

// ── Vue Absences (4 semaines) ────────────────────────────────────────────────

export type ColonneAbsence = JourExport & { premierDeSemaine: boolean; weekNo: number };

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const jourCourt = (c: ColonneAbsence, i: number) => JOURS_COURTS[i % 5] ?? c.nom.slice(0, 3);

export function pdfAbsences(abs: Absences4, colonnes: ColonneAbsence[], rangeLabel: string, filtres: string, maintenant?: Date, nomApp?: string): DocumentPdf {
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
    edition: edition(maintenant, nomApp),
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
