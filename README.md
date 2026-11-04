# Guerre des panneaux

La carte collaborative des **panneaux d'affichage libre** (expression libre) en France, et un jeu de territoire entre candidats.

- Plan des rues OpenStreetMap, utilisable sur téléphone : bouton « me localiser », « je suis devant le panneau » pour le signaler à sa position, commune remplie automatiquement.
- Pour le candidat choisi, chaque panneau est **vert** (affiche présente), **rouge** (absente) ou **gris** (pas encore relevé). Un relevé de plus de 14 jours apparaît pâli.
- **Jeu de territoire** : la France est découpée en hexagones dont la taille suit le zoom (60 km → 250 m). Un candidat conquiert un secteur quand son affiche est sur au moins 50 % des panneaux du secteur. La vue **Bataille** colore chaque secteur selon le candidat le mieux affiché.
- **Points des joueurs** : 1 par vérification (une par panneau, candidat et jour), 3 par panneau signalé. Classement des meilleurs colleurs.
- Temps réel : ce que les autres relèvent apparaît sans recharger la page.
- **Liste des candidats tenue par l'organisateur** : les joueurs proposent un candidat (nom, parti, lien source) et soutiennent les demandes des autres (+1) ; l'organisateur accepte ou refuse depuis la section « Candidats demandés ». On ne voit pas qui a demandé ou soutenu un candidat.
- Compte rattachable à une adresse e-mail, pour le retrouver sur un autre appareil.

## Architecture

| Partie | Choix | Pourquoi |
|---|---|---|
| Site | Vite + JavaScript, [Leaflet](https://leafletjs.com) | Léger, rapide sur mobile, aucun serveur à maintenir |
| Fond de carte | Tuiles OpenStreetMap (modifiable par `VITE_TILE_URL`) | Gratuit, plan des rues détaillé |
| Données partagées | [Supabase](https://supabase.com) : Postgres + comptes anonymes + temps réel | Offre gratuite, droits gérés en base (RLS) |
| Hébergement | GitHub Pages, via GitHub Actions | Gratuit, mise en ligne à chaque fusion sur `main` |

Sans Supabase configuré, l'appli tourne en **mode local** : données d'exemple fictives, et vos ajouts restent dans votre navigateur. Pratique pour essayer.

```
src/game.js            règles du jeu (secteurs, conquête, points) — testées dans tests/
src/main.js            interface et carte
src/store/supabase.js  carte partagée          src/store/local.js  mode local
supabase/schema.sql    tables, vues, droits, temps réel
data/panneaux-osm.json 1 398 panneaux issus d'OpenStreetMap (400 communes)
scripts/import-osm.mjs import de ces panneaux (ou d'un export Overpass / GeoJSON)
```

## Lancer en local

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # tests des règles du jeu
```

## Brancher la carte partagée (Supabase), une seule fois

1. Créez un projet gratuit sur [supabase.com](https://supabase.com) (région Europe).
2. **SQL Editor > New query** : collez le contenu de `supabase/schema.sql`, puis **Run**.
3. **Authentication > Sign In / Providers** : activez **Allow anonymous sign-ins** (les joueurs choisissent juste un pseudo).
4. Pré-remplissez la carte avec les panneaux OpenStreetMap : dans **SQL Editor**, collez `supabase/seed-osm.sql` puis **Run**. (Variante en ligne de commande, pour un autre fichier OSM :)
   ```bash
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npm run import-osm
   ```
   La clé `service_role` se trouve dans **Project Settings > API**. Elle est secrète : ne la mettez ni dans le site ni dans le dépôt.
5. **Devenir organisateur** (seul à pouvoir créer des candidats) : dans l'appli, choisissez un pseudo puis « Retrouver mon compte sur un autre appareil » et confirmez votre adresse e-mail. Ensuite, dans **SQL Editor** :
   ```sql
   insert into public.admins select id from auth.users where email = 'votre@adresse.fr';
   ```
   Pour que les liens reçus par e-mail ramènent sur le site, renseignez l'adresse du site dans **Authentication > URL Configuration** (Site URL et Redirect URLs).
6. Pour tester en local avec la vraie base, copiez `.env.example` en `.env.local` et remplissez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (clé « anon », publique).

## Mettre en ligne (GitHub Pages)

1. Dans le dépôt GitHub : **Settings > Pages > Source : GitHub Actions**.
2. Rien d'autre à configurer : l'adresse du projet Supabase et sa clé publique sont dans `.env.production` (valeurs publiques par conception).
3. Chaque fusion sur `main` publie le site sur `https://<compte>.github.io/guerre-des-panneaux/`.

## Limites connues de cette première version

- Les tuiles `tile.openstreetmap.org` conviennent à un usage modéré ([politique d'usage](https://operations.osmfoundation.org/policies/tiles/)). Si l'appli décolle, passez à un fournisseur de tuiles (MapTiler, Stadia, etc.) via `VITE_TILE_URL`.
- Tous les panneaux sont chargés au démarrage : très bien jusqu'à quelques dizaines de milliers. Au-delà, il faudra charger par zone et calculer les secteurs côté serveur.
- Comptes anonymes : n'importe qui peut jouer, donc tricher. Pistes : captcha Supabase, limite de relevés par heure, vérification par photo (étude en cours).
- La couche hexagonale est calculée dans le navigateur à chaque zoom.
