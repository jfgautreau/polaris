"use client";

// Bouton « Imprimer cette agence » : isole une seule agence a l'impression.
// A l'inverse d'un simple window.print() (qui sort toutes les agences), on masque
// les autres sections le temps de l'impression, puis on retablit apres coup.
// Les sections d'agence portent l'attribut `data-agence-section` ; la classe
// `.print-hidden` (globals.css, sous @media print) les retire de la sortie.
export default function AgencePrintButton({ targetId }: { targetId: string }) {
  const imprimer = () => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-agence-section]"));
    sections.forEach((s) => {
      if (s.id !== targetId) s.classList.add("print-hidden");
    });
    const cleanup = () => {
      sections.forEach((s) => s.classList.remove("print-hidden"));
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  return (
    <button
      type="button"
      className="noprint"
      onClick={imprimer}
      title="Imprimer / enregistrer en PDF cette agence uniquement"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "#fff",
        color: "#1d4ed8",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 9V3h10v6" />
        <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
        <rect x="7" y="15" width="10" height="6" rx="1" />
      </svg>
      PDF agence
    </button>
  );
}
