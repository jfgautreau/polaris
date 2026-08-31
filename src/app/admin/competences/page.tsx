import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { getServerClient } from "@/lib/supabase-server";
import { getNbNiveauxC, getSeuilCompetentC, getCouleursNiveauxC } from "@/lib/refdata";
import { couleursNiveau } from "@/lib/couleurs-niveau";
import EchelleForm from "./EchelleForm";
import BandeauErreur from "@/components/BandeauErreur";

type Niveau = { niveau: number; libelle: string };

export default async function CompetencesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const sp = await searchParams;
  const { profile, perms } = await requireModule("competences", "read");

  const supabase = await getServerClient();
  const [{ data: niveauxData }, nbNiveaux, seuilCompetent, couleursCustom] = await Promise.all([
    supabase
      .from("competence_niveau_libelle")
      .select("niveau, libelle")
      .order("niveau")
      .returns<Niveau[]>(),
    getNbNiveauxC(),
    getSeuilCompetentC(),
    getCouleursNiveauxC(),
  ]);

  const niveaux = niveauxData ?? [];
  const couleurs = couleursNiveau(couleursCustom);

  return (
    <>
      <AppHeader role={profile.role} active="/admin/competences" />
      <div className="container">
        <h1>Compétences</h1>
        <BandeauErreur message={sp.err} />
        <LectureSeule actif={!canWrite(perms, "competences")}>

        {/* Echelle de niveaux */}
        <div className="card section">
          <h2>Échelle de niveaux (carré magique)</h2>
          <p className="muted">
            Nombre de niveaux activés et libellés paramétrables, propres à ce site.
          </p>
          <EchelleForm niveaux={niveaux} nbNiveaux={nbNiveaux} seuilCompetent={seuilCompetent} couleurs={couleurs} />
        </div>
        </LectureSeule>
      </div>
    </>
  );
}
