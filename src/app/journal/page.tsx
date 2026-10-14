import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import BandeauErreur from "@/components/BandeauErreur";
import { requireModule, canWrite } from "@/lib/permissions";
import { getQuartsC } from "@/lib/refdata";
import {
  ACTION_FR,
  TABLE_FR,
  TABLES_BRUIT,
  champLabel,
  champsMontres,
  decrireElement,
  idsReferences,
  minuitParis,
  valeurLisible,
  type EntreeJournal,
} from "@/lib/journal";
import JournalFiltres, { type FiltresJournal } from "./JournalFiltres";
import { reglerConservation } from "./actions";

// Journal d'audit (refonte 0086).
//
// DROIT : la matrice de modules décide seule (`journal`, lecture). La lecture
// passe donc par le client service_role, bornée au site du profil — la RLS
// d'audit_log nomme encore admin et CODIR en dur, si bien qu'un rôle à qui l'on
// accordait le droit voyait une page vide sans message.
//
// VOLUME : ~900 lignes par jour, 78 % Planning + Polyvalence. Par défaut, ces
// deux tables sont masquées, et une opération de masse (copie, import…) n'est
// montrée que par sa ligne de synthèse, dont le détail s'ouvre à la demande.

const PAR_PAGE = 100;

// ⚠️ Fuseau forcé : le rendu a lieu sur Vercel (UTC) ; l'usine est en France.
const HORODATAGE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Paris" });

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLONNES = "id, app_user_id, action, table_name, record_id, old_values, new_values, created_at, impersonated_by, lot, lot_libelle";

type Sp = { du?: string; au?: string; auteur?: string; element?: string; action?: string; q?: string; tout?: string; page?: string; lot?: string; err?: string };

export default async function JournalPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { profile, perms } = await requireModule("journal", "read");
  const sp = await searchParams;
  const site = profile.siteId;
  const admin = getAdminClient();

  const filtres: FiltresJournal = {
    du: ISO.test(sp.du ?? "") ? sp.du! : "",
    au: ISO.test(sp.au ?? "") ? sp.au! : "",
    auteur: sp.auteur === "systeme" || UUID.test(sp.auteur ?? "") ? sp.auteur! : "",
    element: sp.element && TABLE_FR[sp.element] ? sp.element : "",
    action: ["INSERT", "UPDATE", "DELETE", "LOT"].includes(sp.action ?? "") ? sp.action! : "",
    q: (sp.q ?? "").trim().slice(0, 60),
    tout: sp.tout === "1",
  };
  const lot = UUID.test(sp.lot ?? "") ? sp.lot! : "";
  const page = Math.max(0, Math.floor(Number(sp.page) || 0));

  // Conservation (étape 6) : on purge ce qui dépasse à chaque ouverture — une
  // suppression par plage d'index, sans coût notable. Lancée en parallèle.
  const pPurge = admin.rpc("journal_purger", { p_site: site });
  const pSite = admin.from("site").select("journal_conservation_mois").eq("id", site).maybeSingle<{ journal_conservation_mois: number }>();
  const pAuteurs = admin
    .from("app_user")
    .select("user_id, name, email")
    .eq("site_id", site)
    .order("name")
    .returns<{ user_id: string; name: string | null; email: string | null }[]>();

  // Recherche : on résout le texte en identifiants (personnes, postes,
  // habilitations, lignes, services) puis on cherche ces identifiants dans les
  // lignes du journal. Plafonné pour garder une requête de taille raisonnable.
  // Chaque catégorie ne cherche que ses colonnes, et les plafonds tiennent
  // l'URL de la requête sous quelques kilo-octets.
  let idsRecherche: string[] | null = null;
  let conditions: string[] = [];
  if (filtres.q) {
    const motif = `%${filtres.q.replace(/[%_,()]/g, " ")}%`;
    const [pers, postes, comps, lignes, ateliers] = await Promise.all([
      admin.from("personne").select("id").eq("site_id", site).or(`nom.ilike.${motif},prenom.ilike.${motif},matricule.ilike.${motif}`).limit(15).returns<{ id: string }[]>(),
      admin.from("poste").select("id").eq("site_id", site).ilike("nom", motif).limit(10).returns<{ id: string }[]>(),
      admin.from("competence").select("id").eq("site_id", site).ilike("nom", motif).limit(5).returns<{ id: string }[]>(),
      admin.from("ligne").select("id").eq("site_id", site).ilike("nom", motif).limit(5).returns<{ id: string }[]>(),
      admin.from("atelier").select("id").eq("site_id", site).ilike("nom", motif).limit(3).returns<{ id: string }[]>(),
    ]);
    const ids = (r: { data: { id: string }[] | null }) => (r.data ?? []).map((x) => x.id);
    const cat: [string[], string][] = [
      [ids(pers), "personne_id"],
      [ids(postes), "poste_id"],
      [ids(comps), "competence_id"],
      [ids(lignes), "ligne_id"],
      [ids(ateliers), "atelier_id"],
    ];
    idsRecherche = cat.flatMap(([l]) => l);
    conditions = cat
      .filter(([l]) => l.length)
      .flatMap(([l, col]) => {
        const v = `(${l.join(",")})`;
        // record_id : la fiche elle-même (personne, poste…) ; sinon les lignes qui la référencent.
        return [`record_id.in.${v}`, `new_values->>${col}.in.${v}`, `old_values->>${col}.in.${v}`];
      });
  }

  let entrees: EntreeJournal[] = [];
  let erreur: string | null = null;
  if (idsRecherche === null || idsRecherche.length > 0) {
    let q = admin.from("audit_log").select(COLONNES).eq("site_id", site);
    if (lot) {
      q = q.eq("lot", lot).neq("action", "LOT");
    } else {
      if (filtres.element) q = q.eq("table_name", filtres.element);
      else if (!filtres.tout && !idsRecherche) q = q.not("table_name", "in", `(${TABLES_BRUIT.join(",")})`);
      if (filtres.action) q = q.eq("action", filtres.action);
      if (idsRecherche) {
        q = q.or(conditions.join(","));
      } else if (!filtres.element) {
        // Une opération de masse ne montre que sa ligne de synthèse.
        q = q.or("lot.is.null,action.eq.LOT");
      }
    }
    if (filtres.auteur === "systeme") q = q.is("app_user_id", null);
    else if (filtres.auteur) q = q.eq("app_user_id", filtres.auteur);
    if (filtres.du) q = q.gte("created_at", minuitParis(filtres.du));
    if (filtres.au) {
      const [y, m, d] = filtres.au.split("-").map(Number);
      const lendemain = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      q = q.lt("created_at", minuitParis(lendemain));
    }
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE) // une de plus : « page suivante ? »
      .returns<EntreeJournal[]>();
    if (error) erreur = error.message;
    entrees = data ?? [];
  }
  const pageSuivante = entrees.length > PAR_PAGE;
  if (pageSuivante) entrees = entrees.slice(0, PAR_PAGE);

  // Noms (étape 4) : seulement les identifiants des lignes affichées.
  const ids = [...new Set(entrees.flatMap(idsReferences))];
  const noms: Record<string, string> = {};
  const [quarts, { data: siteD }, { data: auteursD }, ...dicos] = await Promise.all([
    getQuartsC(),
    pSite,
    pAuteurs,
    ...(ids.length
      ? [
          admin.from("personne").select("id, nom, prenom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string; prenom: string }[]>(),
          admin.from("poste").select("id, nom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string }[]>(),
          admin.from("ligne").select("id, nom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string }[]>(),
          admin.from("atelier").select("id, nom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string }[]>(),
          admin.from("equipe").select("id, nom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string }[]>(),
          admin.from("motif_absence").select("id, libelle").eq("site_id", site).in("id", ids).returns<{ id: string; libelle: string }[]>(),
          admin.from("competence").select("id, nom").eq("site_id", site).in("id", ids).returns<{ id: string; nom: string }[]>(),
          admin.from("app_user").select("user_id, name, email").in("user_id", ids).returns<{ user_id: string; name: string | null; email: string | null }[]>(),
        ]
      : []),
    pPurge,
  ]);
  for (const r of dicos) {
    for (const x of ((r as { data: Record<string, string | null>[] | null }).data ?? [])) {
      if ("user_id" in x) noms[x.user_id!] = x.name || x.email || "";
      else if ("prenom" in x) noms[x.id!] = `${x.nom} ${x.prenom}`.trim();
      else if ("libelle" in x) noms[x.id!] = x.libelle ?? "";
      else noms[x.id!] = x.nom ?? "";
    }
  }
  for (const q of quarts) noms[q.code] = q.libelle;
  const auteurs = (auteursD ?? []).map((u) => ({ id: u.user_id, nom: u.name || u.email || u.user_id.slice(0, 8) }));
  for (const a of auteurs) noms[a.id] ??= a.nom;

  const qui = (id: string | null) => (id ? noms[id] || "Compte supprimé" : "Système");
  const conservation = siteD?.journal_conservation_mois ?? 13;
  const ecrire = canWrite(perms, "journal");

  const lien = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const tout: Record<string, string | number | null> = {
      du: filtres.du, au: filtres.au, auteur: filtres.auteur, element: filtres.element,
      action: filtres.action, q: filtres.q, tout: filtres.tout ? "1" : "", lot, page, ...patch,
    };
    for (const [k, v] of Object.entries(tout)) if (v !== null && v !== "" && v !== 0) p.set(k, String(v));
    const s = p.toString();
    return s ? `/journal?${s}` : "/journal";
  };

  const libelleLot = lot ? entrees[0]?.lot_libelle ?? "Opération groupée" : null;
  const cellule = (cote: "avant" | "apres"): React.CSSProperties => ({
    verticalAlign: "top",
    fontSize: 13,
    background: cote === "avant" ? "#fef6f6" : "#f4fbf6",
    minWidth: 170,
  });

  return (
    <>
      <AppHeader role={profile.role} active="/journal" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Journal d&apos;audit</h1>
          <span className="muted" style={{ fontSize: 13 }}>
            Qui a changé quoi, avant / après. Conservation :{" "}
            {ecrire ? (
              <form action={reglerConservation} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="number" name="mois" min={1} max={120} defaultValue={conservation} style={{ width: 64, fontSize: 13, padding: "2px 4px" }} />
                mois
                <button type="submit" className="btn-sm btn-ghost" style={{ margin: 0, width: "auto", color: "var(--text)" }}>
                  Enregistrer
                </button>
              </form>
            ) : (
              <strong>{conservation} mois</strong>
            )}
            {" "}— au-delà, les entrées sont effacées.
          </span>
        </div>
        <BandeauErreur message={sp.err} />

        {lot ? (
          <p style={{ margin: "12px 0" }}>
            <Link href={lien({ lot: null, page: null })} prefetch={false}>
              &larr; Retour au journal
            </Link>{" "}
            · Détail de l&apos;opération groupée : <strong>{libelleLot}</strong>
          </p>
        ) : (
          <div style={{ marginTop: 12 }}>
            <JournalFiltres
              filtres={filtres}
              auteurs={auteurs}
              elements={Object.entries(TABLE_FR).map(([code, libelle]) => ({ code, libelle })).sort((a, b) => a.libelle.localeCompare(b.libelle))}
            />
          </div>
        )}

        {erreur && <BandeauErreur message={`Lecture du journal impossible : ${erreur}`} />}

        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Date &amp; heure</th>
                <th>Auteur</th>
                <th>Action</th>
                <th>Type</th>
                <th>Élément</th>
                <th>Valeur avant</th>
                <th>Valeur après</th>
              </tr>
            </thead>
            <tbody>
              {entrees.map((e) => {
                const champs = champsMontres(e);
                const nbLot = Number((e.new_values as { lignes?: number } | null)?.lignes ?? 0);
                return (
                  <tr key={e.id} style={e.action === "LOT" ? { background: "#f8fafc" } : undefined}>
                    <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{HORODATAGE.format(new Date(e.created_at))}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {qui(e.app_user_id)}
                      {e.impersonated_by && (
                        <span
                          title={`Action faite en mode support par ${qui(e.impersonated_by)}`}
                          style={{ display: "block", fontSize: 11, color: "#9a3412", fontWeight: 600 }}
                        >
                          via support
                        </span>
                      )}
                    </td>
                    <td>{ACTION_FR[e.action] ?? e.action}</td>
                    <td>{TABLE_FR[e.table_name] ?? e.table_name}</td>
                    <td style={{ minWidth: 220 }}>{decrireElement(e, noms)}</td>
                    {e.action === "LOT" ? (
                      <td colSpan={2} style={{ fontSize: 13 }}>
                        {nbLot} ligne(s) —{" "}
                        <Link href={lien({ lot: e.lot, page: null })} prefetch={false}>
                          voir le détail
                        </Link>
                      </td>
                    ) : (
                      <>
                        <td style={cellule("avant")}>
                          {champs.filter((c) => "avant" in c).map((c) => (
                            <div key={c.k} style={{ lineHeight: 1.5 }}>
                              <span className="muted">{champLabel(c.k)} :</span> <strong>{valeurLisible(c.k, c.avant, noms)}</strong>
                            </div>
                          ))}
                          {!champs.some((c) => "avant" in c) && <span className="muted">—</span>}
                        </td>
                        <td style={cellule("apres")}>
                          {champs.filter((c) => "apres" in c).map((c) => (
                            <div key={c.k} style={{ lineHeight: 1.5 }}>
                              <span className="muted">{champLabel(c.k)} :</span> <strong>{valeurLisible(c.k, c.apres, noms)}</strong>
                            </div>
                          ))}
                          {!champs.some((c) => "apres" in c) && <span className="muted">—</span>}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {entrees.length === 0 && !erreur && (
                <tr>
                  <td colSpan={7} className="muted">
                    {idsRecherche && idsRecherche.length === 0
                      ? "Aucune personne, aucun poste ni aucune habilitation ne correspond à cette recherche."
                      : "Aucune entrée pour ces filtres."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(page > 0 || pageSuivante) && (
          <div style={{ display: "flex", gap: 16, justifyContent: "center", margin: "12px 0 24px", fontSize: 14 }}>
            {page > 0 ? (
              <Link href={lien({ page: page - 1 })} prefetch={false}>
                &larr; Plus récents
              </Link>
            ) : (
              <span className="muted">&larr; Plus récents</span>
            )}
            <span className="muted">Page {page + 1}</span>
            {pageSuivante ? (
              <Link href={lien({ page: page + 1 })} prefetch={false}>
                Plus anciens &rarr;
              </Link>
            ) : (
              <span className="muted">Plus anciens &rarr;</span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
