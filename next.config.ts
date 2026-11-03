import type { NextConfig } from "next";

// En-têtes de sécurité (audit du 2026-11-03), posés sur toutes les réponses.
// CSP : tout vient de Polaris lui-même, sauf l'API Supabase (connexion,
// mot de passe oublié, client navigateur). Scripts et styles inline restent
// permis : Next.js en injecte (hydratation, styles par composant) et le guide
// en contient ; passer aux nonces imposerait un rendu dynamique partout.
// `frame-ancestors 'none'` + X-Frame-Options : Polaris ne s'affiche dans le cadre
// d'aucun autre site (clickjacking). HSTS est déjà posé par Vercel.
const dev = process.env.NODE_ENV !== "production";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") || "https://*.supabase.co";
const supabaseWs = supabase.replace(/^http/, "ws");
const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' en développement seulement (React l'exige pour ses outils).
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabaseWs}${dev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const EN_TETES_SECURITE = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Le lien de mot de passe porte un jeton dans l'URL (/reset?token_hash=…) :
  // jamais transmis en entier à un autre site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: EN_TETES_SECURITE }];
  },
  // Test simplifie : image Docker/Podman classique (node_modules complets).
  // L'optimisation `output: "standalone"` sera ajoutee au vrai Lot 1.

  // React Compiler (2026-09-28) en mode OPT-IN : seuls les composants marqués
  // de la directive "use memo" sont compilés (mémoïsation automatique). Activé
  // d'abord sur Personnel (PersonnelEditor + LignePersonne), à étendre écran par
  // écran après vérification. Nécessite babel-plugin-react-compiler (devDep).
  reactCompiler: { compilationMode: "annotation" },
  experimental: {
    // Perf P8 (2026-09-28) : une page déjà visitée est gardée 30 s dans le
    // navigateur — y revenir par le menu est instantané. Contrepartie : les
    // modifications faites par D'AUTRES postes peuvent mettre jusqu'à 30 s à
    // apparaître sur un écran revisité. Les modifications faites sur CE poste ne
    // sont jamais masquées : cf. src/components/GardeCacheNavigation.tsx.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
