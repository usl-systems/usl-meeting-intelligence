/**
 * Make.com Scenario Setup Script
 *
 * Creates two webhook-triggered scenarios for Meeting Intelligence:
 * 1. "MI – Save Summary to SharePoint" — receives summary JSON, saves to SharePoint
 * 2. "MI – Post Summary to Teams" — receives summary JSON, posts to Teams channel
 *
 * NOTE: The Make.com REST API supports creating scenarios with webhook triggers
 * and sequential modules. Router/branching must be configured in the Make UI.
 * This script creates the scenarios with webhook + placeholder modules, teaches
 * the webhooks the data structure, and prints instructions for adding
 * SharePoint/Teams modules with dynamic folder routing in the Make editor.
 *
 * Prerequisites:
 *   MAKE_API_TOKEN, MAKE_ORG_ID, MAKE_BASE_URL in .env.local
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
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${endpoint} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function apiPost(endpoint: string, body?: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/api/v2${endpoint}`, {
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
  const res = await fetch(`${BASE_URL}/api/v2${endpoint}`, {
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

// ── Step 1: Discovery ─────────────────────────────────────────────

async function discoverTeam(): Promise<number> {
  console.log(`\n--- Step 1: Discovery ---`);
  console.log(`Fetching teams for org ${ORG_ID}...`);
  const data = await apiGet('/teams', { organizationId: ORG_ID! });
  const teams = data.teams || [];
  if (teams.length === 0) throw new Error('No teams found. Create a team in Make.com first.');
  const team = teams[0];
  console.log(`  Team: "${team.name}" (ID: ${team.id})`);
  return team.id;
}

async function discoverConnection(teamId: number): Promise<{ id: number; name: string; type: string } | null> {
  console.log(`Fetching connections for team ${teamId}...`);
  const data = await apiGet('/connections', { teamId: String(teamId) });
  const connections = data.connections || [];

  const m365 = connections.find(
    (c: { accountName: string; accountLabel: string }) =>
      c.accountName.includes('microsoft') ||
      c.accountName.includes('azure') ||
      c.accountName.includes('onedrive') ||
      c.accountName.includes('sharepoint') ||
      c.accountLabel?.toLowerCase().includes('microsoft')
  );

  if (m365) {
    console.log(`  Microsoft 365 Connection: "${m365.name}" (ID: ${m365.id}, type: ${m365.accountName})`);
    return { id: m365.id, name: m365.name, type: m365.accountName };
  }

  console.log('  WARNING: No Microsoft 365 connection found.');
  console.log('  Create one at Make.com > Connections > Create Connection > Microsoft 365');
  return null;
}

// ── Step 2 & 3: Create Scenarios ──────────────────────────────────

async function createWebhook(teamId: number, name: string): Promise<{ id: number; url: string }> {
  console.log(`Creating webhook: "${name}"...`);
  const data = await apiPost('/hooks', {
    name,
    teamId: String(teamId),
    typeName: 'gateway-webhook',
    method: false,
    headers: true,
    stringify: false,
  });
  console.log(`  Webhook ID: ${data.hook.id}`);
  console.log(`  URL: ${data.hook.url}`);
  return { id: data.hook.id, url: data.hook.url };
}

async function createScenario(
  teamId: number,
  name: string,
  hookId: number,
): Promise<number> {
  console.log(`Creating scenario: "${name}"...`);

  // Create scenario with webhook trigger + a Set Variable placeholder
  // The Set Variable maps meetingType so it's visible in the Make editor
  // when the user adds SharePoint/Teams modules after.
  const blueprint = {
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
      {
        id: 2,
        module: 'util:SetVariable2',
        version: 1,
        parameters: {},
        mapper: {
          name: 'folderPath',
          scope: 'roundtrip',
          value: '{{if(1.meetingType = "sales_discovery"; "/Sales/Meeting Notes"; if(1.meetingType = "customer_support"; "/Support/Meeting Notes"; "/Internal/Meeting Notes"))}}',
        },
        metadata: { designer: { x: 300, y: 0 } },
      },
    ],
  };

  const data = await apiPost('/scenarios', {
    teamId,
    name,
    blueprint: JSON.stringify(blueprint),
    scheduling: JSON.stringify({ type: 'indefinitely' }),
  });

  const scenarioId = data.scenario?.id;
  if (!scenarioId) throw new Error('Scenario creation returned no ID: ' + JSON.stringify(data));
  console.log(`  Scenario ID: ${scenarioId}`);
  return scenarioId;
}

async function activateScenario(scenarioId: number): Promise<void> {
  console.log(`Activating scenario ${scenarioId}...`);
  try {
    await apiPatch(`/scenarios/${scenarioId}`, { isActive: true });
    console.log(`  Activated.`);
  } catch (err) {
    // Activation may fail if modules need configuration first
    console.log(`  Could not activate (modules may need configuration in Make UI first).`);
  }
}

// ── Step 4: Teach webhooks ────────────────────────────────────────

async function teachWebhook(hookId: number, webhookUrl: string): Promise<void> {
  console.log(`Teaching webhook ${hookId} the payload structure...`);

  // Try to start learning (may fail due to token scope)
  try {
    await apiPost(`/hooks/${hookId}/learn-start`);
  } catch {
    console.log(`  Learn-start restricted. Sending payload directly (webhook will auto-learn).`);
  }

  const samplePayload = {
    meetingType: 'sales_discovery',
    title: 'Q3 Pipeline Review with Acme Corp',
    date: '2025-04-10',
    attendees: ['Sarah Jones', 'Mark Chen', 'Lisa Park'],
    markdown: '## Executive Summary\n\n- Revenue up 15% QoQ\n- Enterprise segment strongest\n\n## Key Decisions\n\n**Delay launch to Q2** — engineering needs 3 more weeks (Decided by: Sarah Jones)',
    decisions: [{ text: 'Delay launch to Q2', rationale: 'Engineering needs 3 weeks', decidedBy: 'Sarah Jones' }],
    actionItems: [{ description: 'Send proposal to Acme', owner: 'Mark Chen', dueDate: '2025-04-15' }],
    quotes: [{ text: 'Enterprise is our strongest area', speaker: 'Mark Chen' }],
    qualityScore: 90,
    filename: 'SD-q3-pipeline-review-2025-04-10.docx',
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(samplePayload),
  });
  console.log(`  Sample payload sent (${res.status}).`);

  // Try to stop learning
  try {
    await new Promise((r) => setTimeout(r, 2000));
    await apiPost(`/hooks/${hookId}/learn-stop`);
    console.log(`  Data structure learned.`);
  } catch {
    console.log(`  Auto-learning in progress (will complete on next payload).`);
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log(' Meeting Intelligence - Make.com Setup');
  console.log('========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Org ID:   ${ORG_ID}`);

  // Step 1: Discovery
  const teamId = await discoverTeam();
  const m365 = await discoverConnection(teamId);

  // Step 2: SharePoint Scenario
  console.log(`\n--- Step 2: SharePoint Scenario ---`);
  const spHook = await createWebhook(teamId, 'Meeting Intelligence - SharePoint');
  const spScenarioId = await createScenario(teamId, 'Meeting Intelligence - Save to SharePoint', spHook.id);
  await teachWebhook(spHook.id, spHook.url);
  await activateScenario(spScenarioId);

  // Step 3: Teams Scenario
  console.log(`\n--- Step 3: Teams Scenario ---`);
  const teamsHook = await createWebhook(teamId, 'Meeting Intelligence - Teams');
  const teamsScenarioId = await createScenario(teamId, 'Meeting Intelligence - Post to Teams', teamsHook.id);
  await teachWebhook(teamsHook.id, teamsHook.url);
  await activateScenario(teamsScenarioId);

  // Step 4: Output
  console.log('\n========================================');
  console.log(' Setup Complete');
  console.log('========================================');

  console.log('\nAdd these to your .env.local:\n');
  console.log(`MAKE_SHAREPOINT_WEBHOOK_URL=${spHook.url}`);
  console.log(`MAKE_TEAMS_WEBHOOK_URL=${teamsHook.url}`);

  console.log('\nScenario IDs:');
  console.log(`  SharePoint: ${spScenarioId} (${BASE_URL}/scenarios/${spScenarioId})`);
  console.log(`  Teams:      ${teamsScenarioId} (${BASE_URL}/scenarios/${teamsScenarioId})`);

  if (m365) {
    console.log(`\nMicrosoft 365 Connection: "${m365.name}" (ID: ${m365.id})`);
  }

  console.log('\n--- Manual Steps in Make.com Editor ---\n');
  console.log('Each scenario has: Webhook -> Set Variable (folderPath)');
  console.log('The folderPath variable maps meetingType to folder:');
  console.log('  sales_discovery   -> /Sales/Meeting Notes/');
  console.log('  customer_support  -> /Support/Meeting Notes/');
  console.log('  internal_sync     -> /Internal/Meeting Notes/');
  console.log('');
  console.log('SharePoint scenario — add after Set Variable:');
  console.log('  1. Add "SharePoint > Upload a File" module');
  console.log(`     Wire connection: ${m365 ? `"${m365.name}" (ID: ${m365.id})` : 'create M365 connection first'}`);
  console.log('     Site: your SharePoint team site');
  console.log('     Folder: map to {{2.folderPath}}');
  console.log('     Filename: map to {{1.filename}}');
  console.log('     Content: map to {{1.markdown}}');
  console.log('');
  console.log('Teams scenario — add after Set Variable:');
  console.log('  1. Add "Microsoft Teams > Send a Message" module');
  console.log(`     Wire connection: ${m365 ? `"${m365.name}" (ID: ${m365.id})` : 'create M365 connection first'}`);
  console.log('     Channel: map based on meetingType or use one channel');
  console.log('     Message: format from {{1.title}}, {{1.markdown}}, {{1.actionItems}}');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
