// A long-lived process that a fake crew root starts, like a shell command a crew CLI runs.
// Writes its pid to MILO_TREE_LOG, then idles until it is stopped (or two minutes pass).
import fs from 'node:fs';

if (process.env.MILO_TREE_LOG) fs.appendFileSync(process.env.MILO_TREE_LOG, `${process.pid}\n`);
setTimeout(() => process.exit(0), 120 * 1000);
