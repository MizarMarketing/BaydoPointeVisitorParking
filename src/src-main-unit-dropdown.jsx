import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./style.css";

const API = import.meta.env.VITE_API_URL || "";
let supabase;
const cleanPlate = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const UNITS_BY_BUILDING = {
  "370 Clareview Station Dr NW": [...Array.from({ length: 18 }, (_, i) => String(101 + i)), ...[2,3,4,5,6].flatMap(f => Array.from({ length: 20 }, (_, i) => String(f * 100 + 1 + i)))],
  "374 Clareview Station Dr NW": [...Array.from({ length: 14 }, (_, i) => String(101 + i)), ...[2,3,4,5,6].flatMap(f => Array.from({ length: 16 }, (_, i) => String(f * 100 + 1 + i)))],
  "378 Clareview Station Dr NW": [...Array.from({ length: 18 }, (_, i) => String(101 + i)), ...[2,3,4,5,6].flatMap(f => Array.from({ length: 20 }, (_, i) => String(f * 100 + 1 + i)))],
};
const edmontonTime = (value) => new Date(value).toLocaleString("en-CA", {
  timeZone: "America/Edmonton", timeZoneName: "short",
});
const localNow = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
async function api(path, options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const r = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...options.headers,
    },
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || "Request failed");
  return b;
}

function Register() {
  const [settings, setSettings] = useState(null),
    [form, setForm] = useState({
      plate: "",
      email: "",
      building: "",
      unit_number: "",
      stall: "",
      start_at: localNow(),
      duration_hours: "",
    }),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/api/public/settings")
      .then(setSettings)
      .catch((e) => setMsg(e.message));
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          plate: cleanPlate(form.plate),
          start_at: new Date().toISOString(),
          duration_hours: Number(form.duration_hours),
        }),
      });
      setMsg("Registration successful. Please check your confirmation email.");
      setForm({
        plate: "",
        email: "",
        building: "",
        unit_number: "",
        stall: "",
        start_at: localNow(),
        duration_hours: "",
      });
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">BAYDO POINTE</span>
        <h1>Visitor Parking</h1>
        <p>
          Register your vehicle before parking. A confirmation and expiry
          reminder will be sent by text.
        </p>
      </section>
      <form className="card" onSubmit={submit}>
        <label>
          Licence plate
          <input
            required
            maxLength="12"
            placeholder="ABC 123"
            value={form.plate}
            onChange={(e) => setForm({ ...form, plate: e.target.value })}
          />
        </label>
        <div className="row">
          <label>Building<select required value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })}><option value="">Select building</option><option value="370 Clareview Station Dr NW">370 Clareview Station Dr NW</option><option value="374 Clareview Station Dr NW">374 Clareview Station Dr NW</option><option value="378 Clareview Station Dr NW">378 Clareview Station Dr NW</option></select></label>
          <label>Unit number<select required value={form.unit_number} disabled={!form.building} onChange={(e) => setForm({ ...form, unit_number: e.target.value })}><option value="">{form.building ? "Select unit" : "Select building first"}</option>{(UNITS_BY_BUILDING[form.building] || []).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        </div>
        <label>
          Email address
          <input
            required
            type="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Visitor parking stall
          <select
            required
            value={form.stall}
            onChange={(e) => setForm({ ...form, stall: e.target.value })}
          >
            <option value="">Select a stall</option>
            {settings?.stalls?.map((s) => (
              <option key={s} value={s}>
                Visitor {s}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Start time (Edmonton)
            <input
              required
              type="datetime-local"
              readOnly
              value={form.start_at}
              onChange={(e) => setForm({ ...form, start_at: e.target.value })}
            />
          </label>
          
          <label>
            Parking duration
            <select
              required
              value={form.duration_hours}
              onChange={(e) => setForm({ ...form, duration_hours: e.target.value })}
            >
              <option value="">Select duration</option>
              {settings?.duration_options?.map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>
          </label>
        </div>
        <label className="agree">
          <input required type="checkbox" /> I confirm the information is
          correct and consent to parking-related email messages.
        </label>
        <button disabled={busy}>
          {busy ? "Registering…" : "Register vehicle"}
        </button>
        {msg && <div className="message">{msg}</div>}
        <small>
          Maximum stay and usage limits apply. Vehicles may be towed if
          registration details are invalid or expired.
        </small>
      </form>
      <ExtendParking options={settings?.duration_options || []} />
      <a className="admin-link" href="/admin">
        Staff login
      </a>
    </main>
  );
}

function ExtendParking({ options }) {
  const [form, setForm] = useState({ email: "", plate: "", confirmation_code: "", hours: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await api("/api/extend", { method: "POST", body: JSON.stringify(form) });
      setMessage(`Parking extended. New expiry: ${edmontonTime(result.end_at)}.${result.email_sent ? " Confirmation email sent." : " Email could not be sent; your extension is saved."}`);
      setForm({ ...form, hours: "" });
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <details className="card"><summary>Extend parking time</summary>
    <p>Additional hours are added to your current expiry. Total stay and rolling-period limits still apply.</p>
    <form onSubmit={submit}>
      <label>Email<input required type="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label>
      <label>Licence plate<input required maxLength={12} value={form.plate} onChange={e => setForm({...form,plate:e.target.value})}/></label>
      <label>Confirmation number<input required value={form.confirmation_code} onChange={e => setForm({...form,confirmation_code:e.target.value})}/></label>
      <label>Additional hours<select required value={form.hours} onChange={e => setForm({...form,hours:e.target.value})}><option value="">Select duration</option>{options.map(h => <option key={h} value={h}>{h} hours</option>)}</select></label>
      <button disabled={busy}>{busy ? "Extending…" : "Extend parking"}</button>
      {message && <p role="status">{message}</p>}
    </form></details>;
}

function PasswordChange({ onComplete }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      await api("/api/admin/password-changed", { method: "POST" });
      await onComplete();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shell narrow">
      <section className="hero">
        <span className="eyebrow">SECURITY UPDATE</span>
        <h1>Change password</h1>
        <p>
          Your staff password must be changed every 180 days before you can
          access the dashboard.
        </p>
      </section>
      <form className="card" onSubmit={submit}>
        <label>
          New password
          <input
            required
            minLength="10"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            required
            minLength="10"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button disabled={busy}>
          {busy ? "Updating…" : "Change password"}
        </button>
        {error && <div className="message error">{error}</div>}
        <button
          type="button"
          className="text-button"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </form>
    </main>
  );
}

function Admin() {
  const [session, setSession] = useState(null),
    [checked, setChecked] = useState(true),
    [mustChange, setMustChange] = useState(false),
    [recovery, setRecovery] = useState(false),
    [forgot, setForgot] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [rows, setRows] = useState([]),
    [settings, setSettings] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setChecked(!data.session);
      })
      .catch((e) => {
        setError(e.message);
        setChecked(true);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setChecked(!s);
    });
    return () => subscription.unsubscribe();
  }, []);
  const checkSession = async () => {
    if (!session) {
      setChecked(true);
      return;
    }
    try {
      const result = await api("/api/admin/session");
      setMustChange(result.password_change_required);
      setError("");
    } catch (e) {
      setError(e.message);
      await supabase.auth.signOut();
    } finally {
      setChecked(true);
    }
  };
  const load = async () => {
    try {
      const [r, s] = await Promise.all([
        api("/api/admin/registrations"),
        api("/api/admin/settings"),
      ]);
      setRows(r.registrations);
      setSettings(s);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    checkSession();
  }, [session]);
  useEffect(() => {
    if (session && checked && !mustChange) load();
  }, [session, checked, mustChange]);
  if (!checked)
    return (
      <main className="shell narrow">
        <section className="hero">
          <span className="eyebrow">STAFF PORTAL</span>
          <h1>Checking access…</h1>
        </section>
      </main>
    );
  if (forgot && !session)
    return (
      <main className="shell narrow">
        <section className="hero"><span className="eyebrow">STAFF PORTAL</span><h1>Reset password</h1><p>Enter your staff email and we’ll send a reset link.</p></section>
        <form className="card" onSubmit={async (e) => { e.preventDefault(); setError(""); const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` }); if (resetError) setError(resetError.message); else setError("Reset email sent. Check your inbox."); }}>
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button>Send reset email</button>
          <button type="button" className="text-button" onClick={() => setForgot(false)}>Back to sign in</button>
          {error && <div className="message">{error}</div>}
        </form>
      </main>
    );
  if (!session)
    return (
      <main className="shell narrow">
        <section className="hero">
          <span className="eyebrow">STAFF PORTAL</span>
          <h1>Parking Admin</h1>
          <p>Authorized staff only.</p>
        </section>
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const { error: loginError } =
              await supabase.auth.signInWithPassword({ email, password });
            if (loginError) setError(loginError.message);
          }}
        >
          <label>
            Email
            <input
              required
              autoComplete="username"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button>Sign in</button>
          <button type="button" className="text-button" onClick={() => setForgot(true)}>Forgot password?</button>
          {error && <div className="message error">{error}</div>}
        </form>
      </main>
    );
  if (recovery)
    return <PasswordChange onComplete={async () => { setRecovery(false); await load(); }} />;
  if (mustChange)
    return (
      <PasswordChange
        onComplete={async () => {
          setMustChange(false);
          await load();
        }}
      />
    );
  const save = async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      await load();
    } catch (x) {
      setError(x.message);
    }
  };
  return (
    <main className="dashboard">
      <header>
        <div>
          <span className="eyebrow">BAYDO POINTE</span>
          <h1>Visitor Parking</h1>
        </div>
        <div>
          <button
            className="secondary"
            onClick={() =>
              (location.href =
                API + "/api/admin/export?token=" + session.access_token)
            }
          >
            Download CSV
          </button>{" "}
          <button className="secondary" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <section className="stats">
        <div>
          <b>{rows.filter((x) => new Date(x.end_at) > new Date()).length}</b>
          <span>Active vehicles</span>
        </div>
        <div>
          <b>{settings?.stall_count || 0}</b>
          <span>Visitor stalls</span>
        </div>
        <div>
          <b>{rows.length}</b>
          <span>Records shown</span>
        </div>
      </section>
      {settings && (
        <form className="settings" onSubmit={save}>
          <h2>Parking rules</h2>
          <label>
            Number of stalls
            <input
              type="number"
              min="1"
              value={settings.stall_count}
              onChange={(e) =>
                setSettings({ ...settings, stall_count: +e.target.value })
              }
            />
          </label>
          <label>
            Available duration options (hours)
            <input
              value={(settings.duration_options || []).join(", ")}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  duration_options: e.target.value
                    .split(",")
                    .map((v) => Number(v.trim()))
                    .filter(Boolean),
                })
              }
            />
            <small>Example: 2, 4, 8, 24</small>
          </label>
          <label>
            Maximum stay (hours)
            <input
              type="number"
              min="1"
              value={settings.max_stay_hours}
              onChange={(e) =>
                setSettings({ ...settings, max_stay_hours: +e.target.value })
              }
            />
          </label>
          <label>
            Rolling period (days)
            <input
              type="number"
              min="1"
              value={settings.rolling_days}
              onChange={(e) =>
                setSettings({ ...settings, rolling_days: +e.target.value })
              }
            />
          </label>
          <label>
            Maximum parked days
            <input
              type="number"
              min="1"
              value={settings.max_days_in_period}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_days_in_period: +e.target.value,
                })
              }
            />
          </label>
          <button>Save rules</button>
        </form>
      )}
      <section className="table-card">
        <h2>Registration list</h2>
        {error && <div className="message error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Plate</th>
                <th>Stall</th>
                <th>Phone</th>
                <th>Start (Edmonton)</th>
                <th>End (Edmonton)</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span
                      className={
                        new Date(r.end_at) > new Date() ? "pill active" : "pill"
                      }
                    >
                      {new Date(r.end_at) > new Date() ? "Active" : "Expired"}
                    </span>
                  </td>
                  <td>
                    <b>{r.plate}</b>
                  </td>
                  <td>{r.stall_number}</td>
                  <td>{r.email}</td>
                  <td>{edmontonTime(r.start_at)}</td>
                  <td>{edmontonTime(r.end_at)}</td>
                  <td>{r.confirmation_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
async function start() {
  const r = await fetch(API + "/api/public/config");
  const c = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(c.error || "Unable to load application configuration.");
  supabase = createClient(c.supabase_url, c.supabase_anon_key);
  createRoot(document.getElementById("root")).render(
    location.pathname.startsWith("/admin") ? <Admin /> : <Register />,
  );
}
start().catch((e) =>
  createRoot(document.getElementById("root")).render(
    <main className="shell narrow">
      <section className="hero">
        <span className="eyebrow">CONFIGURATION ERROR</span>
        <h1>Unable to start</h1>
        <p>{e.message}</p>
      </section>
    </main>,
  ),
);

