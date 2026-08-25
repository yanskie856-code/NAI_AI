const verificationMinutes = 15;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map(value => value.toString(16).padStart(2, '0')).join('');
}

function emailIsValid(email) {
  return typeof email === 'string' && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendVerificationEmail(env, email, code, token) {
  const origin = env.APP_URL || 'https://nai-ai.yanskie856.workers.dev';
  const isBrevo = Boolean(env.BREVO_API_KEY);
  const response = await fetch(isBrevo ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      ...(isBrevo ? { 'api-key': env.BREVO_API_KEY } : { Authorization: `Bearer ${env.RESEND_API_KEY}` }),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(isBrevo ? {
      sender: { email: env.EMAIL_FROM || env.RESEND_FROM_EMAIL || 'onboarding@resend.dev', name: 'NAI Assistant' },
      to: [{ email }],
      subject: 'Verify your NAI account',
      htmlContent: `<p>Use this verification code to activate your NAI account:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Or <a href="${origin}/api/auth/verify-email?token=${token}">click here to verify your email</a>.</p><p>This code expires in ${verificationMinutes} minutes.</p>`
    } : {
      from: env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: [email],
      subject: 'Verify your NAI account',
      html: `<p>Use this verification code to activate your NAI account:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Or <a href="${origin}/api/auth/verify-email?token=${token}">click here to verify your email</a>.</p><p>This code expires in ${verificationMinutes} minutes.</p>`
    })
  });
  if (!response.ok) throw new Error('Email provider rejected the message. Check the Resend sender and API key.');
}

async function requestVerification(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailIsValid(email)) return json({ error: 'A valid email address is required.' }, 400);
  if (!env.BREVO_API_KEY && !env.RESEND_API_KEY) return json({ error: 'Email delivery is not configured.' }, 503);

  const token = randomHex(32);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Math.floor(Date.now() / 1000);
  await env.AUTH_DB.prepare(`
    insert into email_verifications (email, token_hash, code_hash, expires_at, verified_at)
    values (?, ?, ?, ?, null)
    on conflict(email) do update set token_hash = excluded.token_hash, code_hash = excluded.code_hash, expires_at = excluded.expires_at, verified_at = null
  `).bind(email, await hash(token), await hash(code), now + verificationMinutes * 60).run();

  try {
    await sendVerificationEmail(env, email, code, token);
  } catch (error) {
    await env.AUTH_DB.prepare('delete from email_verifications where email = ?').bind(email).run();
    return json({ error: error.message }, 502);
  }
  return json({ ok: true });
}

async function verifyCode(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const record = await env.AUTH_DB.prepare('select * from email_verifications where email = ?').bind(email).first();
  if (!record || record.verified_at || record.expires_at < Math.floor(Date.now() / 1000) || !(await hash(code) === record.code_hash)) {
    return json({ error: 'The verification code is invalid or expired.' }, 400);
  }
  await env.AUTH_DB.prepare('update email_verifications set verified_at = ? where email = ?').bind(Math.floor(Date.now() / 1000), email).run();
  return json({ ok: true });
}

async function verifyLink(request, env) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const record = await env.AUTH_DB.prepare('select email, expires_at, verified_at from email_verifications where token_hash = ?').bind(await hash(token)).first();
  if (!record || record.verified_at || record.expires_at < Math.floor(Date.now() / 1000)) return new Response('This verification link is invalid or expired.', { status: 400 });
  await env.AUTH_DB.prepare('update email_verifications set verified_at = ? where email = ?').bind(Math.floor(Date.now() / 1000), record.email).run();
  return Response.redirect(`${env.APP_URL || 'https://nai-ai.yanskie856.workers.dev'}/?verified=1&email=${encodeURIComponent(record.email)}`, 302);
}

async function verificationStatus(request, env) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase() || '';
  const record = await env.AUTH_DB.prepare('select verified_at from email_verifications where email = ?').bind(email).first();
  return json({ verified: Boolean(record?.verified_at) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/auth/request-verification' && request.method === 'POST') return requestVerification(request, env);
    if (url.pathname === '/api/auth/verify-code' && request.method === 'POST') return verifyCode(request, env);
    if (url.pathname === '/api/auth/verify-email' && request.method === 'GET') return verifyLink(request, env);
    if (url.pathname === '/api/auth/status' && request.method === 'GET') return verificationStatus(request, env);
    const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const assetUrl = new URL(assetPath, request.url);

    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
};
