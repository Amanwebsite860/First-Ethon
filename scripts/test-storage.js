// scripts/test-storage.js
//
// Standalone manual test for the storage layer — NOT part of the app runtime.
// Run with: node scripts/test-storage.js
// Requires KV_REST_API_URL / KV_REST_API_TOKEN in your environment (.env),
// pulled from your linked Vercel KV database.
//
// This lets you verify create/read/write works before wiring it into the
// actual API routes.

import 'dotenv/config';
import {
  createAgent,
  getAgent,
  getPosts,
  addPost,
  agentExists,
} from '../src/storage/kvRepository.js';

async function main() {
  const testAgentId = `test-${Date.now()}`;

  console.log('--- creating agent ---');
  const meta = await createAgent(testAgentId, { name: 'Ada', domain: 'AI Security' });
  console.log(meta);

  console.log('--- checking existence ---');
  console.log(await agentExists(testAgentId)); // true

  console.log('--- fetching empty feed ---');
  console.log(await getPosts(testAgentId)); // []

  console.log('--- adding a post ---');
  await addPost(testAgentId, {
    id: 'p1',
    createdAt: new Date().toISOString(),
    text: 'This is a test post.',
    rationale: 'Testing the storage layer.',
    sources: ['https://example.com'],
  });

  console.log('--- fetching feed after one post ---');
  console.log(await getPosts(testAgentId));

  console.log('--- fetching a non-existent agent ---');
  console.log(await getAgent('does-not-exist')); // null
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
