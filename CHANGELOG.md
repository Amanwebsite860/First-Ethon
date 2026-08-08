# Changelog

All notable progress on this project, in build order.

## [Unreleased]

### Added
- Project scaffold: folder structure, `package.json`, `.gitignore`, `.env.example`, `README.md`
- Vercel KV storage layer (`src/storage/kvRepository.js`): `createAgent`, `getAgent`, `getPosts`, `addPost`, `agentExists`
- Standalone storage test script (`scripts/test-storage.js`, run via `npm run test:storage`)
