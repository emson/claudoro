#!/usr/bin/env node
/**
 * Claudoro CLI entry point.
 *
 * Fast path for statusline: avoids loading the full CLI module (which imports
 * timer, history, setup, etc.) to keep the per-second cold-start cost minimal.
 *
 * All other verbs go through the full dispatcher in src/cli.js.
 */

// Fast path: statusline is invoked every second by Claude Code
if (process.argv[2] === 'statusline') {
  const { render } = await import('../src/statusline.js');
  await render();
  process.exit(0);
}

const { main } = await import('../src/cli.js');

main(process.argv.slice(2)).catch((err) => {
  console.error(`[claudoro] ${err.message}`);
  process.exit(1);
});
