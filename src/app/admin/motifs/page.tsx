import Link from "next/link";
import { getServerClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import ActifCheckbox from "@/components/ActifCheckbox";
import {
  createMotif, updateMotif, toggleMotif, toggleNonPlanifie, toggleVisibleOperateurs, toggleMasqueAffichage,
  createAgence, updateAgence, toggleAgence,
  createAccueil, updateAccueil, toggleAccueil,
  createTypeContrat, updateTypeContrat, toggleTypeContrat, toggleTypeContratAgence,
} from "./actions";
import AjoutModal from "./AjoutModal";
import BandeauErreur from "@/components/BandeauErreur";
import FenetreAffichageInline from "./FenetreAffichageInline";
import NomFichierInterimInline from "./NomFichierInterimInline";
import { getCurrentSite } from "@/lib/current-site";
import { CheckIcon, EditIcon } from "@/components/icons";
import CouleursMotif from "./CouleursMotif";
import { texteSur } from "@/lib/couleur-texte";

type Motif = { id: string; libelle: string; code_court: string; couleur: string; actif: boolean; non_planifie: boolean; code_gt: string | null; visible_operateurs: boolean };
type Agence = { id: string; nom: string; actif: boolean };
type Accueil = { id: string; libelle: string; ordre: number; actif: boolean };
type TypeContrat = { code: string; libelle: string; actif: boolean; ordre: number; avec_agence: boolean };
type FenetreAffichage = { mode?: "relatif" | "absolu"; jours_avant: number; jours_apres: number; nb_semaines?: number };

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
  const [motifsR, agencesR, typesR, fenR, paramRhR, site, accueilsR, masquesR, textesR] = await Promise.all([
    supabase.from("motif_absence").select("id, libelle, code_court, couleur, actif, non_planifie, code_gt, visible_operateurs").order("libelle").returns<Motif[]>(),
    supabase.from("agence_interim").select("id, nom, actif").order("nom").returns<Agence[]>(),
    supabase.from("type_contrat").select("code, libelle, actif, ordre, avec_agence").order("ordre").returns<TypeContrat[]>(),
    supabase.from("parametre_affichage").select("mode, jours_avant, jours_apres, nb_semaines").maybeSingle<FenetreAffichage>(),
    // Réglages RH du site (0093, RLS : ligne du site courant).
    supabase.from("parametre_rh").select("interim_nom_fichier").maybeSingle<{ interim_nom_fichier: string | null }>(),
    getCurrentSite(),
    // Accueils des nouveaux (0096, RLS : lignes du site courant).
    supabase.from("accueil").select("id, libelle, ordre, actif").order("ordre").order("libelle").returns<Accueil[]>(),
    // Motif masqué sur l'Affichage (0098) : lu À PART, pour qu'une migration pas
    // encore jouée ne fasse pas tomber les autres colonnes des motifs.
    supabase.from("motif_absence").select("id, masque_affichage").returns<{ id: string; masque_affichage: boolean }[]>(),
    // Couleur du texte (0099) : lue à part, pour la même raison.
    supabase.from("motif_absence").select("id, couleur_texte").returns<{ id: string; couleur_texte: string | null }[]>(),
  ]);
  const texteDispo = !textesR.error;
  const textes = new Map((textesR.data ?? []).map((m) => [m.id, m.couleur_texte]));
  const masqueDispo = !masquesR.error;
  const masques = new Map((masquesR.data ?? []).map((m) => [m.id, m.masque_affichage]));
  const accueils = accueilsR.data ?? [];
  const accueilsIndispo = !!accueilsR.error;
  // Replis en cascade : code_gt (0066) puis non_planifie (0060) peuvent manquer
  // tant que la migration correspondante n'est pas jouée.
  let motifs = motifsR.data ?? [];
  let gtDispo = !motifsR.error;
  let npDispo = !motifsR.error;
  if (motifsR.error) {
    const r2 = await supabase.from("motif_absence").select("id, libelle, code_court, couleur, actif, non_planifie").order("libelle").returns<Omit<Motif, "code_gt" | "visible_operateurs">[]>();
    if (!r2.error) {
      npDispo = true;
      motifs = (r2.data ?? []).map((m) => ({ ...m, code_gt: null, visible_operateurs: false }));
    } else {
      const { data } = await supabase.from("motif_absence").select("id, libelle, code_court, couleur, actif").order("libelle").returns<Omit<Motif, "non_planifie" | "code_gt" | "visible_operateurs">[]>();
      motifs = (data ?? []).map((m) => ({ ...m, non_planifie: false, code_gt: null, visible_operateurs: false }));
    }
  }
  const agences = agencesR.data ?? [];
  const agencesIndispo = !!agencesR.error;
  // Repli tolérant : la colonne avec_agence (0072) peut ne pas être encore
  // appliquée. En cas d'erreur, on retente sans elle (avec_agence = false) pour
  // ne pas faire croire que toute la table manque.
  let types = typesR.data ?? [];
  let typesIndispo = !!typesR.error;
  let agenceFlagDispo = !typesR.error;
  if (typesR.error) {
    const r2 = await supabase.from("type_contrat").select("code, libelle, actif, ordre").order("ordre").returns<Omit<TypeContrat, "avec_agence">[]>();
    if (!r2.error) {
      typesIndispo = false;
      types = (r2.data ?? []).map((t) => ({ ...t, avec_agence: false }));
    }
  }
  // Repli tolérant : la migration 0067 (colonnes mode/nb_semaines) peut ne pas
  // être encore appliquée. En cas d'erreur, on retente avec les seules colonnes
  // historiques pour ne pas bloquer l'écran.
  let fenetre: FenetreAffichage = { mode: "relatif", jours_avant: 1, jours_apres: 4, nb_semaines: 2 };
  let fenetreIndispo = false;
  if (!fenR.error && fenR.data) {
    fenetre = { mode: "relatif", nb_semaines: 2, ...fenR.data };
  } else if (fenR.error) {
    const r2 = await supabase.from("parametre_affichage").select("jours_avant, jours_apres").maybeSingle<{ jours_avant: number; jours_apres: number }>();
    if (!r2.error) fenetre = { mode: "relatif", nb_semaines: 2, ...(r2.data ?? { jours_avant: 1, jours_apres: 4 }) };
    else fenetreIndispo = true;
  }

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
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Cochez <strong>PDF pour Affich.</strong> pour les motifs qui peuvent figurer, avec
          leur libellé, dans la colonne « Absents du jour » de la feuille « PDF pour Affich. »
          du Placement. Un motif non coché n&apos;y apparaît pas. Le PDF Manager montre
          toujours tous les motifs.
        </p>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          <strong>Couleurs</strong> : la couleur de la case et celle du texte se règlent avec le
          crayon ; l&apos;aperçu montre le code tel qu&apos;il s&apos;affiche au Planning. Texte
          « Auto » = noir ou blanc, selon la couleur de la case.
          {!texteDispo && (
            <> <strong style={{ color: "var(--danger)" }}>Exécutez la migration 0099</strong> dans le SQL Editor pour choisir la couleur du texte.</>
          )}
        </p>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          <strong>Motif masqué</strong> concerne l&apos;Affichage (plannings des écrans TV
          et leurs feuilles imprimées) : coché, la personne y est notée « Absence », sans
          motif ; décoché, le libellé du motif s&apos;affiche (« Formation »).
          {!masqueDispo && (
            <> <strong style={{ color: "var(--danger)" }}>Exécutez la migration 0098</strong> dans le SQL Editor pour activer cette colonne.</>
          )}
        </p>
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Le <strong>Code GT</strong> est le code du logiciel RH (« 00CLFA »,
          « 00MASH »…) rattaché à ce motif : il sert à l&apos;import automatique
          des absences (section plus bas). Un code inconnu à l&apos;import crée un
          nouveau motif.
          {!gtDispo && (
            <> <strong style={{ color: "var(--danger)" }}>Exécutez la migration 0066</strong> pour activer le Code GT et l&apos;import.</>
          )}
        </p>

        <AjoutModal libelle="Ajouter un motif" titre="Ajouter un motif d'absence">
          <form action={createMotif} autoComplete="off" className="inline-form">
            <div className="field">
              <span>Couleurs</span>
              <CouleursMotif fondInitial="#e2e8f0" texteInitial={null} code="" avecTexte={texteDispo} />
            </div>
            <div className="field">
              <span>Libellé</span>
              <input name="libelle" placeholder="Ex. Congé payé" required />
            </div>
            <div className="field">
              <span>Code</span>
              <input name="code_court" placeholder="CP" maxLength={6} required />
            </div>
            <div className="field">
              <span>Code GT</span>
              <input name="code_gt" placeholder="00CLFA" maxLength={20} />
            </div>
            <button type="submit" className="btn-sm">Ajouter</button>
          </form>
        </AjoutModal>

        <div className="card" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th title="Couleur de la case, couleur du texte (« A » : automatique = noir ou blanc selon la case) et aperçu du code tel qu'il s'affiche au Planning. Se règlent avec le crayon." style={{ cursor: "help" }}>Couleurs</th>
                <th>Libellé</th>
                <th>Code</th>
                <th style={{ width: 90 }}>Code GT</th>
                <th style={{ width: 90, textAlign: "center" }}>Non planifié</th>
                <th style={{ width: 100, textAlign: "center" }} title="Coché : les personnes absentes pour ce motif figurent, avec le motif, sur le « PDF pour Affich. » du Placement. Décoché : elles n'y apparaissent pas.">PDF pour Affich.</th>
                <th style={{ width: 100, textAlign: "center", cursor: "help" }} title="Affichage (plannings des écrans TV et feuilles imprimées). Coché : la personne absente pour ce motif est notée « Absence », sans motif. Décoché : le libellé du motif s'affiche à la place (exemple : « Formation »).">Motif masqué</th>
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
                      <CouleursMotif form={`ed-motif-${m.id}`} fondInitial={m.couleur} texteInitial={textes.get(m.id) ?? null} code={m.code_court} avecTexte={texteDispo} />
                    </td>
                    <td><input form={`ed-motif-${m.id}`} name="libelle" defaultValue={m.libelle} autoFocus required style={{ width: "100%" }} /></td>
                    <td><input form={`ed-motif-${m.id}`} name="code_court" defaultValue={m.code_court} maxLength={6} required style={{ width: 90 }} /></td>
                    <td><input form={`ed-motif-${m.id}`} name="code_gt" defaultValue={m.code_gt ?? ""} maxLength={20} placeholder="00CLFA" style={{ width: 90 }} /></td>
                    <td style={{ textAlign: "center" }}><ActifCheckbox id={m.id} actif={m.non_planifie} action={toggleNonPlanifie} title={m.non_planifie ? "Repasser en planifié" : "Marquer non planifié"} /></td>
                    <td style={{ textAlign: "center" }}><ActifCheckbox id={m.id} actif={m.visible_operateurs} action={toggleVisibleOperateurs} title={m.visible_operateurs ? "Affiché sur le PDF pour Affich. — masquer" : "Masqué du PDF pour Affich. — afficher"} /></td>
                    <td style={{ textAlign: "center" }}>
                      {masqueDispo ? (
                        <ActifCheckbox id={m.id} actif={masques.get(m.id) ?? true} action={toggleMasqueAffichage} title={(masques.get(m.id) ?? true) ? "Masqué : « Absence » sur l'Affichage — afficher le motif" : "Le motif s'affiche sur l'Affichage — le masquer"} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                      <button form={`ed-motif-${m.id}`} type="submit" title="Valider" className="iconbtn ok"><CheckIcon /></button>
                      <Link href="/admin/motifs" className="iconbtn ghost" scroll={false} title="Annuler">✕</Link>
                    </td>
                    <td style={{ textAlign: "center" }}><ActifCheckbox id={m.id} actif={m.actif} action={toggleMotif} /></td>
                  </tr>
                ) : (
                  <tr key={m.id} style={{ opacity: m.actif ? 1 : 0.55 }}>
                    <td>
                      {/* Aperçu : le code tel qu'il s'affiche au Planning (fond + texte). */}
                      <span title="Aperçu du Planning" style={{ display: "inline-block", minWidth: 44, textAlign: "center", padding: "3px 8px", borderRadius: 4, background: m.couleur, color: texteSur(m.couleur, textes.get(m.id)), fontSize: 12, border: "1px solid #cbd5e1" }}>{m.code_court}</span>
                    </td>
                    <td>{m.libelle}</td>
                    <td><strong>{m.code_court}</strong></td>
                    <td>{m.code_gt || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "center" }}>
                      <ActifCheckbox id={m.id} actif={m.non_planifie} action={toggleNonPlanifie} title={m.non_planifie ? "Non planifié — repasser en planifié" : "Planifié — marquer non planifié"} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <ActifCheckbox id={m.id} actif={m.visible_operateurs} action={toggleVisibleOperateurs} title={m.visible_operateurs ? "Affiché sur le PDF pour Affich. — masquer" : "Masqué du PDF pour Affich. — afficher"} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {masqueDispo ? (
                        <ActifCheckbox id={m.id} actif={masques.get(m.id) ?? true} action={toggleMasqueAffichage} title={(masques.get(m.id) ?? true) ? "Masqué : « Absence » sur l'Affichage — afficher le motif" : "Le motif s'affiche sur l'Affichage — le masquer"} />
                      ) : (
                        <span className="muted">—</span>
                      )}
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
              {motifs.length === 0 && (<tr><td colSpan={8} className="muted">Aucun motif.</td></tr>)}
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

        {/* ---------------- Accueils des nouveaux (0096) ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Accueils des nouveaux</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Chaque accueil actif devient une pastille de la colonne <strong>Accueil</strong> du
          Personnel, dans l&apos;ordre du N°, pour noter « OK » quand la personne l&apos;a fait.
          Libellé court (20 caractères au plus). Désactiver masque la pastille sans effacer les
          OK déjà posés.
        </p>

        {accueilsIndispo ? (
          <div className="card" style={{ marginBottom: 24 }}>
            <p className="muted" style={{ margin: 0 }}>
              La table des accueils n&apos;existe pas encore : exécutez la migration{" "}
              <strong>0096_accueil_nouveaux.sql</strong> dans le SQL Editor.
            </p>
          </div>
        ) : (
          <>
            <AjoutModal libelle="Ajouter un accueil" titre="Ajouter un accueil">
              <form action={createAccueil} autoComplete="off" className="inline-form">
                <div className="field">
                  <span>N°</span>
                  <input name="ordre" type="number" min={0} defaultValue={accueils.length + 1} style={{ width: 70 }} />
                </div>
                <div className="field">
                  <span>Libellé</span>
                  <input name="libelle" placeholder="Ex. MP" maxLength={20} required />
                </div>
                <button type="submit" className="btn-sm">Ajouter</button>
              </form>
            </AjoutModal>

            <div className="card" style={{ marginBottom: 24 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>N°</th>
                    <th>Accueil</th>
                    <th style={{ width: 90 }}></th>
                    <th style={{ width: 60, textAlign: "center" }}>Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {accueils.map((a) =>
                    sp.edit === `accueil:${a.id}` ? (
                      <tr key={a.id} style={{ background: "#fefce8" }}>
                        <td>
                          <form id={`ed-accueil-${a.id}`} action={updateAccueil} autoComplete="off" />
                          <input form={`ed-accueil-${a.id}`} type="hidden" name="id" value={a.id} />
                          <input form={`ed-accueil-${a.id}`} name="ordre" type="number" min={0} defaultValue={a.ordre} style={{ width: 60 }} />
                        </td>
                        <td>
                          <input form={`ed-accueil-${a.id}`} name="libelle" defaultValue={a.libelle} maxLength={20} autoFocus required style={{ width: "100%" }} />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button form={`ed-accueil-${a.id}`} type="submit" title="Valider" className="iconbtn ok"><CheckIcon /></button>
                          <Link href="/admin/motifs" className="iconbtn ghost" scroll={false} title="Annuler">✕</Link>
                        </td>
                        <td style={{ textAlign: "center" }}><ActifCheckbox id={a.id} actif={a.actif} action={toggleAccueil} /></td>
                      </tr>
                    ) : (
                      <tr key={a.id} style={{ opacity: a.actif ? 1 : 0.55 }}>
                        <td>{a.ordre}</td>
                        <td>{a.libelle}</td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <Link href={`/admin/motifs?edit=accueil:${a.id}`} className="iconbtn edit" scroll={false} prefetch={false} title="Modifier"><EditIcon /></Link>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <ActifCheckbox id={a.id} actif={a.actif} action={toggleAccueil} />
                        </td>
                      </tr>
                    )
                  )}
                  {accueils.length === 0 && (<tr><td colSpan={4} className="muted">Aucun accueil : pas de colonne Accueil au Personnel.</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ---------------- Nom du fichier Excel intérim (0093) ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Nom du fichier Excel intérim</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Nom donné aux fichiers Excel des Synthèses intérim (Bilans → Synthèses hebdomadaires),
          par agence ou toutes agences. Vide = forme par défaut. La date et l&apos;heure de
          l&apos;extraction distinguent deux fichiers du même jour. Enregistrement automatique.
        </p>
        <div className="card" style={{ marginBottom: 24 }}>
          <NomFichierInterimInline initial={paramRhR.data?.interim_nom_fichier ?? null} site={site.nom} />
        </div>

        {/* ---------------- Types de contrat (0040) ---------------- */}
        <h2 style={{ marginTop: 32, marginBottom: 4 }}>Types de contrat</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Alimente le menu déroulant <strong>Contrat</strong> dans Personnel et dans les périodes
          de contrat. Le <strong>code</strong> est ce qui est stocké sur chaque personne
          (« CDI », « CDD », « INTERIM »…). Retirer un type n&apos;efface pas l&apos;historique.
          {" "}Cochez <strong>Agence</strong> pour un contrat piloté par une agence d&apos;intérim
          (intérim, CDI intérimaire…) : le champ Agence s&apos;active dans la fiche, le contrat
          est surligné en jaune et remonte dans les Synthèses hebdomadaires.
          {!agenceFlagDispo && !typesIndispo && (
            <> <strong style={{ color: "var(--danger)" }}>Exécutez la migration 0072</strong> dans le SQL Editor pour activer la colonne Agence.</>
          )}
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
                    <th style={{ width: 90, textAlign: "center" }} title="Contrat piloté par une agence d'intérim (intérim, CDI intérimaire…) : active le champ Agence, surligne en jaune et remonte dans les Synthèses hebdomadaires.">Agence</th>
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
                        <td style={{ textAlign: "center" }}>
                          {agenceFlagDispo ? <ActifCheckbox id={t.code} actif={t.avec_agence} action={toggleTypeContratAgence} keyName="code" /> : <span className="muted">–</span>}
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
                          {agenceFlagDispo ? <ActifCheckbox id={t.code} actif={t.avec_agence} action={toggleTypeContratAgence} keyName="code" /> : <span className="muted">–</span>}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {/* PK texte `code` (pas un uuid) : on passe keyName="code" à ActifCheckbox
                              pour que le champ du formulaire porte le bon nom. */}
                          <ActifCheckbox id={t.code} actif={t.actif} action={toggleTypeContrat} keyName="code" />
                        </td>
                      </tr>
                    )
                  )}
                  {types.length === 0 && (<tr><td colSpan={6} className="muted">Aucun type.</td></tr>)}
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
