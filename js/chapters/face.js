// Chapter 4: faces and fingers. The faceless performer wears a head-mounted camera (HMC) pointed at dots
// on the face. Expression sliders move the dots; the HMC sees them move in 2D; a least-squares solve
// turns the 2D movement back into five expression weights, which drive our creature's blend shapes.
// Model
//  - Dot movements per expression are estimates of real skin travel (chin ≈ 2 cm when the jaw opens,
//    mouth corners ≈ 1 cm in a smile, brows ≈ 8 mm, eyelids ≈ 6 mm).
//  - The HMC is a 1280-px-wide camera about 12 cm in front of the face (typical HMC boom length).
//    Because it moves with the head, only expressions move the dots in its picture.
//  - Solve: minimise |B w − d|² for w (5 weights), where column k of B is how the dots move in the HMC
//    picture for expression k, and d is the measured movement plus pixel noise. Weights are clamped 0–1.
//  - Real rigs use dozens to about 150 dots: The Polar Express used 152 face markers (AWN, 2004);
//    Kong used 135 (King Kong, 2005). ARKit phone face capture outputs 52 blend-shape weights.
//  - Gloves: bend sensors or tiny markers on each finger; here each finger's bend is read in degrees.
import {
  THREE, M, clamp, lerp, approach, makeBody, sphere, box, taper, board, panelBg, title, text, COL, fitNarrow, reelBoards,
  Performer, gauss, inReel, dot, TAU,
} from '../mocap.js';

const SHAPES = [
  { k: 'jaw', name: 'Jaw open' }, { k: 'smile', name: 'Smile' }, { k: 'brow', name: 'Brows up' },
  { k: 'blink', name: 'Blink' }, { k: 'pucker', name: 'Pucker' },
];
// dot layout on the front of the head, (u, v) in -1..1 across and up the face
const UV = [
  [-0.3, 0.58], [0.3, 0.58], [0, 0.64], [-0.45, 0.38], [-0.2, 0.41], [0.2, 0.41], [0.45, 0.38], [-0.33, 0.2], [0.33, 0.2],
  [-0.62, 0.22], [0.62, 0.22], [-0.55, -0.05], [0.55, -0.05], [-0.4, -0.2], [0.4, -0.2], [0, 0.04], [0, -0.13],
  [0, -0.33], [-0.18, -0.35], [0.18, -0.35], [-0.31, -0.42], [0.31, -0.42], [0, -0.52], [-0.17, -0.49], [0.17, -0.49],
  [0, -0.72], [-0.22, -0.67], [0.22, -0.67], [-0.5, -0.5], [0.5, -0.5], [-0.6, -0.3], [0.6, -0.3],
];
// how each dot moves for each expression at full strength (metres, head frame)
function disp(u, v, k) {
  const out = [0, 0, 0];
  if (k === 'jaw' && v < -0.28) { const f = clamp((-v - 0.28) / 0.42, 0, 1); out[1] = -0.02 * f; out[2] = -0.004 * f; out[0] = -u * 0.004 * f; }
  if (k === 'smile') {
    const corner = Math.exp(-((Math.abs(u) - 0.31) ** 2 + (v + 0.42) ** 2) / 0.02), cheek = Math.exp(-((Math.abs(u) - 0.45) ** 2 + (v + 0.12) ** 2) / 0.03);
    out[0] = Math.sign(u) * 0.009 * corner; out[1] = 0.007 * corner + 0.005 * cheek; out[2] = -0.002 * corner;
  }
  if (k === 'brow' && v > 0.3) { out[1] = v > 0.5 ? 0.005 : 0.008; }
  if (k === 'blink' && Math.abs(v - 0.2) < 0.05 && Math.abs(u) > 0.2 && Math.abs(u) < 0.45) out[1] = -0.006;
  if (k === 'pucker' && v < -0.28 && v > -0.56 && Math.abs(u) < 0.36) { out[0] = -u * 0.03; out[2] = 0.008; }
  return out;
}
const HANDS = {
  open: { name: 'Open', c: [0, 0, 0, 0, 0] }, fist: { name: 'Fist', c: [0.8, 1, 1, 1, 1] }, point: { name: 'Point', c: [0.8, 0, 1, 1, 1] },
  peace: { name: 'Peace', c: [0.8, 0, 0, 1, 1] }, thumb: { name: 'Thumbs up', c: [0, 1, 1, 1, 1] },
};
const FINGER = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const HMC_PX = 1280;

export default {
  id: 'face',
  short: 'Faces and fingers',
  title: 'Faces and fingers',
  subtitle: 'A camera on a boom watches dots on the face; gloves read the fingers.',
  view: { pos: [0.1, 1.7, 2.05], target: [0.2, 1.45, 0] },
  learn: `<p>Bodies are only half a performance. For the face, the actor wears a <b>head-mounted camera</b> (HMC): a small camera on a boom fixed to a helmet, pointing back at the face. Because it moves with the head, the face stays in the same spot in its picture, so only <b>expressions</b> make the dots move. Dots are painted or stuck on the skin: dozens, up to about 150.</p>
    <p>The <b>facial solver</b> works backwards. It knows how the dots move for each basic expression, called a <b>blend shape</b>: jaw open, smile, brows up, blink. It finds the <b>mix of blend shapes</b> that best explains what the camera saw. Those numbers, 0 to 1 for each shape, then drive the creature’s own blend shapes. Artists can <b>remap</b> them: a creature with big ears could lift its ears when the actor lifts their brows.</p>
    <p><b>Fingers</b> are small and hide each other, so they are hard for body cameras. Performers often wear <b>gloves</b> with bend sensors along each finger, or tiny markers, or animators add fingers by hand.</p>
    <p class="tip"><b>Try it:</b> move the expression sliders and watch the dots in the HMC view, the solved weights, and the creature. Add camera noise and see the solve wobble. Turn on <b>Brows lift the ears</b>. Change the hand shape.</p>`,
  terms: [
    { t: 'HMC', d: 'Head-mounted camera: a small camera on a helmet boom that films the face.' },
    { t: 'Blend shape', d: 'A saved expression of a face model, like “jaw open”, mixed in by a number from 0 to 1.' },
    { t: 'Facial solve', d: 'Working out which mix of blend shapes explains how the face dots moved.' },
    { t: 'Remapping', d: 'Choosing which of the actor’s expressions drives which part of the creature.' },
    { t: 'FACS', d: 'The Facial Action Coding System: a list of the face’s basic muscle movements, used to build blend shapes.' },
    { t: 'Data glove', d: 'A glove with sensors that measure how much each finger bends.' },
  ],
  defaults: { jaw: 0.3, smile: 0.6, brow: 0.2, blink: 0, pucker: 0, noise: 0.3, gain: 1, ears: false, hand: 'peace' },
  controls: [
    ...SHAPES.map((sh) => ({ key: sh.k, type: 'range', label: `Actor: ${sh.name.toLowerCase()}`, min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %` })),
    { key: 'noise', type: 'range', label: 'Camera noise', min: 0, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)} px` },
    { key: 'gain', type: 'range', label: 'Creature strength', min: 0.4, max: 1.6, step: 0.01, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'ears', type: 'toggle', label: 'Remap: brows also lift the ears' },
    { key: 'hand', type: 'seg', label: 'Glove: hand shape', options: Object.entries(HANDS).map(([v, h]) => ({ v, label: h.name })) },
  ],
  quiz: [
    { q: 'Why is the face camera mounted on the actor’s helmet?', options: ['To light the set', 'So it moves with the head and only expressions move the dots', 'To record sound', 'It is cheaper than a tripod'], answer: 1, why: 'With the camera fixed to the head, head turns do not move the face in the picture, so every dot movement is an expression.' },
    { q: 'What does the facial solver output?', options: ['A photo of the actor', 'How much of each blend shape (0 to 1) is in the expression', 'The actor’s voice', 'The creature’s colour'], answer: 1, why: 'It finds the mix of blend shapes that best explains the dot movements, and those weights drive the creature’s face.' },
    { q: 'Why are fingers often captured with gloves?', options: ['Fingers are small and hide each other from body cameras', 'Gloves are warmer', 'Markers cannot stick to hands', 'Fingers do not move in films'], answer: 0, why: 'Fingers are tiny and constantly block one another, so bend sensors in gloves (or animators) fill in the detail.' },
  ],
  reel: [
    { ms: 5500, caption: 'A helmet camera watches face dots, and the solve drives the creature’s face.', set: { jaw: 0, smile: 0, brow: 0, blink: 0, pucker: 0, noise: 0.3, gain: 1.1, ears: true, hand: 'open' }, anim: { jaw: [0, 0.8], smile: [0, 0.7], brow: [0, 0.9] }, spin: 0.1, view: { pos: [0.15, 1.75, 1.35], target: [0.1, 1.6, 0] } },
  ],

  build({ stage }) {
    const root = new THREE.Group(); stage.root.add(root);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), M.matte(0x16181e)); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; floor.receiveShadow = true; root.add(floor);
    // performer (faceless) with an HMC
    const body = makeBody({});
    root.add(body.root);
    const perf = new Performer(body); perf.place(-0.32, 0, 0.55); perf.yaw = 0.3; perf.setMove('idle'); perf.prevMove = 'idle'; perf.blend = 1;
    const head = body.J.head, hs = body.P.head, C = new THREE.Vector3(0, hs * 0.95, 0), RX = 0.84 * hs, RY = 1.06 * hs, RZ = 0.95 * hs;
    // helmet band + boom + camera
    const hm = M.matte(0x3a3f4a);
    const band = new THREE.Mesh(new THREE.TorusGeometry(hs * 1.0, 0.012, 8, 40), hm); band.rotation.x = Math.PI / 2 - 0.25; band.position.set(0, hs * 1.35, -0.01); band.scale.set(0.9, 1, 1); head.add(band);
    const boomPts = [[RX + 0.01, hs * 1.1, 0.0], [RX + 0.03, hs * 0.75, 0.07], [0.02, hs * 0.55, 0.12 + RZ * 0.6]].map((p) => new THREE.Vector3(...p));
    const boom = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(boomPts), 30, 0.006, 6), M.metal(0x9aa3b2)); head.add(boom);
    const hmc = box(0.03, 0.025, 0.035, M.matte(0x16181e)); hmc.position.copy(boomPts[2]); head.add(hmc);
    const ledM = M.glow(0xff3b4e); const led = sphere(0.006, ledM); led.position.copy(boomPts[2]).add(new THREE.Vector3(0.012, 0.012, -0.018)); head.add(led);
    const cam = new THREE.PerspectiveCamera(70, 0.8, 0.01, 2); cam.position.copy(boomPts[2]); head.add(cam);
    cam.lookAt(new THREE.Vector3(0, hs * 0.9, 0).applyMatrix4(new THREE.Matrix4()));
    // the camera looks at the face centre in head space
    cam.up.set(0, 1, 0); cam.position.copy(boomPts[2]);
    // face dots
    const dotM = M.glow(0x5ce1a9);
    const dots = UV.map(([u, v]) => {
      const z = Math.sqrt(Math.max(0.05, 1 - u * u - v * v));
      const base = new THREE.Vector3(u * RX, v * RY, z * RZ).add(C);
      const m = sphere(0.0045, dotM, 10); m.position.copy(base); head.add(m);
      return { u, v, base, m };
    });
    const lblHmc = stage.label('Head-mounted camera', [0, 0, 0], root);
    const lblDots = stage.label('Face dots', [0, 0, 0], root, 'hot');

    // ------------------------------------------------ our creature's head (its own design)
    const cg = new THREE.Group(); cg.position.set(0.5, 1.5, -0.05); cg.rotation.y = -0.35; root.add(cg);
    const skin = M.matte(0xe9a23b, { roughness: 0.6 }), dark = M.plastic(0x15151b), white = M.plastic(0xf6f4ec), pinkM = M.matte(0xd9587a);
    const R = 0.2;
    const skull = sphere(R, skin, 40); skull.scale.set(1.05, 0.95, 0.95); cg.add(skull);
    const neckC = taper(0.25, 0.09, 0.12, skin); neckC.position.y = -R * 0.7; cg.add(neckC);
    const eyes = [1, -1].map((sx) => {
      const g = new THREE.Group(); g.position.set(sx * 0.075, 0.045, R * 0.82); cg.add(g);
      const ball = sphere(0.052, white, 24); g.add(ball);
      const pupil = sphere(0.025, dark, 16); pupil.position.z = 0.036; g.add(pupil);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.056, 24, 12, 0, TAU, 0, Math.PI / 2), skin); lid.rotation.x = -0.9; g.add(lid);
      const brow = box(0.075, 0.016, 0.02, M.matte(0x7a3f12)); brow.position.set(0, 0.078, 0.03); brow.rotation.z = sx * 0.12; g.add(brow);
      return { g, lid, brow, sx };
    });
    const ears = [1, -1].map((sx) => {
      const e = sphere(0.09, skin, 20); e.scale.set(0.25, 1, 0.6);
      const p = new THREE.Group(); p.position.set(sx * R * 0.98, 0.04, 0); p.add(e); e.position.y = 0.07; cg.add(p);
      const inner = sphere(0.06, pinkM, 16); inner.scale.set(0.2, 0.95, 0.5); inner.position.set(sx * 0.01, 0.07, 0.01); p.add(inner);
      return { p, sx };
    });
    const mouth = new THREE.Group(); mouth.position.set(0, -0.07, R * 0.8); cg.add(mouth);
    const upper = box(0.1, 0.018, 0.03, dark); upper.position.y = 0.01; mouth.add(upper);
    const jaw = new THREE.Group(); jaw.position.set(0, 0.01, -0.06); mouth.add(jaw);
    const lower = box(0.1, 0.02, 0.03, dark); lower.position.set(0, -0.012, 0.065); jaw.add(lower);
    const inside = box(0.095, 0.05, 0.02, M.matte(0x5a1b24)); inside.position.set(0, -0.02, 0.05); jaw.add(inside);
    const chin = sphere(0.08, skin, 20); chin.scale.set(1.1, 0.55, 0.8); chin.position.set(0, -0.05, 0.03); jaw.add(chin);
    const corners = [1, -1].map((sx) => { const c = sphere(0.014, dark, 10); c.position.set(sx * 0.055, 0.0, 0); mouth.add(c); return c; });
    const lblCr = stage.label('Our creature', [0.5, 1.8, -0.05], root);

    // ------------------------------------------------ a data glove
    const glove = new THREE.Group(); glove.position.set(0.12, 1.1, 0.75); glove.rotation.set(-0.2, -0.3, 0); glove.scale.setScalar(1.1); root.add(glove);
    const gm = M.matte(0x2b2f38), sensorM = M.glow(0xff9a5c);
    const palm = box(0.085, 0.095, 0.028, gm); palm.position.y = 0.0; glove.add(palm);
    const cuff = box(0.07, 0.04, 0.03, M.matte(0x1b1d23)); cuff.position.y = -0.065; glove.add(cuff);
    const fingers = [[-0.055, 0.0, 0.8, [0.035, 0.03]], [-0.03, 0.047, 0, [0.04, 0.025, 0.02]], [-0.008, 0.049, 0, [0.044, 0.028, 0.02]], [0.014, 0.047, 0, [0.041, 0.026, 0.02]], [0.034, 0.043, 0, [0.032, 0.02, 0.018]]]
      .map(([x, y, rz, segs], fi) => {
        const base = new THREE.Group(); base.position.set(x, y, 0); base.rotation.z = rz; glove.add(base);
        let parent = base; const joints = [];
        for (const L of segs) {
          const j = new THREE.Group(); parent.add(j); joints.push(j);
          const ph = taper(L, 0.0095, 0.0085, gm); ph.rotation.z = Math.PI; j.add(ph);
          const sen = box(0.004, L * 0.8, 0.003, sensorM); sen.position.set(0, L / 2, 0.01); j.add(sen);
          const nxt = new THREE.Group(); nxt.position.y = L; j.add(nxt); parent = nxt;
        }
        return { joints, fi };
      });
    const fingerBend = [0, 0, 0, 0, 0];
    const lblGlove = stage.label('Data glove: bend sensors', [0.12, 1.0, 0.8], root);

    // ------------------------------------------------ board: HMC view and the solve
    let st = { proj: [], neutral: [], w: [0, 0, 0, 0, 0], act: [0, 0, 0, 0, 0], err: 0, bend: [0, 0, 0, 0, 0] };
    const bd = board(root, 0.96, 0.6, 640, 400, (g, w, h) => {
      panelBg(g, w, h);
      title(g, 'Head camera view and facial solve', 'green: dots now · grey: resting face');
      const fx = 20, fy = 70, fw = 230, fh = 300;
      g.fillStyle = '#16181e'; g.fillRect(fx, fy, fw, fh);
      g.fillStyle = '#2b2f38'; g.beginPath(); g.ellipse(fx + fw / 2, fy + fh / 2 + 10, fw * 0.42, fh * 0.5, 0, 0, TAU); g.fill();
      const P = (p) => [fx + (p[0] * 0.5 + 0.5) * fw, fy + (0.5 - p[1] * 0.5) * fh];
      st.neutral.forEach((p) => { const [x, y] = P(p); dot(g, x, y, 3, 'rgba(255,255,255,.3)'); });
      st.proj.forEach((p) => { const [x, y] = P(p); dot(g, x, y, 3.2, COL.mint); });
      const bx = 280, bw = w - bx - 24;
      SHAPES.forEach((sh, i) => {
        const y = 92 + i * 60;
        text(g, sh.name, bx, y, { font: '17px sans-serif' });
        text(g, `${Math.round(st.w[i] * 100)} %`, w - 24, y, { font: 'bold 17px sans-serif', col: COL.hot, align: 'right' });
        g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(bx, y + 10, bw, 16);
        g.fillStyle = COL.hot; g.fillRect(bx, y + 10, clamp(st.w[i], 0, 1) * bw, 16);
        g.strokeStyle = '#fff'; g.lineWidth = 2; const ax = bx + clamp(st.act[i], 0, 1) * bw; g.beginPath(); g.moveTo(ax, y + 6); g.lineTo(ax, y + 30); g.stroke(); g.lineWidth = 1;
      });
      text(g, 'bar: solved · white line: actor', bx, h - 16, { font: '15px sans-serif', col: COL.soft });
    }, [1.0, 1.92, -0.45]);
    bd.mesh.rotation.y = -0.3;

    // camera projection helpers (in head space; the camera is fixed to the head)
    const v = new THREE.Vector3();
    const projHead = (p) => { v.copy(p).applyMatrix4(head.matrixWorld).project(cam); return [v.x, v.y]; };
    let t = 0;
    return {
      update(dt, s) {
        dt = Math.max(0, dt); t += dt;
        const narrow = fitNarrow(stage, [lblGlove, lblCr, lblHmc]);
        reelBoards([[bd, [0.2, 2.05, -0.5], 0.95]]);
        perf.update(dt, 0.6, { look: 0.15 * Math.sin(t * 0.5), nod: 0.05 * Math.sin(t * 0.7) });
        cam.lookAt(new THREE.Vector3(0, hs * 0.85, 0).applyMatrix4(head.matrixWorld));
        cam.updateMatrixWorld(true);
        // move the dots
        const act = SHAPES.map((sh) => s[sh.k]);
        dots.forEach((d) => {
          d.cur = d.base.clone();
          SHAPES.forEach((sh, i) => { const o = disp(d.u, d.v, sh.k); d.cur.x += o[0] * act[i]; d.cur.y += o[1] * act[i]; d.cur.z += o[2] * act[i]; });
          d.m.position.copy(d.cur);
        });
        // HMC measurements: neutral, basis, observed (with pixel noise)
        head.updateMatrixWorld(true); cam.updateMatrixWorld(true);
        const neutral = dots.map((d) => projHead(d.base));
        const basis = SHAPES.map((sh) => dots.map((d, j) => { const o = disp(d.u, d.v, sh.k); const p = projHead(d.base.clone().add(new THREE.Vector3(...o))); return [p[0] - neutral[j][0], p[1] - neutral[j][1]]; }));
        const pxToNdc = 2 / HMC_PX, fr = Math.floor(t * 30);
        const proj = dots.map((d, j) => { const p = projHead(d.cur); return [p[0] + gauss(fr * 131 + j * 7) * s.noise * pxToNdc, p[1] + gauss(fr * 131 + j * 7 + 3) * s.noise * pxToNdc]; });
        // least squares (normal equations, 5×5, Gaussian elimination)
        const n = SHAPES.length, A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
        for (let a = 0; a < n; a++) {
          for (let b = 0; b < n; b++) { let sum = 0; for (let j = 0; j < dots.length; j++) sum += basis[a][j][0] * basis[b][j][0] + basis[a][j][1] * basis[b][j][1]; A[a][b] = sum; }
          let r = 0; for (let j = 0; j < dots.length; j++) r += basis[a][j][0] * (proj[j][0] - neutral[j][0]) + basis[a][j][1] * (proj[j][1] - neutral[j][1]); A[a][n] = r;
          A[a][a] += 1e-9;
        }
        for (let i = 0; i < n; i++) {
          let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
          [A[i], A[piv]] = [A[piv], A[i]];
          for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; }
        }
        const w = A.map((row, i) => clamp(row[n] / row[i], 0, 1));
        st = { proj, neutral, w, act, err: w.reduce((q, x, i) => q + Math.abs(x - act[i]), 0) / n, bend: st.bend };
        // drive the creature (with strength and the ears remap)
        const k = s.gain, W = (i) => clamp(w[i] * k, 0, 1.3);
        jaw.rotation.x = 0.45 * W(0);
        corners.forEach((c, i) => { const sx = i ? -1 : 1; c.position.set(sx * (0.055 + 0.018 * W(1) - 0.025 * W(4)), 0.02 * W(1), 0.005 * W(4)); });
        upper.scale.x = lower.scale.x = 1 - 0.45 * W(4) + 0.2 * W(1);
        eyes.forEach((e) => { e.brow.position.y = 0.078 + 0.03 * W(2); e.lid.rotation.x = lerp(-0.9, 0.35, clamp(W(3), 0, 1)); });
        ears.forEach((e) => { e.p.rotation.z = e.sx * (s.ears ? -0.7 * W(2) : 0) + e.sx * 0.12 * Math.sin(t * 1.3); });
        // glove
        const target = HANDS[s.hand].c;
        fingers.forEach((f, i) => {
          fingerBend[i] = approach(fingerBend[i], target[i], 7, dt);
          const b = fingerBend[i];
          f.joints.forEach((j, q) => { j.rotation.x = b * (i === 0 ? [0.5, 0.8][q] : [1.3, 1.5, 1.0][q]); });
        });
        st.bend = fingerBend.map((b, i) => Math.round(b * (i === 0 ? 75 : 218)));
        // labels
        lblHmc.position.copy(hmc.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(-0.22, 0.12, 0));
        lblDots.position.copy(dots[25].m.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(-0.2, -0.08, 0.05));
        lblDots.visible = !narrow;
        bd.redraw();
      },
      readout: () => {
        const top = SHAPES.map((sh, i) => [sh.name, st.w[i]]).sort((a, b) => b[1] - a[1])[0];
        return `<div class="row"><span>Face dots tracked</span><b>${UV.length}</b></div>
          <div class="row"><span>Blend shapes solved</span><b>${SHAPES.length}</b></div>
          <div class="row"><span>Strongest shape</span><b>${top[0]} ${Math.round(top[1] * 100)} %</b></div>
          <div class="row"><span>Solve error (avg)</span><b>${(st.err * 100).toFixed(1)} %</b></div>
          <div class="row"><span>Finger bends</span><b>${st.bend.join(' · ')}°</b></div>`;
      },
    };
  },
};
