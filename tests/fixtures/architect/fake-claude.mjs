// Fake Claude Code CLI for tests/architect.test.js. Behaviour comes from MILO_FAKE_CLAUDE:
//   ok (default) | auth (signed out) | auth-call (says signed in, calls fail) | garbage | text |
//   partial | thin | hang | crash
// MILO_FAKE_CREW_DELAY_MS makes a call take that long, like a real crew member thinking.
// Each run appends { crew, argv, cwd, cwdEntries, stdin, pid, nested, switches } to MILO_FAKE_CREW_LOG.

import fs from 'node:fs';
import { hangForever, logRun, payload, readStdin, thinkFor } from './crew-payloads.mjs';

const behaviour = process.env.MILO_FAKE_CLAUDE || 'ok';
const argv = process.argv.slice(2);
const cwdEntries = fs.readdirSync(process.cwd());
const nested = Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);

if (argv[0] === 'auth') {
  await logRun(fs, { crew: 'claude', argv, cwd: process.cwd(), cwdEntries, stdin: '', pid: process.pid, nested });
  const loggedIn = behaviour !== 'auth';
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' }, null, 2)}\n`);
  process.exit(loggedIn ? 0 : 1);
}

const stdin = await readStdin();
await logRun(fs, { crew: 'claude', argv, cwd: process.cwd(), cwdEntries, stdin, pid: process.pid, nested });
await thinkFor(process.env.MILO_FAKE_CREW_DELAY_MS);
const schemaText = argv[argv.indexOf('--json-schema') + 1] || '{}';
const kind = JSON.parse(schemaText).properties && JSON.parse(schemaText).properties.suggestions ? 'suggest' : 'design';

if (behaviour === 'hang') {
  hangForever();
} else if (behaviour === 'crash') {
  process.stderr.write('Something went wrong inside the fake.\n');
  process.exit(3);
} else if (behaviour === 'auth' || behaviour === 'auth-call') {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}' })}\n`);
  process.exit(1);
} else if (behaviour === 'garbage') {
  process.stdout.write('I drew a lovely building but forgot to write it down.\n');
} else if (behaviour === 'text') {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `Here it is:\n\`\`\`json\n${JSON.stringify(payload(kind, 'ok'))}\n\`\`\`` })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: payload(kind, behaviour) })}\n`);
}
