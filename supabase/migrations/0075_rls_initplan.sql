-- =====================================================================
-- Migration 0075 - RLS : fonctions de contexte evaluees UNE FOIS par requete
--
-- CONTEXTE (audit performance 2026-09-28, preconisation P1)
-- Les policies RLS s'ecrivent `site_id = public.current_site_id()`, souvent
-- combinees a `public.is_admin()` / `public.has_role('…')` / `auth.uid()`.
-- Ces fonctions ne dependent PAS de la ligne lue, mais Postgres les appelle
-- quand meme POUR CHAQUE LIGNE filtree. `current_site_id()` est en plpgsql :
-- a chaque appel, decodage JSON des headers de la requete + lecture de
-- app_user. Sur la matrice (~22 000 lignes), le placement de 3 semaines ou le
-- comptage des habilitations, ce cout est paye des milliers de fois.
--
-- CORRECTIF (recommandation officielle Supabase, lint « auth_rls_initplan ») :
-- envelopper l'appel dans un sous-select — `(select public.current_site_id())`.
-- Postgres en fait alors un InitPlan : calcule UNE fois par requete, puis
-- reutilise pour toutes les lignes.
--
-- SECURITE : AUCUN changement de semantique. Meme fonction, meme resultat
-- (fonctions STABLE : constantes pendant une requete). Seul le nombre
-- d'appels change. Les fonctions qui DEPENDENT de la ligne
-- (`can_edit_personne(id)`, `can_read_audit(...)`) ne sont PAS touchees.
--
-- METHODE : plutot que de reecrire a la main ~80 policies eparpillees sur
-- 20 migrations (risque d'oubli ou de faute de frappe), on parcourt
-- pg_policies et on applique `alter policy … using (…) with check (…)` sur
-- l'expression existante, transformee par expression reguliere. Les roles
-- (`to authenticated`) et la commande (select / all…) sont conserves par
-- ALTER POLICY. Idempotent : une expression deja enveloppee n'est pas
-- re-enveloppee. Transactionnel : tout ou rien.
--
-- A executer dans le SQL Editor APRES 0074.
-- =====================================================================

create or replace function pg_temp.rls_initplan(expr text) returns text
language plpgsql immutable as $$
declare
  e text := expr;
begin
  if e is null then
    return null;
  end if;
  -- current_site_id() — sauf s'il est deja dans un sous-select.
  if e !~* 'select\s+(public\.)?current_site_id\(\)' then
    e := regexp_replace(e, '(?<![[:alnum:]_.])(public\.)?current_site_id\(\)', '(select public.current_site_id())', 'g');
  end if;
  -- is_super_admin()
  if e !~* 'select\s+(public\.)?is_super_admin\(\)' then
    e := regexp_replace(e, '(?<![[:alnum:]_.])(public\.)?is_super_admin\(\)', '(select public.is_super_admin())', 'g');
  end if;
  -- is_admin()
  if e !~* 'select\s+(public\.)?is_admin\(\)' then
    e := regexp_replace(e, '(?<![[:alnum:]_.])(public\.)?is_admin\(\)', '(select public.is_admin())', 'g');
  end if;
  -- has_role('ordo'::text) — argument litteral uniquement.
  if e !~* 'select\s+(public\.)?has_role\(' then
    e := regexp_replace(e, '(?<![[:alnum:]_.])(public\.)?has_role\((''[^'']*''(::text)?)\)', '(select public.has_role(\2))', 'g');
  end if;
  -- auth.uid()
  if e !~* 'select\s+auth\.uid\(\)' then
    e := regexp_replace(e, '(?<![[:alnum:]_.])auth\.uid\(\)', '(select auth.uid())', 'g');
  end if;
  return e;
end;
$$;

do $$
declare
  r record;
  q text;
  c text;
  stmt text;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  loop
    q := pg_temp.rls_initplan(r.qual);
    c := pg_temp.rls_initplan(r.with_check);
    if q is distinct from r.qual or c is distinct from r.with_check then
      stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if r.qual is not null then
        stmt := stmt || ' using (' || q || ')';
      end if;
      if r.with_check is not null then
        stmt := stmt || ' with check (' || c || ')';
      end if;
      execute stmt;
      n := n + 1;
      raise notice '% . % : %', r.tablename, r.policyname, coalesce(q, c);
    end if;
  end loop;
  raise notice '0075 : % policies reecrites en InitPlan', n;
end;
$$;

-- ---------------------------------------------------------------------
-- VERIFICATION (a lancer apres coup, facultatif)
-- 1) Plus aucune policy avec un appel « nu » (doit renvoyer 0 ligne) :
--
--   select tablename, policyname, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and (coalesce(qual, '') || coalesce(with_check, ''))
--         ~ '(?<!SELECT )(public\.)?current_site_id\(\)';
--
-- 2) Gain mesurable sur la matrice (a comparer avant / apres, en se
--    placant dans le role d'un utilisateur reel) :
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user_id>","role":"authenticated"}';
--   explain analyze select personne_id, poste_id, niveau_actuel from public.matrice;
--
--    Avant : « Filter: (site_id = current_site_id()) » sur chaque ligne.
--    Apres : « InitPlan 1 » puis « Filter: (site_id = $0) ».
-- ---------------------------------------------------------------------
