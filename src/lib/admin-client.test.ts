import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Test statique multi-site : tout fichier qui utilise `getAdminClient()`
// (service_role) DOIT borner ses lectures/écritures par site_id, sauf
// s'il est explicitement whitelisté (rare — /platform, refdata seed,
// lecture de la table `site` elle-même).
//
// Pourquoi : `getAdminClient()` bypass la RLS. Un simple
// `.from("table_metier").select(...)` renvoie alors TOUTES les lignes,
// tous sites confondus. Bug silencieux en mono-site (Lebignon = seul
// contenu), catastrophe dès le second site.
//
// Le test se contente de vérifier la PRÉSENCE de `site_id` (ou
// `site.id`) dans le fichier. C'est une preuve d'intention, pas de
// justesse — un fichier qui a UN insert borné et UNE lecture nue
// passe ce test. Le complément vraiment strict, c'est `.eq("site_id",
// siteId)` sur chaque `.select` ; on ne peut pas le vérifier sans
// parseur, on l'attrapera en revue de code et via les tests
// d'intégration cross-site (PR 7).

const RACINE_SRC = join(process.cwd(), "src");

// Fichiers qui utilisent getAdminClient() SANS borner par site,
// légitimement.
const WHITELIST = new Set<string>([
  // Définition de la fonction — pas un usage.
  join("src", "lib", "supabase-server.ts"),
  // Lit la table `site` (globale, jamais site-scopée) et rien d'autre
  // via admin client.
  join("src", "lib", "current-site.ts"),
  // Lit `site.nom_application` (0095) de la ligne `site` du site courant
  // (`.eq("id", site)`) : même table globale, rien d'autre.
  join("src", "lib", "nom-application-server.ts"),
  // Lit `site.statut` de l'utilisateur courant pour bloquer un site
  // suspendu ou archivé. Cette lecture est LÉGITIMEMENT cross-site :
  // on interroge sur l'id d'app_user, unique global.
  join("src", "lib", "current-user.ts"),
  // Manipule `auth.users` pour générer un lien de mot de passe.
  // Espace auth, hors site.
  join("src", "lib", "password-link.ts"),
  // Back-office super_admin : cross-site par construction. Le test
  // routes-multi-site whiteliste également actions.ts.
  join("src", "app", "platform", "actions.ts"),
  join("src", "app", "platform", "page.tsx"),
  join("src", "app", "platform", "[id]", "page.tsx"),
  join("src", "app", "platform", "nouveau", "page.tsx"),
]);

function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function fichiersSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...fichiersSources(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe("multi-site — getAdminClient() bornée par site_id", () => {
  const tous = fichiersSources(RACINE_SRC);
  const usages = tous.filter((f) => {
    const src = sansCommentaires(readFileSync(f, "utf8"));
    // On veut les vrais APPELS (`getAdminClient()`), pas les imports
    // seuls ni les mentions dans les commentaires.
    return /getAdminClient\s*\(\s*\)/.test(src);
  });

  it("recense les fichiers qui appellent getAdminClient()", () => {
    // Vérifie que le test « voit » la population attendue (ordre de
    // grandeur : ~25 fichiers en 2026-08-21).
    expect(usages.length).toBeGreaterThan(15);
  });

  it("chaque appel getAdminClient() est borné par site_id (ou whitelisté)", () => {
    const fautes: string[] = [];
    for (const f of usages) {
      const rel = f.slice(f.indexOf("src"));
      if (WHITELIST.has(rel)) continue;
      const src = readFileSync(f, "utf8"); // avec commentaires : un commentaire
      // « site_id » explicite compte aussi comme intention documentée
      if (!/\bsite_id\b|\bsite\.id\b|\bp_site\b/.test(src)) {
        fautes.push(rel.replace(/\\/g, "/"));
      }
    }
    expect(
      fautes,
      "Un fichier utilise getAdminClient() sans jamais mentionner site_id.\n" +
        "Le service_role bypass la RLS : chaque .select/.insert doit borner\n" +
        "par site, sinon les données de tous les sites sont exposées ou\n" +
        "mélangées. Ajoutez `.eq('site_id', siteId)` sur les lectures et\n" +
        "`site_id: profile.siteId` sur les écritures, ou whitelistez ce\n" +
        "fichier dans admin-client.test.ts avec la justification."
    ).toEqual([]);
  });
});
