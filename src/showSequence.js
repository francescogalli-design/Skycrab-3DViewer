// showSequence.js
// Regia dello show in loop (~5 minuti): capitoli del tour alternati a riprese diverse per linguaggio:
// gru, vista zenitale, teleobiettivo laterale, POV ad altezza d'uomo, FPV, e un blocco di
// fotogrammetria in cui si vede il drone scansionare la basilica (camera cinematografica + POV del drone).
//
// Ogni ripresa "path" ha pose(t, pos, target, ctx) con t in 0..1; ctx.drone contiene la posa corrente
// del drone e ctx.roll può impostare il rollio della camera.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const rad = THREE.MathUtils.degToRad;
const CENTER = V(-4, 18, -4);

// ——— Volo di rilievo: spirale discendente attorno alla basilica ———
// quote scelte per restare sopra le torri di Piazza Vecchia (~55 m) con margine
export const SCAN = { center: V(-4, 0, -4), radius: 74, top: 96, bottom: 62, turns: 2.5, startAz: 20, duration: 49 };

export function droneAt(t, pos, look) {
    const az = rad(SCAN.startAz) + t * SCAN.turns * TAU;
    const y = SCAN.top + (SCAN.bottom - SCAN.top) * t;
    pos.set(SCAN.center.x + Math.sin(az) * SCAN.radius, y, SCAN.center.z + Math.cos(az) * SCAN.radius);
    // gimbal inclinato verso il cuore dell'edificio (ripresa obliqua da fotogrammetria)
    look.set(SCAN.center.x, Math.max(6, y * 0.36), SCAN.center.z);
}

// ——— Movimenti di macchina ———
export const orbit = ({ radius, height, from, sweep, lookY = 0, center = CENTER }) => (t, pos, target) => {
    const a = rad(from + sweep * t);
    pos.set(center.x + Math.sin(a) * radius, height, center.z + Math.cos(a) * radius);
    target.copy(center);
    target.y += lookY;
};

export const crane = ({ from, to, targetFrom, targetTo }) => (t, pos, target) => {
    const e = t * t * (3 - 2 * t);
    pos.lerpVectors(from, to, e);
    target.lerpVectors(targetFrom, targetTo, e);
};

// Zenitale: la camera guarda dritta in basso e ruota lentamente sull'asse ottico
export const zenith = ({ from, to, roll }) => (t, pos, target, ctx) => {
    pos.set(CENTER.x + 0.01, from + (to - from) * t, CENTER.z + 0.6);
    target.set(CENTER.x, 0, CENTER.z);
    ctx.roll = roll * t;
};

// Carrello laterale con teleobiettivo (la focale si imposta con `fov`)
export const truck = ({ from, to, look }) => (t, pos, target) => {
    pos.lerpVectors(from, to, t);
    target.copy(look);
};

// Passeggiata ad altezza d'uomo con lieve oscillazione del passo
export const walk = ({ from, to, lookFrom, lookTo }) => (t, pos, target) => {
    pos.lerpVectors(from, to, t);
    pos.y += Math.sin(t * TAU * 7) * 0.025;
    target.lerpVectors(lookFrom, lookTo, t);
};

// FPV: orbita inclinata in virata, sguardo in avanti e verso la basilica
export const fpv = ({ radius, height, from, sweep, bank }) => {
    const ahead = new THREE.Vector3();
    return (t, pos, target, ctx) => {
        const a = rad(from + sweep * t);
        pos.set(CENTER.x + Math.sin(a) * radius, height + Math.sin(t * TAU) * 4, CENTER.z + Math.cos(a) * radius);
        const dir = Math.sign(sweep);
        ahead.set(Math.cos(a) * dir, -0.35, -Math.sin(a) * dir).normalize();
        target.copy(pos).addScaledVector(ahead, 30).lerp(CENTER, 0.4);
        ctx.roll = -bank * dir;
    };
};

// Camera cinematografica che segue il drone da lontano, tenendo in quadro drone e basilica
export const chaseDrone = ({ offsetAz, radius, lift }) => {
    const mid = new THREE.Vector3();
    return (t, pos, target, ctx) => {
        const d = ctx.drone.pos;
        const az = Math.atan2(d.x - CENTER.x, d.z - CENTER.z) + rad(offsetAz);
        pos.set(CENTER.x + Math.sin(az) * radius, d.y + lift, CENTER.z + Math.cos(az) * radius);
        mid.set(CENTER.x, 22, CENTER.z);
        target.lerpVectors(d, mid, 0.16);
    };
};

// Punto di vista del drone: la camera è il gimbal
export const dronePov = () => (t, pos, target, ctx) => {
    pos.copy(ctx.drone.pos);
    target.copy(ctx.drone.look);
};

/*
 * type 'chapter': va al capitolo del tour e resta `hold` secondi.
 * type 'path': entra nella ripresa (transition 'cut' = stacco su nero, altrimenti arco), poi la esegue per `duration`.
 * hud: 'rec' mirino minimale · 'dji' interfaccia di volo completa.
 * fov: focale assoluta in gradi · clearance: distanza minima dal suolo (POV a terra)
 * scanStart: avvia il volo di rilievo · hideDrone: il drone non si vede (siamo noi il drone).
 */
export const SHOW_SEQUENCE = [
    {
        type: 'path', mood: 'dawn', enter: 6, duration: 20, hud: 'rec', fov: 62,
        pose: crane({ from: V(-4, 230, 40), to: V(91.39, 52.56, 8.79), targetFrom: V(-4, 0, -4), targetTo: V(-2, 20, -6) }),
        caption: { kicker: 'Città Alta', title: "Bergamo dall'alto", description: "All'alba la foschia sale dalla pianura e avvolge i tetti della città antica." },
    },
    { type: 'chapter', chapter: 0, mood: 'dawn', travel: 4, hold: 9 },
    {
        type: 'path', transition: 'cut', mood: 'day', duration: 18, hud: 'rec', fov: 52,
        pose: zenith({ from: 175, to: 150, roll: 0.6 }),
        caption: { kicker: 'Vista zenitale', title: 'La pianta a croce greca' },
    },
    { type: 'chapter', chapter: 1, mood: 'day', hold: 8 },
    {
        type: 'path', transition: 'cut', mood: 'day', duration: 20, hud: 'rec', fov: 42, scanStart: true,
        pose: chaseDrone({ offsetAz: -24, radius: 100, lift: 3 }),
        caption: { kicker: 'Fotogrammetria', title: 'Il rilievo da drone', description: 'Il drone vola lungo una spirale attorno alla basilica e scatta centinaia di fotografie sovrapposte: da queste nasce il modello 3D.' },
    },
    {
        type: 'path', transition: 'cut', mood: 'day', duration: 14, hud: 'dji', fov: 70, hideDrone: true,
        pose: dronePov(),
        caption: { kicker: 'POV drone', title: 'Dalla camera del drone' },
    },
    {
        type: 'path', transition: 'cut', mood: 'day', duration: 14, hud: 'rec', fov: 50,
        pose: orbit({ radius: 150, height: 95, from: 300, sweep: 40, lookY: 4 }),
        caption: { kicker: 'Ricostruzione', title: 'Dalla nuvola di punti al modello' },
    },
    { type: 'chapter', chapter: 2, mood: 'sunset', hold: 8 },
    {
        type: 'path', transition: 'cut', mood: 'sunset', duration: 18, fov: 21,
        pose: truck({ from: V(175, 32, 26), to: V(172, 32, -26), look: V(-4, 30, -4) }),
        caption: { kicker: 'Teleobiettivo', title: 'Il profilo sulla città' },
    },
    {
        type: 'path', transition: 'cut', mood: 'sunset', duration: 16, fov: 64, clearance: { min: 1.5, r: 1 },
        pose: walk({ from: V(-26.5, 2.5, -53), to: V(-24.2, 2.5, -45), lookFrom: V(-19, 12, -22), lookTo: V(-16, 16, -24) }),
        caption: { kicker: 'Piazza Duomo', title: "Ad altezza d'uomo" },
    },
    { type: 'chapter', chapter: 3, mood: 'storm', hold: 10 },
    {
        type: 'path', mood: 'storm', enter: 5, duration: 16, hud: 'dji', fov: 76,
        pose: fpv({ radius: 72, height: 62, from: 200, sweep: -110, bank: 0.3 }),
        caption: { kicker: 'Volo FPV', title: 'Dentro il temporale' },
    },
    { type: 'chapter', chapter: 4, mood: 'night', hold: 10 },
    {
        type: 'path', transition: 'cut', mood: 'night', duration: 20, hud: 'rec', fov: 60,
        pose: crane({ from: V(-43.74, 18.99, -45.24), to: V(-125, 190, -15), targetFrom: V(-20.5, 12, -22), targetTo: V(-4, 0, -4) }),
        caption: { kicker: 'Notte', title: 'Le luci della città' },
    },
    {
        type: 'path', mood: 'night', enter: 6, duration: 24, fov: 56,
        pose: orbit({ radius: 130, height: 95, from: 225, sweep: 160, lookY: -6 }),
    },
];
