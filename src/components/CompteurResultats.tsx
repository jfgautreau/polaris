// Petit compteur de résultats affiché à droite de la barre de recherche
// (Personnel, Matrice, Habilitations). « N personnes » quand tout est affiché,
// sinon « affichés / total ». Purement présentationnel.
export default function CompteurResultats({
  affiches,
  total,
  nom = "personnes",
}: {
  affiches: number;
  total: number;
  nom?: string;
}) {
  return (
    <span className="muted" style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
      {affiches === total ? `${total} ${nom}` : `${affiches} / ${total}`}
    </span>
  );
}
