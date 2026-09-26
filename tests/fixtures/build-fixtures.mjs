// Builds the synthetic homes in tests/fixtures/claude-home and tests/fixtures/codex-home.
//
// Record shapes (field names, nesting, key order, file layout) mirror the real Claude Code and
// Codex files on Chris's PC as of Sept 2026. Every id, path and word of text here is made up.
// The checked-in output is what the tests read; rerun this only to change the fixtures:
//
//   node tests/fixtures/build-fixtures.mjs
//
// Timeline anchor used by tests: NOW = 2026-09-25T12:00:00.000Z.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(here, 'claude-home');
const CODEX = path.join(here, 'codex-home');

const iso = (value) => new Date(value).toISOString();
const secs = (value) => Math.floor(Date.parse(value) / 1000);

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function writeJsonl(file, records) {
  write(file, `${records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n')}\n`);
}

let counter = 0;
const uid = () => `f1f1f1f1-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

// ---------------------------------------------------------------------------------------------
// Claude home

export const CLAUDE_IDS = {
  done: 'aaaaaaaa-0000-4000-8000-000000000001',
  stopped: 'bbbbbbbb-0000-4000-8000-000000000002',
  recent: 'cccccccc-0000-4000-8000-000000000003',
  garden: 'dddddddd-0000-4000-8000-000000000004',
  untitled: 'eeeeeeee-0000-4000-8000-000000000005',
  liveable: 'ffffffff-0000-4000-8000-000000000006',
};

function claudeBase(session, ts) {
  return {
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    entrypoint: 'claude-desktop',
    cwd: session.cwd,
    sessionId: session.id,
    version: '2.9.0',
    gitBranch: 'HEAD',
    timestamp: iso(ts),
    uuid: uid(),
  };
}
const userMsg = (s, ts, text) => ({ ...claudeBase(s, ts), promptId: uid(), type: 'user', message: { role: 'user', content: text }, permissionMode: 'default' });
const toolResult = (s, ts, toolUseId, output) => ({
  ...claudeBase(s, ts),
  promptId: uid(),
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: output, is_error: false }] },
  toolUseResult: { stdout: output, stderr: '', interrupted: false, isImage: false },
  sourceToolAssistantUUID: uid(),
});
const assistantMsg = (s, ts, { msgId, blocks, stop, model = 'claude-demo-5', sidechain = false }) => ({
  ...claudeBase(s, ts),
  isSidechain: sidechain,
  type: 'assistant',
  requestId: `req_${msgId}`,
  effort: 'high',
  message: {
    model,
    id: msgId,
    type: 'message',
    role: 'assistant',
    content: blocks,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 8 },
  },
});
const text = (value) => ({ type: 'text', text: value });
const thinking = (value) => ({ type: 'thinking', thinking: value, signature: 'c2lnLWRlbW8=' });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const customTitle = (s, value) => ({ type: 'custom-title', customTitle: value, sessionId: s.id });
const aiTitle = (s, value) => ({ type: 'ai-title', aiTitle: value, sessionId: s.id });
const agentName = (s, value) => ({ type: 'agent-name', agentName: value, sessionId: s.id });
const lastPrompt = (s, value) => ({ type: 'last-prompt', lastPrompt: value, leafUuid: uid(), sessionId: s.id });
const stopHook = (s, ts) => ({
  ...claudeBase(s, ts),
  type: 'system',
  subtype: 'stop_hook_summary',
  hookCount: 1,
  hookInfos: [{ command: 'echo demo', durationMs: 3 }],
  hookErrors: [],
  preventedContinuation: false,
  stopReason: '',
  hasOutput: false,
  level: 'suggestion',
  toolUseID: uid(),
});
const hookAttachment = (s, ts) => ({
  ...claudeBase(s, ts),
  type: 'attachment',
  attachment: { type: 'hook_additional_context', content: ['Made-up hook context.'], hookName: 'SessionStart:startup', toolUseID: uid(), hookEvent: 'SessionStart' },
});
const snapshot = () => ({ type: 'file-history-snapshot', messageId: uid(), snapshot: { messageId: uid(), trackedFileBackups: {}, timestamp: iso('2026-09-20T00:00:00Z') }, isSnapshotUpdate: false });
const mode = (s) => ({ type: 'mode', mode: 'default', sessionId: s.id });
const queued = (s, ts) => ({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(ts), sessionId: s.id, content: 'Made-up queued note.' });

function buildClaude() {
  const demo = 'Z:\\Demo';
  const projects = path.join(CLAUDE, 'projects');
  const demoDir = path.join(projects, 'Z--Demo');

  // A: done. Titles: custom-title beats ai-title and agent-name; the newest custom-title wins.
  // Sidechain records carry later timestamps, another model and extra end_turns; all ignored.
  const A = { id: CLAUDE_IDS.done, cwd: demo };
  writeJsonl(path.join(demoDir, `${A.id}.jsonl`), [
    snapshot(),
    mode(A),
    hookAttachment(A, '2026-09-24T09:00:00Z'),
    userMsg(A, '2026-09-24T09:00:01Z', 'Help me tidy the demo garden folder.'),
    assistantMsg(A, '2026-09-24T09:00:05Z', { msgId: 'msg_demo_a1', blocks: [thinking('Made-up thinking.')], stop: 'tool_use' }),
    assistantMsg(A, '2026-09-24T09:00:06Z', { msgId: 'msg_demo_a1', blocks: [toolUse('toolu_demo_a1', 'Bash', { command: 'ls' })], stop: 'tool_use' }),
    toolResult(A, '2026-09-24T09:00:08Z', 'toolu_demo_a1', 'beds.md\nseeds.md'),
    assistantMsg(A, '2026-09-24T09:00:12Z', { msgId: 'msg_demo_a2', blocks: [thinking('More made-up thinking.')], stop: 'end_turn' }),
    assistantMsg(A, '2026-09-24T09:00:13Z', { msgId: 'msg_demo_a2', blocks: [text('Done. I grouped the seed packets by season.')], stop: 'end_turn' }),
    stopHook(A, '2026-09-24T09:00:14Z'),
    customTitle(A, 'Old garden name'),
    aiTitle(A, 'Tidy the demo garden'),
    agentName(A, 'garden-agent'),
    queued(A, '2026-09-24T09:09:59Z'),
    userMsg(A, '2026-09-24T09:10:00Z', 'Now label the shelves.'),
    assistantMsg(A, '2026-09-24T09:11:00Z', { msgId: 'msg_demo_side1', blocks: [text('Sidechain helper notes.')], stop: 'end_turn', model: 'claude-sidechain-demo', sidechain: true }),
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cut off mid-wri',
    assistantMsg(A, '2026-09-24T09:12:00Z', { msgId: 'msg_demo_a3', blocks: [text('Labels are on the shelves.')], stop: 'end_turn' }),
    stopHook(A, '2026-09-24T09:12:01Z'),
    assistantMsg(A, '2026-09-24T09:30:00Z', { msgId: 'msg_demo_side2', blocks: [text('Late sidechain chatter.')], stop: 'end_turn', model: 'claude-sidechain-demo', sidechain: true }),
    customTitle(A, 'Garden cleanup'),
    lastPrompt(A, 'Now label the shelves.'),
    'not json at all',
  ]);
  // Subagent transcripts and tool output live in a folder named after the session: skipped.
  const subDir = path.join(demoDir, A.id, 'subagents');
  writeJsonl(path.join(subDir, 'agent-a0b1c2d3e4f5a6b7.jsonl'), [
    { ...userMsg(A, '2026-09-24T09:40:00Z', 'Made-up subagent task.'), isSidechain: true, agentId: 'a0b1c2d3e4f5a6b7' },
    { ...assistantMsg(A, '2026-09-24T09:41:00Z', { msgId: 'msg_demo_sub1', blocks: [text('Made-up subagent reply.')], stop: 'end_turn', sidechain: true }), agentId: 'a0b1c2d3e4f5a6b7' },
  ]);
  write(path.join(subDir, 'agent-a0b1c2d3e4f5a6b7.meta.json'), `${JSON.stringify({ agentType: 'general-purpose', description: 'Made-up helper' })}\n`);
  write(path.join(demoDir, A.id, 'tool-results', 'toolu_demo_a1.txt'), 'Made-up tool output.\n');
  write(path.join(demoDir, 'memory', 'notes.md'), '# Made-up memory note\n');

  // B: stopped partway (last assistant is tool_use, long ago). Title from ai-title.
  const B = { id: CLAUDE_IDS.stopped, cwd: demo };
  writeJsonl(path.join(demoDir, `${B.id}.jsonl`), [
    userMsg(B, '2026-09-23T15:00:00Z', 'Read the soil log for me.'),
    assistantMsg(B, '2026-09-23T15:00:05Z', { msgId: 'msg_demo_b1', blocks: [text('Let me look at the soil log.')], stop: 'tool_use', model: 'claude-demo-5-mini' }),
    assistantMsg(B, '2026-09-23T15:00:06Z', { msgId: 'msg_demo_b1', blocks: [toolUse('toolu_demo_b1', 'Read', { file_path: 'Z:\\Demo\\soil.log' })], stop: 'tool_use', model: 'claude-demo-5-mini' }),
    toolResult(B, '2026-09-23T15:00:09Z', 'toolu_demo_b1', 'Made-up soil log.'),
    aiTitle(B, 'Read the soil log'),
    lastPrompt(B, 'Read the soil log for me.'),
  ]);

  // C: not live, last activity one minute before NOW, mid-turn -> working. Title from agent-name.
  const C = { id: CLAUDE_IDS.recent, cwd: demo };
  writeJsonl(path.join(demoDir, `${C.id}.jsonl`), [
    userMsg(C, '2026-09-25T11:50:00Z', 'Check the moisture sensors.'),
    assistantMsg(C, '2026-09-25T11:58:00Z', { msgId: 'msg_demo_c1', blocks: [text('Checking the moisture sensors now.')], stop: 'tool_use' }),
    assistantMsg(C, '2026-09-25T11:58:30Z', { msgId: 'msg_demo_c1', blocks: [toolUse('toolu_demo_c1', 'Bash', { command: 'sensors' })], stop: 'tool_use' }),
    toolResult(C, '2026-09-25T11:59:00Z', 'toolu_demo_c1', 'Made-up readings.'),
    agentName(C, 'soil-scout'),
  ]);

  // D: done, in another project folder. Title from last-prompt (first line). Long reply for snippet trimming.
  const D = { id: CLAUDE_IDS.garden, cwd: 'C:\\Users\\demo\\Projects\\Garden' };
  const longReply = [
    'Here is the plan for the spring beds.',
    '',
    '  Bed one:   peas,   radishes and   early lettuce.',
    'Bed two gets onions and garlic along the sunny edge, with marigolds tucked between the rows to keep pests guessing.',
    'Bed three waits for the soil to warm up, then takes beans, squash and a row of sunflowers at the back.',
    'Water lightly every other morning and mulch once the seedlings are a hand tall.',
  ].join('\n');
  writeJsonl(path.join(projects, 'C--Users-demo-Projects-Garden', `${D.id}.jsonl`), [
    userMsg(D, '2026-09-22T18:00:00Z', 'Plan the spring beds and list what to sow first.'),
    assistantMsg(D, '2026-09-22T18:01:00Z', { msgId: 'msg_demo_d1', blocks: [text(longReply)], stop: 'end_turn' }),
    lastPrompt(D, '\n  Plan the spring beds\nand list what to sow first'),
  ]);

  // E: no title records at all -> 'Untitled session'. Stopped.
  const E = { id: CLAUDE_IDS.untitled, cwd: demo };
  writeJsonl(path.join(demoDir, `${E.id}.jsonl`), [
    userMsg(E, '2026-09-21T08:00:00Z', 'Look at the pond pump.'),
    assistantMsg(E, '2026-09-21T08:00:05Z', { msgId: 'msg_demo_e1', blocks: [toolUse('toolu_demo_e1', 'Bash', { command: 'pump' })], stop: 'tool_use' }),
    toolResult(E, '2026-09-21T08:00:30Z', 'toolu_demo_e1', 'Made-up pump status.'),
  ]);

  // F: done when not live. Tests add a live registry entry (pid = test process) for it.
  const F = { id: CLAUDE_IDS.liveable, cwd: demo };
  writeJsonl(path.join(demoDir, `${F.id}.jsonl`), [
    userMsg(F, '2026-09-25T11:00:00Z', 'Start the watering schedule.'),
    assistantMsg(F, '2026-09-25T11:00:10Z', { msgId: 'msg_demo_f1', blocks: [text('Ready when you are.')], stop: 'end_turn' }),
    lastPrompt(F, 'Start the watering schedule'),
  ]);

  // Live registry: a stale entry (pid that can't be running) naming B, plus a .key sidecar.
  const registryEntry = {
    pid: 4194303,
    sessionId: B.id,
    cwd: demo,
    startedAt: Date.parse('2026-09-23T14:59:00Z'),
    procStart: '133000000000000000',
    version: '2.9.0',
    peerProtocol: 1,
    peerFeatures: ['demo'],
    kind: 'interactive',
    entrypoint: 'claude-desktop',
    hostSessionId: 'host-demo-0001',
    pidDomain: 'demo',
    messagingSocketPath: '\\\\.\\pipe\\demo-pipe',
    name: 'Stale soil run',
    nameSince: Date.parse('2026-09-23T14:59:30Z'),
    updatedAt: Date.parse('2026-09-23T15:00:09Z'),
    status: 'busy',
    statusUpdatedAt: Date.parse('2026-09-23T15:00:00Z'),
  };
  write(path.join(CLAUDE, 'sessions', '4194303.json'), `${JSON.stringify(registryEntry, null, 2)}\n`);
  write(path.join(CLAUDE, 'sessions', '4194303.0123abcd4567ef.key'), JSON.stringify({ peerToken: 'demo-token', procStartFt: '0', pidDomain: 'demo' }));

  // Jev router stats (field names match the real state.json).
  write(
    path.join(CLAUDE, 'jev-router', 'state.json'),
    `${JSON.stringify(
      {
        enabled: true,
        since: '2026-09-20T10:00:00Z',
        sent_to: { tiny: 2, everyday: 9, large: 3, hardest: 0 },
        claude_handled: { jev_unsure: 1, follow_up: 0 },
        skipped_without_jev: { short_or_slash: 4, looked_like_secret: 0 },
        went_silent: 0,
        jev_calls: 14,
        input_tokens: 5200,
        cost_usd: 0.00041,
      },
      null,
      2,
    )}\n`,
  );
}

// ---------------------------------------------------------------------------------------------
// Codex home

export const CODEX_IDS = {
  garden: '01a0e001-0000-7000-8000-000000000001',
  gardenSegment: '01a0e0a1-0000-7000-8000-0000000000a1',
  subagent: '01a0e002-0000-7000-8000-000000000002',
  review: '01a0e003-0000-7000-8000-000000000003',
  working: '01a0e004-0000-7000-8000-000000000004',
  aborted: '01a0e005-0000-7000-8000-000000000005',
  imported: '01a0e006-0000-7000-8000-000000000006',
  archived: '01a0e007-0000-7000-8000-000000000007',
  voice: '01a0e008-0000-7000-8000-000000000008',
};

function rollout(startOrdinal = 0) {
  let ordinal = startOrdinal;
  return (ts, type, payload) => ({ timestamp: iso(ts), ordinal: ordinal++, type, payload });
}
function sessionMeta({ id, sessionId = id, ts, cwd, threadSource, extra = {} }) {
  const payload = {
    session_id: sessionId,
    id,
    timestamp: iso(ts),
    cwd,
    originator: 'Codex Desktop',
    cli_version: '0.140.0-demo',
    source: 'vscode',
    model_provider: 'openai',
    base_instructions: { text: 'Made-up base instructions for the fixture.' },
    history_mode: 'full',
    multi_agent_version: 'v2',
    context_window: { max_tokens: 258400, auto_compact_tokens: 232560 },
  };
  if (threadSource) payload.thread_source = threadSource;
  return Object.assign(payload, extra);
}
const userItem = (value) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text: value }] });
const developerItem = (value) => ({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: value }] });
const assistantItem = (value, phase = 'final') => ({
  type: 'message',
  id: `msg_${uid()}`,
  role: 'assistant',
  content: [{ type: 'output_text', text: value, annotations: [] }],
  phase,
  internal_chat_message_metadata_passthrough: {},
});
const reasoningItem = () => ({ type: 'reasoning', id: `rs_${uid()}`, summary: [], encrypted_content: 'ZGVtbw==', internal_chat_message_metadata_passthrough: {} });
const functionCall = (callId) => ({ type: 'function_call', id: `fc_${uid()}`, name: 'shell_command', namespace: 'functions', arguments: '{"command":"ls"}', call_id: callId, internal_chat_message_metadata_passthrough: {} });
const functionOutput = (callId) => ({ type: 'function_call_output', id: `fco_${uid()}`, call_id: callId, output: 'beds.md\nseeds.md', internal_chat_message_metadata_passthrough: {} });
const customToolCall = (callId) => ({ type: 'custom_tool_call', id: `ctc_${uid()}`, status: 'completed', call_id: callId, name: 'apply_patch', input: '*** Begin Patch\n*** End Patch', internal_chat_message_metadata_passthrough: {} });
const customToolOutput = (callId) => ({ type: 'custom_tool_call_output', id: `ctco_${uid()}`, call_id: callId, output: [{ type: 'input_text', text: 'Made-up patch result.' }], internal_chat_message_metadata_passthrough: {} });
const taskStarted = (turnId, ts) => ({ type: 'task_started', turn_id: turnId, started_at: secs(ts), model_context_window: 258400, collaboration_mode_kind: 'default' });
const taskComplete = (turnId, startTs, doneTs, message) => ({
  type: 'task_complete',
  turn_id: turnId,
  last_agent_message: message,
  started_at: secs(startTs),
  completed_at: secs(doneTs),
  duration_ms: Date.parse(doneTs) - Date.parse(startTs),
  time_to_first_token_ms: 900,
});
const taskCompleteBare = (turnId, startTs) => ({ type: 'task_complete', turn_id: turnId, last_agent_message: null, started_at: secs(startTs) });
const turnAborted = (turnId, startTs, doneTs) => ({ type: 'turn_aborted', turn_id: turnId, reason: 'interrupted', started_at: secs(startTs), completed_at: secs(doneTs), duration_ms: Date.parse(doneTs) - Date.parse(startTs) });
const tokenCount = () => ({ type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 80 } }, rate_limits: null });
const settingsApplied = (threadId) => ({ type: 'thread_settings_applied', thread_id: threadId, thread_settings: { model: 'gpt-demo-codex', effort: 'medium' } });
const itemCompleted = (threadId, turnId, ts) => ({
  type: 'item_completed',
  thread_id: threadId,
  turn_id: turnId,
  item: { type: 'CommandExecution', id: `ce_${uid()}`, process_id: '4242', command: ['ls'], cwd: 'C:\\Users\\demo\\Projects\\Garden', parsed_cmd: [], source: 'agent', status: 'completed', stdout: 'beds.md', stderr: '', aggregated_output: 'beds.md', exit_code: 0, duration: { secs: 0, nanos: 5000 }, formatted_output: 'beds.md' },
  started_at_ms: Date.parse(ts) - 100,
  completed_at_ms: Date.parse(ts),
});
const turnContext = (turnId, cwd, model) => ({
  turn_id: turnId,
  root_turn_id: turnId,
  cwd,
  workspace_roots: [cwd],
  current_date: '2026-09-24',
  timezone: 'America/New_York',
  approval_policy: 'on-request',
  approvals_reviewer: 'user',
  sandbox_policy: { type: 'workspace-write' },
  permission_profile: {},
  model,
  comp_hash: 'demo',
  personality: 'friendly',
  collaboration_mode: { mode: 'default' },
  multi_agent_version: 'v2',
  realtime_active: false,
  effort: 'medium',
  summary: 'auto',
});
const envContext = (cwd) => userItem(`<environment_context>\n  <cwd>${cwd}</cwd>\n  <shell>powershell</shell>\n</environment_context>`);

function buildCodex() {
  const sessions = path.join(CODEX, 'sessions');
  const garden = 'C:\\Users\\demo\\Projects\\Garden';
  const I = CODEX_IDS;

  // T1: top-level thread, base file. Title comes from the index; first prompt is behind wrappers.
  let r = rollout(0);
  const t1Meta = sessionMeta({ id: I.garden, ts: '2026-09-24T14:00:00Z', cwd: garden, threadSource: 'user' });
  const t1Base = [
    r('2026-09-24T14:00:00Z', 'session_meta', t1Meta),
    r('2026-09-24T14:00:00.100Z', 'response_item', developerItem('<permissions instructions>Made-up developer note.</permissions instructions>')),
    r('2026-09-24T14:00:00.200Z', 'response_item', userItem('<recommended_plugins>\nnone for this made-up fixture\n</recommended_plugins>')),
    r('2026-09-24T14:00:00.300Z', 'response_item', envContext(garden)),
    r('2026-09-24T14:00:00.400Z', 'response_item', userItem('# AGENTS.md instructions for C:\\Users\\demo\\Projects\\Garden\n\nMade-up instructions.')),
    r('2026-09-24T14:00:01Z', 'response_item', userItem('# Files mentioned by the user:\n\n## beds.md: C:\\Users\\demo\\Projects\\Garden\\beds.md\n\n## My request:\nSketch the garden layout\nwith two paths')),
    r('2026-09-24T14:00:01.100Z', 'event_msg', settingsApplied(I.garden)),
    r('2026-09-24T14:00:01.200Z', 'turn_context', turnContext('turn-t1-1', garden, 'gpt-demo-codex')),
    r('2026-09-24T14:00:01.300Z', 'event_msg', taskStarted('turn-t1-1', '2026-09-24T14:00:01Z')),
    r('2026-09-24T14:00:03Z', 'response_item', reasoningItem()),
    r('2026-09-24T14:00:04Z', 'response_item', customToolCall('call_t1_a')),
    r('2026-09-24T14:00:05Z', 'response_item', customToolOutput('call_t1_a')),
    r('2026-09-24T14:00:06Z', 'response_item', functionCall('call_t1_b')),
    r('2026-09-24T14:00:07Z', 'response_item', functionOutput('call_t1_b')),
    r('2026-09-24T14:00:07.100Z', 'event_msg', itemCompleted(I.garden, 'turn-t1-1', '2026-09-24T14:00:07Z')),
    r('2026-09-24T14:04:59Z', 'response_item', assistantItem('The layout has two paths and four beds.')),
    r('2026-09-24T14:04:59.500Z', 'event_msg', tokenCount()),
    r('2026-09-24T14:05:00Z', 'event_msg', taskComplete('turn-t1-1', '2026-09-24T14:00:01Z', '2026-09-24T14:05:00Z', 'The layout has two paths and four beds.')),
    r('2026-09-24T14:05:00.100Z', 'token_usage_record', { input_tokens: 1200, output_tokens: 80 }),
    r('2026-09-24T14:05:00.200Z', 'world_state', { full: true, state: {} }),
  ];
  writeJsonl(path.join(sessions, '2026', '09', '24', `rollout-2026-09-24T10-00-00-${I.garden}.jsonl`), t1Base);

  // T1 continuation segment: same session_meta id, history_base points at the thread.
  const baseEnd = t1Base.length;
  r = rollout(baseEnd);
  writeJsonl(path.join(sessions, '2026', '09', '25', `rollout-2026-09-25T05-00-00-${I.garden}_${I.gardenSegment}.jsonl`), [
    r('2026-09-25T09:00:00Z', 'session_meta', sessionMeta({ id: I.garden, ts: '2026-09-25T09:00:00Z', cwd: garden, threadSource: 'user', extra: { history_base: { thread_id: I.garden, end_ordinal_exclusive: baseEnd, end_byte_offset: 9876 } } })),
    r('2026-09-25T09:00:00.100Z', 'response_item', envContext(garden)),
    r('2026-09-25T09:00:01Z', 'response_item', userItem('Add a bench by the pond')),
    r('2026-09-25T09:00:01.100Z', 'turn_context', turnContext('turn-t1-2', garden, 'gpt-demo-codex-2')),
    r('2026-09-25T09:00:01.200Z', 'event_msg', taskStarted('turn-t1-2', '2026-09-25T09:00:01Z')),
    r('2026-09-25T09:02:59Z', 'response_item', assistantItem('The bench sits by the pond now.')),
    r('2026-09-25T09:03:00Z', 'event_msg', taskCompleteBare('turn-t1-2', '2026-09-25T09:00:01Z')),
  ]);

  // Subagent of T1: its own meta on line 1, then a copy of the parent's meta. Excluded.
  r = rollout(0);
  writeJsonl(path.join(sessions, '2026', '09', '24', `rollout-2026-09-24T10-10-00-${I.subagent}.jsonl`), [
    r('2026-09-24T14:10:00Z', 'session_meta', sessionMeta({
      id: I.subagent,
      sessionId: I.garden,
      ts: '2026-09-24T14:10:00Z',
      cwd: garden,
      threadSource: 'subagent',
      extra: {
        source: { subagent: { thread_spawn: { parent_thread_id: I.garden, depth: 1, agent_path: '/root/fern', agent_nickname: 'Fern', agent_role: 'worker' } } },
        parent_thread_id: I.garden,
        forked_from_id: I.garden,
        agent_nickname: 'Fern',
        agent_path: '/root/fern',
        subagent_history_start_ordinal: 4,
      },
    })),
    r('2026-09-24T14:10:00.100Z', 'session_meta', t1Meta),
    r('2026-09-24T14:10:01Z', 'event_msg', taskStarted('turn-sub-1', '2026-09-24T14:10:01Z')),
    r('2026-09-24T14:10:02Z', 'response_item', assistantItem('Made-up subagent progress.')),
    r('2026-09-25T11:59:00Z', 'event_msg', taskStarted('turn-sub-2', '2026-09-25T11:59:00Z')),
  ]);

  // Review thread of T1 (thread_source guardian_review). Excluded.
  r = rollout(0);
  writeJsonl(path.join(sessions, '2026', '09', '24', `rollout-2026-09-24T10-20-00-${I.review}.jsonl`), [
    r('2026-09-24T14:20:00Z', 'session_meta', sessionMeta({
      id: I.review,
      sessionId: I.garden,
      ts: '2026-09-24T14:20:00Z',
      cwd: garden,
      threadSource: 'guardian_review',
      extra: { source: { subagent: { other: 'guardian' } }, parent_thread_id: I.garden },
    })),
    r('2026-09-24T14:20:01Z', 'event_msg', taskStarted('turn-rev-1', '2026-09-24T14:20:01Z')),
    r('2026-09-24T14:20:30Z', 'event_msg', taskComplete('turn-rev-1', '2026-09-24T14:20:01Z', '2026-09-24T14:20:30Z', 'Made-up review verdict.')),
  ]);

  // T2: mid-turn (task_started, no completion). Working if the file changed in the last 10 minutes.
  r = rollout(0);
  writeJsonl(path.join(sessions, '2026', '09', '25', `rollout-2026-09-25T07-40-00-${I.working}.jsonl`), [
    r('2026-09-25T11:40:00Z', 'session_meta', sessionMeta({ id: I.working, ts: '2026-09-25T11:40:00Z', cwd: garden, threadSource: 'user' })),
    r('2026-09-25T11:40:00.100Z', 'response_item', envContext(garden)),
    r('2026-09-25T11:40:01Z', 'response_item', userItem('Water the tomatoes on a timer')),
    r('2026-09-25T11:40:01.100Z', 'turn_context', turnContext('turn-t2-1', garden, 'gpt-demo-codex')),
    r('2026-09-25T11:40:01.200Z', 'event_msg', taskStarted('turn-t2-1', '2026-09-25T11:40:01Z')),
    r('2026-09-25T11:40:05Z', 'response_item', reasoningItem()),
    r('2026-09-25T11:41:00Z', 'response_item', assistantItem('Setting up the timer now.', 'commentary')),
    r('2026-09-25T11:41:01Z', 'response_item', functionCall('call_t2_a')),
    r('2026-09-25T11:41:02Z', 'response_item', functionOutput('call_t2_a')),
  ]);

  // T3: last turn aborted -> stopped. No index entry: title from the first real prompt.
  r = rollout(0);
  writeJsonl(path.join(sessions, '2026', '09', '23', `rollout-2026-09-23T12-00-00-${I.aborted}.jsonl`), [
    r('2026-09-23T16:00:00Z', 'session_meta', sessionMeta({ id: I.aborted, ts: '2026-09-23T16:00:00Z', cwd: 'Z:\\Demo', threadSource: 'user' })),
    r('2026-09-23T16:00:00.100Z', 'response_item', userItem('<recommended_plugins>\nnone\n</recommended_plugins>')),
    r('2026-09-23T16:00:00.200Z', 'response_item', envContext('Z:\\Demo')),
    r('2026-09-23T16:00:01Z', 'response_item', userItem('Check the soil sensor readings\nand summarize them')),
    r('2026-09-23T16:00:01.100Z', 'event_msg', taskStarted('turn-t3-1', '2026-09-23T16:00:01Z')),
    r('2026-09-23T16:01:00Z', 'response_item', assistantItem('Readings look steady.')),
    r('2026-09-23T16:01:01Z', 'event_msg', taskComplete('turn-t3-1', '2026-09-23T16:00:01Z', '2026-09-23T16:01:01Z', 'Readings look steady.')),
    r('2026-09-23T16:05:00Z', 'response_item', userItem('Now chart them')),
    r('2026-09-23T16:05:00.100Z', 'event_msg', taskStarted('turn-t3-2', '2026-09-23T16:05:00Z')),
    '{"timestamp":"2026-09-23T16:05:30.000Z","ordinal":99,"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-t3-2","last_agent_mess',
    r('2026-09-23T16:06:00Z', 'event_msg', turnAborted('turn-t3-2', '2026-09-23T16:05:00Z', '2026-09-23T16:06:00Z')),
  ]);

  // T4: imported thread (no thread_source). Record timestamps are the import time;
  // completed_at keeps the original time. Title from external_agent_session_imports.json.
  r = rollout(0);
  const importTs = '2026-09-06T17:36:54.300Z';
  writeJsonl(path.join(sessions, '2026', '09', '06', `rollout-2026-09-06T13-36-54-${I.imported}.jsonl`), [
    r(importTs, 'session_meta', sessionMeta({ id: I.imported, ts: importTs, cwd: 'Z:\\Demo' })),
    r('2026-09-06T17:36:54.301Z', 'response_item', userItem('<command-message>tidy is running…</command-message>\n<command-name>/tidy</command-name>')),
    r('2026-09-06T17:36:54.302Z', 'response_item', userItem('Sort the seed tins by colour')),
    r('2026-09-06T17:36:54.303Z', 'event_msg', taskStarted('turn-t4-1', '2026-08-20T10:00:00Z')),
    r('2026-09-06T17:36:54.304Z', 'response_item', assistantItem('Seed tins sorted.')),
    r('2026-09-06T17:36:54.305Z', 'event_msg', taskComplete('turn-t4-1', '2026-08-20T10:00:00Z', '2026-08-20T10:05:00Z', 'Seed tins sorted.')),
  ]);

  // T5: archived thread.
  r = rollout(0);
  writeJsonl(path.join(CODEX, 'archived_sessions', `rollout-2026-09-10T08-00-00-${I.archived}.jsonl`), [
    r('2026-09-10T12:00:00Z', 'session_meta', sessionMeta({ id: I.archived, ts: '2026-09-10T12:00:00Z', cwd: 'Z:\\Compost', threadSource: 'user' })),
    r('2026-09-10T12:00:01Z', 'response_item', userItem('Summarize the compost notes')),
    r('2026-09-10T12:00:01.100Z', 'event_msg', taskStarted('turn-t5-1', '2026-09-10T12:00:01Z')),
    r('2026-09-10T12:02:00Z', 'response_item', assistantItem('Turn the pile weekly.')),
    r('2026-09-10T12:02:01Z', 'event_msg', taskComplete('turn-t5-1', '2026-09-10T12:00:01Z', '2026-09-10T12:02:01Z', 'Turn the pile weekly.')),
  ]);

  // T6: voice chat thread, no lifecycle events.
  r = rollout(0);
  writeJsonl(path.join(sessions, '2026', '09', '10', `rollout-2026-09-10T18-00-33-${I.voice}.jsonl`), [
    r('2026-09-10T22:00:33Z', 'session_meta', sessionMeta({ id: I.voice, ts: '2026-09-10T22:00:33Z', cwd: 'C:\\Users\\demo\\Documents\\Codex\\realtime-voice-chat', threadSource: 'voice_chat' })),
    r('2026-09-10T22:00:35Z', 'realtime_item', { type: 'realtime_session_started', session_id: 'rt-demo-1' }),
    r('2026-09-10T22:00:38Z', 'realtime_item', { type: 'realtime_session_closed', session_id: 'rt-demo-1' }),
  ]);

  // session_index.jsonl: renames append lines; the newest updated_at wins (not the last line).
  writeJsonl(path.join(CODEX, 'session_index.jsonl'), [
    { id: I.garden, thread_name: 'Garden layout plan', updated_at: '2026-09-24T14:02:00.1234567Z' },
    { id: I.working, thread_name: 'Tomato watering', updated_at: '2026-09-25T11:40:04.5550001Z' },
    '{"id":"broken line',
    { id: I.archived, thread_name: 'Compost notes', updated_at: '2026-09-10T12:00:03.0000001Z' },
    { id: I.voice, thread_name: 'Voice note', updated_at: '2026-09-10T22:00:36.6082746Z' },
    { id: I.voice, thread_name: 'Voice notes', updated_at: '2026-09-10T22:00:43.262929Z' },
    { id: I.garden, thread_name: 'Garden sketch', updated_at: '2026-09-24T14:00:05.0000000Z' },
  ]);

  write(
    path.join(CODEX, 'external_agent_session_imports.json'),
    `${JSON.stringify(
      {
        records: [
          {
            source_path: 'C:\\Users\\demo\\AppData\\Roaming\\Demo\\sessions\\9f9f9f9f-0000-4000-8000-000000000009.jsonl',
            content_sha256: '0'.repeat(64),
            imported_thread_id: I.imported,
            imported_at: secs(importTs),
            source_modified_at: Date.parse('2026-08-20T10:05:00Z') * 1e6,
            connector_names: [],
            title: 'Imported seed sorting',
          },
        ],
        detected_connector_records: [],
      },
      null,
      2,
    )}\n`,
  );
}

// ---------------------------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  fs.rmSync(CLAUDE, { recursive: true, force: true });
  fs.rmSync(CODEX, { recursive: true, force: true });
  buildClaude();
  buildCodex();
  console.log('Fixtures written to', path.relative(process.cwd(), here) || '.');
}
