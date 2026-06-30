-- =========================================================
-- Loki_devrbx Portfolio — schéma Supabase
-- À coller dans Supabase > SQL Editor > Run
-- =========================================================

create table if not exists creations (
  id           text primary key,             -- ID du message Discord
  title        text not null default 'Sans titre',
  price        text default 'Sur devis',
  category     text default 'Autre',
  status       text default 'Disponible',
  description  text default '',
  link         text,
  images       text[] default '{}',
  published    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Active la sécurité au niveau des lignes
alter table creations enable row level security;

-- Le site (clé publique "anon") peut UNIQUEMENT lire les créations publiées
create policy "Public read published creations"
  on creations for select
  using (published = true);

-- Aucune policy d'écriture n'est créée pour "anon" : seul le bot,
-- qui utilise la clé "service_role" (secrète, jamais exposée au site),
-- peut insérer / modifier / supprimer des lignes.

-- =========================================================
-- Formules de tarifs (section "Tarifs" du site)
-- =========================================================

create table if not exists pricing_plans (
  id           text primary key,             -- ID du message Discord
  name         text not null default 'Plan',
  eyebrow      text default '',
  price        text default '',
  detail       text default '',
  link         text,
  highlighted  boolean default false,
  features     text[] default '{}',
  published    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table pricing_plans enable row level security;

create policy "Public read published pricing plans"
  on pricing_plans for select
  using (published = true);
