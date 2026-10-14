import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Next 16 : `updateTag()` n'est permis que dans une Server Action. Dans une
// route API, il LÈVE (E872) — après l'écriture en base, si bien que l'écran
// reçoit une erreur 500 pour une modification pourtant enregistrée (vécu sur
// /api/referentiel : créer / renommer / (dés)activer un service, corrigé le
// 2026-10-14). Dans une route, invalider avec `revalidateTag(TAG, { expire: 0 })`.
const API = join(process.cwd(), "src", "app", "api");

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...routes(p));
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

describe("invalidation de cache dans les routes API", () => {
  it("aucune route n'appelle updateTag (réservé aux Server Actions)", () => {
    const fautes = routes(API)
      .filter((f) => /\bupdateTag\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(f.indexOf("src")).replace(/\\/g, "/"));
    expect(fautes).toEqual([]);
  });
});
