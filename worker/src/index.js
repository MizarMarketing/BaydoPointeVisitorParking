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
async function email(env, to, subject, html) {
  const functionUrl = env.SUPABASE_EMAIL_FUNCTION_URL;
  if (!functionUrl) return;
  const r = await fetch(functionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  if (!r.ok) throw new Error("Email delivery failed.");
}
async function settings(env) {
  const r = await sb(env, "parking_settings?id=eq.1&select=*");
  return r[0];
}
async function register(env, request) {
  const x = await request.json(),
    plate = normalizePlate(x.plate),
    phone = normalizePhone(x.phone),
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
  if (!["370 Clareview Station Dr NW", "374 Clareview Station Dr NW", "378 Clareview Station Dr NW"].includes(building)) throw new Error("Select a building.");
  if (!unit_number) throw new Error("Enter a unit number.");
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
  await sms(
    env,
    phone,
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
      await sms(
        env,
        r.phone,
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

