"use client";

import { useState } from "react";
import { saveEchelle } from "./actions";
import { SaveIcon } from "@/components/icons";
import { NUANCIER, COULEUR_NIVEAU_DEFAUT } from "@/lib/couleurs-niveau";

// Sélecteur de couleur d'un niveau : pastille cliquable qui déploie le nuancier.
// Pas de <input type="color"> (la boîte de dialogue OS fait planter l'onglet ici,
// cf. CLAUDE.md). La valeur est portée par un input caché pour la soumission du
// formulaire ; `onChange` remonte l'aperçu au parent.
function NuancierPicker({ name, value, onChange }: { name: string; value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const isSel = (c: string) => value.toLowerCase() === c.toLowerCase();
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Choisir une couleur dans le nuancier"
        aria-label="Choisir une couleur"
        style={{ width: 34, height: 22, borderRadius: 5, background: value, border: "1px solid #94a3b8", cursor: "pointer", padding: 0, margin: 0 }}
      />
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40,
              background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: 8,
              display: "grid", gridTemplateColumns: "repeat(6, 24px)", gap: 6,
            }}
          >
            {NUANCIER.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                title={c}
                aria-label={`Couleur ${c}`}
                style={{ width: 24, height: 24, borderRadius: 5, background: c, border: isSel(c) ? "2px solid #111" : "1px solid #cbd5e1", cursor: "pointer", padding: 0, margin: 0 }}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// Échelle de niveaux (« carré magique ») + nombre de niveaux activés pour le site.
// Le nombre de niveaux POSITIFS (1..N) est réglable par site (colonne
// site.nb_niveaux, migration 0061) ; le 0 (blanc = aucune compétence) et la
// restriction ❌ restent toujours présents. Le sélecteur pilote EN DIRECT le
// nombre de champs de libellés affichés (état local) ; l'enregistrement écrit
// le nombre choisi ET les libellés 0..N.
export default function EchelleForm({
  niveaux,
  nbNiveaux,
  seuilCompetent,
  couleurs,
}: {
  niveaux: { niveau: number; libelle: string }[];
  nbNiveaux: number;
  seuilCompetent: number;
  couleurs: Record<number, string | null>;
}) {
  const [nb, setNb] = useState(nbNiveaux);
  // Seuil « compétent » : borné en direct à [1, nb]. Si on abaisse le nombre de
  // niveaux sous le seuil courant, on ramène le seuil à nb.
  const [seuil, setSeuil] = useState(Math.min(seuilCompetent, nbNiveaux));
  const seuilEffectif = Math.min(seuil, nb);
  // Couleur choisie par niveau positif (état local pour l'aperçu en direct de la
  // pastille). Repli sur la couleur par défaut du niveau si aucune enregistrée.
  const [coul, setCoul] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (let n = 1; n <= 4; n++) o[n] = couleurs[n] ?? COULEUR_NIVEAU_DEFAUT[n];
    return o;
  });
  const libelle = (n: number) => niveaux.find((x) => x.niveau === n)?.libelle ?? "";

  return (
    <form action={saveEchelle} autoComplete="off">
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="nb_niveaux" style={{ fontWeight: 600 }}>
          Nombre de niveaux activés
        </label>
        <select
          id="nb_niveaux"
          name="nb_niveaux"
          value={nb}
          onChange={(e) => setNb(Number(e.target.value))}
          style={{ marginLeft: 10, width: "auto" }}
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} niveaux (1 à {n})
            </option>
          ))}
        </select>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Niveaux positifs proposés à la saisie. Le niveau 0 (aucune compétence) et
          la restriction ❌ restent toujours présents.
        </p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label htmlFor="seuil_competent" style={{ fontWeight: 600 }}>
          Seuil « compétent »
        </label>
        <select
          id="seuil_competent"
          name="seuil_competent"
          value={seuilEffectif}
          onChange={(e) => setSeuil(Number(e.target.value))}
          style={{ marginLeft: 10, width: "auto" }}
        >
          {Array.from({ length: nb }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              niveau ≥ {n}
            </option>
          ))}
        </select>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Niveau minimal à partir duquel une personne est comptée « compétente » sur
          un poste dans les bilans (Cockpit, Polyvalence…) et la ligne « Compétences »
          de la matrice. Sans effet sur la saisie ni le placement.
        </p>
      </div>

      <p className="muted" style={{ margin: "0 0 8px", fontWeight: 600 }}>Libellés et couleurs des niveaux</p>
      {Array.from({ length: nb + 1 }, (_, n) => n).map((n) => (
        <div key={n} style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <label htmlFor={`niveau_${n}`} style={{ minWidth: 64 }}>Niveau {n}</label>
          <input id={`niveau_${n}`} name={`niveau_${n}`} defaultValue={libelle(n)} required style={{ flex: 1, maxWidth: 320 }} />
          {n === 0 ? (
            // Niveau 0 = « aucune compétence » : toujours blanc / contour seul.
            <span
              aria-hidden
              title="Niveau 0 : toujours blanc (aucune compétence)"
              style={{ display: "inline-block", width: 22, height: 22, borderRadius: 999, background: "#fff", border: "1.5px solid #64748b", flexShrink: 0 }}
            />
          ) : (
            <>
              <span
                aria-hidden
                style={{ display: "inline-block", width: 22, height: 22, borderRadius: 999, background: coul[n], border: "1.5px solid #64748b", flexShrink: 0 }}
              />
              <NuancierPicker
                name={`couleur_${n}`}
                value={coul[n]}
                onChange={(hex) => setCoul((c) => ({ ...c, [n]: hex }))}
              />
            </>
          )}
        </div>
      ))}

      <button type="submit" title="Enregistrer l'échelle">
        <SaveIcon /> Enregistrer l&apos;échelle
      </button>
    </form>
  );
}
