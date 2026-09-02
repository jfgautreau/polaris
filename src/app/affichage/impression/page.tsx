import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";
import { getQuartsC } from "@/lib/refdata";
import { joursAutour, parseJour } from "@/lib/week";
import { getFenetreAffichage } from "@/lib/parametres";
import AtelierPlanning from "../atelier/[atelier]/AtelierPlanning";
import ImpressionAuto from "./ImpressionAuto";

export const dynamic = "force-dynamic";

// Impression « tous les plannings » (version affichage TV) : une page A3 par
// atelier. Ouverte depuis le bouton imprimante du Planning ; l'impression se
// lance automatiquement (ImpressionAuto). Route publique comme le reste de
// /affichage, mais résolue au site courant (impersonation-aware).
export default async function ImpressionTousLesPlannings({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const { jours_avant, jours_apres } = await getFenetreAffichage();
  const days = joursAutour(parseJour(sp.date), jours_avant, jours_apres);

  const site = await getCurrentSite();
  const quarts = await getQuartsC();

  const admin = getAdminClient();
  // Ateliers du site AYANT au moins une ligne active avec un poste actif : sinon
  // une page A3 blanche par atelier vide. Bornés au site (service_role).
  const { data: ateliersD } = await admin
    .from("atelier")
    .select("id, nom")
    .eq("site_id", site.id)
    .order("nom")
    .returns<{ id: string; nom: string }[]>();
  const { data: lignesD } = await admin
    .from("ligne")
    .select("atelier_id, actif, poste(actif)")
    .eq("site_id", site.id)
    .eq("actif", true)
    .returns<{ atelier_id: string; actif: boolean; poste: { actif: boolean }[] }[]>();
  const atelierAvecContenu = new Set<string>();
  for (const l of lignesD ?? []) {
    if ((l.poste ?? []).some((p) => p.actif)) atelierAvecContenu.add(l.atelier_id);
  }
  const ateliers = (ateliersD ?? []).filter((a) => atelierAvecContenu.has(a.id));

  return (
    <div>
      <ImpressionAuto />

      {/* Une page A3 verticale par atelier. `break-after: page` sépare les
          feuilles ; la mise à l'échelle de chaque contenu est mesurée côté
          client par ImpressionAuto (comme l'écran TV). */}
      <style>{`
        @media print {
          @page { size: A3 portrait; margin: 8mm; }
        }
        .atelier-page { padding: 18px 24px; }
        @media print {
          .atelier-page { width: 1060px; height: 1525px; overflow: hidden; padding: 0; break-after: page; }
          .atelier-page:last-child { break-after: auto; }
        }
      `}</style>

      {ateliers.length === 0 ? (
        <p className="muted" style={{ padding: 24 }}>
          Aucun atelier avec des lignes actives à imprimer.
        </p>
      ) : (
        ateliers.map((a) => (
          <section key={a.id} className="atelier-page">
            <div className="atelier-contenu" style={{ transformOrigin: "top left" }}>
              <AtelierPlanning atelierRef={a.id} site={site} quarts={quarts} days={days} />
            </div>
          </section>
        ))
      )}
    </div>
  );
}
