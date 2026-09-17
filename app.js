const state = {
  data: null,
  cy: null,
  year: 1910,
  allTime: false,
  hideInactive: false,
  entityTypes: new Set(),
  relationTypes: new Set(),
  minGrade: 'C',
  selectedPath: null,
  selectedEntityId: null
};

const gradeRank = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const gradeLabel = {
  A: 'Primary evidence',
  B: 'Strongly corroborated',
  C: 'Credible secondary evidence',
  D: 'Inference',
  E: 'Unverified lead'
};
const typeMeta = {
  person: { label: 'People', color: '#83aefc', border: '#b8d0ff', shape: 'ellipse' },
  bank: { label: 'Banks', color: '#d4aa62', border: '#f0cf8d', shape: 'round-rectangle' },
  company: { label: 'Companies', color: '#d17c85', border: '#f1adb5', shape: 'round-rectangle' },
  government: { label: 'Government', color: '#68b58b', border: '#9ee0bd', shape: 'hexagon' },
  foundation: { label: 'Foundations', color: '#9b82d0', border: '#c5b3ef', shape: 'diamond' },
  event: { label: 'Events', color: '#c77fc8', border: '#edaee9', shape: 'diamond' }
};

const relationMeta = {
  family: 'Family',
  leadership: 'Leadership',
  employment: 'Employment',
  business: 'Business',
  founding: 'Founding',
  governance: 'Governance',
  advisory: 'Advisory',
  participation: 'Participation',
  appointment: 'Appointment',
  office: 'Public office',
  government_finance: 'Government finance',
  representation: 'Representation',
  crisis: 'Crisis response',
  causal_context: 'Historical context',
  network: 'Shared institution'
};

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sourceRecord(id) {
  return state.data.sources[id] || { title: id, publisher: 'Unknown source', url: '#' };
}

function entityById(id) {
  return state.data.nodes.find(n => n.id === id);
}

function edgeById(id) {
  return state.data.edges.find(e => e.id === id);
}

function nodeActive(node, year) {
  if (state.allTime) return true;
  if (node.type === 'person') {
    return (node.born == null || year >= node.born) && (node.died == null || year <= node.died);
  }
  return (node.activeStart == null || year >= node.activeStart) && (node.activeEnd == null || year <= node.activeEnd);
}

function edgeActive(edge, year) {
  if (state.allTime) return true;
  return (edge.start == null || year >= edge.start) && (edge.end == null || year <= edge.end);
}

function gradePasses(grade) {
  return (gradeRank[grade] || 0) >= (gradeRank[state.minGrade] || 0);
}

function displayYears(item) {
  if (item.type === 'person') {
    if (item.born && item.died) return `${item.born}–${item.died}`;
    if (item.born) return `${item.born}–`;
  }
  if (item.activeStart && item.activeEnd) return `${item.activeStart}–${item.activeEnd}`;
  if (item.activeStart) return `est. ${item.activeStart}`;
  return '';
}

async function init() {
  const response = await fetch('./data/network-v1.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Network data failed to load (${response.status})`);
  state.data = await response.json();
  state.year = 1910;

  for (const t of new Set(state.data.nodes.map(n => n.type))) state.entityTypes.add(t);
  for (const t of new Set(state.data.edges.map(e => e.type))) state.relationTypes.add(t);

  configureTimeline();
  buildFilters();
  buildSearch();
  buildFeatured();
  buildPathInputs();
  buildGraph();
  bindUI();
  hydrateFromUrl();
  applyView();
}

function buildGraph() {
  const elements = [
    ...state.data.nodes.map(n => ({ data: { ...n, label: n.name } })),
    ...state.data.edges.map(e => ({ data: { ...e } }))
  ];

  state.cy = cytoscape({
    container: document.querySelector('#graph'),
    elements,
    minZoom: 0.18,
    maxZoom: 2.7,
    wheelSensitivity: 0.16,
    selectionType: 'single',
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          color: '#dce6f4',
          'font-size': 10,
          'font-family': 'Inter, system-ui, sans-serif',
          'text-wrap': 'wrap',
          'text-max-width': 100,
          'text-valign': 'bottom',
          'text-margin-y': 9,
          'background-color': '#8795aa',
          'border-color': '#b6c2d3',
          'border-width': 1.3,
          width: 38,
          height: 38,
          'overlay-opacity': 0,
          'transition-property': 'opacity, width, height, border-width',
          'transition-duration': '140ms'
        }
      },
      ...Object.entries(typeMeta).map(([type, meta]) => ({
        selector: `node[type = "${type}"]`,
        style: {
          'background-color': meta.color,
          'border-color': meta.border,
          shape: meta.shape
        }
      })),
      {
        selector: 'node:selected',
        style: {
          'border-width': 4,
          'border-color': '#ffffff',
          width: 50,
          height: 50,
          'z-index': 10
        }
      },
      {
        selector: 'edge',
        style: {
          width: 1.3,
          'line-color': '#637187',
          'target-arrow-color': '#637187',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
          'curve-style': 'bezier',
          label: 'data(label)',
          color: '#8492a6',
          'font-size': 7.5,
          'text-rotation': 'autorotate',
          'text-background-color': '#101620',
          'text-background-opacity': 0.86,
          'text-background-padding': 2,
          'overlay-opacity': 0,
          'transition-property': 'opacity, width, line-color, target-arrow-color',
          'transition-duration': '140ms'
        }
      },
      { selector: 'edge[type = "family"]', style: { 'line-style': 'dashed' } },
      { selector: 'edge[grade = "A"]', style: { width: 1.9 } },
      { selector: '.inactive-time', style: { opacity: 0.09 } },
      { selector: '.hidden-item', style: { display: 'none' } },
      { selector: '.search-dim', style: { opacity: 0.08 } },
      { selector: '.search-hit', style: { 'border-width': 4, width: 52, height: 52 } },
      { selector: '.path-dim', style: { opacity: 0.08 } },
      { selector: '.path-node', style: { opacity: 1, 'border-width': 4, 'border-color': '#ffffff', width: 48, height: 48, 'z-index': 20 } },
      { selector: '.path-edge', style: { opacity: 1, width: 4.5, 'line-color': '#8bb2ff', 'target-arrow-color': '#8bb2ff', color: '#dbe7ff', 'font-size': 9, 'z-index': 18 } }
    ],
    layout: {
      name: 'cose',
      animate: false,
      nodeRepulsion: 9500,
      idealEdgeLength: 120,
      edgeElasticity: 85,
      nestingFactor: 0.85,
      gravity: 0.18,
      numIter: 1400,
      randomize: true
    }
  });

  state.cy.on('tap', 'node', evt => {
    clearPathHighlight(false);
    showNode(evt.target.data('id'));
  });
  state.cy.on('tap', 'edge', evt => {
    clearPathHighlight(false);
    showEdge(evt.target.data('id'));
  });
  state.cy.on('tap', evt => {
    if (evt.target === state.cy) closeDrawer();
  });
}

function configureTimeline() {
  const slider = document.querySelector('#yearSlider');
  slider.min = state.data.meta.yearMin;
  slider.max = state.data.meta.yearMax;
  slider.value = state.year;
  document.querySelector('#minYear').textContent = state.data.meta.yearMin;
  document.querySelector('#maxYear').textContent = state.data.meta.yearMax;
  document.querySelector('#yearReadout').textContent = state.year;
}

function buildFilters() {
  const entityHost = document.querySelector('#entityFilters');
  [...state.entityTypes].sort().forEach(type => {
    const meta = typeMeta[type] || { label: type, color: '#999' };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip active';
    btn.dataset.entityType = type;
    btn.innerHTML = `<span class="mini-dot" style="background:${meta.color}"></span>${esc(meta.label)}`;
    btn.addEventListener('click', () => {
      if (state.entityTypes.has(type)) { state.entityTypes.delete(type); btn.classList.remove('active'); }
      else { state.entityTypes.add(type); btn.classList.add('active'); }
      applyView();
    });
    entityHost.appendChild(btn);
  });

  const relHost = document.querySelector('#relationshipFilters');
  [...state.relationTypes].sort().forEach(type => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip active';
    btn.dataset.relType = type;
    btn.textContent = relationMeta[type] || type.replaceAll('_', ' ');
    btn.addEventListener('click', () => {
      if (state.relationTypes.has(type)) { state.relationTypes.delete(type); btn.classList.remove('active'); }
      else { state.relationTypes.add(type); btn.classList.add('active'); }
      applyView();
    });
    relHost.appendChild(btn);
  });

  const gradeHost = document.querySelector('#gradeFilters');
  ['A','B','C','D','E'].forEach(grade => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-chip ${grade === state.minGrade ? 'active' : ''}`;
    btn.dataset.grade = grade;
    btn.textContent = `${grade} · ${gradeLabel[grade]}`;
    btn.addEventListener('click', () => {
      state.minGrade = grade;
      gradeHost.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.grade === grade));
      applyView();
    });
    gradeHost.appendChild(btn);
  });
}

function buildSearch() {
  const input = document.querySelector('#globalSearch');
  const results = document.querySelector('#searchResults');
  input.addEventListener('input', () => renderSearchResults(input.value));
  input.addEventListener('focus', () => { if (input.value.trim()) renderSearchResults(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') results.hidden = true;
    if (event.key === 'Enter') {
      const first = results.querySelector('[data-node-id]');
      if (first) { event.preventDefault(); chooseSearchResult(first.dataset.nodeId); }
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-area')) results.hidden = true;
  });
}

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  const host = document.querySelector('#searchResults');
  if (!q) { host.hidden = true; clearSearchHighlight(); return; }
  const hits = state.data.nodes
    .filter(n => `${n.name} ${n.subtitle || ''} ${n.summary || ''}`.toLowerCase().includes(q))
    .slice(0, 8);
  host.innerHTML = hits.length ? hits.map(n => `
    <button class="search-item" role="option" type="button" data-node-id="${esc(n.id)}">
      <span><strong>${esc(n.name)}</strong><small>${esc(n.subtitle || n.summary || '')}</small></span>
      <span class="search-type">${esc(typeMeta[n.type]?.label || n.type)}</span>
    </button>`).join('') : '<div class="empty-state">No matching entity in this first module.</div>';
  host.hidden = false;
  host.querySelectorAll('[data-node-id]').forEach(btn => btn.addEventListener('click', () => chooseSearchResult(btn.dataset.nodeId)));
  highlightSearch(hits.map(h => h.id));
}

function chooseSearchResult(id) {
  document.querySelector('#searchResults').hidden = true;
  document.querySelector('#globalSearch').value = entityById(id)?.name || '';
  focusNode(id);
  showNode(id);
}

function highlightSearch(ids) {
  if (!state.cy) return;
  state.cy.elements().removeClass('search-dim search-hit');
  if (!ids.length) return;
  state.cy.elements().addClass('search-dim');
  ids.forEach(id => {
    const node = state.cy.getElementById(id);
    node.removeClass('search-dim').addClass('search-hit');
    node.connectedEdges().removeClass('search-dim');
    node.connectedEdges().connectedNodes().removeClass('search-dim');
  });
}
function clearSearchHighlight() { if (state.cy) state.cy.elements().removeClass('search-dim search-hit'); }

function buildFeatured() {
  const host = document.querySelector('#featuredList');
  host.innerHTML = state.data.featured.map(item => `
    <button type="button" class="featured-card" data-featured="${esc(item.id)}">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.description)}</span>
      <small>${item.year ? `Suggested view: ${esc(item.year)}` : 'Explore path'}</small>
    </button>`).join('');
  host.querySelectorAll('[data-featured]').forEach(btn => btn.addEventListener('click', () => {
    const item = state.data.featured.find(f => f.id === btn.dataset.featured);
    if (!item) return;
    if (item.year) setYear(item.year);
    closePanel('featuredPanel');
    runPath(item.from, item.to, false, true);
  }));
}

function buildPathInputs() {
  const list = document.querySelector('#entityNames');
  list.innerHTML = state.data.nodes.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(n => `<option value="${esc(n.name)}"></option>`).join('');
}

function bindUI() {
  document.querySelector('#fitBtn').addEventListener('click', () => state.cy.fit(':visible', 55));
  document.querySelector('#filtersBtn').addEventListener('click', () => openPanel('filterPanel'));
  document.querySelector('#featuredBtn').addEventListener('click', () => openPanel('featuredPanel'));
  document.querySelector('#pathBtn').addEventListener('click', () => openPanel('pathPanel'));
  document.querySelector('#clearBtn').addEventListener('click', clearEverything);
  document.querySelector('#closeDrawer').addEventListener('click', closeDrawer);
  document.querySelector('#scrim').addEventListener('click', closeAllPanels);
  document.querySelectorAll('[data-close-panel]').forEach(btn => btn.addEventListener('click', () => closePanel(btn.dataset.closePanel)));

  document.querySelector('#yearSlider').addEventListener('input', e => setYear(Number(e.target.value), false));
  document.querySelector('#allTimeToggle').addEventListener('change', e => {
    state.allTime = e.target.checked;
    document.querySelector('#yearSlider').disabled = state.allTime;
    document.querySelector('#yearReadout').textContent = state.allTime ? 'All time' : state.year;
    applyView();
    updateUrl();
  });
  document.querySelector('#hideInactiveToggle').addEventListener('change', e => { state.hideInactive = e.target.checked; applyView(); });

  document.querySelector('#swapPathBtn').addEventListener('click', () => {
    const from = document.querySelector('#pathFrom');
    const to = document.querySelector('#pathTo');
    [from.value, to.value] = [to.value, from.value];
  });
  document.querySelector('#runPathBtn').addEventListener('click', () => {
    const from = resolveEntityInput(document.querySelector('#pathFrom').value);
    const to = resolveEntityInput(document.querySelector('#pathTo').value);
    const currentOnly = document.querySelector('#pathCurrentYearOnly').checked;
    if (!from || !to) {
      document.querySelector('#pathResult').innerHTML = '<div class="empty-state">Choose two entities from the network.</div>';
      return;
    }
    runPath(from.id, to.id, currentOnly, false);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDrawer(); closeAllPanels(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.querySelector('#globalSearch').focus(); }
  });
}

function resolveEntityInput(value) {
  const q = value.trim().toLowerCase();
  return state.data.nodes.find(n => n.name.toLowerCase() === q) || state.data.nodes.find(n => n.name.toLowerCase().includes(q));
}

function setYear(year, update = true) {
  state.year = Math.max(state.data.meta.yearMin, Math.min(state.data.meta.yearMax, year));
  document.querySelector('#yearSlider').value = state.year;
  if (!state.allTime) document.querySelector('#yearReadout').textContent = state.year;
  applyView();
  if (update) updateUrl();
}

function applyView() {
  if (!state.cy) return;
  state.cy.batch(() => {
    state.cy.nodes().forEach(ele => {
      const d = ele.data();
      const typeOk = state.entityTypes.has(d.type);
      const active = nodeActive(d, state.year);
      ele.toggleClass('hidden-item', !typeOk || (state.hideInactive && !active));
      ele.toggleClass('inactive-time', !state.allTime && !active && !state.hideInactive);
    });
    state.cy.edges().forEach(ele => {
      const d = ele.data();
      const relationOk = state.relationTypes.has(d.type);
      const gradeOk = gradePasses(d.grade);
      const endpointsOk = state.entityTypes.has(ele.source().data('type')) && state.entityTypes.has(ele.target().data('type'));
      const active = edgeActive(d, state.year);
      const hide = !relationOk || !gradeOk || !endpointsOk || (state.hideInactive && !active);
      ele.toggleClass('hidden-item', hide);
      ele.toggleClass('inactive-time', !state.allTime && !active && !state.hideInactive);
    });
  });
  updateStats();
}

function updateStats() {
  const visibleNodes = state.cy.nodes().filter(n => n.visible()).length;
  const visibleEdges = state.cy.edges().filter(e => e.visible()).length;
  document.querySelector('#visibleNodeCount').textContent = visibleNodes;
  document.querySelector('#visibleEdgeCount').textContent = visibleEdges;
  document.querySelector('#sourceCount').textContent = Object.keys(state.data.sources).length;
}

function showNode(id) {
  const node = entityById(id);
  if (!node) return;
  state.selectedEntityId = id;
  const connected = state.data.edges.filter(e => (e.source === id || e.target === id) && gradePasses(e.grade));
  const facts = (node.facts || []).map(f => `
    <div class="fact-card">
      <strong>${esc(f.label)}</strong><span class="grade grade-${esc(f.grade)}">${esc(f.grade)}</span>
      <div class="fact-value">${esc(f.value)}</div>
      ${factSources(f.sources)}
    </div>`).join('');
  const relations = connected
    .sort((a,b) => (b.start || 0) - (a.start || 0))
    .map(e => {
      const other = entityById(e.source === id ? e.target : e.source);
      return `<button type="button" class="relation-card" data-edge-id="${esc(e.id)}"><span><strong>${esc(other?.name || '')}</strong><small>${esc(e.label)}${e.start ? ` · ${esc(e.start)}${e.end && e.end !== e.start ? `–${esc(e.end)}` : ''}` : ''}</small></span><span class="grade grade-${esc(e.grade)}">${esc(e.grade)}</span></button>`;
    }).join('');

  document.querySelector('#drawerContext').textContent = typeMeta[node.type]?.label || node.type;
  document.querySelector('#drawerBody').innerHTML = `
    <h2>${esc(node.name)}</h2>
    <div class="subtitle">${esc(node.subtitle || '')}${displayYears(node) ? ` · ${esc(displayYears(node))}` : ''}</div>
    <p>${esc(node.summary || '')}</p>
    ${facts ? `<div class="section-title">Sourced facts</div><div class="fact-list">${facts}</div>` : ''}
    <div class="section-title">Documented relationships (${connected.length})</div>
    <div class="relation-list">${relations || '<div class="empty-state">No relationships meet the current evidence filter.</div>'}</div>
    <div class="claim-box"><strong>Reading the graph</strong><span>Connections show documented relationships, not automatic proof of coordination, control, wrongdoing, or shared ideology.</span></div>`;
  document.querySelector('#drawerBody').querySelectorAll('[data-edge-id]').forEach(btn => btn.addEventListener('click', () => showEdge(btn.dataset.edgeId)));
  openDrawer();
  focusNode(id, false);
  updateUrl();
}

function factSources(sourceIds = []) {
  if (!sourceIds.length) return '';
  const links = sourceIds.map(id => {
    const s = sourceRecord(id);
    return `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(s.title)}<span class="source-meta">${esc(s.publisher || '')} · ${esc(s.kind || '')}</span></span><span aria-hidden="true">↗</span></a>`;
  }).join('');
  return `<div class="fact-value source-list">${links}</div>`;
}

function showEdge(id) {
  const edge = edgeById(id);
  if (!edge) return;
  const source = entityById(edge.source);
  const target = entityById(edge.target);
  const range = edge.start == null ? 'Date not recorded' : (edge.start === edge.end ? String(edge.start) : `${edge.start}–${edge.end ?? ''}`);
  const sources = (edge.sources || []).map(sourceId => {
    const s = sourceRecord(sourceId);
    return `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(s.title)}<span class="source-meta">${esc(s.publisher || '')} · ${esc(s.kind || '')}</span></span><span aria-hidden="true">↗</span></a>`;
  }).join('');

  document.querySelector('#drawerContext').textContent = relationMeta[edge.type] || edge.type;
  document.querySelector('#drawerBody').innerHTML = `
    <h2>${esc(source?.name)} → ${esc(target?.name)}</h2>
    <div class="subtitle">${esc(edge.label)} · ${esc(range)}</div>
    <div class="fact-card"><strong>Evidence grade</strong><span class="grade grade-${esc(edge.grade)}">${esc(edge.grade)}</span><div class="fact-value">${esc(gradeLabel[edge.grade] || 'Unrated')}</div></div>
    <p>${esc(edge.note || '')}</p>
    <div class="claim-box"><strong>What this establishes</strong><span>${esc(edge.establishes || edge.note || '')}</span></div>
    <div class="claim-box warn"><strong>What this does not establish</strong><span>${esc(edge.doesNotEstablish || 'No broader conclusion should be drawn without separate evidence.')}</span></div>
    <div class="section-title">Sources</div>
    <div class="source-list">${sources || '<div class="empty-state">No source attached.</div>'}</div>
    <div class="section-title">Endpoints</div>
    <div class="relation-list">
      <button class="relation-card" data-node-id="${esc(source?.id)}" type="button"><span><strong>${esc(source?.name)}</strong><small>${esc(source?.subtitle || '')}</small></span></button>
      <button class="relation-card" data-node-id="${esc(target?.id)}" type="button"><span><strong>${esc(target?.name)}</strong><small>${esc(target?.subtitle || '')}</small></span></button>
    </div>`;
  document.querySelector('#drawerBody').querySelectorAll('[data-node-id]').forEach(btn => btn.addEventListener('click', () => showNode(btn.dataset.nodeId)));
  openDrawer();
  highlightSingleEdge(id);
}

function openDrawer() {
  const drawer = document.querySelector('#detailDrawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  const drawer = document.querySelector('#detailDrawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  state.selectedEntityId = null;
  if (state.cy) state.cy.$(':selected').unselect();
  updateUrl();
}

function focusNode(id, zoom = true) {
  const node = state.cy?.getElementById(id);
  if (!node || node.empty()) return;
  node.select();
  if (zoom) state.cy.animate({ center: { eles: node }, zoom: Math.max(state.cy.zoom(), 1.1) }, { duration: 260 });
}

function highlightSingleEdge(id) {
  clearPathHighlight(false);
  state.cy.elements().addClass('path-dim');
  const edge = state.cy.getElementById(id);
  edge.removeClass('path-dim').addClass('path-edge');
  edge.source().removeClass('path-dim').addClass('path-node');
  edge.target().removeClass('path-dim').addClass('path-node');
}

function clearPathHighlight(clearResult = true) {
  state.selectedPath = null;
  if (state.cy) state.cy.elements().removeClass('path-dim path-node path-edge');
  if (clearResult) document.querySelector('#pathResult').innerHTML = '';
}

function runPath(fromId, toId, currentYearOnly = false, openResultPanel = false) {
  const result = shortestPath(fromId, toId, currentYearOnly);
  const host = document.querySelector('#pathResult');
  if (!result) {
    host.innerHTML = '<div class="empty-state">No path found with the current evidence threshold and filters.</div>';
    if (openResultPanel) openPanel('pathPanel');
    return;
  }
  state.selectedPath = result;
  document.querySelector('#pathFrom').value = entityById(fromId)?.name || '';
  document.querySelector('#pathTo').value = entityById(toId)?.name || '';
  highlightPath(result);
  renderPathResult(result, host);
  if (openResultPanel) openPanel('pathPanel');
  else if (!document.querySelector('#pathPanel').hidden) host.scrollIntoView({ block: 'nearest' });
  updateUrl(fromId, toId);
}

function shortestPath(fromId, toId, currentYearOnly) {
  if (fromId === toId) return { nodes: [fromId], edges: [] };
  const allowedEdges = state.data.edges.filter(e => {
    if (!gradePasses(e.grade) || !state.relationTypes.has(e.type)) return false;
    const a = entityById(e.source), b = entityById(e.target);
    if (!a || !b || !state.entityTypes.has(a.type) || !state.entityTypes.has(b.type)) return false;
    return !currentYearOnly || edgeActive(e, state.year);
  });
  const adjacency = new Map();
  for (const e of allowedEdges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source).push({ next: e.target, edgeId: e.id });
    adjacency.get(e.target).push({ next: e.source, edgeId: e.id });
  }
  const queue = [fromId];
  const seen = new Set([fromId]);
  const prev = new Map();
  while (queue.length) {
    const cur = queue.shift();
    for (const step of adjacency.get(cur) || []) {
      if (seen.has(step.next)) continue;
      seen.add(step.next);
      prev.set(step.next, { node: cur, edgeId: step.edgeId });
      if (step.next === toId) {
        const nodes = [toId], edges = [];
        let at = toId;
        while (at !== fromId) {
          const p = prev.get(at);
          edges.unshift(p.edgeId);
          nodes.unshift(p.node);
          at = p.node;
        }
        return { nodes, edges };
      }
      queue.push(step.next);
    }
  }
  return null;
}

function highlightPath(path) {
  state.cy.elements().addClass('path-dim').removeClass('path-node path-edge');
  path.nodes.forEach(id => state.cy.getElementById(id).removeClass('path-dim').addClass('path-node'));
  path.edges.forEach(id => state.cy.getElementById(id).removeClass('path-dim').addClass('path-edge'));
  const collection = state.cy.collection();
  path.nodes.forEach(id => collection.merge(state.cy.getElementById(id)));
  state.cy.fit(collection, 70);
}

function renderPathResult(path, host) {
  const from = entityById(path.nodes[0]);
  const to = entityById(path.nodes[path.nodes.length - 1]);
  const steps = path.edges.map((edgeId, i) => {
    const edge = edgeById(edgeId);
    const a = entityById(path.nodes[i]);
    const b = entityById(path.nodes[i + 1]);
    return `<button type="button" class="path-step" data-edge-id="${esc(edgeId)}"><span class="step-num">${i + 1}</span><span><strong>${esc(a.name)} → ${esc(b.name)}</strong><small>${esc(edge.label)} · Grade ${esc(edge.grade)} · ${edge.start ?? 'date unknown'}${edge.end && edge.end !== edge.start ? `–${edge.end}` : ''}</small></span><span aria-hidden="true">›</span></button>`;
  }).join('');
  host.innerHTML = `<div class="path-summary"><strong>${esc(from.name)}</strong> to <strong>${esc(to.name)}</strong> in ${path.edges.length} documented step${path.edges.length === 1 ? '' : 's'}.</div>${steps || '<div class="empty-state">Same entity selected.</div>'}`;
  host.querySelectorAll('[data-edge-id]').forEach(btn => btn.addEventListener('click', () => { closeAllPanels(); showEdge(btn.dataset.edgeId); }));
}

function openPanel(id) {
  closeDrawer();
  document.querySelectorAll('.modal-panel').forEach(p => p.hidden = true);
  document.querySelector('#scrim').hidden = false;
  const panel = document.querySelector(`#${id}`);
  panel.hidden = false;
  const focusable = panel.querySelector('input,button');
  setTimeout(() => focusable?.focus(), 0);
}
function closePanel(id) {
  document.querySelector(`#${id}`).hidden = true;
  if (![...document.querySelectorAll('.modal-panel')].some(p => !p.hidden)) document.querySelector('#scrim').hidden = true;
}
function closeAllPanels() {
  document.querySelectorAll('.modal-panel').forEach(p => p.hidden = true);
  document.querySelector('#scrim').hidden = true;
}

function clearEverything() {
  clearPathHighlight();
  clearSearchHighlight();
  closeDrawer();
  closeAllPanels();
  document.querySelector('#globalSearch').value = '';
  state.cy.$(':selected').unselect();
  state.cy.fit(':visible', 55);
  updateUrl();
}

function updateUrl(pathFrom = null, pathTo = null) {
  const params = new URLSearchParams();
  if (!state.allTime) params.set('year', state.year);
  if (state.selectedEntityId) params.set('node', state.selectedEntityId);
  if (pathFrom && pathTo) { params.set('from', pathFrom); params.set('to', pathTo); }
  const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
  history.replaceState(null, '', next);
}

function hydrateFromUrl() {
  const params = new URLSearchParams(location.search);
  const year = Number(params.get('year'));
  if (Number.isFinite(year) && year >= state.data.meta.yearMin && year <= state.data.meta.yearMax) setYear(year, false);
  const node = params.get('node');
  if (node && entityById(node)) setTimeout(() => showNode(node), 250);
  const from = params.get('from'), to = params.get('to');
  if (from && to && entityById(from) && entityById(to)) setTimeout(() => runPath(from, to, false, false), 300);
}

init().catch(error => {
  console.error(error);
  document.querySelector('#graph').innerHTML = `<div class="empty-state" style="position:absolute;inset:0;display:grid;place-items:center;padding:30px">Power Atlas could not load.<br>${esc(error.message)}</div>`;
});
