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

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const CATEGORY_ORDER = ['Truitt', 'CyFalls', 'Sports', 'School', 'Uncategorized'];

export default function App() {
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [emails, setEmails] = useState([]);
  const [expandedEmailId, setExpandedEmailId] = useState(null);
  const [newTask, setNewTask] = useState('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  async function loadEverything() {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch('/.netlify/functions/get-outlook-events').then((r) => r.json()),
      fetch('/.netlify/functions/get-google-events').then((r) => r.json()),
      fetch('/.netlify/functions/tasks').then((r) => r.json()),
      fetch('/.netlify/functions/get-cfisd-emails').then((r) => r.json()),
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
      if (results[1].value.calendarErrors?.length) {
        errs.push(...results[1].value.calendarErrors);
      }
    } else {
      errs.push('Google calendar not connected yet.');
    }

    combined.sort((a, b) => new Date(a.start) - new Date(b.start));
    setEvents(combined);

    if (results[2].status === 'fulfilled' && results[2].value.tasks) {
      setTasks(results[2].value.tasks);
    }

    if (results[3].status === 'fulfilled' && results[3].value.emails) {
      setEmails(results[3].value.emails);
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

  // Group emails by category, preserving a sensible display order and
  // putting anything uncategorized last.
  const emailsByCategory = emails.reduce((acc, e) => {
    const cat = e.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(e);
    return acc;
  }, {});
  const categoryKeys = Object.keys(emailsByCategory).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

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
                  <span className="event-source">{e.calendar || e.source}</span>
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
            {tasks.map((t) => (
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
        </section>
      </div>

      <section className="emails-section">
        <h2>Emails from CFISD</h2>
        {emails.length === 0 ? (
          <p className="muted">No CFISD emails yet.</p>
        ) : (
          categoryKeys.map((cat) => (
            <div key={cat} className="email-category">
              <h3>{cat}</h3>
              <ul className="cfisd-email-list">
                {emailsByCategory[cat].map((email) => (
                  <li key={email.id} className="cfisd-email">
                    <div
                      className="cfisd-email-row"
                      onClick={() =>
                        setExpandedEmailId(
                          expandedEmailId === email.id ? null : email.id
                        )
                      }
                    >
                      <span className="cfisd-date">{formatDate(email.received_date)}</span>
                      <span className="cfisd-sender">{email.sender || 'Unknown sender'}</span>
                      <span className="cfisd-subject">{email.subject}</span>
                    </div>
                    {expandedEmailId === email.id && email.body && (
                      <div className="cfisd-body">{email.body}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
