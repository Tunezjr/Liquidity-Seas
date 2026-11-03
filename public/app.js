import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const CACHE_KEY = 'liquidity-seas-graph';
const CACHE_TTL = 5 * 60 * 1000;
const GEOJSON_URL = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/110m/physical/ne_110m_land.json';

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

const data = await loadGraphData();
const nodes = data.api?.data?.nodes || [];
const edges = data.api?.data?.edges || [];
const attributions = data.attributions || [];
const nodeById = new Map(nodes.map((n) => [n.id, n]));

// ---------- 3D Globe ----------
const container = document.getElementById('globe-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(container.clientWidth, container.clientHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050817);

const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(0, 0, 5.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.2;
controls.maxDistance = 9;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

const globeGeo = new THREE.SphereGeometry(1.6, 64, 64);
const globeMat = new THREE.MeshPhongMaterial({
  color: 0x061018,
  emissive: 0x030810,
  shininess: 8,
  transparent: true,
  opacity: 0.95,
});
const globe = new THREE.Mesh(globeGeo, globeMat);
scene.add(globe);

const atmosGeo = new THREE.SphereGeometry(1.74, 64, 64);
const atmosMat = new THREE.MeshBasicMaterial({
  color: 0x25c7ff,
  transparent: true,
  opacity: 0.07,
  side: THREE.BackSide,
});
scene.add(new THREE.Mesh(atmosGeo, atmosMat));

const starGeo = new THREE.BufferGeometry();
const starCount = 1800;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 40 + Math.random() * 60;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i * 3 + 2] = r * Math.cos(phi);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.65 });
scene.add(new THREE.Points(starGeo, starMat));

const ambient = new THREE.AmbientLight(0x334455, 0.55);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 0.85);
dir.position.set(4, 2, 3);
scene.add(dir);

function latLonToVec3(lat, lon, radius = 1.605) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

async function buildDottedContinents() {
  try {
    const res = await fetch(GEOJSON_URL);
    const geo = await res.json();
    const positions = [];
    const step = 0.35;

    function addRing(ring) {
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const next = ring[(i + 1) % ring.length];
        const [nLon, nLat] = next;
        const dist = Math.hypot(nLon - lon, nLat - lat);
        const steps = Math.max(1, Math.floor(dist / step));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const clat = lat + (nLat - lat) * t;
          const clon = lon + (nLon - lon) * t;
          const v = latLonToVec3(clat, clon, 1.605);
          positions.push(v.x, v.y, v.z);
        }
      }
    }

    for (const feature of geo.features || []) {
      const geom = feature.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        for (const ring of geom.coordinates) addRing(ring);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          for (const ring of poly) addRing(ring);
        }
      }
    }

    if (positions.length) {
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const dotMat = new THREE.PointsMaterial({
        color: 0x8fb7cc,
        size: 0.018,
        transparent: true,
        opacity: 0.85,
        sizeAttenuation: true,
      });
      const dots = new THREE.Points(dotGeo, dotMat);
      scene.add(dots);
    }
  } catch (err) {
    console.warn('Continent dots failed to load', err);
  }
}

buildDottedContinents();

const pointsGroup = new THREE.Group();
scene.add(pointsGroup);

function hashToLatLon(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const lat = ((h % 140) - 70);
  const lon = ((h >> 8) % 360) - 180;
  return { lat, lon };
}

const pointMeshes = [];
nodes.filter(n => n.kind === 'entity').forEach((node) => {
  const weight = edges
    .filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id)
    .reduce((s, e) => s + (e.weight || 0), 0);
  const size = Math.max(0.04, Math.min(0.16, Math.sqrt(weight) / 140));

  const { lat, lon } = hashToLatLon(node.label || node.id);
  const pos = latLonToVec3(lat, lon, 1.63);

  const geo = new THREE.SphereGeometry(size, 16, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x25c7ff,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.userData = { node, weight };
  pointsGroup.add(mesh);
  pointMeshes.push(mesh);

  const ringGeo = new THREE.RingGeometry(size * 1.5, size * 1.9, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x25c7ff,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos);
  ring.lookAt(0, 0, 0);
  pointsGroup.add(ring);

  const labelDiv = document.createElement('div');
  labelDiv.className = 'hotspot-label';
  const tvlText = weight > 0 ? `~$${(weight / 1000).toFixed(1)}B` : '';
  labelDiv.innerHTML = `<strong>${node.label.split('(')[0].trim()}</strong>${tvlText ? `<span>${tvlText}</span>` : ''}`;
  const label = new CSS2DObject(labelDiv);
  label.position.copy(pos);
  label.position.multiplyScalar(1.08);
  pointsGroup.add(label);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const t = Date.now() * 0.001;
  pointMeshes.forEach((m, i) => {
    m.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.05);
  });
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});

// ---------- UI ----------
function renderStats() {
  const totalWeight = edges.reduce((s, e) => s + (e.weight || 0), 0);
  $('#stats').innerHTML = [
    ['Graph nodes', data.viewModel?.nodeCount || nodes.length, 'protocols + assets'],
    ['Flow edges', data.viewModel?.edgeCount || edges.length, `${formatNumber.format(totalWeight)} weighted`],
    ['Heat spots', pointMeshes.length, 'entity TVL'],
    ['Snapshot', (data.snapshotId || '').split(':').pop() || 'live', 'DefiLlama'],
  ].map(([label, value, note]) => `<article class="stat"><strong>${value}</strong><span>${label}</span><small>${note}</small></article>`).join('');
}

function renderAttributions() {
  const rows = attributions.map(row => ({
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

function renderRank() {
  const points = nodes.filter(n => n.kind === 'entity').map(node => {
    const weight = edges
      .filter(e => e.fromNodeId === node.id || e.toNodeId === node.id)
      .reduce((s, e) => s + (e.weight || 0), 0);
    return { ...node, weight };
  });
  const sorted = [...points].sort((a, b) => b.weight - a.weight).slice(0, 10);
  $('#rank').innerHTML = sorted.map((p, i) =>
    `<div class="rank-row"><span>${i + 1}. ${p.label.split('(')[0].trim()}</span><strong>~$${(p.weight / 1000).toFixed(1)}B</strong></div>`
  ).join('') || '<p>No points.</p>';
}

renderStats();
renderAttributions();
renderRank();
