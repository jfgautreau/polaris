import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { lireParametres, REGIMES_DEFAUT, type Regime } from "@/lib/visites";
import VisitesParamEditor, {
  type QuartRow,
  type PosteRow,
  type CompRow,
  type MotifRow,
  type TypeRow,
  type UsageRow,
} from "./VisitesParamEditor";

// Paramétrage du module Visites médicales — écran des RH.
//
// Tout ce qui DÉCLENCHE une visite se règle ici : quarts de nuit, postes à
// risques particuliers, habilitations, motifs d'absence, plafonds de
// périodicité, seuils d'alerte. Volontairement séparé de « Param. RH »
// (/admin/motifs) : ce sont deux métiers, et mélanger les deux écrans rendrait
// chacun illisible.
export default async function VisitesParamPage() {
  const { profile, perms } = await requireModule("visites_param", "read");
  const supabase = await getServerClient();
  const siteId = profile.siteId;

  const [paramsRes, regimesRes, typesRes, usagesRes, quartsRes, postesRes, compsRes, motifsRes] = await Promise.all([
    supabase.from("visite_parametre").select("cle, valeur").eq("site_id", siteId).returns<{ cle: string; valeur: string }[]>(),
    supabase
      .from("visite_regime")
      .select("code, libelle, mois_renouvellement, mois_intermediaire, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<{ code: string; libelle: string; mois_renouvellement: number; mois_intermediaire: number | null; ordre: number }[]>(),
    supabase
      .from("visite_type")
      .select("id, code, libelle, categorie, actif, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<TypeRow[]>(),
    supabase
      .from("visite_anci_usage")
      .select("id, code, libelle, actif, ordre")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<UsageRow[]>(),
    supabase
      .from("quart")
      .select("code, libelle, ordre, debut, fin, rotation, nuit")
      .eq("site_id", siteId)
      .order("ordre")
      .returns<QuartRow[]>(),
    supabase
      .from("poste")
      .select("id, nom, actif, suivi_renforce, suivi_motif, anci_usage, ligne:ligne_id(nom, atelier:atelier_id(nom))")
      .eq("site_id", siteId)
      .eq("actif", true)
      .order("nom")
      .returns<PosteRow[]>(),
    supabase
      .from("competence")
      .select("id, nom, groupe, suivi_renforce, anci_usage, a_autorisation_conduite")
      .eq("site_id", siteId)
      .eq("a_recycler", true)
      .eq("actif", true)
      .order("nom")
      .returns<CompRow[]>(),
    supabase
      .from("motif_absence")
      .select("id, libelle, code_court, visite_reprise")
      .eq("site_id", siteId)
      .eq("actif", true)
      .order("libelle")
      .returns<MotifRow[]>(),
  ]);

  const params = lireParametres(paramsRes.data);
  const regimes: Regime[] = REGIMES_DEFAUT.map((def) => {
    const r = (regimesRes.data ?? []).find((x) => x.code === def.code);
    return r ? { code: def.code, libelle: r.libelle, mois: r.mois_renouvellement, moisInter: r.mois_intermediaire } : def;
  });

  return (
    <>
      <AppHeader role={profile.role} active="/admin/visites-param" />
      <div className="container" style={{ maxWidth: 1240 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Param. Visites médicales</h1>
          <Link href="/visites" className="navlink">&larr; Visites médicales</Link>
        </div>
        <p className="muted" style={{ marginBottom: 16, maxWidth: "80ch" }}>
          Ce que vous réglez ici décide, pour chaque personne, du <strong>régime de suivi</strong> et
          de la <strong>date de la prochaine visite</strong>. Rien n&apos;est saisi personne par
          personne : Polaris déduit le régime des quarts, des postes tenus et des habilitations
          détenues. Enregistrement automatique.
        </p>
        <LectureSeule actif={!canWrite(perms, "visites_param")}>
          <VisitesParamEditor
            params={params}
            regimes={regimes}
            types={typesRes.data ?? []}
            usages={usagesRes.data ?? []}
            quarts={quartsRes.data ?? []}
            postes={postesRes.data ?? []}
            comps={compsRes.data ?? []}
            motifs={motifsRes.data ?? []}
          />
        </LectureSeule>
      </div>
    </>
  );
}
