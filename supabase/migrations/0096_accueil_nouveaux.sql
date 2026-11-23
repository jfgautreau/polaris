-- =====================================================================
-- 0096 — Accueil des nouveaux (2026-11-23)
--
-- Hélène valide, au Personnel, chaque accueil réalisé par un nouvel arrivant
-- (ex. Accueil MP, Accueil Fab, Accueil Condi). La liste des accueils se règle
-- dans Param. RH (droit `motifs`) : simples libellés ordonnés, sans lien avec
-- les services — rien n'est fixé en dur dans le code.
--
--  - `accueil` : liste par site (libellé, ordre, actif). Lecture sous RLS bornée
--    au site ; écriture en service_role après la garde du module (server actions).
--  - `personne.accueils` : jsonb { "<accueil_id>": "AAAA-MM-JJ" } = date du OK.
--    Clé absente = accueil pas fait. Écrit par /api/personnel (op `accueil`).
--
-- Amorçage : Le Bignon reçoit MP, Fab, Condi. Les autres sites démarrent vides
-- (aucune colonne au Personnel tant qu'aucun accueil n'est créé).
-- =====================================================================

create table if not exists public.accueil (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.site(id) on delete cascade,
  libelle    text not null check (char_length(btrim(libelle)) between 1 and 20),
  ordre      integer not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists accueil_site_idx on public.accueil (site_id, ordre);

alter table public.accueil enable row level security;

drop policy if exists accueil_select on public.accueil;
create policy accueil_select on public.accueil
  for select to authenticated
  using (site_id = (select public.current_site_id()));

grant select, insert, update, delete on public.accueil to authenticated, service_role;

alter table public.personne
  add column if not exists accueils jsonb not null default '{}'::jsonb;

-- Amorçage du Bignon (idempotent : seulement si le site n'a encore aucun accueil).
insert into public.accueil (site_id, libelle, ordre)
select s.id, v.libelle, v.ordre
from public.site s
cross join (values ('MP', 1), ('Fab', 2), ('Condi', 3)) as v(libelle, ordre)
where (s.slug = 'lebignon' or s.nom = 'Le Bignon')
  and not exists (select 1 from public.accueil a where a.site_id = s.id);
