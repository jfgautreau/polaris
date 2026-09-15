import { getCurrentSite } from "@/lib/current-site";
import { getQuartsC } from "@/lib/refdata";
import { parseJour, isoDate, mondayOf } from "@/lib/week";
import { getFenetreAffichage, joursDeFenetre } from "@/lib/parametres";
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
  const fen = await getFenetreAffichage();
  const pivot = parseJour(sp.date);
  const days = joursDeFenetre(fen, pivot);
  // Bornes affichées + comparaison au lundi de la semaine courante : servent au
  // sélecteur de semaine de la barre (choix de la semaine à afficher / imprimer).
  const pivotIso = isoDate(pivot);
  const debutIso = days[0]?.iso ?? pivotIso;
  const finIso = days[days.length - 1]?.iso ?? pivotIso;
  const estCourant = isoDate(mondayOf(pivot)) === isoDate(mondayOf());

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
          actions={
            <AffichageBarre
              cadreId="affichage-feuille"
              contenuId="affichage-contenu"
              pivotIso={pivotIso}
              debutIso={debutIso}
              finIso={finIso}
              estCourant={estCourant}
            />
          }
        />
      </div>
    </div>
  );
}
