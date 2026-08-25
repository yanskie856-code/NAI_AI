# Supabase setup

## 1. Create the project

1. Create a Supabase project.
2. Open **SQL Editor** and run [`schema.sql`](schema.sql).
3. After creating an account, promote it to an admin from **SQL Editor**:

```sql
update public.profiles
set role = 'admin', updated_at = now()
where email = 'admin@example.com';
```

New Supabase Auth accounts are added to `public.profiles` automatically with the `user` role.

To create the admin account, create a user in **Authentication -> Users -> Add user** with the admin email and password `admin1234`, then run the promotion query above. Do not place this password in frontend code or SQL; change it after the first login.
4. Deploy both Edge Functions:

```sh
supabase functions deploy create-embed-token
supabase functions deploy assistant
```

## 2. Deploy the backend to Vercel

Import this repository into Vercel with the project root set to the repository root. Vercel uses [`api/index.js`](../api/index.js) as the serverless backend entry point and serves the page from [`frontend/index.html`](../frontend/index.html).

Add these Vercel project environment variables for **Production**, **Preview**, and **Development**:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
ALLOWED_ORIGIN=https://your-vercel-domain.vercel.app
PORT=3000
```

Deploy with:

```sh
npm install
npx vercel
npx vercel --prod
```

After deployment, check `https://your-domain.vercel.app/api/health`.

## 3. Configure Supabase Edge Function secrets

Set these secrets in Supabase. The service-role key must only exist in Edge Function secrets.

```sh
supabase secrets set ALLOWED_ORIGIN=https://your-admin-domain.example
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically by Supabase Edge Functions. Use the anon key in browser code only after enabling RLS.

## 4. Start the backend locally

From the `server` folder:

```sh
npm install
copy .env.example .env
npm start
```

Set real Supabase values in `server/.env`. Never commit that file.

The backend provides:

- `POST /api/admin/systems` for authenticated system creation
- `POST /api/admin/systems/:systemId/knowledge` for authenticated TXT/DOCX uploads
- `POST /api/admin/systems/:systemId/embed-token` for expiring embed tokens
- `POST /api/assistant` for token-authenticated assistant requests

## 5. Connect the frontend

The current static frontend still runs in local prototype mode. To connect it, call the backend API from the admin portal and use the returned token for assistant requests. Admin requests must include the Supabase Auth access token:

```js
const response = await fetch('http://localhost:3000/api/admin/systems', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`
  },
  body: JSON.stringify({ name: 'Inventory System' })
});
```

Assistant requests use the embed token in `x-nai-token`:

```js
const response = await fetch('http://localhost:3000/api/assistant', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-nai-token': embedToken
  },
  body: JSON.stringify({ message: 'How do I check stock?' })
});
```

If the frontend needs direct Supabase Auth, load `@supabase/supabase-js` in `index.html` and initialize it with:

```js
const supabase = window.supabase.createClient(
  'https://YOUR_PROJECT.supabase.co',
  'YOUR_PUBLIC_ANON_KEY'
);
```

Use Supabase Auth for the admin portal. Call `create-embed-token` with the authenticated user session, then send the returned token to the `assistant` function in the `x-nai-token` header.

Do not put `SUPABASE_SERVICE_ROLE_KEY` in `index.html`, `script.js`, or any browser-delivered file.

For the browser dashboard, edit [`frontend/config.js`](../frontend/config.js) with the Supabase project URL and public anon key. The anon key may be public because the database tables use RLS:

```js
window.NAI_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_PUBLIC_ANON_KEY'
};
```

Enable Google in **Supabase Dashboard -> Authentication -> Providers -> Google** and add your deployed frontend URL as an allowed redirect URL.

For the Node backend, add `ADMIN_EMAILS=your-google-email@example.com` to `server/.env`. Only those authenticated emails can review requests through the admin routes.
