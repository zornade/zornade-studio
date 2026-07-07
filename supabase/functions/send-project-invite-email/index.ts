// supabase/functions/send-project-invite-email/index.ts
//
// Notifica via email un invito a collaborare su un progetto di Zornade
// Studio (Fase 5, roadmap - vedi
// /memories/repo/zornade-studio-oss-own-project-2026-07-06.md).
//
// Il client ha GIA' inserito la riga in studio_project_collaborators (RLS
// studio_collab_insert_owner la autorizza solo per il vero proprietario)
// PRIMA di chiamare questa funzione: qui ci limitiamo a inviare la
// notifica, non a creare la condivisione. L'accettazione è automatica
// (vedi il trigger studio_claim_pending_invites in
// 20260706120200_studio_collaborator_invite_claim.sql): non serve un link
// con token, basta che l'invitato acceda con la stessa email (magic link).
//
// Invocata dal browser (supabase.functions.invoke), non da pg_cron: verify_jwt
// resta attivo di default, e in più verifichiamo esplicitamente che il
// chiamante sia proprio il PROPRIETARIO del progetto - non basta un
// qualunque utente autenticato - interrogando studio_projects con un
// client scoped al JWT del chiamante (RLS decide cosa vede, non
// reimplementiamo qui la logica di autorizzazione).
//
// Provider: Resend, stesso già usato da app/ (vedi
// app/supabase/functions/send-fire-alert-email) - dominio zornade.com già
// verificato, chiave RESEND_API_KEY separata per questo progetto Supabase
// dedicato (mai condivisa con app/, coerente con la decisione "progetto
// proprio" del 2026-07-06).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'Zornade Studio <notifiche@zornade.com>';
const STUDIO_URL = 'https://studio.zornade.com';

const ROLE_LABELS: Record<string, string> = {
  editor: 'editor (può modificare la mappa)',
  viewer: 'visualizzatore (sola lettura)',
};

interface InviteRequestBody {
  projectId?: string;
  inviteeEmail?: string;
  role?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildEmailHtml(projectName: string, roleLabel: string, inviterEmail: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;color:#1e293b">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="background:#33A3AF;border-radius:12px 12px 0 0;padding:20px 24px">
      <span style="color:#fff;font-size:16px;font-weight:600">Zornade Studio</span>
    </div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px;border:1px solid #e2e8f0;border-top:none">
      <p style="margin:0 0 12px;font-size:15px;line-height:1.5">
        <strong>${inviterEmail}</strong> ti ha invitato a collaborare sulla mappa
        <strong>${projectName}</strong> come <strong>${roleLabel}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5">
        Accedi a Zornade Studio con questo stesso indirizzo email per vederla
        tra i tuoi progetti condivisi.
      </p>
      <a href="${STUDIO_URL}" style="display:inline-block;background:#33A3AF;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
        Apri Zornade Studio
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">
        Se non ti aspettavi questo invito, puoi ignorare questa email.
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildEmailText(projectName: string, roleLabel: string, inviterEmail: string): string {
  return [
    `${inviterEmail} ti ha invitato a collaborare sulla mappa "${projectName}" come ${roleLabel}.`,
    '',
    `Accedi a Zornade Studio (${STUDIO_URL}) con questo stesso indirizzo email per vederla tra i tuoi progetti condivisi.`,
    '',
    'Se non ti aspettavi questo invito, puoi ignorare questa email.',
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Non autenticato' }, 401);

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('RESEND_API_KEY non configurata');
    return jsonResponse({ error: 'RESEND_API_KEY non configurata' }, 500);
  }

  let body: InviteRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'JSON non valido' }, 400);
  }

  const { projectId, inviteeEmail, role } = body;
  if (!projectId || !inviteeEmail || !role || !ROLE_LABELS[role]) {
    return jsonResponse({ error: 'Parametri mancanti o non validi' }, 400);
  }

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Non autenticato' }, 401);
  }

  // Confirms the caller owns this project (RLS studio_projects_select_owner
  // matches owner_id = auth.uid(); a mere collaborator would also pass
  // studio_projects_select_collaborator, so the owner_id check is repeated
  // explicitly here rather than trusting "some SELECT policy matched").
  const { data: project, error: projectError } = await callerClient
    .from('studio_projects')
    .select('id, name, owner_id')
    .eq('id', projectId)
    .single();

  if (projectError || !project || project.owner_id !== userData.user.id) {
    return jsonResponse({ error: 'Non autorizzato a invitare su questo progetto' }, 403);
  }

  const roleLabel = ROLE_LABELS[role];
  const inviterEmail = userData.user.email ?? 'Un collega';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [inviteeEmail],
      subject: `${inviterEmail} ti ha condiviso una mappa su Zornade Studio`,
      html: buildEmailHtml(project.name, roleLabel, inviterEmail),
      text: buildEmailText(project.name, roleLabel, inviterEmail),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('Errore invio Resend:', res.status, detail);
    return jsonResponse({ error: 'Invio email non riuscito' }, 502);
  }

  return jsonResponse({ ok: true });
});
