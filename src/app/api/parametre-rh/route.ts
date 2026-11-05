import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { messageErreur } from "@/lib/erreurs";
import { NOM_FICHIER_INTERIM_MAX } from "@/lib/nom-fichier-interim";

// POST /api/parametre-rh { interim_nom_fichier }
// Auto-save du réglage « Nom du fichier Excel intérim » de Param. RH (0093).
// Garde du module `motifs` (client admin), écriture bornée au site de l'appelant.
// Vide = forme par défaut (NOM_FICHIER_INTERIM_DEFAUT).
export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("motifs");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });

  const body = (await req.json().catch(() => null)) as { interim_nom_fichier?: unknown } | null;
  const brut = typeof body?.interim_nom_fichier === "string" ? body.interim_nom_fichier.trim() : "";
  if (brut.length > NOM_FICHIER_INTERIM_MAX) {
    return NextResponse.json({ error: `${NOM_FICHIER_INTERIM_MAX} caractères au plus.` }, { status: 400 });
  }

  const { error } = await garde.supabase
    .from("parametre_rh")
    .upsert(
      { site_id: garde.profile.siteId, interim_nom_fichier: brut || null, updated_at: new Date().toISOString() },
      { onConflict: "site_id" },
    );
  if (error) return NextResponse.json({ error: messageErreur(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
