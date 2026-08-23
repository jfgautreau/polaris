import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { canWriteModule } from "@/lib/permissions";
import { normaliseNom, normalisePrenom } from "@/lib/noms";

// POST /api/personnel { op, ... }
// Saisie inline du personnel. Ecriture admin (RLS personne).
// Ops : create | update | refresh-statuts
//       | periode-list | periode-create | periode-update | periode-delete
//
// NOTE cycle de vie (migrations 0049 + 0050) : `statut` n'est plus editable
// directement, il est cache maintenu par un trigger sur `contrat_periode`.
// Les colonnes `date_arrivee`, `date_depart_prevu`, `motif_depart` ont ete
// supprimees (0050) : ce sont maintenant MIN/MAX(contrat_periode) et
// motif_fin du dernier contrat.
const COLS = "id, matricule, nom, prenom, equipe_id, type_contrat, date_fin, pointure, statut";
const PERIODE_COLS = "id, personne_id, type_contrat, agence_interim, date_debut, date_fin, commentaire, motif, motif_fin";
// Codes de contrat historiques (fallback si la table `type_contrat` de la
// migration 0040 n'existe pas encore) : on garde le comportement d'origine.
const CONTRATS_FALLBACK = ["CDI", "CDD", "INTERIM"];

// Liste des codes de type de contrat autorises : union du fallback historique
// et des types actifs saisis en Param. RH. Ne rejette jamais un code deja
// present dans la table (meme desactive), pour ne pas casser une mise a jour.
async function codesContratAutorises(supabase: SupabaseClient, siteId: string): Promise<string[]> {
  try {
    // MULTI-SITE (0053) : type_contrat est site-scopé. On borne pour ne
    // pas lister les codes d'un autre site (le service_role bypass RLS).
    const { data, error } = await supabase
      .from("type_contrat")
      .select("code")
      .eq("site_id", siteId)
      .returns<{ code: string }[]>();
    if (error) return CONTRATS_FALLBACK;
    const set = new Set<string>(CONTRATS_FALLBACK);
    for (const r of data ?? []) set.add(r.code);
    return Array.from(set);
  } catch {
    return CONTRATS_FALLBACK;
  }
}

type Body = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

type PeriodeRow = {
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  created_at: string;
};

// Recalcule le reflet denormalise de personne a partir de la periode la plus
// recente (date_debut desc, nulls en dernier, puis created_at desc), et
// renvoie AUSSI les dates derivees pour rafraichir l'ecran :
//   • contrat_debut       : plus ancien date_debut (alerte 18 mois).
//   • date_arrivee_calc   : idem — l'arrivee = 1er contrat.
//   • date_depart_prevu_calc : MAX(date_fin) si tous les contrats sont fermes,
//     sinon null (au moins un CDI ouvert). Miroir de la fonction SQL 0050
//     personne_arrivee_depart. Le statut de personne est reactualise cote DB
//     par le trigger sync_statut_from_contrats.
async function syncPersonneFromPeriodes(
  supabase: SupabaseClient,
  personne_id: string,
  siteId: string,
): Promise<{
  type_contrat: string;
  agence_interim: string | null;
  date_debut: string | null;
  date_fin: string | null;
  contrat_debut: string | null;
  date_arrivee: string | null;
  date_depart_prevu: string | null;
} | null> {
  try {
    const { data } = await supabase
      .from("contrat_periode")
      .select("type_contrat, agence_interim, date_debut, date_fin, created_at")
      .eq("personne_id", personne_id)
      .eq("site_id", siteId)
      .returns<PeriodeRow[]>();
    const periods = data ?? [];
    if (periods.length === 0) return null;
    periods.sort((a, b) => {
      const da = a.date_debut ?? "";
      const db = b.date_debut ?? "";
      if (da !== db) return db.localeCompare(da); // dates reelles d'abord, null en dernier
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
    const latest = periods[0];
    const reflet = {
      type_contrat: latest.type_contrat,
      agence_interim: latest.agence_interim,
      date_debut: latest.date_debut,
      date_fin: latest.date_fin,
    };
    const { error: refletErr } = await supabase.from("personne").update(reflet).eq("id", personne_id).eq("site_id", siteId);
    if (refletErr) throw refletErr;
    // Debut du contrat le PLUS ANCIEN = date d'arrivee.
    const debuts = periods.map((p) => p.date_debut).filter((d): d is string => !!d).sort();
    const arrivee = debuts[0] ?? null;
    // Depart = MAX(date_fin) UNIQUEMENT si aucun contrat ouvert.
    const auMoinsUnOuvert = periods.some((p) => p.date_debut && p.date_fin === null);
    const fins = periods.map((p) => p.date_fin).filter((d): d is string => !!d).sort();
    const depart = auMoinsUnOuvert ? null : fins[fins.length - 1] ?? null;
    return {
      ...reflet,
      contrat_debut: arrivee,
      date_arrivee: arrivee,
      date_depart_prevu: depart,
    };
  } catch {
    // table absente (migration 0017 non encore appliquee) -> on ignore
    return null;
  }
}

// Synchronise personne.temps_partiel + tp_config avec la période TP active
// (courante ou prochaine future). Appelé après chaque CRUD sur tp_periode.
async function syncPersonneTP(supabase: SupabaseClient, personne_id: string, siteId: string) {
  const today = new Date().toISOString().slice(0, 10);
  // Période courante : date_debut ≤ today AND (date_fin IS NULL OR date_fin ≥ today).
  const { data: courant } = await supabase
    .from("tp_periode")
    .select("tp_config")
    .eq("personne_id", personne_id)
    .eq("site_id", siteId)
    .lte("date_debut", today)
    .or(`date_fin.is.null,date_fin.gte.${today}`)
    .order("date_debut", { ascending: false })
    .limit(1)
    .single();
  if (courant) {
    const { error } = await supabase.from("personne").update({ temps_partiel: true, tp_config: courant.tp_config }).eq("id", personne_id).eq("site_id", siteId);
    if (error) throw error;
  } else {
    // Pas de période courante : vérifier s'il y a une période future.
    const { data: future } = await supabase
      .from("tp_periode")
      .select("id")
      .eq("personne_id", personne_id)
      .eq("site_id", siteId)
      .gt("date_debut", today)
      .limit(1);
    if (!future?.length) {
      // Aucune période courante ni future → temps plein.
      const { error } = await supabase.from("personne").update({ temps_partiel: false, tp_config: null }).eq("id", personne_id).eq("site_id", siteId);
      if (error) throw error;
    }
    // Si période future seulement, on laisse le flag actuel (la personne est
    // à temps plein maintenant, le flag passera à true quand la période débutera).
  }
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  // Écriture personnel : admin OU droit "personnel: write".
  if (!(await canWriteModule(profile.role, "personnel"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const op = s(body?.op);
  if (!body || !op) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  const supabase = getAdminClient();
  // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
  const site_id = profile.siteId;
  const CONTRATS = await codesContratAutorises(supabase, site_id);

  try {
    if (op === "create") {
      // Casse imposee a la source : NOM en capitales, Prenom capitalise. Le
      // controle de presence porte sur la saisie brute, la normalisation ne peut
      // pas vider une chaine non vide.
      const nom = normaliseNom(s(body.nom));
      const prenom = normalisePrenom(s(body.prenom));
      if (!nom || !prenom) return NextResponse.json({ error: "Nom et prénom requis" }, { status: 400 });
      const type_contrat = CONTRATS.includes(s(body.type_contrat)) ? s(body.type_contrat) : "CDI";
      // Matricule laisse VIDE si non saisi (y compris pour un interimaire) : la
      // generation automatique d'un « INT-… » produisait un identifiant factice
      // qui polluait la recherche et l'export. `personne.matricule` est nullable
      // (contrainte unique partielle : plusieurs NULL autorises).
      const matricule = orNull(s(body.matricule));

      // ⚠️ Cette creation enchainait CINQ requetes : un insert, puis trois
      // updates successifs (atelier, sexe, badge+livret) entoures de gardes
      // « best-effort ». Ces gardes dataient des migrations 0020/0022/0024,
      // appliquees depuis des mois : elles n'avaient plus d'objet et avalaient
      // desormais de vraies erreurs, laissant une personne a moitie creee.
      // Tout part maintenant dans le MEME insert.
      const sexe = s(body.sexe);
      // Date d'arrivee = date_debut du 1er contrat. On accepte encore la clef
      // `date_arrivee` en entree pour ne pas casser le formulaire de creation :
      // elle est simplement traduite en date_debut de la periode initiale.
      const dateDebutContrat =
        orNull(s(body.date_arrivee)) ?? orNull(s(body.date_debut)) ?? new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("personne")
        .insert({
          nom,
          prenom,
          equipe_id: orNull(s(body.equipe_id)),
          atelier_id: orNull(s(body.atelier_id)),
          type_contrat,
          matricule,
          agence_interim: type_contrat === "INTERIM" ? orNull(s(body.agence_interim)) : null,
          date_debut: dateDebutContrat,
          date_fin: orNull(s(body.date_fin)),
          pointure: orNull(s(body.pointure)),
          commentaire: orNull(s(body.commentaire)),
          sexe: sexe === "H" || sexe === "F" ? sexe : null,
          numero_badge: orNull(s(body.numero_badge)),
          date_livret_accueil: orNull(s(body.date_livret_accueil)),
          site_id,
        })
        .select(COLS)
        .single();
      if (error) throw error;
      const created = data as { id: string };

      // La periode de contrat initiale n'est plus « best-effort » non plus : son
      // `catch` muet laissait une personne sans historique de contrat. Le trigger
      // `sync_statut_from_contrats` (0050) mettra ensuite personne.statut a jour.
      const { error: periodeErr } = await supabase.from("contrat_periode").insert({
        personne_id: created.id,
        type_contrat,
        agence_interim: type_contrat === "INTERIM" ? orNull(s(body.agence_interim)) : null,
        date_debut: dateDebutContrat,
        date_fin: orNull(s(body.date_fin)),
        site_id,
      });
      if (periodeErr) throw periodeErr;
      return NextResponse.json({ ok: true, row: data });
    }

    if (op === "update") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const patchIn = (body.patch ?? {}) as Body;
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(patchIn)) {
        const v = patchIn[k];
        switch (k) {
          case "nom":
          case "prenom":
            patch[k] = s(v);
            break;
          case "matricule":
          case "pointure":
            patch[k] = orNull(s(v));
            break;
          case "equipe_id":
          case "atelier_id":
            patch[k] = orNull(s(v));
            break;
          case "sexe": {
            const sx = s(v);
            patch.sexe = sx === "H" || sx === "F" ? sx : null;
            break;
          }
          case "numero_badge":
          case "date_livret_accueil":
          case "commentaire":
            patch[k] = orNull(s(v));
            break;
          // date_arrivee / date_depart_prevu / motif_depart ont ete supprimes
          // (0050) : ce sont maintenant MIN/MAX(contrat_periode) et le motif_fin
          // du dernier contrat. Toute ecriture sur ces clefs est ignoree en silence
          // (compat descendante — un ancien client ne casse pas).
          case "type_contrat":
            if (CONTRATS.includes(s(v))) {
              patch.type_contrat = s(v);
              if (s(v) !== "INTERIM") patch.agence_interim = null;
            }
            break;
        }
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
      const { error } = await supabase.from("personne").update(patch).eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // Rafraichit le cache statut de toutes les personnes du site : appelable au
    // chargement de /personnel pour rattraper les bascules automatiques du jour
    // (A_VENIR -> ACTIF au jour d'arrivee, ACTIF -> PARTI le lendemain du depart).
    // Idempotent, no-op si tous les caches sont a jour.
    if (op === "refresh-statuts") {
      const { data, error } = await supabase.rpc("rafraichir_statuts_personnes", {
        p_site: profile.siteId,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, changes: data ?? 0 });
    }

    // Agences d'interim actives, pour le menu deroulant des periodes de contrat.
    // Parametrees dans Param. RH (/admin/motifs). Si la table n'existe pas encore
    // (migration 0034 non appliquee), on renvoie une liste vide : l'ecran retombe
    // alors sur la saisie libre au lieu de casser.
    // Types de contrat actifs (migration 0040), pour alimenter le menu deroulant
    // Personnel / Periodes de contrat. Retombe sur les 3 codes historiques si la
    // table n'existe pas encore.
    if (op === "types-contrat") {
      try {
        // MULTI-SITE (0053) : borne par site_id (service_role bypass RLS).
        const { data, error } = await supabase
          .from("type_contrat")
          .select("code, libelle")
          .eq("actif", true)
          .eq("site_id", site_id)
          .order("ordre")
          .returns<{ code: string; libelle: string }[]>();
        if (error) throw error;
        return NextResponse.json({ ok: true, types: data ?? [] });
      } catch {
        return NextResponse.json({
          ok: true,
          types: [
            { code: "CDI", libelle: "CDI" },
            { code: "CDD", libelle: "CDD" },
            { code: "INTERIM", libelle: "Intérim" },
          ],
        });
      }
    }

    if (op === "agences") {
      // MULTI-SITE : agence_interim est site-scopée. Borne pour ne pas
      // renvoyer les agences d'un autre site.
      const { data, error } = await supabase
        .from("agence_interim")
        .select("nom")
        .eq("actif", true)
        .eq("site_id", site_id)
        .order("nom")
        .returns<{ nom: string }[]>();
      return NextResponse.json({ ok: true, agences: error ? [] : (data ?? []).map((a) => a.nom) });
    }

    // ----- Periodes de contrat -----
    if (op === "periode-list") {
      const personne_id = s(body.personne_id);
      if (!personne_id) return NextResponse.json({ error: "personne_id manquant" }, { status: 400 });
      const { data, error } = await supabase
        .from("contrat_periode")
        .select(PERIODE_COLS)
        .eq("personne_id", personne_id)
        .eq("site_id", site_id)
        // Les periodes sans date de debut (celles qu'on vient de creer et qui
        // restent a remplir) passent en tete, la ou le bouton Ajouter les depose.
        .order("date_debut", { ascending: false, nullsFirst: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ ok: true, rows: data ?? [] });
    }

    if (op === "periode-create") {
      const personne_id = s(body.personne_id);
      if (!personne_id) return NextResponse.json({ error: "personne_id manquant" }, { status: 400 });
      const type_contrat = CONTRATS.includes(s(body.type_contrat)) ? s(body.type_contrat) : "CDI";
      const { data, error } = await supabase
        .from("contrat_periode")
        .insert({
          personne_id,
          type_contrat,
          agence_interim: type_contrat === "INTERIM" ? orNull(s(body.agence_interim)) : null,
          date_debut: orNull(s(body.date_debut)),
          date_fin: orNull(s(body.date_fin)),
          commentaire: orNull(s(body.commentaire)),
          motif: orNull(s(body.motif)),
          motif_fin: orNull(s(body.motif_fin)),
          site_id,
        })
        .select(PERIODE_COLS)
        .single();
      if (error) throw error;
      const reflet1 = await syncPersonneFromPeriodes(supabase, personne_id, site_id);
      return NextResponse.json({ ok: true, row: data, personne: reflet1 });
    }

    if (op === "periode-update") {
      const id = s(body.id);
      const personne_id = s(body.personne_id);
      if (!id || !personne_id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const patchIn = (body.patch ?? {}) as Body;
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(patchIn)) {
        const v = patchIn[k];
        switch (k) {
          case "type_contrat":
            if (CONTRATS.includes(s(v))) {
              patch.type_contrat = s(v);
              if (s(v) !== "INTERIM") patch.agence_interim = null;
            }
            break;
          case "agence_interim":
          case "commentaire":
          case "motif":
          case "motif_fin":
            patch[k] = orNull(s(v));
            break;
          case "date_debut":
          case "date_fin":
            patch[k] = orNull(s(v));
            break;
        }
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
      const { error } = await supabase.from("contrat_periode").update(patch).eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      const reflet = await syncPersonneFromPeriodes(supabase, personne_id, site_id);
      return NextResponse.json({ ok: true, personne: reflet });
    }

    if (op === "periode-delete") {
      const id = s(body.id);
      const personne_id = s(body.personne_id);
      if (!id || !personne_id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const { error } = await supabase.from("contrat_periode").delete().eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      const reflet = await syncPersonneFromPeriodes(supabase, personne_id, site_id);
      return NextResponse.json({ ok: true, personne: reflet });
    }

    if (op === "tp") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const enabled = body.temps_partiel === true;
      const tt = s(body.tp_type);
      const tp_type = enabled && (tt === "JOURS" || tt === "HORAIRES") ? tt : null;
      const tp_config = enabled ? (body.tp_config ?? {}) : null;
      const { error } = await supabase.from("personne").update({ temps_partiel: enabled, tp_type, tp_config }).eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // --- Périodes de temps partiel (table tp_periode, migration 0052) ---

    if (op === "tp-periode-list") {
      const personne_id = s(body.personne_id);
      if (!personne_id) return NextResponse.json({ error: "personne_id manquant" }, { status: 400 });
      const { data, error } = await supabase
        .from("tp_periode")
        .select("id, personne_id, date_debut, date_fin, tp_config, created_at")
        .eq("personne_id", personne_id)
        .eq("site_id", site_id)
        .order("date_debut", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ periodes: data ?? [] });
    }

    if (op === "tp-periode-create") {
      const personne_id = s(body.personne_id);
      const date_debut = s(body.date_debut);
      const date_fin = body.date_fin ? s(body.date_fin) : null;
      const tp_config = body.tp_config ?? {};
      if (!personne_id || !date_debut) return NextResponse.json({ error: "personne_id et date_debut requis" }, { status: 400 });
      if (date_fin && date_fin < date_debut) return NextResponse.json({ error: "date_fin doit être ≥ date_debut" }, { status: 400 });
      // Vérifier chevauchement.
      const { data: existing } = await supabase
        .from("tp_periode")
        .select("id, date_debut, date_fin")
        .eq("personne_id", personne_id)
        .eq("site_id", site_id);
      const overlap = (existing ?? []).some((p) => {
        const pFin = p.date_fin ?? "9999-12-31";
        const nFin = date_fin ?? "9999-12-31";
        return date_debut <= pFin && nFin >= p.date_debut;
      });
      if (overlap) return NextResponse.json({ error: "Chevauchement avec une période existante" }, { status: 409 });
      // MULTI-SITE : site_id explicite pour le cas admin client (service_role).
      const { data, error } = await supabase
        .from("tp_periode")
        .insert({ personne_id, date_debut, date_fin, tp_config, site_id })
        .select("id, personne_id, date_debut, date_fin, tp_config, created_at")
        .single();
      if (error) throw error;
      // Mettre à jour le flag personne.temps_partiel si nécessaire.
      await syncPersonneTP(supabase, personne_id, site_id);
      return NextResponse.json({ periode: data });
    }

    if (op === "tp-periode-update") {
      const id = s(body.id);
      const personne_id = s(body.personne_id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      const updates: Record<string, unknown> = {};
      if (body.date_fin !== undefined) updates.date_fin = body.date_fin ? s(body.date_fin as string) : null;
      if (body.tp_config !== undefined) updates.tp_config = body.tp_config;
      if (body.date_debut !== undefined) updates.date_debut = s(body.date_debut as string);
      if (!Object.keys(updates).length) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
      // Vérification de chevauchement (sauf avec soi-même).
      const newDebut = updates.date_debut ? String(updates.date_debut) : undefined;
      const newFin = updates.date_fin !== undefined ? (updates.date_fin ? String(updates.date_fin) : null) : undefined;
      if (newDebut !== undefined || newFin !== undefined) {
        const { data: cur } = await supabase.from("tp_periode").select("date_debut, date_fin, personne_id").eq("id", id).eq("site_id", site_id).single();
        if (cur) {
          const d = newDebut ?? cur.date_debut;
          const f = newFin !== undefined ? newFin : cur.date_fin;
          const pid = personne_id || cur.personne_id;
          const { data: others } = await supabase
            .from("tp_periode")
            .select("id, date_debut, date_fin")
            .eq("personne_id", pid)
            .eq("site_id", site_id)
            .neq("id", id);
          const overlap = (others ?? []).some((p) => {
            const pFin = p.date_fin ?? "9999-12-31";
            const nFin = f ?? "9999-12-31";
            return d <= pFin && nFin >= p.date_debut;
          });
          if (overlap) return NextResponse.json({ error: "Chevauchement avec une période existante" }, { status: 409 });
        }
      }
      const { data, error } = await supabase
        .from("tp_periode")
        .update(updates)
        .eq("id", id)
        .eq("site_id", site_id)
        .select("id, personne_id, date_debut, date_fin, tp_config, created_at")
        .single();
      if (error) throw error;
      if (data) await syncPersonneTP(supabase, data.personne_id, site_id);
      return NextResponse.json({ periode: data });
    }

    if (op === "tp-periode-delete") {
      const id = s(body.id);
      if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
      // Récupérer l'id de la personne avant suppression.
      const { data: before } = await supabase.from("tp_periode").select("personne_id").eq("id", id).eq("site_id", site_id).single();
      const { error } = await supabase.from("tp_periode").delete().eq("id", id).eq("site_id", site_id);
      if (error) throw error;
      if (before) await syncPersonneTP(supabase, before.personne_id, site_id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Op inconnue" }, { status: 400 });
  } catch (e) {
    // Les erreurs Supabase ne sont PAS des instances de Error : ce sont des
    // objets plats { code, message, details, hint }. `e instanceof Error`
    // renvoyait false et laissait tomber le message reel derriere « Erreur ».
    const err = e as { message?: string; details?: string | null; hint?: string | null; code?: string };
    const msg = err?.message ?? (e instanceof Error ? e.message : "Erreur");
    const complet = [msg, err?.details, err?.hint].filter(Boolean).join(" — ");
    return NextResponse.json({ error: complet || "Erreur" }, { status: 403 });
  }
}
