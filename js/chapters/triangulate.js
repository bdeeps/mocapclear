// Chapter 2: triangulation. One camera only tells you the direction to a marker: a ray. Two or more
// rays from different cameras cross at the marker's 3D position. The performer raises an arm across the
// chest to hide the chest marker (STRN) from cameras in front; a loose marker on a wand can be dragged.
// Maths (see mocap.js triangulate): least-squares intersection of the rays, weighted by each ray's
// sideways uncertainty σ = distance × centroid precision / focal length (1926 px). The covariance
// gives the expected 3D error (RMS) and the drawn error ellipsoid, magnified 300×.
// Accuracy check: Merriaux et al. (2017), "A Study of Vicon System Positioning Performance", Sensors
// 17(7):1591, measured a mean absolute error of 0.15 mm for static markers, under 2 mm moving.
import {
  THREE, M, clamp, lerp, makeBody, Performer, makeCamRing, makeVolume, blocked, project, triangulate, eig3,
  board, panelBg, title, text, COL, fitNarrow, reelBoards, lines, sphere, hash01, inReel, F_PX,
} from '../mocap.js';

const ORDER = [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11];     // switch cameras on spread around the ring
const MAG = 300;

export default {
  id: 'triangulate',
  short: 'Triangulation',
  title: 'Where two rays meet',
  subtitle: 'One camera gives a direction. Two or more give a point in 3D.',
  view: { pos: [1.7, 2.15, 4.5], target: [0.45, 1.4, 0.4] },
  learn: `<p>A single camera cannot tell how far away a dot is. It only knows the <b>direction</b>: the marker is somewhere along a line, a <b>ray</b>, from the lens through that dot. Hold one eye shut and try to touch two pencil tips together: it is surprisingly hard.</p>
    <p>A second camera, somewhere else, gives a second ray. Where the two rays cross is the marker. This is <b>triangulation</b>, the same idea as your two eyes judging distance. With more cameras the rays pin the point down better, and it helps when the cameras look from very <b>different angles</b>. Before a shoot, the team waves a <b>calibration wand</b> through the volume so the computer knows exactly where each camera is.</p>
    <p>Because each dot's centre is found to a fraction of a pixel, a good optical system places a still marker to <b>well under a millimetre</b>. A lab test of one commercial system measured an average error of <b>0.15 mm</b>. The big enemy is <b>occlusion</b>: when an arm or another actor blocks a marker, fewer cameras see it. Under two, it cannot be placed at all, and a <b>gap</b> appears in the data.</p>
    <p class="tip"><b>Try it:</b> set the cameras to 1 and see the marker slide along its ray. Add a second camera. Raise the arm across the chest and watch rays turn red and a gap appear on the chart. Pick the <b>loose marker</b> and drag it around the stage.</p>`,
  terms: [
    { t: 'Ray', d: 'The line from a camera through a dot in its picture. The marker is somewhere on it.' },
    { t: 'Triangulation', d: 'Finding a point from where rays from two or more places cross.' },
    { t: 'Occlusion', d: 'When something blocks a marker from a camera’s view.' },
    { t: 'Gap', d: 'Frames where a marker was seen by fewer than two cameras, so it has no 3D position.' },
    { t: 'Calibration', d: 'Working out each camera’s exact position and lens by waving a wand with markers.' },
    { t: 'Sub-pixel', d: 'Measuring a dot’s centre more finely than one pixel by averaging its bright pixels.' },
  ],
  defaults: { use: 4, target: 'chest', arm: 0, sigma: 0.1, mx: 0.9, my: 1.3, mz: 0.8, ell: true },
  controls: [
    { key: 'use', type: 'range', label: 'Cameras switched on', min: 1, max: 12, step: 1, fmt: (v) => `${v}` },
    { key: 'target', type: 'seg', label: 'Marker', options: [{ v: 'chest', label: 'Chest marker' }, { v: 'loose', label: 'Loose marker (drag it)' }] },
    { key: 'arm', type: 'range', label: 'Arm across the chest', min: 0, max: 1, step: 0.01, ends: ['down', 'hiding the chest'], fmt: (v) => `${Math.round(v * 100)} %` },
    { key: 'sigma', type: 'log', label: 'Dot centre precision', min: 0.03, max: 1, fmt: (v) => `${v.toFixed(2)} px` },
    { key: 'ell', type: 'toggle', label: 'Show the error blob (×300)' },
  ],
  quiz: [
    { q: 'What can a single camera tell you about a marker?', options: ['Its exact 3D position', 'Only the direction to it (a ray)', 'Its colour', 'Nothing at all'], answer: 1, why: 'A dot in one picture could be anywhere along a line from the lens. You need a second view to know where along the line.' },
    { q: 'A marker is seen by only one camera for a few frames. What happens?', options: ['Its position is still perfect', 'A gap appears in its 3D track', 'The camera zooms in', 'The actor must stop'], answer: 1, why: 'With fewer than two rays, the point cannot be triangulated, so those frames are a gap that must be filled later.' },
    { q: 'Which pair of cameras places a marker most accurately?', options: ['Two cameras side by side, looking the same way', 'Two cameras at right angles to each other', 'Two cameras far behind the marker, one behind the other', 'It makes no difference'], answer: 1, why: 'Rays that cross at a wide angle pin the point down in every direction. Nearly parallel rays leave it fuzzy along their length.' },
  ],
  reel: [
    { ms: 5000, caption: 'One camera only gives a direction; a second ray pins the marker in 3D.', set: { use: 1, target: 'loose', arm: 0, sigma: 0.1, mx: 0.9, my: 1.3, mz: 0.8, ell: true }, anim: { use: [1, 6] }, spin: 0.25, view: { pos: [2.4, 2.4, 4.0], target: [0.4, 1.8, 0.2] } },
    { ms: 5000, caption: 'When an arm hides a marker from too many cameras, a gap appears.', set: { use: 8, target: 'chest', arm: 0 }, anim: { arm: [0, 1] }, spin: 0.15, view: { pos: [1.8, 2.2, 3.6], target: [0, 1.9, 0.2] } },
  ],

  build({ stage, s: s0 }) {
    const root = new THREE.Group(); stage.root.add(root);
    makeVolume(root, 2);
    const ring = makeCamRing(root, { R: 3.6, H: 2.7, target: [0, 1.1, 0] });
    ring.set(12, Math.PI / 12);
    const body = makeBody({ markers: true });
    root.add(body.root);
    const perf = new Performer(body, { center: [0, 0], radius: 1 });
    perf.place(0, 0, 0.9); perf.yaw = 0.35; perf.setMove('idle'); perf.blend = 1; perf.prevMove = 'idle';

    // the loose marker on a thin wand
    const loose = sphere(0.035, new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.25, metalness: 0.2 }));
    root.add(loose);
    const hit = sphere(0.16, new THREE.MeshBasicMaterial({ visible: false })); loose.add(hit);
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), M.matte(0x3a3f4a)); root.add(wand);
    const solved = sphere(0.045, M.glow(0x5ce1a9)); root.add(solved);
    const ell = sphere(1, M.ghost(0x5ce1a9, 0.28), 24); root.add(ell);
    const rays = lines(64, 0xffffff, 0.95); root.add(rays);
    const ghosts = []; for (let i = 0; i < 7; i++) { const g = sphere(0.03, M.ghost(0xffd166, 0.55)); root.add(g); ghosts.push(g); }
    const lblT = stage.label('', [0, 0, 0], root, 'hot');
    const lblG = stage.label('Somewhere on this ray?', [0, 0, 0], root);
    const lblCal = stage.label('Rays cross here', [0, 0, 0], root);

    // history chart of how many cameras see the marker
    const hist = new Float32Array(240).fill(-1); let hi = 0, tHist = 0;
    let st = { seen: 0, on: 0, rms: 0, angle: 0, depth: 0, dist: 0 };
    const bd = board(root, 2.2, 1.4, 560, 355, (g, w, h) => {
      panelBg(g, w, h);
      title(g, 'Cameras seeing the marker', 'last 6 seconds, one bar every 1/40 s');
      const x0 = 30, y0 = 300, bw = (w - 50) / hist.length, top = 12;
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(x0, y0 - (2 / top) * 210); g.lineTo(w - 16, y0 - (2 / top) * 210); g.stroke();
      text(g, '2 needed', w - 18, y0 - (2 / top) * 210 - 6, { font: '14px sans-serif', col: COL.soft, align: 'right' });
      for (let i = 0; i < hist.length; i++) {
        const v = hist[(hi + i) % hist.length]; if (v < 0) continue;
        const x = x0 + i * bw;
        if (v < 2) { g.fillStyle = 'rgba(255,90,138,.85)'; g.fillRect(x, y0 - 210, bw + 0.5, 210); continue; }
        g.fillStyle = COL.mint; g.fillRect(x, y0 - (v / top) * 210, bw + 0.5, (v / top) * 210);
      }
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(w - 16, y0); g.stroke();
      text(g, 'Red: fewer than 2 cameras, a gap in the data', x0, y0 + 32, { font: '16px sans-serif', col: COL.bad });
    }, [1.75, 1.95, -0.55]);
    bd.mesh.rotation.y = -0.45;

    // dragging the loose marker
    const el = stage.renderer.domElement, ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), plane = new THREE.Plane(), hitP = new THREE.Vector3();
    let drag = false, S = s0;
    const toNdc = (e) => { const b = el.getBoundingClientRect(); v2.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(v2, stage.camera); };
    const down = (e) => {
      if (S.target !== 'loose') return;
      toNdc(e); if (!ray.intersectObject(hit).length) return;
      drag = true; stage.controls.enabled = false; el.setPointerCapture?.(e.pointerId);
      const n = stage.camera.getWorldDirection(new THREE.Vector3()); plane.setFromNormalAndCoplanarPoint(n, loose.position);
    };
    const move = (e) => {
      if (!drag) return; toNdc(e);
      if (ray.ray.intersectPlane(plane, hitP)) { S.mx = clamp(hitP.x, -1.9, 1.9); S.my = clamp(hitP.y, 0.1, 2.4); S.mz = clamp(hitP.z, -1.9, 1.9); }
    };
    const up = () => { if (drag) { drag = false; stage.controls.enabled = true; } };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    stage.pickables.push(hit);

    const X = new THREE.Vector3(), tmp = new THREE.Vector3();
    return {
      update(dt, s) {
        dt = Math.max(0, dt); S = s;
        const narrow = fitNarrow(stage, [lblCal, lblG]);
        reelBoards([[bd, [0, 3.35, -1.2], 0.9]]);
        // the arm: right arm swings up and across the chest
        const a = s.arm;
        perf.update(dt, 1, { shR: 1.25 * a + 0.05, abR: 0.12 - 0.75 * a, elR: 0.25 + 1.0 * a });
        const isLoose = s.target === 'loose';
        loose.visible = wand.visible = isLoose;
        loose.position.set(s.mx, s.my, s.mz);
        wand.position.set(s.mx, s.my / 2, s.mz); wand.scale.y = Math.max(0.01, s.my - 0.04);
        const mk = body.markers.find((m) => m.name === 'STRN');
        body.markers.forEach((m) => m.mesh.material.emissive.setHex(m === mk && !isLoose ? 0x886600 : 0));
        X.copy(isLoose ? loose.position : mk.world);
        // rays from the cameras that are switched on
        const on = ORDER.slice(0, Math.round(s.use)).map((i) => ring.cams[i]);
        const used = [];
        rays.begin();
        for (const c of on) {
          const vis = !!project(c.cam, X) && !blocked(c.pos, X, body.caps);
          c.mesh.ring.material.color.setHex(vis ? 0x5ce1a9 : 0xff3b4e);
          if (vis) {
            // add the camera's measuring noise to the ray (shown 300× larger)
            const d = X.clone().sub(c.pos).normalize();
            used.push({ o: c.pos, d });
            rays.seg(c.pos, X, 0x5ce1a9);
          } else {
            // stop the red ray where the body blocks it (roughly)
            let f = 1; for (let k = 1; k <= 40; k++) { tmp.lerpVectors(c.pos, X, k / 40); if (blocked(c.pos, tmp, body.caps)) { f = k / 40; break; } }
            rays.seg(c.pos, tmp.lerpVectors(c.pos, X, f), 0xff5a8a);
          }
        }
        ring.cams.forEach((c) => { if (!on.includes(c)) c.mesh.ring.material.color.setHex(0x3a2025); });
        // one ray: show that the marker could be anywhere along it
        ghosts.forEach((g) => { g.visible = false; });
        lblG.visible = false;
        if (used.length === 1) {
          const r = used[0], dist = r.o.distanceTo(X);
          ghosts.forEach((g, k) => { const f = (k + 1) / 8; g.position.copy(r.o).addScaledVector(r.d, dist * (0.45 + f * 0.9)); g.visible = g.position.y > 0.02; });
          lblG.position.copy(ghosts[5].position).add(new THREE.Vector3(0, 0.25, 0)); lblG.visible = !narrow;
        }
        rays.end();
        const tri = used.length >= 2 ? triangulate(used, X, s.sigma) : null;
        solved.visible = !!tri; ell.visible = !!tri && s.ell;
        if (tri) {
          solved.position.copy(X);
          const { vals, vecs } = eig3(tri.cov);
          const m = new THREE.Matrix4().makeBasis(vecs[0], vecs[1], vecs[2]);
          if (m.determinant() < 0) vecs[2].negate(), m.makeBasis(vecs[0], vecs[1], vecs[2]);
          ell.quaternion.setFromRotationMatrix(m); ell.position.copy(X);
          ell.scale.set(...vals.map((v) => clamp(Math.sqrt(Math.max(0, v)) * MAG * 2, 0.02, 1.2)));
          st.depth = Math.sqrt(Math.max(...vals)) * 1000;
        }
        lblCal.position.copy(X).add(new THREE.Vector3(0.25, 0.35, 0)); lblCal.visible = !!tri && !narrow;
        lblT.element.textContent = isLoose ? 'Drag me' : 'Chest marker';
        lblT.position.copy(X).add(new THREE.Vector3(-0.1, -0.22, 0.25));
        // widest angle between any two rays
        let ang = 0; for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) ang = Math.max(ang, used[i].d.angleTo(used[j].d));
        st = { seen: used.length, on: on.length, rms: tri ? tri.rms * 1000 : 0, angle: ang * 57.3, depth: tri ? st.depth : 0, dist: used.length ? used.reduce((q, r) => q + r.o.distanceTo(X), 0) / used.length : 0 };
        tHist += dt;
        if (tHist >= 0.025 || inReel()) { tHist = 0; hist[hi] = used.length; hi = (hi + 1) % hist.length; bd.redraw(); }
      },
      readout: (s) => {
        const px = st.dist ? (st.dist * s.sigma / F_PX) * 1000 : 0;
        return `<div class="row"><span>Cameras on / seeing it</span><b>${st.on} / ${st.seen}</b></div>
          <div class="row"><span>Widest angle between rays</span><b>${st.seen >= 2 ? Math.round(st.angle) + '°' : '–'}</b></div>
          <div class="row"><span>Sideways error of one ray</span><b>${st.seen ? px.toFixed(2) + ' mm' : '–'}</b></div>
          <div class="row"><span>3D position</span><b>${st.seen >= 2 ? 'solved' : st.seen === 1 ? 'depth unknown' : 'gap: not seen'}</b></div>
          <div class="row"><span>Expected 3D error (RMS)</span><b>${st.seen >= 2 ? st.rms.toFixed(2) + ' mm' : '–'}</b></div>
          <div class="row"><span>Worst direction</span><b>${st.seen >= 2 ? st.depth.toFixed(2) + ' mm' : '–'}</b></div>`;
      },
      dispose() {
        el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        stage.controls.enabled = true;
      },
    };
  },
};
