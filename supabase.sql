-- OCD — schéma initial Supabase
-- Exécuter tout ce fichier dans Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  age integer check (age is null or (age >= 16 and age <= 100)),
  country text not null default '',
  city text not null default '',
  phone text not null default '',
  sector text not null default '',
  skills text not null default '',
  experience text not null default '',
  availability text not null default '',
  bio text not null default '',
  role text not null default 'jeune' check (role in ('jeune','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  organization text not null default 'OCD',
  type text not null,
  sector text not null,
  country_scope text not null,
  city text not null default '',
  deadline date,
  availability_required text not null default '',
  required_skills text not null default '',
  description text not null,
  application_instructions text not null default '',
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ancien champ de rémunération supprimé : les offres OCD ne stockent aucun montant.
alter table public.opportunities drop column if exists compensation;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted','reviewing','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id,user_id)
);

create index if not exists opportunities_status_created_idx on public.opportunities(status, created_at desc);
create index if not exists opportunities_country_sector_idx on public.opportunities(country_scope, sector);
create index if not exists applications_user_created_idx on public.applications(user_id, created_at desc);
create index if not exists applications_opportunity_idx on public.applications(opportunity_id);

-- Profil créé automatiquement à l'inscription. Le rôle est toujours "jeune".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, age, country, city, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name',''),
    nullif(new.raw_user_meta_data ->> 'age','')::integer,
    coalesce(new.raw_user_meta_data ->> 'country',''),
    coalesce(new.raw_user_meta_data ->> 'city',''),
    coalesce(new.raw_user_meta_data ->> 'phone',''),
    'jeune'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Helpers de rôle : le rôle vient de la table protégée, pas de metadata modifiable côté client.
create or replace function public.is_ocd_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function public.is_opportunity_open_for_user(target_opportunity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.opportunities o
    join public.profiles p on p.id = (select auth.uid())
    where o.id = target_opportunity
      and o.status = 'published'
      and (o.country_scope = 'Tous les pays' or o.country_scope = p.country)
  );
$$;

alter table public.profiles enable row level security;
alter table public.opportunities enable row level security;
alter table public.applications enable row level security;

-- Profiles: chaque jeune voit/modifie son profil. Les admins peuvent consulter tous les profils.
drop policy if exists "profile read self or admin" on public.profiles;
create policy "profile read self or admin" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or public.is_ocd_admin());

drop policy if exists "profile insert self as young" on public.profiles;
create policy "profile insert self as young" on public.profiles
for insert to authenticated
with check (id = (select auth.uid()) and role = 'jeune');

drop policy if exists "profile update self without role escalation" on public.profiles;
create policy "profile update self without role escalation" on public.profiles
for update to authenticated
using (id = (select auth.uid()) or public.is_ocd_admin())
with check (
  public.is_ocd_admin()
  or (id = (select auth.uid()) and role = 'jeune')
);

-- Opportunities: le public connecté voit les offres publiées; seuls les admins gèrent les offres.
drop policy if exists "published opportunities readable" on public.opportunities;
create policy "published opportunities readable" on public.opportunities
for select to anon, authenticated
using (status = 'published' or public.is_ocd_admin());

drop policy if exists "admins insert opportunities" on public.opportunities;
create policy "admins insert opportunities" on public.opportunities
for insert to authenticated
with check (public.is_ocd_admin() and created_by = (select auth.uid()));

drop policy if exists "admins update opportunities" on public.opportunities;
create policy "admins update opportunities" on public.opportunities
for update to authenticated
using (public.is_ocd_admin())
with check (public.is_ocd_admin());

drop policy if exists "admins delete opportunities" on public.opportunities;
create policy "admins delete opportunities" on public.opportunities
for delete to authenticated
using (public.is_ocd_admin());

-- Applications: le jeune ne voit que les siennes; les admins voient et changent les statuts.
drop policy if exists "application read own or admin" on public.applications;
create policy "application read own or admin" on public.applications
for select to authenticated
using (user_id = (select auth.uid()) or public.is_ocd_admin());

drop policy if exists "apply to open opportunity" on public.applications;
create policy "apply to open opportunity" on public.applications
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_opportunity_open_for_user(opportunity_id)
);

drop policy if exists "admin update applications" on public.applications;
create policy "admin update applications" on public.applications
for update to authenticated
using (public.is_ocd_admin())
with check (public.is_ocd_admin());

drop policy if exists "owner withdraw or admin delete application" on public.applications;
create policy "owner withdraw or admin delete application" on public.applications
for delete to authenticated
using (user_id = (select auth.uid()) or public.is_ocd_admin());

-- Ne pas activer de politique d'accès public sans authentification pour les profils/candidatures.
-- Premier admin: inscrire un compte, copier son UUID depuis Authentication > Users,
-- puis exécuter :
-- update public.profiles set role = 'admin' where id = 'UUID_DU_COMPTE';
