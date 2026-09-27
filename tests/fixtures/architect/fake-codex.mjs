// Fake Codex CLI for tests/architect.test.js. Behaviour comes from MILO_FAKE_CODEX:
//   ok (default) | auth (signed out) | auth-call (says signed in, calls fail) | garbage | text |
//   partial | thin | hang | crash | echo-fail (echoes the brief to stderr the way the real
//   `codex exec` does, then a stream error) | echo-auth (the same, then a 401)
// MILO_FAKE_CREW_DELAY_MS makes a call take that long, like a real crew member thinking.
// Each run appends { crew, argv, cwd, cwdEntries, stdin, pid, nested, switches } to MILO_FAKE_CREW_LOG.

import fs from 'node:fs';
import { hangForever, logRun, payload, readStdin, thinkFor } from './crew-payloads.mjs';

const behaviour = process.env.MILO_FAKE_CODEX || 'ok';
const argv = process.argv.slice(2);
const cwdEntries = fs.readdirSync(process.cwd());
const nested = Boolean(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);

if (argv[0] === 'login') {
  await logRun(fs, { crew: 'codex', argv, cwd: process.cwd(), cwdEntries, stdin: '', pid: process.pid, nested });
  if (behaviour === 'auth') {
    process.stderr.write('Not logged in\n');
    process.exit(1);
  }
  process.stderr.write('Logged in using a made-up account\n');
  process.exit(0);
}

const stdin = await readStdin();
await logRun(fs, { crew: 'codex', argv, cwd: process.cwd(), cwdEntries, stdin, pid: process.pid, nested });
await thinkFor(process.env.MILO_FAKE_CREW_DELAY_MS);
const schemaFile = argv[argv.indexOf('--output-schema') + 1];
const outFile = argv[argv.indexOf('-o') + 1];
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
const kind = schema.properties && schema.properties.suggestions ? 'suggest' : 'design';

if (behaviour === 'hang') {
  hangForever();
} else if (behaviour === 'echo-fail' || behaviour === 'echo-auth') {
  // The real codex exec prints a header, then 'user' and the whole brief, then its own errors.
  process.stderr.write(`OpenAI Codex (fake)\n--------\nworkdir: ${process.cwd()}\n--------\nuser\n${stdin}\n`);
  process.stderr.write(behaviour === 'echo-auth'
    ? 'ERROR: unexpected status 401 Unauthorized: Missing bearer or basic authentication in header\n'
    : 'ERROR: stream disconnected before completion: error sending request for url\n');
  process.exit(1);
} else if (behaviour === 'crash') {
  process.stderr.write('Something went wrong inside the fake.\n');
  process.exit(3);
} else if (behaviour === 'auth' || behaviour === 'auth-call') {
  process.stderr.write('ERROR: unexpected status 401 Unauthorized: token expired, run codex login\n');
  process.exit(1);
} else if (behaviour === 'garbage') {
  fs.writeFileSync(outFile, 'I drew a lovely building but forgot to write it down.');
  process.stdout.write('I drew a lovely building but forgot to write it down.\n');
} else if (behaviour === 'text') {
  process.stdout.write(`${JSON.stringify(payload(kind, 'ok'))}\n`);
} else {
  const text = JSON.stringify(payload(kind, behaviour));
  fs.writeFileSync(outFile, text);
  process.stdout.write(`${text}\n`);
}
