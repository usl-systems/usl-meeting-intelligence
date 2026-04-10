/**
 * Make.com Scenario Setup Script
 *
 * Creates two webhook-triggered scenarios:
 * 1. "MI – Save to SharePoint" — receives summary JSON, saves .docx to SharePoint
 * 2. "MI – Post to Teams" — receives summary JSON, posts to a Teams channel
 *
 * Prerequisites:
 * - MAKE_API_TOKEN in .env.local
 * - MAKE_ORG_ID in .env.local
 * - MAKE_BASE_URL in .env.local (e.g., https://us2.make.com)
 *
 * Usage: npx tsx scripts/setup-make.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const BASE_URL = process.env.MAKE_BASE_URL;
const API_TOKEN = process.env.MAKE_API_TOKEN;
const ORG_ID = process.env.MAKE_ORG_ID;

if (!BASE_URL || !API_TOKEN || !ORG_ID) {
  console.error('Missing required env vars: MAKE_BASE_URL, MAKE_API_TOKEN, MAKE_ORG_ID');
  process.exit(1);
}

const headers = {
  Authorization: `Token ${API_TOKEN}`,
  'Content-Type': 'application/json',
};

async function apiGet(endpoint: string, params?: Record<string, string>) {
  const url = new URL(`${BASE_URL}/api/v2${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${endpoint} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function apiPost(endpoint: string, body?: Record<string, unknown>) {
  const url = `${BASE_URL}/api/v2${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPatch(endpoint: string, body: Record<string, unknown>) {
  const url = `${BASE_URL}/api/v2${endpoint}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Step 1: Discover Team ID ──────────────────────────────────────

async function getTeamId(): Promise<number> {
  console.log(`\n🔍 Discovering teams for org ${ORG_ID}...`);
  const data = await apiGet('/teams', { organizationId: ORG_ID! });
  const teams = data.teams || [];

  if (teams.length === 0) {
    throw new Error('No teams found in this organization. Create a team in Make first.');
  }

  const team = teams[0];
  console.log(`   Found team: "${team.name}" (ID: ${team.id})`);
  return team.id;
}

// ── Step 2: Discover Microsoft 365 Connection ─────────────────────

async function findM365Connection(teamId: number): Promise<{ id: number; name: string } | null> {
  console.log(`\n🔍 Looking for Microsoft 365 connections in team ${teamId}...`);
  const data = await apiGet('/connections', { teamId: String(teamId) });
  const connections = data.connections || [];

  // Look for Microsoft 365 / OneDrive / Teams connections
  const m365 = connections.find(
    (c: { accountName: string; accountLabel: string }) =>
      c.accountName.includes('microsoft') ||
      c.accountName.includes('onedrive') ||
      c.accountName.includes('teams') ||
      c.accountLabel?.toLowerCase().includes('microsoft') ||
      c.accountLabel?.toLowerCase().includes('onedrive')
  );

  if (m365) {
    console.log(`   Found: "${m365.name}" (ID: ${m365.id}, type: ${m365.accountName})`);
    return { id: m365.id, name: m365.name };
  }

  console.log('   ⚠ No Microsoft 365 connection found.');
  console.log('   You will need to:');
  console.log('   1. Go to Make.com → Connections → Create a connection');
  console.log('   2. Choose "Microsoft 365" and authenticate');
  console.log('   3. Then manually wire the connection into the scenarios');
  return null;
}

// ── Step 3: Create Webhooks ───────────────────────────────────────

async function createWebhook(teamId: number, name: string): Promise<{ id: number; url: string }> {
  console.log(`\n📌 Creating webhook: "${name}"...`);
  const data = await apiPost('/hooks', {
    name,
    teamId: String(teamId),
    typeName: 'gateway-webhook',
    method: false,
    headers: true,
    stringify: false,
  });

  const hook = data.hook;
  console.log(`   Webhook ID: ${hook.id}`);
  console.log(`   URL: ${hook.url}`);
  return { id: hook.id, url: hook.url };
}

// ── Step 4: Create Scenarios ──────────────────────────────────────

async function createScenario(
  teamId: number,
  name: string,
  hookId: number,
): Promise<number> {
  console.log(`\n🔧 Creating scenario: "${name}"...`);

  // Create a minimal scenario — the webhook trigger + a placeholder module
  // Full module wiring (SharePoint/Teams) must be done in the Make UI
  // because those modules require interactive connection selection
  const data = await apiPost('/scenarios', {
    teamId,
    name,
    blueprint: JSON.stringify({
      name,
      metadata: { version: 1 },
      flow: [
        {
          id: 1,
          module: 'gateway:CustomWebHook',
          version: 1,
          parameters: { hook: hookId, maxResults: 1 },
          mapper: {},
          metadata: { designer: { x: 0, y: 0 } },
        },
      ],
    }),
    scheduling: JSON.stringify({
      type: 'indefinitely',
    }),
  });

  const scenarioId = data.scenario?.id;
  if (!scenarioId) {
    throw new Error('Scenario creation returned no ID. Response: ' + JSON.stringify(data));
  }

  console.log(`   Scenario ID: ${scenarioId}`);
  return scenarioId;
}

// ── Step 5: Start webhook learning ────────────────────────────────

async function startLearning(hookId: number): Promise<void> {
  console.log(`   Starting data structure learning for hook ${hookId}...`);
  await apiPost(`/hooks/${hookId}/learn-start`);
  console.log(`   ✓ Webhook is now listening for a sample payload`);
}

// ── Step 6: Send sample payload to teach the webhook ──────────────

async function sendSamplePayload(webhookUrl: string): Promise<void> {
  console.log(`   Sending sample payload to teach the webhook data structure...`);

  const samplePayload = {
    meetingType: 'sales_discovery',
    title: 'Sample Meeting',
    date: '2025-04-10',
    attendees: ['Sarah Jones', 'Mark Chen'],
    markdown: '## Executive Summary\n\n- Sample bullet point\n\n## Key Decisions\n\n**Sample decision** — rationale (Decided by: Sarah Jones)',
    decisions: [{ text: 'Sample decision', rationale: 'Sample rationale', decidedBy: 'Sarah Jones' }],
    actionItems: [{ description: 'Follow up on proposal', owner: 'Mark Chen', dueDate: '2025-04-15' }],
    quotes: [{ text: 'This is a key quote', speaker: 'Sarah Jones' }],
    qualityScore: 90,
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(samplePayload),
  });

  if (res.ok) {
    console.log(`   ✓ Sample payload sent successfully`);
  } else {
    console.log(`   ⚠ Sample payload returned ${res.status} (this is normal for learning mode)`);
  }
}

// ── Step 7: Stop learning ─────────────────────────────────────────

async function stopLearning(hookId: number): Promise<void> {
  // Wait a moment for Make to process the sample
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`   Stopping data structure learning for hook ${hookId}...`);
  await apiPost(`/hooks/${hookId}/learn-stop`);
  console.log(`   ✓ Data structure learned`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Meeting Intelligence — Make.com Setup Script   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nBase URL: ${BASE_URL}`);
  console.log(`Org ID:   ${ORG_ID}`);

  // Step 1: Get team
  const teamId = await getTeamId();

  // Step 2: Check for M365 connection
  const m365 = await findM365Connection(teamId);

  // Step 3: Create webhooks
  const sharepointHook = await createWebhook(teamId, 'MI – SharePoint Webhook');
  const teamsHook = await createWebhook(teamId, 'MI – Teams Channel Webhook');

  // Step 4: Create scenarios
  const sharepointScenarioId = await createScenario(
    teamId,
    'MI – Save Summary to SharePoint',
    sharepointHook.id,
  );
  const teamsScenarioId = await createScenario(
    teamId,
    'MI – Post Summary to Teams Channel',
    teamsHook.id,
  );

  // Step 5-7: Teach webhooks the data structure
  // Note: learn-start may fail if the API token lacks hooks:write scope for this org.
  // In that case, the webhooks will auto-learn when they receive their first real payload.
  console.log('\n📡 Teaching webhooks the payload structure...');

  try {
    await startLearning(sharepointHook.id);
    await sendSamplePayload(sharepointHook.url);
    await stopLearning(sharepointHook.id);

    await startLearning(teamsHook.id);
    await sendSamplePayload(teamsHook.url);
    await stopLearning(teamsHook.id);
  } catch {
    console.log('   ⚠ Could not auto-teach webhooks (permission restricted).');
    console.log('   The webhooks will learn the data structure when they');
    console.log('   receive their first real payload from the app.');
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Setup Complete!                                ║');
  console.log('╚══════════════════════════════════════════════════╝');

  console.log('\n📋 What was created:');
  console.log(`\n   Scenario 1: "MI – Save Summary to SharePoint"`);
  console.log(`   Scenario ID: ${sharepointScenarioId}`);
  console.log(`   Webhook URL: ${sharepointHook.url}`);

  console.log(`\n   Scenario 2: "MI – Post Summary to Teams Channel"`);
  console.log(`   Scenario ID: ${teamsScenarioId}`);
  console.log(`   Webhook URL: ${teamsHook.url}`);

  if (m365) {
    console.log(`\n   Microsoft 365 Connection: "${m365.name}" (ID: ${m365.id})`);
  }

  console.log('\n⚡ Next steps:');
  console.log('   1. Open each scenario in Make.com');
  console.log('   2. Add modules after the webhook trigger:');
  console.log('      • Scenario 1: Add "SharePoint → Upload a File" module');
  console.log('        Map: folder path = /Meeting Notes/{meetingType}/');
  console.log('        Map: filename = {meetingType prefix}-{title}-{date}.docx');
  console.log('        Map: content = {markdown}');
  console.log('      • Scenario 2: Add "Microsoft Teams → Send a Message" module');
  console.log('        Map: channel = your target channel');
  console.log('        Map: message = formatted summary from {markdown}');
  if (m365) {
    console.log(`   3. Wire the Microsoft 365 connection (ID: ${m365.id}) to each module`);
  } else {
    console.log('   3. Create a Microsoft 365 connection in Make.com first');
  }
  console.log('   4. Turn on both scenarios');
  console.log('   5. Add these webhook URLs to your Meeting Intelligence .env.local:');
  console.log(`      MAKE_WEBHOOK_SHAREPOINT=${sharepointHook.url}`);
  console.log(`      MAKE_WEBHOOK_TEAMS=${teamsHook.url}`);
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message);
  process.exit(1);
});
