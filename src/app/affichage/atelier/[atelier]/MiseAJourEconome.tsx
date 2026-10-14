"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { versionDonnees } from "../../actions";

// Mise à jour ÉCONOME de l'écran TV (2026-10-14). L'ancien rechargement complet
// toutes les 5 minutes, 24 h/24, coûtait ~5 800 appels par jour et par écran
// (journaux Supabase). Désormais, toutes les 5 minutes, UN petit appel demande la
// version des données du site ; l'écran ne se recharge que si elle a changé — ou
// au changement de jour, pour faire glisser la fenêtre affichée. La nuit et le
// week-end, sans saisie, il ne se recharge donc plus. Onglet caché : rien.
const PERIODE_MS = 5 * 60 * 1000;
// Le serveur (Vercel, UTC) calcule « aujourd'hui » avec 1 à 2 h de retard sur
// l'usine : le changement de jour n'est appliqué qu'à partir de 3 h, heure locale.
const HEURE_BASCULE = 3;

const jourLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function MiseAJourEconome({ version, suitAujourdhui }: { version: string; suitAujourdhui: boolean }) {
  const router = useRouter();
  const jourAffiche = useRef(jourLocal());

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      if (suitAujourdhui && jourLocal() !== jourAffiche.current && new Date().getHours() >= HEURE_BASCULE) {
        jourAffiche.current = jourLocal();
        router.refresh();
        return;
      }
      const v = await versionDonnees().catch(() => "");
      if (v && version && v !== version) router.refresh();
    }, PERIODE_MS);
    return () => clearInterval(id);
  }, [version, suitAujourdhui, router]);

  return null;
}
