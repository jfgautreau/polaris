import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/current-user";
import { canRead, getPermissions } from "@/lib/permissions";
import { getAdminClient } from "@/lib/supabase-server";
import { cleRapport } from "@/lib/bilans-rapports";
import { getModulesMasquesC } from "@/lib/site-modules";
import { messageErreur } from "@/lib/erreurs";
import type { PhotoInterim } from "@/lib/syntheses-export";

// POST /api/syntheses/extraction-interim { agence, semaine_lundi, photo }
//
// Appelée à chaque « Excel agence » des Synthèses intérim (2026-11-05, 0093) :
//  1. relit la photo de la DERNIÈRE extraction de cette agence pour cette semaine
//     (quel que soit l'utilisateur) ;
//  2. enregistre la photo de l'extraction en cours ;
//  3. purge les photos du site de plus de 8 semaines ;
//  4. rend la photo précédente (ou null) et le nom des personnes qui en sont
//     sorties, pour que le navigateur surligne en jaune fluo ce qui a changé.
// La photo ne porte que des personne_id et le texte des cases (horaire,
// service) : les noms des retirés sont relus ici, bornés au site.
//
// Droit : la lecture du rapport Synthèses (droit « bilans », rapport non masqué
// pour le site) — extraire est une consultation ; la photo est écrite en
// service_role, bornée au site de l'appelant.

const MAX_OCTETS = 300_000;
const MAX_LIGNES = 2000;
const CONSERVATION_JOURS = 56;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function photoValide(p: unknown): p is PhotoInterim {
  if (!p || typeof p !== "object") return false;
  const { v, lignes } = p as { v?: unknown; lignes?: unknown };
  if (v !== 1 || !lignes || typeof lignes !== "object") return false;
  const entrees = Object.entries(lignes as Record<string, unknown>);
  if (entrees.length > MAX_LIGNES) return false;
  return entrees.every(([id, l]) => {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !l || typeof l !== "object") return false;
    const { cases, jours, obs } = l as { cases?: unknown; jours?: unknown; obs?: unknown };
    if (typeof jours !== "number" || typeof obs !== "string" || !cases || typeof cases !== "object") return false;
    const c = Object.entries(cases as Record<string, unknown>);
    return c.length <= 7 && c.every(([iso, t]) => ISO.test(iso) && typeof t === "string" && t.length <= 1000);
  });
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canRead(await getPermissions(profile.role), "bilans") || (await getModulesMasquesC()).has(cleRapport("syntheses"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const brut = await req.text();
  if (brut.length > MAX_OCTETS) return NextResponse.json({ error: "Extraction trop volumineuse." }, { status: 413 });
  let body: { agence?: unknown; semaine_lundi?: unknown; photo?: unknown };
  try {
    body = JSON.parse(brut);
  } catch {
    return NextResponse.json({ error: "Requête illisible." }, { status: 400 });
  }
  const agence = typeof body.agence === "string" ? body.agence.trim() : "";
  const semaine = typeof body.semaine_lundi === "string" && ISO.test(body.semaine_lundi) ? body.semaine_lundi : "";
  if (!agence || agence.length > 200 || !semaine || !photoValide(body.photo)) {
    return NextResponse.json({ error: "Agence, semaine ou contenu invalide." }, { status: 400 });
  }
  const photo = body.photo;
  const siteId = profile.siteId;
  const admin = getAdminClient();

  const { data: prec, error: errPrec } = await admin
    .from("export_interim_photo")
    .select("contenu, created_at")
    .eq("site_id", siteId)
    .eq("agence", agence)
    .eq("semaine_lundi", semaine)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ contenu: PhotoInterim; created_at: string }>();
  if (errPrec) return NextResponse.json({ error: messageErreur(errPrec) }, { status: 500 });

  const { error: errIns } = await admin
    .from("export_interim_photo")
    .insert({ site_id: siteId, agence, semaine_lundi: semaine, contenu: photo, created_by: profile.authId });
  if (errIns) return NextResponse.json({ error: messageErreur(errIns) }, { status: 500 });

  // Purge : les photos ne servent qu'à la semaine en cours de préparation.
  const limite = new Date(Date.now() - CONSERVATION_JOURS * 86_400_000).toISOString();
  const { error: errPurge } = await admin.from("export_interim_photo").delete().eq("site_id", siteId).lt("created_at", limite);
  if (errPurge) console.error("purge export_interim_photo :", errPurge.message);

  // Retirés : dans la photo précédente, plus dans celle-ci (liste courte).
  const idsRetires = prec ? Object.keys(prec.contenu?.lignes ?? {}).filter((id) => !(id in photo.lignes)) : [];
  let retires: { personneId: string; nom: string; prenom: string }[] = [];
  if (idsRetires.length) {
    const { data: pers, error: errPers } = await admin
      .from("personne")
      .select("id, nom, prenom")
      .eq("site_id", siteId)
      .in("id", idsRetires.slice(0, 200))
      .returns<{ id: string; nom: string; prenom: string }[]>();
    if (errPers) return NextResponse.json({ error: messageErreur(errPers) }, { status: 500 });
    retires = (pers ?? [])
      .map((p) => ({ personneId: p.id, nom: p.nom, prenom: p.prenom }))
      .sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
  }

  return NextResponse.json({
    ok: true,
    precedente: prec ? { le: prec.created_at, photo: prec.contenu } : null,
    retires,
  });
}
