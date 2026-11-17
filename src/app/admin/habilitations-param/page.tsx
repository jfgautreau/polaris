import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule , canWrite } from "@/lib/permissions";
import HabilitationsParamEditor from "./HabilitationsParamEditor";

type Row = {
  id: string;
  nom: string;
  categorie: string | null;
  groupe: string | null;
  duree_validite_mois: number | null;
  a_autorisation_conduite: boolean;
  ordre: number;
  actif: boolean;
};

export default async function HabilitationsParamPage() {
  const { profile, perms } = await requireModule("habilitations_param", "read");

  const supabase = await getServerClient();
  const { data } = await supabase
    .from("competence")
    .select("id, nom, categorie, groupe, duree_validite_mois, a_autorisation_conduite, ordre, actif")
    .eq("a_recycler", true)
    .order("nom")
    .returns<Row[]>();

  return (
    <>
      <AppHeader role={profile.role} active="/admin/habilitations-param" />
      <div className="container" style={{ maxWidth: 1200 }}>
        <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>📜 Param. Habilitation</h1>
          <Link href="/habilitations" className="navlink">&larr; Habilitations</Link>
        </div>
        <p className="muted" style={{ marginBottom: 16 }}>
          Définition des formations réglementaires et internes à suivre (recyclage). Organisées
          par <strong>catégorie</strong> puis <strong>groupe</strong>. Le suivi par personne se
          fait dans le module <strong>Habilitations</strong>.
        </p>
        <HabilitationsParamEditor initial={data ?? []} lecture={!canWrite(perms, "habilitations_param")} />
      </div>
    </>
  );
}
