// Chapter 6: on set. A camera operator walks round the volume with a virtual camera (a tracked screen).
// A monitor shows what it sees: not the actor, but our creature in a virtual world, live. Then cleanup:
// raw data has jitter and gaps (from occlusion); gap-filling and a smoothing filter tidy it, but too much
// smoothing flattens real motion.
// Model
//  - The virtual world and the creature live on render layer 2, which only the virtual camera sees.
//  - Signal: the right-wrist marker's height. Raw = true + jitter (slider, mm) + gaps, which arrive every
//    3.1 s and last 0.4 s (as when an arm hides a marker). Gaps are filled by a cubic curve through the
//    samples either side (the "spline fill" editing software offers). Smoothing: a first-order low-pass
//    filter run forwards and then backwards over the last 4 s (zero lag), with cut-off frequency fc:
//    α = 1 − exp(−2π·fc·Δt). Human movement is mostly below about 6–10 Hz (Winter, Biomechanics and
//    Motor Control of Human Movement), so a cut-off of about 6 Hz is a common choice.
import {
  THREE, M, clamp, lerp, makeBody, Performer, Retarget, makeCamRing, makeVolume, creatureProps, CREATURES, PERF, legLen,
  box, sphere, stick, board, panelBg, title, text, COL, fitNarrow, reelBoards, MOVES, wob, inReel, TAU,
} from '../mocap.js';

const N = 240, DT = 1 / 60;          // 4 s of samples at 60 per second
const VL = 2;                        // render layer for the virtual world

export default {
  id: 'onset',
  short: 'On set and cleanup',
  title: 'On set: performance capture',
  subtitle: 'The director sees the creature live, then artists clean and polish the data.',
  view: { pos: [0.6, 3.7, 9.2], target: [0.45, 1.35, 0] },
  learn: `<p>On a film, body, face and voice are often recorded together: <b>performance capture</b>. The director does not want to imagine the creature, so the stage streams the solved skeleton into a game engine in <b>real time</b>. A camera operator carries a <b>virtual camera</b>: a screen with markers on it. The system tracks it like a marker, and the screen shows the <b>creature in its virtual world</b>, framed from where the operator stands. The next step, filming real sets with virtual backgrounds on LED walls, is <b>VirtualProdClear</b>.</p>
    <p>The live preview is rough. Afterwards the data is <b>cleaned</b>. <b>Gaps</b> where a marker was hidden are filled with a smooth curve. <b>Jitter</b>, the small shake of every measurement, is removed with a <b>smoothing filter</b>. Filter too hard and the motion goes soft: a quick hand flick or the top of a jump gets cut down.</p>
    <p>Then <b>animators</b> polish: fixing feet, adding fingers, pushing a pose to be more readable, or blending in keyframes (see <b>Anim3DClear</b>). <b>Games</b> record short moves (walk, turn, jump) that loop and blend live at 30 to 60 frames a second, so they must join seamlessly. <b>Films</b> capture whole scenes, and each shot gets hours of care. Creatures are then finished with muscles, skin and lighting (see <b>VFXClear</b>).</p>
    <p class="tip"><b>Try it:</b> move the operator round the stage and watch the monitor. Turn up the jitter, switch gap filling on and off, and slide the smoothing filter from gentle to heavy. Watch the jump peak shrink.</p>`,
  terms: [
    { t: 'Performance capture', d: 'Capturing body, face and voice together, so the whole acting performance is kept.' },
    { t: 'Virtual camera', d: 'A tracked handheld screen that shows the digital scene from where it is held.' },
    { t: 'Real time', d: 'Processed as fast as it happens, so the preview keeps up with the actor.' },
    { t: 'Jitter', d: 'Small, fast, random shake in measured positions.' },
    { t: 'Gap filling', d: 'Drawing a smooth curve across frames where a marker was not seen.' },
    { t: 'Low-pass filter', d: 'Smoothing that keeps slow movement and removes fast shake above a cut-off frequency.' },
  ],
  defaults: { move: 'jump', creature: 'short', vcam: 0.6, jitter: 4, fill: true, cutoff: 8 },
  controls: [
    { key: 'move', type: 'seg', label: 'Performance', options: ['walk', 'run', 'jump'].map((v) => ({ v, label: MOVES[v].name })) },
    { key: 'creature', type: 'seg', label: 'Creature', options: Object.entries(CREATURES).map(([v, c]) => ({ v, label: c.name })) },
    { key: 'vcam', type: 'range', label: 'Virtual camera: walk around', min: -1.4, max: 1.4, step: 0.01, fmt: (v) => `${Math.round(v * 57.3)}°` },
    { key: 'jitter', type: 'range', label: 'Raw jitter', min: 0, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} mm` },
    { key: 'fill', type: 'toggle', label: 'Fill gaps' },
    { key: 'cutoff', type: 'log', label: 'Smoothing filter cut-off', min: 0.5, max: 30, ends: ['heavy', 'gentle'], fmt: (v) => `${v.toFixed(1)} Hz` },
  ],
  quiz: [
    { q: 'What does the virtual camera’s screen show?', options: ['The actor in the suit', 'The creature in its digital world, from where the operator stands', 'A recording from yesterday', 'The script'], answer: 1, why: 'The virtual camera is tracked, and a game engine renders the creature and set from its position, live.' },
    { q: 'How are gaps from hidden markers usually fixed?', options: ['The shot is thrown away', 'A smooth curve is drawn across the missing frames', 'The marker is repainted', 'The frames are deleted'], answer: 1, why: 'Cleanup software fills a gap with a smooth curve that joins the good data on either side.' },
    { q: 'What goes wrong if you smooth mocap data too much?', options: ['Nothing, smoother is always better', 'Quick moves get softened and peaks are cut down', 'The file gets bigger', 'Colours change'], answer: 1, why: 'A heavy low-pass filter removes fast changes too, so snaps, hits and the top of a jump lose their sharpness.' },
  ],
  reel: [
    { ms: 5000, caption: 'A tracked virtual camera shows the director the creature, live, in its world.', set: { move: 'walk', creature: 'short', vcam: -0.6, jitter: 3, fill: true, cutoff: 6 }, anim: { vcam: [-0.6, 0.8] }, spin: 0.1, view: { pos: [0, 3.0, 5.6], target: [-0.2, 2.0, 0.6] } },
    { ms: 5000, caption: 'Cleanup fills gaps and smooths jitter, but heavy smoothing flattens the motion.', set: { move: 'jump', jitter: 6, fill: true, cutoff: 20 }, anim: { cutoff: [20, 0.8, true] }, spin: 0, view: { pos: [0.35, 3.9, 2.4], target: [0.35, 3.6, -1.6] } },
  ],

  build({ stage }) {
    const root = new THREE.Group(); stage.root.add(root);
    makeVolume(root, 2);
    const ring = makeCamRing(root, { R: 3.6, H: 2.7 }); ring.set(12);
    const body = makeBody({ markers: true });
    root.add(body.root);
    const perf = new Performer(body, { center: [0, 0], radius: 1.1 }); perf.place(1.1, 0, 0);

    // camera operator holding a tracked screen
    const op = makeBody({ suit: 0x3b4150 }); root.add(op.root);
    const tablet = new THREE.Group(); op.J.chest.add(tablet); tablet.position.set(0, 0.2, 0.42);
    const tb = box(0.36, 0.24, 0.025, M.matte(0x16181e)); tablet.add(tb);
    const hand = [1, -1].map((s) => { const h = box(0.04, 0.12, 0.05, M.matte(0x3a3f4a)); h.position.set(s * 0.2, 0, 0); tablet.add(h); return h; });
    const tmk = [[-0.17, 0.12], [0.17, 0.12], [0.1, -0.12], [-0.17, -0.1]].map(([x, y]) => { const m = sphere(0.014, M.plastic(0xe9edf2)); m.position.set(x, y + 0.02, -0.02); tablet.add(m); return m; });

    // ------------------------------------------------ the virtual world (layer 2 only)
    const world = new THREE.Group(); root.add(world);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), M.matte(0x5d8a3a)); ground.rotation.x = -Math.PI / 2; world.add(ground);
    const path = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.9, 48), M.matte(0xb89a66)); path.rotation.x = -Math.PI / 2; path.position.y = 0.01; world.add(path);
    const trunkM = M.matte(0x6b4a2e), leafM = [M.matte(0x2f7a45), M.matte(0x3f9150), M.matte(0x2a6b52)], rockM = M.matte(0x8a8f99);
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, r = 4.2 + (i % 5) * 1.6;
      const x = r * Math.cos(a), z = r * Math.sin(a), s = 0.8 + ((i * 37) % 10) / 10;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.2 * s, 8), trunkM); tr.position.set(x, 0.6 * s, z); world.add(tr);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 2.4 * s, 9), leafM[i % 3]); cone.position.set(x, 2.3 * s, z); world.add(cone);
    }
    for (let i = 0; i < 12; i++) { const a = i * 1.7 + 0.4, r = 2.6 + (i % 4) * 0.7; const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + (i % 3) * 0.12), rockM); rk.position.set(r * Math.cos(a), 0.1, r * Math.sin(a)); rk.scale.y = 0.6; world.add(rk); }
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4a2a, 1.4), sun = new THREE.DirectionalLight(0xfff1d6, 2.4); sun.position.set(5, 9, 4);
    world.add(hemi, sun);
    const bodies = {}, rts = {};
    for (const k of Object.keys(CREATURES)) { const b = makeBody({ P: creatureProps(k), creature: k }); world.add(b.root); bodies[k] = b; rts[k] = new Retarget(b, [0, 0]); }
    world.traverse((o) => o.layers.set(VL));
    const vcam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 80); vcam.layers.set(VL);
    const rt = new THREE.WebGLRenderTarget(480, 270, { samples: 2 });
    const SKY = new THREE.Color(0x8fc3ea);

    // the director's monitor
    const mon = new THREE.Group(); mon.position.set(-2.2, 0, 3.0); mon.rotation.y = 0.4; root.add(mon);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.35, 8), M.metal(0x6a717e)); pole.position.y = 0.67; mon.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 20), M.matte(0x1b1d23)); foot.position.y = 0.02; mon.add(foot);
    const bez = box(1.5, 0.88, 0.06, M.matte(0x0c0d10)); bez.position.set(0, 1.75, -0.04); mon.add(bez);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7875), new THREE.MeshBasicMaterial({ map: rt.texture })); scr.position.set(0, 1.75, 0.0); mon.add(scr);
    const lblMon = stage.label('Director’s monitor: live creature', [-2.0, 2.35, 3.0], root);
    const lblOp = stage.label('Virtual camera', [0, 0, 0], root, 'hot');

    // ------------------------------------------------ cleanup board
    const tru = new Float32Array(N).fill(NaN), raw = new Float32Array(N).fill(NaN), cln = new Float32Array(N).fill(NaN), ftru = new Float32Array(N).fill(NaN);
    let head = 0, acc = 0, tS = 0, stats = { raw: 0, left: 0, lost: 0, peak: 0 };
    const bd = board(root, 3.3, 2.3, 600, 420, (g, w, h) => {
      panelBg(g, w, h);
      title(g, 'Cleanup: right-wrist marker height', 'last 4 seconds');
      const x0 = 24, y0 = 72, pw = w - 48, ph = 250;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < N; i++) { if (Number.isFinite(tru[i])) { lo = Math.min(lo, tru[i]); hi = Math.max(hi, tru[i]); } }
      if (!isFinite(lo)) { lo = 0.8; hi = 1.2; }
      const pad = 0.03 + (hi - lo) * 0.15; lo -= pad; hi += pad;
      const Y = (v) => y0 + ph - ((v - lo) / (hi - lo)) * ph;
      g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x0, y0, pw, ph);
      const draw = (arr, col, lw, dash) => {
        g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath(); let pen = false;
        for (let i = 0; i < N; i++) {
          const v = arr[(head + i) % N]; const x = x0 + (i / (N - 1)) * pw;
          if (!Number.isFinite(v)) { pen = false; continue; }
          pen ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); pen = true;
        }
        g.stroke(); g.setLineDash([]); g.lineWidth = 1;
      };
      // gap shading
      for (let i = 0; i < N; i++) { if (Number.isNaN(raw[(head + i) % N]) && Number.isFinite(tru[(head + i) % N])) { g.fillStyle = 'rgba(255,90,138,.16)'; g.fillRect(x0 + (i / (N - 1)) * pw, y0, pw / N + 1, ph); } }
      draw(raw, 'rgba(255,90,138,.9)', 1.5);
      draw(tru, 'rgba(255,255,255,.75)', 1.5, [5, 5]);
      draw(cln, COL.mint, 3);
      const ly = y0 + ph + 34;
      [['raw (jitter + gaps)', COL.bad], ['true motion', '#fff'], ['cleaned', COL.mint]].forEach(([l, c], i) => { g.fillStyle = c; g.fillRect(x0 + i * 190, ly - 10, 22, 4); text(g, l, x0 + i * 190 + 30, ly, { font: '16px sans-serif' }); });
      text(g, `jitter ${stats.raw.toFixed(1)} → ${stats.left.toFixed(1)} mm   ·   real motion smoothed away ${stats.lost.toFixed(1)} mm`, x0, ly + 34, { font: '17px sans-serif', col: COL.hot });
    }, [4.15, 2.35, -0.9]);
    bd.mesh.rotation.y = -0.5;

    // gap-fill + zero-lag smoothing over the ring buffer
    function clean(src, dst, fill, fc) {
      const a = new Float64Array(N); for (let i = 0; i < N; i++) a[i] = src[(head + i) % N];
      // fill gaps: cubic Hermite between the samples either side, slopes from their neighbours
      let i = 0;
      while (i < N) {
        if (!Number.isNaN(a[i])) { i++; continue; }
        let j = i; while (j < N && Number.isNaN(a[j])) j++;
        const L = i - 1, R = j;
        if (fill && L >= 1 && R < N - 1) {
          const p0 = a[L], p1 = a[R], m0 = (a[L] - a[L - 1]) * (R - L), m1 = (a[R + 1] - a[R]) * (R - L);
          for (let k = i; k < j; k++) { const t = (k - L) / (R - L), t2 = t * t, t3 = t2 * t; a[k] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1; }
        }
        i = j;
      }
      const al = 1 - Math.exp(-TAU * fc * DT);
      const out = new Float64Array(N); let y = NaN;
      for (let k = 0; k < N; k++) { const v = a[k]; if (Number.isNaN(v)) { y = NaN; out[k] = NaN; continue; } y = Number.isNaN(y) ? v : y + al * (v - y); out[k] = y; }
      y = NaN;
      for (let k = N - 1; k >= 0; k--) { const v = out[k]; if (Number.isNaN(v)) { y = NaN; continue; } y = Number.isNaN(y) ? v : y + al * (v - y); out[k] = y; }
      for (let k = 0; k < N; k++) dst[(head + k) % N] = out[k];
    }

    let lastKind = null, lastMove = null, t = 0;
    const wr = new THREE.Vector3(), aim = new THREE.Vector3();
    return {
      update(dt, s) {
        dt = Math.max(0, dt); t += dt;
        const narrow = fitNarrow(stage, [lblMon]);
        reelBoards([[bd, [0.35, 4.55, -1.6], 0.95]]);
        perf.setMove(s.move);
        if (s.move !== lastMove || s.creature !== lastKind) { for (const k in rts) rts[k].sync(perf, [0, 0]); lastMove = s.move; lastKind = s.creature; }
        perf.update(dt, 1);
        // creature, travel scaled to its legs (so no foot slide)
        const cb = bodies[s.creature];
        for (const k in bodies) bodies[k].root.visible = k === s.creature;
        rts[s.creature].update(dt, perf, legLen(cb.P) / legLen(PERF), { four: CREATURES[s.creature].arms4 ? 1 : 0 });
        // operator walks round at radius 2.9 facing the performer
        const a = s.vcam, R = 2.9;
        op.root.position.set(R * Math.sin(a), 0, R * Math.cos(a));
        const face = Math.atan2(perf.pos.x - op.root.position.x, perf.pos.z - op.root.position.z);
        op.root.rotation.y = face;
        op.apply({ ...zero(), shL: 0.95, shR: 0.95, elL: 1.2, elR: 1.2, abL: 0.05, abR: 0.05, knL: 0.15, knR: 0.15, hipL: 0.08, hipR: 0.08, lean: 0.05, spread: 0.08 });
        op.root.updateMatrixWorld(true); op.root.position.y = -op.lowY(); op.update();
        // virtual camera = the tablet, aimed at the performer's chest
        tablet.getWorldPosition(vcam.position);
        body.J.chest.getWorldPosition(aim); vcam.lookAt(aim); vcam.updateMatrixWorld(true);
        // render the virtual world into the monitor
        const r = stage.renderer, bg = stage.scene.background;
        stage.scene.background = SKY; r.setRenderTarget(rt); r.clear(); r.render(stage.scene, vcam); r.setRenderTarget(null); stage.scene.background = bg;
        lblOp.position.copy(vcam.position).add(new THREE.Vector3(0, 0.35, 0));
        // sample the wrist marker at a steady 60 per second
        acc += dt;
        const mk = body.markers.find((m) => m.name === 'RWRA');
        while (acc >= DT) {
          acc -= DT; tS += DT;
          const y = mk.world.y;
          const gap = (tS % 3.1) > 2.7;
          tru[head] = y;
          raw[head] = gap ? NaN : y + s.jitter * 1e-3 * wob(tS * 3, 5);
          head = (head + 1) % N;
        }
        clean(raw, cln, s.fill, s.cutoff); clean(tru, ftru, true, s.cutoff);
        // stats: RMS jitter (raw vs true) and cleaned error, over the last 4 s
        // jitter before/after: noise part only (cleaned raw vs the same filter applied to the true motion);
        // motion lost: how far the filter pulls the true motion itself away from the truth
        let sr = 0, nr = 0, sl = 0, nl = 0, sm = 0, nm = 0;
        for (let i = 0; i < N; i++) {
          if (!Number.isFinite(tru[i])) continue;
          if (!Number.isNaN(raw[i])) { sr += (raw[i] - tru[i]) ** 2; nr++; if (Number.isFinite(cln[i]) && Number.isFinite(ftru[i])) { sl += (cln[i] - ftru[i]) ** 2; nl++; } }
          if (Number.isFinite(ftru[i])) { sm += (ftru[i] - tru[i]) ** 2; nm++; }
        }
        stats = { raw: Math.sqrt(sr / Math.max(1, nr)) * 1000, left: Math.sqrt(sl / Math.max(1, nl)) * 1000, lost: Math.sqrt(sm / Math.max(1, nm)) * 1000 };
        bd.redraw();
      },
      readout: (s) => {
        const kind = CREATURES[s.creature];
        return `<div class="row"><span>Preview</span><b>live, in real time</b></div>
          <div class="row"><span>Creature</span><b>${kind.name}</b></div>
          <div class="row"><span>Raw jitter (RMS)</span><b>${stats.raw.toFixed(1)} mm</b></div>
          <div class="row"><span>Jitter left after filter</span><b>${stats.left.toFixed(1)} mm</b></div>
          <div class="row"><span>Real motion smoothed away</span><b>${stats.lost.toFixed(1)} mm</b></div>
          <div class="row"><span>Gap filling</span><b>${s.fill ? 'on' : 'off'}</b></div>
          <div class="row"><span>Filter cut-off</span><b>${s.cutoff.toFixed(1)} Hz</b></div>`;
      },
      dispose() { rt.dispose(); },
    };
  },
};
function zero() { return { lean: 0, twist: 0, roll: 0, nod: 0, look: 0, spread: 0, four: 0, hipL: 0, hipR: 0, knL: 0, knR: 0, ftL: 0, ftR: 0, shL: 0, shR: 0, abL: 0, abR: 0, elL: 0, elR: 0 }; }
