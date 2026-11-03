// Destination de retour après connexion (`?next=`), venue de l'URL : on n'accepte
// qu'un chemin INTERNE à Polaris. `//site.com` ou `/\site.com` sont lus par le
// navigateur comme une autre origine (redirection ouverte) ; un caractère de
// contrôle peut tromper l'analyse de l'URL. Renvoie null si le chemin est refusé.
export function cheminInterne(v: string | null | undefined): string | null {
  if (!v || v.length > 2000) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  // Ne jamais revenir sur l'écran de connexion lui-même.
  if (v === "/login" || v.startsWith("/login?")) return null;
  return v;
}
