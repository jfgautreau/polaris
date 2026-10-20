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

// Nom de fichier sûr : sans accents ni caractères interdits sous Windows.
export function nomFichierSur(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
