// Shared parts for MocapClear: a faceless mannequin in a marker suit, a procedural walk / run / jump
// performance that plants its feet, creatures to retarget onto, a ring of infrared cameras, marker
// visibility (with the body hiding markers from cameras), triangulation maths and chart boards.
//
// Sizes are in metres. The performer is 1.76 m tall with textbook body proportions (leg 0.87 m,
// hip height 0.95 m). Markers are drawn larger than life: real body markers are 9–25 mm balls
// (14 mm is common), but at this scale they would be invisible.
import { THREE, M, clamp, lerp, smooth, approach, sphere, box } from './kit.js';

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const G = 9.81;

// ---------------------------------------------------------------- boards and screen helpers
export const COL = { hot: '#ffd166', ir: '#ff5a6e', cool: '#8ec5ff', good: '#7be08c', bad: '#ff5a8a', soft: 'rgba(255,255,255,.58)', mint: '#5ce1a9', violet: '#c49bff', orange: '#ff9a5c' };
export function panelBg(g, w, h) { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(10,12,18,.93)'; g.fillRect(0, 0, w, h); }
export function board(root, w, h, pxW, pxH, draw, pos) {
  const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
  const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const redraw = () => { draw(g, pxW, pxH); tex.needsUpdate = true; };
  redraw();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  m.position.set(...pos); root.add(m);
  return { tex, redraw, canvas: c, mesh: m };
}
export function title(g, s, sub = '', y = 34) {
  g.textAlign = 'left';
  g.fillStyle = '#e8eef8'; g.font = 'bold 25px sans-serif'; g.fillText(s, 20, y);
  if (sub) { g.font = '17px sans-serif'; g.fillStyle = 'rgba(255,255,255,.62)'; g.fillText(sub, 20, y + 24); }
}
export function text(g, s, x, y, { font = '18px sans-serif', col = 'rgba(255,255,255,.85)', align = 'left' } = {}) {
  g.font = font; g.fillStyle = col; g.textAlign = align; g.fillText(s, x, y); g.textAlign = 'left';
}
export function wrap(g, s, x, y, maxW, lh, opts = {}) {
  g.font = opts.font || '18px sans-serif';
  const words = s.split(' '); let line = '', yy = y;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { text(g, line, x, yy, opts); line = w; yy += lh; } else line = t;
  }
  if (line) text(g, line, x, yy, opts);
  return yy + lh;
}
export function dot(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }

export const inReel = () => document.body.classList.contains('gb-reel');
// On a phone-width stage, hide minor labels and lift the picture a little.
export function fitNarrow(stage, minor = [], y0 = -0.1) {
  const narrow = stage.host.clientWidth < 560;
  minor.forEach((l) => { if (l) l.visible = !narrow && !inReel(); });
  const y = narrow && !inReel() ? y0 : 0;
  if (!stage.shift || stage.shift[1] !== y) stage.setShift(0, y);
  return narrow;
}
// Boards sit beside the model on a wide screen; in the tall reel video they move to another spot.
export function reelBoards(list) {
  const r = inReel();
  list.forEach(([b, pos, scale = 1, rotY = 0]) => {
    if (!b.home) b.home = { p: b.mesh.position.clone(), r: b.mesh.rotation.clone(), s: b.mesh.scale.x };
    if (r) { b.mesh.position.set(...pos); b.mesh.scale.setScalar(scale); b.mesh.rotation.set(0, rotY, 0); }
    else { b.mesh.position.copy(b.home.p); b.mesh.scale.setScalar(b.home.s); b.mesh.rotation.copy(b.home.r); }
  });
}
// Deterministic noise, so every video frame is the same on every run.
export const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export function gauss(n) { const u = Math.max(1e-6, hash01(n)), v = hash01(n + 17.3); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
// Smooth deterministic wobble in [-1, 1] (sum of sines), for jitter that looks like sensor noise.
export const wob = (t, k = 0) => (Math.sin(t * 37.1 + k * 1.7) * 0.5 + Math.sin(t * 61.7 + k * 2.9) * 0.3 + Math.sin(t * 97.3 + k * 4.1) * 0.2);

// A rod you can re-aim every frame: between(a, b) with THREE.Vector3 or arrays.
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
export function stick(r, mat, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, seg), mat);
  m.between = (a, b) => {
    a.isVector3 ? _A.copy(a) : _A.set(...a); b.isVector3 ? _B.copy(b) : _B.set(...b);
    const L = _A.distanceTo(_B); m.visible = L > 1e-4; if (!m.visible) return;
    m.position.copy(_A).add(_B).multiplyScalar(0.5); m.scale.set(1, L, 1);
    m.quaternion.setFromUnitVectors(_Y, _B.sub(_A).normalize());
  };
  return m;
}
// A line made of many segments that can be rewritten each frame (rays, trails).
export function lines(max, color, opacity = 0.9) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 6), col = new Float32Array(max * 6);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, toneMapped: false, depthWrite: false }));
  m.frustumCulled = false;
  let n = 0; const c = new THREE.Color(color);
  m.begin = () => { n = 0; };
  m.seg = (a, b, hex) => {
    if (n >= max) return; const i = n * 6; if (hex !== undefined) c.set(hex);
    pos[i] = a.x; pos[i + 1] = a.y; pos[i + 2] = a.z; pos[i + 3] = b.x; pos[i + 4] = b.y; pos[i + 5] = b.z;
    col[i] = col[i + 3] = c.r; col[i + 1] = col[i + 4] = c.g; col[i + 2] = col[i + 5] = c.b; n++;
  };
  m.end = () => { g.setDrawRange(0, n * 2); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; };
  return m;
}

// ---------------------------------------------------------------- body shapes
// A tapered capsule hanging from y=0 down to y=-len (radius rt at the top, rb at the bottom).
export function taper(len, rt, rb, mat, seg = 18) {
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(rb * Math.cos(a) + 1e-4, -len + rb * Math.sin(a))); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(rt * Math.cos(a) + 1e-4, rt * Math.sin(a))); }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// A blob from y=0 up to y=h: a lathe of radius profile [[t, r]], t in 0..1.
function blob(h, prof, mat, sx = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([t, r]) => new THREE.Vector2(Math.max(1e-4, r), t * h)), 24), mat);
  m.scale.set(sx, 1, sz); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- proportions
// The performer: textbook adult proportions (about 1.76 m tall).
export const PERF = {
  thigh: 0.44, shin: 0.43, ankleH: 0.08, foot: 0.24, hipW: 0.09,
  spine: 0.26, chest: 0.24, neck: 0.09, head: 0.115, shW: 0.18,
  upper: 0.29, fore: 0.26, hand: 0.17,
  r: { thigh: [0.075, 0.05], shin: [0.05, 0.037], upper: [0.045, 0.038], fore: [0.037, 0.028], torso: 1, hand: 0.03 },
};
export const legLen = (P) => P.thigh + P.shin + P.ankleH;

// Our own creatures for retargeting. Scale factors multiply the performer's lengths.
export const CREATURES = {
  tall: { name: 'Stilt-strider', note: 'long legs and arms, small head', legs: 1.5, arms: 1.35, torso: 0.9, width: 0.8, head: 0.8, arms4: false, skin: 0x2fb9a4, belly: 0x9ff0dd },
  short: { name: 'Bumble-gnome', note: 'short legs, wide body, big head', legs: 0.55, arms: 0.75, torso: 1.1, width: 1.35, head: 1.5, arms4: false, skin: 0xf08a3c, belly: 0xffd1a1 },
  four: { name: 'Quadra', note: 'four arms, normal legs', legs: 1.0, arms: 1.05, torso: 1.12, width: 1.15, head: 1.05, arms4: true, skin: 0x8a63d2, belly: 0xd4c2ff },
};
export function creatureProps(kind) {
  const c = CREATURES[kind], P = JSON.parse(JSON.stringify(PERF));
  P.thigh *= c.legs; P.shin *= c.legs; P.ankleH *= Math.sqrt(c.legs); P.foot *= Math.sqrt(c.legs);
  P.upper *= c.arms; P.fore *= c.arms; P.hand *= c.arms;
  P.spine *= c.torso; P.chest *= c.torso; P.shW *= c.width; P.hipW *= c.width; P.head *= c.head;
  P.r.thigh = P.r.thigh.map((r) => r * Math.sqrt(c.width)); P.r.torso = c.width;
  return P;
}

// ---------------------------------------------------------------- markers (a 53-marker full-body set)
// Based on the common "Plug-in Gait" 39-marker layout plus extra markers that production sets add
// for cleaner solving (medial knees, thigh and shin fronts, shoulder blades, waist, chest sides, 5th toe bones).
// Each entry: [name, joint, [x, y, z] offset in that joint's frame (left side; right side mirrors x), part]
const MK_CENTRE = [
  ['LFHD', 'head', [0.065, 0.17, 0.085], 'head'], ['RFHD', 'head', [-0.065, 0.17, 0.085], 'head'],
  ['LBHD', 'head', [0.065, 0.15, -0.09], 'head'], ['RBHD', 'head', [-0.065, 0.15, -0.09], 'head'],
  ['C7', 'chest', [0, 0.25, -0.085], 'torso'], ['T10', 'spine', [0, 0.18, -0.12], 'torso'],
  ['CLAV', 'chest', [0, 0.22, 0.095], 'torso'], ['STRN', 'chest', [0, 0.1, 0.125], 'torso'], ['RBAK', 'chest', [-0.09, 0.1, -0.12], 'torso'],
];
const MK_SIDE = [
  ['SHO', 'chest', [0.18, 0.27, 0], 'arm'], ['UPA', 'sh', [0.062, -0.15, 0], 'arm'], ['ELB', 'el', [0.05, 0, -0.02], 'arm'],
  ['FRM', 'el', [0.045, -0.13, 0], 'arm'], ['WRA', 'wr', [0.0, 0, 0.042], 'arm'], ['WRB', 'wr', [0.0, 0, -0.042], 'arm'], ['FIN', 'wr', [0.042, -0.1, 0.0], 'arm'],
  ['SHB', 'chest', [0.1, 0.15, -0.11], 'torso'], ['CHT', 'chest', [0.15, 0.08, 0.05], 'torso'],
  ['ASI', 'pelvis', [0.095, 0.03, 0.11], 'torso'], ['PSI', 'pelvis', [0.05, 0.05, -0.115], 'torso'], ['HIP', 'pelvis', [0.17, 0.07, 0], 'torso'],
  ['THI', 'hip', [0.085, -0.22, 0], 'leg'], ['THF', 'hip', [0.0, -0.3, 0.078], 'leg'], ['KNE', 'kn', [0.072, 0, 0], 'leg'], ['KNI', 'kn', [-0.07, 0, 0], 'leg'],
  ['TIB', 'kn', [0.055, -0.22, 0], 'leg'], ['TIF', 'kn', [0.0, -0.15, 0.055], 'leg'],
  ['ANK', 'an', [0.055, 0, 0], 'leg'], ['HEE', 'an', [0, -0.05, -0.1], 'leg'], ['TOE', 'an', [0, 0.0, 0.13], 'leg'], ['MT5', 'an', [0.05, -0.055, 0.09], 'leg'],
];
export const MARKER_DEFS = [
  ...MK_CENTRE.map(([n, j, o, p]) => ({ name: n, joint: j, off: o, part: p, side: 0 })),
  ...['L', 'R'].flatMap((S) => MK_SIDE.map(([n, j, o, p]) => ({
    name: S + n, side: S === 'L' ? 1 : -1,
    joint: ['pelvis', 'chest', 'spine', 'head'].includes(j) ? j : j + S,
    off: [S === 'L' ? o[0] : -o[0], o[1], o[2]], part: p === 'arm' || p === 'leg' ? p + S : p,
  }))),
];
export const PART_COL = { head: 0xc49bff, torso: 0xffd166, armL: 0x5fd4ff, armR: 0xff7ab8, legL: 0x7be08c, legR: 0xff9a5c };

// ---------------------------------------------------------------- the body (mannequin or creature)
// Returns { root, J (joint groups), apply(pose), markers, capsules(), footPoints(), meshes, setLook }.
export function makeBody({ P = PERF, suit = 0x23262e, skin = null, markers = false, creature = null, markerR = 0.02 } = {}) {
  const root = new THREE.Group();
  const J = {};
  const g = (name, parent, pos) => { const o = new THREE.Group(); o.position.set(...pos); parent.add(o); J[name] = o; return o; };
  const suitM = M.matte(suit, { roughness: 0.9 });
  const cr = creature ? CREATURES[creature] : null;
  const skinM = cr ? M.matte(cr.skin, { roughness: 0.7 }) : suitM;
  const bellyM = cr ? M.matte(cr.belly, { roughness: 0.8 }) : suitM;
  const headM = cr ? skinM : M.matte(skin ?? 0x2b2f38, { roughness: 0.55 });
  const meshes = [];
  const add = (parent, m) => { parent.add(m); meshes.push(m); return m; };
  const hipH = legLen(P);

  const pelvis = g('pelvis', root, [0, hipH, 0]);
  add(pelvis, blob(0.2, [[0, 0.1], [0.25, 0.15], [0.7, 0.15], [1, 0.13]], skinM, 1.18 * P.r.torso, 0.72)).position.y = -0.08;
  const spine = g('spine', pelvis, [0, 0.02, 0]);
  const chest = g('chest', spine, [0, P.spine, 0]);
  add(spine, blob(P.spine + 0.04, [[0, 0.13], [0.5, 0.125], [1, 0.14]], skinM, 1.12 * P.r.torso, 0.76)).position.y = 0.02;
  add(chest, blob(P.chest + 0.02, [[0, 0.14], [0.35, 0.16], [0.75, 0.16], [0.92, 0.12], [1, 0.05]], skinM, 1.22 * P.r.torso, 0.74)).position.y = -0.02;
  if (cr) { const b = add(spine, blob(P.spine + P.chest * 0.7, [[0, 0.02], [0.2, 0.11], [0.8, 0.11], [1, 0.02]], bellyM, 1.05 * P.r.torso, 0.5)); b.position.set(0, 0.04, 0.055); }
  const neck = g('neck', chest, [0, P.chest, 0]);
  add(neck, taper(P.neck + 0.03, 0.045, 0.05, skinM)).position.y = P.neck + 0.02;
  const head = g('head', neck, [0, P.neck, 0]);
  const hs = P.head;
  const skull = add(head, sphere(hs, headM, 32)); skull.scale.set(0.84, 1.06, 0.95); skull.position.y = hs * 0.95;
  if (!cr) {
    // a mocap cap on the faceless head (a thin shell over the top)
    const cap = add(head, new THREE.Mesh(new THREE.SphereGeometry(hs * 1.02, 28, 14, 0, TAU, 0, Math.PI * 0.42), M.matte(0x1b1d23)));
    cap.scale.set(0.84, 1.06, 0.95); cap.position.y = hs * 0.95; cap.rotation.x = -0.25;
  } else creatureHead(head, cr, hs, add);

  const arm = (S, sgn, yOff = 0, suffix = '') => {
    const sh = g('sh' + S + suffix, chest, [sgn * P.shW, P.chest - 0.035 - yOff, 0]);
    add(sh, sphere(P.r.upper[0] * 1.05, skinM, 16));
    add(sh, taper(P.upper, P.r.upper[0], P.r.upper[1], skinM));
    const el = g('el' + S + suffix, sh, [0, -P.upper, 0]);
    add(el, taper(P.fore, P.r.fore[0], P.r.fore[1], skinM));
    const wr = g('wr' + S + suffix, el, [0, -P.fore, 0]);
    const hand = add(wr, taper(P.hand * 0.9, 0.034, 0.028, cr ? skinM : M.matte(0x30343d)));
    hand.scale.set(0.62, 1, 1.25);
  };
  arm('L', 1); arm('R', -1);
  if (cr?.arms4) { arm('L', 1, P.chest * 0.42, '2'); arm('R', -1, P.chest * 0.42, '2'); }

  const leg = (S, sgn) => {
    const hp = g('hip' + S, pelvis, [sgn * P.hipW, 0, 0]);
    add(hp, taper(P.thigh, P.r.thigh[0], P.r.thigh[1], skinM));
    const kn = g('kn' + S, hp, [0, -P.thigh, 0]);
    add(kn, taper(P.shin, P.r.shin[0], P.r.shin[1], skinM));
    const an = g('an' + S, kn, [0, -P.shin, 0]);
    const ft = add(an, taper(P.foot, 0.038, 0.034, cr ? skinM : M.matte(0x1b1d23)));
    ft.rotation.x = -Math.PI / 2; ft.position.set(0, -P.ankleH + 0.036, -0.06); ft.scale.set(1.2, 1, 0.9);
  };
  leg('L', 1); leg('R', -1);

  // markers
  const mk = [];
  if (markers) {
    const geo = new THREE.SphereGeometry(markerR, 12, 8);
    for (const d of MARKER_DEFS) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.25, metalness: 0.2, emissive: 0x000000 }));
      mesh.position.set(...d.off); J[d.joint].add(mesh);
      mk.push({ ...d, mesh, world: new THREE.Vector3() });
    }
  }

  // body capsules for hiding markers from cameras (axis end points in joint frames, radius)
  const CAPS = [
    ['pelvis', [0, -0.06, 0], 'chest', [0, 0.0, 0], 0.11 * P.r.torso],
    ['chest', [0, 0.0, 0], 'chest', [0, P.chest - 0.09, 0], 0.11 * P.r.torso],
    ['chest', [0.08 * P.r.torso, 0.1, 0], 'chest', [-0.08 * P.r.torso, 0.1, 0], 0.1],
    ['head', [0, 0.05, 0], 'head', [0, hs * 1.7, 0], 0.09 * (hs / 0.115)],
  ];
  for (const S of ['L', 'R']) {
    CAPS.push(['hip' + S, [0, 0, 0], 'kn' + S, [0, 0, 0], P.r.thigh[0] * 0.9], ['kn' + S, [0, 0, 0], 'an' + S, [0, 0, 0], P.r.shin[0] * 0.9],
      ['an' + S, [0, -0.045, -0.05], 'an' + S, [0, -0.045, P.foot - 0.08], 0.034],
      ['sh' + S, [0, 0, 0], 'el' + S, [0, 0, 0], P.r.upper[0] * 0.9], ['el' + S, [0, 0, 0], 'wr' + S, [0, 0, 0], P.r.fore[0] * 0.9],
      ['wr' + S, [0, 0, 0], 'wr' + S, [0, -P.hand * 0.8, 0], 0.028]);
  }
  const caps = CAPS.map(([ja, a, jb, b, r]) => ({ ja: J[ja], a: new THREE.Vector3(...a), jb: J[jb], b: new THREE.Vector3(...b), r, A: new THREE.Vector3(), B: new THREE.Vector3() }));

  const ftmp = new THREE.Vector3();
  const body = {
    root, J, P, markers: mk, meshes, hipH, creature,
    apply(p) { applyPose(J, p, !!cr?.arms4); },
    update() {
      root.updateMatrixWorld(true);
      for (const m of mk) m.mesh.getWorldPosition(m.world);
      for (const c of caps) { c.A.copy(c.a).applyMatrix4(c.ja.matrixWorld); c.B.copy(c.b).applyMatrix4(c.jb.matrixWorld); }
    },
    caps,
    // lowest point of each foot (heel or toe), world y; and the ankle world position
    foot(S, out = new THREE.Vector3()) { return J['an' + S].getWorldPosition(out); },
    lowY() {
      let y = Infinity;
      for (const S of ['L', 'R']) {
        const an = J['an' + S];
        y = Math.min(y, ftmp.set(0, -P.ankleH, -0.08).applyMatrix4(an.matrixWorld).y, ftmp.set(0, -P.ankleH, P.foot - 0.1).applyMatrix4(an.matrixWorld).y);
      }
      return y;
    },
    setOpacity(o) {
      for (const m of meshes) { const ms = m.material; ms.transparent = o < 1; ms.opacity = o; ms.depthWrite = o >= 1; m.castShadow = o > 0.5; }
    },
    setVisible(v) { for (const m of meshes) m.visible = v; },
  };
  return body;
}

// Our creatures' heads: eyes, ears or horns. None of them is based on an existing character.
function creatureHead(head, cr, hs, add) {
  const white = M.plastic(0xf4f4ee), dark = M.plastic(0x121218), acc = M.matte(cr.belly);
  const cy = hs * 0.95;
  for (const s of [1, -1]) {
    const e = add(head, sphere(hs * 0.24, white, 16)); e.position.set(s * hs * 0.34, cy + hs * 0.18, hs * 0.78);
    const p = add(head, sphere(hs * 0.12, dark, 12)); p.position.set(s * hs * 0.34, cy + hs * 0.2, hs * 0.97);
  }
  if (cr === CREATURES.tall) {
    for (const s of [1, -1]) { const h = add(head, taper(hs * 1.2, hs * 0.08, hs * 0.03, acc)); h.position.set(s * hs * 0.45, cy + hs * 0.7, 0); h.rotation.set(0, 0, Math.PI - s * 0.35); }
  } else if (cr === CREATURES.short) {
    for (const s of [1, -1]) { const ear = add(head, sphere(hs * 0.32, acc, 16)); ear.scale.set(0.35, 1, 0.8); ear.position.set(s * hs * 0.92, cy + hs * 0.25, -0.02); ear.rotation.z = s * 0.4; }
  } else {
    const c = add(head, taper(hs * 0.7, hs * 0.14, hs * 0.05, acc)); c.position.set(0, cy + hs * 0.95, -hs * 0.2); c.rotation.x = Math.PI + 0.5;
  }
  const mouth = add(head, box(hs * 0.5, hs * 0.07, hs * 0.1, dark)); mouth.position.set(0, cy - hs * 0.35, hs * 0.86);
}

// Apply joint angles (radians). Hip/shoulder "pitch" > 0 swings the limb forward; knee > 0 bends the
// shin back; elbow > 0 bends the forearm forward; foot > 0 points the toes down relative to the ground.
function applyPose(J, p, four) {
  J.pelvis.rotation.set(p.lean * 0.35, p.twist, p.roll);
  J.spine.rotation.set(p.lean * 0.65, -p.twist * 1.4, -p.roll * 0.6);
  J.neck.rotation.set(-p.lean * 0.6 + p.nod, p.twist * 0.4 + (p.look || 0), 0);
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    J['hip' + S].rotation.set(-p['hip' + S], 0, s * (p.spread || 0.02));
    J['kn' + S].rotation.x = p['kn' + S];
    J['an' + S].rotation.x = p['hip' + S] - p['kn' + S] - p.lean * 0.35 + p['ft' + S];
    J['sh' + S].rotation.set(-p['sh' + S], 0, s * p['ab' + S]);
    J['el' + S].rotation.x = -p['el' + S];
    J['wr' + S].rotation.x = 0.1;
    if (four) {
      J['sh' + S + '2'].rotation.set(-p['sh' + S] * 0.8 - 0.5 * (p.four || 0), 0, s * (p['ab' + S] + 0.45));
      J['el' + S + '2'].rotation.x = -(p['el' + S] + 0.4);
    }
  }
}

// ---------------------------------------------------------------- the performance (walk, run, jump...)
const pd = (a) => a - Math.round(a);                          // periodic difference in [-0.5, 0.5]
const bump = (p, c, w) => Math.exp(-(pd(p - c) ** 2) / (2 * w * w));
const KEYS = ['lean', 'twist', 'roll', 'nod', 'look', 'spread', 'four', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR', 'shL', 'shR', 'abL', 'abR', 'elL', 'elR'];
export const zeroPose = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

// Gait numbers: a normal walk is about 0.9–1 stride a second; a jog about 1.35 strides a second
// (Perry & Burnfield, Gait Analysis; Novacheck 1998, "The biomechanics of running"). Joint ranges follow
// the textbook curves in shape: hip ±20–25° walking, knee ≈ 60° in swing walking and ≈ 100°+ running.
export const MOVES = {
  walk: { name: 'Walk', freq: 0.95, stance: 0.62 },
  run: { name: 'Run', freq: 1.35, stance: 0.33 },
  jump: { name: 'Jump', period: 2.4 },
  idle: { name: 'Stand', period: 4 },
  tpose: { name: 'T-pose', period: 4 },
};

function legWalk(q) {
  return {
    hip: 0.07 + 0.34 * Math.cos(TAU * q),
    kn: 0.07 + 0.22 * bump(q, 0.13, 0.07) + 1.05 * bump(q, 0.73, 0.1),
    ft: -0.22 * bump(q, 0.0, 0.04) + 0.5 * bump(q, 0.6, 0.06) + 0.12 * bump(q, 0.7, 0.05),
  };
}
function legRun(q) {
  return {
    hip: 0.22 + 0.55 * Math.cos(TAU * q),
    kn: 0.32 + 0.4 * bump(q, 0.14, 0.06) + 1.75 * bump(q, 0.64, 0.13),
    ft: 0.55 * bump(q, 0.34, 0.06) - 0.12 * bump(q, 0.95, 0.05) + 0.1,
  };
}
export function poseAt(move, ph, extra = {}) {
  const p = zeroPose();
  p.spread = 0.03; p.abL = p.abR = 0.08; p.elL = p.elR = 0.2;
  if (move === 'walk' || move === 'run') {
    const run = move === 'run', leg = run ? legRun : legWalk;
    const L = leg(ph), R = leg(ph + 0.5);
    p.hipL = L.hip; p.knL = L.kn; p.ftL = L.ft; p.hipR = R.hip; p.knR = R.kn; p.ftR = R.ft;
    const swing = run ? 0.55 : 0.3;
    p.shL = swing * Math.cos(TAU * (ph + 0.5)); p.shR = swing * Math.cos(TAU * ph);
    p.elL = run ? 1.45 : 0.3 + 0.14 * (1 + Math.cos(TAU * (ph + 0.5))); p.elR = run ? 1.45 : 0.3 + 0.14 * (1 + Math.cos(TAU * ph));
    p.abL = p.abR = run ? 0.14 : 0.09;
    p.lean = run ? 0.17 : 0.04; p.twist = (run ? 0.16 : 0.1) * Math.cos(TAU * ph); p.roll = 0.03 * Math.sin(TAU * ph * 2);
    p.nod = 0.02 * Math.sin(TAU * ph * 2);
  } else if (move === 'jump') {
    const u = ph;
    // crouch amount: down, spring up, fly, land, stand
    const c = u < 0.1 ? 0 : u < 0.3 ? smooth((u - 0.1) / 0.2) : u < 0.4 ? 1 - smooth((u - 0.3) / 0.1) : u < 0.62 ? 0.12 : u < 0.72 ? 0.12 + 0.58 * smooth((u - 0.62) / 0.1) : u < 0.95 ? 0.7 * (1 - smooth((u - 0.72) / 0.23)) : 0;
    p.hipL = p.hipR = 1.0 * c; p.knL = p.knR = 1.9 * c;
    const air = u > 0.38 && u < 0.64 ? Math.sin(Math.PI * (u - 0.38) / 0.26) : 0;
    p.ftL = p.ftR = 0.5 * air;
    p.lean = 0.45 * c;
    const back = u < 0.33 ? -0.9 * smooth((u - 0.08) / 0.22) : 0;
    const up = bump(u, 0.47, 0.08) * 2.7;
    p.shL = p.shR = back + up + (u > 0.6 && u < 0.9 ? 0.4 * bump(u, 0.72, 0.07) : 0);
    p.elL = p.elR = 0.2 + 0.3 * c; p.abL = p.abR = 0.12 + 0.2 * air;
  } else if (move === 'tpose') {
    p.abL = p.abR = Math.PI / 2 - 0.02; p.elL = p.elR = 0.02; p.shL = p.shR = 0; p.spread = 0.09;
    p.nod = 0.01 * Math.sin(TAU * ph);
  } else {
    // idle: breathing and a slow weight shift
    p.roll = 0.025 * Math.sin(TAU * ph); p.twist = 0.03 * Math.sin(TAU * ph * 0.5);
    p.shL = 0.05 + 0.02 * Math.sin(TAU * ph); p.shR = 0.05; p.elL = p.elR = 0.25; p.abL = p.abR = 0.12;
    p.knL = 0.05; p.knR = 0.08 + 0.06 * (1 + Math.sin(TAU * ph)); p.hipR = p.knR / 2; p.hipL = 0.03;
    p.spread = 0.05; p.nod = 0.03 * Math.sin(TAU * ph * 1.5);
  }
  return Object.assign(p, extra);
}
// ballistic lift of the hips (m) during a jump's flight; flight 0.4→0.62 of a 2.4 s cycle = 0.53 s,
// so take-off speed v0 = g·T/2 ≈ 2.6 m/s and the peak is v0²/2g ≈ 0.34 m.
export function jumpLift(u, period = MOVES.jump.period) {
  if (u < 0.4 || u > 0.62) return 0;
  const T = 0.22 * period, t = (u - 0.4) * period, v0 = G * T / 2;
  return Math.max(0, v0 * t - 0.5 * G * t * t);
}
export const JUMP_PEAK = (() => { const T = 0.22 * MOVES.jump.period, v0 = G * T / 2; return v0 * v0 / (2 * G); })();

// A performer that moves around a circle, planting its feet: each frame the stance foot is pinned to
// where it was, and the body is moved to match. So walking speed comes out of the leg motion itself.
export class Performer {
  constructor(body, { center = [0, 0], radius = 1.3, yaw = 0 } = {}) {
    this.b = body; this.c = center; this.R = radius;
    this.pos = new THREE.Vector3(center[0] + radius, 0, center[1]);
    this.yaw = 0; this.move = 'idle'; this.prevMove = 'idle'; this.blend = 1;
    this.ph = { walk: 0, run: 0, jump: 0, idle: 0, tpose: 0 };
    this.prevFoot = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.stance = null; this.vel = new THREE.Vector3();
    this.speed = 0; this.delta = new THREE.Vector3(); this.dyaw = 0; this.pose = zeroPose(); this.first = true; this.fixed = false;
    if (yaw) this.yaw = yaw;
  }
  place(x, z, yaw) { this.pos.set(x, 0, z); this.yaw = yaw; this.first = true; }
  setMove(m) { if (m !== this.move) { this.prevMove = this.move; this.move = m; this.blend = 0; this.first = true; } }
  phaseOf(m) { return this.ph[m]; }
  update(dt, rate = 1, extra = {}) {
    dt = Math.max(0, Math.min(dt, 0.05));
    const m = this.move;
    for (const k of Object.keys(this.ph)) {
      const d = MOVES[k]; this.ph[k] = (this.ph[k] + dt * rate * (d.freq || 1 / d.period)) % 1;
    }
    this.blend = Math.min(1, this.blend + dt / 0.45);
    const A = poseAt(this.prevMove, this.ph[this.prevMove]), B = poseAt(m, this.ph[m]);
    const k = smooth(this.blend), p = this.pose;
    for (const key of KEYS) p[key] = lerp(A[key], B[key], k);
    Object.assign(p, extra);
    const b = this.b; b.apply(p);
    const locomote = (m === 'walk' || m === 'run') && !this.fixed;
    // steer around the circle (counter-clockwise seen from above)
    const dx = this.pos.x - this.c[0], dz = this.pos.z - this.c[1];
    const r = Math.hypot(dx, dz) || 1;
    if (locomote) {
      const tang = Math.atan2(-dz, dx);                 // facing along the tangent: forward = (sin yaw, cos yaw)
      const want = tang - clamp((r - this.R) * 0.9, -0.6, 0.6);
      const dy = pd((want - this.yaw) / TAU) * TAU;
      this.dyaw = clamp(dy, -2.5 * dt * rate, 2.5 * dt * rate);
      this.yaw += this.dyaw;
    } else this.dyaw = 0;
    b.root.position.set(this.pos.x, 0, this.pos.z); b.root.rotation.y = this.yaw;
    b.root.updateMatrixWorld(true);
    const lift = m === 'jump' ? jumpLift(this.ph.jump) * k : 0;
    b.root.position.y = -b.lowY() + lift;
    b.root.updateMatrixWorld(true);
    // which foot carries the weight
    let st = null;
    if (m === 'walk' || m === 'run') {
      const d = MOVES[m], qL = this.ph[m], qR = (this.ph[m] + 0.5) % 1;
      const inL = qL < d.stance, inR = qR < d.stance;
      st = inL && inR ? (qL < qR ? 'L' : 'R') : inL ? 'L' : inR ? 'R' : null;
    }
    const cur = { L: b.foot('L'), R: b.foot('R') };
    const before = this.pos.clone();
    if (locomote && !this.first && st && st === this.stance) {
      const dd = this.prevFoot[st].clone().sub(cur[st]); dd.y = 0;
      this.pos.add(dd);
      if (dt > 0) this.vel.copy(dd).multiplyScalar(1 / dt);
    } else if (locomote && !this.first) {
      this.pos.addScaledVector(this.vel, dt);
    } else if (!locomote) this.vel.set(0, 0, 0);
    b.root.position.x = this.pos.x; b.root.position.z = this.pos.z;
    this.delta.copy(this.pos).sub(before);
    b.update();
    this.prevFoot.L.copy(b.foot('L')); this.prevFoot.R.copy(b.foot('R'));
    this.stance = st; this.first = false;
    this.speed = approach(this.speed, dt > 0 ? this.delta.length() / dt : this.speed, 3, dt);
    this.lift = lift;
    return p;
  }
}

// Retarget: copy the joint rotations onto another body. Root travel is the performer's, scaled by
// `scale` (1 = copied as-is). Returns the stance-foot slide speed (m/s) for this frame.
export class Retarget {
  constructor(body, center = [0, 0]) {
    this.b = body; this.c = center; this.pos = new THREE.Vector3(center[0], 0, center[1]); this.yaw = Math.PI;
    this.prev = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.slide = 0; this.first = true;
  }
  sync(perf, fromCenter) {
    // start at the same place relative to its own circle
    this.pos.set(this.c[0] + (perf.pos.x - fromCenter[0]), 0, this.c[1] + (perf.pos.z - fromCenter[1])); this.yaw = perf.yaw; this.first = true;
  }
  update(dt, perf, scale = 1, extra = {}) {
    dt = Math.max(0, dt);
    const b = this.b;
    b.apply({ ...perf.pose, ...extra });
    // performer's travel this frame, turned into this body's heading, scaled
    const d = perf.delta.clone().applyAxisAngle(_Y, this.yaw - (perf.yaw - perf.dyaw));
    this.yaw += perf.dyaw;
    this.pos.addScaledVector(d, scale);
    // keep it on its own circle
    const dx = this.pos.x - this.c[0], dz = this.pos.z - this.c[1], r = Math.hypot(dx, dz);
    const R = Math.max(0.3, perf.R * scale);
    if (r > 0.01 && perf.move !== 'jump') { this.pos.x = this.c[0] + dx * lerp(1, R / r, 0.02); this.pos.z = this.c[1] + dz * lerp(1, R / r, 0.02); }
    b.root.position.set(this.pos.x, 0, this.pos.z); b.root.rotation.y = this.yaw;
    b.root.updateMatrixWorld(true);
    b.root.position.y = -b.lowY() + (perf.lift || 0) * Math.sqrt(scale);
    b.update();
    let slide = 0;
    const st = perf.stance;
    const cur = { L: b.foot('L'), R: b.foot('R') };
    if (st && !this.first && dt > 0) { const v = cur[st].clone().sub(this.prev[st]); v.y = 0; slide = v.length() / dt; }
    this.prev.L.copy(cur.L); this.prev.R.copy(cur.R); this.first = false;
    this.slide = approach(this.slide, slide, 6, dt);
    return slide;
  }
}

// ---------------------------------------------------------------- infrared cameras
// A mocap camera: dark body, lens, and a ring of infrared LEDs (drawn dim red; real ones are ~850 nm
// near-infrared, invisible to the eye). Its +z faces the target.
export function makeIRCam(s = 1) {
  const g = new THREE.Group();
  const bodyM = M.matte(0x2a2e37, { roughness: 0.5 });
  const b = box(0.15 * s, 0.13 * s, 0.2 * s, bodyM); g.add(b);
  const fin = box(0.155 * s, 0.02 * s, 0.16 * s, M.metal(0x6a717e)); fin.position.set(0, 0.075 * s, -0.01 * s); g.add(fin);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.04 * s, 0.07 * s, 20), M.matte(0x0b0c10));
  lens.rotation.x = Math.PI / 2; lens.position.z = 0.12 * s; g.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.03 * s, 20), M.plastic(0x1a2340, { roughness: 0.05, metalness: 0.4 }));
  glass.position.z = 0.156 * s; g.add(glass);
  const ringM = M.glow(0xff3b4e); ringM.transparent = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058 * s, 0.013 * s, 8, 24), ringM);
  ring.position.z = 0.102 * s; g.add(ring);
  g.ring = ring; g.body = b;
  return g;
}

// A ring of N cameras on a truss around the volume. Returns { group, cams: [{ mesh, cam, pos }], set(N) }.
export function makeCamRing(root, { R = 3.6, H = 2.7, target = [0, 0.95, 0], max = 24, fov = 56 } = {}) {
  const group = new THREE.Group(); root.add(group);
  const truss = new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.035, 8, 96), M.metal(0x8a919e, { roughness: 0.4 }));
  truss.rotation.x = Math.PI / 2; truss.position.y = H + 0.28; group.add(truss);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, H + 0.3, 10), M.metal(0x6a717e, { roughness: 0.5 }));
    post.position.set((R + 0.1) * Math.cos(a), (H + 0.3) / 2, (R + 0.1) * Math.sin(a)); post.castShadow = true; group.add(post);
  }
  group.traverse((o) => { o.castShadow = false; });
  const cams = [];
  const T = new THREE.Vector3(...target);
  for (let i = 0; i < max; i++) {
    const mesh = makeIRCam(1.25); group.add(mesh); mesh.traverse((o) => { o.castShadow = false; });
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), M.metal(0x6a717e)); group.add(arm);
    const cam = new THREE.PerspectiveCamera(fov, 1.31, 0.1, 30);
    cams.push({ mesh, arm, cam, pos: new THREE.Vector3(), on: true, i });
  }
  const ring = {
    group, cams, R, H, n: 0, T,
    set(N, phase = 0) {
      ring.n = N;
      cams.forEach((c, i) => {
        const vis = i < N; c.mesh.visible = c.arm.visible = vis; c.on = vis;
        if (!vis) return;
        const a = phase + (i / N) * TAU;
        const h = H - (i % 2) * 0.55;                         // alternate high and low cameras
        c.pos.set(R * Math.cos(a), h, R * Math.sin(a));
        c.mesh.position.copy(c.pos); c.mesh.lookAt(T);
        c.arm.position.set(c.pos.x * 1.01, (h + H + 0.28) / 2 + 0.03, c.pos.z * 1.01); c.arm.scale.y = (H + 0.28 - h + 0.05) / 0.3;
        c.cam.position.copy(c.pos); c.cam.lookAt(T); c.cam.updateMatrixWorld(true);
        c.cam.updateProjectionMatrix();
      });
    },
  };
  return ring;
}

// Closest distance between segments p0-p1 and q0-q1 (for "does a body part block this ray?").
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
export function segSegDist(p0, p1, q0, q1) {
  _d1.subVectors(p1, p0); _d2.subVectors(q1, q0); _r.subVectors(p0, q0);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) return _r.length();
  if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p0).addScaledVector(_d1, s); _c2.copy(q0).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}
// Can camera position C see point X, given body capsules? Stops 3 cm short of the marker so the
// marker's own limb only blocks it when the marker is on the far side.
const _end = new THREE.Vector3();
export function blocked(C, X, caps, extra = []) {
  _end.subVectors(X, C); const L = _end.length(); _end.multiplyScalar((L - 0.035) / L).add(C);
  for (const c of caps) if (segSegDist(C, _end, c.A, c.B) < c.r) return true;
  for (const c of extra) if (segSegDist(C, _end, c.A, c.B) < c.r) return true;
  return false;
}
// Project a world point into a camera: returns [u, v] in -1..1 or null if outside the picture.
const _p = new THREE.Vector3();
export function project(cam, X) {
  _p.copy(X).applyMatrix4(cam.matrixWorldInverse);
  if (_p.z > -0.05) return null;
  _p.applyMatrix4(cam.projectionMatrix);
  if (Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1) return null;
  return [_p.x, _p.y];
}

// ---------------------------------------------------------------- triangulation maths
// Camera spec used for the error model: a 2048 × 2048-pixel sensor (4 MP, a mid-range mocap camera)
// behind a lens with a 56° field of view. Each marker is a bright blob a few pixels wide, and its
// centre (centroid) can be found to a fraction of a pixel (typically 0.05–0.2 px).
export const SENSOR_PX = 2048, FOV_DEG = 56;
export const F_PX = (SENSOR_PX / 2) / Math.tan((FOV_DEG / 2) * D2R);   // ≈ 1926 px focal length

// Least-squares ray intersection. rays = [{ o: Vector3, d: unit Vector3 }]. Each ray's sideways error is
// sigma_i = distance × (centroid precision / focal length in px). Information matrix
// A = Σ (I − d dᵀ)/σ², point = A⁻¹ Σ (I − d dᵀ) o / σ², covariance = A⁻¹.
export function triangulate(rays, X, sigmaPx = 0.1) {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], bv = [0, 0, 0];
  for (const r of rays) {
    const dist = r.o.distanceTo(X), s = Math.max(1e-6, dist * sigmaPx / F_PX), w = 1 / (s * s);
    const d = [r.d.x, r.d.y, r.d.z], o = [r.o.x, r.o.y, r.o.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = ((i === j ? 1 : 0) - d[i] * d[j]) * w;
      A[i * 3 + j] += m; bv[i] += m * o[j];
    }
  }
  const inv = inv3(A);
  if (!inv) return null;
  const p = new THREE.Vector3(inv[0] * bv[0] + inv[1] * bv[1] + inv[2] * bv[2], inv[3] * bv[0] + inv[4] * bv[1] + inv[5] * bv[2], inv[6] * bv[0] + inv[7] * bv[1] + inv[8] * bv[2]);
  return { p, cov: inv, rms: Math.sqrt(Math.max(0, inv[0] + inv[4] + inv[8])) };
}
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const tr = Math.abs(a) + Math.abs(e) + Math.abs(i);
  if (!(Math.abs(det) > 1e-12 * tr * tr * tr)) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
// Eigen-decomposition of a symmetric 3×3 matrix (Jacobi). Returns { vals: [3], vecs: [Vector3 ×3] }.
export function eig3(m) {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return { vals: [a[0][0], a[1][1], a[2][2]], vecs: [0, 1, 2].map((j) => new THREE.Vector3(v[0][j], v[1][j], v[2][j])) };
}

// ---------------------------------------------------------------- the capture stage
export function makeVolume(root, half = 2) {
  const g = new THREE.Group(); root.add(g);
  const mat = M.glow(0x5fd4ff); mat.transparent = true; mat.opacity = 0.75;
  const L = half * 2;
  for (const [x, z, w, d] of [[0, half, L, 0.04], [0, -half, L, 0.04], [half, 0, 0.04, L], [-half, 0, 0.04, L]]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); t.rotation.x = -Math.PI / 2; t.position.set(x, 0.004, z); g.add(t);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L + 1.2, L + 1.2), M.matte(0x16181e, { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; floor.receiveShadow = true; g.add(floor);
  return g;
}
// Skeleton sticks drawn between joints (for the "solved skeleton" view).
export const BONES = [
  ['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'],
  ['chest', 'shL'], ['shL', 'elL'], ['elL', 'wrL'], ['chest', 'shR'], ['shR', 'elR'], ['elR', 'wrR'],
  ['pelvis', 'hipL'], ['hipL', 'knL'], ['knL', 'anL'], ['pelvis', 'hipR'], ['hipR', 'knR'], ['knR', 'anR'],
];
export function makeSkeleton(root, body, color = 0xffd166, r = 0.018) {
  const g = new THREE.Group(); root.add(g);
  const mat = M.glow(color);
  const sticks = BONES.map(() => { const s = stick(r, mat); g.add(s); return s; });
  const balls = [...new Set(BONES.flat())].map((j) => { const m = sphere(r * 1.9, mat, 12); g.add(m); return [j, m]; });
  const a = new THREE.Vector3(), b = new THREE.Vector3(), headTop = new THREE.Vector3();
  const skel = {
    group: g,
    update() {
      BONES.forEach(([ja, jb], i) => {
        body.J[ja].getWorldPosition(a);
        if (jb === 'head') { body.J.head.localToWorld(headTop.set(0, body.P.head * 1.9, 0)); b.copy(headTop); } else body.J[jb].getWorldPosition(b);
        sticks[i].between(a, b);
      });
      for (const [j, m] of balls) body.J[j].getWorldPosition(m.position);
    },
  };
  return skel;
}

export { THREE, M, clamp, lerp, smooth, approach, sphere, box };
