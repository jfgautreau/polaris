-- =====================================================================
-- 0097 — GPEC : projection des effectifs N+1 (2026-11-25)
--
-- Reprise, dans l'application, de la démarche de l'outil Excel « Projection des
-- compétences de production » : volumes → saturation des lignes → palier →
-- besoin en postes → besoin réel (absences comprises) → déficit par poste →
-- à former (vivier interne) / à recruter.
--
-- AUCUNE table existante n'est modifiée. Le référentiel (lignes, postes,
-- effectif par quart), la matrice, les postes fixes (titulaires), les contrats
-- et les absences sont LUS tels quels. Ces trois tables ne portent que ce que
-- l'application ne sait pas déjà : les hypothèses d'une année.
--
--  - `gpec_hypothese`   : une ligne par site × année (jours ouvrés, congés,
--    modulation, seuils des paliers, absentéisme subi forcé par service, motifs
--    exclus du calcul automatique de l'absentéisme subi).
--  - `gpec_ligne_capa`  : ligne « capacitaire » = capacité par jour + volume
--    (annuel ou 12 mois) + lignes du Référentiel rattachées (`lignes`, jsonb
--    d'ids — plusieurs lignes peuvent partager une capacité) + quarts ouverts
--    par palier (`paliers`, jsonb { "1": ["code", …], … } ; palier absent = tous
--    les quarts du Référentiel).
--  - `gpec_depart`      : départ prévu, nominatif (personne) ou anonyme (poste).
--    PAS de date de naissance dans l'application : la retraite se saisit ici.
--
-- Sécurité : droit dédié `gpec` (matrice des droits, accordé à personne par
-- défaut). Hypothèses et lignes capacitaires : lecture sous RLS bornée au site.
-- `gpec_depart` (nominatif) : AUCUNE lecture sous RLS — lu en service_role
-- borné au site, après la garde du module. Écritures : service_role seulement
-- (route /api/gpec, garde `gpec` en écriture).
-- =====================================================================

create table if not exists public.gpec_hypothese (
  site_id             uuid not null references public.site(id) on delete cascade,
  annee               integer not null check (annee between 2020 and 2100),
  jours_ouvres        integer not null default 254 check (jours_ouvres between 1 and 366),
  semaines_conges     numeric(4,1) not null default 5 check (semaines_conges between 0 and 30),
  semaines_modulation numeric(4,1) not null default 0 check (semaines_modulation between 0 and 30),
  seuil1              numeric(4,2) not null default 0.50 check (seuil1 > 0),
  seuil2              numeric(4,2) not null default 0.75 check (seuil2 > 0),
  seuil3              numeric(4,2) not null default 1.05 check (seuil3 > 0),
  -- { "<atelier_id>": semaines } : valeur forcée par service (absente = calcul auto).
  absences_subies     jsonb not null default '{}'::jsonb,
  -- [ "<motif_absence_id>", … ] : motifs exclus du calcul auto (longue maladie, AT…).
  motifs_exclus       jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  primary key (site_id, annee)
);

alter table public.gpec_hypothese enable row level security;

drop policy if exists gpec_hypothese_select on public.gpec_hypothese;
create policy gpec_hypothese_select on public.gpec_hypothese
  for select to authenticated
  using (site_id = (select public.current_site_id()));

grant select, insert, update, delete on public.gpec_hypothese to authenticated, service_role;

create table if not exists public.gpec_ligne_capa (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.site(id) on delete cascade,
  annee         integer not null check (annee between 2020 and 2100),
  nom           text not null check (char_length(btrim(nom)) between 1 and 60),
  capacite_jour numeric check (capacite_jour is null or capacite_jour >= 0),
  volume_annuel numeric check (volume_annuel is null or volume_annuel >= 0),
  -- 12 valeurs (janvier → décembre), null = mois non saisi. Dès qu'un mois est
  -- saisi, le volume annuel est la somme des mois.
  volumes_mois  jsonb,
  lignes        jsonb not null default '[]'::jsonb,
  paliers       jsonb not null default '{}'::jsonb,
  ordre         integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists gpec_ligne_capa_site_idx on public.gpec_ligne_capa (site_id, annee, ordre);

alter table public.gpec_ligne_capa enable row level security;

drop policy if exists gpec_ligne_capa_select on public.gpec_ligne_capa;
create policy gpec_ligne_capa_select on public.gpec_ligne_capa
  for select to authenticated
  using (site_id = (select public.current_site_id()));

grant select, insert, update, delete on public.gpec_ligne_capa to authenticated, service_role;

create table if not exists public.gpec_depart (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.site(id) on delete cascade,
  annee       integer not null check (annee between 2020 and 2100),
  personne_id uuid references public.personne(id) on delete cascade,
  poste_id    uuid references public.poste(id) on delete cascade,
  date_prevue date,
  motif       text not null default 'Retraite' check (char_length(motif) between 1 and 40),
  commentaire text check (commentaire is null or char_length(commentaire) <= 200),
  created_at  timestamptz not null default now(),
  constraint gpec_depart_cible check (personne_id is not null or poste_id is not null)
);

create index if not exists gpec_depart_site_idx on public.gpec_depart (site_id, annee);
create index if not exists gpec_depart_personne_idx on public.gpec_depart (personne_id);
create index if not exists gpec_depart_poste_idx on public.gpec_depart (poste_id);

-- Nominatif : RLS activée SANS policy → aucune lecture ni écriture hors
-- service_role (même principe que les tables des visites médicales, 0092).
alter table public.gpec_depart enable row level security;

grant select, insert, update, delete on public.gpec_depart to authenticated, service_role;

-- Filet multi-site (0092) : gpec_depart référence personne et poste — on rejoue
-- le bloc qui pose `verifier_site_fk` sur toute table à FK site-scopée.
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
  end loop;
end $$;
