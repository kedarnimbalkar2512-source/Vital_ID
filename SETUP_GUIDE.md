# VitalID: step-by-step setup guide

This guide takes you from nothing to the app running on your laptop with real Supabase and Groq.
Plan for about 45 minutes the first time. Commands are shown for **Windows (PowerShell)** and **Mac/Linux** where they differ.

> Never share or commit your keys. They go only into the two `.env` files in Step 5, and git already ignores those files.

---

## Step 0: Install the tools (one time)

| Tool | Version | Get it from | Check it worked |
|---|---|---|---|
| Node.js | 18 or newer (20 LTS is best) | nodejs.org → "LTS" installer | `node -v` |
| Python | 3.11 or newer | python.org/downloads. **Windows:** tick "Add python.exe to PATH" on the first installer screen | `python --version` (Mac: `python3 --version`) |
| VS Code (optional) | any | code.visualstudio.com | |

Open a new terminal after installing so the commands are found.

## Step 1: Get the code

1. Download **vitalid.zip** (attached to my message in the thread).
2. Unzip it somewhere simple, e.g. `C:\projects\vitalid` or `~/projects/vitalid`.
3. You should see `backend/`, `frontend/`, `supabase/` and `README.md` inside the `vitalid` folder.

---

## Step 2: Create the Supabase project

1. Go to **supabase.com** → **Start your project** → sign in with GitHub or email.
2. Click **New project**.
   - **Organization:** your personal one is fine.
   - **Project name:** `vitalid`
   - **Database password:** click **Generate a password**, then **copy it into a notes file now**. You need it in Step 5 and can't see it again (you can only reset it).
   - **Region:** the closest one to India, e.g. **Mumbai (ap-south-1)**, or Singapore if Mumbai isn't listed.
   - Plan: **Free**.
3. Click **Create new project** and wait 1–2 minutes until the dashboard stops saying "Setting up project".

### 2a. Run the four SQL files (in this exact order)

1. In the left sidebar click **SQL Editor** (the `>_` icon).
2. Click **+ New query**.
3. On your computer, open `vitalid/supabase/migrations/20261018000001_schema.sql` in VS Code or Notepad, **select all, copy**.
4. Paste into the Supabase editor and click **Run** (or Ctrl/Cmd + Enter).
5. You should see **"Success. No rows returned"** at the bottom.
6. Repeat 2–5 for each of the other files, **one at a time, in this order**:
   1. `20261018000001_schema.sql`
   2. `20261018000002_rls.sql`
   3. `20261018000003_storage.sql`
   4. `20261018000004_drug_reference.sql`

**Check it worked:**
- Left sidebar → **Table Editor**: you should see tables such as `patients`, `medications`, `cognitive_tests`, `audit_logs`, `drug_interactions`.
- Left sidebar → **Storage**: you should see two buckets, `documents` and `photos`, both marked private.

**If a file fails:** don't run the next one. Copy the red error text and send it to me in the thread. If you ran a file twice by mistake and see "already exists", that file was already applied; move on to the next one.

### 2b. Turn off email confirmation (makes testing much easier)

1. Left sidebar → **Authentication** → **Sign In / Providers** (on some dashboards: **Providers → Email**).
2. Make sure **Email** is enabled.
3. Turn **off** "Confirm email" and click **Save**.

This lets new sign-ups log in straight away. You can turn it back on later.

### 2c. Copy the four values you need

Keep a notes file open and copy these into it:

| Name in the notes | Where to find it |
|---|---|
| **Project URL** | **Project Settings** (gear, bottom left) → **Data API** (or **API**) → "Project URL". Looks like `https://abcdxyz.supabase.co` |
| **anon key** | **Project Settings → API Keys**. If you see two tabs, open **"Legacy API keys"** and copy **`anon` `public`**. It's a long string starting `eyJ…` |
| **service_role key** | Same page → **`service_role` `secret`** → click **Reveal**, then copy. Also starts with `eyJ…`. **This key bypasses all security: never put it in the frontend and never share it.** |
| **Database URL** | Click the green **Connect** button at the top of the dashboard → **Connection String** tab → choose **Session pooler** → copy the URI. It looks like `postgresql://postgres.abcdxyz:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` (including the brackets) with the database password from step 2. |

> Use the **legacy** `anon` / `service_role` keys (the `eyJ…` ones), not the newer `sb_publishable_…` / `sb_secret_…` keys.
> If your database password contains `@`, `#`, `/`, `:` or `%`, the URL breaks. The easiest fix is **Project Settings → Database → Reset database password** and generating one with letters and numbers only.

---

## Step 3: Get a Groq API key

1. Go to **console.groq.com** and sign in (Google or email). It's free.
2. Left menu → **API Keys** → **Create API Key**.
3. Name it `vitalid` and click **Submit**.
4. **Copy the key immediately** (starts with `gsk_…`). Groq shows it only once. Paste it into your notes file.

The free tier is enough for the demo. The app uses the model `openai/gpt-oss-120b`.

---

## Step 4: Make the QR secret

This is a random string that makes the QR codes unguessable. In a terminal, run:

- Windows: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- Mac/Linux: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`

Copy the output into your notes. **Don't change it later:** changing it makes every printed QR card stop working.

---

## Step 5: Fill in the two settings files

### 5a. Backend: `vitalid/backend/.env`

1. In the `backend` folder, make a copy of `.env.example` and name the copy exactly `.env`.
   (Windows Explorer may hide extensions; creating it in VS Code is easier: right-click `backend` → New File → `.env`.)
2. Open `.env` and fill it in like this, using your values from the notes file:

```
SUPABASE_URL=https://abcdxyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...the service_role key...
SUPABASE_JWT_SECRET=
DATABASE_URL=postgresql://postgres.abcdxyz:YourPassword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres

GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-120b

QR_TOKEN_SECRET=...the random string from Step 4...

FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
```

Leave `SUPABASE_JWT_SECRET` empty. No quotes and no spaces around `=`.

### 5b. Frontend: `vitalid/frontend/.env.local`

Create `frontend/.env.local` (copy of `frontend/.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...the anon key (NOT service_role)...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Step 6: Start the backend

Open a terminal **in the `vitalid/backend` folder** (in VS Code: Terminal → New Terminal, then `cd backend`).

**Windows (PowerShell):**
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
If PowerShell says scripts are disabled, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, and activate again.

**Mac/Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

You'll see `(.venv)` at the start of the prompt once it's active. Then start the API:

```
uvicorn app.main:app --reload --port 8000
```

**Check it worked:** open http://localhost:8000/api/health in the browser. You should see `{"ok":true,"ai_configured":true}`.
- `ai_configured: false` → the Groq key isn't in `.env`.
- An error about `DATABASE_URL` or a connection failure → re-check the Database URL and password from Step 2c.

Leave this terminal running.

---

## Step 7: Create the demo accounts (seed script)

Open a **second** terminal in `vitalid/backend` and activate the venv again (`.venv\Scripts\Activate.ps1` or `source .venv/bin/activate`). Then run the seed, choosing your own demo password (at least 8 characters) and a 4-digit PIN:

```
python -m scripts.seed_demo --password "Demo@2026vid" --pin 2468
```

It prints something like:

```
SYNTHETIC demo data ready (all records flagged is_demo):
  ramesh.demo@example.com   patient
  sunita.demo@example.com   patient
  priya.demo@example.com    caregiver
  mehta.demo@example.com    doctor
  khan.demo@example.com     doctor  (pending verification: approve as admin)
  admin.demo@example.com    admin

  Ramesh Patil  VitalID VID-XXXXXX
```

**Write down Ramesh's VitalID.** Every account uses the password you chose, and both patients use the PIN you chose.
To wipe the demo data and start over, run the same command with `--reset` added at the end.

**Check it worked:** Supabase → **Authentication → Users** shows the six `.demo@example.com` users.

---

## Step 8: Start the frontend

Open a **third** terminal in `vitalid/frontend`:

```
npm install
npm run dev
```

The first `npm install` takes a few minutes. When it says `Ready`, open **http://localhost:3000**.

---

## Step 9: Try the demo path

1. **Log in** as `ramesh.demo@example.com` → you'll see the dashboard, QR card and cognitive alerts.
2. **QR card** (left menu) → **Preview what scanning shows** opens the emergency page.
   - To scan with a real phone, the phone must reach your laptop; that only works after deploying (Step 10). For now use the preview.
3. **Log out** (icon at top right) and log in as `mehta.demo@example.com` → type Ramesh's VitalID and the PIN → **Open record**. The AI brief loads in a few seconds.
4. Under **Prescribe / add medicine**, type `Ibuprofen` → **Check conflicts** → you'll get the warfarin bleeding warning.
5. Log in as `ramesh.demo@example.com` again → **Access & privacy** → the audit log shows Dr. Anjali Mehta's view.
6. Log in as `priya.demo@example.com` (caregiver) → **Alerts**.
7. Log in as `admin.demo@example.com` → approve Dr. Imran Khan.

Tip: use a normal window plus an incognito window to stay logged in as two people at once.

---

## Step 10 (later): Put it online for the demo link

Do this once Step 9 works; I'm happy to guide you through it separately. In short:
backend on **Render** (free web service, root `backend`), frontend on **Vercel** (root `frontend`), the same env values as above, and `FRONTEND_URL` / `CORS_ORIGINS` / `NEXT_PUBLIC_API_URL` set to the live URLs. After that, re-check the QR (it encodes `FRONTEND_URL`), then print the cards.

---

## When something goes wrong

| What you see | What to do |
|---|---|
| Login page: "Could not reach the VitalID API" | The backend terminal (Step 6) isn't running, or `NEXT_PUBLIC_API_URL` is wrong. |
| Login: "Invalid login credentials" | Wrong password, or the seed didn't run. Check Authentication → Users. |
| Sign-up works but login says "Email not confirmed" | Step 2b wasn't saved. |
| AI brief: "AI is unavailable right now" | Groq key missing or wrong, or Groq rate limit; wait a minute and click Regenerate. |
| Seed fails: "No profile for … signup trigger" | `20261018000002_rls.sql` didn't run successfully. Re-run it. |
| `'python' is not recognized` (Windows) | Reinstall Python with "Add to PATH" ticked, then open a new terminal. |
| After changing `.env.local` nothing changes | Stop `npm run dev` (Ctrl+C) and start it again. |

For anything else, copy the exact error text from the terminal or browser into the thread. **Don't paste keys.**
