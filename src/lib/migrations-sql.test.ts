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

// Supabase, à partir du 2026-10-30 : une table créée dans « public » n'est plus
// ouverte d'office à l'API (supabase-js / PostgREST). Sans GRANT explicite, toute
// lecture répond « permission denied ». Les tables existantes gardent leurs droits ;
// chaque migration qui CRÉE une table (0091 et suivantes) doit donc les accorder
// elle-même, dans le même fichier :
//   grant select, insert, update, delete on public.<table> to authenticated, service_role;
// (la RLS reste le filtre ; `anon` n'en a pas besoin : l'affichage TV lit en service_role).
const PREMIERE_AVEC_GRANT = 91;

describe("migrations SQL : GRANT explicite sur les nouvelles tables", () => {
  const concernees = readdirSync(DIR).filter((n) => n.endsWith(".sql") && Number(n.slice(0, 4)) >= PREMIERE_AVEC_GRANT);
  // Vitest refuse une suite vide : cas neutre tant qu'aucune migration n'est concernée.
  if (concernees.length === 0) it("aucune migration à partir de la 0091", () => expect(concernees).toEqual([]));
  for (const f of concernees) {
    it(f, () => {
      const sql = readFileSync(join(DIR, f), "utf8").toLowerCase();
      const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/g)].map((m) => m[1]);
      const sansGrant = tables.filter(
        (t) => !new RegExp(String.raw`grant\s+[^;]*\bon\s+(?:table\s+)?(?:public\.)?"?${t}"?\s+to\s+[^;]*\bauthenticated\b`).test(sql),
      );
      expect(sansGrant, `tables sans « grant … on public.<table> to authenticated, service_role » : ${sansGrant.join(", ")}`).toEqual([]);
    });
  }
});
