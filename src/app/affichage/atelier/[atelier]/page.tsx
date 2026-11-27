import { getCurrentSite } from "@/lib/current-site";
import { requireModule } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import { parseJour, parseMonday, weekDays, isoDate, mondayOf } from "@/lib/week";
import { getFenetreAffichage, joursDeFenetre } from "@/lib/parametres";
import AffichageBarre from "./AffichageBarre";
import AtelierPlanning from "./AtelierPlanning";
import MiseAJourEconome from "./MiseAJourEconome";
import { versionDonnees } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AffichageAtelier({
  params,
  searchParams,
}: {
  params: Promise<{ atelier: string }>;
  searchParams: Promise<{ date?: string; semaine?: string; retour?: string }>;
}) {
  // Compte requis (2026-11-03) : une TV se connecte avec un compte au droit
  // « affichage » ; le site affiché est celui de ce compte.
  await requireModule("affichage", "read");
  const { atelier: param } = await params;
  const sp = await searchParams;
  // Fenetre glissante autour d'aujourd'hui, dont les bornes sont reglees dans
  // Param. RH (jours_avant / jours_apres). Un ecran de couloir sert a savoir ce
  // qui vient, pas a relire le lundi passe.
  // `?date` deplace le pivot (sans recalage sur le lundi).
  const fen = await getFenetreAffichage();
  // `?semaine=<jour>` (2026-11-27, lien TV du Planning) : SEMAINE ENTIÈRE, lundi →
  // dimanche, quelle que soit la fenêtre réglée pour les écrans de couloir ; la
  // barre navigue alors de semaine en semaine et propose le retour au Planning.
  const semaine = sp.semaine && /^\d{4}-\d{2}-\d{2}$/.test(sp.semaine) ? isoDate(parseMonday(sp.semaine)) : null;
  // Filtres du Planning à rendre au retour (quart, équipe, vue…) : seules des clés
  // connues sont reprises, le chemin de retour reste /planning.
  const retourQs = new URLSearchParams();
  if (semaine && sp.retour) {
    const recu = new URLSearchParams(sp.retour);
    for (const k of ["quart", "equipe", "vue", "search", "cond", "par"]) {
      const v = recu.get(k);
      if (v) retourQs.set(k, v.slice(0, 100));
    }
  }
  const retourFiltres = retourQs.toString();
  const pivot = semaine ? parseMonday(semaine) : parseJour(sp.date);
  const days = semaine ? weekDays(pivot) : joursDeFenetre(fen, pivot);
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
  // Version des données au moment de l'affichage : l'écran ne se recharge que si
  // elle change (cf. MiseAJourEconome).
  const version = await versionDonnees();

  return (
    // Cadre de l'écran TV ; à l'impression, une feuille A3 par section (cf.
    // AtelierPlanning / FeuillesImpression).
    <div id="affichage-feuille" style={{ padding: "18px 24px" }}>
      <MiseAJourEconome version={version} suitAujourdhui={!sp.date && !semaine} />
      <AtelierPlanning
        atelierRef={param}
        site={site}
        quarts={quarts}
        days={days}
        actions={
          <AffichageBarre
            cadreId="affichage-feuille"
            pivotIso={pivotIso}
            debutIso={debutIso}
            finIso={finIso}
            estCourant={estCourant}
            semaine={semaine}
            retourPlanning={semaine ? `/planning?semaine=${semaine}&atelier=${encodeURIComponent(param)}${retourFiltres ? `&${retourFiltres}` : ""}` : null}
            retourFiltres={retourFiltres}
          />
        }
      />
    </div>
  );
}
