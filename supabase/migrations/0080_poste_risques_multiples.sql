-- 0080 : un poste à risques particuliers peut relever de PLUSIEURS motifs
-- réglementaires et exiger PLUSIEURS attestations de non contre-indication.
--
-- Exemple : un poste de cariste en zone électrique = conduite (R4323-56) ET
-- habilitation électrique (R4544-10), donc deux attestations à détenir.
--
--   poste.suivi_motifs  text[]  codes de MOTIFS_SIR (src/lib/visites.ts)
--   poste.anci_usages   text[]  codes de visite_anci_usage du site
--
-- Les colonnes scalaires de 0076 (`suivi_motif`, `anci_usage`) sont reprises
-- puis laissées en place, DÉPRÉCIÉES et jamais lues : les supprimer ici
-- casserait la version déjà déployée (dont l'écriture au Placement) dans
-- l'intervalle entre la migration et le déploiement. À supprimer plus tard.
-- Les habilitations (`competence.anci_usage`) restent à une seule attestation.

alter table public.poste
  add column if not exists suivi_motifs text[] not null default '{}',
  add column if not exists anci_usages  text[] not null default '{}';

update public.poste
   set suivi_motifs = array[suivi_motif]
 where suivi_motif is not null
   and suivi_motifs = '{}';

update public.poste
   set anci_usages = array[anci_usage]
 where anci_usage is not null
   and anci_usages = '{}';

comment on column public.poste.suivi_motif is 'Déprécié (0080) : remplacé par suivi_motifs, jamais lu.';
comment on column public.poste.anci_usage  is 'Déprécié (0080) : remplacé par anci_usages, jamais lu.';
