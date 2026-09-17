const state = {
  data: null,
  cy: null,
  activeTypes: new Set(),
  year: 1910,
  selectedId: null
};

const typeMeta = {
  person: { label: 'People', color: '#d9e6ff', border: '#5a79b9', shape: 'ellipse' },
  bank: { label: 'Banks', color: '#f6e8c3', border: '#9e7c31', shape: 'round-rectangle' },
  government: { label: 'Government', color: '#dff2df', border: '#4d8650', shape: 'hexagon' },
  event: { label: 'Events', color: '#f2dff0', border: '#8d5688', shape: 'diamond' }
};

function gradeText(grade) {
  return { A: 'Primary evidence', B: 'Strong evidence', C: 'Supported secondary evidence', D: 'Inference', E: 'Unverified proposal' }[grade] || 'Unrated';
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function init() {
  const response = await fetch('./data/sample-network.json');
  state.data = await response.json();
  state.year = 1910;
  buildTypeFilters();
  configureTimeline();
  buildGraph();
  bindSearch();
  updateTimeline();
}

function buildTypeFilters() {
  const host = document.querySelector('#typeFilters');
  const available = [...new Set(state.data.nodes.map(n => n.type))];
  available.forEach(type => {
    state.activeTypes.add(type);
    const meta = typeMeta[type] || { label: type, color: '#eee', border: '#777' };
    const button = document.createElement('button');
    button.className = 'filter-chip active';
    button.dataset.type = type;
    button.innerHTML = `<span class="dot" style="background:${meta.color};border-color:${meta.border}"></span>${esc(meta.label)}`;
    button.addEventListener('click', () => {
      if (state.activeTypes.has(type)) {
        state.activeTypes.delete(type);
        button.classList.remove('active');
      } else {
        state.activeTypes.add(type);
        button.classList.add('active');
      }
      applyFilters();
    });
    host.appendChild(button);
  });
}

function configureTimeline() {
  const slider = document.querySelector('#yearSlider');
  slider.min = state.data.meta.yearMin;
  slider.max = state.data.meta.yearMax;
  slider.value = state.year;
  document.querySelector('#yearMin').textContent = state.data.meta.yearMin;
  document.querySelector('#yearMax').textContent = state.data.meta.yearMax;
  document.querySelector('#yearValue').textContent = state.year;
  slider.addEventListener('input', e => {
    state.year = Number(e.target.value);
    document.querySelector('#yearValue').textContent = state.year;
    updateTimeline();
  });
}

function buildGraph() {
  const elements = [];
  for (const node of state.data.nodes) elements.push({ data: { ...node, label: node.name } });
  for (const edge of state.data.edges) elements.push({ data: { ...edge } });

  state.cy = cytoscape({
    container: document.querySelector('#graph'),
    elements,
    minZoom: 0.18,
    maxZoom: 3,
    wheelSensitivity: 0.18,
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)', 'font-family': 'Inter, system-ui, sans-serif', 'font-size': 11,
          'text-wrap': 'wrap', 'text-max-width': 105, 'text-valign': 'bottom', 'text-margin-y': 8,
          'background-color': '#e8edf5', 'border-color': '#73819a', 'border-width': 1.5,
          'width': 42, 'height': 42, 'transition-property': 'opacity, border-width, width, height',
          'transition-duration': '160ms'
        }
      },
      ...Object.entries(typeMeta).map(([type, meta]) => ({ selector: `node[type = "${type}"]`, style: { 'background-color': meta.color, 'border-color': meta.border, 'shape': meta.shape } })),
      { selector: 'node:selected', style: { 'border-width': 4, 'width': 52, 'height': 52 } },
      {
        selector: 'edge',
        style: {
          'width': 1.6, 'line-color': '#9ca6b5', 'target-arrow-color': '#9ca6b5', 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', 'label': 'data(label)', 'font-size': 8, 'text-rotation': 'autorotate',
          'text-background-color': '#ffffff', 'text-background-opacity': 0.86, 'text-background-padding': 2,
          'color': '#58616e', 'transition-property': 'opacity, width', 'transition-duration': '160ms'
        }
      },
      { selector: 'edge[type = "family"]', style: { 'line-style': 'dashed' } },
      { selector: '.inactive-time', style: { 'opacity': 0.08 } },
      { selector: '.filtered-out', style: { 'display': 'none' } },
      { selector: '.search-dim', style: { 'opacity': 0.15 } },
      { selector: '.search-hit', style: { 'border-width': 5, 'width': 58, 'height': 58 } }
    ],
    layout: { name: 'cose', animate: false, nodeRepulsion: 7000, idealEdgeLength: 120, edgeElasticity: 90, gravity: 0.2, numIter: 1200, randomize: true }
  });

  state.cy.on('tap', 'node', evt => showNode(evt.target.data()));
  state.cy.on('tap', 'edge', evt => showEdge(evt.target.data()));
  state.cy.on('tap', evt => { if (evt.target === state.cy) closeDrawer(); });
  document.querySelector('#fitGraph').addEventListener('click', () => state.cy.fit(undefined, 50));
  document.querySelector('#closeDrawer').addEventListener('click', closeDrawer);
}

function isAliveAt(node, year) {
  if (node.type !== 'person') return true;
  return (node.born == null || year >= node.born) && (node.died == null || year <= node.died);
}

function edgeActive(edge, year) {
  return (edge.start == null || year >= edge.start) && (edge.end == null || year <= edge.end);
}

function updateTimeline() {
  if (!state.cy) return;
  state.cy.batch(() => {
    state.cy.nodes().forEach(ele => ele.toggleClass('inactive-time', !isAliveAt(ele.data(), state.year)));
    state.cy.edges().forEach(ele => ele.toggleClass('inactive-time', !edgeActive(ele.data(), state.year)));
  });
  applyFilters();
}

function applyFilters() {
  if (!state.cy) return;
  state.cy.batch(() => {
    state.cy.nodes().forEach(ele => ele.toggleClass('filtered-out', !state.activeTypes.has(ele.data('type'))));
    state.cy.edges().forEach(edge => {
      const sourceVisible = state.activeTypes.has(edge.source().data('type'));
      const targetVisible = state.activeTypes.has(edge.target().data('type'));
      edge.toggleClass('filtered-out', !(sourceVisible && targetVisible));
    });
  });
}

function bindSearch() {
  const input = document.querySelector('#search');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    state.cy.elements().removeClass('search-dim search-hit');
    if (!q) return;
    const hits = state.cy.nodes().filter(node => node.data('name').toLowerCase().includes(q));
    if (!hits.length) {
      state.cy.elements().addClass('search-dim');
      return;
    }
    state.cy.elements().addClass('search-dim');
    hits.removeClass('search-dim').addClass('search-hit');
    hits.connectedEdges().removeClass('search-dim');
    hits.connectedEdges().connectedNodes().removeClass('search-dim');
  });

  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim().toLowerCase();
    const hit = state.cy.nodes().filter(node => node.data('name').toLowerCase().includes(q))[0];
    if (hit) {
      state.cy.animate({ center: { eles: hit }, zoom: 1.35 }, { duration: 260 });
      hit.select();
      showNode(hit.data());
    }
  });
}

function showNode(node) {
  const drawer = document.querySelector('#drawer');
  const body = document.querySelector('#drawerBody');
  const connected = state.data.edges.filter(e => e.source === node.id || e.target === node.id);
  const years = node.type === 'person' && node.born ? `${node.born}${node.died ? `–${node.died}` : '–'}` : '';

  body.innerHTML = `
    <div class="eyebrow">${esc(node.type)}</div>
    <h2>${esc(node.name)}</h2>
    ${years ? `<div class="muted">${esc(years)}</div>` : ''}
    <p>${esc(node.summary || '')}</p>
    <div class="section-title">Documented relationships</div>
    <div class="relation-list">
      ${connected.map(edge => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = state.data.nodes.find(n => n.id === otherId);
        return `<button class="relation-row" data-edge="${esc(edge.id)}"><span>${esc(other?.name || otherId)}</span><small>${esc(edge.label)} · Grade ${esc(edge.grade)}</small></button>`;
      }).join('') || '<div class="muted">No relationships in this sample.</div>'}
    </div>
    <div class="notice">This profile shows relationships, not conclusions about motive, coordination, or control.</div>`;

  drawer.classList.add('open');
  body.querySelectorAll('[data-edge]').forEach(btn => {
    btn.addEventListener('click', () => {
      const edge = state.data.edges.find(e => e.id === btn.dataset.edge);
      if (edge) showEdge(edge);
    });
  });
}

function showEdge(edge) {
  const source = state.data.nodes.find(n => n.id === edge.source);
  const target = state.data.nodes.find(n => n.id === edge.target);
  const drawer = document.querySelector('#drawer');
  const body = document.querySelector('#drawerBody');
  const range = edge.start == null ? 'Date not recorded' : (edge.start === edge.end ? String(edge.start) : `${edge.start}–${edge.end ?? ''}`);
  const sourceLinks = (edge.sources || []).map(s => `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(s.title)}</span><span aria-hidden="true">↗</span></a>`).join('');

  body.innerHTML = `
    <div class="eyebrow">${esc(edge.type)} relationship</div>
    <h2>${esc(source?.name || edge.source)} → ${esc(target?.name || edge.target)}</h2>
    <div class="relationship-callout">${esc(edge.label)}</div>
    <div class="meta-grid"><div><span>Period</span><strong>${esc(range)}</strong></div><div><span>Evidence</span><strong>Grade ${esc(edge.grade)} · ${esc(gradeText(edge.grade))}</strong></div></div>
    <p>${esc(edge.note || '')}</p>
    <div class="section-title">Sources</div>
    <div class="source-list">${sourceLinks || '<div class="muted">No source attached.</div>'}</div>
    <div class="notice"><strong>What this establishes:</strong> only the relationship described above. Stronger claims require separate evidence.</div>`;

  drawer.classList.add('open');
}

function closeDrawer() {
  document.querySelector('#drawer').classList.remove('open');
  if (state.cy) state.cy.$(':selected').unselect();
}

init().catch(error => {
  console.error(error);
  document.querySelector('#graph').innerHTML = `<div class="load-error">Could not load the sample graph.<br><small>${esc(error.message)}</small></div>`;
});
