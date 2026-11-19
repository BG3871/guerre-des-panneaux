-- Panneaux disparus : un joueur qui ne trouve pas le panneau sur place le signale.
-- Le panneau n'est pas effacé : il est masqué de la carte (colonne masque_le) et tout
-- l'historique reste en base (signalements, relevés), pour pouvoir le rétablir.
--
-- Règles :
--   * un signalement par joueur et par panneau ;
--   * le panneau est masqué dès 2 joueurs différents, ou tout de suite si c'est un organisateur ;
--   * un relevé fait sur le panneau après un signalement prouve qu'il existe : les signalements
--     en cours sont annulés (gardés en historique avec annule_le) et le compteur repart à zéro.
--
-- Rétablir un panneau masqué par erreur (Supabase > SQL Editor) :
--   update public.panneaux set masque_le = null, signale_disparu = 0 where id = '…';
--   update public.signalements_disparu set annule_le = now() where panneau_id = '…' and annule_le is null;
--
-- Relançable sans risque. Déjà inclus dans schema.sql.

alter table public.panneaux add column if not exists signale_disparu integer not null default 0;
alter table public.panneaux add column if not exists masque_le timestamptz;

create table if not exists public.signalements_disparu (
  id         bigint generated always as identity primary key,
  panneau_id uuid not null references public.panneaux (id) on delete cascade,
  joueur     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cree_le    timestamptz not null default now(),
  annule_le  timestamptz
);
-- un seul signalement en cours par joueur et par panneau
create unique index if not exists signalements_disparu_actif
  on public.signalements_disparu (panneau_id, joueur) where annule_le is null;

-- Compte les signalements en cours et masque le panneau si le seuil est atteint.
-- (security definer : les joueurs n'ont pas le droit d'écrire dans panneaux)
create or replace function public.signalement_disparu() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n integer; admin boolean;
begin
  select count(*) into n from public.signalements_disparu
    where panneau_id = new.panneau_id and annule_le is null;
  admin := exists (select 1 from public.admins a where a.user_id = new.joueur);
  update public.panneaux
     set signale_disparu = n,
         masque_le = case when masque_le is null and (n >= 2 or admin) then now() else masque_le end
   where id = new.panneau_id;
  return new;
end $$;
drop trigger if exists signalement_disparu on public.signalements_disparu;
create trigger signalement_disparu after insert on public.signalements_disparu
  for each row execute function public.signalement_disparu();

-- Un relevé sur le panneau annule les signalements en cours (quelqu'un l'a vu).
create or replace function public.releve_annule_signalements() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.panneaux where id = new.panneau_id and signale_disparu > 0 and masque_le is null) then
    update public.signalements_disparu set annule_le = now()
     where panneau_id = new.panneau_id and annule_le is null and cree_le < new.cree_le;
    update public.panneaux set signale_disparu = 0 where id = new.panneau_id;
  end if;
  return new;
end $$;
drop trigger if exists releve_annule_signalements on public.releves;
create trigger releve_annule_signalements after insert on public.releves
  for each row execute function public.releve_annule_signalements();
revoke execute on function public.signalement_disparu(), public.releve_annule_signalements() from public, anon, authenticated;

-- ---------- droits ----------
-- On voit si un panneau a été signalé (le compteur sur panneaux), pas qui l'a signalé.
alter table public.signalements_disparu enable row level security;
revoke all on public.signalements_disparu from anon, authenticated;
grant select (id, panneau_id, cree_le, annule_le) on public.signalements_disparu to authenticated;
grant insert (panneau_id) on public.signalements_disparu to authenticated;
drop policy if exists "mes signalements" on public.signalements_disparu;
create policy "mes signalements" on public.signalements_disparu for select to authenticated
  using (joueur = (select auth.uid()));
drop policy if exists "signaler" on public.signalements_disparu;
create policy "signaler" on public.signalements_disparu for insert to authenticated
  with check (joueur = (select auth.uid())
              and exists (select 1 from public.panneaux p where p.id = panneau_id and p.masque_le is null));

-- Les joueurs ne peuvent pas écrire les deux nouvelles colonnes eux-mêmes.
revoke insert, update on public.panneaux from anon, authenticated;
grant insert (lat, lng, lieu, commune, cree_par) on public.panneaux to authenticated;

-- Un panneau masqué ne rapporte plus les 3 points de « panneau signalé ».
create or replace view public.classement with (security_invoker = true) as
  select pr.id, pr.pseudo,
         coalesce(r.n, 0) * 1 + coalesce(r.v, 0) * 2 + coalesce(p.n, 0) * 3 + coalesce(pv.n, 0) as points,
         coalesce(r.n, 0) as releves, coalesce(p.n, 0) as panneaux,
         coalesce(r.v, 0) as releves_verifies, coalesce(pv.n, 0) as votes_justes
  from public.profils pr
  left join (select auteur, count(*) n, count(*) filter (where verifie) v from public.releves group by auteur) r on r.auteur = pr.id
  left join (select cree_par, count(*) n from public.panneaux where source = 'contrib' and masque_le is null group by cree_par) p on p.cree_par = pr.id
  left join public.points_votes pv on pv.joueur = pr.id
  where coalesce(r.n, 0) + coalesce(p.n, 0) + coalesce(pv.n, 0) > 0;
grant select on public.classement to anon, authenticated;
