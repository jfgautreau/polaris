"use client";

import { useState } from "react";
import ModaleDeplacable from "@/components/ModaleDeplacable";

// Bouton « Ajouter » + fenetre modale portant le formulaire de creation.
// Le formulaire lui-meme reste rendu cote SERVEUR et arrive ici en `children` :
// il garde donc sa server action, et l'on n'a pas a rapatrier la logique
// d'ecriture dans un composant client.
//
// La modale utilise <ModaleDeplacable> : le bandeau titre porte `.mdd-drag`,
// l'utilisateur peut deplacer la fenetre pour verifier la liste sous-jacente
// avant de creer un doublon (regle CLAUDE.md « toute modale doit etre
// deplacable »). Cf. audit S5 (2026-09-10).
export default function AjoutModal({
  libelle,
  titre,
  children,
}: {
  libelle: string;
  titre: string;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="btn-sm" style={{ width: "auto" }} onClick={() => setOuvert(true)}>
          ＋ {libelle}
        </button>
      </div>

      {ouvert && (
        <ModaleDeplacable onClose={() => setOuvert(false)} largeur={520}>
          <div
            className="mdd-drag"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              cursor: "move",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>{titre}</h2>
            <button
              type="button"
              className="btn-sm btn-ghost"
              onClick={() => setOuvert(false)}
              title="Fermer"
              style={{ width: "auto" }}
            >
              ✕
            </button>
          </div>
          {children}
        </ModaleDeplacable>
      )}
    </>
  );
}
