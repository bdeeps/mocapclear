// Chapter 1: the capture volume. A ring of infrared cameras around a 4 m × 4 m stage, and a faceless
// performer in a black suit with 53 reflective markers who walks, runs or jumps. Four camera-view
// insets show what each camera really records: bright dots on black.
// Numbers
//  - Optical mocap cameras typically record 120–160 frames a second (Wikipedia, "Motion capture").
//    We use 120 fps. Each camera sends the 2D centres of its dots, not pictures.
//  - Sensor 2048 × 2048 px behind a 56° lens (a mid-range 4 MP mocap camera, see mocap.js), so one
//    pixel covers d × 2 tan(28°) / 2048 at distance d.
//  - Visibility is computed per camera and per marker: in the picture, and not hidden by a body part.
import {
  THREE, M, clamp, makeBody, Performer, makeCamRing, makeVolume, blocked, project, MARKER_DEFS,
  board, panelBg, title, text, COL, fitNarrow, reelBoards, dot, MOVES, SENSOR_PX, FOV_DEG, D2R, inReel,
} from '../mocap.js';

const FPS = 120;
const BLACK = new THREE.Color(0x020203);
const MOVE_OPTS = ['walk', 'run', 'jump', 'idle', 'tpose'].map((v) => ({ v, label: MOVES[v].name }));

export default {
  id: 'volume',
  short: 'The capture volume',
  title: 'The capture volume',
  subtitle: 'A ring of infrared cameras watches a performer covered in shiny dots.',
  view: { pos: [-0.8, 6.3, 9.0], target: [1.05, 1.4, 0] },
  learn: `<p>Motion capture (<b>mocap</b>) records how a real person moves, so a computer character can move the same way. The most accurate kind is <b>optical</b> mocap. It happens in a <b>capture volume</b>: an empty stage ringed by special cameras, often 12 to 48 of them.</p>
    <p>The performer wears a tight black suit with about 40 to 60 <b>markers</b>: small balls covered in <b>retroreflective</b> tape, the same stuff as on road signs and safety jackets. Each camera has a ring of <b>infrared LEDs</b> around its lens. The tape bounces that light straight back into the lens, so the markers shine brightly while everything else looks dark.</p>
    <p>So a mocap camera does not film a picture of the actor. It sees only <b>bright dots on black</b>, finds the centre of each dot, and sends those 2D positions to the computer, about <b>120 times a second</b>. Look at the four camera views: each camera sees a different pattern, and some dots are missing because the body is in the way.</p>
    <p class="tip"><b>Try it:</b> change the number of cameras and watch how many cameras see each marker. Switch between walk, run and jump. Turn on <b>What the cameras see</b> to hide the body and keep only the dots.</p>`,
  terms: [
    { t: 'Motion capture', d: 'Recording a real performer’s movement so a digital character can copy it.' },
    { t: 'Capture volume', d: 'The space on the stage that enough cameras can see to track markers.' },
    { t: 'Marker', d: 'A small ball with reflective tape, stuck to the suit at a known place on the body.' },
    { t: 'Retroreflective', d: 'Reflecting light straight back towards where it came from, like a road sign.' },
    { t: 'Infrared (IR)', d: 'Light just beyond red that our eyes cannot see. The cameras flash it and see only it.' },
    { t: 'Centroid', d: 'The centre of a bright dot in the picture, found to a fraction of a pixel.' },
  ],
  defaults: { cams: 16, move: 'walk', speed: 1, dots: false, show: true },
  controls: [
    { key: 'cams', type: 'range', label: 'Infrared cameras', min: 12, max: 24, step: 2, fmt: (v) => `${v}` },
    { key: 'move', type: 'seg', label: 'Performance', options: MOVE_OPTS },
    { key: 'speed', type: 'range', label: 'Playback speed', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'dots', type: 'toggle', label: 'What the cameras see (dots only)' },
    { key: 'show', type: 'toggle', label: 'Show the four camera views' },
  ],
  quiz: [
    { q: 'What does a mocap camera actually record?', options: ['A colour video of the actor', 'The 2D positions of bright marker dots', 'The actor’s voice', 'A 3D scan of the room'], answer: 1, why: 'Infrared light bounces back from the markers, so each camera sees bright dots on black and sends the centre of each dot.' },
    { q: 'Why are the markers covered in retroreflective tape?', options: ['To keep the actor cool', 'It bounces the cameras’ infrared light straight back into the lens', 'It makes them sticky', 'It glows in the dark on its own'], answer: 1, why: 'Retroreflective tape sends light back the way it came, so the markers shine brightly for the camera that lit them.' },
    { q: 'Why do studios use many cameras all around the stage?', options: ['To make the stage brighter', 'So every marker is seen by several cameras even when the body hides it from some', 'Because each camera can only see one marker', 'To record sound'], answer: 1, why: 'Arms, legs and the body block markers from some cameras. With cameras all round, others still see them.' },
  ],
  reel: [
    { ms: 5000, caption: 'Motion capture happens on a stage ringed by infrared cameras.', set: { cams: 12, move: 'walk', speed: 1, dots: false, show: false }, anim: { cams: [12, 24] }, spin: 0.5, view: { pos: [0, 3.6, 6.2], target: [0, 1.4, 0] } },
    { ms: 5000, caption: 'Reflective markers shine back, so each camera sees only bright dots.', set: { cams: 16, move: 'run', dots: true, show: true }, spin: 0.2, view: { pos: [0.2, 3.2, 5.2], target: [0, 2.3, 0] } },
  ],

  build({ stage }) {
    const root = new THREE.Group(); stage.root.add(root);
    stage.scene.background = null;
    makeVolume(root, 2);
    const ring = makeCamRing(root, { R: 3.6, H: 2.7 });
    const body = makeBody({ markers: true });
    root.add(body.root);
    const perf = new Performer(body, { center: [0, 0], radius: 1.2 });
    perf.place(1.2, 0, 0);

    const lblCam = stage.label('Infrared camera', [0, 0, 0], root);
    const lblMk = stage.label('Reflective marker', [0, 0, 0], root, 'hot');
    const lblVol = stage.label('Capture volume, 4 m × 4 m', [0, 0.05, 2.25], root);

    // four camera views
    const VIEW = [0, 0.25, 0.5, 0.75];
    let st = { views: [], perMarker: [], seen: 0 };
    const tags = VIEW.map((_, k) => stage.label(`${k + 1}`, [0, 0, 0], root, 'hot'));
    const bd = board(root, 3.4, 3.1, 560, 510, (g, w, h) => {
      panelBg(g, w, h);
      title(g, 'What four cameras see', 'infrared only: markers are bright dots');
      const cw = 262, ch = 200;
      st.views.forEach((v, k) => {
        const x0 = 14 + (k % 2) * (cw + 8), y0 = 76 + Math.floor(k / 2) * (ch + 12);
        g.fillStyle = '#030405'; g.fillRect(x0, y0, cw, ch);
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
        // other cameras' LED rings show up as bright blobs; real systems "mask" them out
        for (const o of v.others) {
          const x = x0 + (o[0] * 0.5 + 0.5) * cw, y = y0 + (0.5 - o[1] * 0.5) * ch;
          g.strokeStyle = 'rgba(255,90,110,.6)'; g.strokeRect(x - 6, y - 6, 12, 12);
          dot(g, x, y, 3, 'rgba(255,120,130,.8)');
        }
        for (const d of v.dots) dot(g, x0 + (d[0] * 0.5 + 0.5) * cw, y0 + (0.5 - d[1] * 0.5) * ch, clamp(d[2], 1.4, 4), '#f4f7ff');
        text(g, `Camera ${k + 1}`, x0 + 8, y0 + 20, { font: 'bold 15px sans-serif', col: COL.hot });
        text(g, `${v.dots.length} dots`, x0 + cw - 8, y0 + 20, { font: '15px sans-serif', col: COL.soft, align: 'right' });
      });
      text(g, 'Red squares: other cameras’ LEDs, masked out', 16, h - 12, { font: '15px sans-serif', col: 'rgba(255,140,150,.85)' });
    }, [4.1, 2.3, -1.0]);
    bd.mesh.rotation.y = -0.5;

    let lastCams = -1, tBoard = 0;
    const vis = new Uint8Array(24 * 64);
    return {
      update(dt, s) {
        dt = Math.max(0, dt);
        const narrow = fitNarrow(stage, [lblVol, lblCam]);
        reelBoards([[bd, [0, 4.75, -1.6], 0.88]]);
        bd.mesh.visible = s.show;
        if (s.cams !== lastCams) { ring.set(Math.round(s.cams)); lastCams = s.cams; }
        perf.setMove(s.move);
        perf.update(dt * s.speed, 1);
        body.setOpacity(s.dots ? 0.06 : 1);
        stage.scene.background = s.dots ? BLACK : null;
        stage.floor.visible = !s.dots;
        // markers glow when shown as "what the camera sees"
        for (const m of body.markers) m.mesh.material.emissive.setHex(s.dots ? 0xffffff : 0x000000);
        // visibility of every marker in every camera
        const N = ring.n, cams = ring.cams;
        const views = VIEW.map(() => ({ dots: [], others: [] }));
        const per = new Array(body.markers.length).fill(0);
        body.markers.forEach((m, j) => {
          for (let i = 0; i < N; i++) {
            const c = cams[i];
            const uv = project(c.cam, m.world);
            const ok = uv && !blocked(c.pos, m.world, body.caps);
            vis[i * 64 + j] = ok ? 1 : 0;
            if (ok) per[j]++;
          }
        });
        VIEW.forEach((f, k) => {
          const ci = Math.round(f * N) % N, c = cams[ci];
          body.markers.forEach((m, j) => {
            if (!vis[ci * 64 + j]) return;
            const uv = project(c.cam, m.world);
            views[k].dots.push([uv[0], uv[1], 90 / c.pos.distanceTo(m.world) * 0.05]);
          });
          for (let i = 0; i < N; i++) if (i !== ci) { const uv = project(c.cam, cams[i].pos); if (uv) views[k].others.push(uv); }
          const tg = tags[k]; tg.position.copy(c.pos).add(new THREE.Vector3(0, 0.34, 0)); tg.visible = s.show;
        });
        cams.forEach((c, i) => { c.mesh.ring.material.color.setHex(VIEW.some((f) => Math.round(f * N) % N === i) && s.show ? 0xffd166 : 0xff3b4e); });
        st = { views, perMarker: per, seen: per.filter((n) => n >= 2).length };
        tBoard += dt;
        if (tBoard > 0.06 || inReel()) { tBoard = 0; bd.redraw(); }
        // labels
        const c0 = cams[Math.round(0.75 * N) % N]; lblCam.position.copy(c0.pos).add(new THREE.Vector3(0, -0.45, 0));
        const mk = body.markers.find((m) => m.name === 'RKNE'); lblMk.position.copy(mk.world).add(new THREE.Vector3(0.1, 0.12, 0.1));
      },
      readout: (s) => {
        const N = Math.round(s.cams), per = st.perMarker, n = per.length || 1;
        const avg = per.reduce((a, b) => a + b, 0) / n;
        const px = (3.6 * 2 * Math.tan((FOV_DEG / 2) * D2R)) / SENSOR_PX * 1000;
        return `<div class="row"><span>Cameras</span><b>${N}</b></div>
          <div class="row"><span>Markers on the suit</span><b>${MARKER_DEFS.length}</b></div>
          <div class="row"><span>Cameras seeing a marker (avg)</span><b>${avg.toFixed(1)}</b></div>
          <div class="row"><span>Markers seen by 2+ cameras</span><b>${st.seen} / ${per.length}</b></div>
          <div class="row"><span>Dot positions sent per second</span><b>${Math.round(per.reduce((a, b) => a + b, 0) * FPS).toLocaleString('en-IN')}</b></div>
          <div class="row"><span>One pixel at 3.6 m covers</span><b>${px.toFixed(1)} mm</b></div>`;
      },
    };
  },
};
