"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import SlideSwitch from "@/components/SlideSwitch";

// Bascule « Par nom / Par poste » du Planning (?par=poste). Tous les autres
// paramètres (semaine, quart, service, recherche…) sont conservés : on revient
// sur la même fenêtre vue sous l'autre angle.
export default function VueBascule({ parPoste }: { parPoste: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const basculer = (v: boolean) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set("par", "poste");
    else p.delete("par");
    const qs = p.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };
  return (
    <span style={{ opacity: pending ? 0.5 : 1, transition: "opacity .1s" }}>
      <SlideSwitch
        on={parPoste}
        onChange={basculer}
        offLabel="Par nom"
        onLabel="Par poste"
        offColor="#0d9488"
        onColor="#0d9488"
        width={190}
        title={parPoste ? "Revenir à une ligne par personne" : "Une ligne par poste : qui tient chaque place sur les 3 semaines"}
      />
    </span>
  );
}
