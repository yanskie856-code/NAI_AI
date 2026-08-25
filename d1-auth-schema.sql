create table if not exists email_verifications (
  email text primary key,
  token_hash text not null,
  code_hash text not null default '',
  expires_at integer not null,
  verified_at integer
);

create index if not exists email_verifications_token_hash
  on email_verifications (token_hash);

create table if not exists embed_configs (
  token_hash text primary key,
  system_name text not null,
  position text not null default 'bottom-right',
  mode text not null default 'mascot',
  documents_json text not null default '[]',
  expires_at integer not null,
  created_at integer not null
);