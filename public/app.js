// Frontend logic for the simple search UI
async function doSearch() {
  const q = document.getElementById('q').value.trim();
  const resultsEl = document.getElementById('results');
  if (!q) {
    resultsEl.innerHTML = '<div>Please enter a search term.</div>';
    return;
  }
  resultsEl.innerHTML = '<div>Searching…</div>';
  try {
    const res = await fetch('/search?q=' + encodeURIComponent(q) + '&per_page=30');
    if (!res.ok) {
      const err = await res.json();
      resultsEl.innerText = 'Search error: ' + (err && err.error ? err.error : res.statusText);
      return;
    }
    const data = await res.json();
    if (!data.hits || data.hits.length === 0) {
      resultsEl.innerHTML = '<div>No results.</div>';
      return;
    }
    const html = data.hits.map(h => {
      const desc = h.description || (h._formatted && h._formatted.description) || '';
      const readme = (h._formatted && h._formatted.readme) ? `<div class="desc">${h._formatted.readme}</div>` : '';
      const topics = (h.topics || []).slice(0,6).map(t => `<span class="tag">${t}</span>`).join('');
      return `
        <div class="result">
          <div><a href="${h.url}" target="_blank" rel="noopener noreferrer"><strong>${h.full_name || h.name}</strong></a></div>
          <div class="desc">${desc}</div>
          ${readme}
          <div class="meta">⭐ ${h.stars || 0} • ${h.language || '—'} • ${h.license || 'no license listed'} • ${h.platform || '—'}</div>
          <div style="margin-top:6px">${topics}</div>
        </div>
      `;
    }).join('');
    resultsEl.innerHTML = html;
  } catch (err) {
    resultsEl.innerText = 'Search failed: ' + err.message;
  }
}

document.getElementById('go').addEventListener('click', doSearch);
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
