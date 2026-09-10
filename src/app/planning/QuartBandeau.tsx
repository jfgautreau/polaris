// Bandeau plein-largeur de rappel du QUART courant, rendu entre la barre
// de recherche et la grille du Planning. Objectif : éviter au manager de
// se tromper de quart en affectant (bug vécu — chaque quart a maintenant
// sa couleur propre, réglée dans /admin/equipes « Horaires des quarts »).
//
// - Un quart sélectionné (matin, après-midi, nuit, journée) → bandeau dans
//   la couleur de ce quart (quart.couleur, migration 0068).
// - AUTO (aucun quart) → bandeau NEUTRE gris/blanc « Tous quarts — AUTO »,
//   pour ne pas laisser croire qu'on édite un quart particulier.
// - Texte lisible sur le fond : noir en général, blanc si la teinte est
//   trop foncée (choix mécanique par luminance).

type Q = { code: string; libelle: string; couleur?: string | null };

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 1;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Approximation perceptuelle simple (Rec. 709).
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export default function QuartBandeau({ quart, quarts }: { quart: string; quarts: Q[] }) {
  const q = quart ? quarts.find((x) => x.code === quart) : null;
  const auto = !q;
  const couleur = q?.couleur || null;
  const bg = auto ? "#f1f5f9" : couleur || "#e5e7eb";
  const fg = !auto && couleur && luminance(couleur) < 0.55 ? "#fff" : "#111827";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: bg,
        color: fg,
        border: "1px solid rgba(0,0,0,.08)",
        borderRadius: 8,
        padding: "10px 16px",
        margin: "6px 0 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontWeight: 700,
        fontSize: 16,
        letterSpacing: 0.3,
        textTransform: "uppercase",
      }}
    >
      {auto ? (
        <>
          <span style={{ opacity: 0.7, fontWeight: 500, textTransform: "none", fontSize: 13 }}>
            Mode
          </span>
          <span>AUTO — tous quarts affichés</span>
        </>
      ) : (
        <>
          <span style={{ opacity: 0.75, fontWeight: 500, textTransform: "none", fontSize: 13 }}>
            Vous éditez le quart
          </span>
          <span>{q!.libelle}</span>
        </>
      )}
    </div>
  );
}
