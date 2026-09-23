// showSequence.js
// Regia dello show in loop (~5 minuti): capitoli del tour alternati a riprese da drone.
// Ogni ripresa "path" è una funzione pose(t, pos, target) con t in 0..1.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CENTER = V(-4, 18, -4);

// Orbita attorno alla basilica a quota costante
export const orbit = ({ radius, height, from, sweep, lookY = 0, center = CENTER }) => (t, pos, target) => {
    const a = THREE.MathUtils.degToRad(from + sweep * t);
    pos.set(center.x + Math.sin(a) * radius, height, center.z + Math.cos(a) * radius);
    target.copy(center);
    target.y += lookY;
};

// Gru / dolly verticale tra due pose
export const crane = ({ from, to, targetFrom, targetTo }) => (t, pos, target) => {
    const e = t * t * (3 - 2 * t);
    pos.lerpVectors(from, to, e);
    target.lerpVectors(targetFrom, targetTo, e);
};

// Sorvolo rettilineo con lo sguardo in avanti e verso il basso
export const flyover = ({ from, to, lookAhead = 40, lookDown = 28 }) => {
    const dir = to.clone().sub(from).normalize();
    return (t, pos, target) => {
        pos.lerpVectors(from, to, t);
        target.copy(pos).addScaledVector(dir, lookAhead);
        target.y -= lookDown;
    };
};

/*
 * type 'chapter': va al capitolo del tour e resta `hold` secondi.
 * type 'path': entra in `enter` secondi nella posa iniziale, poi esegue la ripresa per `duration`.
 * drone: mostra il mirino del drone · scan: esegue la scansione 3D · fov: gradi di FOV extra.
 */
export const SHOW_SEQUENCE = [
    {
        type: 'path', mood: 'dawn', enter: 6, duration: 20, drone: true, fov: 8,
        pose: crane({ from: V(-4, 230, 40), to: V(91.39, 52.56, 8.79), targetFrom: V(-4, 0, -4), targetTo: V(-2, 20, -6) }),
        caption: { kicker: 'Città Alta', title: "Bergamo dall'alto", description: "All'alba la foschia sale dalla pianura e avvolge i tetti della città antica." },
    },
    { type: 'chapter', chapter: 0, mood: 'dawn', travel: 4, hold: 9 },
    {
        type: 'path', mood: 'day', enter: 6, duration: 30, drone: true, scan: true, fov: 4,
        pose: orbit({ radius: 85, height: 55, from: 60, sweep: 200, lookY: 4 }),
        caption: { kicker: 'Rilievo 3D', title: 'Scansione da drone', description: 'Migliaia di fotografie aeree ricostruiscono ogni pietra: quasi due milioni di triangoli e texture ad altissima risoluzione.' },
    },
    { type: 'chapter', chapter: 1, mood: 'day', hold: 9 },
    {
        type: 'path', mood: 'day', enter: 6, duration: 18, drone: true, fov: 10,
        pose: flyover({ from: V(140, 80, 60), to: V(-110, 75, -70) }),
        caption: { kicker: 'Sorvolo', title: 'Sopra i tetti' },
    },
    { type: 'chapter', chapter: 2, mood: 'sunset', hold: 9 },
    {
        type: 'path', mood: 'sunset', enter: 6, duration: 24, drone: true, fov: 6,
        pose: orbit({ radius: 150, height: 105, from: 200, sweep: 110, lookY: -4 }),
        caption: { kicker: "Ora d'oro", title: 'Il profilo di Città Alta' },
    },
    { type: 'chapter', chapter: 3, mood: 'storm', hold: 11 },
    {
        type: 'path', mood: 'storm', enter: 6, duration: 18, fov: 4,
        pose: orbit({ radius: 75, height: 48, from: 150, sweep: -80, lookY: 2 }),
        caption: { kicker: 'Temporale', title: 'La pietra sotto la pioggia' },
    },
    { type: 'chapter', chapter: 4, mood: 'night', hold: 11 },
    {
        type: 'path', mood: 'night', enter: 1, duration: 20, drone: true, fov: 8,
        pose: crane({ from: V(-43.74, 18.99, -45.24), to: V(-60, 190, -120), targetFrom: V(-20.5, 12, -22), targetTo: V(-4, 0, -4) }),
        caption: { kicker: 'Notte', title: 'Le luci della città' },
    },
    {
        type: 'path', mood: 'night', enter: 6, duration: 28, fov: 6,
        pose: orbit({ radius: 130, height: 95, from: 225, sweep: 160, lookY: -6 }),
    },
    {
        type: 'path', mood: 'night', enter: 6, duration: 26, drone: true, scan: true, fov: 4,
        pose: orbit({ radius: 80, height: 50, from: 20, sweep: 120, lookY: 4 }),
        caption: { kicker: 'Rilievo 3D', title: 'Scansione notturna' },
    },
];
