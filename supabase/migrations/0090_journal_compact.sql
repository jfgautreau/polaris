-- 0090 : journal d'audit plus compact (taille de la base, offre gratuite = 500 Mo).
--
-- CONSTAT (2026-10-14) : 62 000 lignes depuis juin, ~850 octets chacune, 80 % de
-- placements ; septembre seul a produit 29 600 lignes (25 à 35 Mo / mois). Avec la
-- conservation de 13 mois (0086), le journal approchait la limite de la base.
-- Chaque modification stockait la ligne ENTIÈRE avant ET après, colonnes
-- techniques comprises (created_at, updated_at, created_by…), et une écriture
-- qui ne changeait rien (upsert identique) laissait quand même une ligne.
--
-- CE QUI CHANGE (lignes futures seulement — l'historique n'est pas réécrit) :
--  1. UPDATE : on ne garde, avant comme après, que les champs MODIFIÉS + les
--     champs de CONTEXTE qui servent à décrire la ligne à l'écran (personne, jour,
--     quart, poste, motif, nom…, cf. decrireElement dans src/lib/journal.ts) et à
--     la purge RGPD (personne_id). Les champs de contexte inchangés sont égaux
--     des deux côtés : l'écran ne les montre pas comme modifiés.
--  2. UPDATE sans aucun changement utile (seules des colonnes techniques ont
--     bougé, ou rien du tout) : plus de ligne au journal.
--  3. INSERT / DELETE : la ligne entière, MOINS les colonnes techniques — déjà
--     masquées à l'écran (TECH dans src/lib/journal.ts). L'identifiant reste dans
--     audit_log.record_id, le site dans audit_log.site_id, l'auteur dans
--     audit_log.app_user_id (calculé AVANT le retrait, created_by compris).
--
-- Reprise intégrale de audit_trigger() de la 0086 ; seul le bloc « Compaction »
-- est nouveau. `create or replace` garde la fonction (même OID) : les triggers
-- existants l'utilisent sans être recréés.

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
  -- Compaction (0090)
  v_tech     text[] := array['id', 'created_at', 'updated_at', 'date_maj', 'created_by', 'auteur_app_user_id', 'site_id', 'anonymise_at'];
  v_contexte text[] := array[
    'personne_id', 'jour', 'quart_code', 'poste_id', 'motif_absence_id', 'non_travaille', 'tp',
    'competence_id', 'ligne_id', 'atelier_id', 'equipe_id', 'date_debut', 'date_fin', 'semaine',
    'nom', 'prenom', 'matricule', 'libelle', 'code', 'name', 'email', 'role', 'module', 'user_id'
  ];
  v_o jsonb; v_n jsonb;
  v_change boolean;
  k text;
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

  -- Compaction (0090) : APRÈS le calcul de l'identifiant, du site et de l'auteur,
  -- qui lisent les colonnes techniques.
  if (tg_op = 'UPDATE') then
    v_o := '{}'::jsonb;
    v_n := '{}'::jsonb;
    v_change := false;
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any(v_tech);
      if (v_old -> k) is distinct from (v_new -> k) then
        v_change := true;
        v_o := v_o || jsonb_build_object(k, v_old -> k);
        v_n := v_n || jsonb_build_object(k, v_new -> k);
      elsif k = any(v_contexte) then
        v_o := v_o || jsonb_build_object(k, v_old -> k);
        v_n := v_n || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    -- Rien d'utile n'a changé : pas de ligne au journal.
    if not v_change then
      return new;
    end if;
    v_old := v_o;
    v_new := v_n;
  elsif (tg_op = 'INSERT') then
    v_new := v_new - v_tech;
  else
    v_old := v_old - v_tech;
  end if;

  insert into public.audit_log
    (app_user_id, action, table_name, record_id, old_values, new_values, site_id, impersonated_by, lot)
  values (v_actor, tg_op, tg_table_name, v_id, v_old, v_new, v_site, v_imp, v_lot);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;
