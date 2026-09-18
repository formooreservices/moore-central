-- Run this once in the Supabase SQL editor.
-- Lets a task created from "Action Item" remember which email it came from,
-- so the Task list can link back to it.
alter table tasks add column if not exists email_id uuid references cfisd_emails(id);
