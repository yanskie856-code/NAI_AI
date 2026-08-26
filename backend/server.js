import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5500';
const adminEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = ['text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    callback(null, allowed.includes(file.mimetype) || /\.(txt|docx)$/i.test(file.originalname));
  }
});

app.use(helmet());
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));
app.use('/api/assistant', rateLimit({ windowMs: 60 * 1000, limit: 30 }));

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requireUser(request, response, next) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return response.status(401).json({ error: 'Authentication required.' });

  const { data, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !data.user) return response.status(401).json({ error: 'Invalid session.' });
  request.user = data.user;
  next();
}

async function requireAdmin(request, response, next) {
  const { data: profile } = await admin.from('profiles').select('role').eq('id', request.user.id).maybeSingle();
  const isConfiguredAdmin = adminEmails.has(request.user.email?.toLowerCase());
  if (profile?.role !== 'admin' && !isConfiguredAdmin) return response.status(403).json({ error: 'Admin access required.' });
  next();
}

async function ownsSystem(userId, systemId) {
  const { data } = await admin.from('systems').select('id, name').eq('id', systemId).eq('owner_id', userId).single();
  return data;
}

app.get('/health', (_request, response) => response.json({ ok: true }));

app.post('/api/admin/systems', requireUser, async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
  if (!name || name.length > 120) return response.status(400).json({ error: 'A system name is required.' });

  const { data, error } = await admin.from('systems').insert({ owner_id: request.user.id, name }).select('id, name').single();
  if (error) return response.status(400).json({ error: error.message });
  response.status(201).json(data);
});

app.get('/api/admin/requests', requireUser, requireAdmin, async (_request, response) => {
  const { data, error } = await admin.from('system_requests').select('*').order('created_at', { ascending: false });
  if (error) return response.status(400).json({ error: error.message });
  response.json(data);
});

app.patch('/api/admin/requests/:requestId', requireUser, requireAdmin, async (request, response) => {
  const status = ['pending', 'approved', 'rejected'].includes(request.body.status) ? request.body.status : null;
  if (!status) return response.status(400).json({ error: 'Invalid request status.' });
  const { data, error } = await admin.from('system_requests').update({ status, admin_note: request.body.adminNote || null, updated_at: new Date().toISOString() }).eq('id', request.params.requestId).select('*').single();
  if (error) return response.status(400).json({ error: error.message });
  response.json(data);
});

app.post('/api/admin/systems/:systemId/knowledge', requireUser, upload.single('file'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'A TXT or DOCX file is required.' });
  const system = await ownsSystem(request.user.id, request.params.systemId);
  if (!system) return response.status(404).json({ error: 'System not found.' });

  const text = request.file.mimetype === 'text/plain'
    ? request.file.buffer.toString('utf8')
    : (await mammoth.extractRawText({ buffer: request.file.buffer })).value;
  if (!text.trim()) return response.status(400).json({ error: 'The document is empty.' });

  const safeName = request.file.originalname.replace(/[^a-z0-9._-]/gi, '_');
  const storagePath = `${request.user.id}/${system.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('knowledge').upload(storagePath, request.file.buffer, {
    contentType: request.file.mimetype,
    upsert: false
  });
  if (uploadError) return response.status(400).json({ error: uploadError.message });

  const { data, error } = await admin.from('knowledge_documents').insert({
    system_id: system.id,
    owner_id: request.user.id,
    file_name: request.file.originalname,
    storage_path: storagePath,
    content: text,
    mime_type: request.file.mimetype
  }).select('id, file_name, created_at').single();
  if (error) {
    await admin.storage.from('knowledge').remove([storagePath]);
    return response.status(400).json({ error: error.message });
  }
  response.status(201).json(data);
});

app.post('/api/admin/systems/:systemId/embed-token', requireUser, async (request, response) => {
  const system = await ownsSystem(request.user.id, request.params.systemId);
  if (!system) return response.status(404).json({ error: 'System not found.' });

  const rawToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const days = Math.min(Math.max(Number(request.body.expiresInDays) || 30, 1), 365);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const { error } = await admin.from('embed_tokens').insert({
    system_id: system.id,
    owner_id: request.user.id,
    token_hash: tokenHash(rawToken),
    allowed_origin: request.body.allowedOrigin || null,
    expires_at: expiresAt
  });
  if (error) return response.status(400).json({ error: error.message });
  response.status(201).json({ token: rawToken, expiresAt });
});

app.post('/api/assistant', async (request, response) => {
  const token = request.headers['x-nai-token'];
  const message = typeof request.body.message === 'string' ? request.body.message.trim() : '';
  if (!token || !message) return response.status(400).json({ error: 'Token and message are required.' });

  const { data: tokenRecord } = await admin.from('embed_tokens')
    .select('system_id, expires_at, revoked_at, allowed_origin')
    .eq('token_hash', tokenHash(token)).single();
  if (!tokenRecord || tokenRecord.revoked_at || new Date(tokenRecord.expires_at) <= new Date()) {
    return response.status(401).json({ error: 'Invalid or expired embed token.' });
  }
  const origin = request.headers.origin;
  if (tokenRecord.allowed_origin && origin !== tokenRecord.allowed_origin) return response.status(403).json({ error: 'Origin is not allowed.' });

  const [{ data: system }, { data: documents }] = await Promise.all([
    admin.from('systems').select('name').eq('id', tokenRecord.system_id).single(),
    admin.from('knowledge_documents').select('content').eq('system_id', tokenRecord.system_id)
  ]);
  const words = message.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  let bestSection = null;
  let bestScore = 0;
  for (const document of documents || []) {
    const sections = [];
    let currentSection = null;
    for (const line of document.content.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      if (/^[A-Z][A-Z0-9 &'/-]{2,}$/.test(line)) {
        currentSection = { title: line, lines: [] };
        sections.push(currentSection);
      } else if (currentSection) {
        currentSection.lines.push(line);
      }
    }
    for (const section of sections) {
      const sectionText = `${section.title} ${section.lines.join(' ')}`.toLowerCase();
      const matchingWords = words.filter(word => sectionText.includes(word));
      const headingMatches = words.filter(word => section.title.toLowerCase().includes(word));
      const score = matchingWords.length * 2 + headingMatches.length * 6;
      if (score > bestScore) {
        bestScore = score;
        bestSection = section;
      }
    }
  }
  const reply = bestSection
    ? `Here’s the relevant guidance for ${bestSection.title.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())}.\n\n${bestSection.lines.map(line => `- ${line}`).join('\n')}`
    : `I could not find a matching detail in the attached guide. Try asking about a specific task or topic.`;
  response.json({ reply });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => console.log(`NAI backend listening on http://localhost:${port}`));
}

export default app;
