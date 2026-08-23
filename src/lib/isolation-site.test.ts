import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Test statique d'ISOLATION multi-site — volet LECTURE / MODIFICATION.
//
// Complément de `routes-multi-site.test.ts` (qui couvre les INSERT/UPSERT) et
// de `admin-client.test.ts` (qui vérifie qu'un fichier utilisant getAdminClient
// mentionne site_id quelque part). Ce test-ci va plus loin : dans les fichiers
// qui utilisent getAdminClient() (service_role, bypass RLS), CHAQUE lecture
// (.select), modification (.update) ou suppression (.delete) sur une table
// site-scopée doit être bornée par `site_id` dans la même chaîne d'appel
// (.eq("site_id", …) ou .in("site_id", …)).
//
// Pourquoi c'est le maillon manquant : les deux autres tests vérifient la
// PRÉSENCE du mot site_id ; ils laissaient passer une lecture/modification par
// `id` nu (ex. `.update(...).eq("id", x)`), qui — sous service_role — agit sur
// la ligne de N'IMPORTE QUEL site. C'est exactement la classe de faille déjà
// corrigée sur les comptes utilisateurs (userAdminGuard, cf. CLAUDE.md). En
// mono-site le bug est invisible (Lebignon = seul contenu) ; au 2ᵉ site il
// devient une fuite / une écriture croisée.
//
// La règle appliquée est volontairement UNIFORME (« site_id partout », cf.
// tasks/multi-site.md §11) : même une lecture déjà protégée indirectement (par
// un parent lui-même borné au site) doit reposer le filtre. C'est de la défense
// en profondeur, et ça rend la règle vérifiable sans analyseur de flot.
//
// ⚠️ Si ce test échoue, ce n'est pas lui qu'il faut assouplir : c'est la
// requête signalée qu'il faut border (`.eq("site_id", profile.siteId)` /
// `site.id`). Whitelister n'est légitime que pour un accès cross-site par
// construction (super_admin, espace auth), avec justification.

const RACINE_SRC = join(process.cwd(), "src");

// Tables avec `site_id NOT NULL` (mêmes que routes-multi-site.test.ts).
const TABLES_SITE_SCOPEES = new Set<string>([
  "atelier", "ligne", "poste", "equipe", "equipe_chef", "personne",
  "matrice", "personne_competence", "poste_competence_requise",
  "horaire_poste", "horaire_exception", "poste_quart",
  "jour_quart", "ouverture_quart",
  "semaine_type_profil", "semaine_type_quart", "semaine_type_ouverture",
  "rotation_reference", "placement", "absence",
  "contrat_periode", "agence_interim", "parametre_affichage", "tp_periode",
  "motif_absence", "type_contrat", "role_custom", "role_permission",
  "competence", "competence_niveau_libelle", "quart",
]);

// Accès cross-site LÉGITIMES (identique à admin-client.test.ts).
const WHITELIST = new Set<string>([
  join("src", "lib", "supabase-server.ts"),
  join("src", "lib", "current-site.ts"),
  join("src", "lib", "current-user.ts"),
  join("src", "lib", "password-link.ts"),
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

// Fenêtre d'une chaîne : de `.from("table")` jusqu'au prochain `.from(` (ou
// +700 caractères). Approche naïve mais suffisante pour du code bien formé —
// même heuristique que routes-multi-site.test.ts / scan de diagnostic.
type Acces = { table: string; kind: "select" | "update" | "delete"; chaine: string; ligne: number };
function extraireAcces(src: string): Acces[] {
  const out: Acces[] = [];
  const re = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g;
  const pos: { table: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) pos.push({ table: m[1], index: m.index });
  for (let i = 0; i < pos.length; i++) {
    const { table, index } = pos[i];
    const fin = i + 1 < pos.length ? pos[i + 1].index : Math.min(src.length, index + 700);
    const chaine = src.slice(index, fin);
    // Un INSERT/UPSERT (avec sa projection .select) est couvert par
    // routes-multi-site.test.ts : on l'ignore ici pour ne pas doublonner ni
    // faux-positiver sur la projection.
    const posSelect = chaine.indexOf(".select(");
    const avantSelect = posSelect >= 0 ? chaine.slice(0, posSelect) : chaine;
    if (/\.(insert|upsert)\s*\(/.test(avantSelect)) continue;
    let kind: Acces["kind"] | null = null;
    if (/\.update\s*\(/.test(chaine)) kind = "update";
    else if (/\.delete\s*\(/.test(chaine)) kind = "delete";
    else if (/\.select\s*\(/.test(chaine)) kind = "select";
    if (!kind) continue;
    const ligne = src.slice(0, index).split("\n").length;
    out.push({ table, kind, chaine, ligne });
  }
  return out;
}

function borneParSite(chaine: string): boolean {
  return /\.eq\(\s*["']site_id["']/.test(chaine) || /\.in\(\s*["']site_id["']/.test(chaine);
}

describe("isolation multi-site — lectures/écritures getAdminClient bornées par site_id", () => {
  const tous = fichiersSources(RACINE_SRC);
  const usages = tous.filter((f) => {
    const rel = f.slice(f.indexOf("src"));
    if (WHITELIST.has(rel)) return false;
    return /getAdminClient\s*\(\s*\)/.test(sansCommentaires(readFileSync(f, "utf8")));
  });

  it("recense les fichiers admin-client à analyser", () => {
    expect(usages.length).toBeGreaterThan(10);
  });

  it("chaque .select/.update/.delete sur une table site-scopée est borné par site_id", () => {
    const fautes: string[] = [];
    for (const f of usages) {
      const src = sansCommentaires(readFileSync(f, "utf8"));
      for (const a of extraireAcces(src)) {
        if (!TABLES_SITE_SCOPEES.has(a.table)) continue;
        if (borneParSite(a.chaine)) continue;
        const chemin = f.slice(f.indexOf("src")).replace(/\\/g, "/");
        fautes.push(`${chemin}:${a.ligne} — .from("${a.table}").${a.kind}(...) sans .eq("site_id")`);
      }
    }
    expect(
      fautes,
      "Un accès getAdminClient() sur une table site-scopée n'est pas borné par site_id.\n" +
        "Le service_role bypass la RLS : une lecture/modification par `id` nu agit\n" +
        "sur la ligne de N'IMPORTE QUEL site. Ajoutez `.eq(\"site_id\", profile.siteId)`\n" +
        "(ou `site.id`) sur la requête signalée. Ne whitelistez que le cross-site\n" +
        "légitime (super_admin / espace auth), avec justification."
    ).toEqual([]);
  });
});
