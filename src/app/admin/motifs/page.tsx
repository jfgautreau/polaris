import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import ActifCheckbox from "@/components/ActifCheckbox";
import {
  createMotif, updateMotif, toggleMotif, toggleNonPlanifie,
  createAgence, updateAgence, toggleAgence,
  createTypeContrat, updateTypeContrat, toggleTypeContrat,
} from "./actions";
import AjoutModal from "./AjoutModal";
import BandeauErreur from "@/components/BandeauErreur";
import FenetreAffichageInline from "./FenetreAffichageInline";
import { CheckIcon, EditIcon } from "@/components/icons";

type Motif = { id: string; libelle: string; code_court: string; couleur: string; actif: boolean; non_planifie: boolean };
type Agence = { id: string; nom: string; actif: boolean };
type TypeContrat = { code: string; libelle: string; actif: boolean; ordre: number };
type FenetreAffichage = { jours_avant: number; jours_apres: number };

// Règles d'écran de paramétrage (cf. CLAUDE.md — « Ossature des écrans de paramétrage »)
// appliquées ici comme référence :
//   - Icône ✏️ (crayon) à la place du bouton « Modifier ».
//   - Icône 💾 (disquette) à la place du bouton « Enregistrer ».
//   - Colonne « Actif » à droite, case à cocher (ActifCheckbox) — remplace le
//     couple ancien « badge Statut + bouton Désactiver/Réactiver ».
//   - Bloc de réglages simples (couple de nombres) : enregistrement automatique
//     à la modification, sans bouton (cf. FenetreAffichageInline).

export default async function MotifsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; err?: string }>;
}) {
  const { profile, perms } = await requireModule("motifs", "read");

  const sp = await searchParams;
  const supabase = await getServerClient();
  const [motifsR, agencesR, typesR, fenR] = await Promise.all([
    supabase.from("motif_absence").select("id, libelle, code_court, couleur, actif, non_planifie").order("libelle").returns<Motif[]>(),
    supabase.from("agence_interim").select("id, nom, actif").order("nom").returns<Agence[]>(),
    supabase.from("type_contrat").select("code, libelle, actif, ordre").order("ordre").returns<TypeContrat[]>(),
    supabase.from("parametre_affichage").select("jours_avant, jours_apres").maybeSingle<FenetreAffichage>(),
  ]);
  // Repli tant que la migration 0060 (colonne non_planifie) n'est pas jouée.
  const npDispo = !motifsR.error;
  let motifs = motifsR.data ?? [];
  if (motifsR.error) {
    const { data } = await supabase.from("motif_absence").select("id, libelle, code_court, couleur, actif").order("libelle").returns<Omit<Motif, "non_planifie">[]>();
    motifs = (data ?? []).map((m) => ({ ...m, non_planifie: false }));
  }
  const agences = agencesR.data ?? [];
  const agencesIndispo = !!agencesR.error;
  const types = typesR.data ?? [];
  const typesIndispo = !!typesR.error;
  const fenetre: FenetreAffichage = fenR.data ?? { jours_avant: 1, jours_apres: 4 };
  const fenetreIndispo = !!fenR.error;

  return (
    <>
      <AppHeader role={profile.role} active="/admin/motifs" />
      <div className="container">
        <h1>Paramètres RH</h1>
        <BandeauErreur message={sp.err} />
        <LectureSeule actif={!canWrite(perms, "motifs")}>

        {/* ---------------- Motifs d'absence ---------------- */}
        <h2 style={{ marginBottom: 4 }}>Motifs d&apos;absence</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Ces motifs apparaissent dans les listes du planning. Cochez{" "}
          <strong>Non planifié</strong> pour les absences subies (maladie, accident,
          injustifié) : elles sont isolées dans le rapport Absentéisme (taux non
          planifié, Bradford), le vrai risque ligne. Non coché = planifié (CP, RTT,
          formation…).
          {!npDispo && (
            <> <strong style={{ color: "var(--danger)" }}>Exécutez la migration 0060</strong> dans le SQL Editor pour activer cette colonne.</>
          )}
        </p>

        <AjoutModal libelle="Ajouter un motif" titre="Ajouter un motif d'absence">
          <form action={createMotif} autoComplete="off" className="inline-form">
            <div className="field">
              <span>Couleur</span>
              <input name="couleur" type="color" defaultValue="#e5e7eb" style={{ width: 48, padding: 2 }} />
            </div>
            <div className="field">
              <span>Libellé</span>
              <input name="libelle" placeholder="Ex. Congé payé" required />
            </div>
            <div className="field">
              <span>Code</span>
              <input name="code_court" placeholder="CP" maxLength={6} required />
            </div>
            <button type="submit" className="btn-sm">Ajouter</button>
          </form>
        </AjoutModal>

        <div className="card" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th>Couleur</th>
                <th>Libellé</th>
                <th>Code</th>
                <th style={{ width: 90, textAlign: "center" }}>Non planifié</th>
                <th style={{ width: 90 }}></th>
                <th style={{ width: 60, textAlign: "center" }}>Actif</th>
              </tr>
            </thead>
            <tbody>
              {motifs.map((m) =>
                sp.edit === `motif:${m.id}` ? (
                  // Édition INLINE : les champs se déverrouillent DANS leurs colonnes
                  // (le `<form>` vide est relié aux inputs par l'attribut `form=`,
                  // HTML valide et compatible server action). Plus de ligne pleine
                  // largeur qui cassait l'alignement.
                  <tr key={m.id} style={{ background: "#fefce8" }}>
                    <td>
                      <form id={`ed-motif-${m.id}`} action={updateMotif} autoComplete="off" />
                      <input form={`ed-motif-${m.id}`} type="hidden" name="id" value={m.id} />
                      <input form={`ed-motif-${m.id}`} name="couleur" type="color" defaultValue={m.couleur} style={{ width: 40, height: 26, padding: 1 }} />
                    </td>
                    <td><input form={`ed-motif-${m.id}`} name="libelle" defaultValue={m.libelle} autoFocus required style={{ width: "100%" }} /></td>
                    <td><input form={`ed-motif-${m.id}`} name="code_court" defaultValue={m.code_court} maxLength={6} required style={{ width: 90 }} /></td>
                    <td style={{ textAlign: "center" }}><ActifCheckbox id={m.id} actif={m.non_planifie} action={toggleNonPlanifie} title={m.non_planifie ? "Repasser en planifié" : "Marquer non planifié"} /></td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                      <button form={`ed-motif-${m.id}`} type="submit" title="Valider" className="iconbtn ok"><CheckIcon /></button>
                      <Link href="/admin/motifs" className="iconbtn ghost" scroll={false} title="Annuler">✕</Link>
                    </td>
                    <td style={{ textAlign: "center" }}><ActifCheckbox id={m.id} actif={m.actif} action={toggleMotif} /></td>
                  </tr>
                ) : (
                  <tr key={m.id} style={{ opacity: m.actif ? 1 : 0.55 }}>
                    <td><span style={{ display: "inline-block", width: 20, height: 14, borderRadius: 3, background: m.couleur, border: "1px solid #cbd5e1" }} /></td>
                    <td>{m.libelle}</td>
                    <td><strong>{m.code_court}</strong></td>
                    <td style={{ textAlign: "center" }}>
                      <ActifCheckbox id={m.id} actif={m.non_planifie} action={toggleNonPlanifie} title={m.non_planifie ? "Non planifié — repasser en planifié" : "Planifié — marquer non planifié"} />
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                      <Link href={`/admin/motifs?edit=motif:${m.id}`} className="iconbtn edit" scroll={false} prefetch={false} title="Modifier"><EditIcon /></Link>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <ActifCheckbox id={m.id} actif={m.actif} action={toggleMotif} />
                    </td>
                  </tr>
                )
              )}
              {motifs.length === 0 && (<tr><td colSpan={6} className="muted">Aucun motif.</td></tr>)}
            </tbody>
          </table>
        </div>

        {/* ---------------- Agences d'interim ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Agences d&apos;intérim</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Cette liste alimente le menu déroulant <strong>Agence</strong> à la saisie d&apos;un
          contrat d&apos;intérim, dans Personnel. Désactiver retire l&apos;agence du menu ; les
          contrats passés qui la mentionnent restent intacts.
        </p>

        {agencesIndispo ? (
          <div className="card" style={{ marginBottom: 24 }}>
            <p className="muted" style={{ margin: 0 }}>
              La table des agences n&apos;existe pas encore : exécutez la migration{" "}
              <strong>0034_agence_interim.sql</strong> dans le SQL Editor.
            </p>
          </div>
        ) : (
          <>
            <AjoutModal libelle="Ajouter une agence" titre="Ajouter une agence d'intérim">
              <form action={createAgence} autoComplete="off" className="inline-form">
                <div className="field">
                  <span>Nom</span>
                  <input name="nom" placeholder="Ex. Adecco" required />
                </div>
                <button type="submit" className="btn-sm">Ajouter</button>
              </form>
            </AjoutModal>

            <div className="card" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Agence</th>
                    <th style={{ width: 90 }}></th>
                    <th style={{ width: 60, textAlign: "center" }}>Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {agences.map((a) =>
                    sp.edit === `agence:${a.id}` ? (
                      <tr key={a.id} style={{ background: "#fefce8" }}>
                        <td>
                          <form id={`ed-agence-${a.id}`} action={updateAgence} autoComplete="off" />
                          <input form={`ed-agence-${a.id}`} type="hidden" name="id" value={a.id} />
                          <input form={`ed-agence-${a.id}`} name="nom" defaultValue={a.nom} autoFocus required style={{ width: "100%" }} />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button form={`ed-agence-${a.id}`} type="submit" title="Valider" className="iconbtn ok"><CheckIcon /></button>
                          <Link href="/admin/motifs" className="iconbtn ghost" scroll={false} title="Annuler">✕</Link>
                        </td>
                        <td style={{ textAlign: "center" }}><ActifCheckbox id={a.id} actif={a.actif} action={toggleAgence} /></td>
                      </tr>
                    ) : (
                      <tr key={a.id} style={{ opacity: a.actif ? 1 : 0.55 }}>
                        <td>{a.nom}</td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <Link href={`/admin/motifs?edit=agence:${a.id}`} className="iconbtn edit" scroll={false} prefetch={false} title="Modifier"><EditIcon /></Link>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <ActifCheckbox id={a.id} actif={a.actif} action={toggleAgence} />
                        </td>
                      </tr>
                    )
                  )}
                  {agences.length === 0 && (<tr><td colSpan={3} className="muted">Aucune agence.</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ---------------- Types de contrat (0040) ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Types de contrat</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Alimente le menu déroulant <strong>Contrat</strong> dans Personnel et dans les périodes
          de contrat. Le <strong>code</strong> est ce qui est stocké sur chaque personne
          (« CDI », « CDD », « INTERIM »…). Retirer un type n&apos;efface pas l&apos;historique.
        </p>

        {typesIndispo ? (
          <div className="card" style={{ marginBottom: 24 }}>
            <p className="muted" style={{ margin: 0 }}>
              La table des types de contrat n&apos;existe pas encore : exécutez la migration{" "}
              <strong>0040_types_contrat_et_affichage.sql</strong> dans le SQL Editor.
            </p>
          </div>
        ) : (
          <>
            <AjoutModal libelle="Ajouter un type" titre="Ajouter un type de contrat">
              <form action={createTypeContrat} autoComplete="off" className="inline-form">
                <div className="field">
                  <span>Code</span>
                  <input name="code" placeholder="Ex. ALTERNANCE" maxLength={20} required style={{ textTransform: "uppercase" }} />
                </div>
                <div className="field">
                  <span>Libellé</span>
                  <input name="libelle" placeholder="Ex. Alternance" required />
                </div>
                <div className="field">
                  <span>Ordre</span>
                  <input name="ordre" type="number" defaultValue={99} min={0} max={999} style={{ width: 80 }} />
                </div>
                <button type="submit" className="btn-sm">Ajouter</button>
              </form>
            </AjoutModal>

            <div className="card" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Libellé</th>
                    <th>Ordre</th>
                    <th style={{ width: 90 }}></th>
                    <th style={{ width: 60, textAlign: "center" }}>Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) =>
                    sp.edit === `type:${t.code}` ? (
                      <tr key={t.code} style={{ background: "#fefce8" }}>
                        <td>
                          <form id={`ed-type-${t.code}`} action={updateTypeContrat} autoComplete="off" />
                          <input form={`ed-type-${t.code}`} type="hidden" name="code" value={t.code} />
                          <strong>{t.code}</strong>
                        </td>
                        <td><input form={`ed-type-${t.code}`} name="libelle" defaultValue={t.libelle} autoFocus required style={{ width: "100%" }} /></td>
                        <td><input form={`ed-type-${t.code}`} name="ordre" type="number" defaultValue={t.ordre} style={{ width: 70 }} /></td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button form={`ed-type-${t.code}`} type="submit" title="Valider" className="iconbtn ok"><CheckIcon /></button>
                          <Link href="/admin/motifs" className="iconbtn ghost" scroll={false} title="Annuler">✕</Link>
                        </td>
                        <td style={{ textAlign: "center" }}><ActifCheckbox id={t.code} actif={t.actif} action={toggleTypeContrat} keyName="code" /></td>
                      </tr>
                    ) : (
                      <tr key={t.code} style={{ opacity: t.actif ? 1 : 0.55 }}>
                        <td><strong>{t.code}</strong></td>
                        <td>{t.libelle}</td>
                        <td>{t.ordre}</td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <Link href={`/admin/motifs?edit=type:${t.code}`} className="iconbtn edit" scroll={false} prefetch={false} title="Modifier"><EditIcon /></Link>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {/* PK texte `code` (pas un uuid) : on passe keyName="code" à ActifCheckbox
                              pour que le champ du formulaire porte le bon nom. */}
                          <ActifCheckbox id={t.code} actif={t.actif} action={toggleTypeContrat} keyName="code" />
                        </td>
                      </tr>
                    )
                  )}
                  {types.length === 0 && (<tr><td colSpan={5} className="muted">Aucun type.</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ---------------- Fenêtre d'affichage du planning (0040) ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Fenêtre d&apos;affichage du planning</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Nombre de jours affichés autour d&apos;aujourd&apos;hui sur l&apos;écran TV et les vues
          glissantes du planning. Défaut : <strong>J−1</strong> et <strong>J+4</strong>.
          Enregistrement automatique.
        </p>

        {fenetreIndispo ? (
          <div className="card" style={{ marginBottom: 24 }}>
            <p className="muted" style={{ margin: 0 }}>
              La table des paramètres d&apos;affichage n&apos;existe pas encore : exécutez la migration{" "}
              <strong>0040_types_contrat_et_affichage.sql</strong> dans le SQL Editor.
            </p>
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 24 }}>
            <FenetreAffichageInline initial={fenetre} />
          </div>
        )}
        </LectureSeule>
      </div>
    </>
  );
}
