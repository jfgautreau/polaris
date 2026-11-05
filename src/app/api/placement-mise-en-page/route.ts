import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { verifierIdSite } from "@/lib/verifier-site";
import { messageErreur } from "@/lib/erreurs";
import { PDFS, validerMiseEnPage, type PdfPlacement } from "@/lib/mise-en-page-pdf";

// POST   /api/placement-mise-en-page { atelier_id, pdf, format, orientation, blocs }
// DELETE /api/placement-mise-en-page { atelier_id, pdf }   → retour à la disposition automatique
//
// Mise en page des PDF du Placement (0094), écran « Mise en page PDF ». Droit
// dédié `placement_pdf` (client admin), écriture bornée au site de l'appelant ;
// le service et chaque ligne référencée sont vérifiés comme étant du site.

async function lireCorps(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const atelier_id = typeof body?.atelier_id === "string" ? body.atelier_id : "";
  const pdf = (PDFS as string[]).includes(String(body?.pdf)) ? (body!.pdf as PdfPlacement) : null;
  return { body, atelier_id, pdf };
}

export async function POST(req: NextRequest) {
  const garde = await moduleWriteGuard("placement_pdf");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { body, atelier_id, pdf } = await lireCorps(req);
  if (!atelier_id || !pdf) return NextResponse.json({ error: "Service ou PDF manquant." }, { status: 400 });
  const siteId = garde.profile.siteId;
  const supabase = garde.supabase;

  const refus = await verifierIdSite(supabase, "atelier", atelier_id, siteId, "Service");
  if (refus) return NextResponse.json({ error: refus }, { status: 400 });

  // Lignes du service et leurs postes : seules références admises dans les blocs.
  const { data: lignesD, error: errL } = await supabase
    .from("ligne")
    .select("id, poste(id)")
    .eq("site_id", siteId)
    .eq("atelier_id", atelier_id)
    .returns<{ id: string; poste: { id: string }[] }[]>();
  if (errL) return NextResponse.json({ error: messageErreur(errL) }, { status: 500 });
  const lignes = new Map((lignesD ?? []).map((l) => [l.id, new Set((l.poste ?? []).map((p) => p.id))]));

  const v = validerMiseEnPage(body, lignes);
  if (!v.ok) return NextResponse.json({ error: v.erreur }, { status: 400 });

  const { error } = await supabase.from("placement_mise_en_page").upsert(
    {
      site_id: siteId,
      atelier_id,
      pdf,
      format: v.valeur.format,
      orientation: v.valeur.orientation,
      blocs: v.valeur.blocs,
      updated_at: new Date().toISOString(),
      updated_by: garde.profile.authId,
    },
    { onConflict: "site_id,atelier_id,pdf" },
  );
  if (error) return NextResponse.json({ error: messageErreur(error) }, { status: 500 });
  return NextResponse.json({ ok: true, miseEnPage: v.valeur });
}

export async function DELETE(req: NextRequest) {
  const garde = await moduleWriteGuard("placement_pdf");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const { atelier_id, pdf } = await lireCorps(req);
  if (!atelier_id || !pdf) return NextResponse.json({ error: "Service ou PDF manquant." }, { status: 400 });
  const { error } = await garde.supabase
    .from("placement_mise_en_page")
    .delete()
    .eq("site_id", garde.profile.siteId)
    .eq("atelier_id", atelier_id)
    .eq("pdf", pdf);
  if (error) return NextResponse.json({ error: messageErreur(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
