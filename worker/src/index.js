const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const cors = (env) => ({
  "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
});
const normalizePlate = (v) =>
  String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const normalizePhone = (v) => {
  let p = String(v || "").replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(p)) p = "+1" + p;
  if (!/^\+1\d{10}$/.test(p))
    throw new Error("Enter a valid Canadian or US mobile number.");
  return p;
};
async function sb(
  env,
  path,
  { method = "GET", body, token, service = true } = {},
) {
  const key = service ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (!String(key || "").startsWith("sb_"))
    headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text()) || "Database request failed");
  return r.status === 204 ? null : r.json();
}
async function admin(env, request, url, { allowExpired = false } = {}) {
  let token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ||
    url.searchParams.get("token");
  if (!token) throw new Error("Staff login required.");
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!r.ok) throw new Error("Your staff session has expired.");
  const user = await r.json();
  const p = await sb(
    env,
    `profiles?id=eq.${user.id}&select=role,password_changed_at`,
    {},
  );
  if (!p[0] || !["admin", "manager"].includes(p[0].role))
    throw new Error("Admin access required.");
  const passwordChangeRequired =
    !p[0].password_changed_at ||
    Date.now() - new Date(p[0].password_changed_at).getTime() >= 180 * 864e5;
  if (passwordChangeRequired && !allowExpired)
    throw new Error("Password change required before accessing the dashboard.");
  return { user, profile: p[0], passwordChangeRequired };
}
async function sendEmail(env, to, subject, html) {
  const functionUrl = env.SUPABASE_EMAIL_FUNCTION_URL;
  if (!functionUrl) throw new Error("Email is not configured.");
  const target = new URL(functionUrl);
  if (target.origin !== new URL(env.SUPABASE_URL).origin ||
      target.pathname !== "/functions/v1/send-parking-email" ||
      target.protocol !== "https:") throw new Error("Invalid email function URL.");
  const token = env.SUPABASE_EMAIL_SERVICE_JWT || env.SUPABASE_SERVICE_ROLE_KEY;
  let claims;
  try { claims = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { throw new Error("Set SUPABASE_EMAIL_SERVICE_JWT to the legacy service_role JWT in Worker Secrets."); }
  if (claims.role !== "service_role") throw new Error("Email requires a service_role JWT.");
  const r = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: token,
    },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!r.ok) throw new Error(`Email delivery failed (HTTP ${r.status}).`);
}
async function settings(env) {
  const r = await sb(env, "parking_settings?id=eq.1&select=*");
  return r[0];
}
async function register(env, request) {
  const x = await request.json(),
    plate = normalizePlate(x.plate),
    phone = null,
    email = String(x.email || "").trim().toLowerCase(),
    building = String(x.building || "").trim(),
    unit_number = String(x.unit_number || "").trim(),
    stall = Number(x.stall),
    start = new Date(),
    duration = Number(x.duration_hours),
    end = x.end_at
      ? new Date(x.end_at)
      : new Date(start.getTime() + duration * 36e5),
    now = new Date();
  if (plate.length < 2) throw new Error("Enter a valid licence plate.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!building || !unit_number) throw new Error("Building and unit number are required.");
  if (!Number.isInteger(stall))
    throw new Error("Select a visitor parking stall.");
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new Error("Select a valid start and end time.");
  if (start < new Date(now.getTime() - 15 * 60000))
    throw new Error("Start time cannot be in the past.");
  const cfg = await settings(env);
  const durations = Array.isArray(cfg.duration_options)
    ? cfg.duration_options.map(Number)
    : [2, 4, 8, 24];
  if (!durations.includes(duration))
    throw new Error("Select one of the available parking durations.");
  if (stall < 1 || stall > cfg.stall_count)
    throw new Error("That visitor stall does not exist.");
  if ((end - start) / 36e5 > cfg.max_stay_hours)
    throw new Error(
      `A registration can be no longer than ${cfg.max_stay_hours} hours.`,
    );
  const overlap = await sb(
    env,
    `parking_registrations?stall_number=eq.${stall}&status=eq.active&start_at=lt.${encodeURIComponent(end.toISOString())}&end_at=gt.${encodeURIComponent(start.toISOString())}&select=id`,
  );
  if (overlap.length)
    throw new Error(
      "That stall is already registered during the selected time.",
    );
  const since = new Date(
    start.getTime() - cfg.rolling_days * 864e5,
  ).toISOString();
  const prior = await sb(
    env,
    `parking_registrations?plate=eq.${encodeURIComponent(plate)}&start_at=gte.${encodeURIComponent(since)}&status=eq.active&select=start_at,end_at`,
  );
  const priorHours = prior.reduce(
    (n, r) => n + (new Date(r.end_at) - new Date(r.start_at)) / 36e5,
    0,
  );
  if (priorHours + (end - start) / 36e5 > cfg.max_days_in_period * 24)
    throw new Error(
      `This vehicle exceeds the ${cfg.max_days_in_period}-day limit within ${cfg.rolling_days} days.`,
    );
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();
  await sb(env, "parking_registrations", {
    method: "POST",
    body: {
      plate,
      phone,
      email,
      building,
      unit_number,
      stall_number: stall,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      confirmation_code: code,
    },
  });
  await sendEmail(
    env,
    email,
    "Parking registration confirmed",
    `Baydo Pointe visitor parking registered. Plate ${plate}, stall ${stall}, valid until ${end.toLocaleString("en-CA", { timeZone: "America/Edmonton" })}. Confirmation ${code}.`,
  );
  return { confirmation_code: code };
}
async function reminders(env) {
  const mins = Number(env.REMINDER_MINUTES || 60),
    now = new Date(),
    until = new Date(now.getTime() + mins * 60000);
  const due = await sb(
    env,
    `parking_registrations?status=eq.active&reminder_sent_at=is.null&end_at=gt.${encodeURIComponent(now.toISOString())}&end_at=lte.${encodeURIComponent(until.toISOString())}&select=*`,
  );
  for (const r of due) {
    try {
      await sendEmail(
        env,
        r.email,
        "Parking expires soon",
        `Reminder: visitor parking for ${r.plate}, stall ${r.stall_number}, expires at ${new Date(r.end_at).toLocaleString("en-CA", { timeZone: "America/Edmonton" })}.`,
      );
      await sb(env, `parking_registrations?id=eq.${r.id}`, {
        method: "PATCH",
        body: { reminder_sent_at: new Date().toISOString() },
      });
    } catch (e) {
      console.error(e);
    }
  }
  await sb(
    env,
    `parking_registrations?status=eq.active&end_at=lt.${encodeURIComponent(now.toISOString())}`,
    { method: "PATCH", body: { status: "expired" } },
  );
}
const csvCell = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
async function extendParking(env, request) {
  const x = await request.json();
  const plate = normalizePlate(x.plate);
  const address = String(x.email || "").trim().toLowerCase();
  const code = String(x.confirmation_code || "").trim().toUpperCase();
  const hours = Number(x.hours);
  if (!plate || !address || !code) throw new Error("Email, plate and confirmation number are required.");
  const records = await sb(env, `parking_registrations?plate=eq.${encodeURIComponent(plate)}&confirmation_code=eq.${encodeURIComponent(code)}&select=*`);
  const r = records.find(v => String(v.email || "").toLowerCase() === address);
  if (!r) throw new Error("Registration details do not match.");
  const now = Date.now(), oldEnd = Date.parse(r.end_at), start = Date.parse(r.start_at);
  if (r.status !== "active" || oldEnd <= now) throw new Error("Expired registrations cannot be extended.");
  const cfg = await settings(env);
  if (!Number.isFinite(hours) || hours <= 0 || !(cfg.duration_options || [2,4,8,24]).map(Number).includes(hours)) throw new Error("Select an available duration.");
  const end = oldEnd + hours * 36e5;
  if (end - start > cfg.max_stay_hours * 36e5) throw new Error("Total parking time exceeds Maximum stay.");
  const overlap = await sb(env, `parking_registrations?id=neq.${r.id}&stall_number=eq.${r.stall_number}&status=eq.active&start_at=lt.${encodeURIComponent(new Date(end).toISOString())}&end_at=gt.${encodeURIComponent(r.end_at)}&select=id`);
  if (overlap.length) throw new Error("This stall is reserved during the extended time.");
  const windowMs = cfg.rolling_days * 864e5;
  const history = await sb(env, `parking_registrations?plate=eq.${encodeURIComponent(plate)}&status=neq.cancelled&end_at=gt.${encodeURIComponent(new Date(start-windowMs).toISOString())}&select=id,start_at,end_at`);
  const intervals = history.filter(v => v.id !== r.id).map(v => [Date.parse(v.start_at),Date.parse(v.end_at)]);
  intervals.push([start,end]);
  const checkpoints = intervals.flatMap(([a,b]) => [b,a+windowMs]);
  for (const t of checkpoints) {
    const usage = intervals.reduce((n,[a,b]) => n + Math.max(0,Math.min(b,t)-Math.max(a,t-windowMs)),0);
    if (usage > cfg.max_days_in_period * 864e5) throw new Error("Extension exceeds the rolling-period parking allowance.");
  }
  const updated = await sb(env, `parking_registrations?id=eq.${r.id}&end_at=eq.${encodeURIComponent(r.end_at)}&status=eq.active`, {method:"PATCH",body:{end_at:new Date(end).toISOString(),reminder_sent_at:null}});
  if (!updated?.length) throw new Error("Registration changed. Please refresh before trying again.");
  let email_sent = true;
  try { await sendEmail(env,address,"Parking time extended",`Your parking has been extended. New expiry: ${new Date(end).toISOString()}. Confirmation: ${code}`); }
  catch { email_sent = false; }
  return {end_at:new Date(end).toISOString(),email_sent};
}
export default {
  async fetch(request, env) {
    const h = cors(env);
    if (request.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/public/config") {
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
          throw new Error("Supabase runtime variables are not configured.");
        return json(
          {
            supabase_url: env.SUPABASE_URL,
            supabase_anon_key: env.SUPABASE_ANON_KEY,
          },
          200,
          h,
        );
      }
      if (url.pathname === "/api/public/settings") {
        const s = await settings(env);
        return json(
          {
            stalls: Array.from({ length: s.stall_count }, (_, i) => i + 1),
            max_stay_hours: s.max_stay_hours,
            duration_options: s.duration_options || [2, 4, 8, 24],
          },
          200,
          h,
        );
      }
      if (url.pathname === "/api/register" && request.method === "POST")
        return json(await register(env, request), 201, h);
      if (url.pathname === "/api/extend" && request.method === "POST")
        return json(await extendParking(env, request), 200, h);
      if (url.pathname === "/api/admin/session") {
        const a = await admin(env, request, url, { allowExpired: true });
        return json(
          {
            role: a.profile.role,
            password_change_required: a.passwordChangeRequired,
            password_changed_at: a.profile.password_changed_at,
          },
          200,
          h,
        );
      }
      if (
        url.pathname === "/api/admin/password-changed" &&
        request.method === "POST"
      ) {
        const a = await admin(env, request, url, { allowExpired: true });
        await sb(env, `profiles?id=eq.${a.user.id}`, {
          method: "PATCH",
          body: { password_changed_at: new Date().toISOString() },
        });
        return json({ ok: true }, 200, h);
      }
      if (url.pathname.startsWith("/api/admin/"))
        await admin(env, request, url);
      if (url.pathname === "/api/admin/registrations") {
        const from =
          url.searchParams.get("from") ||
          new Date(Date.now() - 365 * 864e5).toISOString();
        const rows = await sb(
          env,
          `parking_registrations?created_at=gte.${encodeURIComponent(from)}&select=*&order=start_at.desc&limit=5000`,
        );
        return json({ registrations: rows }, 200, h);
      }
      if (url.pathname === "/api/admin/settings" && request.method === "GET")
        return json(await settings(env), 200, h);
      if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
        const x = await request.json();
        const safe = {
          stall_count: Number(x.stall_count),
          max_stay_hours: Number(x.max_stay_hours),
          rolling_days: Number(x.rolling_days),
          max_days_in_period: Number(x.max_days_in_period),
          duration_options: [
            ...new Set(
              (Array.isArray(x.duration_options)
                ? x.duration_options
                : String(x.duration_options || "").split(",")
              )
                .map(Number)
                .filter((v) => Number.isInteger(v) && v > 0 && v <= 168),
            ),
          ].sort((a, b) => a - b),
          updated_at: new Date().toISOString(),
        };
        if (
          Object.values(safe)
            .slice(0, 4)
            .some((v) => !Number.isInteger(v) || v < 1) ||
          !safe.duration_options.length
        )
          throw new Error("All parking rules must be positive whole numbers.");
        const r = await sb(env, "parking_settings?id=eq.1", {
          method: "PATCH",
          body: safe,
        });
        return json(r[0], 200, h);
      }
      if (url.pathname === "/api/admin/export") {
        const rows = await sb(
          env,
          "parking_registrations?select=*&order=start_at.desc&limit=50000",
        );
        const cols = [
          "plate",
          "stall_number",
          "phone",
          "start_at",
          "end_at",
          "status",
          "confirmation_code",
          "created_at",
        ];
        const body = [
          cols.join(","),
          ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
        ].join("\n");
        return new Response(body, {
          headers: {
            ...h,
            "content-type": "text/csv",
            "content-disposition":
              'attachment; filename="visitor-parking-records.csv"',
          },
        });
      }
      return json({ error: "Not found" }, 404, h);
    } catch (e) {
      return json({ error: e.message || "Unexpected error" }, 400, h);
    }
  },
  async scheduled(_, env) {
    await reminders(env);
  },
};
