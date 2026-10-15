// Helpers partagés par les routes d'écriture de placement (/api/placement/cell
// et /api/placement/move) : contrôles avant écriture et attribution du premier
// numéro de rotation libre. Extraits pour ne pas diverger entre les deux écrans.
import type { getServerClient } from "@/lib/supabase-server";
import { addMonthsIso, habValable } from "@/lib/habilitations";
import { parseNumeros } from "@/lib/numeros-rotation";
import { motifInactivite } from "@/lib/personne-statut";
import { quartOuDefaut, memeQuart, type QuartRef } from "@/lib/quarts";

type SupabaseClient = Awaited<ReturnType<typeof getServerClient>>;

export type ControlesPlacement = {
  /** Message prêt à renvoyer en 400 si la personne est inconnue / hors site. */
  errPers: string | null;
  /** Idem pour le poste (null si pas de poste ou poste du site). */
  errPo: string | null;
  /** Équipe enregistrée de la personne (évite de revérifier la même équipe). */
  equipePersonne: string | null;
  /** Refus « partie / hors effectif ce jour » (null = peut être affectée). */
  inactif: string | null;
  /** Habilitations exigées par le poste que la personne n'a pas (ou plus). */
  manquantes: string[];
  /** Le poste est marqué « – » (ne tourne pas) sur ce quart au Référentiel. */
  horsCycle: boolean;
  /** Numéros de rotation du poste (« 12, 15-17 » -> 4 places), [] si aucun. */
  numeros: string[];
};

type PersonneLue = {
  id: string;
  statut: string;
  equipe_id: string | null;
  contrat_periode: { date_debut: string | null; date_fin: string | null }[];
  personne_competence?: { competence_id: string; date_obtention: string | null; date_expiration: string | null }[];
};
type PosteLu = {
  id: string;
  numero_rotation: string | null;
  poste_competence_requise: { competence_id: string; competence: { nom: string; duree_validite_mois: number | null } | null }[];
  poste_quart: { actif: boolean }[];
};

// Contrôles d'une affectation, en DEUX lectures (2026-10-15, coût des journaux
// Supabase) au lieu de neuf : la personne avec ses contrats et ses habilitations,
// le poste avec ses exigences et son cycle sur le quart visé. Les sous-tables
// sont bornées au site comme la ligne mère. Mêmes règles qu'avant :
//   - personne / poste inconnus ou d'un autre site -> message 400 ;
//   - hors effectif ce jour (règle `motifInactivite`) -> message 422 ;
//   - cycle : aucune ligne poste_quart = le poste tourne (repli historique,
//     cf. src/lib/poste-quart.ts), `actif = false` = ne tourne pas ;
//   - habilitations exigées recalculées ici plutôt que de croire le client
//     (le drapeau de forçage sert de trace d'audit) ; date_expiration stockée
//     à la saisie, repli sur obtention + durée.
// Une erreur de lecture vaut refus (message « Vérification impossible »).
export async function controlesPlacement(
  supabase: SupabaseClient,
  o: { personne_id: string; poste_id: string | null; quart: string | null; jour: string; siteId: string },
): Promise<ControlesPlacement> {
  const { personne_id, poste_id, quart, jour, siteId } = o;
  // Habilitations lues seulement pour une affectation sur poste.
  let lecturePers = supabase
    .from("personne")
    .select(
      poste_id
        ? "id, statut, equipe_id, contrat_periode(date_debut, date_fin), personne_competence(competence_id, date_obtention, date_expiration)"
        : "id, statut, equipe_id, contrat_periode(date_debut, date_fin)",
    )
    .eq("id", personne_id)
    .eq("site_id", siteId)
    .eq("contrat_periode.site_id", siteId);
  if (poste_id) lecturePers = lecturePers.eq("personne_competence.site_id", siteId);
  const [persRes, posteRes] = await Promise.all([
    lecturePers.maybeSingle<PersonneLue>(),
    poste_id
      ? supabase
          .from("poste")
          .select("id, numero_rotation, poste_competence_requise(competence_id, competence:competence_id(nom, duree_validite_mois)), poste_quart(actif)")
          .eq("id", poste_id)
          .eq("site_id", siteId)
          .eq("poste_competence_requise.site_id", siteId)
          .eq("poste_quart.site_id", siteId)
          .eq("poste_quart.quart_code", quart ?? "")
          .maybeSingle<PosteLu>()
      : null,
  ]);

  const pers = persRes.data;
  const poste = posteRes?.data ?? null;
  const errPers = persRes.error
    ? `Verification impossible (Personne) : ${persRes.error.message}`
    : !pers
      ? "Personne inconnu(e) ou hors de votre site."
      : null;
  const errPo = !poste_id
    ? null
    : posteRes?.error
      ? `Verification impossible (Poste) : ${posteRes.error.message}`
      : !poste
        ? "Poste inconnu(e) ou hors de votre site."
        : null;

  const motif = pers ? motifInactivite(pers.statut, pers.contrat_periode ?? [], jour) : null;

  const parComp = new Map((pers?.personne_competence ?? []).map((d) => [d.competence_id, d]));
  const manquantes = (poste?.poste_competence_requise ?? [])
    .filter((r) => {
      const d = parComp.get(r.competence_id);
      if (!d) return true;
      const exp = d.date_expiration ?? addMonthsIso(d.date_obtention, r.competence?.duree_validite_mois);
      return !habValable({ expiration: exp });
    })
    .map((r) => r.competence?.nom ?? "habilitation");

  return {
    errPers,
    errPo,
    equipePersonne: pers?.equipe_id ?? null,
    inactif: motif ? `Affectation refusée : ${motif}.` : null,
    manquantes,
    horsCycle: (poste?.poste_quart ?? []).some((r) => r.actif === false),
    numeros: parseNumeros(poste?.numero_rotation),
  };
}

// Premier numero de rotation encore libre sur ce poste, ce jour et ce quart.
// `null` si le poste n'est pas numerote (aucune lecture), ou si toutes les places
// numerotees sont prises : la personne rejoint alors la zone « sans numero ».
// `numeros` vient de controlesPlacement (poste deja lu).
export async function premierNumeroLibre(
  supabase: SupabaseClient,
  numeros: string[],
  poste_id: string,
  jour: string,
  quart_code: string | null,
  personne_id: string,
  quarts: QuartRef[],
  siteId: string,
): Promise<string | null> {
  if (!numeros.length) return null;
  const { data: occ } = await supabase
    .from("placement")
    .select("personne_id, numero_rotation, quart_code")
    .eq("jour", jour)
    .eq("poste_id", poste_id)
    .eq("site_id", siteId)
    .returns<{ personne_id: string; numero_rotation: string | null; quart_code: string | null }[]>();

  const q = quartOuDefaut(quart_code, quarts);
  const pris = new Set(
    (occ ?? [])
      .filter((r) => r.personne_id !== personne_id && memeQuart(r.quart_code, q, quarts) && r.numero_rotation)
      .map((r) => r.numero_rotation as string),
  );
  return numeros.find((n) => !pris.has(n)) ?? null;
}

export const MSG_HORS_CYCLE =
  "Ce poste ne tourne pas sur ce quart (Référentiel) : affectation refusée. Choisissez le quart où le poste tourne, ou modifiez son cycle au Référentiel.";
