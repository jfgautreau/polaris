import { NextResponse, type NextRequest } from "next/server";
import { updateTag } from "next/cache";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { ATELIERS_TAG } from "@/lib/refdata";

// POST /api/referentiel  { op, ... }
// Saisie inline du referentiel (ateliers / lignes / postes). Ecriture admin (RLS).
// Ops : create-atelier | create-ligne | create-poste | update-atelier |
//       update-ligne | update-poste | toggle.
const POSTE_COLS =
  "id, nom, nom_court, categorie, effectif_requis, difficulte_formation, niveau_min_requis, ordre_affichage, numero_rotation, remplacable, actif";
const CATEGORIES = ["manager", "conducteur", "operateur"];

type Body = Record<string, unknown>;

const s = (v: unknown) => String(v ?? "").trim();

// Normalise une valeur de champ poste selon sa colonne.
function posteValue(key: string, value: unknown) {
  switch (key) {
    case "nom":
      return s(value);
    case "nom_court":
      return s(value).slice(0, 6) || null;
    case "categorie":
      return CATEGORIES.includes(s(value)) ? s(value) : undefined;
    case "effectif_requis":
      return Math.max(0, Math.floor(Number(value) || 0));
    case "niveau_min_requis":
      return Math.max(0, Math.min(4, Math.floor(Number(value) || 0)));
    case "ordre_affichage":
      return Math.max(0, Math.floor(Number(value) || 0));
    // Texte libre : un poste a plusieurs positions porte plusieurs numeros (« 12, 13 »).
    case "numero_rotation":
      return s(value).slice(0, 20) || null;
    // PTR (remplacable=true) / PTNR (false). Accepte booleen ou "true"/"false".
    case "remplacable":
      return value === true || value === "true";
    case "difficulte_formation": {
      const v = s(value);
      return v === "" ? null : Math.max(1, Math.min(3, Number(v)));
    }
    // Ouverture / fermeture datées (migration 0071). "" = pas de date (null).
    case "date_ouverture":
    case "date_fermeture":
      return dateValue(value);
    default:
      return undefined;
  }
}

// Normalise une date d'ouverture/fermeture : "YYYY-MM-DD" ou null (vide/invalide).
function dateValue(value: unknown): string | null {
  const v = s(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Update tolérant à l'absence des colonnes de dates (migration 0071 non passée) :
// si l'update échoue faute de colonne, on retire les clés de date et on réessaie.
async function updateTable(
  supabase: ReturnType<typeof getAdminClient>,
  table: "ligne" | "poste",
  patch: Record<string, unknown>,
  id: string,
  site_id: string
): Promise<{ error: { message: string } | null }> {
  let { error } = await supabase.from(table).update(patch).eq("id", id).eq("site_id", site_id);
  const dateKey = "date_ouverture" in patch || "date_fermeture" in patch;
  if (error && (error.code === "42703" || error.code === "PGRST204") && dateKey) {
    const p2 = { ...patch };
    delete p2.date_ouverture;
    delete p2.date_fermeture;
    if (Object.keys(p2).length === 0) return { error: null };
    ({ error } = await supabase.from(table).update(p2).eq("id", id).eq("site_id", site_id));
  }
  return { error };
}

// Unicité d'un « code » de nom sur le site (insensible à la casse), parmi les
// lignes actives. Un champ vide/null n'est jamais compté comme doublon — les
// entités créées vides (nom à saisir en inline) doivent pouvoir coexister.
// Renvoie `null` si tout va bien, sinon un message d'erreur prêt à retourner.
async function verifierUniciteNom(
  supabase: ReturnType<typeof getAdminClient>,
  table: "ligne" | "poste",
  champ: "nom" | "nom_court",
  valeur: string | null,
  site_id: string,
  idException?: string | null,
): Promise<string | null> {
  if (!valeur || !valeur.trim()) return null;
  const q = supabase
    .from(table)
    .select("id, nom, nom_court")
    .eq("site_id", site_id)
    .eq("actif", true)
    .ilike(champ, valeur.trim());
  const { data, error } = await q.returns<{ id: string; nom: string | null; nom_court?: string | null }[]>();
  if (error) return null; // en cas d'échec de lecture, on laisse passer plutôt que de bloquer une saisie légitime
  const doublon = (data ?? []).find((r) => r.id !== idException);
  if (!doublon) return null;
  const libChamp = table === "ligne" ? "nom de ligne" : champ === "nom" ? "nom de poste" : "nom court";
  return `Ce ${libChamp} (« ${valeur.trim()} ») est déjà utilisé sur ce site.`;
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Droit de module, et non « admin » en dur : la matrice accorde ce module a
  // d'autres roles, l'API doit honorer ce qu'elle promet.
  if (!(await canWriteModule(profile.role, "referentiel"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // Client admin : les tables de parametrage sont protegees par une RLS
  // `is_admin()`. Le droit de module a deja ete verifie ci-dessus, et
  // canWriteModule exclut le chef d'equipe par construction.
  // MULTI-SITE : le client admin bypass RLS (service_role, auth.uid()=NULL).
  // On passe site_id explicitement dans chaque INSERT/UPSERT pour que les
  // données atterrissent dans le bon site.
  const supabase = getAdminClient();
  const site_id = profile.siteId;

  try {
    switch (op) {
      case "create-atelier": {
        // Nom facultatif à la création : le bouton « + Ajouter un atelier »
        // crée une carte vide (nom = ""), l'utilisateur la renomme en inline
        // ensuite — même modèle que create-poste. Ne PAS exiger le nom ici,
        // sinon le bouton répond 400 « Nom requis » (bug vécu 2026-08-23).
        const nom = s(body.nom);
        const { data, error } = await supabase
          .from("atelier")
          .insert({ nom, site_id })
          .select("id, nom, actif")
          .single();
        if (error) throw error;
        // Cache refdata ateliers invalide (audit P2) : le nouveau apparait
        // immediatement dans les filtres du planning au lieu d'attendre 30 s.
        updateTag(ATELIERS_TAG);
        return NextResponse.json({ ok: true, row: { ...data, ligne: [] } });
      }
      case "create-ligne": {
        // Nom facultatif (complété en inline), comme atelier et poste.
        const nom = s(body.nom);
        const atelier_id = s(body.atelier_id);
        if (!atelier_id) return NextResponse.json({ error: "Atelier requis" }, { status: 400 });
        // Bloque une ligne créée directement avec un nom en doublon.
        const uErr = await verifierUniciteNom(supabase, "ligne", "nom", nom, site_id);
        if (uErr) return NextResponse.json({ error: uErr }, { status: 409 });
        const { data, error } = await supabase
          .from("ligne")
          .insert({ nom, atelier_id, site_id })
          .select("id, nom, actif, ordre_affichage, regroupement")
          .single();
        if (error) throw error;
        return NextResponse.json({ ok: true, row: { ...data, poste: [] } });
      }
      case "create-poste": {
        const nom = s(body.nom);
        const ligne_id = s(body.ligne_id);
        // nom facultatif à la création : la ligne apparaît vide (placeholder gris),
        // l'utilisateur saisit le nom ensuite.
        if (!ligne_id) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
        const uErr = await verifierUniciteNom(supabase, "poste", "nom", nom, site_id);
        if (uErr) return NextResponse.json({ error: uErr }, { status: 409 });
        const { data, error } = await supabase
          .from("poste")
          .insert({ ligne_id, nom, site_id })
          .select(POSTE_COLS)
          .single();
        if (error) throw error;
        return NextResponse.json({ ok: true, row: data });
      }
      case "update-atelier": {
        const { error } = await supabase.from("atelier").update({ nom: s(body.nom) }).eq("id", s(body.id)).eq("site_id", site_id);
        if (error) throw error;
        updateTag(ATELIERS_TAG);
        return NextResponse.json({ ok: true });
      }
      case "update-ligne": {
        const patch: Record<string, unknown> = {};
        if (body.nom !== undefined) patch.nom = s(body.nom);
        if (body.ordre_affichage !== undefined) patch.ordre_affichage = Math.max(0, Math.floor(Number(body.ordre_affichage) || 0));
        // Regroupement (0069) : étiquette de reporting, texte libre borné, vide = null.
        if (body.regroupement !== undefined) patch.regroupement = s(body.regroupement).slice(0, 60) || null;
        // Ouverture / fermeture datées (migration 0071).
        if (body.date_ouverture !== undefined) patch.date_ouverture = dateValue(body.date_ouverture);
        if (body.date_fermeture !== undefined) patch.date_fermeture = dateValue(body.date_fermeture);
        if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
        // Unicité du nom : bloque un renommage qui produirait un doublon parmi
        // les autres lignes actives du site (l'id courant est exclu).
        if (typeof patch.nom === "string") {
          const uErr = await verifierUniciteNom(supabase, "ligne", "nom", patch.nom as string, site_id, s(body.id));
          if (uErr) return NextResponse.json({ error: uErr }, { status: 409 });
        }
        const { error } = await updateTable(supabase, "ligne", patch, s(body.id), site_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "update-poste": {
        const patchIn = (body.patch ?? {}) as Body;
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(patchIn)) {
          const v = posteValue(k, patchIn[k]);
          if (v !== undefined) patch[k] = v;
        }
        if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
        // Unicité nom + nom_court parmi les autres postes actifs du site.
        if (typeof patch.nom === "string") {
          const uErr = await verifierUniciteNom(supabase, "poste", "nom", patch.nom as string, site_id, s(body.id));
          if (uErr) return NextResponse.json({ error: uErr }, { status: 409 });
        }
        if (typeof patch.nom_court === "string") {
          const uErr = await verifierUniciteNom(supabase, "poste", "nom_court", patch.nom_court as string, site_id, s(body.id));
          if (uErr) return NextResponse.json({ error: uErr }, { status: 409 });
        }
        const { error } = await updateTable(supabase, "poste", patch, s(body.id), site_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "poste-quart": {
        // Effectif par quart — TROIS états (cf. src/lib/poste-quart.ts). Le champ
        // `effectif` du corps vaut :
        //   • "" / null   → le poste NE TOURNE PAS sur ce quart (« – ») : ligne actif=false ;
        //   • un nombre N → le poste tourne à N (0 = tourne à 0, N = N personnes) : ligne actif=true.
        // On matérialise toujours une ligne (effectif explicite par quart).
        const poste_id = s(body.poste_id);
        const quart_code = s(body.quart_code);
        if (!poste_id || !quart_code) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
        const brut = body.effectif;
        const tourne = !(brut === "" || brut === null || brut === undefined);
        const eff = tourne ? Math.max(0, Math.floor(Number(brut) || 0)) : null;
        let { error } = await supabase
          .from("poste_quart")
          .upsert({ poste_id, quart_code, actif: tourne, effectif_requis: eff, site_id }, { onConflict: "poste_id,quart_code" });
        // Repli si la migration 0070 (colonne effectif_requis) n'est pas encore passée.
        if (error && (error.code === "42703" || error.code === "PGRST204")) {
          ({ error } = await supabase
            .from("poste_quart")
            .upsert({ poste_id, quart_code, actif: tourne, site_id }, { onConflict: "poste_id,quart_code" }));
        }
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "poste-competence": {
        // Habilitation exigee par un poste. Presente = requise : on insere / supprime.
        const poste_id = s(body.poste_id);
        const competence_id = s(body.competence_id);
        if (!poste_id || !competence_id) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
        const requis = body.requis === true || body.requis === "true";
        if (requis) {
          const { error } = await supabase
            .from("poste_competence_requise")
            .upsert({ poste_id, competence_id, site_id }, { onConflict: "poste_id,competence_id" });
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("poste_competence_requise")
            .delete()
            .eq("poste_id", poste_id)
            .eq("competence_id", competence_id)
            .eq("site_id", site_id);
          if (error) throw error;
        }
        return NextResponse.json({ ok: true });
      }
      case "toggle-titulaire": {
        // Titulaire (poste fixe) d'un poste, vu côté Référentiel, PAR PERSONNE —
        // même UX que les habilitations requises (cases à cocher). Même donnée que
        // le sélecteur « Poste fixe » de la fiche Personnel : personne.poste_fixe_id.
        // Un poste peut avoir plusieurs titulaires ; une personne n'a qu'UN poste
        // fixe (colonne mono-valuée) → cocher une personne ici la détache de son
        // poste fixe précédent. Cocher = rattacher, décocher = détacher.
        const poste_id = s(body.poste_id);
        const personne_id = s(body.personne_id);
        if (!poste_id || !personne_id) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
        const actif = body.actif === true || body.actif === "true";
        const { error } = await supabase
          .from("personne")
          .update({ poste_fixe_id: actif ? poste_id : null })
          .eq("id", personne_id)
          .eq("site_id", site_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "toggle": {
        const entity = s(body.entity);
        if (!["atelier", "ligne", "poste"].includes(entity))
          return NextResponse.json({ error: "Entité inconnue" }, { status: 400 });
        const { error } = await supabase
          .from(entity)
          .update({ actif: body.actif === true || body.actif === "true" })
          .eq("id", s(body.id))
          .eq("site_id", site_id);
        if (error) throw error;
        if (entity === "atelier") updateTag(ATELIERS_TAG);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
