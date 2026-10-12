# OCD — Les Opportunités C'est Dehors

Première version fonctionnelle du site OCD en HTML/CSS/JavaScript + Supabase.

## Fonctions
- Inscription/connexion des jeunes africains avec Supabase Auth.
- Création et modification du profil.
- Liste des opportunités publiées par les administrateurs.
- Catégories d’offres : Emploi, Mission, Entrepreneuriat, Formation, Formation / bourse, Stage, Événement / recrutement.
- Candidatures envoyées directement sur OCD, sans lien externe obligatoire.
- Aucun champ ni montant de rémunération dans les offres ; contenu textuel uniquement.
- Classement : pays en priorité, secteur ensuite, compétences après.
- Candidature aux opportunités et suivi du statut.
- Administration sécurisée par le rôle `admin` dans `profiles`.
- RLS sur les tables.

## Mise en route
1. Crée un projet sur https://supabase.com/
2. Dans SQL Editor, exécute tout le fichier `supabase.sql`.
3. Ouvre `index.html` et remplace `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `app.js`.
4. Pour créer le premier administrateur :
   - Inscris-toi normalement sur le site.
   - Dans Supabase > Authentication > Users, copie l'UUID de ton utilisateur.
   - Dans SQL Editor, exécute :
     `update public.profiles set role = 'admin' where id = 'TON-UUID';`
   - Déconnecte-toi puis reconnecte-toi.
5. Héberge les fichiers sur Vercel, Netlify ou un autre hébergeur statique.

## Sécurité
- La clé `anon`/publishable est prévue pour le frontend avec RLS activée.
- Ne mets jamais la clé `service_role` dans `app.js` ni dans le navigateur.
- Seuls les administrateurs dont le rôle est défini dans la base peuvent créer/modifier/supprimer des opportunités.
- Les nouveaux utilisateurs reçoivent automatiquement le rôle `jeune`.
- Vérifie les conditions d'utilisation, la confidentialité et la procédure de vérification des offres avant lancement public.

## Mise à jour de la base existante
Si tu avais déjà exécuté une ancienne version du SQL, réexécute le fichier `supabase.sql` : le champ `compensation` est supprimé de la table `opportunities`. Cette suppression retire aussi les anciennes valeurs enregistrées dans ce champ.

## Limites de cette première version
- Pas encore de vérification de téléphone, de notifications WhatsApp/e-mail ni de téléversement de CV.
- Les profils sont classés pour chaque opportunité, pas globalement dans une file d'attente administrative.
- La disponibilité est stockée dans le profil, mais le classement suit d'abord pays, secteur, compétences, comme demandé.
