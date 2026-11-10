import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import Logo from "@/components/Logo";
import { getCurrentProfile } from "@/lib/current-user";
import { getNomApplication } from "@/lib/nom-application-server";

// Page d'accueil : logo en grand, centré, avec le nom de l'application du site.
export default async function Home() {
  const [profile, nomApp] = await Promise.all([getCurrentProfile(), getNomApplication()]);
  if (!profile) redirect("/login");

  return (
    <>
      <AppHeader role={profile.role} />
      <div
        style={{
          minHeight: "calc(100vh - 46px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: 24,
        }}
      >
        <Link href="/planning" style={{ textDecoration: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Logo size={180} id="home" />
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "1px", color: "#1d4ed8" }}>{nomApp}</div>
        </Link>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "#334155", textAlign: "center" }}>
          anticiper aujourd&apos;hui, réussir demain
        </h1>
      </div>
    </>
  );
}
