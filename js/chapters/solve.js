// Chapter 3: from dots to skeleton to creature. Step through the pipeline: raw 3D dots (no names),
// labelled markers (each one named and coloured by body part), the solved skeleton, and the skeleton
// retargeted onto a creature with different proportions.
// Physics of foot slide: copying joint angles onto legs k times as long makes each step k times as long.
// If the body's travel is still copied 1:1, the planted foot must slide by (1 − k) of the travel. Scaling
// the travel by k (the leg-length ratio) removes it. The readout measures the slide speed of the creature's
// planted foot straight from the model, frame by frame.
import {
  THREE, M, clamp, lerp, makeBody, Performer, Retarget, makeSkeleton, makeVolume, creatureProps, CREATURES, PERF, legLen,
  PART_COL, board, panelBg, title, text, wrap, COL, fitNarrow, reelBoards, MOVES, inReel, sphere,
} from '../mocap.js';

const STEPS = [{ v: 0, label: '1 Dots' }, { v: 1, label: '2 Labels' }, { v: 2, label: '3 Skeleton' }, { v: 3, label: '4 Creature' }];
const LEFT = [-1.7, 0], RIGHT = [1.9, 0];

export default {
  id: 'solve',
  short: 'Dots to skeleton',
  title: 'From dots to a creature',
  subtitle: 'Name the dots, fit a skeleton, then hand the motion to someone else’s body.',
  view: { pos: [0.0, 2.8, 7.1], target: [0.3, 1.3, 0] },
  learn: `<p>Triangulation gives a cloud of 3D dots, 120 times a second, but the computer does not yet know which dot is which. Step one is <b>labelling</b>: each dot gets a name like <b>LKNE</b> (left knee) or <b>RWRA</b> (right wrist). The software uses a template of the suit and follows each dot from frame to frame. When two dots pass close together, it can mix them up, a <b>marker swap</b>, which a person then fixes.</p>
    <p>Step two is <b>solving</b>. The software fits a <b>skeleton</b> (a set of bones and joints sized to the actor) inside the labelled dots, frame by frame. The result is not dots any more but <b>joint rotations</b>: how much the hip, knee and elbow bend.</p>
    <p>Step three is <b>retargeting</b>: copying those rotations onto a character with a different body. The character needs its own skeleton and <b>rig</b> (see <b>Anim3DClear</b> for rigging). If its legs are longer, each copied step is longer too. If the body still travels as far as the actor did, the planted foot must slip along the floor: <b>foot slide</b>. The fix is to scale the travel to the new leg length, and to <b>lock the feet</b> to the floor with IK (inverse kinematics).</p>
    <p class="tip"><b>Try it:</b> step through Dots, Labels, Skeleton and Creature. Pick a creature and set <b>Body travel</b> to “copied as-is”: watch the red foot-slide streaks. Slide it to “scaled to legs” and the feet stick.</p>`,
  terms: [
    { t: 'Labelling', d: 'Giving each 3D dot the name of the marker it belongs to, in every frame.' },
    { t: 'Marker swap', d: 'When the software confuses two nearby markers, so their tracks cross over.' },
    { t: 'Solving', d: 'Fitting a skeleton inside the markers to get joint positions and rotations.' },
    { t: 'Retargeting', d: 'Copying motion from one skeleton onto another with different proportions.' },
    { t: 'Foot slide', d: 'A planted foot slipping on the ground because steps and travel don’t match.' },
    { t: 'IK (inverse kinematics)', d: 'Working out joint angles from where a hand or foot must be, used to pin feet down.' },
  ],
  defaults: { step: 3, creature: 'tall', move: 'walk', travel: 0, trails: true },
  controls: [
    { key: 'step', type: 'seg', label: 'Pipeline step', options: STEPS },
    { key: 'creature', type: 'seg', label: 'Creature', options: Object.entries(CREATURES).map(([v, c]) => ({ v, label: c.name })) },
    { key: 'move', type: 'seg', label: 'Performance', options: ['walk', 'run', 'jump'].map((v) => ({ v, label: MOVES[v].name })) },
    { key: 'travel', type: 'range', label: 'Body travel', min: 0, max: 1, step: 0.01, ends: ['copied as-is', 'scaled to legs'], fmt: (v) => `${Math.round(v * 100)} %` },
    { key: 'trails', type: 'toggle', label: 'Footprints (red = sliding)' },
  ],
  quiz: [
    { q: 'What does “labelling” mean in mocap?', options: ['Printing names on the suit', 'Deciding which marker each 3D dot is, in every frame', 'Adding captions to the film', 'Colouring the creature'], answer: 1, why: 'Triangulated dots have no names. Labelling matches each one to a marker on the suit template, frame by frame.' },
    { q: 'What comes out of solving?', options: ['A colour video', 'A skeleton’s joint positions and rotations', 'A sound track', 'A new marker suit'], answer: 1, why: 'The solver fits bones inside the markers. Animators work with the joint rotations, not the dots.' },
    { q: 'A creature has legs 1.5 times as long as the actor. Its body travel is copied as-is. What goes wrong?', options: ['Nothing', 'Its feet slide on the ground', 'It becomes shorter', 'It walks backwards'], answer: 1, why: 'Each step is 1.5 times longer but the body moves the actor’s distance, so the planted foot must slip. Scale the travel or lock the feet.' },
  ],
  reel: [
    { ms: 5000, caption: 'The computer names every dot, then fits a skeleton inside them.', set: { step: 0, creature: 'tall', move: 'walk', travel: 1, trails: false }, anim: { step: [0, 2] }, spin: 0.2, view: { pos: [-1.3, 1.9, 3.0], target: [-1.6, 1.5, 0] } },
    { ms: 5500, caption: 'Retargeting puts the motion on a new body; wrong travel makes feet slide.', set: { step: 3, creature: 'tall', move: 'walk', travel: 0, trails: true }, anim: { travel: [0, 1] }, spin: 0.15, view: { pos: [0.3, 3.0, 5.0], target: [0.3, 2.0, 0] } },
  ],

  build({ stage }) {
    const root = new THREE.Group(); stage.root.add(root);
    for (const c of [LEFT, RIGHT]) { const v = makeVolume(root, 1.55); v.position.set(c[0], 0, c[1]); }
    const body = makeBody({ markers: true });
    root.add(body.root);
    const perf = new Performer(body, { center: LEFT, radius: 0.9 });
    perf.place(LEFT[0] + 0.9, LEFT[1], 0);
    const skel = makeSkeleton(root, body, 0xffd166, 0.016);
    const lbls = ['LKNE', 'RWRA', 'LFHD', 'STRN', 'RANK'].map((n) => ({ n, l: stage.label(n, [0, 0, 0], root, 'hot'), m: body.markers.find((m) => m.name === n) }));

    // creatures, one per kind (only the chosen one is shown)
    const bodies = {}, rts = {};
    for (const k of Object.keys(CREATURES)) {
      const b = makeBody({ P: creatureProps(k), creature: k }); root.add(b.root); bodies[k] = b;
      rts[k] = new Retarget(b, RIGHT);
    }
    const cskel = {}; for (const k of Object.keys(CREATURES)) { cskel[k] = makeSkeleton(root, bodies[k], 0xffd166, 0.02); }
    const lblP = stage.label('Performer', [LEFT[0], 0.05, 1.75], root);
    const lblC = stage.label('Creature', [RIGHT[0], 0.05, 1.75], root);

    // footprints: little discs on the floor where the creature's planted foot was each 1/20 s
    const NT = 200, trailGeo = new THREE.CircleGeometry(0.035, 10); trailGeo.rotateX(-Math.PI / 2);
    const trail = new THREE.InstancedMesh(trailGeo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 }), NT);
    trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(trail); trail.frustumCulled = false;
    const col = new THREE.Color(), mtx = new THREE.Matrix4();
    for (let i = 0; i < NT; i++) { trail.setMatrixAt(i, mtx.makeTranslation(0, -5, 0)); trail.setColorAt(i, col.set(0x7be08c)); }
    let ti = 0, tt = 0;

    let st = { ratio: 1, slide: 0, speedP: 0, speedC: 0, maxSlide: 0 };
    let slideAvg = 0, lastKind = null, lastMove = null;
    const bd = board(root, 2.7, 1.55, 520, 300, (g, w, h) => {
      panelBg(g, w, h);
      const c = CREATURES[st.kind || 'tall'];
      title(g, c.name, c.note);
      text(g, 'Leg length', 20, 104, { col: COL.soft }); text(g, `${(legLen(PERF) * 100).toFixed(0)} cm → ${(st.leg * 100).toFixed(0)} cm`, w - 20, 104, { align: 'right', font: 'bold 20px sans-serif', col: COL.hot });
      text(g, 'Planted-foot slide', 20, 146, { col: COL.soft });
      const bad = st.slide > 5;
      text(g, `${st.slide.toFixed(0)} cm/s`, w - 20, 146, { align: 'right', font: 'bold 20px sans-serif', col: bad ? COL.bad : COL.good });
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(20, 162, w - 40, 12);
      g.fillStyle = bad ? COL.bad : COL.good; g.fillRect(20, 162, clamp(st.slide / 100, 0, 1) * (w - 40), 12);
      wrap(g, bad ? 'The foot slips: travel does not match the new leg length.' : 'Feet stay planted: travel matches the legs.', 20, 208, w - 40, 24, { col: 'rgba(255,255,255,.85)' });
      if (c.arms4) wrap(g, 'The actor has two arms. The extra pair copies them with an offset, then animators keyframe it.', 20, 258, w - 40, 22, { font: '16px sans-serif', col: COL.violet });
    }, [2.55, 3.05, -1.6]);
    bd.mesh.rotation.y = -0.15;

    const fp = new THREE.Vector3();
    return {
      update(dt, s) {
        dt = Math.max(0, dt);
        const narrow = fitNarrow(stage, [lblP, lblC]);
        reelBoards([[bd, [0.2, 3.75, -1.9], 0.85]]);
        const step = Math.round(s.step);
        perf.setMove(s.move);
        if (s.move !== lastMove || s.creature !== lastKind) { for (const k in rts) rts[k].sync(perf, LEFT); lastMove = s.move; lastKind = s.creature; for (let i = 0; i < NT; i++) trail.setMatrixAt(i, mtx.makeTranslation(0, -5, 0)); }
        perf.update(dt, 1);
        // performer view by step
        body.setOpacity(step === 0 ? 0.0 : step === 1 ? 0.12 : 0.18);
        body.markers.forEach((m) => {
          const c = step === 0 ? 0xffffff : PART_COL[m.part];
          m.mesh.material.color.setHex(c); m.mesh.material.emissive.setHex(c).multiplyScalar(step === 0 ? 0.6 : 0.35);
        });
        skel.group.visible = step >= 2; skel.update();
        lbls.forEach(({ l, m }) => { l.position.copy(m.world).add(new THREE.Vector3(0.12, 0.08, 0.1)); l.visible = step === 1 || (step === 2 && !narrow && !inReel()); });
        // creature
        const kind = s.creature, cb = bodies[kind], rt = rts[kind];
        const ratio = legLen(cb.P) / legLen(PERF);
        const scale = lerp(1, ratio, s.travel);
        for (const k in bodies) bodies[k].root.visible = k === kind && step === 3;
        for (const k in cskel) cskel[k].group.visible = false;
        if (step === 3) {
          const four = cb.creature && CREATURES[kind].arms4 ? 1 : 0;
          const slide = rt.update(dt, perf, scale, { four });
          slideAvg = lerp(slideAvg, slide * 100, clamp(dt * 4, 0, 1));
          // footprints
          tt += dt;
          if (s.trails && perf.stance && tt > 0.05) {
            tt = 0; cb.foot(perf.stance, fp);
            trail.setMatrixAt(ti, mtx.makeTranslation(fp.x, 0.008, fp.z));
            trail.setColorAt(ti, col.set(slide * 100 > 8 ? 0xff5a8a : 0x7be08c)); ti = (ti + 1) % NT;
          }
        }
        trail.visible = s.trails && step === 3;
        trail.instanceMatrix.needsUpdate = true; if (trail.instanceColor) trail.instanceColor.needsUpdate = true;
        st = { kind, ratio, leg: legLen(cb.P), slide: step === 3 ? slideAvg : 0, speedP: perf.speed };
        bd.mesh.visible = step === 3;
        bd.redraw();
      },
      readout: (s) => {
        const step = Math.round(s.step);
        const what = ['Unnamed 3D dots', 'Named markers', 'Solved skeleton', 'Retargeted creature'][step];
        const scale = lerp(1, st.ratio, s.travel);
        return `<div class="row"><span>Step</span><b>${what}</b></div>
          <div class="row"><span>Markers</span><b>53</b></div>
          <div class="row"><span>Performer speed</span><b>${st.speedP.toFixed(2)} m/s</b></div>
          <div class="row"><span>Leg-length ratio</span><b>${st.ratio.toFixed(2)}×</b></div>
          <div class="row"><span>Travel copied at</span><b>${scale.toFixed(2)}×</b></div>
          <div class="row"><span>Foot slide</span><b>${step === 3 ? st.slide.toFixed(0) + ' cm/s' : '–'}</b></div>`;
      },
    };
  },
};
