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

// Labels (matched against the event's calendar name or title, case-insensitive)
// that should be hidden when "Hide school and work" is checked.
const SCHOOL_WORK_LABELS = [
  "mommy's work",
  'dennis - school day',
  'christopher - school',
  'school',
  'work',
];

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

  // Calendar/events filter state
  const [eventSearchText, setEventSearchText] = useState('');
  const [hideSchoolWork, setHideSchoolWork] = useState(false);

  // Task archive view state
  const [viewArchived, setViewArchived] = useState(false);

  // Known Google calendars, fetched once for the "add to calendar" picker.
  const [calendars, setCalendars] = useState([{ label: 'Household', calendarId: 'primary' }]);

  // "Add to calendar" modal state — set when a Calendar Item checkbox is
  // checked; cleared on cancel or after the event is created.
  const [calendarModalEmail, setCalendarModalEmail] = useState(null);
  const [modalCalendarId, setModalCalendarId] = useState('');
  const [modalDate, setModalDate] = useState('');
  const [modalTime, setModalTime] = useState('');
  const [modalDescription, setModalDescription] = useState('');

  // Email table filter/sort state
  const [categoryFilter, setCategoryFilter] = useState('All');
  // 'all' | 'viewed' | 'unviewed' — mirrors the Task list's "Show archived"
  // pattern: a simple dropdown that swaps which subset of emails is shown.
  const [viewedFilter, setViewedFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const [sortField, setSortField] = useState('received_date');
  const [sortDir, setSortDir] = useState('desc');

  async function loadTasks(archived) {
    const res = await fetch(
      `/.netlify/functions/tasks${archived ? '?archived=true' : ''}`
    );
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
  }

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

  // Refetch the task list whenever the archived/active view is toggled.
  useEffect(() => {
    loadTasks(viewArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewArchived]);

  // Load the configured calendars once, for the "add to calendar" dropdown.
  useEffect(() => {
    fetch('/.netlify/functions/list-calendars')
      .then((r) => r.json())
      .then((data) => {
        if (data.calendars?.length) setCalendars(data.calendars);
      })
      .catch(() => {
        // Falls back to the default "Household: primary" already in state.
      });
  }, []);

  // ---------- Calendar / Events ----------

  const filteredEvents = useMemo(() => {
    let list = events;

    if (hideSchoolWork) {
      list = list.filter((e) => {
        const label = `${e.calendar || ''} ${e.title || ''}`.toLowerCase();
        return !SCHOOL_WORK_LABELS.some((needle) => label.includes(needle));
      });
    }

    if (eventSearchText.trim()) {
      const q = eventSearchText.toLowerCase();
      list = list.filter(
        (e) =>
          e.title?.toLowerCase().includes(q) ||
          e.calendar?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [events, hideSchoolWork, eventSearchText]);

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

  async function archiveTask(task) {
    const res = await fetch('/.netlify/functions/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: task.id, archived: true }),
    });
    if (res.ok) {
      // Archiving moves it out of whichever list is currently showing (active).
      setTasks((t) => t.filter((x) => x.id !== task.id));
    }
  }

  async function unarchiveTask(task) {
    const res = await fetch('/.netlify/functions/tasks', {
      method: 'PATCH',
      body: JSON.stringify({ id: task.id, archived: false }),
    });
    if (res.ok) {
      // Unarchiving moves it out of the archived list currently showing.
      setTasks((t) => t.filter((x) => x.id !== task.id));
    }
  }

  async function deleteTask(task) {
    if (!confirm(`Permanently delete "${task.title}"?`)) return;
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

  // Jumps to and expands the CFISD email a task was created from.
  function jumpToEmail(emailId) {
    setExpandedEmailId(emailId);
    // Give the row a moment to render/expand before scrolling to it.
    setTimeout(() => {
      document
        .getElementById(`email-row-${emailId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
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

  // "Checked" is displayed to the user as "Viewed", but the underlying
  // Supabase column is still named `checked` for now (renaming the column
  // is a separate migration — revisit if this sticks around long-term).
  async function handleViewedToggle(email, value) {
    await updateEmailField(email, 'checked', value);
  }

  // Checking "Action Item" creates a linked task in the Task list, titled
  // after the email's subject, so it shows up alongside manual tasks.
  async function handleActionItemToggle(email, checked) {
    await updateEmailField(email, 'action_item', checked);

    if (checked) {
      try {
        const res = await fetch('/.netlify/functions/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: email.subject,
            source: 'email',
            email_id: email.id,
          }),
        });
        const data = await res.json();
        if (data.task) setTasks((t) => [...t, data.task]);
      } catch (err) {
        // Non-fatal — the email is still marked as an action item even if
        // the linked task fails to create.
        console.error('Could not create linked task:', err);
      }
    }
    // Note: unchecking an action item does NOT currently delete or archive
    // the task that was created from it — that has to be archived/deleted
    // separately from the Task list for now.
  }

  // Checking "Calendar Item" opens the "add to calendar" modal instead of
  // creating the event immediately, so the user can pick which calendar.
  function handleCalendarItemToggle(email, checked) {
    if (!checked) {
      updateEmailField(email, 'calendar_item', false);
      return;
    }

    setCalendarModalEmail(email);
    setModalCalendarId(calendars[0]?.calendarId || 'primary');
    setModalDate(email.received_date || new Date().toISOString().slice(0, 10));
    setModalTime('');
    // Pre-fill with the email body as a starting point, but let the user
    // edit it before it becomes the calendar event's description.
    setModalDescription(email.body || '');
  }

  async function confirmAddToCalendar() {
    const email = calendarModalEmail;
    if (!email || !modalDate) return;

    try {
      const res = await fetch('/.netlify/functions/create-calendar-event', {
        method: 'POST',
        body: JSON.stringify({
          title: email.subject,
          description: modalDescription,
          date: modalDate,
          time: modalTime || undefined,
          calendarId: modalCalendarId,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert(`Couldn't create the calendar event: ${errText}`);
        return;
      }
      await updateEmailField(email, 'calendar_item', true);
      setCalendarModalEmail(null);
      loadEverything(); // refresh Upcoming events to show the new one
    } catch (err) {
      alert(`Couldn't create the calendar event: ${err.message}`);
    }
  }

  function cancelAddToCalendar() {
    setCalendarModalEmail(null);
  }

  const categories = useMemo(() => {
    const set = new Set(emails.map((e) => e.category || 'Uncategorized'));
    return ['All', ...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c))];
  }, [emails]);

  // "X of Y viewed" summary, based on the full loaded email set (not the
  // currently filtered/sorted view) so it reads as a stable running total.
  const viewedCount = useMemo(() => emails.filter((e) => e.checked).length, [emails]);

  const filteredSortedEmails = useMemo(() => {
    let list = emails;
    if (categoryFilter !== 'All') {
      list = list.filter((e) => (e.category || 'Uncategorized') === categoryFilter);
    }
    if (viewedFilter === 'viewed') {
      list = list.filter((e) => e.checked);
    } else if (viewedFilter === 'unviewed') {
      list = list.filter((e) => !e.checked);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((e) => e.received_date && new Date(e.received_date).getTime() >= from);
    }
    if (dateTo) {
      // Include the whole "to" day by treating it as end-of-day.
      const to = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
      list = list.filter((e) => e.received_date && new Date(e.received_date).getTime() <= to);
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
  }, [emails, categoryFilter, viewedFilter, dateFrom, dateTo, searchText, sortField, sortDir]);

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
          <div className="event-toolbar">
            <input
              className="event-search"
              placeholder="Search events…"
              value={eventSearchText}
              onChange={(e) => setEventSearchText(e.target.value)}
            />
            <label className="hide-toggle">
              <input
                type="checkbox"
                checked={hideSchoolWork}
                onChange={(e) => setHideSchoolWork(e.target.checked)}
              />
              Hide school and work
            </label>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : filteredEvents.length === 0 ? (
            <p className="muted">Nothing on the calendar this week.</p>
          ) : (
            <ul className="event-list">
              {filteredEvents.map((e) => (
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
          <div className="task-list-header">
            <h2>Task list</h2>
            <label className="hide-toggle">
              <input
                type="checkbox"
                checked={viewArchived}
                onChange={(e) => setViewArchived(e.target.checked)}
              />
              Show archived
            </label>
          </div>

          {!viewArchived && (
            <form onSubmit={addTask} className="task-form">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="Add a task"
              />
              <button type="submit">Add</button>
            </form>
          )}

          {tasks.length === 0 ? (
            <p className="muted">
              {viewArchived ? 'No archived tasks.' : 'No tasks yet.'}
            </p>
          ) : (
            <ul className="task-list">
              {tasks.map((t) => (
                <li key={t.id} className={t.completed ? 'done' : ''}>
                  <input
                    type="checkbox"
                    checked={t.completed}
                    disabled={viewArchived}
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
                  ) : t.email_id ? (
                    // Tasks created from a CFISD email's "Action Item"
                    // checkbox link back to that email.
                    <button
                      type="button"
                      className="task-title-link"
                      onClick={() => jumpToEmail(t.email_id)}
                      title="Open the email this task came from"
                    >
                      {t.title}
                    </button>
                  ) : (
                    <span>{t.title}</span>
                  )}
                  {t.assigned_to && <span className="assignee">{t.assigned_to}</span>}
                  <span className="task-date">{formatDateTime(t.created_at)}</span>

                  {!viewArchived && (
                    <>
                      {editingTaskId === t.id ? (
                        <button className="icon-btn" onClick={() => saveEditTask(t)} title="Save">
                          ✓
                        </button>
                      ) : (
                        <button className="icon-btn" onClick={() => startEditTask(t)} title="Edit">
                          ✎
                        </button>
                      )}
                      {t.completed && (
                        <button
                          className="icon-btn"
                          onClick={() => archiveTask(t)}
                          title="Archive"
                        >
                          🗄
                        </button>
                      )}
                    </>
                  )}

                  {viewArchived && (
                    <button
                      className="icon-btn"
                      onClick={() => unarchiveTask(t)}
                      title="Restore"
                    >
                      ↩
                    </button>
                  )}

                  <button className="icon-btn danger" onClick={() => deleteTask(t)} title="Delete permanently">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="emails-section">
        <div className="emails-header">
          <h2>Emails from CFISD</h2>
          <div className="emails-toolbar">
            <span className="viewed-summary">
              {viewedCount} of {emails.length} viewed
            </span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={viewedFilter} onChange={(e) => setViewedFilter(e.target.value)}>
              <option value="all">All Emails</option>
              <option value="viewed">List Viewed Emails</option>
              <option value="unviewed">List Unviewed Emails</option>
            </select>
            <label className="date-filter-label">
              From
              <input
                type="date"
                className="date-filter"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="date-filter-label">
              To
              <input
                type="date"
                className="date-filter"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
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
                {/* Displayed as "Viewed" — the Supabase column is still
                    named `checked` for now; a real rename is a separate
                    migration for later. */}
                <th>Viewed</th>
                <th>Action Item</th>
                <th>Calendar Item</th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedEmails.map((email) => (
                <>
                  <tr
                    key={email.id}
                    id={`email-row-${email.id}`}
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
                        onChange={(e) => handleViewedToggle(email, e.target.checked)}
                      />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!email.action_item}
                        onChange={(e) =>
                          handleActionItemToggle(email, e.target.checked)
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

      {calendarModalEmail && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3>Add to calendar</h3>
            <p className="modal-subject">{calendarModalEmail.subject}</p>

            <label className="modal-field">
              Calendar
              <select
                value={modalCalendarId}
                onChange={(e) => setModalCalendarId(e.target.value)}
              >
                {calendars.map((c) => (
                  <option key={c.calendarId} value={c.calendarId}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="modal-field">
              Date
              <input
                type="date"
                value={modalDate}
                onChange={(e) => setModalDate(e.target.value)}
              />
            </label>

            <label className="modal-field">
              Time (optional — leave blank for an all-day event)
              <input
                type="time"
                value={modalTime}
                onChange={(e) => setModalTime(e.target.value)}
              />
            </label>

            <label className="modal-field">
              Description
              <textarea
                rows={4}
                value={modalDescription}
                onChange={(e) => setModalDescription(e.target.value)}
                placeholder="Details for the calendar event…"
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={cancelAddToCalendar}>
                Cancel
              </button>
              <button type="button" className="modal-confirm" onClick={confirmAddToCalendar}>
                Add to calendar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
