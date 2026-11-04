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
-- statut_actuel et classement sont définies dans la section « vérification par photo », plus bas.

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

-- ---------- temps réel ----------
do $$ begin
  alter publication supabase_realtime add table public.candidats, public.panneaux, public.releves;
exception when duplicate_object then null; end $$;

-- ---------- demandes d'ajout de candidat ----------
-- (contenu identique à supabase/migrations/002_demandes_candidat.sql)
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

-- ---------- vérification par photo ----------
-- (contenu identique à supabase/migrations/003_photos.sql)

-- ---------- stockage des images (privé : visibles des seuls joueurs connectés) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 1500000, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "photos lecture" on storage.objects;
create policy "photos lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos');
drop policy if exists "photos envoi" on storage.objects;
create policy "photos envoi" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- photos ----------
create table if not exists public.photos (
  id            bigint generated always as identity primary key,
  panneau_id    uuid not null references public.panneaux (id) on delete cascade,
  candidat_id   uuid not null references public.candidats (id) on delete cascade,
  auteur        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chemin        text not null check (char_length(chemin) <= 200),
  source        text not null default 'camera' check (source in ('camera', 'fichier')),
  distance_m    real check (distance_m >= 0),
  precision_m   real check (precision_m >= 0),
  texte_lu      text check (char_length(texte_lu) <= 2000),
  score         real not null default 0 check (score between 0 and 1),
  statut        text not null default 'a_valider'
                check (statut in ('verifiee', 'a_valider', 'non_verifiee', 'rejetee')),
  votes_oui     integer not null default 0,
  votes_non     integer not null default 0,
  votes_illisible integer not null default 0,
  cree_le       timestamptz not null default now(),
  decide_le     timestamptz
);
create index if not exists photos_statut on public.photos (statut, cree_le desc);
create index if not exists photos_panneau on public.photos (panneau_id, cree_le desc);

alter table public.releves add column if not exists photo_id bigint references public.photos (id) on delete set null;
alter table public.releves add column if not exists verifie boolean not null default false;

-- Points gagnés en validant les photos des autres (lisible par tous, écrit par les triggers)
create table if not exists public.points_votes (
  joueur uuid primary key references auth.users (id) on delete cascade,
  n      integer not null default 0
);

create table if not exists public.votes_photo (
  photo_id bigint not null references public.photos (id) on delete cascade,
  joueur   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  vote     text not null check (vote in ('oui', 'non', 'illisible')),
  cree_le  timestamptz not null default now(),
  primary key (photo_id, joueur)
);

-- Statut décidé côté base, pas par le téléphone : seuils de score et de distance, et une photo
-- sur dix validée d'office part quand même chez les joueurs (contrôle au hasard).
create or replace function public.photo_statut() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.statut := case
    when new.source = 'camera' and new.score >= 0.8 and new.distance_m <= 50 and coalesce(new.precision_m, 999) <= 100
      then case when random() < 0.1 then 'a_valider' else 'verifiee' end
    when new.score >= 0.5 or (new.source = 'fichier' and new.score >= 0.8)
      or (new.score >= 0.8 and (new.distance_m is null or new.distance_m > 50 or coalesce(new.precision_m, 999) > 100))
      then 'a_valider'
    else 'non_verifiee'
  end;
  new.votes_oui := 0; new.votes_non := 0; new.votes_illisible := 0;
  new.decide_le := case when new.statut = 'verifiee' then now() end;
  new.cree_le := now();
  return new;
end $$;
drop trigger if exists photo_statut on public.photos;
create trigger photo_statut before insert on public.photos for each row execute function public.photo_statut();

-- La photo enregistre (ou corrige) le relevé du jour : affiche présente, liée à la photo.
create or replace function public.photo_releve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.releves (panneau_id, candidat_id, present, auteur, photo_id, verifie)
  values (new.panneau_id, new.candidat_id, true, new.auteur, new.id, new.statut = 'verifiee')
  on conflict (panneau_id, candidat_id, auteur, jour)
  -- une photo non vérifiée n'efface pas la vérification d'une photo précédente du même jour
  do update set present = true,
    photo_id = case when excluded.verifie or not public.releves.verifie then excluded.photo_id else public.releves.photo_id end,
    verifie = public.releves.verifie or excluded.verifie;
  return new;
end $$;
drop trigger if exists photo_releve on public.photos;
create trigger photo_releve after insert on public.photos for each row execute function public.photo_releve();

-- Un relevé corrigé à la main (présente ↔ absente) perd la vérification de sa photo.
create or replace function public.releve_maj() returns trigger language plpgsql as $$
begin
  new.cree_le := now();
  new.jour := old.jour;
  new.auteur := old.auteur;
  if new.present is distinct from old.present and new.photo_id is not distinct from old.photo_id then
    new.verifie := false;
  end if;
  return new;
end $$;

-- On ne vote que sur une photo en attente, et pas sur les siennes (l'auteur est caché aux joueurs,
-- d'où ce contrôle dans un trigger plutôt que dans la règle d'accès).
create or replace function public.photo_vote_controle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.photos p
                 where p.id = new.photo_id and p.statut = 'a_valider' and p.auteur <> new.joueur) then
    raise exception 'vote impossible sur cette photo' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists photo_vote_controle on public.votes_photo;
create trigger photo_vote_controle before insert on public.votes_photo for each row execute function public.photo_vote_controle();

-- Chaque vote met à jour les compteurs ; le premier choix à 3 voix tranche.
create or replace function public.photo_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.photos%rowtype; decision text;
begin
  update public.photos set
    votes_oui = votes_oui + (new.vote = 'oui')::int,
    votes_non = votes_non + (new.vote = 'non')::int,
    votes_illisible = votes_illisible + (new.vote = 'illisible')::int
  where id = new.photo_id returning * into p;
  if p.statut <> 'a_valider' then return new; end if;
  decision := case when p.votes_oui >= 3 then 'oui' when p.votes_non >= 3 then 'non'
                   when p.votes_illisible >= 3 then 'illisible' end;
  if decision is null then return new; end if;
  update public.photos set
    statut = case decision when 'oui' then 'verifiee' when 'non' then 'rejetee' else 'non_verifiee' end,
    decide_le = now()
  where id = p.id;
  update public.releves set verifie = (decision = 'oui') where photo_id = p.id;
  -- 1 point à chaque joueur qui a voté comme la majorité
  insert into public.points_votes (joueur, n)
    select v.joueur, 1 from public.votes_photo v where v.photo_id = p.id and v.vote = decision
  on conflict (joueur) do update set n = public.points_votes.n + 1;
  return new;
end $$;
drop trigger if exists photo_vote on public.votes_photo;
create trigger photo_vote after insert on public.votes_photo for each row execute function public.photo_vote();
revoke execute on function public.photo_releve(), public.photo_vote(), public.photo_vote_controle() from public, anon, authenticated;

-- ---------- vues ----------
-- Un relevé vérifié par photo de moins de 24 h n'est pas effacé par un relevé sans photo.
create or replace view public.statut_actuel with (security_invoker = true) as
  select distinct on (panneau_id, candidat_id) id, panneau_id, candidat_id, present, auteur, cree_le, verifie
  from public.releves
  order by panneau_id, candidat_id, (verifie and cree_le > now() - interval '24 hours') desc, cree_le desc;

-- Points : 1 par relevé (+2 s'il est vérifié par photo), 3 par panneau signalé,
-- 1 par vote qui suit la majorité.
create or replace view public.classement with (security_invoker = true) as
  select pr.id, pr.pseudo,
         coalesce(r.n, 0) * 1 + coalesce(r.v, 0) * 2 + coalesce(p.n, 0) * 3 + coalesce(pv.n, 0) as points,
         coalesce(r.n, 0) as releves, coalesce(p.n, 0) as panneaux,
         coalesce(r.v, 0) as releves_verifies, coalesce(pv.n, 0) as votes_justes
  from public.profils pr
  left join (select auteur, count(*) n, count(*) filter (where verifie) v from public.releves group by auteur) r on r.auteur = pr.id
  left join (select cree_par, count(*) n from public.panneaux where source = 'contrib' group by cree_par) p on p.cree_par = pr.id
  left join public.points_votes pv on pv.joueur = pr.id
  where coalesce(r.n, 0) + coalesce(p.n, 0) + coalesce(pv.n, 0) > 0;

-- ---------- droits ----------
alter table public.photos       enable row level security;
alter table public.votes_photo  enable row level security;
alter table public.points_votes enable row level security;

-- Les joueurs ne fixent ni le statut ni les compteurs ; l'auteur d'une photo reste caché.
revoke all on public.photos from anon, authenticated;
grant select (id, panneau_id, candidat_id, chemin, source, texte_lu, score, statut,
              votes_oui, votes_non, votes_illisible, cree_le, decide_le) on public.photos to authenticated;
grant insert (panneau_id, candidat_id, chemin, source, distance_m, precision_m, texte_lu, score)
  on public.photos to authenticated;
drop policy if exists "lecture" on public.photos;
create policy "lecture" on public.photos for select to authenticated using (true);
drop policy if exists "envoi" on public.photos;
create policy "envoi" on public.photos for insert to authenticated
  with check (auteur = (select auth.uid()) and chemin like (select auth.uid())::text || '/%');

revoke all on public.votes_photo from anon, authenticated;
grant select (photo_id, vote, cree_le) on public.votes_photo to authenticated;
grant insert (photo_id, vote) on public.votes_photo to authenticated;
drop policy if exists "mes votes" on public.votes_photo;
create policy "mes votes" on public.votes_photo for select to authenticated using (joueur = (select auth.uid()));
drop policy if exists "voter" on public.votes_photo;
create policy "voter" on public.votes_photo for insert to authenticated
  with check (joueur = (select auth.uid()));

revoke all on public.points_votes from anon, authenticated;
grant select on public.points_votes to anon, authenticated;
drop policy if exists "lecture" on public.points_votes;
create policy "lecture" on public.points_votes for select using (true);

-- Les relevés : le joueur ne peut pas se déclarer « vérifié » lui-même.
revoke insert, update on public.releves from anon, authenticated;
grant insert (panneau_id, candidat_id, present, auteur) on public.releves to authenticated;
grant update (panneau_id, candidat_id, present, auteur) on public.releves to authenticated;

grant select on public.statut_actuel, public.classement to anon, authenticated;

-- Pas de temps réel sur photos : il pourrait diffuser la colonne auteur.
