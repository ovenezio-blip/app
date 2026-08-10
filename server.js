// Simple Express server exposing search and sync endpoints.
// Uses Meilisearch for search results and an in-process indexer for background sync.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MeiliSearch } = require('meilisearch');
const path = require('path');

const indexer = require('./indexer');

const PORT = process.env.PORT || 3000;
const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || 'masterKey';

const meili = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY });
const INDEX_NAME = 'apps';

async function ensureIndex() {
  try {
    const idx = await meili.getIndex(INDEX_NAME);
    return idx;
  } catch (err) {
    if (err && err.code === 'index_not_found') {
      return await meili.createIndex(INDEX_NAME, { primaryKey: 'id' });
    } else if (err && err.status === 404) {
      return await meili.createIndex(INDEX_NAME, { primaryKey: 'id' });
    } else {
      throw err;
    }
  }
}

async function main() {
  await ensureIndex();

  // configure searchable & displayed attributes
  const idx = meili.index(INDEX_NAME);
  await idx.updateSearchableAttributes(['name', 'full_name', 'description', 'topics', 'readme', 'platform', 'language']);
  await idx.updateDisplayedAttributes(['id','name','full_name','description','url','stars','language','license','platform','topics','updated_at']);
  await idx.updateRankingRules([
    'words',
    'typo',
    'proximity',
    'attribute',
    'exactness',
    'desc(stars)',
    'desc(updated_at)'
  ]).catch(()=>{});

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Search endpoint - queries Meilisearch
  app.get('/search', async (req, res) => {
    try {
      const q = (req.query.q || '').trim();
      const page = Math.max(0, parseInt(req.query.page) || 0);
      const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 20));
      if (!q) return res.status(400).json({ error: 'missing q parameter' });

      const searchOptions = {
        limit: per_page,
        offset: page * per_page,
        attributesToHighlight: ['description', 'readme'],
        attributesToCrop: ['readme'],
        cropLength: 200
      };

      const result = await idx.search(q, searchOptions);
      return res.json(result);
    } catch (err) {
      console.error('Search error', err);
      return res.status(500).json({ error: 'search_failed', details: err.message });
    }
  });

  // Trigger a full sync (runs an indexing job in background)
  app.post('/sync', async (req, res) => {
    try {
      indexer.startOnce(); // triggers background sync (non-blocking)
      return res.json({ status: 'sync_started' });
    } catch (err) {
      console.error('Sync trigger failed', err);
      return res.status(500).json({ error: 'sync_failed', details: err.message });
    }
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Start background periodic sync
  indexer.startPeriodic();

  app.listen(PORT, () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
