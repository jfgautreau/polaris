import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import AppHeader from "@/components/AppHeader";
import { requireModule } from "@/lib/permissions";
import { fetchAll } from "@/lib/fetch-all";
import { getNbNiveauxC } from "@/lib/refdata";

type Atelier = { id: string; nom: string };
type Ligne = { id: string; nom: string; atelier_id: string };
type Equipe = { id: string; nom: string };
type Poste = { id: string; nom: string; ligne_id: string; ligne: { nom: string } | null };
type MatriceRow = {
  poste_id: string;
  personne_id: string;
  niveau_actuel: number;
  niveau_cible: number;
};

export default async function BilanPage({
  searchParams,
}: {
  searchParams: Promise<{ atelier?: string; ligne?: string; equipe?: string }>;
}) {
  const { profile } = await requireModule("matrice", "read");

  const sp = await searchParams;
  const supabase = await getServerClient();

  const [{ data: ateliersD }, { data: lignesD }, { data: equipesD }, nbNiveaux] = await Promise.all([
    supabase.from("atelier").select("id, nom").eq("actif", true).order("nom").returns<Atelier[]>(),
    supabase.from("ligne").select("id, nom, atelier_id").eq("actif", true).order("nom").returns<Ligne[]>(),
    supabase.from("equipe").select("id, nom").eq("actif", true).order("nom").returns<Equipe[]>(),
    getNbNiveauxC(),
  ]);
  // Seuils cumulés « Niv ≥ n » : 1..N selon le nombre de niveaux activés (0061).
  const SEUILS = Array.from({ length: nbNiveaux }, (_, i) => i + 1);
  const ateliers = ateliersD ?? [];
  const lignes = lignesD ?? [];
  const equipes = equipesD ?? [];

  // Postes filtres (par atelier / ligne)
  let posteQ = supabase
    .from("poste")
    .select("id, nom, ligne_id, ligne:ligne_id(nom)")
    .eq("actif", true)
    .order("nom");
  if (sp.ligne) {
    posteQ = posteQ.eq("ligne_id", sp.ligne);
  } else if (sp.atelier) {
    const ids = lignes.filter((l) => l.atelier_id === sp.atelier).map((l) => l.id);
    posteQ = posteQ.in("ligne_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: postesD } = await posteQ.returns<Poste[]>();
  const postes = postesD ?? [];

  // Personnes actives (filtre equipe) -> ensemble d'ids
  let persQ = supabase.from("personne").select("id").eq("statut", "ACTIF");
  if (sp.equipe) persQ = persQ.eq("equipe_id", sp.equipe);
  const { data: persD } = await persQ.returns<{ id: string }[]>();
  const personneIds = new Set((persD ?? []).map((p) => p.id));

  // Matrice pour ces postes
  const matriceByPoste = new Map<string, MatriceRow[]>();
  if (postes.length && personneIds.size) {
    const m = await fetchAll<MatriceRow>(() =>
      supabase
        .from("matrice")
        .select("poste_id, personne_id, niveau_actuel, niveau_cible")
        .in("poste_id", postes.map((p) => p.id))
        .order("id")
        .returns<MatriceRow[]>()
    );
    for (const r of m) {
      if (!personneIds.has(r.personne_id)) continue;
      const arr = matriceByPoste.get(r.poste_id) ?? [];
      arr.push(r);
      matriceByPoste.set(r.poste_id, arr);
    }
  }

  return (
    <>
      <AppHeader role={profile.role} active="/matrice" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <div className="toolbar">
          <h1 style={{ margin: 0 }}>Bilan polyvalence</h1>
          <Link href="/matrice" className="navlink">
            &larr; Saisie matrice
          </Link>
        </div>

        <form className="toolbar" method="get">
          <div className="field">
            <span>Atelier</span>
            <select name="atelier" defaultValue={sp.atelier ?? ""}>
              <option value="">Tous</option>
              {ateliers.map((a) => (
                <option key={a.id} value={a.id}>{a.nom}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>Ligne</span>
            <select name="ligne" defaultValue={sp.ligne ?? ""}>
              <option value="">Toutes</option>
              {lignes.map((l) => (
                <option key={l.id} value={l.id}>{l.nom}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>Équipe</span>
            <select name="equipe" defaultValue={sp.equipe ?? ""}>
              <option value="">Toutes</option>
              {equipes.map((e) => (
                <option key={e.id} value={e.id}>{e.nom}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-sm btn-ghost">Filtrer</button>
        </form>

        <div className="card" style={{ overflowX: "auto" }}>
          <p className="muted" style={{ marginBottom: 8 }}>
            Par seuil de niveau N : <strong>Ex</strong> = nb de personnes au niveau actuel &ge; N,{" "}
            <strong>Bes</strong> = nb au niveau cible &ge; N, <strong>Écart</strong>{" "}
            = Bes - Ex (rouge si manque).
          </p>
          <table>
            <thead>
              <tr>
                <th>Poste</th>
                <th>Ligne</th>
                {SEUILS.map((n) => (
                  <th key={n}>Niv &ge; {n} (Ex/Bes/Écart)</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {postes.map((po) => {
                const rows = matriceByPoste.get(po.id) ?? [];
                return (
                  <tr key={po.id}>
                    <td>{po.nom}</td>
                    <td>{po.ligne?.nom ?? "-"}</td>
                    {SEUILS.map((n) => {
                      const ex = rows.filter((r) => r.niveau_actuel >= n).length;
                      const bes = rows.filter((r) => r.niveau_cible >= n).length;
                      const ecart = bes - ex;
                      return (
                        <td key={n}>
                          {ex}/{bes}/
                          <strong style={{ color: ecart > 0 ? "var(--danger)" : "var(--ok)" }}>
                            {ecart > 0 ? `-${ecart}` : ecart === 0 ? "0" : `+${-ecart}`}
                          </strong>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {postes.length === 0 && (
                <tr>
                  <td colSpan={2 + SEUILS.length} className="muted">
                    Aucun poste pour ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
