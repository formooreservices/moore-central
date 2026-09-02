import { useEffect, useState } from 'react';
import './app.css';

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  async function loadEverything() {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch('/.netlify/functions/get-outlook-events').then((r) => r.json()),
      fetch('/.netlify/functions/get-google-events').then((r) => r.json()),
      fetch('/.netlify/functions/tasks').then((r) => r.json()),
    ]);

    const combined = [];
    const errs = [];

    if (results[0].status === 'fulfilled' && results[0].value.events) {
      combined.push(...results[0].value.events);
    } else {
      errs.push('Outlook calendar not connected yet.');
    }

    if (results[1].status === 'fulfilled' && results[1].value.events) {
      combined.push(...results[1].value.events);
    } else {
      errs.push('Google calendar not connected yet.');
    }

    combined.sort((a, b) => new Date(a.start) - new Date(b.start));
    setEvents(combined);

    if (results[2].status === 'fulfilled' && results[2].value.tasks) {
      setTasks(results[2].value.tasks);
    }

    setErrors(errs);
    setLoading(false);
  }

  useEffect(() => {
    loadEverything();
  }, []);

  async function addTask(e) {
    e.preventDefault();
    if (!newTask.trim()) return;
    const res = await fetch('/.netlify/functions/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: newTask.trim() }),
    });
    const data = await res.json();
    setTasks((t) => [...t, data.task]);
    setNewTask('');
  }

  async function toggleTask(task) {
    const res = await fetch('/.netlify/functions/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: task.id, completed: !task.completed }),
    });
    const data = await res.json();
    setTasks((t) => t.map((x) => (x.id === task.id ? data.task : x)));
  }

  return (
    <div className="app">
      <header>
        <h1>MooreCentral</h1>
        <p className="sub">Everything Moore household, one place.</p>
      </header>

      <div className="connect-row">
        <a className="connect-btn" href="/.netlify/functions/auth-microsoft-start">
          Connect Outlook
        </a>
        <a className="connect-btn" href="/.netlify/functions/auth-google-start">
          Connect Google Calendar
        </a>
      </div>

      {errors.length > 0 && (
        <div className="notice">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="columns">
        <section>
          <h2>Upcoming</h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : events.length === 0 ? (
            <p className="muted">Nothing on the calendar this week.</p>
          ) : (
            <ul className="event-list">
              {events.map((e) => (
                <li key={e.id} className={`event-row ${e.source}`}>
                  <span className="event-title">{e.title || 'Untitled event'}</span>
                  <span className="event-time">{formatTime(e.start)}</span>
                  <span className="event-source">{e.source}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Task list</h2>
          <form onSubmit={addTask} className="task-form">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Add a task"
            />
            <button type="submit">Add</button>
          </form>
          <ul className="task-list">
            {tasks
              .filter((t) => t.source !== 'email')
              .map((t) => (
                <li key={t.id} className={t.completed ? 'done' : ''}>
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={() => toggleTask(t)}
                  />
                  <span>{t.title}</span>
                  {t.assigned_to && <span className="assignee">{t.assigned_to}</span>}
                </li>
              ))}
          </ul>

          {tasks.some((t) => t.source === 'email') && (
            <>
              <h2 className="section-sub">From email</h2>
              <ul className="task-list email-tasks">
                {tasks
                  .filter((t) => t.source === 'email')
                  .map((t) => (
                    <li key={t.id} className={t.completed ? 'done' : ''}>
                      <input
                        type="checkbox"
                        checked={t.completed}
                        onChange={() => toggleTask(t)}
                      />
                      <span>{t.title}</span>
                      {t.assigned_to && (
                        <span className="assignee">{t.assigned_to}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
