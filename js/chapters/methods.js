// Chapter 5: other ways to capture. Compare optical markers with an inertial suit (IMUs), markerless
// video with machine-learning pose estimation, and phone depth-camera face capture.
// Inertial drift physics: position = double integral of acceleration. A constant accelerometer bias b
// gives a position error ½·b·t² (b = bias in mg × 9.81 mm/s²). Suits limit this with the feet: each time a
// foot is planted its speed must be zero (a "zero-velocity update"), so the error only builds up during
// each ~0.4 s swing: ½·b·(0.4 s)² per step. A slowly drifting heading (from gyro drift or magnetic
// disturbance, in °/min) turns the whole path around the calibration point.
// Facts: Xsens MVN uses 17 trackers, each with 3D gyroscope, accelerometer and magnetometer (Roetenberg
// et al., Xsens MVN technical paper, 2009/2013). Inertial suits cost from about $1,000 to $80,000
// (Wikipedia, "Motion capture"). Markerless: OpenPose (CMU, 2017) was the first open-source real-time
// multi-person 2D keypoint system; BlazePose (Google, 2020) finds 33 body landmarks on a phone. A study
// of multi-camera OpenPose vs markers found about 80% of joint errors under 30 mm (Nakano et al., 2020,
// Frontiers in Sports and Active Living). iPhone X TrueDepth (2017) projects over 30,000 infrared dots;
// Apple's ARKit gives 52 blend-shape weights for the face.
import {
  THREE, M, clamp, lerp, approach, makeBody, Performer, makeCamRing, makeVolume, makeIRCam, project, box, sphere, stick,
  board, panelBg, title, text, wrap, COL, fitNarrow, reelBoards, MOVES, G, wob, inReel, dot, TAU, BONES,
} from '../mocap.js';

const METHODS = {
  optical: { name: 'Optical markers', acc: '≈ 0.1–0.5 mm', cost: 'Highest: a studio of cameras', setup: 'Calibrate stage, glue markers', where: 'Indoor stage' },
  inertial: { name: 'Inertial suit', acc: 'Angles good, position drifts', cost: '≈ $1,000–80,000', setup: 'Put on suit, stand still', where: 'Anywhere, even outdoors' },
  video: { name: 'Markerless video', acc: '≈ 2–3 cm per joint', cost: 'Cameras + software', setup: 'Just film', where: 'Anywhere with light' },
  phone: { name: 'Phone face', acc: '52 expression weights', cost: 'A phone with a depth camera', setup: 'Point it at your face', where: 'Desk, living room' },
};
const IMU_AT = [['head', [0, 0.2, 0]], ['chest', [0, 0.12, 0.125]], ['pelvis', [0, 0.05, -0.12]], ['chest', [0.13, 0.2, -0.05]], ['chest', [-0.13, 0.2, -0.05]],
  ...['L', 'R'].flatMap((S) => [['sh' + S, [0, -0.14, 0.05]], ['el' + S, [0, -0.13, 0.04]], ['wr' + S, [0, -0.05, 0.03]], ['hip' + S, [0, -0.2, 0.08]], ['kn' + S, [0, -0.18, 0.055]], ['an' + S, [0, -0.02, 0.07]]])];
const KP = ['head', 'neck', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'pelvis', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR'];
const TSW = 0.4;

export default {
  id: 'methods',
  short: 'Other ways to capture',
  title: 'Other ways to capture',
  subtitle: 'Motion sensors in a suit, AI that watches ordinary video, and your phone.',
  view: { pos: [0.0, 3.9, 8.2], target: [1.0, 1.35, 0] },
  learn: `<p>Optical markers are the most accurate, but you need a stage full of cameras. There are other ways.</p>
    <p>An <b>inertial suit</b> has about 17 small motion sensors (<b>IMUs</b>), one on each body segment. Each has a gyroscope, an accelerometer and a compass (magnetometer), like the ones in your phone. They measure how each bone <b>turns</b>, very well, and they work anywhere, even outdoors. But to know <b>where</b> you are, the suit must add up acceleration twice, and tiny errors grow fast: this is <b>drift</b>. Suits fight it by knowing that a planted foot is not moving. Steel in a floor can also upset the compass.</p>
    <p><b>Markerless</b> capture uses ordinary video and <b>machine learning</b> (pose estimation) to find <b>keypoints</b> like elbows and knees, with no suit at all. OpenPose (2017) did this in real time; Google’s BlazePose (2020) finds 33 body points on a phone. It is cheap and quick, but less precise, and it guesses what it cannot see.</p>
    <p>Your <b>phone</b> can capture faces: a depth camera projects over 30,000 invisible dots, and the software gives 52 expression numbers, enough to drive a cartoon face live.</p>
    <p class="tip"><b>Try it:</b> choose Inertial and watch the ghost (what the suit thinks) drift away. Switch off <b>foot-contact fix</b>. Add compass drift, then press <b>Recalibrate</b>. Compare the four methods on the board.</p>`,
  terms: [
    { t: 'IMU', d: 'Inertial measurement unit: a tiny gyroscope, accelerometer and compass in one chip.' },
    { t: 'Drift', d: 'Error that keeps growing, because small mistakes are added up again and again.' },
    { t: 'Zero-velocity update', d: 'Resetting speed to zero each time a foot is planted, to stop drift growing.' },
    { t: 'Markerless capture', d: 'Finding a body’s pose in ordinary video, without markers or a suit.' },
    { t: 'Pose estimation', d: 'Machine learning that finds keypoints like elbows and knees in a picture.' },
    { t: 'Depth camera', d: 'A camera that measures how far away each point is, e.g. by projecting infrared dots.' },
  ],
  defaults: { method: 'inertial', move: 'walk', bias: 1, heading: 2, zupt: true },
  controls: [
    { key: 'method', type: 'seg', label: 'Method', options: Object.entries(METHODS).map(([v, m]) => ({ v, label: m.name })) },
    { key: 'move', type: 'seg', label: 'Performance', options: ['walk', 'run', 'jump', 'idle'].map((v) => ({ v, label: MOVES[v].name })) },
    { key: 'bias', type: 'log', label: 'Inertial: accelerometer error', min: 0.1, max: 10, fmt: (v) => `${v.toFixed(2)} mg` , hint: '1 mg is one thousandth of the pull of gravity.' },
    { key: 'heading', type: 'range', label: 'Inertial: compass drift', min: 0, max: 20, step: 0.5, fmt: (v) => `${v.toFixed(1)}°/min` },
    { key: 'zupt', type: 'toggle', label: 'Inertial: foot-contact fix' },
    { type: 'buttons', label: 'Inertial suit', items: [{ label: 'Recalibrate (stand still)', act: (s, inst) => inst?.recal?.() }] },
  ],
  quiz: [
    { q: 'What does an inertial suit use instead of cameras?', options: ['Microphones', 'Small motion sensors (IMUs) on each body part', 'Lasers in the ceiling', 'A green screen'], answer: 1, why: 'Each IMU has a gyroscope, accelerometer and magnetometer that measure how that body part moves and turns.' },
    { q: 'Why does an inertial suit’s position drift?', options: ['The battery runs down', 'Tiny acceleration errors are added up twice, so they keep growing', 'The actor gets tired', 'The cameras move'], answer: 1, why: 'Position comes from integrating acceleration twice. A tiny constant error grows with time squared unless foot contacts reset it.' },
    { q: 'What is the big advantage of markerless video capture?', options: ['It is the most accurate', 'No suit or markers, just cameras and software', 'It works in total darkness', 'It captures sound'], answer: 1, why: 'Machine learning finds the pose in ordinary video. It is quick and cheap, but less precise than markers.' },
  ],
  reel: [
    { ms: 5500, caption: 'An inertial suit works anywhere, but without foot fixes its position drifts away.', set: { method: 'inertial', move: 'walk', bias: 3, heading: 8, zupt: false }, act: (s, inst) => inst?.recal?.(), spin: 0.2, view: { pos: [0.2, 3.0, 5.0], target: [0.4, 1.8, 0] } },
  ],

  build({ stage }) {
    const root = new THREE.Group(); stage.root.add(root);
    makeVolume(root, 2);
    const ring = makeCamRing(root, { R: 3.6, H: 2.7 }); ring.set(12);
    const body = makeBody({ markers: true });
    root.add(body.root);
    const perf = new Performer(body, { center: [0, 0], radius: 1.2 }); perf.place(1.2, 0, 0);
    // IMU pucks
    const imuM = M.matte(0xff9a5c, { roughness: 0.5 });
    const imus = IMU_AT.map(([j, o]) => { const b = box(0.045, 0.03, 0.02, imuM); b.position.set(...o); body.J[j].add(b); return b; });
    // the "what the suit thinks" ghost
    const ghost = makeBody({ suit: 0xff9a5c }); root.add(ghost.root); ghost.setOpacity(0.28);
    const gLine = stick(0.012, M.glow(0xff5a8a)); root.add(gLine);
    // markerless: a video camera on a tripod and ML keypoints
    const vcam = new THREE.Group(); vcam.position.set(0, 0, 3.4); root.add(vcam);
    const tri = [0, 1, 2].map((i) => { const a = i * TAU / 3; const l = stick(0.012, M.metal(0x6a717e)); l.between([0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)], [0, 1.25, 0]); vcam.add(l); return l; });
    const vbody = box(0.2, 0.14, 0.12, M.matte(0x1b1d23)); vbody.position.y = 1.35; vcam.add(vbody);
    const vlens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 18), M.matte(0x0b0c10)); vlens.rotation.x = Math.PI / 2; vlens.position.set(0, 1.35, -0.1); vcam.add(vlens);
    const vcamC = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 20); vcamC.position.set(0, 1.35, 3.4); vcamC.lookAt(0, 1.0, 0); vcamC.updateMatrixWorld(true);
    const kpM = M.glow(0x5fd4ff), kps = KP.map(() => { const m = sphere(0.03, kpM, 10); root.add(m); return m; });
    const kpSt = BONES.map(() => { const s = stick(0.01, kpM); root.add(s); return s; });
    // phone face capture: phone on a small stand in front of the face, and projected IR dots
    const phone = new THREE.Group(); root.add(phone);
    const ph = box(0.075, 0.155, 0.009, M.matte(0x16181e)); phone.add(ph);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.145), M.glow(0x24324a)); scr.position.z = -0.0051; scr.rotation.y = Math.PI; phone.add(scr);
    const NIR = 700, irGeo = new THREE.SphereGeometry(0.0022, 5, 4);
    const ir = new THREE.InstancedMesh(irGeo, M.glow(0xff5a6e), NIR); ir.frustumCulled = false; body.J.head.add(ir);
    const hs = body.P.head, o3 = new THREE.Object3D();
    for (let i = 0; i < NIR; i++) {
      // golden-angle spiral over the front of the (faceless) head
      const k = (i + 0.5) / NIR, r = Math.sqrt(k) * 0.95, a = i * 2.39996;
      const u = r * Math.cos(a), v = r * Math.sin(a) * 1.05;
      const z = Math.sqrt(Math.max(0.02, 1 - u * u - v * v));
      o3.position.set(u * 0.84 * hs * 1.01, hs * 0.95 + v * 1.06 * hs * 1.01, z * 0.95 * hs * 1.01); o3.updateMatrix(); ir.setMatrixAt(i, o3.matrix);
    }
    ir.instanceMatrix.needsUpdate = true;
    const lblGhost = stage.label('What the suit thinks', [0, 0, 0], root, 'hot');

    // drift state
    let tC = 0, steps = 0, lastSt = null, p0 = new THREE.Vector3(), hist = [], tH = 0, err = 0;
    const recal = () => { tC = 0; steps = 0; hist = []; p0.copy(perf.pos); };
    let kp2d = [], faceW = new Array(8).fill(0);
    let method = null;
    let st = { seen: 53 };
    const bd = board(root, 3.2, 2.9, 600, 544, (g, w, h) => {
      panelBg(g, w, h);
      const m = METHODS[method || 'inertial'];
      title(g, m.name, method === 'inertial' ? 'position error of the suit since calibration' : method === 'video' ? 'what the ML model finds in one video frame' : method === 'phone' ? 'a few of the 52 expression weights' : 'markers seen by 2+ cameras, sub-millimetre');
      const x0 = 24, y0 = 74, pw = w - 48, phh = 210;
      g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x0, y0, pw, phh);
      if (method === 'inertial') {
        const maxT = 60, maxE = Math.max(0.2, ...hist.map((p) => p[1]));
        const top = maxE > 2 ? Math.ceil(maxE) : maxE > 0.5 ? 2 : 0.5;
        g.strokeStyle = COL.orange; g.lineWidth = 3; g.beginPath();
        hist.forEach(([t, e], i) => { const x = x0 + (t / maxT) * pw, y = y0 + phh - clamp(e / top, 0, 1) * phh; i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke(); g.lineWidth = 1;
        text(g, `${top} m`, x0 + 6, y0 + 20, { font: '15px sans-serif', col: COL.soft });
        text(g, '0', x0 + 6, y0 + phh - 6, { font: '15px sans-serif', col: COL.soft });
        text(g, `${maxT} s`, x0 + pw - 6, y0 + phh + 20, { font: '15px sans-serif', col: COL.soft, align: 'right' });
        text(g, `now ${(err * 100).toFixed(err < 1 ? 1 : 0)} cm`, x0 + pw - 8, y0 + 24, { font: 'bold 18px sans-serif', col: COL.orange, align: 'right' });
      } else if (method === 'video') {
        g.fillStyle = '#20242d'; g.fillRect(x0, y0, pw, phh);
        const P = (p) => [x0 + (p[0] * 0.5 + 0.5) * pw, y0 + (0.5 - p[1] * 0.5) * phh];
        g.strokeStyle = COL.cool; g.lineWidth = 3;
        BONES.forEach(([a, b]) => { const A = kp2d[KP.indexOf(a === 'chest' ? 'neck' : a)], B = kp2d[KP.indexOf(b === 'chest' ? 'neck' : b)]; if (!A || !B) return; const [ax, ay] = P(A), [bx, by] = P(B); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); });
        g.lineWidth = 1; kp2d.forEach((p) => { if (!p) return; const [x, y] = P(p); dot(g, x, y, 5, '#fff'); });
      } else if (method === 'phone') {
        const names = ['jawOpen', 'mouthSmile', 'browUp', 'eyeBlink', 'mouthPucker', 'cheekPuff', 'eyeWide', 'mouthFunnel'];
        names.forEach((n, i) => {
          const x = x0 + 14 + i * (pw - 20) / 8, bw = (pw - 20) / 8 - 12;
          g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, y0 + 20, bw, 150);
          g.fillStyle = COL.ir; g.fillRect(x, y0 + 170 - faceW[i] * 150, bw, faceW[i] * 150);
          g.save(); g.translate(x + bw / 2 + 5, y0 + 200); g.rotate(-0.5); text(g, n, 0, 0, { font: '13px sans-serif', col: COL.soft, align: 'right' }); g.restore();
        });
      } else {
        text(g, `${st.seen} / 53 markers`, x0 + pw / 2, y0 + 110, { font: 'bold 44px sans-serif', col: COL.mint, align: 'center' });
        text(g, 'triangulated this frame', x0 + pw / 2, y0 + 150, { font: '18px sans-serif', col: COL.soft, align: 'center' });
      }
      // comparison table
      const ty = y0 + phh + 44;
      const cols = [x0, x0 + 150, x0 + 310, x0 + 440];
      ['Method', 'Accuracy', 'Cost (rough)', 'Where'].forEach((c, i) => text(g, c, cols[i], ty, { font: 'bold 14px sans-serif', col: COL.soft }));
      Object.entries(METHODS).forEach(([k, m], i) => {
        const y = ty + 28 + i * 52, on = k === method;
        if (on) { g.fillStyle = 'rgba(255,209,102,.13)'; g.fillRect(x0 - 8, y - 20, pw + 16, 48); }
        const c = on ? COL.hot : 'rgba(255,255,255,.85)';
        wrap(g, m.name, cols[0], y, 140, 18, { font: (on ? 'bold ' : '') + '15px sans-serif', col: c });
        wrap(g, m.acc, cols[1], y, 150, 18, { font: '14px sans-serif', col: c });
        wrap(g, m.cost, cols[2], y, 125, 18, { font: '14px sans-serif', col: c });
        wrap(g, m.where, cols[3], y, 130, 18, { font: '14px sans-serif', col: c });
      });
    }, [3.75, 2.35, -1.5]);
    bd.mesh.rotation.y = -0.35;

    const w = new THREE.Vector3(), tmp = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
    let t = 0, tB = 0;
    const inst = {
      recal,
      update(dt, s) {
        dt = Math.max(0, dt); t += dt;
        const narrow = fitNarrow(stage, []);
        reelBoards([[bd, [0.1, 4.6, -1.8], 0.95]]);
        if (s.method !== method) { method = s.method; recal(); }
        const opt = method === 'optical', inr = method === 'inertial', vid = method === 'video', phn = method === 'phone';
        perf.setMove(phn ? 'idle' : s.move);
        if (phn) perf.place(0, 0, 0);
        perf.update(dt, 1, phn ? { look: 0.12 * Math.sin(t * 0.8), nod: 0.06 * Math.sin(t * 1.3) } : {});
        ring.group.visible = opt;
        body.markers.forEach((m) => { m.mesh.visible = opt; });
        imus.forEach((b) => { b.visible = inr; });
        vcam.visible = vid; phone.visible = phn; ir.visible = phn;
        kps.forEach((k) => { k.visible = vid; }); kpSt.forEach((k) => { k.visible = vid; });
        // ---- inertial drift
        ghost.root.visible = inr; gLine.visible = inr; lblGhost.visible = inr;
        if (inr) {
          tC += dt;
          if (perf.stance && perf.stance !== lastSt) steps++;
          lastSt = perf.stance;
          const b = s.bias * 1e-3 * G;                            // m/s²
          const eBias = s.zupt ? steps * 0.5 * b * TSW * TSW : 0.5 * b * tC * tC;
          const th = (s.heading * tC / 60) * Math.PI / 180;       // heading error (rad)
          // ghost pose = true pose; ghost position = heading-rotated path + bias error along x
          ghost.apply(perf.pose);
          w.copy(perf.pos).sub(p0).applyAxisAngle(yAxis, th).add(p0);
          w.x += Math.min(eBias, 30);
          ghost.root.position.set(w.x, body.root.position.y, w.z); ghost.root.rotation.y = perf.yaw + th;
          ghost.update();
          err = Math.hypot(w.x - perf.pos.x, w.z - perf.pos.z);
          gLine.between([perf.pos.x, 0.02, perf.pos.z], [w.x, 0.02, w.z]);
          lblGhost.position.set(clamp(w.x, -6, 6), 2.05, clamp(w.z, -6, 6));
          tH += dt; if (tH > 0.25) { tH = 0; hist.push([tC, err]); if (tC > 60) recal(); }
        }
        // ---- optical: count markers seen by 2+ cameras
        if (opt && Math.floor(t * 10) !== Math.floor((t - dt) * 10)) {
          let n = 0;
          body.markers.forEach((m) => { let c = 0; for (let i = 0; i < ring.n && c < 2; i++) if (project(ring.cams[i].cam, m.world)) c++; if (c >= 2) n++; });
          st.seen = n;
        }
        // ---- markerless keypoints with jitter (about 2–3 cm)
        if (vid) {
          kp2d = KP.map((j, i) => {
            const p = body.J[j].getWorldPosition(tmp);
            if (j === 'head') body.J.head.localToWorld(p.set(0, hs, 0));
            if (j === 'neck') body.J.neck.getWorldPosition(p);
            p.x += 0.022 * wob(t, i); p.y += 0.018 * wob(t, i + 20); p.z += 0.04 * wob(t, i + 40);
            kps[i].position.copy(p);
            const uv = project(vcamC, p); return uv;
          });
          BONES.forEach(([a, b2], i) => {
            const A = kps[KP.indexOf(a === 'chest' ? 'neck' : a)], B = kps[KP.indexOf(b2 === 'chest' ? 'neck' : b2)];
            kpSt[i].between(A.position, B.position);
          });
        }
        // ---- phone
        if (phn) {
          const hw = body.J.head.localToWorld(tmp.set(0, hs * 0.95, 0.42));
          phone.position.copy(hw); phone.lookAt(body.J.head.localToWorld(new THREE.Vector3(0, hs * 0.95, 0)));
          const talk = Math.max(0, Math.sin(t * 7) * Math.sin(t * 1.7));
          faceW = [0.6 * talk, 0.35 + 0.25 * Math.sin(t * 0.6), 0.2 + 0.2 * Math.sin(t * 0.9), Math.max(0, Math.sin(t * 2.3) ** 30), 0.2 * (1 - talk), 0.05, 0.1 + 0.1 * Math.sin(t * 0.4), 0.15 * talk];
        }
        tB += dt; if (tB > 0.08 || inReel()) { tB = 0; bd.redraw(); }
      },
      readout: (s) => {
        const m = METHODS[s.method];
        if (s.method === 'inertial') {
          const b = s.bias * 1e-3 * G;
          return `<div class="row"><span>Sensors on the body</span><b>17 IMUs</b></div>
            <div class="row"><span>Time since calibration</span><b>${tC.toFixed(0)} s</b></div>
            <div class="row"><span>Steps (foot contacts)</span><b>${steps}</b></div>
            <div class="row"><span>Position error</span><b>${err < 1 ? (err * 100).toFixed(1) + ' cm' : err.toFixed(2) + ' m'}</b></div>
            <div class="row"><span>Error after 10 s, no foot fix</span><b>${(0.5 * b * 100 * 100).toFixed(0)} cm</b></div>
            <div class="row"><span>Heading off by</span><b>${(s.heading * tC / 60).toFixed(1)}°</b></div>`;
        }
        return `<div class="row"><span>Method</span><b>${m.name}</b></div>
          <div class="row"><span>Accuracy</span><b>${m.acc}</b></div>
          <div class="row"><span>Setup</span><b>${m.setup}</b></div>
          <div class="row"><span>${s.method === 'video' ? 'Keypoints found' : s.method === 'phone' ? 'Infrared dots projected' : 'Markers triangulated'}</span><b>${s.method === 'video' ? KP.length + ' (BlazePose: 33)' : s.method === 'phone' ? '30,000+' : st.seen + ' / 53'}</b></div>`;
      },
    };
    return inst;
  },
};
