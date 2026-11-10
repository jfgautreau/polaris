import type { Metadata } from "next";
import "./globals.css";
import { getNomApplication } from "@/lib/nom-application-server";

// Co-localiser les fonctions serveur avec Supabase (eu-west-3 / Paris) pour
// reduire la latence des requetes (1 aller-retour par requete).
export const preferredRegion = ["cdg1"];

// Titre de l'onglet = nom de l'application du site (0095, réglé dans la
// Plateforme) ; nom par défaut sans session.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await getNomApplication(),
    description: "Gestion des plannings d'usine",
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
