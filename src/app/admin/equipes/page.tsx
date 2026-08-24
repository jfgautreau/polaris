import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/current-user";
import AppHeader from "@/components/AppHeader";
import { getPermissions, canWrite, canRead } from "@/lib/permissions";
import LectureSeule from "@/components/LectureSeule";
import { mondayOf, isoDate, addDays, isoWeekNumber } from "@/lib/week";
import { rotationForWeek, type RotationRef } from "@/lib/rotation";
import {
  createEquipe,
  renameEquipe,
  toggleEquipe,
  addChef,
  removeChef,
  createQuart,
  saveQuartHoraires,
  saveRotationReference,
  deleteRotationReference,
} from "./actions";
import TeamColorPicker from "./TeamColorPicker";
import ActifCheckbox from "@/components/ActifCheckbox";
import SaveIcon from "@/components/SaveIcon";
import BandeauErreur from "@/components/BandeauErreur";

type Chef = { id: string; app_user_id: string };
type Equipe = { id: string; nom: string; actif: boolean; couleur: string; quart_fixe: string | null; equipe_chef: Chef[] };
type AppUser = { user_id: string; name: string; email: string };
type Quart = { code: string; libelle: string; debut: string | null; fin: string | null; rotation: boolean; creneau: string | null };

const NB_APERCU = 8;

export default async function EquipesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const perms = await getPermissions(profile.role);
  // L'ecran porte DEUX sujets : les equipes et la rotation des quarts. On entre
  // des qu'on peut lire l'un des deux ; chaque section est ensuite en consultation
  // seule si l'ecriture correspondante manque.
  const voitEquipes = canRead(perms, "equipes");
  const voitRota = canRead(perms, "ordonnancement");
  if (!voitEquipes && !voitRota) redirect("/planning");
  const canEquipes = canWrite(perms, "equipes");
  const canRota = canWrite(perms, "ordonnancement");

  const supabase = await getServerClient();
  const [{ data: equipesData }, { data: usersData }, { data: quartsData }, { data: refsD }] = await Promise.all([
    supabase
      .from("equipe")
      .select("id, nom, actif, couleur, quart_fixe, equipe_chef(id, app_user_id)")
      .order("nom")
      .returns<Equipe[]>(),
    supabase
      .from("app_user")
      .select("user_id, name, email")
      .order("name")
      .returns<AppUser[]>(),
    supabase.from("quart").select("code, libelle, debut, fin, rotation, creneau").order("ordre").returns<Quart[]>(),
    supabase.from("rotation_reference").select("semaine, equipe_id, quart_code").order("semaine").returns<RotationRef[]>(),
  ]);
  const quarts = quartsData ?? [];
  // Quarts composant le cycle de rotation : seuls ceux-ci sont proposés dans le
  // formulaire de référence (le « quart fixe » d'une équipe, lui, peut être
  // n'importe quel quart).
  const quartsRotation = quarts.filter((q) => q.rotation);
  const quartLib = (code: string) => quarts.find((q) => q.code === code)?.libelle ?? code;

  const equipes = equipesData ?? [];
  const users = usersData ?? [];
  const userLabel = (id: string) => {
    const u = users.find((x) => x.user_id === id);
    return u ? u.name || u.email : id;
  };

  // Rotation : equipes tournantes (actives, sans quart fixe).
  const refs = refsD ?? [];
  const tournantes = equipes.filter((e) => e.actif && !e.quart_fixe);
  const fixes = equipes.filter((e) => e.actif && e.quart_fixe);
  const derniereSemaine = refs.length ? refs[refs.length - 1].semaine : "";
  const quartCourant: Record<string, string> = {};
  for (const r of refs) if (r.semaine === derniereSemaine) quartCourant[r.equipe_id] = r.quart_code;

  const start = mondayOf();
  const apercuWeeks = Array.from({ length: NB_APERCU }, (_, i) => {
    const m = addDays(start, i * 7);
    const iso = isoDate(m);
    return {
      iso,
      label: `S${isoWeekNumber(m)} · ${String(m.getDate()).padStart(2, "0")}/${String(m.getMonth() + 1).padStart(2, "0")}`,
      rot: rotationForWeek(refs, iso),
    };
  });
  const semaines = [...new Set(refs.map((r) => r.semaine))].sort().reverse();
  const equipeNom = (id: string) => equipes.find((e) => e.id === id)?.nom ?? id;
  const lundiCourant = isoDate(start);

  return (
    <>
      <AppHeader role={profile.role} active="/admin/equipes" />
      <div className="container">
        <h1>Équipes</h1>
        <BandeauErreur message={sp.err} />

        {voitEquipes && (
        <LectureSeule actif={!canEquipes}>
          <>
            <div className="card" style={{ marginBottom: 24 }}>
              <form action={createEquipe} autoComplete="off" className="inline-form">
                <div className="field">
                  <span>Nouvelle équipe</span>
                  <input name="nom" placeholder="Ex. Équipe A, Nuit..." required />
                </div>
                <div className="field">
                  <span>Couleur</span>
                  <TeamColorPicker name="couleur" defaultValue="#16a34a" />
                </div>
                <button type="submit">Ajouter</button>
              </form>
            </div>

            {equipes.length === 0 && <p className="muted">Aucune équipe.</p>}

            {equipes.map((e) => (
              <div key={e.id} className="card section">
                <div className="toolbar">
                  <form action={renameEquipe} autoComplete="off" className="inline-form">
                    <input type="hidden" name="id" value={e.id} />
                    <span
                      style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: e.couleur, border: "1px solid #cbd5e1" }}
                    />
                    <input name="nom" defaultValue={e.nom} />
                    <TeamColorPicker name="couleur" defaultValue={e.couleur} />
                    <div className="field" style={{ margin: 0 }}>
                      <span>Quart fixe</span>
                      <select name="quart_fixe" defaultValue={e.quart_fixe ?? ""}>
                        <option value="">Rotation (tourne)</option>
                        {quarts.map((q) => (
                          <option key={q.code} value={q.code}>{q.libelle}</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" title="Enregistrer" style={{ width: "auto", margin: 0, padding: "3px 9px", background: "#fff", color: "#2563eb", border: "1px solid var(--border)", borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <SaveIcon />
                    </button>
                  </form>
                  {/* Case « Actif » à droite, uniforme avec Param RH / Référentiel. */}
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Actif</label>
                    <ActifCheckbox id={e.id} actif={e.actif} action={toggleEquipe} title={e.actif ? "Désactiver l'équipe" : "Réactiver l'équipe"} />
                  </span>
                </div>

                <h2 style={{ fontSize: 14, marginTop: 8 }}>Chefs d&apos;équipe</h2>
                {e.equipe_chef.length === 0 && (
                  <p className="muted">Aucun chef désigné.</p>
                )}
                <ul style={{ margin: "4px 0 12px", paddingLeft: 18 }}>
                  {e.equipe_chef.map((c) => (
                    <li key={c.id} style={{ marginBottom: 4 }}>
                      {userLabel(c.app_user_id)}{" "}
                      <form action={removeChef} style={{ display: "inline", margin: 0 }}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn-sm btn-ghost">
                          Retirer
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>

                <form action={addChef} autoComplete="off" className="inline-form">
                  <input type="hidden" name="equipe_id" value={e.id} />
                  <div className="field">
                    <span>Désigner un chef</span>
                    <select name="app_user_id" required defaultValue="">
                      <option value="" disabled>
                        Choisir un utilisateur...
                      </option>
                      {users.map((u) => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.name || u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-sm">
                    Ajouter
                  </button>
                </form>
              </div>
            ))}
          </>
        </LectureSeule>
        )}

        {voitRota && (
        <LectureSeule actif={!canRota}>
          <>
            <h1 style={{ marginTop: 32 }}>Rotation des équipes &amp; horaires des quarts</h1>

            {/* Horaires des quarts */}
            <div className="card section">
              <h2 style={{ marginTop: 0 }}>Horaires des quarts</h2>

              {/* Ajout d'un quart : le code technique est derive du libelle. */}
              <form
                action={createQuart}
                autoComplete="off"
                className="toolbar"
                style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}
              >
                <div className="field">
                  <span>Nouveau quart (libellé)</span>
                  <input name="libelle" placeholder="Ex. Matin, Nuit, Journée…" required />
                </div>
                <div className="field">
                  <span>Début</span>
                  <input name="debut" type="time" />
                </div>
                <div className="field">
                  <span>Fin</span>
                  <input name="fin" type="time" />
                </div>
                <label className="field" style={{ alignItems: "center" }}>
                  <span>Rotation</span>
                  <input type="checkbox" name="rotation" style={{ width: "auto" }} title="Ce quart fait partie du cycle de rotation des équipes tournantes." />
                </label>
                <div className="field">
                  <span>Créneau (TP)</span>
                  <select name="creneau" defaultValue="" title="Demi-journée du quart, pour le temps partiel « une semaine sur deux ».">
                    <option value="">Aucun</option>
                    <option value="matin">Matin</option>
                    <option value="aprem">Après-midi</option>
                  </select>
                </div>
                <button type="submit" style={{ width: "auto", padding: "9px 20px" }}>Ajouter le quart</button>
              </form>

              {quarts.length === 0 && (
                <p className="muted">Aucun quart pour ce site. Ajoutez-en un ci-dessus.</p>
              )}

              <form action={saveQuartHoraires} autoComplete="off">
                {quarts.map((q) => (
                  <div key={q.code} className="toolbar">
                    <div className="field">
                      <span>Libellé</span>
                      <input name={`lib_${q.code}`} defaultValue={q.libelle} />
                    </div>
                    <div className="field">
                      <span>Début</span>
                      <input name={`debut_${q.code}`} type="time" defaultValue={(q.debut ?? "").slice(0, 5)} />
                    </div>
                    <div className="field">
                      <span>Fin</span>
                      <input name={`fin_${q.code}`} type="time" defaultValue={(q.fin ?? "").slice(0, 5)} />
                    </div>
                    <label className="field" style={{ alignItems: "center" }}>
                      <span>Rotation</span>
                      <input type="checkbox" name={`rot_${q.code}`} defaultChecked={q.rotation} style={{ width: "auto" }} title="Ce quart fait partie du cycle de rotation des équipes tournantes." />
                    </label>
                    <div className="field">
                      <span>Créneau (TP)</span>
                      <select name={`creneau_${q.code}`} defaultValue={q.creneau ?? ""} title="Demi-journée du quart, pour le temps partiel « une semaine sur deux ».">
                        <option value="">Aucun</option>
                        <option value="matin">Matin</option>
                        <option value="aprem">Après-midi</option>
                      </select>
                    </div>
                  </div>
                ))}
                <button type="submit" style={{ width: "auto", padding: "9px 20px" }} title="Enregistrer les horaires">Enregistrer les horaires</button>
              </form>
            </div>

            {/* Reference de rotation */}
            <div className="card section">
              <h2 style={{ marginTop: 0 }}>Rotation — référence d&apos;une semaine</h2>
              <p className="muted">
                Choisissez une semaine et le quart de chaque équipe tournante ce lundi-là.
                L&apos;alternance des semaines suivantes est calculée automatiquement (échange
                hebdomadaire). Les semaines antérieures ne sont jamais modifiées : pour changer
                la rotation plus tard, enregistrez une nouvelle référence datée.
                {fixes.length > 0 && (
                  <>
                    {" "}Équipe(s) à quart fixe (hors rotation) :{" "}
                    <strong>{fixes.map((e) => e.nom).join(", ")}</strong>.
                  </>
                )}
              </p>

              {tournantes.length === 0 ? (
                <p className="muted">Aucune équipe tournante (toutes les équipes ont un quart fixe).</p>
              ) : quartsRotation.length === 0 ? (
                <p className="muted">
                  Aucun quart coché « Rotation » ci-dessus. Cochez au moins un quart dans
                  « Horaires des quarts » pour composer le cycle.
                </p>
              ) : (
                <form action={saveRotationReference} autoComplete="off">
                  <div className="toolbar" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field">
                      <span>Semaine (ramenée au lundi)</span>
                      <input name="semaine" type="date" defaultValue={lundiCourant} required />
                    </div>
                    {tournantes.map((e) => (
                      <div key={e.id} className="field">
                        <span>{e.nom}</span>
                        <select name={`quart_${e.id}`} defaultValue={quartCourant[e.id] ?? ""}>
                          <option value="">—</option>
                          {quartsRotation.map((q) => (
                            <option key={q.code} value={q.code}>{q.libelle}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <button type="submit" style={{ width: "auto", padding: "9px 20px", marginTop: 8 }} title="Enregistrer la référence">
                    Enregistrer la référence
                  </button>
                </form>
              )}
            </div>

            {/* Aperçu de l'alternance */}
            <div className="card section">
              <h2 style={{ marginTop: 0 }}>Aperçu ({NB_APERCU} prochaines semaines)</h2>
              <p className="muted">Calculé d&apos;après les références enregistrées.</p>
              <div style={{ overflowX: "auto" }}>
                <table className="matrix" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Semaine</th>
                      {tournantes.map((e) => (
                        <th key={e.id} style={{ textAlign: "center", minWidth: 110 }}>{e.nom}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {apercuWeeks.map((w) => (
                      <tr key={w.iso}>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{w.label}</td>
                        {tournantes.map((e) => (
                          <td key={e.id} style={{ textAlign: "center" }}>
                            {w.rot[e.id] ? quartLib(w.rot[e.id]) : <span className="muted">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* References existantes */}
            <div className="card section">
              <h2 style={{ marginTop: 0 }}>Références enregistrées</h2>
              {semaines.length === 0 ? (
                <p className="muted">Aucune référence pour l&apos;instant.</p>
              ) : (
                <table className="matrix" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>À partir du</th>
                      <th style={{ textAlign: "left" }}>Affectation</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {semaines.map((sem) => {
                      const bloc = refs.filter((r) => r.semaine === sem);
                      return (
                        <tr key={sem}>
                          <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{sem}</td>
                          <td>{bloc.map((r) => `${equipeNom(r.equipe_id)} → ${quartLib(r.quart_code)}`).join(" · ")}</td>
                          <td style={{ textAlign: "right" }}>
                            <form action={deleteRotationReference}>
                              <input type="hidden" name="semaine" value={sem} />
                              <button type="submit" className="btn-sm btn-ghost" style={{ width: "auto", color: "var(--danger)" }}>
                                Supprimer
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        </LectureSeule>
        )}
      </div>
    </>
  );
}
