import { getCurrentSite } from "@/lib/current-site";
import { getQuartsC } from "@/lib/refdata";
import { joursAutour, parseJour } from "@/lib/week";
import { getFenetreAffichage } from "@/lib/parametres";
import AutoRefresh from "@/components/AutoRefresh";
import AffichageBarre from "./AffichageBarre";
import AtelierPlanning from "./AtelierPlanning";

export const dynamic = "force-dynamic";

export default async function AffichageAtelier({
  params,
  searchParams,
}: {
  params: Promise<{ atelier: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { atelier: param } = await params;
  const sp = await searchParams;
  // Fenetre glissante autour d'aujourd'hui, dont les bornes sont reglees dans
  // Param. RH (jours_avant / jours_apres). Un ecran de couloir sert a savoir ce
  // qui vient, pas a relire le lundi passe.
  // `?date` deplace le pivot (sans recalage sur le lundi).
  const { jours_avant, jours_apres } = await getFenetreAffichage();
  const days = joursAutour(parseJour(sp.date), jours_avant, jours_apres);

  // Multi-tenant : nom d'usine affiche en haut a droite pour qu'un ecran
  // couloir d'un site ne puisse pas etre confondu avec celui d'un autre.
  const site = await getCurrentSite();
  // Liste des quarts du parametrage : sert de repli aux placements historiques
  // sans `quart_code` (cf. src/lib/quarts.ts).
  const quarts = await getQuartsC();

  return (
    // Deux boites imbriquees pour l'impression : `affichage-feuille` est le cadre,
    // borne a UNE page A3 verticale ; `affichage-contenu` porte la mise a l'echelle
    // mesuree par AffichageBarre. A l'ecran, elles sont transparentes.
    <div id="affichage-feuille" style={{ padding: "18px 24px" }}>
      <AutoRefresh seconds={300} />
      <div id="affichage-contenu" style={{ transformOrigin: "top left" }}>
        <AtelierPlanning
          atelierRef={param}
          site={site}
          quarts={quarts}
          days={days}
          refreshNote
          actions={<AffichageBarre cadreId="affichage-feuille" contenuId="affichage-contenu" />}
        />
      </div>
    </div>
  );
}
