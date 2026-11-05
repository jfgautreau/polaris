import { getAdminClient } from "@/lib/supabase-server";
import { requireModule } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";
import Link from "next/link";
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
      {/* Écran sans menu : retour à l'accueil de Polaris sans le bouton
          Précédent du navigateur (2026-11-05). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1>Affichage couloir</h1>
        <Link
          href="/"
          prefetch={false}
          title="Revenir à l'accueil de Polaris"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "#fff",
            color: "#1d4ed8",
            border: "1px solid var(--border)",
            borderRadius: 9,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>&lsaquo;</span> Retour à Polaris
        </Link>
      </div>
      <p className="muted">Cochez les services à imprimer ensemble, ou ouvrez l&apos;écran TV d&apos;un service.</p>
      <div className="card">
        <SelectionServices ateliers={ateliers} />
      </div>
    </div>
  );
}
