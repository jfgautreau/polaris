import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import { getAteliersC, getLignesPostesC } from "@/lib/refdata";
import { couleurDeLigne } from "@/lib/ligne-couleurs";
import type { MiseEnPage, PdfPlacement, Bloc } from "@/lib/mise-en-page-pdf";
import MiseEnPageEditor, { type ServiceEd } from "./MiseEnPageEditor";

// Écran « Mise en page PDF » (droit dédié `placement_pdf`, 0094) : une mise en
// page par service et par PDF du Placement. Les postes proposés sont ceux que
// les PDF impriment (actifs, « Impr. » coché au Référentiel).
export default async function MiseEnPagePdfPage() {
  const { profile, perms } = await requireModule("placement_pdf", "read");
  const supabase = await getServerClient();
  const [ateliers, lignes, { data: mepD }] = await Promise.all([
    getAteliersC(),
    getLignesPostesC(),
    // RLS : les mises en page du site courant.
    supabase
      .from("placement_mise_en_page")
      .select("atelier_id, pdf, format, orientation, blocs")
      .returns<{ atelier_id: string; pdf: PdfPlacement; format: MiseEnPage["format"]; orientation: MiseEnPage["orientation"]; blocs: Bloc[] }[]>(),
  ]);

  const ordre = <T extends { ordre_affichage: number; nom: string }>(a: T, b: T) => (a.ordre_affichage ?? 0) - (b.ordre_affichage ?? 0) || a.nom.localeCompare(b.nom);
  const services: ServiceEd[] = ateliers.map((a) => ({
    id: a.id,
    nom: a.nom,
    lignes: lignes
      .filter((l) => l.atelier_id === a.id && l.actif)
      .sort(ordre)
      .map((l, i) => ({
        id: l.id,
        nom: l.nom,
        couleur: couleurDeLigne(l.couleur, i).lc,
        postes: [...(l.poste ?? [])].filter((p) => p.actif && p.imprimable).sort(ordre).map((p) => ({ id: p.id, nom: p.nom })),
      }))
      .filter((l) => l.postes.length > 0),
  }));
  const initial: Record<string, MiseEnPage> = {};
  for (const m of mepD ?? []) initial[`${m.atelier_id}:${m.pdf}`] = { format: m.format, orientation: m.orientation, blocs: m.blocs ?? [] };
  const canEdit = canWrite(perms, "placement_pdf");

  return (
    <>
      <AppHeader role={profile.role} active="/admin/mise-en-page-pdf" />
      <div className="container" style={{ maxWidth: 1240 }}>
        <h1>Mise en page des PDF de placement</h1>
        <p className="muted" style={{ marginBottom: 12 }}>
          Une mise en page par service et par PDF (Manager, pour Affich., pour Affich. + heures), en A4 ou A3, paysage ou
          portrait. Glissez les blocs de la colonne de gauche sur la grille de 12 × 12 cases, déplacez-les par leur bandeau
          et agrandissez-les par leur coin. Dans une ligne, l&apos;ordre des postes se change au glisser-déposer. Sans mise en page
          enregistrée, le PDF garde sa disposition automatique. <strong>Pensez à enregistrer.</strong>
        </p>
        {/* Lecture seule sans <LectureSeule> : on doit pouvoir parcourir les services
            et les PDF ; seuls l’enregistrement et le glisser-déposer sont fermés. */}
        <MiseEnPageEditor services={services} initial={initial} canEdit={canEdit} />
      </div>
    </>
  );
}
