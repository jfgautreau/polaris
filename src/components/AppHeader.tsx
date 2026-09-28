import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/current-user";
import { getCurrentSite } from "@/lib/current-site";
import { getImpersonationPayload } from "@/lib/impersonation";
import { sortirDuMode } from "@/app/platform/actions";
import { MODULES, getPermissions, canRead, canWrite } from "@/lib/permissions";
import { getModulesMasquesC } from "@/lib/site-modules";
import { getAlertesHabilitationsC } from "@/lib/refdata";
import { COOKIE_QUART } from "@/lib/filtres-session";
import MainNav from "@/components/MainNav";
import GardeCacheNavigation from "@/components/GardeCacheNavigation";
import SettingsMenu from "@/components/SettingsMenu";
import UserMenu from "@/components/UserMenu";
import Logo from "@/components/Logo";
const MAIN_ORDER = ["referentiel", "personnel", "absences", "matrice", "habilitations", "visites", "ordonnancement", "planning", "placement", "bilans"];

// En-tete commun : navigation pilotee par la matrice des droits, cloche
// d'alerte habilitations, deconnexion.
export default async function AppHeader({
  role,
  active,
}: {
  role: string;
  active?: string;
}) {
  // Perf (P4, 2026-09-28) : tout est lancé EN PARALLÈLE, et chaque source est
  // dédupliquée par requête (cache()) — requireModule en a déjà lancé la plupart
  // (droits, profil, site, modules masqués, compteur d'alertes). L'en-tête
  // n'ajoute donc plus d'allers-retours en série après les données de la page.
  //
  // Nom du site (multi-tenant) : affiché à côté du logo pour qu'un utilisateur
  // voie toujours DANS QUELLE USINE il travaille. Mode support (impersonation) :
  // bandeau rouge permanent. Compteur d'alertes habilitations (<= 90 j, cache
  // 60 s par site, cf. refdata). Modules MASQUÉS pour ce site (0056). Aucune de
  // ces lectures ne doit casser l'en-tête (login, /affichage) : replis vides.
  const [perms, profile, siteNom, impersonation, alertCount, masques] = await Promise.all([
    getPermissions(role),
    getCurrentProfile(),
    getCurrentSite().then((s) => s.nom).catch(() => ""),
    getImpersonationPayload(),
    getAlertesHabilitationsC().catch(() => 0),
    getModulesMasquesC().catch(() => new Set<string>()),
  ]);

  // Quart mémorisé pour la session (cf. src/lib/filtres-session.ts) : transmis au
  // menu pour qu'un saut depuis un écran sans quart (Personnel…) vers Planning /
  // Placement / Bilans le reprenne. Simple défaut d'affichage : chaque page le
  // revalide contre les quarts du site.
  const quartSession = (await cookies()).get(COOKIE_QUART)?.value ?? "";

  // Une entree s'affiche des que la page est ACCESSIBLE, donc des la lecture — les
  // ecrans de parametrage s'ouvrent desormais en consultation seule (cf. LectureSeule).
  // Seul Placement fait exception : c'est un ecran de saisie, sa page exige "write"
  // (cf. requireModule), afficher l'entree en lecture menerait a une redirection.
  const visible = (m: (typeof MODULES)[number]) =>
    !masques.has(m.key) &&
    (m.key === "placement" ? canWrite(perms, m.key) : canRead(perms, m.key));

  // Navigation principale (ordre impose)
  const mainLinks = MAIN_ORDER.map((k) => MODULES.find((m) => m.key === k))
    .filter((m): m is (typeof MODULES)[number] => !!m)
    .filter(visible);

  // Reste (parametrage) regroupe sous l'engrenage. Habilitations est desormais
  // une tuile du menu principal (plus seulement la cloche d'alerte).
  // La page Equipes heberge desormais la rotation des quarts : son entree est aussi
  // visible pour un droit "ordonnancement" (les droits d'acces sont dans Utilisateurs).
  const visibleConfig = (m: (typeof MODULES)[number]) =>
    m.key === "equipes" ? canRead(perms, "equipes") || canRead(perms, "ordonnancement") : visible(m);
  const configLinks = MODULES.filter(
    (m) => !MAIN_ORDER.includes(m.key) && visibleConfig(m)
  ).map((m) => ({ href: m.href, label: m.label }));

  return (
    <>
    {impersonation && (
      <div
        style={{
          background: "#dc2626",
          color: "#fff",
          padding: "6px 16px",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          position: "sticky",
          top: 0,
          zIndex: 200,
        }}
        className="noprint"
      >
        <span>
          ⚠ <strong>MODE SUPPORT</strong> — vous êtes connecté comme super_admin
          en impersonation du site <strong>{siteNom || impersonation.siteId.slice(0, 8)}</strong>.
          Toute action est tracée dans <code style={{ fontSize: 12 }}>audit_impersonation</code>.
        </span>
        <form action={sortirDuMode} style={{ margin: 0 }}>
          <button
            type="submit"
            style={{
              background: "#fff",
              color: "#dc2626",
              padding: "3px 10px",
              border: 0,
              borderRadius: 4,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Sortir du mode support
          </button>
        </form>
      </div>
    )}
    <header className="appheader">
      <nav className="appnav">
        <Link href="/" className="brand" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 9 }}>
          <Logo size={26} id="header" />
          Polaris
          {siteNom && (
            <span
              title={`Site : ${siteNom}`}
              style={{
                fontSize: 12,
                fontWeight: 500,
                opacity: 0.75,
                marginLeft: 4,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.14)",
              }}
            >
              {siteNom}
            </span>
          )}
        </Link>
        {/* Rendu côté client (usePathname/useSearchParams) pour reporter les
            filtres partagés entre Planning et Personnel. Suspense car
            useSearchParams l'exige ; sur ces pages dynamiques (cookies) le
            fallback ne s'affiche jamais en pratique. */}
        <Suspense fallback={null}>
          <MainNav
            links={mainLinks.map((l) => ({ key: l.key, href: l.href, label: l.label }))}
            active={active}
            quartSession={quartSession}
          />
          {/* Cache de navigation 30 s (P8) : jamais d'état antérieur à une saisie. */}
          <GardeCacheNavigation />
        </Suspense>
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <SettingsMenu links={configLinks} active={active} />
        {!masques.has("habilitations") && (
        <Link href="/habilitations" title="Habilitations à recycler" style={{ position: "relative", textDecoration: "none", fontSize: 18, color: "#fff" }}>
          &#128276;
          {alertCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -6,
                right: -10,
                background: "var(--danger)",
                color: "#fff",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                padding: "0 5px",
              }}
            >
              {alertCount}
            </span>
          )}
        </Link>
        )}
        <UserMenu name={profile?.name ?? ""} email={profile?.email ?? ""} guideVisible={!masques.has("guide")} />
      </div>
    </header>
    </>
  );
}
