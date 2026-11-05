import { getAdminClient } from "@/lib/supabase-server";
import AppHeader from "@/components/AppHeader";
import { requireModule, canWrite, MODULES, getAllPermissions, roleModifiablePar, getAllFamillesRefusees, getFamillesRefusees } from "@/lib/permissions";
import { famillesDe } from "@/lib/habilitations-familles";
import { getAllRoles } from "@/lib/roles-server";
import LectureSeule from "@/components/LectureSeule";
import NouvelUtilisateur from "./NouvelUtilisateur";
import NouveauRole from "./NouveauRole";
import UserRoleSelect from "./UserRoleSelect";
import UserRowActions from "./UserRowActions";
import DroitsMatrix from "./DroitsMatrix";

type Row = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
};

export default async function AdminUsersPage() {
  const { profile, perms } = await requireModule("utilisateurs", "read");

  // Service_role borné au site : depuis 0092, un compte ne lit plus que sa propre
  // ligne d'app_user sous RLS. C'est le droit « utilisateurs » ci-dessus qui
  // ouvre la liste, pas le rôle admin.
  const { data: users } = await getAdminClient()
    .from("app_user")
    .select("user_id, email, name, role, is_active")
    .eq("site_id", profile.siteId)
    .order("created_at", { ascending: true })
    .returns<Row[]>();

  const list = users ?? [];

  // Rôles assignables = intégrés + personnalisés (role_custom, migration 0042).
  const roles = await getAllRoles();
  const roleCodes = roles.map((r) => r.code);
  const roleLabelMap = Object.fromEntries(roles.map((r) => [r.code, r.libelle]));
  const roleLbl = (code: string) => roleLabelMap[code] ?? code;

  // La matrice s'edite avec le droit « utilisateurs: write » — pas reservee au
  // seul role admin, qui l'obtient de toute facon par la matrice.
  const peutEditerDroits = canWrite(perms, "utilisateurs");
  const customCodes = roleCodes.filter((c) => !(["codir", "chef_equipe", "ordo", "rh", "admin", "planning"] as string[]).includes(c));
  const allPerms = peutEditerDroits ? await getAllPermissions(customCodes) : null;

  // Sous-droits des habilitations par famille de formation (competence.groupe) :
  // une sous-ligne par famille sous « Habilitations ». Lecture bornée au site.
  const [compsFam, famRefusees, famRefuseesMoi] = peutEditerDroits
    ? await Promise.all([
        getAdminClient().from("competence").select("groupe").eq("site_id", profile.siteId).eq("actif", true).returns<{ groupe: string | null }[]>(),
        getAllFamillesRefusees(),
        getFamillesRefusees(profile.role),
      ])
    : [{ data: [] as { groupe: string | null }[] }, {} as Record<string, string[]>, new Set<string>()];
  const familles = famillesDe((compsFam.data ?? []).map((c) => c.groupe));

  // Quels roles cet appelant peut-il reellement editer ? La regle est cote
  // serveur (roleModifiablePar) ; l'ecran ne fait que la refleter, pour ne pas
  // afficher un bouton que /api/droits refuserait. L'admin n'y figure jamais :
  // soit c'est le role de l'appelant (anti-verrou), soit il le domine
  // (anti-retrogradation).
  const rolesModifiables = peutEditerDroits
    ? (await Promise.all(roleCodes.map(async (r) => ((await roleModifiablePar(r, profile.role)) ? r : null)))).filter(
        (r): r is string => r !== null
      )
    : [];

  return (
    <>
      <AppHeader role={profile.role} active="/admin/users" />
      <div className="container" style={{ maxWidth: 1500 }}>
        <h1>Utilisateurs</h1>

        <LectureSeule actif={!canWrite(perms, "utilisateurs")}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Comptes ({list.length})</h2>
            <NouvelUtilisateur roles={roles} />
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
            Le rôle est <strong>enregistré dès que vous le changez</strong>. Le mot de passe n&apos;est
            jamais choisi par l&apos;administrateur : « Lien de mot de passe » produit une adresse à
            transmettre, et la personne définit elle-même le sien.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Nom</th>
                  <th style={{ width: "24%" }}>Email</th>
                  <th style={{ width: "23%" }}>Rôle</th>
                  <th>Compte</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const isSelf = u.user_id === profile.authId;
                  return (
                    <tr key={u.user_id}>
                      <td>{u.name || "-"}</td>
                      <td>{u.email}</td>
                      <td>
                        {isSelf ? (
                          <span>
                            {roleLbl(u.role)} <span className="muted">(vous)</span>
                          </span>
                        ) : (
                          <UserRoleSelect userId={u.user_id} role={u.role} roles={roles} />
                        )}
                      </td>
                      <td>
                        <UserRowActions userId={u.user_id} isActive={u.is_active} isSelf={isSelf} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {peutEditerDroits && allPerms && (
          <div className="card" style={{ marginTop: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>Droits d&apos;accès (rôle × module)</h2>
              <NouveauRole />
            </div>
            <p className="muted" style={{ marginBottom: 16 }}>
              Cliquez sur une case pour changer le droit :{" "}
              <span style={{ background: "#fff", border: "1px solid #cbd5e1", padding: "1px 8px", borderRadius: 5 }}>Aucun</span>{" "}
              &rarr; <span style={{ background: "#1d4ed8", color: "#fff", padding: "1px 8px", borderRadius: 5 }}>Lecture</span>{" "}
              &rarr; <span style={{ background: "#7c3aed", color: "#fff", padding: "1px 8px", borderRadius: 5 }}>Modif.</span>.
              Les colonnes <strong>grisées</strong> ne sont pas modifiables : votre propre
              rôle (sinon vous pourriez vous retirer l&apos;accès à cet écran) et tout rôle
              qui détient des droits que vous n&apos;avez pas — l&apos;<strong>administrateur</strong>{" "}
              en particulier, qui conserve donc toujours tous les droits. Vous ne pouvez pas
              non plus accorder un niveau supérieur au vôtre. Chaque changement est{" "}
              <strong>enregistré automatiquement</strong>. La sécurité base (RLS) reste un
              garde-fou.
            </p>
            <div style={{ overflowX: "auto" }}>
              <DroitsMatrix
                roles={roles.map((r) => ({ key: r.code, label: r.libelle }))}
                modules={MODULES.map((m) => ({ key: m.key, label: m.label }))}
                initial={Object.fromEntries(roleCodes.map((r) => [r, allPerms[r]]))}
                rolesModifiables={rolesModifiables}
                roleAppelant={profile.role}
                permsAppelant={perms}
                familles={familles}
                famillesRefusees={famRefusees}
                famillesRefuseesAppelant={[...famRefuseesMoi]}
              />
            </div>
          </div>
        )}
        </LectureSeule>
      </div>
    </>
  );
}
