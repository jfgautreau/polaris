import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { getCurrentSite } from "@/lib/current-site";

// POST /api/param-affichage { mode?, jours_avant?, jours_apres?, nb_semaines? }
// Petit endpoint dédié à l'auto-save du bloc « Fenêtre d'affichage » de Param RH.
// La table `parametre_affichage` est sous RLS `is_admin()` — on passe par la
// garde de module qui rend un client admin quand l'appelant a le droit `motifs`.
// PK = site_id depuis la migration 0051. Depuis 0067 : `mode` + `nb_semaines`.
export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("motifs");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });

  const site = await getCurrentSite();
  const body = (await req.json().catch(() => null)) as
    | { mode?: string; jours_avant?: number; jours_apres?: number; nb_semaines?: number }
    | null;

  const mode = body?.mode === "absolu" ? "absolu" : "relatif";
  const avant = Math.max(0, Math.min(14, Number(body?.jours_avant ?? 1)));
  const apres = Math.max(0, Math.min(30, Number(body?.jours_apres ?? 4)));
  const semaines = Math.max(1, Math.min(6, Number(body?.nb_semaines ?? 2)));

  // Écriture tolérante : la migration 0067 peut ne pas être encore appliquée.
  // Un premier essai avec `mode`/`nb_semaines` ; si Postgres renvoie 42703
  // (colonne inconnue) ou PGRST204 (schéma cache), on retente sans.
  const payloadFull = {
    site_id: site.id,
    mode,
    jours_avant: avant,
    jours_apres: apres,
    nb_semaines: semaines,
    updated_at: new Date().toISOString(),
  };
  let { error } = await garde.supabase
    .from("parametre_affichage")
    .upsert(payloadFull, { onConflict: "site_id" });
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const payloadLegacy = {
      site_id: site.id,
      jours_avant: avant,
      jours_apres: apres,
      updated_at: new Date().toISOString(),
    };
    ({ error } = await garde.supabase
      .from("parametre_affichage")
      .upsert(payloadLegacy, { onConflict: "site_id" }));
    if (!error) {
      return NextResponse.json({ ok: true, migrationNeeded: true });
    }
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
