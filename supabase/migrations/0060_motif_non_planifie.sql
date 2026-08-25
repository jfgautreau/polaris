-- 0060 : flag « non planifié » sur les motifs d'absence.
--
-- Permet de classer proprement l'absentéisme SUBI (maladie, accident du travail,
-- absence injustifiée) — celui qui casse la ligne et qu'on ne peut pas anticiper
-- — face au PLANIFIÉ (CP, RTT, CET, formation, délégation…). Remplace
-- l'heuristique de libellé du rapport Absentéisme (src/lib/absenteisme.ts) par un
-- paramètre coché dans /admin/motifs, section « Motifs d'absence ».
--
-- motif_absence est site-scopé (0053) : chaque site classe ses propres motifs.

alter table motif_absence
  add column if not exists non_planifie boolean not null default false;

-- Amorçage : reprend l'heuristique existante pour ne pas partir d'une table vide
-- (maladie / accident / injustifié / code « AT »). L'utilisateur ajuste ensuite
-- à la main dans l'écran.
update motif_absence
   set non_planifie = true
 where non_planifie = false
   and (libelle ~* 'maladie|accident|injustif' or code_court ~* '^\s*at\s*$');
