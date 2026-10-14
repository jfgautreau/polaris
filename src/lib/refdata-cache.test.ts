import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Test statique multi-site : tout `unstable_cache(...)` doit segmenter
// sa clé de cache par site.
//
// Next.js compose la clé d'une entrée `unstable_cache` avec (a) la
// clé/tags donnée en 2e argument ET (b) les arguments passés à la
// fonction cachée. Si la fonction cachée n'a AUCUN argument site-scopé,
// Site A et Site B partagent la même entrée : le second qui charge
// verra les données du premier. Bug silencieux, invisible en dev
// mono-site.
//
// Convention adoptée dans refdata.ts : chaque fonction cachée prend
// `site: string` en premier argument, et l'appelant public
// (`getXC()`) fait `await siteId()` pour le passer. Ce test verrouille
// la convention : si un futur `unstable_cache(async () => …)` apparaît
// sans argument site, il faut soit ajouter cet argument, soit
// documenter (whitelist ci-dessous) pourquoi la donnée est vraiment
// globale à toute la plateforme.

const RACINE_SRC = join(process.cwd(), "src");

// `unstable_cache(async (nomArg[: type][, …]) => …)` — le premier
// argument doit ressembler à un identifiant de site.
const ARG_SITE = /^\s*(site|siteId|site_id)\b/;

// Whitelist : entrées dont la donnée est LEGITIMEMENT globale à toute
// la plateforme (aucun `site` en argument). Vide aujourd'hui : depuis
// la 0053, aucune donnée n'est plus partagée entre sites. Si un
// besoin réel apparaît (ex : liste des slugs de sites pour /platform),
// ajouter le nom de la variable ici avec la justification.
const WHITELIST_GLOBAL = new Set<string>([
  // current-user.ts : ligne app_user de l'utilisateur connecté, clé = user_id
  // (unique sur toute la plateforme). C'est cette ligne qui DIT le site : elle
  // ne peut pas être segmentée par un site qu'on ne connaît pas encore.
  "lireProfil",
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

// Extrait, pour chaque usage `unstable_cache(...)`, la signature de la
// fonction cachée : le nom éventuel de la variable receveuse (`const X = `),
// et la liste des paramètres de la fonction.
type Usage = { fichier: string; variable: string | null; params: string };
function extraireUsages(src: string): Usage[] {
  const out: Usage[] = [];
  const re = /(?:const\s+(\w+)\s*=\s*)?unstable_cache\s*\(\s*async\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ fichier: "", variable: m[1] ?? null, params: m[2] });
  }
  return out;
}

describe("multi-site — cache Next.js segmenté par site", () => {
  const tous = fichiersSources(RACINE_SRC);
  const usages: Usage[] = [];
  for (const f of tous) {
    const src = sansCommentaires(readFileSync(f, "utf8"));
    for (const u of extraireUsages(src)) {
      usages.push({ ...u, fichier: f });
    }
  }

  it("trouve bien des `unstable_cache(...)` à analyser", () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it("chaque `unstable_cache` reçoit un argument site (ou est whitelisté)", () => {
    const fautes: string[] = [];
    for (const u of usages) {
      const chemin = u.fichier.slice(u.fichier.indexOf("src")).replace(/\\/g, "/");
      const nom = u.variable ?? "(anonyme)";
      if (u.variable && WHITELIST_GLOBAL.has(u.variable)) continue;
      if (!ARG_SITE.test(u.params)) {
        fautes.push(`${chemin} :: ${nom} — premier paramètre n'est pas site/siteId (params="${u.params.trim()}")`);
      }
    }
    expect(
      fautes,
      "Un `unstable_cache` sans argument site sert les mêmes données à\n" +
        "tous les sites. Ajouter `site: string` en premier paramètre et\n" +
        "le passer depuis l'appelant public, comme dans refdata.ts."
    ).toEqual([]);
  });
});
