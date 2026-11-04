-- Guerre des panneaux : schéma Supabase.
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Le script peut être relancé sans risque.
-- Ensuite : Authentication > Sign In / Providers > activer « Allow anonymous sign-ins ».

-- ---------- tables ----------
create table if not exists public.profils (
  id      uuid primary key references auth.users (id) on delete cascade,
  pseudo  text not null check (char_length(btrim(pseudo)) between 2 and 30),
  cree_le timestamptz not null default now()
);

create table if not exists public.candidats (
  id       uuid primary key default gen_random_uuid(),
  nom      text not null check (char_length(btrim(nom)) between 2 and 60),
  couleur  text not null check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  cree_par uuid default auth.uid() references auth.users (id) on delete set null,
  cree_le  timestamptz not null default now()
);
create unique index if not exists candidats_nom_unique on public.candidats (lower(btrim(nom)));

create table if not exists public.panneaux (
  id       uuid primary key default gen_random_uuid(),
  lat      double precision not null check (lat between 41 and 51.5),
  lng      double precision not null check (lng between -5.5 and 10),
  lieu     text not null default '' check (char_length(lieu) <= 120),
  commune  text not null default '' check (char_length(commune) <= 80),
  source   text not null default 'contrib' check (source in ('contrib', 'osm', 'import')),
  osm_id   text unique,                       -- ex. "node/123456", pour réimporter OSM sans doublons
  cree_par uuid default auth.uid() references auth.users (id) on delete set null,
  cree_le  timestamptz not null default now()
);
create index if not exists panneaux_lat_lng on public.panneaux (lat, lng);

-- Historique des relevés : « l'affiche du candidat est-elle sur ce panneau ? »
-- Un relevé par panneau, candidat, joueur et jour (refaire le relevé le même jour le corrige) :
-- c'est aussi ce qui limite les points à 1 par vérification et par jour.
create table if not exists public.releves (
  id          bigint generated always as identity primary key,
  panneau_id  uuid not null references public.panneaux (id) on delete cascade,
  candidat_id uuid not null references public.candidats (id) on delete cascade,
  present     boolean not null,
  auteur      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  jour        date not null default (now() at time zone 'Europe/Paris')::date,
  cree_le     timestamptz not null default now(),
  unique (panneau_id, candidat_id, auteur, jour)
);
create index if not exists releves_pc on public.releves (panneau_id, candidat_id, cree_le desc);

create or replace function public.releve_maj() returns trigger language plpgsql as $$
begin
  new.cree_le := now();
  new.jour := old.jour;
  new.auteur := old.auteur;
  return new;
end $$;
drop trigger if exists releve_maj on public.releves;
create trigger releve_maj before update on public.releves for each row execute function public.releve_maj();

-- ---------- vues ----------
-- Dernier relevé connu pour chaque couple panneau × candidat
create or replace view public.statut_actuel with (security_invoker = true) as
  select distinct on (panneau_id, candidat_id) id, panneau_id, candidat_id, present, auteur, cree_le
  from public.releves
  order by panneau_id, candidat_id, cree_le desc;

-- Points : 1 par relevé, 3 par panneau signalé (les panneaux importés ne rapportent rien)
create or replace view public.classement with (security_invoker = true) as
  select pr.id, pr.pseudo,
         coalesce(r.n, 0) * 1 + coalesce(p.n, 0) * 3 as points,
         coalesce(r.n, 0) as releves, coalesce(p.n, 0) as panneaux
  from public.profils pr
  left join (select auteur, count(*) n from public.releves group by auteur) r on r.auteur = pr.id
  left join (select cree_par, count(*) n from public.panneaux where source = 'contrib' group by cree_par) p on p.cree_par = pr.id
  where coalesce(r.n, 0) + coalesce(p.n, 0) > 0;

-- ---------- droits (Row Level Security) ----------
-- Tout le monde lit la carte. Écrire demande un compte (anonyme suffit) et n'agit qu'en son nom.
alter table public.profils   enable row level security;
alter table public.candidats enable row level security;
alter table public.panneaux  enable row level security;
alter table public.releves   enable row level security;

drop policy if exists "lecture" on public.profils;
create policy "lecture" on public.profils for select using (true);
drop policy if exists "mon profil" on public.profils;
create policy "mon profil" on public.profils for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "maj mon profil" on public.profils;
create policy "maj mon profil" on public.profils for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "lecture" on public.candidats;
create policy "lecture" on public.candidats for select using (true);
drop policy if exists "ajout" on public.candidats;
create policy "ajout" on public.candidats for insert to authenticated with check (cree_par = (select auth.uid()));

drop policy if exists "lecture" on public.panneaux;
create policy "lecture" on public.panneaux for select using (true);
drop policy if exists "ajout" on public.panneaux;
create policy "ajout" on public.panneaux for insert to authenticated
  with check (cree_par = auth.uid() and source = 'contrib' and osm_id is null);
drop policy if exists "suppression" on public.panneaux;
create policy "suppression" on public.panneaux for delete to authenticated using (cree_par = (select auth.uid()));

drop policy if exists "lecture" on public.releves;
create policy "lecture" on public.releves for select using (true);
drop policy if exists "ajout" on public.releves;
create policy "ajout" on public.releves for insert to authenticated with check (auteur = (select auth.uid()));
drop policy if exists "correction" on public.releves;
create policy "correction" on public.releves for update to authenticated using (auteur = (select auth.uid())) with check (auteur = (select auth.uid()));

grant select on public.statut_actuel, public.classement to anon, authenticated;

-- ---------- temps réel ----------
do $$ begin
  alter publication supabase_realtime add table public.candidats, public.panneaux, public.releves;
exception when duplicate_object then null; end $$;
