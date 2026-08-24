import Link from "next/link";
import { getAdminClient } from "@/lib/supabase-server";
import { changerStatut, entrerDansLeSite, sortirDuMode } from "../actions";
import { getImpersonationPayload } from "@/lib/impersonation";
import { MODULES } from "@/lib/permissions";
import ModulesMasquesEditor from "./ModulesMasquesEditor";

export const dynamic = "force-dynamic";

type SiteRow = {
  id: string; slug: string; nom: string; statut: "actif" | "suspendu" | "archive";
  cree_le: string; fuseau: string;
};
type AuditRow = {
  id: string; super_admin_id: string; entered_at: string; exited_at: string | null;
  raison: string | null; ip: string | null;
};

export default async function SiteDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; lien?: string; err?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const admin = getAdminClient();
  const { data: site } = await admin
    .from("site")
    .select("id, slug, nom, statut, cree_le, fuseau")
    .eq("id", id)
    .single<SiteRow>();

  if (!site) {
    return (
      <div>
        <Link href="/platform" style={{ color: "#64748b", textDecoration: "none" }}>← Retour</Link>
        <h1 style={{ marginTop: 8, fontSize: 22 }}>Site introuvable</h1>
      </div>
    );
  }

  const [{ data: users }, { data: pers }, { data: audits }, { data: sm }] = await Promise.all([
    admin.from("app_user").select("email, role, is_active").eq("site_id", id).returns<{ email: string; role: string; is_active: boolean }[]>(),
    admin.from("personne").select("statut").eq("site_id", id).returns<{ statut: string }[]>(),
    admin.from("audit_impersonation")
      .select("id, super_admin_id, entered_at, exited_at, raison, ip")
      .eq("site_id", id)
      .order("entered_at", { ascending: false })
      .limit(10)
      .returns<AuditRow[]>(),
    admin.from("site_module").select("module_key").eq("site_id", id).returns<{ module_key: string }[]>(),
  ]);

  const masques = new Set((sm ?? []).map((r) => r.module_key));
  const modulesToggle = MODULES.map((m) => ({ key: m.key, label: m.label, masque: masques.has(m.key) }));

  const impActive = await getImpersonationPayload();
  const impActifSurCeSite = impActive?.siteId === id;

  return (
    <div>
      <Link href="/platform" style={{ color: "#64748b", textDecoration: "none", fontSize: 13 }}>← Retour à la liste</Link>
      <h1 style={{ margin: "8px 0 4px", fontSize: 24 }}>{site.nom}</h1>
      <div style={{ display: "flex", gap: 12, fontSize: 13, color: "#64748b", marginBottom: 20 }}>
        <code>{site.slug}</code>
        <span>Créé le {new Date(site.cree_le).toLocaleDateString("fr-FR")}</span>
        <span>Fuseau : {site.fuseau}</span>
        <span
          style={{
            padding: "1px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: site.statut === "actif" ? "#dcfce7" : site.statut === "suspendu" ? "#fef3c7" : "#e2e8f0",
            color: site.statut === "actif" ? "#166534" : site.statut === "suspendu" ? "#92400e" : "#475569",
          }}
        >
          {site.statut}
        </span>
      </div>

      {sp.err && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 6, marginBottom: 16 }}>{sp.err}</div>
      )}
      {sp.ok && (
        <div style={{ background: "#dcfce7", color: "#166534", padding: "10px 14px", borderRadius: 6, marginBottom: 16 }}>Statut mis à jour.</div>
      )}
      {sp.created && sp.lien && (
        <div style={{ background: "#dbeafe", color: "#1e40af", padding: "10px 14px", borderRadius: 6, marginBottom: 16 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Site créé.</p>
          <p style={{ margin: "6px 0 4px", fontSize: 13 }}>
            Lien de mot de passe pour le 1<sup>er</sup> admin (à transmettre) :
          </p>
          <input readOnly value={sp.lien} style={{ width: "100%", padding: 6, fontFamily: "monospace", fontSize: 12, border: "1px solid #93c5fd", borderRadius: 4 }} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <Kpi label="Utilisateurs actifs" value={(users ?? []).filter((u) => u.is_active).length} />
        <Kpi label="Personnes actives" value={(pers ?? []).filter((p) => p.statut === "ACTIF").length} />
        <Kpi label="Utilisateurs total" value={(users ?? []).length} />
      </div>

      <section style={boxStyle}>
        <h2 style={h2Style}>Cycle de vie</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
          <strong>Actif</strong> : utilisation normale. <strong>Suspendu</strong> : login refusé,
          données préservées. <strong>Archivé</strong> : lecture seule super_admin.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {site.statut !== "actif" && (
            <StatutButton id={site.id} target="actif" label="Réactiver" color="#16a34a" />
          )}
          {site.statut !== "suspendu" && (
            <StatutButton id={site.id} target="suspendu" label="Suspendre" color="#d97706" />
          )}
          {site.statut !== "archive" && (
            <StatutButton id={site.id} target="archive" label="Archiver" color="#64748b" />
          )}
        </div>
      </section>

      <section style={boxStyle}>
        <h2 style={h2Style}>Menus visibles pour ce site</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
          Décochez un menu pour le <strong>masquer à tous les utilisateurs</strong> de ce
          site : il disparaît de la navigation et sa page devient inaccessible (au-dessus
          de la matrice de droits). Enregistré à chaque clic.
        </p>
        <ModulesMasquesEditor siteId={site.id} modules={modulesToggle} />
      </section>

      <section style={boxStyle}>
        <h2 style={h2Style}>Mode support (impersonation)</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b" }}>
          « Entrer dans le site » vous logue en tant qu&apos;admin local pour du support.
          Bandeau rouge permanent en haut de l&apos;écran, journalisation dans
          <code style={{ fontSize: 12 }}> audit_impersonation</code>. Session limitée à 60 min.
        </p>
        {impActifSurCeSite ? (
          <form action={sortirDuMode}>
            <button type="submit" style={btn("#dc2626")}>← Sortir du mode support</button>
          </form>
        ) : impActive ? (
          <p style={{ color: "#dc2626", fontWeight: 600 }}>
            Mode support déjà actif sur un autre site. Sortez-en avant d&apos;entrer ici.
          </p>
        ) : site.statut === "archive" ? (
          <p style={{ color: "#64748b" }}>Site archivé : réactivez-le avant d&apos;entrer.</p>
        ) : (
          <form action={entrerDansLeSite} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="id" value={site.id} />
            <input name="raison" placeholder="Motif (facultatif, tracé)" style={{ flex: 1, padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }} />
            <button type="submit" style={btn("#2563eb")}>Entrer dans le site →</button>
          </form>
        )}
      </section>

      <section style={boxStyle}>
        <h2 style={h2Style}>10 dernières sessions support</h2>
        {(audits ?? []).length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: 13 }}>Aucune impersonation enregistrée.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#64748b" }}>Entrée</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#64748b" }}>Sortie</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#64748b" }}>IP</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#64748b" }}>Raison</th>
              </tr>
            </thead>
            <tbody>
              {(audits ?? []).map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 10px" }}>{new Date(a.entered_at).toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "6px 10px", color: a.exited_at ? "inherit" : "#dc2626" }}>
                    {a.exited_at ? new Date(a.exited_at).toLocaleString("fr-FR") : "(en cours)"}
                  </td>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>{a.ip ?? "—"}</td>
                  <td style={{ padding: "6px 10px" }}>{a.raison ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: "#fff", padding: "12px 16px", borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
      <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function StatutButton({ id, target, label, color }: { id: string; target: string; label: string; color: string }) {
  return (
    <form action={changerStatut}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="statut" value={target} />
      <button type="submit" style={btn(color)}>{label}</button>
    </form>
  );
}

const boxStyle: React.CSSProperties = { background: "#fff", padding: 16, borderRadius: 8, marginBottom: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" };
const h2Style: React.CSSProperties = { margin: "0 0 10px", fontSize: 16, fontWeight: 700 };
const btn = (color: string): React.CSSProperties => ({
  background: color, color: "#fff", padding: "6px 14px", border: 0, borderRadius: 6,
  fontWeight: 600, cursor: "pointer", fontSize: 13,
});
