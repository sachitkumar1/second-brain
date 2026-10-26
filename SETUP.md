# Setup guide

About an hour end to end. Steps 1–4 get the dashboard online and let you sign in; the rest connect your accounts.
Everything after step 4 can be done in any order, and the dashboard works with whatever you've connected so far.

| Step | What | Time |
|---|---|---|
| 1 | Deploy to Vercel | 5 min |
| 2 | Create the database | 2 min |
| 3 | Google sign-in (OAuth client) | 10 min |
| 4 | Secrets and email sending, then sign in | 10 min |
| 5 | Connect Gmail, Calendar, Drive | 5 min |
| 6 | Classes: bCourses, Gradescope, Ed, course sites | 10 min |
| 7 | Slack | 5 min per workspace |
| 8 | Scheduler (every 10 minutes) | 3 min |
| 9 | Mac agent: iMessage and Instagram reply queue | 10 min |
| 10 | AI agent | 2 min |

---

## 1. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new), import this GitHub repository, and keep the defaults (Framework: Next.js).
2. Click **Deploy**. The first deploy finishes, but the site shows an error until steps 2–4 are done. That's expected.
3. Note your URL, e.g. `https://second-brain-sachit.vercel.app`. Below it's called `APP`.

## 2. Create the database

Use a personal database, not the Project RISHI Supabase organization: other members of that org could read it.

**Easiest:** in your Vercel project → **Storage** → **Create Database** → **Neon** (free) → connect it to this project.
Vercel adds `DATABASE_URL` for you. The schema is created automatically on every deploy.

(Alternative: a free project in a *personal* Supabase organization. Copy the "Transaction pooler" connection string
from Project Settings → Database and set it as `DATABASE_URL`.)

## 3. Google sign-in (OAuth client)

You sign in to the dashboard with Google, and only **sachitkumar2025@gmail.com** and **sachitk@berkeley.edu** are let in.
Any other Google account is turned away, and there's no password to leak.
The same OAuth client is also used later to read Gmail, Calendar and Drive.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project named **Apollo**.
2. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**, and **Google Drive API** (used in step 5).
3. **Google Auth Platform → Branding / Audience** (the "OAuth consent screen"): User type **External**, app name "Apollo",
   your email as support and developer contact. Under **Audience**, click **Publish app** so it's *In production*.
   (In "Testing" mode Google expires connected accounts every 7 days.) You don't need Google's verification for personal use.
4. **Clients → Create client → Web application**. Add **both** authorized redirect URIs:
   - `APP/api/auth/google/callback` (signing in to the dashboard)
   - `APP/api/oauth/google/callback` (connecting Gmail, Calendar and Drive)

   For local development, also add `http://localhost:3000/api/auth/google/callback` and `http://localhost:3000/api/oauth/google/callback`.
5. In Vercel → Project → **Settings → Environment Variables**, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the client you created.

To change who can sign in, set `ALLOWED_EMAILS` to a comma-separated list (it defaults to the two addresses above).
Removing an address signs that account out on its next request.

## 4. Secrets and email sending, then sign in

In Vercel → Project → **Settings → Environment Variables**, add the following (all environments):

| Variable | Value |
|---|---|
| `SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Run `npm install && npm run secrets` locally and paste the output. |
| `GMAIL_SENDER` | `sachitagent29@gmail.com` |
| `GMAIL_APP_PASSWORD` | See below |
| `DEFAULT_NOTIFY_EMAIL` | `sachitkumar2025@gmail.com` (changeable later in Settings) |

**Gmail app password for sachitagent29@gmail.com:** sign in to that account → [myaccount.google.com/security](https://myaccount.google.com/security) →
turn on **2-Step Verification** → open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → create one named
"Apollo" → paste the 16-character password (without spaces) as `GMAIL_APP_PASSWORD`.

Then **Deployments → ⋯ → Redeploy**. Open `APP` → **Sign in with Google** with either allowed account →
**Settings → General → Send a test email**.

> `ENCRYPTION_KEY` encrypts every stored token and password. If you change it later, reconnect your accounts.
> Changing `SESSION_SECRET` signs you out everywhere.

## 5. Connect Gmail, Calendar, Drive

Signing in only proves who you are. To bring in email, calendar and files, connect each Google account
(personal Gmail, berkeley.edu, …) under **Settings → Connections → Google → Connect a Google account**.
Google shows "Google hasn't verified this app"; click **Advanced → Go to Apollo**. Access is read-only.

Every calendar on the account is synced. Choose which ones appear under **Settings → Calendars** or the **Calendars** menu on the
Today and Week ahead widgets. Calendars you've unchecked in Google Calendar start out hidden.

**If your berkeley.edu account is blocked** ("Access blocked: your institution's admin needs to review…"):
- Email: in bMail, **Settings → Forwarding and POP/IMAP → Add a forwarding address** → your connected Gmail.
- Calendar: in Berkeley Google Calendar, open the calendar's **Settings → Integrate calendar → Secret address in iCal format**,
  and add that link under **Settings → Connections → Calendar feed**.

Signing in to the dashboard with sachitk@berkeley.edu only asks Google for your name and email, which Berkeley normally allows
even when it blocks Gmail access. If it's blocked too, sign in with sachitkumar2025@gmail.com.

## 6. Classes

All under **Settings → Connections**:

- **bCourses (Canvas):** bCourses → **Account → Settings → + New Access Token** (purpose "Apollo", no expiry or end of semester).
  Brings in assignments with due dates and submission status, announcements, grades and bCourses messages.
- **Gradescope:** has no API, so the dashboard signs in as you. If you log in with "School Credentials", go to gradescope.com → **Log In →
  Forgot your password?** with your berkeley.edu email to set a password once. Brings in assignments, due dates, submission status and scores.
- **Ed Discussion:** [edstem.org/us/settings/api-tokens](https://edstem.org/us/settings/api-tokens) → create a token. Brings in announcements,
  pinned threads and staff posts.
- **Course websites:** add each class site (e.g. the DATA 100 or MATH 110 page). It's checked hourly. New text becomes a Class update,
  and the agent summarizes it and pulls out any deadlines.
- **Calendar feeds:** course Google Calendars, club calendars, or the [UC Berkeley academic calendar](https://registrar.berkeley.edu/calendar/).
- **Pensieve and CalCentral** can't be connected directly: there's no API, and CalNet requires Duo. Their notification emails are recognized
  in Gmail and shown under Classes, so make sure those notifications go to a connected inbox.

## 7. Slack

For each workspace:

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From an app manifest** → pick the workspace → paste
   [`slack-app-manifest.yml`](slack-app-manifest.yml) → Create.
2. **Install to Workspace** → Allow. Some workspaces require admin approval.
3. **OAuth & Permissions** → copy the **User OAuth Token** (`xoxp-…`).
4. Dashboard → **Settings → Connections → Slack workspace** → paste it. Then click **Choose channels…** on the new connection and
   tick the announcement channels you care about.

You'll get @-mentions, the chosen channels, and a list of DMs waiting on your reply.

## 8. Scheduler

Everything (syncing, reminders, alerts, the morning digest) runs from one endpoint that should be called every 10 minutes.
Vercel's free plan only runs cron once a day (`vercel.json` includes that as a fallback), so use a free external scheduler:

1. Sign up at [cron-job.org](https://cron-job.org) (free).
2. **Create cronjob**: URL `APP/api/cron/tick`, schedule **every 10 minutes**.
3. **Advanced → Headers**: add `Authorization` = `Bearer <your CRON_SECRET>`.
4. Save, then click **Test run**. You should get HTTP 200 with a JSON summary.

**Settings → System** shows a green "Scheduler running" once it's working, plus a log of recent runs.

## 9. Mac agent: iMessage and Instagram

The reply queue needs a small script on your Mac, because iMessage data only exists there.

1. Install Node.js 22.13 or newer: `brew install node`.
2. Dashboard → **Settings → Mac agent → Pair your Mac**. Copy the token and run the commands it shows:
   ```bash
   mkdir -p ~/apollo-agent && curl -fsSL APP/agent/apollo-agent.mjs -o ~/apollo-agent/apollo-agent.mjs
   node ~/apollo-agent/apollo-agent.mjs setup     # paste the token; choose an encryption passphrase
   node ~/apollo-agent/apollo-agent.mjs doctor    # checks permissions
   node ~/apollo-agent/apollo-agent.mjs run --dry-run   # prints who you owe a reply, uploads nothing
   node ~/apollo-agent/apollo-agent.mjs install   # runs every 10 minutes from now on
   ```
3. **Full Disk Access:** macOS protects the Messages database. `install` prints the exact Node path; add it in
   **System Settings → Privacy & Security → Full Disk Access → +** (press ⌘⇧G and paste the path). Do the same for your
   Terminal app so manual `run` and `doctor` work.
4. On the dashboard, the Reply queue asks for your passphrase once. Tick "Remember on this device" if you like.

**Instagram.** Instagram has no API for personal accounts, so the agent reads Instagram's official data export:
Instagram app → **Settings → Accounts Center → Your information and permissions → Download your information → Download or transfer
information** → your account → **Some of your information → Messages** → **Download to device** → date range **Last month**,
format **JSON**, media quality **Low** → Create files. When the email arrives, download the zip into `~/Downloads`. The agent finds it
and unzips it locally. Exports are snapshots, so redo this weekly (or whenever you want it fresh).
For live data with an Instagram *professional* (creator) account, see [agent/README.md](agent/README.md#instagram-api-optional).

See [How the reply queue stays private](README.md#privacy-and-security) for what is and isn't uploaded.

## 10. AI agent

Create an API key at [console.anthropic.com](https://console.anthropic.com) → **API keys** and set it as `ANTHROPIC_API_KEY`, then redeploy.

The agent reads new emails, announcements, Ed posts, Slack posts and course-site changes. For each one it writes a one-line summary,
rates importance, creates reminders for things you need to do (shown under **Reminders → From your agent**), and emails you right
away about anything urgent. It also writes the "top priorities" section of the morning digest.

It uses `claude-opus-5-5` by default. Expect roughly $10–25/month depending on email volume.
To spend less, set `AI_MODEL=claude-haiku-5-5`: about 1/40th of the cost, with somewhat less nuanced triage.
You can also turn off AI for email or Slack in **Settings → General**.

---

## Local development

```bash
npm install
cp .env.example .env.local                 # DATABASE_URL (a local Postgres works), the secrets, and the Google client
npm run db:migrate
npx tsx scripts/seed-demo.ts               # optional: realistic sample data (reply-queue passphrase: "demo passphrase")
npm run dev
```

Signing in locally needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and the localhost redirect URIs from step 3.
Set `EMAIL_DUMP_DIR=./.email-dump` in `.env.local` to write emails to disk instead of sending them.
Run tests with `npm test`. Set `TEST_DATABASE_URL` to an empty Postgres database to include the integration tests.
