// Backfill multi-site : pose `app_metadata.site_id` sur chaque compte auth
// existant, a partir de `app_user.site_id` (source de verite en base).
//
// POURQUOI : depuis 2026-08-23, le middleware (src/proxy.ts) deduit le site
// courant de `user.app_metadata.site_id` (inviolable, non modifiable par
// l'utilisateur — contrairement a user_metadata). Les comptes crees AVANT
// cette bascule n'ont que `user_metadata.site_id` : sans ce backfill, ils
// retombent sur le fallback lebignon du middleware. Les comptes crees APRES
// posent deja app_metadata a la creation (/api/users/create, /platform).
//
// Idempotent : ne reecrit un compte que si son app_metadata.site_id differe
// de app_user.site_id. Rejouable sans risque.
//
// Usage : node scripts/backfill-app-metadata-site.mjs [--dry]
//   --dry : n'ecrit rien, affiche seulement ce qui serait modifie.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");

const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY manquants dans .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1) Source de verite : le site de chaque compte, en base.
const { data: appUsers, error: readErr } = await admin
  .from("app_user")
  .select("user_id, email, site_id");
if (readErr) {
  console.error("Lecture app_user impossible :", readErr.message);
  process.exit(1);
}

console.log(`${appUsers.length} compte(s) app_user a examiner.${dry ? "  [DRY RUN]" : ""}\n`);

let maj = 0;
let dejaOk = 0;
let erreurs = 0;

for (const u of appUsers) {
  if (!u.site_id) {
    console.warn(`! ${u.email} : app_user.site_id NULL — ignore (a corriger en base).`);
    erreurs++;
    continue;
  }

  const { data: got, error: getErr } = await admin.auth.admin.getUserById(u.user_id);
  if (getErr || !got?.user) {
    console.warn(`! ${u.email} : compte auth introuvable (${getErr?.message ?? "?"}).`);
    erreurs++;
    continue;
  }

  const actuel = got.user.app_metadata?.site_id ?? null;
  if (actuel === u.site_id) {
    dejaOk++;
    continue;
  }

  if (dry) {
    console.log(`~ ${u.email} : app_metadata.site_id ${actuel ?? "(absent)"} -> ${u.site_id}`);
    maj++;
    continue;
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(u.user_id, {
    app_metadata: { site_id: u.site_id },
  });
  if (updErr) {
    console.error(`x ${u.email} : echec update (${updErr.message}).`);
    erreurs++;
    continue;
  }
  console.log(`+ ${u.email} : app_metadata.site_id -> ${u.site_id}`);
  maj++;
}

console.log(
  `\nTermine. ${maj} ${dry ? "a modifier" : "modifie(s)"}, ${dejaOk} deja OK, ${erreurs} erreur(s).`
);
process.exit(erreurs > 0 ? 1 : 0);
