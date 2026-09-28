import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Test simplifie : image Docker/Podman classique (node_modules complets).
  // L'optimisation `output: "standalone"` sera ajoutee au vrai Lot 1.
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
