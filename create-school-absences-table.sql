create table if not exists school_absences (
  id uuid primary key default gen_random_uuid(),
  child text not null,
  absence_date date not null,
  note_sent boolean default false,
  created_at timestamptz default now()
);
