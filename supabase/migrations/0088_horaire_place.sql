-- 0088 : horaire par PLACE d'un poste (numéro de rotation).
--
-- Un poste à plusieurs personnes peut avoir des arrivées décalées : la place 12
-- à 5:00, la 15 à 5:30… La place est le numéro de rotation du poste
-- (`poste.numero_rotation`, « 12, 15-17 »), mémorisé sur chaque affectation
-- (`placement.numero_rotation`). Un horaire de place vaut TOUTE LA SEMAINE
-- (pas de jour), avec sa variante facultative « après une nuit » (cf. 0087).
--
-- Priorité (src/lib/horaires.ts), borne par borne : horaire spécifique du jour
-- > temps partiel > place (après une nuit, puis normal) > poste (après une
-- nuit, puis normal). Une place sans horaire garde celui du poste.

create table if not exists public.horaire_place (
  site_id           uuid not null references public.site (id) on delete cascade,
  poste_id          uuid not null references public.poste (id) on delete cascade,
  quart_code        text not null,
  numero            text not null,
  debut             text,
  fin               text,
  debut_apres_nuit  text,
  fin_apres_nuit    text,
  primary key (site_id, poste_id, quart_code, numero),
  foreign key (quart_code, site_id) references public.quart (code, site_id) on delete cascade
);
create index if not exists horaire_place_poste_idx on public.horaire_place (poste_id);

alter table public.horaire_place enable row level security;
drop policy if exists horaire_place_select on public.horaire_place;
create policy horaire_place_select on public.horaire_place
  for select to authenticated
  using (site_id = (select public.current_site_id()));
drop policy if exists horaire_place_modify on public.horaire_place;
create policy horaire_place_modify on public.horaire_place
  for all to authenticated
  using (site_id = (select public.current_site_id()) and (select public.is_admin()))
  with check (site_id = (select public.current_site_id()) and (select public.is_admin()));

-- Journal d'audit, comme horaire_poste.
drop trigger if exists audit_horaire_place on public.horaire_place;
create trigger audit_horaire_place after insert or update or delete on public.horaire_place
  for each row execute function public.audit_trigger();
