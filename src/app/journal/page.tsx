import { getServerClient } from "@/lib/supabase-server";
import { roleLabel } from "@/lib/roles";
import AppHeader from "@/components/AppHeader";
import { requireModule } from "@/lib/permissions";

type Json = Record<string, unknown> | null;
type Entry = {
  id: number;
  app_user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Json;
  new_values: Json;
  created_at: string;
};

const ACTION_FR: Record<string, string> = { INSERT: "Création", UPDATE: "Modification", DELETE: "Suppression" };

// Nom de table lisible (repli : le nom brut).
const TABLE_FR: Record<string, string> = {
  matrice: "Polyvalence",
  placement: "Planning",
  personne_competence: "Habilitation",
  motif_absence: "Motif d'absence",
  personne: "Personne",
  poste: "Poste",
  ligne: "Ligne",
  atelier: "Service",
  equipe: "Équipe",
  competence: "Compétence",
  absence: "Absence",
  rotation_reference: "Rotation",
  role_permission: "Droits",
  app_user: "Utilisateur",
};

// Libelle de champ lisible (repli : la cle brute).
const CHAMP_FR: Record<string, string> = {
  niveau_actuel: "Niveau actuel",
  niveau_cible: "Niveau cible",
  jour: "Jour",
  quart_code: "Quart",
  poste_id: "Poste",
  personne_id: "Personne",
  equipe_id: "Équipe",
  ligne_id: "Ligne",
  atelier_id: "Service",
  competence_id: "Compétence",
  motif_absence_id: "Motif",
  absence_id: "Absence",
  non_travaille: "Non travaillé",
  commentaire: "Commentaire",
  libelle: "Libellé",
  couleur: "Couleur",
  code_court: "Code",
  nom: "Nom",
  prenom: "Prénom",
  actif: "Actif",
  statut: "Statut",
  date_obtention: "Date d'obtention",
  date_expiration: "Échéance",
  date_autorisation_conduite: "Autorisation conduite",
  role: "Rôle",
  niveau: "Niveau",
  quart_fixe: "Quart fixe",
  semaine: "Semaine",
};

// Champs techniques masques du diff (bruit : ids, horodatages, auteur deja affiche).
const TECH = new Set(["id", "created_at", "updated_at", "date_maj", "auteur_app_user_id", "created_by"]);

// ⚠️ Fuseau force. `audit_log.created_at` est un timestamptz, mais cette page est
// un composant serveur : le formatage a lieu sur Vercel, dont l'horloge est en UTC.
// Sans `timeZone`, le journal affichait donc les heures avec 1 h (hiver) ou 2 h
// (ete) de retard sur l'usine. L'application n'est utilisee qu'en France.
const HORODATAGE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Paris",
});

const champLabel = (k: string) => CHAMP_FR[k] ?? k;

export default async function JournalPage() {
  const { profile } = await requireModule("journal", "read");

  const supabase = await getServerClient();
  const [entriesR, usersR, persR, posteR, eqR, motifR, compR, ligneR] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, app_user_id, action, table_name, record_id, old_values, new_values, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<Entry[]>(),
    supabase.from("app_user").select("user_id, name, email").returns<{ user_id: string; name: string; email: string }[]>(),
    supabase.from("personne").select("id, nom, prenom").returns<{ id: string; nom: string; prenom: string }[]>(),
    supabase.from("poste").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("equipe").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("motif_absence").select("id, libelle").returns<{ id: string; libelle: string }[]>(),
    supabase.from("competence").select("id, nom").returns<{ id: string; nom: string }[]>(),
    supabase.from("ligne").select("id, nom").returns<{ id: string; nom: string }[]>(),
  ]);

  const entries = entriesR.data ?? [];
  const users = usersR.data ?? [];

  // Dictionnaire uuid -> libelle, pour rendre les cles etrangeres en clair.
  const labelById: Record<string, string> = {};
  for (const p of persR.data ?? []) labelById[p.id] = `${p.nom} ${p.prenom}`;
  for (const p of posteR.data ?? []) labelById[p.id] = p.nom;
  for (const e of eqR.data ?? []) labelById[e.id] = e.nom;
  for (const m of motifR.data ?? []) labelById[m.id] = m.libelle;
  for (const c of compR.data ?? []) labelById[c.id] = c.nom;
  for (const l of ligneR.data ?? []) labelById[l.id] = l.nom;
  for (const u of users) labelById[u.user_id] = u.name || u.email;

  const who = (id: string | null) => {
    if (!id) return "Système";
    return labelById[id] ?? id.slice(0, 8);
  };

  // Valeur formatee en clair (booleen, vide, cle etrangere resolue).
  const fmtVal = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "∅";
    if (typeof v === "boolean") return v ? "oui" : "non";
    if (typeof v === "object") return JSON.stringify(v);
    const s = String(v);
    if ((key.endsWith("_id") || key === "created_by") && labelById[s]) return labelById[s];
    return s;
  };

  // Champs metier renseignes (INSERT / DELETE).
  const metierFields = (obj: Json): { k: string; v: unknown }[] => {
    if (!obj) return [];
    return Object.entries(obj)
      .filter(([k, v]) => !TECH.has(k) && v !== null && v !== "")
      .map(([k, v]) => ({ k, v }));
  };

  // Champs modifies (UPDATE) : old != new, hors champs techniques.
  const changedFields = (o: Json, n: Json): { k: string; a: unknown; b: unknown }[] => {
    const keys = new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {})]);
    const out: { k: string; a: unknown; b: unknown }[] = [];
    for (const k of keys) {
      if (TECH.has(k)) continue;
      const a = o?.[k];
      const b = n?.[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ k, a, b });
    }
    return out;
  };

  // Prepare, pour chaque entree, les listes « avant » et « apres » alignees.
  const rendered = entries.map((e) => {
    let before: { k: string; v: unknown }[] = [];
    let after: { k: string; v: unknown }[] = [];
    if (e.action === "UPDATE") {
      const ch = changedFields(e.old_values, e.new_values);
      before = ch.map((c) => ({ k: c.k, v: c.a }));
      after = ch.map((c) => ({ k: c.k, v: c.b }));
    } else if (e.action === "INSERT") {
      after = metierFields(e.new_values);
    } else if (e.action === "DELETE") {
      before = metierFields(e.old_values);
    }
    return { e, before, after };
  });

  const cellStyle = (side: "avant" | "apres"): React.CSSProperties => ({
    verticalAlign: "top",
    fontSize: 13,
    background: side === "avant" ? "#fef6f6" : "#f4fbf6",
    minWidth: 180,
  });

  const FieldList = ({ items, empty }: { items: { k: string; v: unknown }[]; empty: boolean }) =>
    items.length === 0 ? (
      <span className="muted">{empty ? "—" : "∅"}</span>
    ) : (
      <>
        {items.map(({ k, v }) => (
          <div key={k} style={{ lineHeight: 1.5 }}>
            <span className="muted">{champLabel(k)} :</span> <strong>{fmtVal(k, v)}</strong>
          </div>
        ))}
      </>
    );

  return (
    <>
      <AppHeader role={profile.role} active="/journal" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <h1>Journal d&apos;audit</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          200 dernières modifications : qui, quoi, valeur avant et après, date et heure. Visible par
          l&apos;administrateur et le CODIR ({roleLabel(profile.role)}).
        </p>
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Date &amp; heure</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Élément</th>
                <th>Valeur avant</th>
                <th>Valeur après</th>
              </tr>
            </thead>
            <tbody>
              {rendered.map(({ e, before, after }) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{HORODATAGE.format(new Date(e.created_at))}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{who(e.app_user_id)}</td>
                  <td>{ACTION_FR[e.action] ?? e.action}</td>
                  <td>{TABLE_FR[e.table_name] ?? e.table_name}</td>
                  <td style={cellStyle("avant")}>
                    <FieldList items={before} empty={e.action === "INSERT"} />
                  </td>
                  <td style={cellStyle("apres")}>
                    <FieldList items={after} empty={e.action === "DELETE"} />
                  </td>
                </tr>
              ))}
              {rendered.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucune entrée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
