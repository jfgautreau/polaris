import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/current-user";
import { getImpersonationPayload } from "@/lib/impersonation";

// Layout du back-office plateforme (super_admin uniquement).
//
// Défense en profondeur : le middleware protège déjà /platform, mais on
// revérifie ici pour parer au cas improbable où le proxy serait bypassé
// (edge case Next.js). Aucun coût en RSC : getCurrentProfile est cached.
//
// Le back-office ne charge PAS l'AppHeader classique (pas de matrice des
// droits à afficher, contexte différent) — juste un mini header avec le
// nom de la plateforme et un lien pour revenir à l'app site.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.estSuperAdmin) redirect("/");

  const imp = await getImpersonationPayload();

  return (
    <div style={{ minHeight: "100dvh", background: "#f8fafc" }}>
      <header
        style={{
          background: "#0f172a",
          color: "#fff",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <Link href="/platform" style={{ color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 18 }}>
            Polaris · Platform
          </Link>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{profile.email}</span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 13 }}>
          {/* Guide utilisateur : document autonome (public/guide.html), ouvert
              dans un onglet à part. Accessible depuis la plateforme comme depuis
              le menu utilisateur de l'app. */}
          <a
            href="/guide.html"
            target="_blank"
            rel="noopener"
            style={{ color: "#94a3b8", textDecoration: "none" }}
            title="Ouvrir le guide utilisateur dans un nouvel onglet"
          >
            📘 Guide utilisateur ↗
          </a>
          <Link href="/" style={{ color: "#94a3b8", textDecoration: "none" }}>← Revenir à l&apos;app site</Link>
        </div>
      </header>
      {imp && (
        <div
          style={{
            background: "#7f1d1d",
            color: "#fff",
            padding: "6px 20px",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          ⚠ Mode support actif : cookie d&apos;impersonation présent (siteId=<code>{imp.siteId.slice(0, 8)}…</code>,
          expire {new Date(imp.expiresAt).toLocaleTimeString("fr-FR")}). Utilisez « Sortir »
          depuis /platform quand vous avez terminé.
        </div>
      )}
      <main style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>{children}</main>
    </div>
  );
}
