import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-server";
import { requireModule } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";

// Index des affichages couloir (un par atelier). Reserve aux droits "affichage".
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
    .order("nom")
    .returns<Atelier[]>();
  const ateliers = data ?? [];

  return (
    <div className="container">
      <h1>Affichage couloir</h1>
      <p className="muted">Choisissez un service pour afficher son placement du jour.</p>
      <div className="card">
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ateliers.map((a) => (
            <li key={a.id} style={{ marginBottom: 8 }}>
              <Link href={`/affichage/atelier/${a.id}`} prefetch={false} style={{ fontSize: 18 }}>
                {a.nom} &rarr;
              </Link>
            </li>
          ))}
          {ateliers.length === 0 && <li className="muted">Aucun service.</li>}
        </ul>
      </div>
    </div>
  );
}
