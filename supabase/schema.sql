create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','manager','viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.parking_settings (
  id smallint primary key default 1 check (id = 1),
  stall_count integer not null default 20 check (stall_count > 0),
  max_stay_hours integer not null default 24 check (max_stay_hours > 0),
  rolling_days integer not null default 30 check (rolling_days > 0),
  max_days_in_period integer not null default 7 check (max_days_in_period > 0),
  updated_at timestamptz not null default now()
);
insert into public.parking_settings(id) values(1) on conflict do nothing;

create table if not exists public.parking_registrations (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  phone text not null,
  stall_number integer not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  confirmation_code text not null unique,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists parking_plate_time_idx on public.parking_registrations(plate,start_at desc);
create index if not exists parking_stall_time_idx on public.parking_registrations(stall_number,start_at,end_at);
create index if not exists parking_reminder_idx on public.parking_registrations(end_at) where reminder_sent_at is null and status='active';

alter table public.profiles enable row level security;
alter table public.parking_settings enable row level security;
alter table public.parking_registrations enable row level security;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id) values(new.id); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Records are intentionally inaccessible from the browser. The Worker uses the service-role key.
revoke all on public.parking_registrations from anon, authenticated;
revoke all on public.parking_settings from anon, authenticated;

-- Supabase dashboard: after creating the first staff user, promote them once:
-- update public.profiles set role='admin' where id=(select id from auth.users where email='you@example.com');
