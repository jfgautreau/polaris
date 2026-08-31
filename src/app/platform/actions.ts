"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentProfile } from "@/lib/current-user";
import { getAdminClient } from "@/lib/supabase-server";
import { setImpersonation, clearImpersonation, getImpersonationPayload } from "@/lib/impersonation";
import { genererLienMotDePasse, motDePasseAleatoire } from "@/lib/password-link";
import { messageErreur } from "@/lib/erreurs";
import { MODULE_KEYS } from "@/lib/permissions";
import { CLES_MASQUABLES_EXTRA } from "@/lib/site-modules";
import { CLES_RAPPORTS_BILAN } from "@/lib/bilans-rapports";

// Server actions du back-office plateforme. Toutes revérifient que
// l'appelant est bien super_admin — défense en profondeur en plus du
// middleware et du layout.

async function requireSuperAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Non authentifié");
  if (!profile.estSuperAdmin) throw new Error("Accès refusé");
  return { profile, admin: getAdminClient() };
}

// -------------------- Masquage de menus par site (0056) --------------------
// Active/désactive un module (menu) pour un site donné. `masque=true` insère
// une ligne site_module (= module masqué) ; `masque=false` la retire. Réservé
// au super_admin ; l'écriture passe par service_role (bypass RLS). S'applique
// à TOUS les utilisateurs du site, au-dessus de la matrice de droits.
export async function setModuleMasque(siteId: string, moduleKey: string, masque: boolean) {
  const { admin } = await requireSuperAdmin();
  if (
    !MODULE_KEYS.includes(moduleKey) &&
    !CLES_MASQUABLES_EXTRA.includes(moduleKey) &&
    !CLES_RAPPORTS_BILAN.includes(moduleKey)
  ) {
    throw new Error("Élément inconnu");
  }

  if (masque) {
    const { error } = await admin
      .from("site_module")
      .upsert({ site_id: siteId, module_key: moduleKey }, { onConflict: "site_id,module_key" });
    if (error) throw new Error(messageErreur(error) ?? error.message);
  } else {
    const { error } = await admin
      .from("site_module")
      .delete()
      .eq("site_id", siteId)
      .eq("module_key", moduleKey);
    if (error) throw new Error(messageErreur(error) ?? error.message);
  }
  // getModulesMasques n'est pas caché inter-requête : la bascule se reflète
  // à la navigation suivante des utilisateurs du site. On rafraîchit juste la
  // page /platform pour un retour visuel immédiat côté super_admin.
  revalidatePath(`/platform/${siteId}`);
}

// Regex slug : lettres minuscules, chiffres, tirets. Blacklist les
// sous-domaines réservés (utilisés par la plateforme elle-même).
const SLUG_INTERDITS = new Set(["platform", "www", "api", "auth", "admin", "app"]);

function validerSlug(s: string): string | null {
  if (!s) return "Slug requis";
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(s)) {
    return "Slug : 3–32 caractères, lettres/chiffres/tirets, commence par une lettre.";
  }
  if (SLUG_INTERDITS.has(s)) return `Slug « ${s} » réservé.`;
  return null;
}

// -------------------- Création d'un site --------------------
// Crée le site + copie des référentiels depuis un site SOURCE choisi
// (motifs, types de contrat, agences, compétences, échelle niveaux,
// quarts, rôles personnalisés, matrice des droits) + 1er compte admin
// local (email + role='admin' + site_id=<nouveau>). Renvoie un lien de
// mot de passe à transmettre.
//
// Migration 0053 : plus aucune ligne partagée. Chaque nouveau site part
// d'une COPIE de son site source — sinon il démarrerait sans motifs,
// sans compétences, sans quarts, sans droits. Le site source doit être
// choisi par le super_admin dans le formulaire.
export async function createSite(fd: FormData): Promise<void> {
  const { admin } = await requireSuperAdmin();

  const slug = String(fd.get("slug") ?? "").trim().toLowerCase();
  const nom = String(fd.get("nom") ?? "").trim();
  const siteSourceId = String(fd.get("site_source_id") ?? "").trim();
  const emailAdmin = String(fd.get("email_admin") ?? "").trim().toLowerCase();
  const nomAdmin = String(fd.get("nom_admin") ?? "").trim();

  const slugErr = validerSlug(slug);
  if (slugErr) redirect(`/platform/nouveau?err=${encodeURIComponent(slugErr)}`);
  if (!nom) redirect(`/platform/nouveau?err=${encodeURIComponent("Nom du site requis")}`);
  if (!siteSourceId) {
    redirect(`/platform/nouveau?err=${encodeURIComponent("Site source requis (référentiels copiés)")}`);
  }
  if (!emailAdmin || !/^\S+@\S+\.\S+$/.test(emailAdmin)) {
    redirect(`/platform/nouveau?err=${encodeURIComponent("Email admin invalide")}`);
  }

  // 1) Crée le site
  const { data: site, error: siteErr } = await admin
    .from("site")
    .insert({ slug, nom, statut: "actif" })
    .select("id, slug, nom")
    .single<{ id: string; slug: string; nom: string }>();
  if (siteErr) redirect(`/platform/nouveau?err=${encodeURIComponent(messageErreur(siteErr) ?? "Erreur création site")}`);
  if (!site) redirect(`/platform/nouveau?err=${encodeURIComponent("Site non créé")}`);

  // 2) Crée le compte auth du 1er admin local
  // user_metadata.site_id : lu par le trigger handle_new_user.
  // app_metadata.site_id  : source inviolable du site courant cote
  // middleware (cf. src/proxy.ts) — non modifiable par l'utilisateur.
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: emailAdmin,
    password: motDePasseAleatoire(),
    email_confirm: true,
    user_metadata: { name: nomAdmin, site_id: site.id },
    app_metadata: { site_id: site.id },
  });
  if (authErr) {
    // Rollback partiel : on essaie de supprimer le site créé pour ne
    // pas laisser un site sans admin. Si le rollback échoue lui aussi,
    // on le loggue mais on remonte l'erreur d'origine (createUser).
    const { error: rollbackErr } = await admin.from("site").delete().eq("id", site.id);
    if (rollbackErr) console.error("[createSite] rollback échec :", rollbackErr.message);
    redirect(`/platform/nouveau?err=${encodeURIComponent(`Auth: ${authErr.message}`)}`);
  }

  // 3) Le trigger handle_new_user a créé une ligne app_user via metadata.
  //    On force son role, son nom, son site et son statut actif.
  if (authData.user) {
    const { error: majErr } = await admin
      .from("app_user")
      .update({ role: "admin", name: nomAdmin, is_active: true, site_id: site.id })
      .eq("user_id", authData.user.id);
    if (majErr) {
      redirect(`/platform/nouveau?err=${encodeURIComponent(`Update: ${majErr.message}`)}`);
    }
  }

  // 4) Seed : parametre_affichage (fenêtre TV J-1 → J+4).
  const { error: seedErr } = await admin
    .from("parametre_affichage")
    .insert({ site_id: site.id, jours_avant: 1, jours_apres: 4 });
  if (seedErr) {
    console.error("[createSite] seed parametre_affichage :", seedErr.message);
    // Non bloquant : la fenêtre TV a des valeurs par défaut applicatives.
  }

  // 5) COPIE DES RÉFÉRENTIELS depuis le site source (migration 0053).
  //    Chaque référentiel est copié en une passe. Un échec sur l'un des
  //    référentiels n'annule pas le site (les données manquantes se
  //    ressaisissent depuis les écrans /admin/*), mais on trace.
  await copierReferentiels(admin, siteSourceId, site.id);

  // 6) Génère le lien de mot de passe à transmettre
  let lien = "";
  try {
    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host") ?? "localhost"}`;
    lien = await genererLienMotDePasse(emailAdmin, origin);
  } catch (e) {
    lien = `Erreur génération : ${e instanceof Error ? e.message : String(e)}`;
  }

  revalidatePath("/platform");
  redirect(`/platform/${site.id}?created=1&lien=${encodeURIComponent(lien)}`);
}

// Copie les référentiels site-scopés d'un site source vers un site cible
// (migration 0053). Ordre volontaire :
//   1. motif_absence, agence_interim, type_contrat, competence,
//      competence_niveau_libelle, quart — indépendants entre eux.
//   2. role_custom (avant role_permission qui peut le référencer).
//   3. role_permission — pose la matrice des droits comme sur le source.
//
// Toutes les insertions passent par le client admin (service_role), avec
// site_id explicite pour ne pas retomber sur le fallback lebignon du
// trigger set_site_id_from_context. Les erreurs sont journalisées sans
// interrompre la chaîne : l'écran de détail affiche le lien admin même
// si un référentiel a partiellement échoué.
type AdminClient = Awaited<ReturnType<typeof import("@/lib/supabase-server").getAdminClient>>;
async function copierReferentiels(admin: AdminClient, sourceId: string, cibleId: string): Promise<void> {
  // --- Motifs d'absence ---
  {
    const { data } = await admin
      .from("motif_absence")
      .select("libelle, code_court, couleur, actif")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("motif_absence").insert(rows);
      if (error) console.error("[createSite] copie motifs :", error.message);
    }
  }

  // --- Agences d'intérim ---
  {
    const { data } = await admin
      .from("agence_interim")
      .select("nom, actif")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("agence_interim").insert(rows);
      if (error) console.error("[createSite] copie agences :", error.message);
    }
  }

  // --- Types de contrat ---
  {
    const { data } = await admin
      .from("type_contrat")
      .select("code, libelle, actif, ordre")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("type_contrat").insert(rows);
      if (error) console.error("[createSite] copie types de contrat :", error.message);
    }
  }

  // --- Compétences (catalogue) ---
  {
    const { data } = await admin
      .from("competence")
      .select("nom, type, a_recycler, duree_validite_mois, actif, categorie, groupe, ordre, a_autorisation_conduite")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("competence").insert(rows);
      if (error) console.error("[createSite] copie compétences :", error.message);
    }
  }

  // --- Échelle des niveaux (0..4) ---
  {
    const { data } = await admin
      .from("competence_niveau_libelle")
      .select("niveau, libelle")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("competence_niveau_libelle").insert(rows);
      if (error) console.error("[createSite] copie échelle niveaux :", error.message);
    }
  }

  // --- Config d'échelle portée par `site` (nb_niveaux 0061, seuil_competent
  //     0062) : on recopie les réglages du site source sur le site créé.
  {
    const { data } = await admin
      .from("site")
      .select("nb_niveaux, seuil_competent")
      .eq("id", sourceId)
      .single<{ nb_niveaux: number; seuil_competent: number }>();
    if (data) {
      const maj: { nb_niveaux?: number; seuil_competent?: number } = {};
      if (data.nb_niveaux) maj.nb_niveaux = data.nb_niveaux;
      if (data.seuil_competent) maj.seuil_competent = data.seuil_competent;
      if (Object.keys(maj).length > 0) {
        const { error } = await admin.from("site").update(maj).eq("id", cibleId);
        if (error) console.error("[createSite] copie config échelle :", error.message);
      }
    }
  }

  // --- Quarts (code, libelle, ordre, debut, fin) ---
  //    La PK est composite (code, site_id) : recopier sous le nouveau
  //    site_id ne crée aucun conflit.
  {
    const { data } = await admin
      .from("quart")
      .select("code, libelle, ordre, debut, fin, rotation, creneau")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("quart").insert(rows);
      if (error) console.error("[createSite] copie quarts :", error.message);
    }
  }

  // --- Rôles personnalisés (role_custom) ---
  {
    const { data } = await admin
      .from("role_custom")
      .select("code, libelle")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("role_custom").insert(rows);
      if (error) console.error("[createSite] copie rôles custom :", error.message);
    }
  }

  // --- Matrice des droits (role_permission) ---
  //    Copié APRÈS role_custom : la matrice peut nommer un rôle custom.
  {
    const { data } = await admin
      .from("role_permission")
      .select("role, module, niveau")
      .eq("site_id", sourceId);
    if (data && data.length > 0) {
      const rows = data.map((r) => ({ ...r, site_id: cibleId }));
      const { error } = await admin.from("role_permission").insert(rows);
      if (error) console.error("[createSite] copie matrice droits :", error.message);
    }
  }
}

// -------------------- Suspendre / Réactiver / Archiver --------------------
export async function changerStatut(fd: FormData): Promise<void> {
  const { admin } = await requireSuperAdmin();
  const id = String(fd.get("id") ?? "");
  const statut = String(fd.get("statut") ?? "");
  if (!id) redirect("/platform");
  if (!["actif", "suspendu", "archive"].includes(statut)) {
    redirect(`/platform/${id}?err=${encodeURIComponent("Statut invalide")}`);
  }

  const { error } = await admin
    .from("site")
    .update({ statut })
    .eq("id", id);
  if (error) {
    redirect(`/platform/${id}?err=${encodeURIComponent(messageErreur(error) ?? "Erreur")}`);
  }

  revalidatePath("/platform");
  revalidatePath(`/platform/${id}`);
  redirect(`/platform/${id}?ok=1`);
}

// -------------------- Impersonation : entrer dans un site --------------------
export async function entrerDansLeSite(fd: FormData): Promise<void> {
  const { profile, admin } = await requireSuperAdmin();
  const id = String(fd.get("id") ?? "");
  const raison = String(fd.get("raison") ?? "").trim() || null;
  if (!id) redirect("/platform");

  // Vérifie que le site existe et est actif (pas d'impersonation sur
  // un site archivé — un archive doit être ré-activé avant d'y entrer).
  const { data: site } = await admin
    .from("site")
    .select("id, statut")
    .eq("id", id)
    .single<{ id: string; statut: string }>();
  if (!site) redirect(`/platform?err=${encodeURIComponent("Site introuvable")}`);
  if (site.statut === "archive") {
    redirect(`/platform/${id}?err=${encodeURIComponent("Impossible d'entrer dans un site archivé")}`);
  }

  // Trace l'entrée en mode support
  const h = await headers();
  const { data: audit, error: auditErr } = await admin
    .from("audit_impersonation")
    .insert({
      super_admin_id: profile.authId,
      site_id: id,
      ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null,
      user_agent: h.get("user-agent") ?? null,
      raison,
    })
    .select("id")
    .single<{ id: string }>();
  if (auditErr || !audit) {
    redirect(`/platform/${id}?err=${encodeURIComponent(auditErr?.message ?? "audit KO")}`);
  }

  await setImpersonation(id, audit.id);
  redirect("/");
}

// -------------------- Sortir du mode support --------------------
export async function sortirDuMode(): Promise<void> {
  const { admin } = await requireSuperAdmin();
  const payload = await getImpersonationPayload();
  if (payload) {
    // Trace best-effort : si l'update échoue, on log mais on ne bloque
    // pas la sortie du mode (le cookie doit être effacé quoi qu'il arrive).
    const { error: traceErr } = await admin
      .from("audit_impersonation")
      .update({ exited_at: new Date().toISOString() })
      .eq("id", payload.auditId);
    if (traceErr) console.error("[sortirDuMode] trace fin échec :", traceErr.message);
  }
  await clearImpersonation();
  redirect("/platform");
}
