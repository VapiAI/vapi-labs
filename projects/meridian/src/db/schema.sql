-- Meridian schema — guests, reservations, flight bookings, service requests, call logs.
-- Re-runnable: every statement uses "if not exists".
create extension if not exists pgcrypto;

create table if not exists guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  loyalty_tier text check (loyalty_tier in ('standard', 'silver', 'gold', 'platinum')),
  loyalty_points integer default 0,
  travel_credit_balance numeric(10,2) default 0,
  created_at timestamptz default now()
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  confirmation_number text unique not null,
  guest_id uuid references guests(id),
  property_name text,
  room_number text,
  room_type text,
  check_in date,
  check_out date,
  status text default 'active',
  special_requests text,
  created_at timestamptz default now()
);

create table if not exists flight_bookings (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guests(id),
  flight_number text not null,
  origin text,
  destination text,
  departure_time timestamptz,
  arrival_time timestamptz,
  seat text,
  cabin_class text default 'economy',
  booking_reference text unique,
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations(id),
  guest_id uuid references guests(id),
  request_type text,
  description text,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  vapi_call_id text unique,
  guest_id uuid references guests(id),
  assistant_name text,
  call_type text,
  resolution text,
  transcript text,
  upsell_offered boolean default false,
  upsell_converted boolean default false,
  duration_seconds integer,
  created_at timestamptz default now()
);

-- Lookup helpers for lookup_reservation (by name or confirmation number).
create index if not exists idx_guests_name_lower on guests (lower(name));
create index if not exists idx_reservations_conf on reservations (confirmation_number);
create index if not exists idx_reservations_guest on reservations (guest_id);

-- PostgREST API roles need explicit table privileges: tables created over a direct
-- postgres connection don't inherit Supabase's default grants. RLS stays OFF — all
-- access is server-side via the secret / service_role key.
-- refer to supabase documentation for best practices for RLS before considering this for a production deployment
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
