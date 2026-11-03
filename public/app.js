const CACHE_KEY = 'liquidity-seas-graph';
const CACHE_TTL = 5 * 60 * 1000;

async function loadGraphData() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}
  const response = await fetch('/api/graph-data');
  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
  return data;
}

const $ = (sel) => document.querySelector(sel);
const formatNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function hashToPos(str, w, h) {
  const hsh = hash(str);
  const x = 0.08 + ((hsh % 840) / 1000);
  const y = 0.12 + (((hsh >> 8) % 760) / 1000);
  return { x: x * w, y: y * h };
}

// ---------- Canvas sea + heatmap ----------
const canvas = document.getElementById('sea');
const wrap = document.getElementById('map-wrap');
const tooltip = document.getElementById('tooltip');
const ctx = canvas.getContext('2d');

function resize() {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.width * 0.56 * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = (rect.width * 0.56) + 'px';
  return dpr;
}

function noise(x, y) {
  const n = Math.sin(x * 0.008 + y * 0.012) * 0.5
          + Math.sin(x * 0.015 - y * 0.009) * 0.3
          + Math.sin((x + y) * 0.006) * 0.2;
  return n;
}

function drawOcean(dpr) {
  const w = canvas.width;
  const h = canvas.height;
  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise(x / dpr, y / dpr);
      const deep = 0.35 + n * 0.25;
      const r = Math.floor(6 + deep * 18);
      const g = Math.floor(18 + deep * 40);
      const b = Math.floor(32 + deep * 55);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Soft current lines
  ctx.strokeStyle = 'rgba(37, 199, 255, 0.12)';
  ctx.lineWidth = 1.2 * dpr;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    let px = (i * 90) % w;
    let py = h * 0.2 + (i % 5) * (h * 0.12);
    ctx.moveTo(px, py);
    for (let s = 0; s < 40; s++) {
      px += 18 * dpr + Math.sin(i + s * 0.4) * 8;
      py += Math.sin(s * 0.3 + i) * 6;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function drawHeat(points, dpr) {
  if (!points.length) return;
  const max = Math.max(...points.map(p => p.weight));
  points.forEach((p) => {
    const intensity = Math.max(0.15, p.weight / max);
    const radius = (40 + intensity * 90) * dpr;
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    const hue = 190 - intensity * 40;
    grd.addColorStop(0, `hsla(${hue}, 95%, 62%, ${0.55 * intensity})`);
    grd.addColorStop(0.45, `hsla(${hue + 20}, 90%, 55%, ${0.22 * intensity})`);
    grd.addColorStop(1, 'hsla(200, 80%, 50%, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  });
}

let points = [];
let dpr = 1;

function renderMap(nodes, edges) {
  dpr = resize();
  drawOcean(dpr);

  const w = canvas.width;
  const h = canvas.height;
  points = nodes
    .filter(n => n.kind === 'entity')
    .map(node => {
      const weight = edges
        .filter(e => e.fromNodeId === node.id || e.toNodeId === node.id)
        .reduce((s, e) => s + (e.weight || 0), 0);
      const pos = hashToPos(node.label || node.id, w, h);
      return { ...node, weight, x: pos.x, y: pos.y };
    });

  drawHeat(points, dpr);
}

function hitTest(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  let best = null;
  let bestDist = 28 * dpr;
  for (const p of points) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

canvas.addEventListener('pointermove', (e) => {
  const hit = hitTest(e.clientX, e.clientY);
  if (hit) {
    tooltip.hidden = false;
    tooltip.textContent = hit.label;
    const rect = wrap.getBoundingClientRect();
    tooltip.style.left = (e.clientX - rect.left) + 'px';
    tooltip.style.top = (e.clientY - rect.top) + 'px';
  } else {
    tooltip.hidden = true;
  }
});
canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });

// ---------- UI ----------
function renderStats(data, nodes, edges) {
  const totalWeight = edges.reduce((s, e) => s + (e.weight || 0), 0);
  $('#status').textContent = 'Live';
  $('#stats').innerHTML = [
    ['Graph nodes', data.viewModel?.nodeCount || nodes.length, 'protocols + assets'],
    ['Flow edges', data.viewModel?.edgeCount || edges.length, `${formatNumber.format(totalWeight)} weighted`],
    ['Heat spots', points.length, 'entity TVL'],
    ['Snapshot', (data.snapshotId || '').split(':').pop() || 'live', 'DefiLlama'],
  ].map(([label, value, note]) => `<article class="stat"><strong>${value}</strong><span>${label}</span><small>${note}</small></article>`).join('');
}

function renderAttributions(data, nodeById) {
  const rows = (data.attributions || []).map(row => ({
    ...row,
    net: Number(row.netRaw || 0),
    label: nodeById.get(row.entityId)?.label || row.entityId,
  }));
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  $('#attributions').innerHTML = rows.map(row => {
    const width = Math.max(4, Math.abs(row.net) / max * 100);
    return `<div class="bar-row"><span>${row.label.split('(')[0].trim()}</span><div class="bar-track"><i style="width:${width}%"></i></div><strong>${formatNumber.format(row.net / 1e12)}</strong></div>`;
  }).join('') || '<p>No attribution rows.</p>';
}

function renderRank(points) {
  const sorted = [...points].sort((a, b) => b.weight - a.weight).slice(0, 10);
  $('#rank').innerHTML = sorted.map((p, i) =>
    `<div class="rank-row"><span>${i + 1}. ${p.label.split('(')[0].trim()}</span><strong>~$${(p.weight / 1000).toFixed(1)}B</strong></div>`
  ).join('') || '<p>No points.</p>';
}

// About
const aboutModal = document.getElementById('about-modal');
document.getElementById('about-btn')?.addEventListener('click', () => {
  aboutModal.hidden = false;
  document.body.style.overflow = 'hidden';
});
aboutModal?.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', () => {
    aboutModal.hidden = true;
    document.body.style.overflow = '';
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && aboutModal && !aboutModal.hidden) {
    aboutModal.hidden = true;
    document.body.style.overflow = '';
  }
});

// Boot
(async () => {
  try {
    const data = await loadGraphData();
    const nodes = data.api?.data?.nodes || [];
    const edges = data.api?.data?.edges || [];
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    renderMap(nodes, edges);
    renderStats(data, nodes, edges);
    renderAttributions(data, nodeById);
    renderRank(points);

    window.addEventListener('resize', () => renderMap(nodes, edges));
  } catch (err) {
    console.error(err);
    $('#status').textContent = 'Error';
    $('#stats').innerHTML = `<article class="stat"><strong>—</strong><span>Failed to load data</span><small>${err.message}</small></article>`;
  }
})();
