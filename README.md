# Baydo Pointe Visitor Parking

Production-ready starter for a public visitor registration page and a protected staff dashboard.

## Included

- Plate, mobile number, visitor stall, start and end time registration
- Confirmation and pre-expiry SMS via Twilio
- Stall conflict checks and per-vehicle rolling usage limits
- Admin-adjustable stall count and parking rules
- One-year dashboard view and full CSV export
- Cloudflare scheduled job every 10 minutes for reminders
- Supabase Auth for staff and service-role-only access to parking records
- Mandatory staff email/password sign-in and a 180-day password rotation policy enforced by both the dashboard and Worker API

## 1. Supabase

Create a Supabase project, open **SQL Editor**, and run `supabase/schema.sql`. In Authentication, create a staff user. Then run the final commented `update` statement with that user's email to give them the `admin` role.

Copy the project URL, anon key, and service role key from Supabase project settings. Never place the service role key in the frontend.

## 2. Twilio

Create a Canadian SMS-capable Twilio number. Obtain the Account SID, Auth Token, and sending number. Trial accounts can normally text only verified recipient numbers.

## 3. Combined Cloudflare Worker

The Worker serves the Vite frontend at `/`, the protected dashboard at `/admin`, and the API at `/api/*`. Install dependencies with `npm install`. Update `SUPABASE_URL` and `ALLOWED_ORIGIN` in `wrangler.toml`, then add secrets:

```bash
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER
npm run build
npm run worker:deploy
```

Because the frontend and API share one origin, `VITE_API_URL` may be left blank. The Worker URL is the public application URL.

## 4. Frontend on Cloudflare Pages

Set these Pages environment variables:

```text
VITE_API_URL=https://YOUR-WORKER.workers.dev
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Use build command `npm run build` and output directory `dist`. Change `ALLOWED_ORIGIN` in `wrangler.toml` to the final Pages/custom-domain origin and redeploy the Worker.

## Important production notes

- SMS timestamps use Edmonton time. Change `America/Edmonton` in the Worker if this property is elsewhere.
- Records remain in Supabase indefinitely; the dashboard defaults to the latest year. This ensures the promised one-year retention. Add an archive/deletion policy if records must be removed after exactly one year.
- For abuse protection, enable Cloudflare Turnstile or a WAF rate-limit rule before advertising the public URL.
- Canadian SMS consent and privacy wording should be reviewed for your building's actual policy before launch.
