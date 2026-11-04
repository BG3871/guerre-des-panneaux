-- Demandes d'ajout de candidat : seuls les administrateurs (Bruno) créent les candidats,
-- les joueurs proposent et soutiennent (+1). Relançable sans risque. Déjà inclus dans schema.sql.

-- ---------- administrateurs ----------
-- Pas de droit d'écriture côté appli : on s'ajoute depuis Supabase > SQL Editor, par exemple
--   insert into public.admins select id from auth.users where email = 'mon@adresse.fr';
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "moi" on public.admins;
create policy "moi" on public.admins for select to authenticated using (user_id = (select auth.uid()));

-- ---------- candidats : parti et variantes du nom (pour la future lecture des affiches) ----------
alter table public.candidats add column if not exists parti text check (char_length(parti) <= 60);
alter table public.candidats add column if not exists alias text[] not null default '{}';

drop policy if exists "ajout" on public.candidats;
drop policy if exists "ajout admin" on public.candidats;
create policy "ajout admin" on public.candidats for insert to authenticated
  with check (cree_par = (select auth.uid())
              and exists (select 1 from public.admins a where a.user_id = (select auth.uid())));
drop policy if exists "maj admin" on public.candidats;
create policy "maj admin" on public.candidats for update to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));

-- ---------- demandes ----------
create table if not exists public.demandes_candidat (
  id          bigint generated always as identity primary key,
  nom         text not null check (char_length(btrim(nom)) between 2 and 60),
  parti       text check (char_length(parti) <= 60),
  source_url  text check (char_length(source_url) <= 300 and source_url ~ '^https?://'),
  couleur     text check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  demandeur   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statut      text not null default 'en_attente' check (statut in ('en_attente', 'acceptee', 'refusee')),
  motif       text check (char_length(motif) <= 200),
  nb_soutiens integer not null default 0,
  cree_le     timestamptz not null default now(),
  traite_le   timestamptz
);
-- une seule demande en attente par nom : un doublon devient un soutien
create unique index if not exists demandes_nom_en_attente
  on public.demandes_candidat (lower(btrim(nom))) where statut = 'en_attente';

create table if not exists public.soutiens_demande (
  demande_id bigint not null references public.demandes_candidat (id) on delete cascade,
  joueur     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cree_le    timestamptz not null default now(),
  primary key (demande_id, joueur)
);

-- Le demandeur soutient sa demande ; chaque soutien incrémente le compteur.
-- (security definer : les joueurs n'ont pas le droit d'écrire ces colonnes eux-mêmes)
create or replace function public.demande_soutien_auto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.soutiens_demande (demande_id, joueur) values (new.id, new.demandeur) on conflict do nothing;
  return new;
end $$;
drop trigger if exists demande_soutien_auto on public.demandes_candidat;
create trigger demande_soutien_auto after insert on public.demandes_candidat
  for each row execute function public.demande_soutien_auto();

create or replace function public.soutien_compte() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.demandes_candidat set nb_soutiens = nb_soutiens + 1 where id = new.demande_id;
  return new;
end $$;
drop trigger if exists soutien_compte on public.soutiens_demande;
create trigger soutien_compte after insert on public.soutiens_demande
  for each row execute function public.soutien_compte();
revoke execute on function public.demande_soutien_auto(), public.soutien_compte() from public, anon, authenticated;

-- ---------- droits ----------
-- Tout le monde voit les demandes, mais pas qui les a faites ni qui les soutient
-- (soutenir un candidat révèle une opinion politique).
alter table public.demandes_candidat enable row level security;
alter table public.soutiens_demande  enable row level security;

revoke all on public.demandes_candidat from anon, authenticated;
grant select (id, nom, parti, source_url, couleur, statut, motif, nb_soutiens, cree_le, traite_le)
  on public.demandes_candidat to anon, authenticated;
grant insert (nom, parti, source_url, couleur) on public.demandes_candidat to authenticated;
grant update (statut, motif, traite_le) on public.demandes_candidat to authenticated;

drop policy if exists "lecture" on public.demandes_candidat;
create policy "lecture" on public.demandes_candidat for select using (true);
drop policy if exists "demande" on public.demandes_candidat;
create policy "demande" on public.demandes_candidat for insert to authenticated
  with check (demandeur = (select auth.uid()) and statut = 'en_attente');
drop policy if exists "traitement admin" on public.demandes_candidat;
create policy "traitement admin" on public.demandes_candidat for update to authenticated
  using (exists (select 1 from public.admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admins a where a.user_id = (select auth.uid())));

revoke all on public.soutiens_demande from anon, authenticated;
grant select (demande_id, cree_le) on public.soutiens_demande to authenticated;
grant insert (demande_id) on public.soutiens_demande to authenticated;
drop policy if exists "mes soutiens" on public.soutiens_demande;
create policy "mes soutiens" on public.soutiens_demande for select to authenticated using (joueur = (select auth.uid()));
drop policy if exists "soutenir" on public.soutiens_demande;
create policy "soutenir" on public.soutiens_demande for insert to authenticated
  with check (joueur = (select auth.uid())
              and exists (select 1 from public.demandes_candidat d where d.id = demande_id and d.statut = 'en_attente'));
