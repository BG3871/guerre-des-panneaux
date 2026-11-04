-- Vérification des affiches par photo (V1) : la photo est prise dans l'appli, le texte de
-- l'affiche est lu sur le téléphone (OCR) et comparé au nom du candidat. Score >= 0,8 et
-- position à moins de 50 m : relevé « vérifié ». Cas douteux : validés par 3 votes de joueurs.
-- Relançable sans risque. Déjà inclus dans schema.sql.

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
