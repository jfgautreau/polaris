-- =====================================================================
-- 0092 — Durcissement sécurité (audit du 2026-11-03)
--
-- Quatre corrections, indépendantes, toutes rejouables :
--
-- 1. COMPTES (app_user) — un `admin` de site pouvait, par l'API REST et avec
--    sa propre session, écrire `est_super_admin = true` sur sa ligne (policy
--    app_user_modify + GRANT update de 0091, aucune protection de colonne) et
--    devenir super_admin de TOUS les sites. L'application n'écrit app_user
--    qu'en service_role (routes /api/users/*, /platform, trigger
--    handle_new_user) : on retire toute écriture à `authenticated` / `anon`,
--    et la lecture se limite à sa propre ligne (+ l'admin du site). Les écrans
--    Utilisateurs et Équipes lisent la liste en service_role, bornés au site.
--    ⚠️ Une future migration « grant … on all tables » rouvrirait app_user :
--    la faire suivre du REVOKE ci-dessous.
--
-- 2. handle_new_user — la version 0043 avait perdu le `is_active = false` de
--    0036 : un compte créé hors de l'application naissait ACTIF (rôle codir).
--    Sans effet aujourd'hui (inscription libre désactivée côté Supabase), mais
--    c'est une porte ouverte si on la réactive. /api/users/create et
--    /platform activent eux-mêmes le compte après création.
--
-- 3. VISITES MÉDICALES — visite, visite_anci, personne_suivi et
--    contrainte_affectation étaient lisibles par TOUT compte du site via
--    l'API REST (policy `<t>_select` bornée au seul site), quel que soit son
--    droit `visites`. On retire ces policies de lecture : seul le service_role
--    (écran Suivi après requireModule("visites"), avertissement sans motif du
--    Placement) les lit désormais, toujours borné par site_id. La policy
--    `<t>_modify` (admin) est conservée.
--
-- 4. RÉFÉRENCES INTER-SITES — les clés étrangères ne portent pas site_id : en
--    service_role, un UUID d'un autre site passait sans erreur (absence,
--    habilitation, ouverture de ligne, horaire… ) et un upsert pouvait même
--    écraser une ligne de l'autre site. Un trigger générique vérifie, à chaque
--    INSERT et à chaque UPDATE qui change une référence, que la ligne visée
--    appartient au MÊME site. Les triggers sont posés par introspection des
--    clés étrangères (une colonne, tables avec site_id des deux côtés, hors
--    `site` et `app_user`) : une nouvelle table est couverte en rejouant le
--    bloc DO ci-dessous.
--
-- 5. FUSION DE FICHES — `fusionner_personnes()` : toute la fusion en UNE
--    transaction (avant : une suite de requêtes sans contrôle d'erreur ni
--    fetchAll, et les tables oubliées — temps partiel, visites… — partaient
--    en cascade avec le doublon). Tables filles découvertes par les clés
--    étrangères vers personne ; conflits d'unicité résolus en gardant la
--    ligne de la personne conservée.
--
-- À exécuter dans le SQL Editor. Les NOTICE listent les triggers posés.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. app_user : écriture réservée au service_role
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.app_user from authenticated, anon;

drop policy if exists app_user_modify on public.app_user;

drop policy if exists app_user_select on public.app_user;
create policy app_user_select on public.app_user for select to authenticated
  using (
    user_id = (select auth.uid())
    or ((select public.is_admin()) and site_id = (select public.current_site_id()))
  );


-- ---------------------------------------------------------------------
-- 2. handle_new_user : compte créé INACTIF
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_user (user_id, email, name, role, site_id, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    'codir',
    coalesce(
      nullif(new.raw_user_meta_data->>'site_id', '')::uuid,
      '00000000-0000-4000-8000-00000000c0de'
    ),
    false
  )
  on conflict (user_id) do nothing;
  return new;
end; $$;


-- ---------------------------------------------------------------------
-- 3. Visites médicales : plus de lecture directe par l'API
-- ---------------------------------------------------------------------
drop policy if exists visite_select on public.visite;
drop policy if exists visite_anci_select on public.visite_anci;
drop policy if exists personne_suivi_select on public.personne_suivi;
drop policy if exists contrainte_affectation_select on public.contrainte_affectation;


-- ---------------------------------------------------------------------
-- 4. Cohérence de site des références
-- ---------------------------------------------------------------------
-- Arguments du trigger, par groupes de quatre :
--   colonne, table référencée, colonne référencée, type de la colonne référencée.
-- SECURITY DEFINER : la ligne visée doit être lue même sous RLS (sinon une
-- référence invisible passerait pour « absente »).
create or replace function public.verifier_site_fk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i       int := 0;
  v_new   jsonb := to_jsonb(new);
  v_old   jsonb;
  v_site  text := v_new ->> 'site_id';
  v_val   text;
  v_ref   uuid;
begin
  if v_site is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  while i < tg_nargs loop
    v_val := v_new ->> tg_argv[i];
    if v_val is not null
       and (tg_op = 'INSERT'
            or v_val is distinct from (v_old ->> tg_argv[i])
            or v_site is distinct from (v_old ->> 'site_id')) then
      execute format('select site_id from public.%I where %I = $1::%s limit 1',
                     tg_argv[i + 1], tg_argv[i + 2], tg_argv[i + 3])
        into v_ref using v_val;
      -- Ligne absente : la clé étrangère lèvera d'elle-même.
      if v_ref is not null and v_ref::text <> v_site then
        raise exception 'Référence hors de votre site (%.%).', tg_table_name, tg_argv[i];
      end if;
    end if;
    i := i + 4;
  end loop;
  return new;
end;
$$;

revoke execute on function public.verifier_site_fk() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select cl.relname as tname,
           string_agg(
             format('%L, %L, %L, %L', a.attname, rcl.relname, ra.attname, format_type(ra.atttypid, ra.atttypmod)),
             ', ' order by c.conname
           ) as args
    from pg_constraint c
    join pg_class cl      on cl.oid = c.conrelid
    join pg_namespace n   on n.oid = cl.relnamespace and n.nspname = 'public'
    join pg_class rcl     on rcl.oid = c.confrelid
    join pg_namespace rn  on rn.oid = rcl.relnamespace and rn.nspname = 'public'
    join pg_attribute a   on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra  on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and rcl.relname not in ('site', 'app_user')
      and a.attname <> 'site_id'
      and exists (select 1 from pg_attribute s
                  where s.attrelid = c.conrelid and s.attname = 'site_id' and not s.attisdropped)
      and exists (select 1 from pg_attribute s
                  where s.attrelid = c.confrelid and s.attname = 'site_id' and not s.attisdropped)
    group by cl.relname
  loop
    execute format('drop trigger if exists verifier_site_fk on public.%I', r.tname);
    execute format(
      'create trigger verifier_site_fk before insert or update on public.%I '
      'for each row execute function public.verifier_site_fk(%s)',
      r.tname, r.args);
    raise notice 'verifier_site_fk sur % : %', r.tname, r.args;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5. Fusion de deux fiches, en une transaction
-- ---------------------------------------------------------------------
-- p_patch : champs vides de la fiche gardée à compléter depuis le doublon
-- (calculé par /api/personnel/merge). Renvoie, par table, le nombre de lignes
-- repointées (moved) et écartées pour conflit (dropped).
create or replace function public.fusionner_personnes(
  p_keep  uuid,
  p_dup   uuid,
  p_site  uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r       record;
  u       record;
  v_cond  text;
  v_set   text;
  v_n     int;
  v_drop  int;
  v_out   jsonb := '{}'::jsonb;
begin
  if p_keep is null or p_dup is null or p_keep = p_dup then
    raise exception 'Deux personnes distinctes requises.';
  end if;
  if (select count(*) from public.personne where id in (p_keep, p_dup) and site_id = p_site) <> 2 then
    raise exception 'Personne introuvable pour ce site.';
  end if;

  for r in
    select cl.relname as t, a.attname as col, a.attnum as colnum, c.conrelid as rel
    from pg_constraint c
    join pg_class cl    on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.personne'::regclass
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> 'public.personne'::regclass
    order by cl.relname
  loop
    v_drop := 0;
    -- Conflits : pour chaque index unique portant la colonne, on écarte la
    -- ligne du doublon quand la personne gardée a déjà la même clé.
    for u in
      select array(
               select att.attname
               from unnest(i.indkey::int2[]) k
               join pg_attribute att on att.attrelid = i.indrelid and att.attnum = k
               where att.attnum <> r.colnum
             ) as autres
      from pg_index i
      where i.indrelid = r.rel
        and i.indisunique
        and i.indpred is null
        and r.colnum = any (i.indkey::int2[])
        and not (0 = any (i.indkey::int2[]))
    loop
      select coalesce(string_agg(format(' and k.%1$I = d.%1$I', x), ''), '')
        into v_cond
        from unnest(u.autres) x;
      execute format(
        'delete from public.%1$I d where d.%2$I = $1 and exists '
        '(select 1 from public.%1$I k where k.%2$I = $2%3$s)',
        r.t, r.col, v_cond)
        using p_dup, p_keep;
      get diagnostics v_n = row_count;
      v_drop := v_drop + v_n;
    end loop;

    execute format('update public.%1$I set %2$I = $1 where %2$I = $2', r.t, r.col)
      using p_keep, p_dup;
    get diagnostics v_n = row_count;

    if v_n > 0 or v_drop > 0 then
      v_out := v_out || jsonb_build_object(r.t, jsonb_build_object('moved', v_n, 'dropped', v_drop));
    end if;
  end loop;

  -- Champs vides de la fiche gardée complétés depuis le doublon.
  select string_agg(format('%1$I = r.%1$I', k), ', ')
    into v_set
    from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k
   where k not in ('id', 'site_id', 'statut', 'created_at')
     and exists (select 1 from pg_attribute a
                 where a.attrelid = 'public.personne'::regclass
                   and a.attname = k and a.attnum > 0 and not a.attisdropped);
  if v_set is not null then
    execute format(
      'update public.personne p set %s from jsonb_populate_record(null::public.personne, $1) r '
      'where p.id = $2 and p.site_id = $3', v_set)
      using p_patch, p_keep, p_site;
  end if;

  delete from public.personne where id = p_dup and site_id = p_site;
  return v_out;
end;
$$;

revoke execute on function public.fusionner_personnes(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fusionner_personnes(uuid, uuid, uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- Vérifications (à lancer après)
-- ---------------------------------------------------------------------
-- 1) Plus aucune écriture d'app_user pour authenticated (doit renvoyer 0 ligne) :
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'app_user' and grantee in ('authenticated', 'anon')
--      and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
-- 2) Triggers de cohérence posés :
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'verifier_site_fk' group by 1 order by 1;
