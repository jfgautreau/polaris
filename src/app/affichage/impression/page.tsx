import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentSite } from "@/lib/current-site";
import { getQuartsC } from "@/lib/refdata";
import { parseJour } from "@/lib/week";
import { getFenetreAffichage, joursDeFenetre } from "@/lib/parametres";
import AtelierPlanning from "../atelier/[atelier]/AtelierPlanning";
import ImpressionAuto from "./ImpressionAuto";

export const dynamic = "force-dynamic";

// Impression des plannings (version affichage TV) : chaque atelier commence sur
// une nouvelle feuille A3 portrait.
// Ouverte depuis /affichage, où l'on coche les services (`?atelier=…` répété) ;
// sans `atelier`, tous les services ayant du contenu. L'impression se lance
// automatiquement (ImpressionAuto). Route publique comme le reste de /affichage,
// mais résolue au site courant (impersonation-aware).
export default async function ImpressionTousLesPlannings({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; atelier?: string | string[] }>;
}) {
  const sp = await searchParams;
  const fen = await getFenetreAffichage();
  const days = joursDeFenetre(fen, parseJour(sp.date));

  const site = await getCurrentSite();
  const quarts = await getQuartsC();

  const admin = getAdminClient();
  // Ateliers du site AYANT au moins une ligne active avec un poste actif : sinon
  // une page A3 blanche par atelier vide. Bornés au site (service_role).
  const { data: ateliersD } = await admin
    .from("atelier")
    .select("id, nom")
    .eq("site_id", site.id)
    .order("ordre_affichage").order("nom")
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
  // Services cochés : les identifiants venus de l'URL ne servent qu'à FILTRER la
  // liste du site (jamais lus tels quels) — un id d'un autre site est ignoré.
  const choisis = new Set([sp.atelier ?? []].flat().filter(Boolean));
  const ateliers = (ateliersD ?? []).filter(
    (a) => atelierAvecContenu.has(a.id) && (choisis.size === 0 || choisis.has(a.id)),
  );

  return (
    <div>
      <ImpressionAuto />

      {/* Mêmes règles que l'écran TV (AffichageBarre, 2026-09-15) : colonnes à la
          LARGEUR de la feuille (`table width:100%`), contenu qui COULE sur
          plusieurs pages si besoin, rangées jamais coupées, en-tête des jours
          répété. Chaque atelier commence sur une nouvelle feuille. Jusqu'au
          2026-10-08 : une échelle commune mesurée, imposée par l'atelier le plus
          dense, rétrécissait toutes les pages bien en deçà de la largeur. */}
      <style>{`
        .atelier-page { padding: 18px 24px; }
        @media print {
          @page { size: A3 portrait; margin: 10mm; }
          .atelier-page { padding: 0; break-after: page; }
          .atelier-page:last-child { break-after: auto; }
          .atelier-page table { page-break-inside: auto; }
          .atelier-page thead { display: table-header-group; }
          .atelier-page tr { break-inside: avoid; page-break-inside: avoid; }
          .atelier-page section { break-inside: auto; }
        }
      `}</style>

      {ateliers.length === 0 ? (
        <p className="muted" style={{ padding: 24 }}>
          Aucun service avec des lignes actives à imprimer.
        </p>
      ) : (
        ateliers.map((a) => (
          <section key={a.id} className="atelier-page">
            <AtelierPlanning atelierRef={a.id} site={site} quarts={quarts} days={days} />
          </section>
        ))
      )}
    </div>
  );
}
