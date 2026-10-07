-- 0078 : un départ libère le poste fixe (titulaire).
--
-- `personne.poste_fixe_id` est la donnée « Titulaire » du Référentiel et « Poste
-- fixe » de la fiche Personnel. Une personne partie la gardait : le Référentiel
-- la masquait, mais le lien restait en base (9 cas au 2026-10-07).
--
-- Le statut est un cache calculé (0049 / 0050) : il passe à PARTI par le trigger
-- des contrats OU par rafraichir_statuts_personnes() (le lendemain de la date de
-- fin, au chargement de l'écran Personnel). On s'accroche donc à la mise à jour
-- du STATUT lui-même, quel que soit le chemin : dès qu'une personne devient
-- PARTI, son poste fixe est retiré. Un retour (nouveau contrat) ne le rétablit
-- pas : le titulaire se réaffecte à la main.

create or replace function public.liberer_poste_fixe_au_depart()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.statut = 'PARTI' and old.statut is distinct from 'PARTI' then
    new.poste_fixe_id := null;
  end if;
  return new;
end
$$;

drop trigger if exists liberer_poste_fixe_au_depart on public.personne;
create trigger liberer_poste_fixe_au_depart
  before update of statut on public.personne
  for each row execute function public.liberer_poste_fixe_au_depart();

-- Rattrapage : statuts à jour (bascules du jour non encore faites), puis retrait
-- du poste fixe des personnes déjà parties.
select public.rafraichir_statuts_personnes();
update public.personne
   set poste_fixe_id = null
 where statut = 'PARTI'
   and poste_fixe_id is not null;
