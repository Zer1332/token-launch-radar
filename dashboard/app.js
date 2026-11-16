/* Token Launch Radar — renders window.RADAR (board rows + live reference).
   Hash routes: #/ board, #/protocol/<slug> detail, #/?category=X&watchlist=1.
   Static page: no network calls, no outside resources. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var metaEl = document.getElementById('meta');

  function fail(msg) {
    app.innerHTML = '<div class="error"><h2>Board data not loaded</h2><p>' + msg + '</p></div>';
  }

  if (typeof window.RADAR !== 'object' || !window.RADAR || !Array.isArray(window.RADAR.rows)) {
    fail('window.RADAR is missing. This page reads its data from data.js next to ' +
      'the dashboard folder — open it through the built output, not on its own.');
    return;
  }

  var R = window.RADAR;
  var rows = R.rows;
  var live = Array.isArray(R.live) ? R.live : [];
  var model = R.model || {};
  var meta = R.meta || {};
  var total = rows.length;

  /* ---------- formatting ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function trimNum(x, dp) {
    var s = x.toFixed(dp);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /* $464.9M, $2.75B, $150K */
  function money(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v), s;
    if (a >= 1e12) s = trimNum(v / 1e12, 2) + 'T';
    else if (a >= 1e9) s = trimNum(v / 1e9, 2) + 'B';
    else if (a >= 1e6) s = trimNum(v / 1e6, 1) + 'M';
    else if (a >= 1e3) s = Math.round(v / 1e3) + 'K';
    else s = String(Math.round(v));
    return '$' + s;
  }

  function moneyExact(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return '$' + v.toLocaleString('en-US');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + trimNum(v, 1) + '%';
  }

  function pctClass(v) {
    if (v == null) return 'dim';
    return v > 0 ? 'up' : v < 0 ? 'down' : '';
  }

  function ageShort(d) {
    if (d == null) return '—';
    return d >= 365 ? trimNum(d / 365, 1) + 'y' : d + 'd';
  }

  function ageLong(d) {
    if (d == null) return 'Unknown';
    return d + ' days' + (d >= 365 ? ' (about ' + trimNum(d / 365, 1) + ' years)' : '');
  }

  function fmt4(v) { return trimNum(v, 4); }

  function chainsShort(c) {
    if (!c || !c.length) return '—';
    if (c.length <= 3) return c.map(esc).join(', ');
    return c.slice(0, 3).map(esc).join(', ') + ' +' + (c.length - 3);
  }

  /* ---------- state + routing ---------- */

  var state = { q: '', category: 'all', watchlist: false, sort: 'implied' };

  var knownCategories = {};
  rows.forEach(function (r) {
    knownCategories[r.category] = (knownCategories[r.category] || 0) + 1;
  });
  var categoryNames = Object.keys(knownCategories).sort();

  function parseHash() {
    var raw = (location.hash || '#/').slice(1);
    var qi = raw.indexOf('?');
    var path = (qi === -1 ? raw : raw.slice(0, qi)) || '/';
    var query = new URLSearchParams(qi === -1 ? '' : raw.slice(qi + 1));
    return { path: path, query: query };
  }

  function readUrlState(p) {
    var c = p.query.get('category');
    state.category = (c && knownCategories[c]) ? c : 'all';
    state.watchlist = p.query.get('watchlist') === '1';
  }

  function syncUrl() {
    var q = new URLSearchParams();
    if (state.category !== 'all') q.set('category', state.category);
    if (state.watchlist) q.set('watchlist', '1');
    var s = q.toString();
    history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
  }

  /* ---------- filtering + sorting ---------- */

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (state.watchlist && !r.watchlist) continue;
      if (state.category !== 'all' && r.category !== state.category) continue;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) continue;
      out.push(r);
    }
    var s = state.sort;
    if (s === 'tvl') out.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === 'change') out.sort(function (a, b) {
      var av = a.change_7d == null ? -Infinity : a.change_7d;
      var bv = b.change_7d == null ? -Infinity : b.change_7d;
      return bv - av;
    });
    else if (s === 'age') out.sort(function (a, b) {
      var av = a.age_days == null ? -1 : a.age_days;
      var bv = b.age_days == null ? -1 : b.age_days;
      return bv - av;
    });
    else out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function rowHTML(r) {
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num mono">' + r.rank + '</td>' +
      '<td class="name"><a href="#/protocol/' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' +
        (r.watchlist ? '<span class="badge">&#9733; Watchlist</span>' : '') + '</td>' +
      '<td class="cat">' + esc(r.category) + '</td>' +
      '<td class="chains col-chains">' + chainsShort(r.chains) + '</td>' +
      '<td class="num mono">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num col-age' + (r.age_days == null ? ' dim' : '') + '">' + ageShort(r.age_days) + '</td>' +
      '<td class="num mono">' + money(r.implied_value_usd) + '</td>' +
      '<td class="num mono col-peer">' + fmt4(r.peer_multiple) + '&times;</td>' +
      '</tr>';
  }

  function renderTable() {
    var list = filtered();
    var body = document.getElementById('rows');
    var counter = document.getElementById('counter');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr class="empty"><td colspan="9">No protocols match these filters. ' +
        'Clear the search or pick another category.</td></tr>';
    } else {
      body.innerHTML = list.map(rowHTML).join('');
    }
    counter.innerHTML = 'Showing <b>' + list.length + '</b> of ' + total +
      (list.length === total ? '' : ' &mdash; filtered');
  }

  /* ---------- board ---------- */

  function boardHTML() {
    var opts = '<option value="all">All categories (' + total + ')</option>' +
      categoryNames.map(function (c) {
        return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') +
          '>' + esc(c) + ' (' + knownCategories[c] + ')</option>';
      }).join('');

    var top10 = '<section><h2>Top 10 by implied value</h2><div class="top10">' +
      rows.slice(0, 10).map(function (r) {
        return '<a class="topcard" href="#/protocol/' + encodeURIComponent(r.slug) + '">' +
          '<span class="rk">#' + r.rank + '</span>' +
          '<span class="nm">' + esc(r.name) + '</span>' +
          '<span class="vl"><b>' + money(r.implied_value_usd) + '</b> &middot; TVL ' +
          money(r.tvl_usd) + '</span></a>';
      }).join('') + '</div></section>';

    var how = '<section><h2>How the ranking works</h2><dl class="howto">' +
      '<dt>Implied value</dt><dd><code>' + esc(model.implied || '') + '</code></dd>' +
      '<dt>Peer multiple</dt><dd>' + esc(model.peer_multiple || '') + '</dd>' +
      '<dt>Growth multiplier</dt><dd><code>' + esc(model.growth_multiplier || '') + '</code></dd>' +
      '<dt>Maturity multiplier</dt><dd><code>' + esc(model.maturity_multiplier || '') + '</code></dd>' +
      '<dt>Eligibility</dt><dd>' + esc(model.eligibility || '') + '</dd>' +
      '</dl>' +
      '<p class="note">A protocol records no token when its DefiLlama record carries none — ' +
      'that is not proof it has none. The board ranks what a launch might be worth, ' +
      'not whether one happens.</p></section>';

    var liveRows = live.map(function (p, i) {
      return '<tr><td class="num mono">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(p.name) + '</td>' +
        '<td class="cat">' + esc(p.category) + '</td>' +
        '<td class="num mono">' + money(p.mcap_usd) + '</td>' +
        '<td class="num mono">' + money(p.tvl_usd) + '</td>' +
        '<td class="num mono">' + trimNum(p.multiple, 2) + '&times;</td></tr>';
    }).join('');

    var liveSec = '<section><h2>Live reference &mdash; what the market actually pays</h2>' +
      '<p class="dim">The ' + live.length + ' largest tokened protocols by market cap. ' +
      'Their market-cap / TVL multiples are the peers this board is priced against.</p>' +
      '<table class="plain"><thead><tr><th class="num">#</th><th>Protocol</th><th>Category</th>' +
      '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">Multiple</th>' +
      '</tr></thead><tbody>' + liveRows + '</tbody></table></section>';

    return '<section>' +
      '<div class="controls">' +
        '<input type="search" id="q" placeholder="Search name or slug&hellip;" value="' +
          esc(state.q) + '" aria-label="Search protocols">' +
        '<select id="cat" aria-label="Filter by category">' + opts + '</select>' +
        '<label class="check"><input type="checkbox" id="wl"' +
          (state.watchlist ? ' checked' : '') + '> Watchlist only (' +
          (meta.watchlist_size || 0) + ')</label>' +
        '<select id="sort" aria-label="Sort by">' +
          '<option value="implied"' + (state.sort === 'implied' ? ' selected' : '') + '>Sort: implied value</option>' +
          '<option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>Sort: TVL</option>' +
          '<option value="change"' + (state.sort === 'change' ? ' selected' : '') + '>Sort: 7d change</option>' +
          '<option value="age"' + (state.sort === 'age' ? ' selected' : '') + '>Sort: age</option>' +
        '</select>' +
      '</div>' +
      '<p class="counter" id="counter"></p>' +
      '<table><thead><tr>' +
        '<th class="num">#</th><th>Protocol</th><th>Category</th>' +
        '<th class="col-chains">Chains</th><th class="num">TVL</th><th class="num">7d</th>' +
        '<th class="num col-age">Age</th><th class="num">Implied value</th>' +
        '<th class="num col-peer">Peer &times;</th>' +
      '</tr></thead><tbody id="rows"></tbody></table>' +
      '</section>' + top10 + how + liveSec;
  }

  function wireBoard() {
    document.getElementById('q').addEventListener('input', function (e) {
      state.q = e.target.value;
      renderTable();
    });
    document.getElementById('cat').addEventListener('change', function (e) {
      state.category = e.target.value;
      syncUrl();
      renderTable();
    });
    document.getElementById('wl').addEventListener('change', function (e) {
      state.watchlist = e.target.checked;
      syncUrl();
      renderTable();
    });
    document.getElementById('sort').addEventListener('change', function (e) {
      state.sort = e.target.value;
      renderTable();
    });
  }

  /* ---------- detail ---------- */

  function peerSource(r) {
    if (r.peer_category === 'global') {
      return 'Global median market-cap / TVL across tokened protocols &mdash; only ' +
        r.peer_count + ' tokened peer' + (r.peer_count === 1 ? '' : 's') + ' in ' +
        r.category + ', fewer than the 3 needed for a category median.';
    }
    return 'Median market-cap / TVL of the ' + r.peer_count +
      ' tokened protocols in ' + r.category + '.';
  }

  function growthSource(r) {
    var s = '7-day TVL change ' + pct(r.change_7d);
    if (r.change_7d == null) s += ' (unreported, counted as 0%)';
    else if (r.growth_pct !== r.change_7d) s += ' (clamped to the &minus;60&hellip;+120% range)';
    return s + '; 1 + (' + r.growth_pct + ' / 100) &times; 0.5.';
  }

  function maturitySource(r) {
    if (r.age_days == null) {
      return 'Age unknown &mdash; counted as 365 days: 0.6 + 0.4 &times; 365 / 1095.';
    }
    return r.age_days + ' days old: 0.6 + 0.4 &times; ' +
      Math.min(r.age_days, 1095) + ' / 1095.';
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].slug === slug) { r = rows[i]; break; }
    }
    if (!r) {
      document.title = 'Not found — Token Launch Radar';
      app.innerHTML = '<a class="back" href="#/">&larr; Back to the board</a>' +
        '<div class="error"><h2>Protocol not found</h2><p>No row on this board uses the slug ' +
        '&ldquo;' + esc(slug) + '&rdquo;.</p></div>';
      window.scrollTo(0, 0);
      return;
    }

    document.title = r.name + ' — Token Launch Radar';

    var stats =
      '<div class="stat"><div class="k">Rank</div><div class="v">#' + r.rank + ' <span class="dim">of ' + total + '</span></div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7d change</div><div class="v ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</div></div>' +
      '<div class="stat"><div class="k">Age</div><div class="v small">' + ageLong(r.age_days) + '</div></div>' +
      '<div class="stat"><div class="k">Peer multiple</div><div class="v">' + fmt4(r.peer_multiple) + '&times;</div></div>';

    var equation = money(r.tvl_usd) + ' &times; ' + fmt4(r.peer_multiple) + ' &times; ' +
      fmt4(r.growth_multiplier) + ' &times; ' + fmt4(r.maturity_multiplier) +
      ' &asymp; <b>' + money(r.implied_value_usd) + '</b>';

    var factors = '<ul class="factors">' +
      '<li><span class="fk">TVL</span><span class="fv">' + moneyExact(r.tvl_usd) + '</span>' +
        '<span class="fs">Total value locked at the snapshot date.</span></li>' +
      '<li><span class="fk">Peer multiple</span><span class="fv">' + fmt4(r.peer_multiple) + '&times;</span>' +
        '<span class="fs">' + peerSource(r) + '</span></li>' +
      '<li><span class="fk">Growth multiplier</span><span class="fv">' + fmt4(r.growth_multiplier) + '&times;</span>' +
        '<span class="fs">' + growthSource(r) + '</span></li>' +
      '<li><span class="fk">Maturity multiplier</span><span class="fv">' + fmt4(r.maturity_multiplier) + '&times;</span>' +
        '<span class="fs">' + maturitySource(r) + '</span></li>' +
      '</ul>';

    var steps = '<ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';

    app.innerHTML = '<div class="detail">' +
      '<a class="back" href="#/">&larr; Back to the board</a>' +
      '<h2>' + esc(r.name) +
        (r.watchlist ? '<span class="badge">&#9733; On the watchlist</span>' : '') + '</h2>' +
      '<p class="lede">' + esc(r.category) + ' &middot; ' +
        (r.watchlist ? 'On the watchlist (TVL at or above the $50M floor).' :
          'Early find &mdash; ranked from below the $50M watchlist floor.') + '</p>' +
      '<div class="stats">' + stats + '</div>' +
      '<ul class="chips">' + r.chains.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' +
      '<h3>How the implied value is built</h3>' +
      '<div class="equation">' + equation + '</div>' +
      factors +
      '<p class="note">Multipliers are shown rounded to 4 decimals, so the product is ' +
      'approximate. Peer multiples are clamped to 0.05&ndash;2.5.</p>' +
      '<h3>How to farm it</h3>' + steps +
      '<p><a href="#/">&larr; Back to the board</a></p>' +
      '</div>';
    window.scrollTo(0, 0);
  }

  /* ---------- init ---------- */

  metaEl.textContent = 'Snapshot ' + (meta.as_of || '—') + ' · ' + total +
    ' protocols ranked · ' + (meta.watchlist_size || 0) + ' on the watchlist · ' +
    'TVL floor ' + money(meta.floor_usd) + ' · model ' + (meta.model || '—');

  app.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== app) {
      if (t.tagName === 'TR' && t.getAttribute('data-slug')) {
        location.hash = '#/protocol/' + t.getAttribute('data-slug');
        return;
      }
      t = t.parentNode;
    }
  });

  function render() {
    var p = parseHash();
    if (p.path.indexOf('/protocol/') === 0) {
      renderDetail(decodeURIComponent(p.path.slice(10)));
    } else {
      readUrlState(p);
      document.title = 'Token Launch Radar — pre-token protocols, ranked by implied value';
      app.innerHTML = boardHTML();
      wireBoard();
      renderTable();
      window.scrollTo(0, 0);
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
