// /.netlify/functions/tasks
// GET    -> list tasks
// POST   -> create a task { title, due_date?, assigned_to? }
// PATCH  -> toggle/update a task { id, ...fields }
// DELETE -> remove a task { id }

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
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
