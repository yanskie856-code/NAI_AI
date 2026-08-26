create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email, full_name)
select id, coalesce(email, ''), raw_user_meta_data ->> 'full_name'
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.systems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.systems(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  content text not null default '',
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.embed_tokens (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.systems(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  allowed_origin text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.system_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(email) <= 320),
  system_name text not null check (char_length(system_name) between 1 and 120),
  message text not null check (char_length(message) between 1 and 4000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  embed_token_id uuid references public.embed_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_requests add column if not exists knowledge_content text not null default '';
alter table public.system_requests add column if not exists knowledge_file_name text;
alter table public.system_requests add column if not exists embed_link text;

alter table public.systems enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.embed_tokens enable row level security;
alter table public.system_requests enable row level security;

drop policy if exists "Owners manage their systems" on public.systems;
create policy "Owners manage their systems"
  on public.systems for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Admins manage requested systems" on public.systems;
create policy "Admins manage requested systems"
  on public.systems for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Owners manage their documents" on public.knowledge_documents;
create policy "Owners manage their documents"
  on public.knowledge_documents for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.systems
      where systems.id = knowledge_documents.system_id
      and systems.owner_id = auth.uid()
    )
  );

drop policy if exists "Admins manage requested documents" on public.knowledge_documents;
create policy "Admins manage requested documents"
  on public.knowledge_documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Owners manage their tokens" on public.embed_tokens;
create policy "Owners manage their tokens"
  on public.embed_tokens for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.systems
      where systems.id = embed_tokens.system_id
      and systems.owner_id = auth.uid()
    )
  );

drop policy if exists "Admins manage requested tokens" on public.embed_tokens;
create policy "Admins manage requested tokens"
  on public.embed_tokens for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Users manage their requests" on public.system_requests;
create policy "Users manage their requests"
  on public.system_requests for all to authenticated
  using (requester_id = auth.uid())
  with check (requester_id = auth.uid() and email = coalesce(auth.jwt() ->> 'email', email));

drop policy if exists "Admins review requests" on public.system_requests;
create policy "Admins review requests"
  on public.system_requests for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins update requests" on public.system_requests;
create policy "Admins update requests"
  on public.system_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', false)
on conflict (id) do nothing;

drop policy if exists "Owners upload knowledge files" on storage.objects;
create policy "Owners upload knowledge files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners read knowledge files" on storage.objects;
create policy "Owners read knowledge files"
  on storage.objects for select to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners delete knowledge files" on storage.objects;
create policy "Owners delete knowledge files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

create index if not exists knowledge_documents_system_id_idx on public.knowledge_documents(system_id);
create index if not exists embed_tokens_hash_idx on public.embed_tokens(token_hash);
create index if not exists system_requests_requester_id_idx on public.system_requests(requester_id);
