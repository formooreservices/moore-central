// /.netlify/functions/tasks

// GET -> list tasks (add ?archived=true to list archived ones instead of active ones)

// POST -> create a task { title, due_date?, assigned_to?, email_id? }
//   email_id links a task back to the cfisd_emails row it was created from
//   (e.g. via the "Action Item" checkbox), so the frontend can jump to it.

// PATCH -> toggle/update a task { id, ...fields } — e.g. { id, completed: true } or { id, archived: true }

// DELETE -> permanently remove a task { id }

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.httpMethod === 'GET') {
    const showArchived = event.queryStringParameters?.archived === 'true';

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('archived', showArchived)
      .order('due_date', { ascending: true, nullsFirst: false });

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ tasks: data }) };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');

    if (!body.title) {
      return { statusCode: 400, body: 'A task needs a title.' };
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: body.title,
        due_date: body.due_date || null,
        assigned_to: body.assigned_to || null,
        source: body.source || 'manual',
        email_id: body.email_id || null,
      })
      .select()
      .single();

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 201, body: JSON.stringify({ task: data }) };
  }

  if (event.httpMethod === 'PATCH') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return { statusCode: 400, body: 'Missing task id.' };

    const { id, ...fields } = body;

    // Automatically stamp/clear completed_at when the completed flag changes,
    // so the frontend can show "completed on" dates without extra calls.
    if ('completed' in fields) {
      fields.completed_at = fields.completed ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ task: data }) };
  }

  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return { statusCode: 400, body: 'Missing task id.' };

    const { error } = await supabase.from('tasks').delete().eq('id', body.id);

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: 'Method not allowed.' };
}
