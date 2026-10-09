-- 0089 : suppression des colonnes dépréciées en 0080 et 0081.
--
-- Remplacées par des tableaux et plus lues nulle part dans le code :
--   poste.suivi_motif             → poste.suivi_motifs            (0080)
--   poste.anci_usage              → poste.anci_usages             (0080)
--   visite.professionnel          → visite.professionnels         (0081)
--   visite.prochain_professionnel → visite.prochains_professionnels (0081)
--
-- `competence.anci_usage` (attestation exigée par une HABILITATION) est GARDÉE :
-- elle reste à une seule valeur et est toujours lue.
--
-- Filet de sécurité : avant de supprimer, on reporte une dernière fois une
-- valeur restée seule dans l'ancienne colonne (tableau encore vide), comme le
-- faisaient 0080 / 0081. Sans effet si la reprise d'alors a tout couvert.
-- Idempotent : rejouable sans erreur une fois les colonnes supprimées.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'poste' and column_name = 'suivi_motif') then
    update public.poste set suivi_motifs = array[suivi_motif]
     where suivi_motif is not null and suivi_motifs = '{}';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'poste' and column_name = 'anci_usage') then
    update public.poste set anci_usages = array[anci_usage]
     where anci_usage is not null and anci_usages = '{}';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'visite' and column_name = 'professionnel') then
    update public.visite set professionnels = array[professionnel]
     where professionnel is not null and professionnels = '{}';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'visite' and column_name = 'prochain_professionnel') then
    update public.visite set prochains_professionnels = array[prochain_professionnel]
     where prochain_professionnel is not null and prochains_professionnels = '{}';
  end if;
end $$;

alter table public.poste
  drop column if exists suivi_motif,
  drop column if exists anci_usage;

alter table public.visite
  drop column if exists professionnel,
  drop column if exists prochain_professionnel;
