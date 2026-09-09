import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { grouperAbsences, type JourAbsence } from "@/lib/absences-periodes";
import AbsencesEditor, { type PeriodeVue } from "./AbsencesEditor";

type Personne = { id: string; nom: string; prenom: string; atelier_id: string | null };
type Motif = { id: string; code_court: string; libelle: string; couleur: string };
type Atelier = { id: string; nom: string };

// Écran « Absences spécifiques » (menu Planning). Comme la modale Personnel, la
// liste est reconstruite à partir des JOURS d'absence (placement.motif_absence_id),
// et non de la seule table `absence` : la quasi-totalité des absences est posée
// jour par jour au planning sans période déclarée. On les regroupe en périodes
// (grouperAbsences) pour TOUT l'effectif.
//
// `?atelier=<id>` et `?search=<texte>` : filtres transmis depuis le Planning
// (bouton « 🤒 »). Servent de valeurs initiales aux filtres client de l'éditeur
// et sont renvoyés au Planning via le lien de retour, pour que le contexte de
// travail (recherche par nom, atelier filtré) soit préservé à l'aller-retour.
export default async function AbsencesSpecifiquesPage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; search?: string }>;
}) {
  const { profile } = await requireModule("planning", "read");
  const sp = await searchParams;
  const atelierInit = sp.atelier ?? "";
  const searchInit = sp.search ?? "";

  const supabase = await getServerClient();
  const [{ data: persData }, { data: motifData }, { data: ateliersData }, joursAll, { data: absData }] = await Promise.all([
    // Map des libellés : toutes les personnes (y compris parties) pour ne jamais
    // afficher « ? » sur une absence dont la personne a changé de statut.
    supabase.from("personne").select("id, nom, prenom, atelier_id").order("nom").returns<Personne[]>(),
    supabase.from("motif_absence").select("id, code_court, libelle, couleur").eq("actif", true).order("libelle").returns<Motif[]>(),
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Atelier[]>(),
    // Tous les jours d'absence, dédoublonnés par (personne, jour). fetchAll : la
    // table grandit et dépassera 1000 lignes (cf. CLAUDE.md L8).
    fetchAll<JourAbsence & { personne_id: string }>(() =>
      supabase
        .from("placement")
        .select("personne_id, jour, motif_absence_id, absence_id")
        .not("motif_absence_id", "is", null)
        .order("personne_id")
        .order("jour")
        .returns<(JourAbsence & { personne_id: string })[]>()
    ),
    // Commentaires des absences déclarées, indexés par id.
    supabase.from("absence").select("id, commentaire").returns<{ id: string; commentaire: string | null }[]>(),
  ]);

  const personnes = persData ?? [];
  const motifs = motifData ?? [];
  const ateliers = ateliersData ?? [];
  const persById = new Map((persData ?? []).map((p) => [p.id, p]));
  const commentaires = new Map((absData ?? []).map((a) => [a.id, a.commentaire ?? ""]));

  // Regroupement par personne, puis grouperAbsences sur ses jours.
  const parPersonne = new Map<string, JourAbsence[]>();
  for (const j of joursAll) {
    (parPersonne.get(j.personne_id) ?? parPersonne.set(j.personne_id, []).get(j.personne_id)!).push(j);
  }

  const periodes: PeriodeVue[] = [];
  for (const [pid, jours] of parPersonne) {
    const p = persById.get(pid);
    const label = p ? `${p.nom} ${p.prenom}` : "?";
    for (const per of grouperAbsences(jours)) {
      periodes.push({
        key: `${pid}:${per.debut}:${per.motif_absence_id ?? "?"}`,
        personne_id: pid,
        label,
        atelier_id: p?.atelier_id ?? null,
        motif_absence_id: per.motif_absence_id ?? "",
        debut: per.debut,
        fin: per.fin,
        jours: per.jours,
        absence_id: per.absence_id,
        commentaire: per.absence_id ? commentaires.get(per.absence_id) ?? "" : "",
        declaree: per.declaree,
      });
    }
  }
  // Plus récentes d'abord (sur la date de début).
  periodes.sort((a, b) => b.debut.localeCompare(a.debut) || a.label.localeCompare(b.label));

  return (
    <>
      <AppHeader role={profile.role} active="/planning" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Absences spécifiques</h1>
          {/* Retour au Planning en préservant les filtres transmis à l'aller. */}
          <Link
            href={
              (() => {
                const p = new URLSearchParams();
                if (atelierInit) p.set("atelier", atelierInit);
                if (searchInit) p.set("search", searchInit);
                const qs = p.toString();
                return qs ? `/planning?${qs}` : "/planning";
              })()
            }
            className="navlink"
          >
            &larr; Planning
          </Link>
        </div>
        <p className="muted" style={{ marginBottom: 16 }}>
          Toutes les absences de l&apos;effectif, reconstruites à partir des jours posés au planning
          (une période déclarée <strong>ou</strong> des jours saisis un à un). Filtrez par nom,
          atelier ou période. Le crayon modifie, la corbeille libère les jours.
        </p>
        <AbsencesEditor
          personnes={personnes}
          motifs={motifs}
          ateliers={ateliers}
          initial={periodes}
          atelierInit={atelierInit}
          nomInit={searchInit}
        />
      </div>
    </>
  );
}
