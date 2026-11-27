// Chargement d'une semaine « TP + pré-affectation » côté navigateur, partagé par
// le Planning (bouton par semaine) et le Placement (bouton de la semaine du jour
// affiché) : même question, même appel à /api/placement/prefill, mêmes messages.
// Aucune de ces fonctions ne lève (le React Compiler renonce sur un try/finally
// ou un throw dans un composant : le réseau reste ici, hors composant).

type NonPlace = { personne: string; poste: string; semaine: string; raison: string };
type ReponsePrefill = {
  crees?: number;
  tp?: number;
  fixe?: number;
  nonPlaces?: NonPlace[];
  completes?: number;
  sansNumero?: NonPlace[];
  site?: string;
  marqueur?: string;
  error?: string;
};

// Titulaires que le pré-remplissage n'a PAS placés : le cycle du poste (quarts
// où il tourne) ne contient pas le quart de leur équipe (cf. quartPourPosteFixe).
const texteNonPlaces = (np: NonPlace[] | undefined): string =>
  np && np.length
    ? "\n\nNon placé(s) — le poste ne tourne pas sur le quart de l'équipe, à placer à la main ou à corriger au Référentiel :\n" +
      np.map((n) => `• ${n.personne} — ${n.poste} : ${n.raison}`).join("\n")
    : "";
// Titulaires posés sans place numérotée (plus de titulaires que de numéros libres).
const texteSansNumero = (sn: NonPlace[] | undefined): string =>
  sn && sn.length
    ? "\n\nSans numéro de rotation (toutes les places du poste sont prises) :\n" +
      sn.map((n) => `• ${n.personne} — ${n.poste} : ${n.raison}`).join("\n")
    : "";

// `reseau` : la requête n'a pas abouti (exception) ; sinon `ok` + corps décodé.
async function envoyerPrefill(monday: string): Promise<{ reseau: true } | { reseau: false; ok: boolean; j: ReponsePrefill }> {
  try {
    const r = await fetch("/api/placement/prefill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ semaines: [monday] }),
    });
    const j = (await r.json().catch(() => ({}))) as ReponsePrefill;
    return { reseau: false, ok: r.ok, j };
  } catch {
    return { reseau: true };
  }
}

/** Question posée avant de charger la semaine `label` (« S49 »). */
export function confirmerPrefill(label: string): boolean {
  return window.confirm(
    `Charger la semaine ${label} ?\n\n1. Temps partiel : les jours de TP sont posés (déplaçables ensuite au glisser-déposer).\n2. Postes fixes : chaque personne à poste fixe est placée sur son poste, au quart de son équipe, sur une place numérotée (son dernier numéro s'il est libre).\n\nLes cases déjà remplies (absence, autre poste) ne sont jamais écrasées.`,
  );
}

/**
 * Charge la semaine du lundi `monday` et dit ce qui s'est passé (messages compris) :
 *  - `erreur` : rien n'a été écrit (réseau ou refus du serveur, déjà expliqué) ;
 *  - `rien`   : tout était déjà rempli, l'écran est à jour ;
 *  - `charge` : des affectations ont été créées ou complétées — l'écran appelant
 *               doit se recharger pour les montrer.
 */
export async function chargerSemaine(monday: string, label: string): Promise<"erreur" | "rien" | "charge"> {
  const r = await envoyerPrefill(monday);
  if (r.reseau) {
    window.alert("Chargement impossible : le serveur n'a pas répondu. Réessayez.");
    return "erreur";
  }
  const j = r.j;
  if (!r.ok) {
    window.alert(`Chargement impossible : ${j.error ?? "erreur inconnue"}`);
    return "erreur";
  }
  const alertes = texteNonPlaces(j.nonPlaces) + texteSansNumero(j.sansNumero);
  const completes = j.completes ?? 0;
  if ((j.crees ?? 0) === 0 && completes === 0) {
    // Rien créé : on explique pourquoi (souvent : cases déjà remplies).
    window.alert(`Semaine ${label} : rien à créer (TP ${j.tp ?? 0}, postes fixes ${j.fixe ?? 0}). Cases déjà remplies non écrasées. Marqueur TP : ${j.marqueur ?? "?"}.${alertes}`);
    return "rien";
  }
  // Des titulaires non placés : on le dit AVANT le rechargement de la vue.
  if (alertes !== "" || completes > 0)
    window.alert(
      `Semaine ${label} chargée.${completes > 0 ? `\n\n${completes} affectation(s) déjà posée(s) complétée(s) d'un numéro de rotation.` : ""}${alertes}`,
    );
  return "charge";
}
