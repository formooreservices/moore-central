create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_date date,
  source text default 'manual',        -- 'manual' | 'email' | 'flyer'
  completed boolean default false,
  assigned_to text,                     -- e.g. 'Jennifer', 'Sam'
  created_at timestamp default now()
);

create table if not exists oauth_tokens (
  provider text primary key,            -- 'microsoft' | 'google'
  refresh_token text not null,
  updated_at timestamp default now()
);

create table if not exists cfisd_emails (
  id uuid primary key default gen_random_uuid(),
  received_date date,
  sender text,
  subject text,
  body text,
  category text,                        -- e.g. 'Truitt', 'CyFalls', 'Sports', 'School' — nullable for now
  checked boolean default false,
  action_item boolean default false,
  calendar_item boolean default false,
  created_at timestamp default now()
);

-- Run this in the Supabase SQL editor once, then grab your project URL
-- and service_role key from Project Settings > API for Netlify env vars.
