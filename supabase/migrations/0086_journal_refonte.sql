-- 0086 : refonte du journal d'audit (étapes 1, 5 et 6 du plan du 2026-10-09).
--
-- CONSTAT (mesuré le 2026-10-09, 30 derniers jours) : 27 146 entrées, 78 %
-- Planning + Matrice, et 36 % de l'ensemble signé « Système » — dont 100 % des
-- changements de droits, de comptes, de postes, de personnes et de contrats.
-- Ces écritures passent par la clé service_role : auth.uid() est NULL et ces
-- tables n'ont pas de colonne d'auteur sur laquelle se rabattre.
--
-- 1. AUTEUR FIABLE. Le serveur joint désormais à chaque écriture service_role
--    l'en-tête `x-polaris-auteur` (UUID de l'utilisateur dont la session a été
--    vérifiée, cf. src/lib/journal-contexte.ts). PostgREST l'expose dans
--    `request.headers` ; le déclencheur le lit après auth.uid() et avant les
--    colonnes d'auteur de la ligne. Une requête authentifiée garde auth.uid() :
--    l'en-tête ne peut pas usurper un auteur.
--
-- 5. REGROUPEMENT. Une opération de masse (copie, pré-remplissage,
--    réinitialisation de semaine, import, absence sur une période) porte
--    l'en-tête `x-polaris-lot` (UUID) : chaque ligne du journal reçoit ce `lot`.
--    En fin d'opération, `journal_clore_lot()` ajoute UNE ligne de synthèse
--    (action 'LOT', libellé, nombre de lignes). L'écran montre la synthèse et
--    cache le détail, consultable à la demande.
--
-- 6. CONSERVATION ET RGPD. `site.journal_conservation_mois` (13 par défaut) ;
--    `journal_purger()` efface ce qui dépasse, appelée à l'ouverture du Journal.
--    `journal_purger_personne()` efface les traces d'une personne anonymisée
--    (sa fiche) ou supprimée (tout ce qui la référence).
--
-- Les fonctions de purge et de lot sont réservées au service_role (aucun
-- utilisateur ne peut effacer le journal par un appel direct).

-- ---------------------------------------------------------------------
-- Colonnes et index
-- ---------------------------------------------------------------------
alter table public.audit_log
  add column if not exists lot uuid,
  add column if not exists lot_libelle text;

create index if not exists audit_log_site_table_idx on public.audit_log (site_id, table_name, created_at desc);
create index if not exists audit_log_lot_idx on public.audit_log (lot) where lot is not null;

alter table public.site
  add column if not exists journal_conservation_mois int not null default 13
    check (journal_conservation_mois between 1 and 120);

-- ---------------------------------------------------------------------
-- Déclencheur : reprise de 0045 + auteur par en-tête + lot
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb; v_new jsonb; v_ref jsonb;
  v_id  text;
  v_actor uuid;
  v_site  uuid;
  v_imp   uuid;
  v_hdr   json;
  v_lot   uuid;
begin
  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old); v_new := null;
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
  else
    v_old := null; v_new := to_jsonb(new);
  end if;
  v_ref := coalesce(v_new, v_old);

  v_id := coalesce(
    v_ref->>'id',
    v_ref->>'user_id',                                            -- app_user
    nullif(concat_ws(':', v_ref->>'role', v_ref->>'module'), ':') -- role_permission
  );

  begin v_hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_hdr := null;
  end;

  -- Auteur : session ; sinon en-tête posé par le serveur (écritures
  -- service_role) ; sinon colonnes d'auteur de la ligne.
  v_actor := auth.uid();
  if v_actor is null then
    begin v_actor := nullif(v_hdr->>'x-polaris-auteur', '')::uuid;
    exception when others then v_actor := null;
    end;
  end if;
  if v_actor is null then
    begin
      v_actor := nullif(coalesce(
        v_new->>'created_by', v_new->>'auteur_app_user_id',
        v_old->>'created_by', v_old->>'auteur_app_user_id'
      ), '')::uuid;
    exception when others then v_actor := null;
    end;
  end if;

  begin v_lot := nullif(v_hdr->>'x-polaris-lot', '')::uuid;
  exception when others then v_lot := null;
  end;

  begin v_site := (v_ref->>'site_id')::uuid; exception when others then v_site := null; end;
  if v_site is null then v_site := public.current_site_id(); end if;

  begin v_imp := nullif(current_setting('app.impersonated_by', true), '')::uuid;
  exception when others then v_imp := null;
  end;

  insert into public.audit_log
    (app_user_id, action, table_name, record_id, old_values, new_values, site_id, impersonated_by, lot)
  values (v_actor, tg_op, tg_table_name, v_id, v_old, v_new, v_site, v_imp, v_lot);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Historique des habilitations (0084) : même source d'auteur.
-- ---------------------------------------------------------------------
create or replace function public.auteur_requete()
returns uuid
language plpgsql
stable
set search_path = public
as $
begin
  return nullif(nullif(current_setting('request.headers', true), '')::json->>'x-polaris-auteur', '')::uuid;
exception when others then
  return null;
end
$;

create or replace function public.historiser_habilitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $
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
     r.date_autorisation_conduite, r.commentaire, coalesce(auth.uid(), public.auteur_requete(), r.auteur_app_user_id));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$;


-- ---------------------------------------------------------------------
-- Lot : ligne de synthèse en fin d'opération de masse
-- ---------------------------------------------------------------------
create or replace function public.journal_clore_lot(p_site uuid, p_lot uuid, p_libelle text, p_auteur uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  select count(*) into n from public.audit_log where lot = p_lot and site_id = p_site;
  if n > 0 then
    update public.audit_log set lot_libelle = p_libelle where lot = p_lot and site_id = p_site;
    insert into public.audit_log
      (app_user_id, action, table_name, record_id, old_values, new_values, site_id, lot, lot_libelle)
    values
      (p_auteur, 'LOT', 'lot', p_lot::text, null, jsonb_build_object('lignes', n), p_site, p_lot, p_libelle);
  end if;
  return n;
end
$$;

-- ---------------------------------------------------------------------
-- Conservation
-- ---------------------------------------------------------------------
create or replace function public.journal_purger(p_site uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mois int;
  n int;
begin
  select journal_conservation_mois into v_mois from public.site where id = p_site;
  if v_mois is null then return 0; end if;
  delete from public.audit_log
   where site_id = p_site
     and created_at < now() - make_interval(months => v_mois);
  get diagnostics n = row_count;
  return n;
end
$$;

-- RGPD. p_tout = false (anonymisation) : seules les lignes de la FICHE de la
-- personne (table personne), qui portent son identité. p_tout = true
-- (suppression) : tout ce qui la référence.
create or replace function public.journal_purger_personne(p_site uuid, p_personne uuid, p_tout boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_tout then
    delete from public.audit_log
     where site_id = p_site
       and (record_id = p_personne::text
            or old_values->>'personne_id' = p_personne::text
            or new_values->>'personne_id' = p_personne::text);
  else
    delete from public.audit_log
     where site_id = p_site
       and table_name = 'personne'
       and record_id = p_personne::text;
  end if;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.journal_clore_lot(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.journal_purger(uuid) from public, anon, authenticated;
revoke all on function public.journal_purger_personne(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.journal_clore_lot(uuid, uuid, text, uuid) to service_role;
grant execute on function public.journal_purger(uuid) to service_role;
grant execute on function public.journal_purger_personne(uuid, uuid, boolean) to service_role;
