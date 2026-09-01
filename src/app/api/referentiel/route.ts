import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";

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
    default:
      return undefined;
  }
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
        return NextResponse.json({ ok: true, row: { ...data, ligne: [] } });
      }
      case "create-ligne": {
        // Nom facultatif (complété en inline), comme atelier et poste.
        const nom = s(body.nom);
        const atelier_id = s(body.atelier_id);
        if (!atelier_id) return NextResponse.json({ error: "Atelier requis" }, { status: 400 });
        const { data, error } = await supabase
          .from("ligne")
          .insert({ nom, atelier_id, site_id })
          .select("id, nom, actif, ordre_affichage")
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
        return NextResponse.json({ ok: true });
      }
      case "update-ligne": {
        const patch: Record<string, unknown> = {};
        if (body.nom !== undefined) patch.nom = s(body.nom);
        if (body.ordre_affichage !== undefined) patch.ordre_affichage = Math.max(0, Math.floor(Number(body.ordre_affichage) || 0));
        if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
        const { error } = await supabase.from("ligne").update(patch).eq("id", s(body.id)).eq("site_id", site_id);
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
        const { error } = await supabase.from("poste").update(patch).eq("id", s(body.id)).eq("site_id", site_id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "poste-quart": {
        // Activation poste x quart. Defaut actif : actif=true -> on supprime la ligne,
        // actif=false -> on insere/maj une ligne de desactivation.
        const poste_id = s(body.poste_id);
        const quart_code = s(body.quart_code);
        if (!poste_id || !quart_code) return NextResponse.json({ error: "Champs requis" }, { status: 400 });
        const actif = body.actif === true || body.actif === "true";
        if (actif) {
          const { error } = await supabase
            .from("poste_quart")
            .delete()
            .eq("poste_id", poste_id)
            .eq("quart_code", quart_code)
            .eq("site_id", site_id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("poste_quart")
            .upsert({ poste_id, quart_code, actif: false, site_id }, { onConflict: "poste_id,quart_code" });
          if (error) throw error;
        }
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
