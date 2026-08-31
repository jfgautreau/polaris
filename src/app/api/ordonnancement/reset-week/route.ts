import { NextResponse, type NextRequest } from "next/server";
import { moduleWriteGuard } from "@/lib/permissions";
import { getSemaineType, getSemaineOuverture, typeQuartActif } from "@/lib/semaine-type";
import { dowMon } from "@/lib/week";

// POST /api/ordonnancement/reset-week { isos: string[] }
// Reinitialise la (ou les) journee(s) selon la semaine type :
//  - jour_quart.actif <- semaine type, pour chaque quart x jour ;
//  - ouverture_quart : on efface les exceptions de ces jours (lignes -> ouvert
//    par defaut).
// Ecriture : droit `ordonnancement` dans la matrice.
export async function POST(req: NextRequest) {
  // La matrice des droits decide, puis client admin : la RLS de ces tables
  // nomme des roles en dur (admin/ordo) et refuserait un titulaire du droit.
  const garde = await moduleWriteGuard("ordonnancement");
  if (!garde.ok) return NextResponse.json({ error: garde.error }, { status: garde.status });
  const supabase = garde.supabase;
  // Multi-site : le client admin (service_role) n'a pas d'auth.uid(), donc
  // le trigger set_site_id_from_context tombe en fallback sur le site
  // « Lebignon » code en dur (0043 ligne 602). On force le site du profil
  // pour que les ecritures partent dans le bon site — meme correctif que
  // creer_absence en 0044.
  const site_id = garde.profile.siteId;

  const body = (await req.json().catch(() => null)) as { isos?: string[]; profil_id?: string; force?: boolean } | null;
  const isos = (body?.isos ?? []).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const profil_id = body?.profil_id || undefined;
  const force = !!body?.force;
  if (isos.length === 0) return NextResponse.json({ error: "Aucun jour" }, { status: 400 });

  // (Re)initialiser une semaine qui a deja des affectations reelles (poste_id
  // renseigne) ecraserait les fermetures/ouvertures decidees en Placement, et
  // pourrait laisser des personnes sur des lignes qui vont se refermer. Les jours
  // d'absence ne comptent pas.
  // MULTI-SITE : borne par site_id (le service_role bypass la RLS).
  type ConflitRow = { id: string; personne: { nom: string; prenom: string } | null };
  const { data: conf, error: eConf } = await supabase
    .from("placement")
    .select("id, personne:personne_id(nom, prenom)")
    .eq("site_id", site_id)
    .in("jour", isos)
    .not("poste_id", "is", null)
    .is("motif_absence_id", null)
    .returns<ConflitRow[]>();
  if (eConf) return NextResponse.json({ error: eConf.message }, { status: 403 });
  if ((conf ?? []).length > 0) {
    // Proposition A : sans `force`, on renvoie la liste des personnes affectees
    // pour que l'ecran propose « reinitialiser quand meme et retirer », plutot
    // qu'un mur. Les noms sont dedupliques (une personne sur plusieurs jours).
    if (!force) {
      const vus = new Set<string>();
      const affectes: { nom: string; prenom: string }[] = [];
      for (const r of conf ?? []) {
        const nom = r.personne?.nom ?? "?";
        const prenom = r.personne?.prenom ?? "";
        const cle = `${nom} ${prenom}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        affectes.push({ nom, prenom });
      }
      affectes.sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`));
      return NextResponse.json({ conflit: true, affectes }, { status: 409 });
    }
    // Avec `force` : on retire les affectations poste de la semaine (les absences
    // restent) avant de reinitialiser.
    const { error: eDel } = await supabase
      .from("placement")
      .delete()
      .eq("site_id", site_id)
      .in("id", (conf ?? []).map((r) => r.id));
    if (eDel) return NextResponse.json({ error: eDel.message }, { status: 403 });
  }

  // Multi-site : quart est site-scopé depuis 0053. On borne par site_id
  // pour ne pas lire les codes d'autres sites via service_role.
  const { data: quartsD } = await supabase
    .from("quart")
    .select("code")
    .eq("site_id", site_id)
    .returns<{ code: string }[]>();
  const quarts = (quartsD ?? []).map((q) => q.code);
  if (quarts.length === 0) return NextResponse.json({ error: "Aucun quart" }, { status: 400 });

  const [type, ouvType] = await Promise.all([getSemaineType(supabase, profil_id), getSemaineOuverture(supabase, profil_id)]);

  // 1) Quarts actifs <- gabarit.
  const rows = isos.flatMap((iso) =>
    quarts.map((code) => ({ jour: iso, quart_code: code, actif: typeQuartActif(type, iso, code), site_id }))
  );
  // onConflict inclut site_id : nouvelle PK (site_id, jour, quart_code)
  // depuis 0053. Sans site_id, un même (jour, quart_code) sur un autre
  // site déclencherait un conflit de PK côté service_role.
  const { error: e1 } = await supabase
    .from("jour_quart")
    .upsert(rows, { onConflict: "site_id,jour,quart_code" });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 403 });

  // 2) Ouverture des lignes : on efface les exceptions de ces jours du site
  //    courant (le filtre site_id evite d'emporter les fermetures d'autres sites
  //    en cas d'usage service_role).
  const { error: e2 } = await supabase
    .from("ouverture_quart")
    .delete()
    .in("jour", isos)
    .eq("site_id", site_id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 403 });

  // ...puis on re-pose les fermetures definies par le gabarit (absence = ouvert).
  const fermetures: { jour: string; quart_code: string; ligne_id: string; ouverte: boolean; site_id: string }[] = [];
  for (const iso of isos) {
    const dow = dowMon(iso);
    for (const [key, ouverte] of Object.entries(ouvType)) {
      if (ouverte) continue; // ouvert = defaut, rien a ecrire
      const [quart_code, ligne_id, j] = key.split(":");
      if (Number(j) === dow) fermetures.push({ jour: iso, quart_code, ligne_id, ouverte: false, site_id });
    }
  }
  if (fermetures.length > 0) {
    const { error: e3 } = await supabase
      .from("ouverture_quart")
      .upsert(fermetures, { onConflict: "jour,ligne_id,quart_code" });
    if (e3) return NextResponse.json({ error: e3.message }, { status: 403 });
  }

  // Instantané applique (pour la mise a jour immediate cote client, selon le profil).
  const jq: Record<string, boolean> = {};
  for (const r of rows) jq[`${r.quart_code}:${r.jour}`] = r.actif;
  const fermeturesKeys = fermetures.map((f) => `${f.quart_code}:${f.ligne_id}:${f.jour}`);
  return NextResponse.json({ ok: true, jq, fermetures: fermeturesKeys });
}
