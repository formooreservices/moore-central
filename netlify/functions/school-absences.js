// /.netlify/functions/school-absences

// GET -> list absences, most recent first

// POST -> create an absence { child, absence_date }

// PATCH -> update an absence { id, ...fields } — e.g. { id, note_sent: true }

// DELETE -> remove an absence { id }

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase
      .from('school_absences')
      .select('*')
      .order('absence_date', { ascending: false });

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ absences: data }) };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');

    if (!body.child || !body.absence_date) {
      return { statusCode: 400, body: 'Missing "child" or "absence_date".' };
    }

    const { data, error } = await supabase
      .from('school_absences')
      .insert({ child: body.child, absence_date: body.absence_date })
      .select()
      .single();

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 201, body: JSON.stringify({ absence: data }) };
  }

  if (event.httpMethod === 'PATCH') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return { statusCode: 400, body: 'Missing "id".' };

    const { id, ...fields } = body;

    const { data, error } = await supabase
      .from('school_absences')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ absence: data }) };
  }

  if (event.httpMethod === 'DELETE') {
    const body = JSON.parse(event.body || '{}');
    if (!body.id) return { statusCode: 400, body: 'Missing "id".' };

    const { error } = await supabase.from('school_absences').delete().eq('id', body.id);

    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: 'Method not allowed.' };
}
