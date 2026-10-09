-- 0084 : historique des habilitations (personne × habilitation).
--
-- Supprimer une habilitation (erreur de saisie, retrait après incident)
-- effaçait la ligne `personne_competence` : plus rien à l'écran. Et chaque
-- recyclage écrasait la date de passage précédente. On garde désormais une
-- trace de chaque événement — ajout, modification (recyclage, commentaire,
-- autorisation), suppression — avec les valeurs, la date et l'auteur.
--
--   personne_competence_historique   une ligne par événement, écrite par un
--                                    déclencheur (aucune écriture applicative)
--
-- Auteur : la session (auth.uid()) si elle existe ; sinon (écritures en
-- service_role) la colonne `auteur_app_user_id` de la ligne. La route de
-- suppression pose cet auteur juste avant de supprimer, pour que la
-- suppression soit attribuée à celui qui l'a faite.
--
-- Reprise : le journal d'audit (`audit_log`, déclencheur posé en 0004) a gardé
-- les anciennes valeurs de chaque écriture. On en reconstruit l'historique
-- passé — les habilitations déjà supprimées réapparaissent donc dans
-- l'historique, tant que la personne et l'habilitation existent encore.
--
-- Suppression d'une personne (RGPD) ou d'une habilitation du catalogue : la
-- cascade efface aussi son historique (FK on delete cascade), et le
-- déclencheur ne journalise pas ces suppressions en cascade.

create table if not exists public.personne_competence_historique (
  id                          bigint generated always as identity primary key,
  site_id                     uuid not null references public.site (id) on delete cascade,
  personne_id                 uuid not null references public.personne (id) on delete cascade,
  competence_id               uuid not null references public.competence (id) on delete cascade,
  action                      text not null check (action in ('ajout', 'modification', 'suppression')),
  date_obtention              date,
  date_expiration             date,
  date_autorisation_conduite  date,
  commentaire                 text,
  auteur                      uuid,
  created_at                  timestamptz not null default now()
);
create index if not exists pch_personne_comp_idx
  on public.personne_competence_historique (personne_id, competence_id, created_at desc);
create index if not exists pch_site_idx
  on public.personne_competence_historique (site_id, created_at desc);

alter table public.personne_competence_historique enable row level security;
drop policy if exists personne_competence_historique_select on public.personne_competence_historique;
create policy personne_competence_historique_select on public.personne_competence_historique
  for select to authenticated
  using (site_id = (select public.current_site_id()));
-- Aucune policy d'écriture : seul le déclencheur (security definer) écrit.

create or replace function public.historiser_habilitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.personne_competence;
  v_act  text;
begin
  if tg_op = 'DELETE' then
    -- Cascade depuis la personne ou le catalogue : le parent n'est plus là,
    -- son historique part avec lui — rien à journaliser.
    if not exists (select 1 from public.personne p where p.id = old.personne_id)
       or not exists (select 1 from public.competence c where c.id = old.competence_id) then
      return old;
    end if;
    r := old;
    v_act := 'suppression';
  elsif tg_op = 'UPDATE' then
    -- Seuls les champs métier comptent (pas l'auteur ni les horodatages).
    if (old.date_obtention, old.date_expiration, old.date_autorisation_conduite, old.commentaire)
       is not distinct from
       (new.date_obtention, new.date_expiration, new.date_autorisation_conduite, new.commentaire) then
      return new;
    end if;
    r := new;
    v_act := 'modification';
  else
    r := new;
    v_act := 'ajout';
  end if;

  insert into public.personne_competence_historique
    (site_id, personne_id, competence_id, action, date_obtention, date_expiration,
     date_autorisation_conduite, commentaire, auteur)
  values
    (r.site_id, r.personne_id, r.competence_id, v_act, r.date_obtention, r.date_expiration,
     r.date_autorisation_conduite, r.commentaire, coalesce(auth.uid(), r.auteur_app_user_id));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists historiser_habilitation on public.personne_competence;
create trigger historiser_habilitation
  after insert or update or delete on public.personne_competence
  for each row execute function public.historiser_habilitation();

-- ---------------------------------------------------------------------
-- Reprise depuis le journal d'audit (une seule fois : table encore vide).
-- ---------------------------------------------------------------------
insert into public.personne_competence_historique
  (site_id, personne_id, competence_id, action, date_obtention, date_expiration,
   date_autorisation_conduite, commentaire, auteur, created_at)
select coalesce(nullif(v->>'site_id', '')::uuid, a.site_id),
       (v->>'personne_id')::uuid,
       (v->>'competence_id')::uuid,
       case a.action when 'INSERT' then 'ajout' when 'UPDATE' then 'modification' else 'suppression' end,
       nullif(v->>'date_obtention', '')::date,
       nullif(v->>'date_expiration', '')::date,
       nullif(v->>'date_autorisation_conduite', '')::date,
       nullif(v->>'commentaire', ''),
       a.app_user_id,
       a.created_at
  from public.audit_log a
  cross join lateral (
    select case when a.action = 'DELETE' then a.old_values else a.new_values end as v
  ) x
 where a.table_name = 'personne_competence'
   and x.v is not null
   -- Une modification sans changement métier n'est pas un événement.
   and not (
     a.action = 'UPDATE'
     and (a.old_values->>'date_obtention', a.old_values->>'date_expiration',
          a.old_values->>'date_autorisation_conduite', a.old_values->>'commentaire')
         is not distinct from
         (a.new_values->>'date_obtention', a.new_values->>'date_expiration',
          a.new_values->>'date_autorisation_conduite', a.new_values->>'commentaire')
   )
   and coalesce(nullif(x.v->>'site_id', '')::uuid, a.site_id) is not null
   and exists (select 1 from public.personne p where p.id = (x.v->>'personne_id')::uuid)
   and exists (select 1 from public.competence c where c.id = (x.v->>'competence_id')::uuid)
   and not exists (select 1 from public.personne_competence_historique);
