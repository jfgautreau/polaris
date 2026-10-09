import { getAdminClient } from "@/lib/supabase-server";
import { requireModule } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";
import SelectionServices from "./SelectionServices";

// Index des affichages couloir. Reserve aux droits "affichage". Deux usages :
//   - cocher plusieurs services et les imprimer d'un coup (/affichage/impression) ;
//   - ouvrir l'ecran TV d'UN service (lien par service), pour les ecrans de couloir.
export const dynamic = "force-dynamic";

type Atelier = { id: string; nom: string };

export default async function AffichageIndex() {
  await requireModule("affichage", "read");
  const site = await getCurrentSite();
  const admin = getAdminClient();
  // MULTI-SITE : borne par site_id (service_role bypass la RLS).
  const { data } = await admin
    .from("atelier")
    .select("id, nom")
    .eq("actif", true)
    .eq("site_id", site.id)
    .order("ordre_affichage").order("nom")
    .returns<Atelier[]>();
  const ateliers = data ?? [];

  return (
    <div className="container">
      <h1>Affichage couloir</h1>
      <p className="muted">Cochez les services à imprimer ensemble, ou ouvrez l&apos;écran TV d&apos;un service.</p>
      <div className="card">
        <SelectionServices ateliers={ateliers} />
      </div>
    </div>
  );
}
