import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import { getCurrentSite } from "@/lib/current-site";
import { getImpersonationPayload } from "@/lib/impersonation";
import { sortirDuMode } from "@/app/platform/actions";
import { isoDate, addDays } from "@/lib/week";
import { MODULES, getPermissions, canRead, canWrite } from "@/lib/permissions";
import { getModulesMasquesC } from "@/lib/site-modules";
import SettingsMenu from "@/components/SettingsMenu";
import UserMenu from "@/components/UserMenu";
import Logo from "@/components/Logo";
import { NavIcon, NAV_COLOR } from "@/components/NavIcons";

const MAIN_ORDER = ["referentiel", "personnel", "matrice", "habilitations", "ordonnancement", "planning", "placement", "bilans"];

// Palette des pastilles (icone blanche dessus) : source unique dans NavIcons.
const NAV_TILE = NAV_COLOR;

// En-tete commun : navigation pilotee par la matrice des droits, cloche
// d'alerte habilitations, deconnexion.
export default async function AppHeader({
  role,
  active,
}: {
  role: string;
  active?: string;
}) {
  const perms = await getPermissions(role);
  const profile = await getCurrentProfile();

  // Nom du site (multi-tenant, cf. tasks/multi-site.md). Affiché à côté
  // du logo pour qu'un utilisateur voit toujours DANS QUELLE USINE il
  // travaille. Un throw ici ne doit pas casser l'en-tête (login, /affichage
  // avant middleware sitisé...), d'où le try/catch avec un nom vide.
  let siteNom = "";
  try {
    const site = await getCurrentSite();
    siteNom = site.nom;
  } catch {
    siteNom = "";
  }

  // Mode support (impersonation) : bandeau rouge permanent en haut de
  // toute page tant que le cookie polaris-impersonate est actif. Bouton
  // « Sortir » qui trace la fin dans audit_impersonation.
  const impersonation = await getImpersonationPayload();

  // Compteur d'alertes habilitations (<= 90 jours)
  let alertCount = 0;
  try {
    const supabase = await getServerClient();
    const limit = isoDate(addDays(new Date(), 90));
    const { count } = await supabase
      .from("personne_competence")
      .select("*", { count: "exact", head: true })
      .not("date_expiration", "is", null)
      .lte("date_expiration", limit);
    alertCount = count ?? 0;
  } catch {
    alertCount = 0;
  }

  // Modules MASQUÉS pour ce site (0056) : pilotés depuis /platform, ils
  // disparaissent de la navigation pour tout le monde. Un throw ne doit pas
  // casser l'en-tête (login, /affichage) : ensemble vide en repli.
  let masques = new Set<string>();
  try {
    masques = await getModulesMasquesC();
  } catch {
    masques = new Set<string>();
  }

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
        {mainLinks.map((l) => {
          const tile = NAV_TILE[l.key];
          return (
            <Link
              key={l.href}
              href={l.href}
              className={active === l.href ? "navlink active" : "navlink"}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              {tile && (
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    background: tile,
                    flexShrink: 0,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
                  }}
                >
                  <NavIcon name={l.key} />
                </span>
              )}
              {l.label}
            </Link>
          );
        })}
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
