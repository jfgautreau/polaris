"use client";

import { useState } from "react";
import { saveEchelle } from "./actions";
import { SaveIcon } from "@/components/icons";

// Échelle de niveaux (« carré magique ») + nombre de niveaux activés pour le site.
// Le nombre de niveaux POSITIFS (1..N) est réglable par site (colonne
// site.nb_niveaux, migration 0061) ; le 0 (blanc = aucune compétence) et la
// restriction ❌ restent toujours présents. Le sélecteur pilote EN DIRECT le
// nombre de champs de libellés affichés (état local) ; l'enregistrement écrit
// le nombre choisi ET les libellés 0..N.
export default function EchelleForm({
  niveaux,
  nbNiveaux,
}: {
  niveaux: { niveau: number; libelle: string }[];
  nbNiveaux: number;
}) {
  const [nb, setNb] = useState(nbNiveaux);
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

      {Array.from({ length: nb + 1 }, (_, n) => n).map((n) => (
        <div key={n} style={{ marginBottom: 8 }}>
          <label htmlFor={`niveau_${n}`}>Niveau {n}</label>
          <input id={`niveau_${n}`} name={`niveau_${n}`} defaultValue={libelle(n)} required />
        </div>
      ))}

      <button type="submit" title="Enregistrer l'échelle">
        <SaveIcon /> Enregistrer l&apos;échelle
      </button>
    </form>
  );
}
