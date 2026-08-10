# OpenScout

Prototype application that indexes GitHub repositories (seed queries) into Meilisearch and exposes a simple search UI.

Files included:
- server.js: Express server and API endpoints
- indexer.js: background indexer that queries GitHub for seed queries and adds results to Meilisearch
- public/: frontend static files
- Dockerfile + docker-compose.yml to run Meilisearch + app
- .env.example for configuration

How to run (development)
1. Copy `.env.example` to `.env` and fill values (set GITHUB_TOKEN for higher rate limits).
2. Start Meilisearch locally (or with Docker):
   - Using Docker Compose: `docker-compose up --build`
   - Or run Meilisearch separately and start app: `npm ci` then `node server.js`
3. Open http://localhost:3000 and search (e.g. "music player").

Notes
- This is a prototype. For exhaustive coverage of "every open-source app" prefer GitHub BigQuery dataset and batch import pipelines.
- GitHub Search API is rate-limited; adjust `GITHUB_MAX_PAGES` and `SEED_QUERIES` in `.env`.
- Meilisearch master key is required; set via `MEILI_MASTER_KEY`.
