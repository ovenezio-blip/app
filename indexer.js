// Indexer: queries GitHub Search API for a set of seed queries and pushes results to Meilisearch.
// - Respects per-page and max-pages settings from env
// - Runs periodically (SYNC_INTERVAL_MS) and exposes a startOnce() for on-demand trigger
// NOTE: This is a pragmatic indexer for demo/prototype purposes. For large-scale indexing use BigQuery / GH Archive.

require('dotenv').config();
const fetch = require('node-fetch');
const { MeiliSearch } = require('meilisearch');

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700';
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || 'masterKey';
const meili = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY });
const INDEX_NAME = 'apps';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '3600000', 10);
const PER_PAGE = parseInt(process.env.GITHUB_PER_PAGE || '30', 10);
const MAX_PAGES = Math.max(1, Math.min(10, parseInt(process.env.GITHUB_MAX_PAGES || '5', 10)));
const SEED_QUERIES = (process.env.SEED_QUERIES || 'music player').split(',').map(s=>s.trim()).filter(Boolean);

// Small helper to wait
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let running = false;
let lastRunAt = null;

async function searchGithub(q, page=1, per_page=30) {
  // q already encoded or raw? We'll encode here.
  const query = encodeURIComponent(`${q} in:name,description,readme`);
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${per_page}&page=${page}`;
  const headers = { Accept: 'application/vnd.github+json' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset');
    const now = Math.floor(Date.now()/1000);
    const waitSec = reset ? Math.max(30, reset - now) : 60;
    throw new Error(`GitHub rate limited. Retry after ${waitSec} seconds`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub search failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data;
}

function mapRepoToDoc(repo) {
  return {
    id: String(repo.id),
    name: repo.name || '',
    full_name: repo.full_name || '',
    description: repo.description || '',
    url: repo.html_url,
    stars: repo.stargazers_count || 0,
    language: repo.language || null,
    license: repo.license ? (repo.license.spdx_id || repo.license.name) : null,
    topics: repo.topics || [],
    platform: detectPlatform(repo),
    updated_at: repo.updated_at || repo.pushed_at || null
    // readme: (not fetched to reduce API calls)
  };
}

function detectPlatform(repo) {
  // Heuristic based on name/description/language/topics
  const desc = (repo.description || '').toLowerCase();
  const name = (repo.name || '').toLowerCase();
  const lang = (repo.language || '').toLowerCase();
  const topics = (repo.topics || []).map(t=>t.toLowerCase());

  if (desc.includes('android') || name.includes('android') || topics.includes('android') || lang === 'java' || lang === 'kotlin') return 'android';
  if (desc.includes('ios') || name.includes('ios') || topics.includes('ios') || lang === 'swift' || lang === 'objective-c') return 'ios';
  if (desc.includes('electron') || topics.includes('electron')) return 'desktop';
  if (desc.includes('web') || lang === 'javascript' || lang === 'typescript' || topics.includes('web')) return 'web';
  return 'unknown';
}

async function indexDocs(docs) {
  if (!docs || !docs.length) return;
  const index = meili.index(INDEX_NAME);
  // Use addDocuments for upsert behavior
  await index.addDocuments(docs);
}

async function runOnce() {
  if (running) {
    console.log('Indexer already running');
    return;
  }
  running = true;
  lastRunAt = new Date().toISOString();
  console.log(`[indexer] start: ${lastRunAt}`);
  try {
    for (const q of SEED_QUERIES) {
      console.log(`[indexer] query="${q}"`);
      for (let page = 1; page <= MAX_PAGES; page++) {
        try {
          const data = await searchGithub(q, page, PER_PAGE);
          const items = (data.items || []);
          if (!items.length) break;
          // Map items
          const docs = items.map(mapRepoToDoc);
          await indexDocs(docs);
          console.log(`[indexer] indexed ${docs.length} items for "${q}" page ${page}`);
          // Basic courtesy delay between GitHub requests
          await wait(500);
          // If fewer than per_page results, we're at the end
          if (items.length < PER_PAGE) break;
        } catch (err) {
          console.error(`[indexer] search error for "${q}" page ${page}:`, err.message);
          // If rate limited, abort early; caller will run again later
          if (err.message && err.message.toLowerCase().includes('rate limit')) {
            throw err;
          }
          // otherwise continue with next page/query
          break;
        }
      }
      // Short pause between queries
      await wait(500);
    }
    console.log('[indexer] finished');
  } catch (err) {
    console.error('[indexer] aborted with error:', err.message || err);
  } finally {
    running = false;
  }
}

let periodicHandle = null;

function startPeriodic() {
  const ms = Number(process.env.SYNC_INTERVAL_MS) || 3600000;
  // Start an immediate run, then schedule
  runOnce().catch(e=>console.error('initial index failed', e));
  if (periodicHandle) clearInterval(periodicHandle);
  periodicHandle = setInterval(() => {
    runOnce().catch(e=>console.error('periodic index failed', e));
  }, ms);
  console.log(`[indexer] periodic started (interval ${ms} ms)`);
}

function startOnce() {
  runOnce().catch(e=>console.error('manual index failed', e));
}

module.exports = {
  startPeriodic,
  startOnce,
  runOnce
};
