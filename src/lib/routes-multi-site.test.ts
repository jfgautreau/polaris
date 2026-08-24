import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Test statique multi-site (migrations 0043 + 0053) :
//
// Toute route API OU server action qui écrit dans une table site-scopée
// (site_id NOT NULL) doit poser `site_id` sur ses insertions et sur ses
// upserts. Le trigger `set_site_id_from_context` sert de filet, mais
// `getAdminClient()` (service_role) n'a pas d'auth.uid() : le fallback
// finirait sur lebignon, écrivant les données d'un autre site chez le
// site historique — bug silencieux, invisible en tests intégration
// mono-site.
//
// La règle testée ici est simple : chaque appel `.from("<site-scoped>").insert(`
// ou `.upsert(` doit contenir « site_id » dans son bloc d'argument. Un
// appel qui laisse le trigger décider est refusé (motif : le trigger
// tombe en fallback lebignon avec le service_role).
//
// L'intégrité inter-site est également garantie par les RLS + les
// composite FKs sur quart (§F de la 0053), mais les tests intégration
// (à venir en PR 7) sont le vrai endroit pour vérifier ça — pas un
// grep statique.

const RACINE_SRC = join(process.cwd(), "src");

// Tables site-scopées avec `site_id NOT NULL`. Deux catégories, même
// contrainte : chaque INSERT/UPSERT doit poser site_id.
//   - Locales, ajoutées en 0043 §D.
//   - Anciennes tables partagées, passées NOT NULL en 0053.
const TABLES_SITE_SCOPEES = new Set<string>([
  // 0043 locales
  "atelier", "ligne", "poste", "equipe", "equipe_chef", "personne",
  "matrice", "personne_competence", "poste_competence_requise",
  "horaire_poste", "horaire_exception", "poste_quart",
  "jour_quart", "ouverture_quart",
  "semaine_type_profil", "semaine_type_quart", "semaine_type_ouverture",
  "rotation_reference",
  "placement", "absence",
  "contrat_periode", "agence_interim", "parametre_affichage",
  // 0049 / 0052
  "tp_periode",
  // 0053
  "motif_absence", "type_contrat", "role_custom", "role_permission",
  "competence", "competence_niveau_libelle", "quart",
  // 0054
  // (personne_competence déjà listée ci-dessus)
  // 0056
  "site_module",
]);

// Fichiers exclus : gestion cross-site (super_admin) ou déjà encadrée
// par une garde qui pose site_id ailleurs (fonction SQL RPC, etc.).
//
// - /platform/actions.ts : back-office super_admin, écrit dans TOUS
//   les sites (copierReferentiels notamment) — site_id est passé
//   dynamiquement depuis chaque ligne source.
// - /api/users/* : app_user est site-scopée mais la création passe
//   par un flow spécifique (metadata → handle_new_user + update). Le
//   site_id y est bien posé, mais dans un pattern non uniforme.
// - Tests : rien à valider.
const EXCLUS = [
  join("src", "app", "platform", "actions.ts"),
];

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

// Extrait tous les appels `.from("<table>").insert(...)` et `.upsert(...)`
// avec le bloc entre parenthèses correspondant. Approche naïve (compteur
// de parenthèses) mais suffisante pour du TS/JSX bien formé.
//
// ⚠️ Regex strict entre `.from(...)` et `.insert(` : seule une chaîne
// **directe** est acceptée (whitespace uniquement). Sinon un regex
// non-greedy `[\s\S]*?` traversait d'autres `.from(...)` et attribuait
// la mauvaise table à l'insert (ex : `.from("X").select(...).eq(...)`
// suivi plus loin de `.from("Y").insert(...)` — mon regex captait X
// avec l'insert de Y).
type Appel = { table: string; op: "insert" | "upsert"; contenu: string; index: number };
function extraireEcritures(src: string): Appel[] {
  const out: Appel[] = [];
  const re = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)\s*\.(insert|upsert)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const table = m[1];
    const op = m[2] as "insert" | "upsert";
    const debut = m.index + m[0].length;
    // Compteur de parenthèses depuis `debut`. On accepte des () imbriqués
    // (map/spread/etc.). Attention aux chaînes et backticks — pour rester
    // simple, on s'appuie sur du code bien formé : chaînes bien fermées,
    // pas de `)` orphelin dans les commentaires (déjà retirés).
    let profondeur = 1;
    let i = debut;
    while (i < src.length && profondeur > 0) {
      const c = src[i];
      if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
      i++;
    }
    const fin = i - 1; // position du ')' fermant
    const contenu = src.slice(debut, fin);
    out.push({ table, op, contenu, index: m.index });
  }
  return out;
}

describe("multi-site — INSERT/UPSERT sur tables site-scopées", () => {
  const tous = fichiersSources(RACINE_SRC).filter((f) => !EXCLUS.some((e) => f.endsWith(e)));

  it("trouve bien des fichiers à analyser", () => {
    expect(tous.length).toBeGreaterThan(50);
  });

  it("chaque INSERT/UPSERT sur une table site-scopée pose site_id", () => {
    const fautes: string[] = [];
    for (const f of tous) {
      const src = sansCommentaires(readFileSync(f, "utf8"));
      const appels = extraireEcritures(src);
      if (appels.length === 0) continue;
      // Approche pragmatique : deux règles complémentaires.
      //   - Si l'argument est un objet inline (`{ ... }`), il DOIT
      //     contenir `site_id` — le trigger fallback ne peut pas s'en
      //     charger sous service_role.
      //   - Si l'argument est une variable/expression (`ups`,
      //     `rows.map(...)`), on ne peut pas la parser sans un vrai
      //     analyseur TS. On se rabat sur la présence de `site_id`
      //     n'importe où dans le fichier : elle atteste qu'un
      //     développeur y a explicitement pensé (pattern uniforme du
      //     projet — voir refdata.ts, /admin/*/actions.ts, /api/*).
      //     Faux négatif possible mais tolérable — cas rare (le motif
      //     est repérable au diff), et l'intégration cross-site en
      //     PR 7 est le vrai filet.
      const fichierContientSiteId = /\bsite_id\b/.test(src);
      for (const a of appels) {
        if (!TABLES_SITE_SCOPEES.has(a.table)) continue;
        const contenuNet = a.contenu.trim();
        const inline = contenuNet.startsWith("{") || contenuNet.startsWith("[{");
        const ok = inline
          ? /\bsite_id\b/.test(a.contenu)
          : fichierContientSiteId;
        if (!ok) {
          const chemin = f.slice(f.indexOf("src")).replace(/\\/g, "/");
          fautes.push(`${chemin} :: .from("${a.table}").${a.op}(...) — site_id manquant`);
        }
      }
    }
    expect(
      fautes,
      "Un INSERT/UPSERT sur une table site-scopée ne pose pas site_id.\n" +
        "Le trigger set_site_id_from_context tombera en fallback lebignon\n" +
        "avec le service_role (auth.uid() = NULL). Poser `site_id: profile.siteId`\n" +
        "ou `site_id: site.id` sur l'objet inséré."
    ).toEqual([]);
  });
});
