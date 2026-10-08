-- 0081 : une visite peut se passer avec le médecin ET l'infirmière, et la
-- prochaine peut être prévue avec les deux.
--
-- 0079 posait un seul professionnel par champ (menu déroulant). Les RH cochent
-- désormais : médecin, infirmière, ou les deux.
--
--   visite.professionnels            text[]  qui a reçu la personne (ou qui est
--                                            prévu, pour un RDV pas encore réalisé)
--   visite.prochains_professionnels  text[]  avec qui se passera la prochaine visite
--
-- Bornés comme `avis` : sous-ensemble de {medecin, infirmier}, rien d'autre.
-- Les colonnes scalaires de 0079 sont reprises puis laissées en place,
-- DÉPRÉCIÉES et jamais lues (la version déployée les lit encore jusqu'au
-- déploiement) ; à supprimer avec poste.suivi_motif / anci_usage.

alter table public.visite
  add column if not exists professionnels text[] not null default '{}'
    check (professionnels <@ array['medecin','infirmier']::text[]),
  add column if not exists prochains_professionnels text[] not null default '{}'
    check (prochains_professionnels <@ array['medecin','infirmier']::text[]);

update public.visite
   set professionnels = array[professionnel]
 where professionnel is not null
   and professionnels = '{}';

update public.visite
   set prochains_professionnels = array[prochain_professionnel]
 where prochain_professionnel is not null
   and prochains_professionnels = '{}';

comment on column public.visite.professionnel          is 'Déprécié (0081) : remplacé par professionnels, jamais lu.';
comment on column public.visite.prochain_professionnel is 'Déprécié (0081) : remplacé par prochains_professionnels, jamais lu.';
