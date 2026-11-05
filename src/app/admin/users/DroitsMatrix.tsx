"use client";

import { Fragment, useState } from "react";

type Niveau = "none" | "read" | "write";
type RoleOpt = { key: string; label: string };
type ModuleOpt = { key: string; label: string };

const NEXT: Record<Niveau, Niveau> = { none: "read", read: "write", write: "none" };
const RANG: Record<Niveau, number> = { none: 0, read: 1, write: 2 };
const STYLE: Record<Niveau, { bg: string; fg: string; label: string; border: string }> = {
  none: { bg: "#ffffff", fg: "#6b7280", label: "Aucun", border: "1px solid #cbd5e1" },
  read: { bg: "#1d4ed8", fg: "#ffffff", label: "Lecture", border: "1px solid #1d4ed8" },
  write: { bg: "#7c3aed", fg: "#ffffff", label: "Modif.", border: "1px solid #7c3aed" },
};

export default function DroitsMatrix({
  roles,
  modules,
  initial,
  rolesModifiables,
  roleAppelant,
  permsAppelant,
  familles = [],
  famillesRefusees = {},
  famillesRefuseesAppelant = [],
}: {
  roles: RoleOpt[]; // tous les roles, y compris ceux qu'on ne peut pas editer
  modules: ModuleOpt[];
  initial: Record<string, Record<string, Niveau>>; // par role
  roleAppelant: string; // pour distinguer les deux raisons de verrouillage
  // Roles que l'appelant peut editer, decides par la matrice cote serveur
  // (roleModifiablePar). Les autres — son propre role, et tout role qui detient
  // des droits qu'il n'a pas, dont l'admin — restent VISIBLES mais grises.
  rolesModifiables: string[];
  permsAppelant: Record<string, Niveau>; // plafond : on n'accorde pas plus qu'on n'a
  // Sous-droits des habilitations par famille de formation (habfam:…) : par rôle,
  // les familles qu'il ne peut PAS actualiser. Par défaut tout est ouvert.
  familles?: { cle: string; libelle: string }[];
  famillesRefusees?: Record<string, string[]>;
  famillesRefuseesAppelant?: string[];
}) {
  const [refus, setRefus] = useState<Record<string, string[]>>(famillesRefusees);
  const appelantPeutFamille = (cle: string) => permsAppelant.habilitations === "write" && !famillesRefuseesAppelant.includes(cle);

  // Coche / décoche « peut actualiser » une famille pour un rôle. Refus serveur :
  // retour à l'état précédent et message, comme les modules.
  async function basculerFamille(role: string, cle: string) {
    const avant = refus[role] ?? [];
    const refusee = avant.includes(cle);
    if (refusee && !appelantPeutFamille(cle)) return; // on n'accorde pas ce qu'on n'a pas
    const apres = refusee ? avant.filter((c) => c !== cle) : [...avant, cle];
    setRefus((r) => ({ ...r, [role]: apres }));
    setSave("saving");
    setSaveMsg("");
    const res = await fetch("/api/droits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, module: cle, niveau: refusee ? "write" : "none" }),
    }).catch(() => null);
    if (res && res.ok) {
      setSave("saved");
      setTimeout(() => setSave("idle"), 1500);
      return;
    }
    const j = res ? await res.json().catch(() => ({} as { error?: string })) : {};
    setRefus((r) => ({ ...r, [role]: avant }));
    setSave("error");
    setSaveMsg(typeof (j as { error?: string }).error === "string" ? (j as { error: string }).error : res ? "Modification refusée." : "Enregistrement impossible (réseau).");
    setTimeout(() => setSave("idle"), 4000);
  }
  const [m, setM] = useState<Record<string, Record<string, Niveau>>>(initial);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Message circonstancié du serveur (anti-escalade, rôle protégé…) : sans lui,
  // un refus s'affichait « Échec » sans dire POURQUOI le clic n'a rien changé.
  const [saveMsg, setSaveMsg] = useState<string>("");
  const modifiables = new Set(rolesModifiables);

  // Le cycle ne propose jamais un niveau superieur a celui que l'on detient
  // soi-meme sur ce module : la route /api/droits le refuserait (anti-escalade),
  // autant ne pas offrir un bouton qui echoue.
  function suivant(cur: Niveau, mod: string): Niveau {
    const plafond = RANG[permsAppelant[mod] ?? "none"];
    let n = NEXT[cur];
    for (let i = 0; i < 3 && RANG[n] > plafond; i++) n = NEXT[n];
    return n;
  }

  async function cycle(role: string, mod: string) {
    const cur = m[role]?.[mod] ?? "none";
    const next = suivant(cur, mod);
    if (next === cur) return;
    setM((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [mod]: next } }));
    setSave("saving");
    setSaveMsg("");
    try {
      const res = await fetch("/api/droits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, module: mod, niveau: next }),
      });
      if (res.ok) {
        setSave("saved");
        setTimeout(() => setSave("idle"), 1500);
        return;
      }
      // Refus serveur : on REVIENT à la valeur précédente (l'optimiste laissait
      // la cellule sur un niveau que la base n'a pas accepté) et on affiche le
      // message circonstancié plutôt qu'un « Échec » muet. Gardé plus longtemps.
      const j = await res.json().catch(() => ({} as { error?: string }));
      setM((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [mod]: cur } }));
      setSave("error");
      setSaveMsg(typeof j.error === "string" ? j.error : "Modification refusée.");
      setTimeout(() => setSave("idle"), 4000);
    } catch {
      setM((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [mod]: cur } }));
      setSave("error");
      setSaveMsg("Enregistrement impossible (réseau).");
      setTimeout(() => setSave("idle"), 4000);
    }
  }

  const saveLabel = save === "saving" ? "Enregistrement…" : save === "saved" ? "Enregistré ✓" : save === "error" ? (saveMsg || "Échec") : "";
  const saveColor = save === "error" ? "var(--danger)" : save === "saved" ? "var(--ok)" : "var(--muted)";

  return (
    <>
    <div style={{ minHeight: 18, textAlign: "right", fontSize: 12, fontWeight: 600, color: saveColor, marginBottom: 4 }}>{saveLabel}</div>
    <table className="matrix" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", position: "sticky", left: 0, background: "#fff" }}>Module</th>
          {roles.map((r) => (
            <th key={r.key} style={{ textAlign: "center", minWidth: 92 }}>{r.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {modules.map((mod) => (
          <Fragment key={mod.key}>
          <tr>
            <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600, whiteSpace: "nowrap" }}>
              {mod.label}
            </td>
            {roles.map((r) => {
              // Colonne verrouillee : on affiche les droits REELS du role, grises.
              // Le serveur refuse de toute facon (verifierChangementDroit) — on ne
              // propose donc pas un bouton qui echouerait.
              if (!modifiables.has(r.key)) {
                const fige = STYLE[initial[r.key]?.[mod.key] ?? "none"];
                return (
                  <td
                    key={r.key}
                    style={{ textAlign: "center", padding: 3 }}
                    title={
                      r.key === roleAppelant
                        ? "Votre propre rôle : non modifiable, sinon vous pourriez vous retirer l'accès à cet écran."
                        : "Ce rôle détient des droits que vous n'avez pas vous-même : vous ne pouvez pas le modifier."
                    }
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 78,
                        padding: "5px 6px",
                        background: fige.bg,
                        color: fige.fg,
                        border: fige.border,
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        opacity: 0.45,
                        cursor: "not-allowed",
                      }}
                    >
                      {fige.label}
                    </span>
                  </td>
                );
              }
              const niv = m[r.key]?.[mod.key] ?? "none";
              const st = STYLE[niv];
              // Cellule INERTE : aucun autre niveau n'est atteignable (on ne peut
              // pas accorder un droit qu'on n'a pas soi-même — anti-escalade). Au
              // lieu d'un bouton qui « ne fait rien » au clic, on le désactive et
              // on explique. Concerne un module où l'appelant a « Aucun ».
              const inerte = suivant(niv, mod.key) === niv;
              if (inerte) {
                return (
                  <td key={r.key} style={{ textAlign: "center", padding: 3 }}>
                    <span
                      title="Vous n'avez pas ce droit vous-même : vous ne pouvez pas l'accorder."
                      style={{
                        display: "inline-block",
                        width: 78,
                        padding: "5px 6px",
                        background: st.bg,
                        color: st.fg,
                        border: st.border,
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        opacity: 0.45,
                        cursor: "not-allowed",
                      }}
                    >
                      {st.label}
                    </span>
                  </td>
                );
              }
              return (
                <td key={r.key} style={{ textAlign: "center", padding: 3 }}>
                  <button
                    type="button"
                    onClick={() => cycle(r.key, mod.key)}
                    title="Cliquer pour changer : Aucun -> Lecture -> Modif."
                    style={{
                      margin: 0,
                      width: 78,
                      padding: "5px 6px",
                      background: st.bg,
                      color: st.fg,
                      border: st.border,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {st.label}
                  </button>
                </td>
              );
            })}
          </tr>
          {/* Sous-lignes « famille » sous Habilitations : qui peut actualiser quoi. */}
          {mod.key === "habilitations" &&
            familles.map((f) => (
              <tr key={f.cle}>
                <td style={{ position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap", paddingLeft: 18, fontSize: 12, color: "var(--muted)" }}>
                  ↳ {f.libelle}
                </td>
                {roles.map((r) => {
                  const ecrit = (m[r.key]?.habilitations ?? "none") === "write";
                  const ok = ecrit && !(refus[r.key] ?? []).includes(f.cle);
                  const modifiable = modifiables.has(r.key) && ecrit && (ok || appelantPeutFamille(f.cle));
                  const titre = !ecrit
                    ? "Sans le droit « Modif. » sur Habilitations, ce rôle n'actualise aucune famille."
                    : !modifiables.has(r.key)
                      ? "Rôle non modifiable par vous."
                      : !modifiable
                        ? "Vous ne pouvez pas accorder une famille que vous ne pouvez pas actualiser vous-même."
                        : ok
                          ? `Peut actualiser « ${f.libelle} » — cliquer pour retirer`
                          : `Ne peut pas actualiser « ${f.libelle} » — cliquer pour accorder`;
                  const style: React.CSSProperties = {
                    margin: 0,
                    width: 78,
                    padding: "3px 6px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    background: ok ? "#ede9fe" : "#fff",
                    color: ok ? "#5b21b6" : "#6b7280",
                    border: ok ? "1px solid #c4b5fd" : "1px solid #cbd5e1",
                    opacity: modifiable ? 1 : 0.45,
                    cursor: modifiable ? "pointer" : "not-allowed",
                  };
                  const libelle = !ecrit ? "—" : ok ? "✓ Actualise" : "🔒 Non";
                  return (
                    <td key={r.key} style={{ textAlign: "center", padding: 2 }}>
                      {modifiable ? (
                        <button type="button" title={titre} onClick={() => void basculerFamille(r.key, f.cle)} style={style}>
                          {libelle}
                        </button>
                      ) : (
                        <span title={titre} style={{ ...style, display: "inline-block" }}>{libelle}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
    </>
  );
}
