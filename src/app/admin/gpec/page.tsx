import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import BandeauErreur from "@/components/BandeauErreur";
import LectureSeule from "@/components/LectureSeule";
import { requireModule, canWrite } from "@/lib/permissions";
import { lireAnnee } from "@/lib/gpec";
import { chargerGpec, type Gpec } from "@/lib/gpec-data";
import GpecEditor from "./GpecEditor";

// Hypothèses de la projection des effectifs (GPEC, 0097) : ce que
// l'application ne sait pas déjà — volumes et capacités des lignes, quarts
// ouverts par palier, congés et modulation, absentéisme subi, départs prévus.
// Tout le reste (postes, effectif par quart, titulaires, niveaux) est lu dans
// le Référentiel, le Personnel et la Matrice.
export default async function GpecParamPage({ searchParams }: { searchParams: Promise<{ annee?: string }> }) {
  const { profile, perms } = await requireModule("gpec", "read");
  const sp = await searchParams;
  const annee = lireAnnee(sp.annee, new Date());

  let g: Gpec | null = null;
  let erreur = "";
  try {
    g = await chargerGpec(await getServerClient(), profile.siteId, annee);
  } catch (e) {
    erreur = e instanceof Error ? e.message : "Lecture impossible.";
  }

  return (
    <>
      <AppHeader role={profile.role} active="/admin/gpec" />
      <div className="container" style={{ maxWidth: 1240 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Param. GPEC — hypothèses {annee}</h1>
          <Link href={`/bilans/projection-effectifs?annee=${annee}`} className="navlink" prefetch={false}>
            Projection des effectifs &rarr;
          </Link>
        </div>
        <p className="muted" style={{ marginBottom: 16, maxWidth: "90ch" }}>
          Seules les hypothèses de l&apos;année se saisissent ici. Les postes, l&apos;effectif par quart, les titulaires
          (poste fixe) et les niveaux viennent du Référentiel, du Personnel et de la Matrice : rien n&apos;est ressaisi.
          Enregistrement automatique en quittant chaque case.
        </p>
        {!g ? (
          <BandeauErreur message={`Les hypothèses ne peuvent pas être lues (${erreur}). La migration 0097 a-t-elle été exécutée ?`} />
        ) : (
          <LectureSeule actif={!canWrite(perms, "gpec")}>
            <GpecEditor
              key={annee}
              annee={annee}
              hyp={g.hyp}
              capas={g.capas.map((c) => ({ id: c.id, nom: c.nom, capaciteJour: c.capaciteJour, volumeAnnuel: c.volumeAnnuel, volumesMois: c.volumesMois, lignes: c.lignes, paliers: c.paliers }))}
              quarts={g.quarts}
              subi={g.subi.map((s) => ({ atelierId: s.atelierId, nom: s.nom, effectif: s.effectif }))}
              joursSubisParMotif={g.joursSubisParMotif}
              motifs={g.motifsNonPlanifies}
              lignesRef={g.lignesRef}
              postesRef={g.postesRef}
              personnesRef={g.personnesRef}
              departs={g.departs}
            />
          </LectureSeule>
        )}
      </div>
    </>
  );
}
