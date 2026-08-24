import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { ROLES, type Role } from "@/lib/roles";

export type Niveau = "none" | "read" | "write";

// Modules de l'application. `admin: true` = page de gestion (menu visible si
// droit d'ecriture) ; sinon module operationnel (menu visible des la lecture).
export const MODULES: { key: string; label: string; href: string; admin: boolean }[] = [
  { key: "personnel", label: "Personnel", href: "/personnel", admin: false },
  { key: "matrice", label: "Matrice", href: "/matrice", admin: false },
  { key: "habilitations", label: "Habilitations", href: "/habilitations", admin: false },
  { key: "planning", label: "Planning", href: "/planning", admin: false },
  { key: "placement", label: "Placement", href: "/placement", admin: false },
  { key: "ordonnancement", label: "Ordonnancement", href: "/ordonnancement", admin: false },
  { key: "bilans", label: "Bilans", href: "/bilans", admin: false },
  { key: "journal", label: "Journal", href: "/journal", admin: false },
  { key: "affichage", label: "Affichage", href: "/affichage", admin: false },
  { key: "referentiel", label: "Référentiel", href: "/admin/referentiel", admin: true },
  { key: "equipes", label: "Équipes", href: "/admin/equipes", admin: true },
  { key: "competences", label: "Compétences", href: "/admin/competences", admin: true },
  { key: "habilitations_param", label: "Param. Habilitation", href: "/admin/habilitations-param", admin: true },
  // Cle `motifs` conservee : elle est stockee dans role_permission, la renommer
  // reinitialiserait les droits deja accordes. Seul le libelle a change, l'ecran
  // couvrant desormais les motifs d'absence ET les agences d'interim.
  { key: "motifs", label: "Param. RH", href: "/admin/motifs", admin: true },
  { key: "horaires", label: "Horaires", href: "/admin/horaires", admin: true },
  { key: "utilisateurs", label: "Utilisateurs", href: "/admin/users", admin: true },
  { key: "rgpd", label: "RGPD", href: "/admin/rgpd", admin: true },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export type Perms = Record<string, Niveau>;

const NONE: Perms = Object.fromEntries(MODULE_KEYS.map((k) => [k, "none"]));

// Droits par defaut (utilises tant qu'aucune ligne ne les surcharge en base).
export function defaultsFor(role: string): Perms {
  if (role === "admin") return Object.fromEntries(MODULE_KEYS.map((k) => [k, "write"]));
  const p: Perms = { ...NONE };
  const set = (o: Partial<Perms>) => Object.assign(p, o);
  switch (role) {
    case "chef_equipe":
      // Placement suit Planning : c'est le meme travail par une autre saisie.
      set({ personnel: "read", bilans: "read", matrice: "write", habilitations: "write", planning: "write", placement: "write" });
      break;
    case "ordo":
      set({ personnel: "read", matrice: "read", habilitations: "read", planning: "read", bilans: "read", ordonnancement: "write" });
      break;
    case "rh":
      set({ personnel: "read", matrice: "read", habilitations: "read", planning: "read", bilans: "read" });
      break;
    case "codir":
      set({ personnel: "read", matrice: "read", habilitations: "read", planning: "read", ordonnancement: "read", bilans: "read", journal: "read" });
      break;
    case "planning":
      set({ personnel: "read", matrice: "read", habilitations: "read", planning: "read", ordonnancement: "read", bilans: "read" });
      break;
  }
  return p;
}

export function canRead(p: Perms, mod: string): boolean {
  return p[mod] === "read" || p[mod] === "write";
}
export function canWrite(p: Perms, mod: string): boolean {
  return p[mod] === "write";
}

// Ordre des niveaux, pour comparer deux profils de droits.
export const RANG: Record<Niveau, number> = { none: 0, read: 1, write: 2 };

// Vrai si les droits de `role` sont ENTIEREMENT couverts par ceux de `appelant` :
// nulle part `role` ne detient plus que lui.
//
// C'est la regle « on ne donne pas ce qu'on n'a pas », et c'est la MATRICE qui la
// calcule — aucun nom de role n'est ecrit ici. Un titulaire du droit
// « utilisateurs: write » ne peut donc pas se fabriquer un compte plus puissant
// que lui puis s'y connecter (le lien de mot de passe est affiche en clair), ni
// retrograder un compte qui le domine. Si la matrice accorde un jour tous les
// modules a un role, ce role pourra promouvoir admin : c'est cohérent, il aura
// deja tous les droits.
export async function droitsCouvertsPar(role: string, appelant: string): Promise<boolean> {
  if (role === appelant) return true;
  const [cible, moi] = await Promise.all([getPermissions(role), getPermissions(appelant)]);
  return MODULE_KEYS.every((m) => RANG[cible[m] ?? "none"] <= RANG[moi[m] ?? "none"]);
}

// Le rôle « tout-puissant » : celui à qui `defaultsFor` accorde l'écriture sur
// TOUS les modules. Il vaut `admin` aujourd'hui, mais il est **déduit** de la
// matrice, pas écrit en dur — si la liste des rôles change, la règle suit.
//
// Ses droits ne sont modifiables par personne : c'est le socle sur lequel repose
// la possibilité de réparer tout le reste. Le laisser modifiable, c'est offrir à
// un délégué `utilisateurs: write` le moyen de déclasser l'administration.
export const ROLE_TOUT_PUISSANT: string | undefined = ROLES.find((r) =>
  MODULE_KEYS.every((m) => defaultsFor(r)[m] === "write")
);

// Un rôle est-il modifiable dans la matrice des droits par `appelant` ?
//
// Deux verrous, aucun nom de rôle littéral :
//  - **anti-verrou** : on ne touche pas à SON PROPRE rôle. Sinon on se retire
//    `utilisateurs` et plus personne ne rouvre l'écran.
//  - **protection du rôle tout-puissant** : la colonne de l'admin reste visible,
//    affichant ses droits réels, mais grisée — pour tout le monde, lui compris.
//
// Ce que ces verrous ne couvrent PAS, volontairement : un délégué peut abaisser
// les droits d'un rôle intermédiaire. Ce n'est pas une escalade (il ne gagne
// rien), c'est une nuisance — désormais tracée au journal (migration 0036).
// Interdire aussi cela reviendrait à n'autoriser que les rôles strictement plus
// faibles que soi, et comme les rôles ne sont pas ordonnés entre eux, la matrice
// deviendrait entièrement grisée pour tout autre qu'un admin.
export async function roleModifiablePar(role: string, appelant: string): Promise<boolean> {
  if (role === appelant) return false;
  if (role === ROLE_TOUT_PUISSANT) return false;
  return true;
}

// Décision complète d'un changement de droit (rôle × module → niveau), pour
// /api/droits. Rendue ici plutôt que dans la route : c'est la règle de sécurité,
// elle doit être testable sans passer par HTTP.
export async function verifierChangementDroit(
  appelant: string,
  role: string,
  module: string,
  niveau: Niveau
): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
  if (role === appelant) {
    return { ok: false, status: 400, error: "Vous ne pouvez pas modifier les droits de votre propre rôle." };
  }
  if (role === ROLE_TOUT_PUISSANT) {
    return { ok: false, status: 403, error: "L'administrateur conserve tous les droits." };
  }
  const miens = await getPermissions(appelant);
  if (RANG[niveau] > RANG[miens[module] ?? "none"]) {
    return { ok: false, status: 403, error: "Vous ne pouvez pas accorder un droit que vous n'avez pas vous-même." };
  }
  return { ok: true };
}

// Écriture "complète" d'un module (édite tout le monde / global) selon la matrice
// des droits -> client admin dans les API. Le CHEF D'ÉQUIPE en est exclu : il
// garde uniquement son périmètre (édition de SON équipe via la RLS
// can_edit_personne), même si le module est en "write".
export async function canWriteModule(role: string, mod: string): Promise<boolean> {
  if (role === "chef_equipe") return false;
  return canWrite(await getPermissions(role), mod);
}

// Écriture « complète » des données de placement (bypass RLS dans les API).
// La table `placement` est alimentée par DEUX écrans — Planning et Placement —
// qui ont chacun leur droit : l'un ou l'autre suffit. Sans ce « ou », activer
// Placement seul donnerait un écran où aucune saisie ne s'enregistre, et retirer
// Placement casserait la saisie du Planning.
export async function canWritePlacementData(role: string): Promise<boolean> {
  return (await canWriteModule(role, "planning")) || (await canWriteModule(role, "placement"));
}

// Droits effectifs d'un role = defauts surchargés par la table role_permission.
// `cache()` : dedupe la requete role_permission par role sur toute la requete HTTP.
//
// MULTI-SITE : depuis 0053, role_permission.site_id est NOT NULL. La RLS filtre
// déjà par site_id = current_site_id(), mais on ajoute `.eq('site_id', siteId)`
// explicite (défense en profondeur + planner Postgres qui touche l'index composite).
export const getPermissions = cache(async function getPermissions(role: string): Promise<Perms> {
  const p = defaultsFor(role);
  try {
    const { getCurrentSite } = await import("@/lib/current-site");
    const [supabase, site] = await Promise.all([getServerClient(), getCurrentSite()]);
    const { data } = await supabase
      .from("role_permission")
      .select("module, niveau")
      .eq("role", role)
      .eq("site_id", site.id)
      .returns<{ module: string; niveau: Niveau }[]>();
    for (const r of data ?? []) if (r.module in p) p[r.module] = r.niveau;
  } catch {
    // table absente ou erreur : on garde les defauts
  }
  return p;
});

// Tous les droits effectifs (pour l'editeur de la matrice).
// `rolesSupplementaires` : codes des roles personnalises (role_custom) a inclure
// en plus des roles integres. Ils partent de defaultsFor(code)=NONE, puis les
// lignes role_permission les surchargent comme les autres.
//
// MULTI-SITE : filtre explicite par site (RLS le fait déjà, on ajoute .eq
// pour l'indice au planner et défense en profondeur).
export async function getAllPermissions(rolesSupplementaires: string[] = []): Promise<Record<string, Perms>> {
  const all: Record<string, Perms> = {};
  for (const r of ROLES) all[r] = defaultsFor(r);
  for (const r of rolesSupplementaires) if (!all[r]) all[r] = defaultsFor(r);
  try {
    const { getCurrentSite } = await import("@/lib/current-site");
    const [supabase, site] = await Promise.all([getServerClient(), getCurrentSite()]);
    const { data } = await supabase
      .from("role_permission")
      .select("role, module, niveau")
      .eq("site_id", site.id)
      .returns<{ role: string; module: string; niveau: Niveau }[]>();
    for (const row of data ?? []) {
      if (all[row.role] && row.module in all[row.role]) all[row.role][row.module] = row.niveau;
    }
  } catch {
    /* defauts */
  }
  return all;
}

// Garde d'ecriture d'un module, pour les server actions et les routes API.
// C'est LA matrice qui decide : l'admin l'emporte parce qu'elle lui accorde tout,
// pas parce que son nom serait ecrit en dur ici.
//
// Renvoie le client admin : les tables de parametrage sont protegees par une RLS
// `is_admin()`, un titulaire du droit qui ne serait pas admin ne pourrait rien
// ecrire sans cela. canWriteModule exclut le chef d'equipe par construction, il ne
// peut donc pas obtenir ce client (cf. son commentaire).
export async function requireModuleWrite(mod: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Non authentifié.");
  if (!(await canWriteModule(profile.role, mod))) {
    throw new Error("Accès refusé.");
  }
  const { getAdminClient } = await import("@/lib/supabase-server");
  return getAdminClient();
}

// Meme garde, pour une ROUTE API : au lieu de lever, elle rend de quoi repondre.
//
// ⚠️ A utiliser des qu'une route ecrit dans une table de parametrage. Ces tables
// portent une RLS qui nomme des ROLES en dur (`is_admin()`, `has_role('ordo')`) :
// se contenter du client RLS fait echouer en silence tout titulaire du droit qui
// ne porte pas l'un de ces roles — l'ecran propose alors un bouton qui repond 403.
// C'est la matrice qui decide, la RLS n'est plus qu'un filet de securite.
export async function moduleWriteGuard(mod: string): Promise<
  | { ok: true; profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>; supabase: Awaited<ReturnType<typeof import("@/lib/supabase-server").getAdminClient>> }
  | { ok: false; status: 401 | 403; error: string }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: "Non authentifié" };
  if (!(await canWriteModule(profile.role, mod))) {
    return { ok: false, status: 403, error: "Accès refusé" };
  }
  const { getAdminClient } = await import("@/lib/supabase-server");
  return { ok: true, profile, supabase: getAdminClient() };
}

// Garde des routes de GESTION DE COMPTES (creation, role, activation, lien de
// mot de passe). Elle ajoute a `moduleWriteGuard("utilisateurs")` le controle
// anti-escalade : l'appelant ne peut agir que sur un compte dont les droits ne
// depassent nulle part les siens.
//
// `cibleUserId` : le compte vise, s'il existe deja.
// `roleVise`    : le role que l'on cherche a attribuer, le cas echeant.
export async function userAdminGuard(opts: { cibleUserId?: string; roleVise?: string } = {}): Promise<
  | { ok: true; profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>; supabase: Awaited<ReturnType<typeof import("@/lib/supabase-server").getAdminClient>> }
  | { ok: false; status: 401 | 403 | 404; error: string }
> {
  const garde = await moduleWriteGuard("utilisateurs");
  if (!garde.ok) return garde;

  // On ne s'attribue pas un role qu'on ne detient pas soi-meme.
  if (opts.roleVise && !(await droitsCouvertsPar(opts.roleVise, garde.profile.role))) {
    return { ok: false, status: 403, error: "Ce rôle accorde des droits que vous n'avez pas vous-même." };
  }

  // On ne touche pas a un compte qui nous domine (promotion comme retrogradation).
  //
  // MULTI-SITE : on ne touche pas non plus a un compte d'un AUTRE site (a
  // l'exception du super_admin qui gere le parc entier). Sans cette borne,
  // un admin du site A modifiait potentiellement les comptes du site B
  // via leur user_id UUID (unique global). La lecture est deja bornee par
  // site via la RLS d'app_user, mais garde.supabase est un client admin
  // (service_role) : il bypass la RLS, d'ou le .eq("site_id", ...) explicite
  // ci-dessous.
  if (opts.cibleUserId && opts.cibleUserId !== garde.profile.authId) {
    let query = garde.supabase
      .from("app_user")
      .select("role, site_id")
      .eq("user_id", opts.cibleUserId);
    if (!garde.profile.estSuperAdmin) {
      query = query.eq("site_id", garde.profile.siteId);
    }
    const { data: cible } = await query.maybeSingle<{ role: string; site_id: string }>();
    if (!cible) return { ok: false, status: 404, error: "Compte introuvable" };
    if (!(await droitsCouvertsPar(cible.role, garde.profile.role))) {
      return { ok: false, status: 403, error: "Ce compte détient des droits que vous n'avez pas vous-même." };
    }
  }
  return garde;
}

export type { Role };

// Garde d'acces a un module pour une page. Redirige si droit insuffisant.
export async function requireModule(module: string, level: "read" | "write") {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Masquage par site (0056) : un module désactivé pour ce site est
  // inaccessible pour TOUT LE MONDE, au-dessus de la matrice de droits.
  // Blocage réel : on redirige vers l'accueil (jamais vers /planning, qui
  // peut lui-même être masqué → boucle).
  const { getModulesMasquesC } = await import("@/lib/site-modules");
  if ((await getModulesMasquesC()).has(module)) redirect("/");
  const perms = await getPermissions(profile.role);
  const ok = level === "write" ? canWrite(perms, module) : canRead(perms, module);
  if (!ok) redirect("/planning");
  return { profile, perms };
}
