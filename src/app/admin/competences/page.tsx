import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { getServerClient } from "@/lib/supabase-server";
import { getNbNiveauxC, getSeuilCompetentC } from "@/lib/refdata";
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
  const [{ data: niveauxData }, nbNiveaux, seuilCompetent] = await Promise.all([
    supabase
      .from("competence_niveau_libelle")
      .select("niveau, libelle")
      .order("niveau")
      .returns<Niveau[]>(),
    getNbNiveauxC(),
    getSeuilCompetentC(),
  ]);

  const niveaux = niveauxData ?? [];

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
          <EchelleForm niveaux={niveaux} nbNiveaux={nbNiveaux} seuilCompetent={seuilCompetent} />
        </div>
        </LectureSeule>
      </div>
    </>
  );
}
