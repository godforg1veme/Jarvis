import * as THREE from 'three';

const radii = [.54, .66, .43, .38, .47, .36];
export const bounds = [ .86, .66 * 1.71 + .011, .43 * 1.3, .64, .75, .36 * 1.18 ];
const silver = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

function texture(seed) {
  const width = 128, height = 64, bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grain = Math.sin(x * .37 + seed * 7) * Math.cos(y * .29 + seed * 5) + Math.sin(x * .09 + y * .16 + seed * 3) + Math.sin(x * 1.37 + y * .91) * .2;
    const fault = Math.pow(Math.max(0, Math.sin(x * .17 + Math.sin(y * .13 + seed) * 2.2)), 17);
    const circuit = Math.pow(Math.max(0, Math.cos(x * .42 + seed) * Math.cos(y * .33)), 13);
    const stratum = Math.sin(y * (.38 + seed * .025) + Math.sin(x * .08) * 1.3);
    const surface = seed % 3 === 0 ? grain + fault * 1.1 : seed % 3 === 1 ? grain * .7 + circuit * 1.5 : grain * .65 + stratum * .52;
    const shade = Math.max(17, Math.min(123, 54 + surface * 17)), offset = (y * width + x) * 4;
    bytes[offset] = shade; bytes[offset + 1] = shade + 2; bytes[offset + 2] = shade + 5; bytes[offset + 3] = 255;
  }
  const result = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  result.wrapS = THREE.RepeatWrapping; result.colorSpace = THREE.SRGBColorSpace; result.needsUpdate = true;
  return result;
}

function network(group, radius, count, seed, opacity) {
  const dots = [], lines = [], anchors = [];
  for (let i = 0; i < count; i++) {
    const lat = Math.acos(1 - 2 * (i + .5) / count), lon = i * 2.399963 + seed * .73, r = radius * 1.015;
    dots.push(Math.sin(lat) * Math.cos(lon) * r, Math.cos(lat) * r, Math.sin(lat) * Math.sin(lon) * r);
  }
  let state = seed * 10007;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const n = radius > 1 ? 110 : 46;
  for (let i = 0; i < n; i++) { const y = random() * 2 - 1, angle = random() * Math.PI * 2, ring = Math.sqrt(1 - y * y) * radius; anchors.push(Math.cos(angle) * ring, y * radius, Math.sin(angle) * ring); }
  const edges = new Set();
  for (let i = 0; i < n; i++) {
    const a = i * 3; let nearest = -1, next = -1, distance = Infinity, nextDistance = Infinity;
    for (let j = 0; j < n; j++) { if (j === i) continue; const b = j * 3, d = (anchors[a] - anchors[b]) ** 2 + (anchors[a + 1] - anchors[b + 1]) ** 2 + (anchors[a + 2] - anchors[b + 2]) ** 2; if (d < distance) { next = nearest; nextDistance = distance; nearest = j; distance = d; } else if (d < nextDistance) { next = j; nextDistance = d; } }
    for (const neighbor of [nearest, next]) { if (neighbor < 0) continue; const edge = `${Math.min(i, neighbor)}:${Math.max(i, neighbor)}`; if (edges.has(edge)) continue; edges.add(edge); const b = neighbor * 3; let previous = null; for (let step = 0; step <= 5; step++) { const t = step / 5, x = anchors[a] * (1 - t) + anchors[b] * t, y = anchors[a + 1] * (1 - t) + anchors[b + 1] * t, z = anchors[a + 2] * (1 - t) + anchors[b + 2] * t, length = Math.hypot(x, y, z), scale = radius * 1.022 / length, point = [x * scale, y * scale, z * scale]; if (previous) lines.push(...previous, ...point); previous = point; } }
  }
  const dotGeometry = new THREE.BufferGeometry(), lineGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)); lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  group.add(new THREE.Points(dotGeometry, new THREE.PointsMaterial({ color: '#e3ebee', size: .009, transparent: true, opacity: opacity * .72, sizeAttenuation: true, depthWrite: false })));
  group.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: '#d3dce0', transparent: true, opacity: opacity * .42, depthWrite: false })));
}

function body(radius, seed, core = false) {
  const group = new THREE.Group();
  const map = texture(seed);
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, core ? 48 : 32, core ? 32 : 24), new THREE.MeshStandardMaterial({ map, metalness: core ? .68 : .48, roughness: core ? .41 : .65, color: '#b9c3c8' }));
  group.add(surface); network(group, radius, core ? 1150 : 245, seed, core ? .9 : .78);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.027, 36, 24), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uOpacity: { value: core ? 1.1 : .88 } }, vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p; }', fragmentShader: 'varying vec3 n; varying vec3 v; uniform float uOpacity; void main(){ float e=pow(1.0-max(0.0,dot(normalize(n),normalize(v))),4.0); gl_FragColor=vec4(vec3(0.78,0.86,0.91),e*uOpacity); }' })));
  return { group, surface };
}

function ring(group, radius, tube, opacity, rotation, length = Math.PI * 2) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 4, 96, length), silver('#d6dfe4', opacity));
  mesh.rotation.set(...rotation); group.add(mesh);
}

export function createCoreBody() {
  const { group, surface } = body(1.14, 11, true);
  ring(group, 1.19, .005, .34, [.55, -.3, .1], Math.PI * .68);
  ring(group, 1.205, .004, .26, [-.45, .6, 1.2], Math.PI * .42);
  return { group, surface };
}

export function createPlanetBody(index) {
  const radius = radii[index], { group, surface } = body(radius, index + 1);
  if (index === 1) {
    const rings = new THREE.Group(); rings.rotation.set(.49, .1, -.23);
    for (const factor of [1.3, 1.48, 1.65]) ring(rings, radius * factor, factor === 1.48 ? .007 : .011, .72, [0, 0, 0]);
    const points = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) { const a = i * 2.399963, r = radius * (1.23 + ((i * 37) % 47) / 47 * .48); points[i * 3] = Math.cos(a) * r; points[i * 3 + 1] = Math.sin(a) * r; points[i * 3 + 2] = Math.sin(i * 12.17) * .009; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(points, 3)); rings.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#dbe4e8', size: .009, transparent: true, opacity: .54, depthWrite: false }))); group.add(rings);
  }
  if (index === 2) ring(group, radius * 1.3, .007, .38, [.3, .1, .2]);
  if (index === 0 || index === 4) { const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * .12, 1), new THREE.MeshStandardMaterial({ color: '#909da4', metalness: .71, roughness: .48 })); moon.position.set(radius * 1.42, radius * .36, 0); group.add(moon); }
  if (index === 5) ring(group, radius * 1.18, .004, .31, [.18, .55, -.3], Math.PI * 1.25);
  if (index === 3) { const moon = new THREE.Mesh(new THREE.OctahedronGeometry(radius * .16), new THREE.MeshStandardMaterial({ color: '#7e8c94', metalness: .66, roughness: .45 })); moon.position.set(-radius * 1.5, -.08, .05); group.add(moon); }
  return { group, surface, radius };
}
