// Téléchargement d'un fichier construit dans le navigateur (exports PDF / Excel).
// À appeler depuis un composant client, au clic.
export const TYPE_PDF = "application/pdf";
export const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function telechargerFichier(octets: Uint8Array, nomFichier: string, type: string): void {
  const blob = new Blob([octets as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Envoie un PDF construit dans le navigateur à l'IMPRIMANTE (2026-11-27) : le
// fichier est chargé dans un cadre caché dont on ouvre le dialogue d'impression —
// pas de téléchargement, pas de nouvel onglet. La CSP autorise `frame-src blob:`
// pour cela (next.config.ts). Si le navigateur refuse (lecteur PDF intégré
// désactivé…), le fichier est téléchargé à la place : rien n'est perdu.
export function imprimerPdf(octets: Uint8Array, nomFichier: string): void {
  const url = URL.createObjectURL(new Blob([octets as BlobPart], { type: TYPE_PDF }));
  document.getElementById("impression-pdf")?.remove();
  const cadre = document.createElement("iframe");
  cadre.id = "impression-pdf";
  cadre.setAttribute("aria-hidden", "true");
  cadre.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  let fait = false;
  const repli = () => {
    if (fait) return;
    fait = true;
    cadre.remove();
    URL.revokeObjectURL(url);
    telechargerFichier(octets, nomFichier, TYPE_PDF);
  };
  cadre.onload = () => {
    if (fait) return;
    try {
      const w = cadre.contentWindow;
      if (!w) return repli();
      w.focus();
      w.print();
      fait = true; // le cadre reste en place : le dialogue lit encore le fichier
    } catch {
      repli();
    }
  };
  cadre.onerror = repli;
  cadre.src = url;
  document.body.appendChild(cadre);
  // Cadre jamais chargé (lecteur PDF absent : le navigateur télécharge ou bloque).
  setTimeout(repli, 4000);
}

// Nom de fichier sûr : sans accents ni caractères interdits sous Windows.
export function nomFichierSur(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
