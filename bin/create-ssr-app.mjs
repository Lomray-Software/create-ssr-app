#!/usr/bin/env node

const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `Error: Unsupported Node.js ${process.versions.node}; @lomray/create-ssr-app requires Node.js >=22.12.0.`,
  );
  process.exitCode = 1;
} else {
  try {
    const { run } = await import('../lib/index.js');

    process.exitCode = await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Error: ${message.replace(/[\r\n\x1b]+/g, ' ').replace(/[.!]+$/, '')}.`);
    process.exitCode = 2;
  }
}
