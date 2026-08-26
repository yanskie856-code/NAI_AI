import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-nai-token'
};

async function hashToken(token: string) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = request.headers.get('x-nai-token');
    const { message } = await request.json();
    if (!token || typeof message !== 'string' || !message.trim()) throw new Error('Token and message are required.');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const tokenHash = await hashToken(token);
    const { data: tokenRecord } = await admin
      .from('embed_tokens')
      .select('system_id, expires_at, revoked_at, allowed_origin')
      .eq('token_hash', tokenHash)
      .single();

    if (!tokenRecord || tokenRecord.revoked_at || new Date(tokenRecord.expires_at) <= new Date()) {
      throw new Error('Invalid or expired embed token.');
    }

    const requestOrigin = request.headers.get('origin');
    if (tokenRecord.allowed_origin && requestOrigin !== tokenRecord.allowed_origin) {
      throw new Error('Origin is not allowed.');
    }

    const { data: system } = await admin.from('systems').select('name').eq('id', tokenRecord.system_id).single();
    const { data: documents } = await admin
      .from('knowledge_documents')
      .select('file_name, content')
      .eq('system_id', tokenRecord.system_id);

    const words = message.toLowerCase().split(/\W+/).filter(word => word.length > 3);
    let bestSection: { title: string; lines: string[] } | null = null;
    let bestScore = 0;
    for (const document of documents ?? []) {
      const sections: { title: string; lines: string[] }[] = [];
      let currentSection: { title: string; lines: string[] } | null = null;
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
      ? `Here is what you need to know about ${bestSection.title.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())}:\n\n${bestSection.lines.map(line => `- ${line}`).join('\n')}`
      : `I could not find a matching detail in the attached guide. Try asking about a specific task or topic.`;

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
