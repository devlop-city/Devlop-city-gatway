create table orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text unique not null,
  idempotency_key text unique not null,
  session_hash text not null,
  amount_paise bigint not null check (amount_paise = 49900),
  status text not null default 'pending'
    check (status in ('pending','paid','failed','expired','amount_mismatch')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table payments (
  provider_txn_id text primary key,   -- duplicate txn blocked here
  order_id uuid not null references orders(id),
  amount_paise bigint not null,
  source text not null,               -- psp | manual
  created_at timestamptz not null default now()
);
create table licenses (
  license_id uuid primary key default gen_random_uuid(),
  order_id uuid unique not null references orders(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table audit_log (
  id bigserial primary key, event text not null,
  order_ref text, meta jsonb, at timestamptz default now()
);
