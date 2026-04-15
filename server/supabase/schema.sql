-- Proximate schema.
-- Apply via: supabase db push, or by pasting into the SQL editor.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_animal text not null,
  avatar_color text not null,
  contact_handle text,
  created_at timestamptz not null default now()
);

create table if not exists match_candidates (
  id uuid primary key default gen_random_uuid(),
  user_ids uuid[] not null,
  shared_theme text not null,
  room_context text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists match_candidates_user_ids_idx
  on match_candidates using gin (user_ids);

create index if not exists match_candidates_expires_at_idx
  on match_candidates (expires_at);

create table if not exists reveal_requests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references match_candidates(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, from_user, to_user)
);

create index if not exists reveal_requests_match_id_idx
  on reveal_requests (match_id);

-- RLS: we rely on the service-role key from the server for writes, but enabling
-- RLS prevents accidental exposure via the anon key.
alter table profiles enable row level security;
alter table match_candidates enable row level security;
alter table reveal_requests enable row level security;

-- Profiles: users can read any profile (needed for reveal), but only write their own.
drop policy if exists "profiles are readable by authenticated users" on profiles;
create policy "profiles are readable by authenticated users"
  on profiles for select
  to authenticated
  using (true);

drop policy if exists "users can insert their own profile" on profiles;
create policy "users can insert their own profile"
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on profiles;
create policy "users can update their own profile"
  on profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- match_candidates and reveal_requests: server-role only. RLS enabled with no
-- policies means the anon/authenticated roles cannot read or write; the
-- service-role key bypasses RLS.
