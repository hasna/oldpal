#!/usr/bin/env bun
/**
 * Test script to verify agent functionality without TTY requirements
 */

import { EmbeddedClient } from '@hasna/assistants-core';
import type { StreamChunk } from '@hasna/assistants-shared';

async function main() {
  console.log('=== Hasna Assistant Agent Test ===\n');

  const client = new EmbeddedClient(process.cwd());

  let responseText = '';
  let toolCalls: string[] = [];
  let error: string | null = null;

  // Set up callbacks
  client.onChunk((chunk: StreamChunk) => {
    if (chunk.type === 'text' && chunk.content) {
      process.stdout.write(chunk.content);
      responseText += chunk.content;
    } else if (chunk.type === 'tool_use' && chunk.toolCall) {
      console.log(`\n[Tool call: ${chunk.toolCall.name}]`);
      toolCalls.push(chunk.toolCall.name);
    } else if (chunk.type === 'tool_result' && chunk.toolResult) {
      console.log(`[Tool result: ${chunk.toolResult.content.slice(0, 100)}...]`);
    } else if (chunk.type === 'error' && chunk.error) {
      console.error(`\n[Error: ${chunk.error}]`);
      error = chunk.error;
    } else if (chunk.type === 'done') {
      console.log('\n[Done]');
    }
  });

  client.onError((err: Error) => {
    console.error(`\n[Client error: ${err.message}]`);
    error = err.message;
  });

  // Initialize
  console.log('1. Initializing client...');
  try {
    await client.initialize();
    console.log('   ✓ Client initialized\n');
  } catch (e) {
    console.error(`   ✗ Failed to initialize: ${e}`);
    process.exit(1);
  }

  // List tools
  console.log('2. Available tools:');
  const tools = await client.getTools();
  for (const tool of tools.slice(0, 10)) {
    console.log(`   - ${tool.name}: ${tool.description.slice(0, 60)}...`);
  }
  if (tools.length > 10) {
    console.log(`   ... and ${tools.length - 10} more`);
  }
  console.log(`   ✓ Total: ${tools.length} tools\n`);

  // List skills
  console.log('3. Available skills:');
  const skills = await client.getSkills();
  if (skills.length === 0) {
    console.log('   (no skills loaded)');
  } else {
    for (const skill of skills) {
      console.log(`   - /${skill.name}: ${skill.description}`);
    }
  }
  console.log(`   ✓ Total: ${skills.length} skills\n`);

  // Test a simple message
  const testMessage = process.argv[2] || 'Say "Hello from assistants!" in exactly 5 words.';
  console.log(`4. Sending test message: "${testMessage}"`);
  console.log('   Response:');
  console.log('   ---');

  try {
    await client.send(testMessage);
  } catch (e) {
    console.error(`   ✗ Failed to send message: ${e}`);
    process.exit(1);
  }

  console.log('   ---\n');

  // Summary
  console.log('=== Test Summary ===');
  console.log(`Tools available: ${tools.length}`);
  console.log(`Skills available: ${skills.length}`);
  console.log(`Tool calls made: ${toolCalls.length > 0 ? toolCalls.join(', ') : 'none'}`);
  console.log(`Response length: ${responseText.length} chars`);
  console.log(`Errors: ${error || 'none'}`);
  console.log(`Status: ${error ? 'FAILED' : 'PASSED'}`);

  process.exit(error ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
