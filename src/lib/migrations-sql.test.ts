import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// La 0086 a été commitée avec quatre corps de fonction délimités par `$` au
// lieu de `$$` : le SQL Editor la refusait en bloc (« syntax error at or near
// "$" »), elle n'a jamais été appliquée et personne ne l'a vu pendant cinq
// jours (journal non regroupé, purges muettes). Ce test refuse un délimiteur
// réduit à un seul `$` et un nombre impair de `$$` dans une migration.
const DIR = join(process.cwd(), "supabase", "migrations");

describe("migrations SQL : délimiteurs $$", () => {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql"))) {
    it(f, () => {
      const sql = readFileSync(join(DIR, f), "utf8");
      const isoles = sql
        .split(/\r?\n/)
        .map((l, i) => ({ l: l.trim(), n: i + 1 }))
        .filter(({ l }) => /^as \$$/i.test(l) || /^\$;$/.test(l))
        .map(({ n }) => n);
      expect(isoles, `lignes avec un « $ » seul : ${isoles.join(", ")}`).toEqual([]);
      expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0);
    });
  }
});
