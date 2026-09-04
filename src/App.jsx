import { useEffect, useMemo, useState } from 'react';
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

function formatDateTime(dateStr) {
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
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  // Email table filter/sort state
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [sortField, setSortField] = useState('received_date');
  const [sortDir, setSortDir] = useState('desc');

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

  // ---------- Tasks ----------

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

  async function deleteTask(task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await fetch('/.netlify/functions/tasks', {
      method: 'DELETE',
      body: JSON.stringify({ id: task.id }),
    });
    setTasks((t) => t.filter((x) => x.id !== task.id));
  }

  function startEditTask(task) {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
  }

  async function saveEditTask(task) {
    const trimmed = editingTaskTitle.trim();
    if (!trimmed) return;
    const res = await fetch('/.netlify/functions/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: task.id, title: trimmed }),
    });
    const data = await res.json();
    setTasks((t) => t.map((x) => (x.id === task.id ? data.task : x)));
    setEditingTaskId(null);
  }

  // ---------- CFISD Emails ----------

  async function updateEmailField(email, field, value) {
    const res = await fetch('/.netlify/functions/update-cfisd-email', {
      method: 'PATCH',
      body: JSON.stringify({ id: email.id, [field]: value }),
    });
    const data = await res.json();
    setEmails((all) => all.map((e) => (e.id === email.id ? data.email : e)));
  }

  async function handleCalendarItemToggle(email, checked) {
    if (!checked) {
      // Just unchecking — no event to create, plain update.
      updateEmailField(email, 'calendar_item', false);
      return;
    }

    const defaultDate = email.received_date || new Date().toISOString().slice(0, 10);
    const dateInput = window.prompt(
      `Add "${email.subject}" to Google Calendar.\n\nDate (YYYY-MM-DD):`,
      defaultDate
    );
    if (!dateInput) return; // cancelled

    const timeInput = window.prompt(
      'Time (HH:MM, 24-hour) — leave blank for an all-day event:',
      ''
    );

    try {
      const res = await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        body: JSON.stringify({
          title: email.subject,
          description: email.body || '',
          date: dateInput.trim(),
          time: timeInput?.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert(`Couldn't create the calendar event: ${errText}`);
        return;
      }
      await updateEmailField(email, 'calendar_item', true);
      loadEverything(); // refresh Upcoming events to show the new one
    } catch (err) {
      alert(`Couldn't create the calendar event: ${err.message}`);
    }
  }

  const categories = useMemo(() => {
    const set = new Set(emails.map((e) => e.category || 'Uncategorized'));
    return ['All', ...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c))];
  }, [emails]);

  const filteredSortedEmails = useMemo(() => {
    let list = emails;
    if (categoryFilter !== 'All') {
      list = list.filter((e) => (e.category || 'Uncategorized') === categoryFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (e) =>
          e.subject?.toLowerCase().includes(q) ||
          e.sender?.toLowerCase().includes(q) ||
          e.body?.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      let av = a[sortField] ?? '';
      let bv = b[sortField] ?? '';
      if (sortField === 'received_date') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [emails, categoryFilter, searchText, sortField, sortDir]);

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function sortArrow(field) {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function printEmails() {
    window.print();
  }

  function emailEmails() {
    const lines = filteredSortedEmails.map(
      (e) =>
        `${formatDate(e.received_date)} | ${e.sender || ''} | ${e.subject || ''} | ${e.category || 'Uncategorized'}`
    );
    const body = encodeURIComponent(lines.join('\n'));
    const subject = encodeURIComponent('CFISD Emails from MooreCentral');
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
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
                {editingTaskId === t.id ? (
                  <input
                    className="task-edit-input"
                    value={editingTaskTitle}
                    onChange={(e) => setEditingTaskTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEditTask(t)}
                    autoFocus
                  />
                ) : (
                  <span>{t.title}</span>
                )}
                {t.assigned_to && <span className="assignee">{t.assigned_to}</span>}
                <span className="task-date">{formatDateTime(t.created_at)}</span>
                {editingTaskId === t.id ? (
                  <button className="icon-btn" onClick={() => saveEditTask(t)} title="Save">
                    ✓
                  </button>
                ) : (
                  <button className="icon-btn" onClick={() => startEditTask(t)} title="Edit">
                    ✎
                  </button>
                )}
                <button className="icon-btn danger" onClick={() => deleteTask(t)} title="Delete">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="emails-section">
        <div className="emails-header">
          <h2>Emails from CFISD</h2>
          <div className="emails-toolbar">
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="email-search"
              placeholder="Search subject, sender, body…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <button className="toolbar-btn" onClick={printEmails}>
              Print
            </button>
            <button className="toolbar-btn" onClick={emailEmails}>
              Email
            </button>
          </div>
        </div>

        {filteredSortedEmails.length === 0 ? (
          <p className="muted">No CFISD emails match.</p>
        ) : (
          <table className="cfisd-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('category')} className="sortable">
                  Category{sortArrow('category')}
                </th>
                <th onClick={() => toggleSort('received_date')} className="sortable">
                  Date{sortArrow('received_date')}
                </th>
                <th onClick={() => toggleSort('sender')} className="sortable">
                  From{sortArrow('sender')}
                </th>
                <th onClick={() => toggleSort('subject')} className="sortable">
                  Subject{sortArrow('subject')}
                </th>
                <th>Checked</th>
                <th>Action Item</th>
                <th>Calendar Item</th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedEmails.map((email) => (
                <>
                  <tr
                    key={email.id}
                    className="cfisd-row"
                    onClick={() =>
                      setExpandedEmailId(expandedEmailId === email.id ? null : email.id)
                    }
                  >
                    <td>
                      <span className="category-pill">{email.category || 'Uncategorized'}</span>
                    </td>
                    <td>{formatDate(email.received_date)}</td>
                    <td className="truncate">{email.sender || 'Unknown sender'}</td>
                    <td className="truncate">{email.subject}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!email.checked}
                        onChange={(e) => updateEmailField(email, 'checked', e.target.checked)}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!email.action_item}
                        onChange={(e) =>
                          updateEmailField(email, 'action_item', e.target.checked)
                        }
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!email.calendar_item}
                        onChange={(e) =>
                          handleCalendarItemToggle(email, e.target.checked)
                        }
                      />
                    </td>
                  </tr>
                  {expandedEmailId === email.id && (
                    <tr className="cfisd-body-row">
                      <td colSpan={7}>{email.body || 'No body content.'}</td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
