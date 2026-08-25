create table if not exists email_verifications (
  email text primary key,
  token_hash text not null,
  expires_at integer not null,
  verified_at integer
);

alter table email_verifications add column code_hash text not null default '';

create index if not exists email_verifications_token_hash
  on email_verifications (token_hash);