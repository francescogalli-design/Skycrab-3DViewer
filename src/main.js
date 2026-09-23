import * as THREE from 'three';
import { gsap } from 'gsap';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { cameraPoints } from './cameraPoints.js';
import { setupLighting, applyMood, MOODS } from './light.js';
import { setupModelLoader, fadeInModel } from './modelLoader.js';
import { atmosphereUniforms, scanUniforms, createCityPoints, createCityEdges, createMotes, createRain, FogPass } from './atmosphere.js';
import { SHOW_SEQUENCE } from './showSequence.js';
import { initDebugUI } from './debugSystem.js';
import { AudioManager } from './audioManager.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n) => String(n).padStart(2, '0');
const TAU = Math.PI * 2;

// Ritmo generale: tutto lento e morbido
const TRANSITION = reducedMotion ? 1.2 : 5.2;
const EASE_CAMERA = 'sine.inOut';

// === SCENA ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.0042);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2000);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const maxDpr = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(maxDpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Ombre ricalcolate solo quando la luce cambia (vedi applyMood)
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.getElementById('scene-container').appendChild(renderer.domElement);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const lighting = setupLighting(scene);

// === POST-PROCESSING ===
// MSAA + depth texture (per la nebbia volumetrica) → nebbia → bloom → tone mapping
const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthTexture: new THREE.DepthTexture(1, 1),
});
const composer = new EffectComposer(renderer, renderTarget);
composer.setPixelRatio(maxDpr);
composer.setSize(window.innerWidth, window.innerHeight);
const fogPass = new FogPass(camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.28, 0.6, 0.86);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(fogPass);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const moodContext = { lighting, renderer, scene, atmosphere: { fogPass, bloomPass } };

// === DEBUG (tasto D) ===
let debugEnabled = false;
const debugSystem = initDebugUI(scene, camera, lighting, renderer);
debugSystem.toggle(false);
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey) {
        debugEnabled = !debugEnabled;
        if (debugEnabled) debugSystem.controls.target.copy(rig.target);
        debugSystem.toggle(debugEnabled);
    }
});

// === CAMERA RIG ===
// basePos/target animati da GSAP. Sopra si sommano: loop cinematografico da fermi,
// micro-drift, parallasse del mouse e il vincolo di distanza da tetti e suolo.
const MODEL_CENTER = new THREE.Vector3(-4, 20, -4);
const CAMERA_CLEARANCE = 4;
let heightfield = null;
let shadowsDirtyUntil = 0;
const clock = new THREE.Clock();

const clearanceAt = (p) => (heightfield ? p.y - heightfield.heightAt(p.x, p.z, 3) : Infinity);

const rig = {
    basePos: cameraPoints[0].position.clone().multiplyScalar(2.2).setY(95),
    target: cameraPoints[0].target.clone(),
    pointer: new THREE.Vector2(),
    pointerSmooth: new THREE.Vector2(),
    idle: { w: 0, start: 0 },
};
camera.position.copy(rig.basePos);

// Loop "da fermo": lenta orbita, respiro del dolly e pan, con periodi primi tra loro (non si ripete mai uguale)
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
function idlePose(t, outPos, outTarget) {
    const { w, start } = rig.idle;
    const tt = t - start;
    const yaw = w * 0.12 * Math.sin((tt * TAU) / 53);
    const dolly = w * 0.045 * Math.sin((tt * TAU) / 37);
    const lift = w * 1.8 * Math.sin((tt * TAU) / 29);
    _v.subVectors(rig.basePos, rig.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiplyScalar(1 - dolly);
    outPos.copy(rig.target).add(_v);
    outPos.y += lift;
    _right.crossVectors(_v, THREE.Object3D.DEFAULT_UP).normalize();
    outTarget.copy(rig.target).addScaledVector(_right, w * 1.4 * Math.sin((tt * TAU) / 43));
}

// amount > 1 rende il loop più ampio (modalità show)
function startIdle(amount = 1) {
    rig.idle.start = clock.elapsedTime;
    gsap.to(rig.idle, { w: reducedMotion ? 0 : amount, duration: 7, ease: 'sine.inOut' });
}

// Congela la posa idle corrente come nuova base: la transizione parte senza scatti
function freezeIdle() {
    gsap.killTweensOf(rig.idle);
    const pos = new THREE.Vector3();
    const tgt = new THREE.Vector3();
    idlePose(clock.elapsedTime, pos, tgt);
    rig.basePos.copy(pos);
    rig.target.copy(tgt);
    rig.idle.w = 0;
}

function arcTo(point, duration) {
    const start = rig.basePos.clone();
    const end = point.position.clone();

    // Controllo sollevato e spinto verso l'esterno: la camera gira attorno alla basilica
    const mid = start.clone().lerp(end, 0.5);
    const out = mid.clone().sub(MODEL_CENTER).setY(0);
    if (out.lengthSq() < 1) out.set(end.z - start.z, 0, start.x - end.x);
    const radius = Math.max(
        Math.hypot(start.x - MODEL_CENTER.x, start.z - MODEL_CENTER.z),
        Math.hypot(end.x - MODEL_CENTER.x, end.z - MODEL_CENTER.z),
    );
    mid.copy(MODEL_CENTER).add(out.normalize().multiplyScalar(radius * 1.15));
    mid.y = Math.max(start.y, end.y) + 12;

    // Se il percorso attraversa edifici o terreno, alza l'arco finché non è libero
    let curve;
    for (let attempt = 0; attempt < 24; attempt++) {
        curve = new THREE.CatmullRomCurve3([start, mid, end], false, 'centripetal');
        if (!curve.getSpacedPoints(80).some((p) => clearanceAt(p) < CAMERA_CLEARANCE)) break;
        mid.y += 6;
    }
    const state = { t: 0 };
    return gsap.timeline()
        .to(state, { t: 1, duration, ease: EASE_CAMERA, onUpdate: () => curve.getPoint(state.t, rig.basePos) }, 0)
        .to(rig.target, { x: point.target.x, y: point.target.y, z: point.target.z, duration, ease: EASE_CAMERA }, 0);
}

// lens.breath: gradi di FOV aggiunti a metà transizione (effetto "respiro" cinematografico)
const lens = { base: 54, breath: 0 };
function updateLens() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    lens.base = aspect < 0.8 ? 72 : aspect < 1.2 ? 64 : 54;
    camera.fov = lens.base + lens.breath;
    // Su desktop il soggetto si sposta a destra, lasciando respiro al testo
    camera.filmOffset = window.innerWidth > 900 ? -2.6 : 0;
    camera.updateProjectionMatrix();
}
updateLens();

// === UI ===
const $ = (s) => document.querySelector(s);
const ui = {
    loader: $('#loading-screen'),
    loaderLabel: $('.loader-label'),
    chapter: $('.chapter'),
    kicker: $('.chapter-mood'),
    title: $('.chapter-title'),
    desc: $('.chapter-desc'),
    nav: $('.chapter-nav'),
    arrows: [...document.querySelectorAll('.arrow-btn')],
    scrollHint: $('.scroll-hint'),
    moodIndicator: $('.mood-indicator'),
    loaderPaths: [...document.querySelectorAll('.loader-logo path')],
    moodBtns: [...document.querySelectorAll('.mood-btn')],
    soundBtn: $('.sound-btn'),
    showCta: $('.show-cta'),
    showHud: $('.show-hud'),
    showProgress: $('.show-progress'),
    showExit: $('.show-exit'),
    topbarItems: document.querySelectorAll('.logo-container, .mood-switch, .sound-btn'),
    chrome: document.querySelectorAll('.topbar, .chapter-nav, .bottombar, .scroll-hint'),
};

ui.nav.innerHTML = cameraPoints.map((p, i) => `
    <button class="nav-item" data-index="${i}" aria-label="${p.title}">
        <span class="nav-label">${p.title}</span>
        <span class="nav-num">${pad(i + 1)}</span>
        <span class="nav-line"></span>
    </button>`).join('');
const navItems = [...ui.nav.querySelectorAll('.nav-item')];

// Parole separate: entrano una dopo l'altra con dissolvenza e messa a fuoco
function setTitle(text) {
    ui.title.innerHTML = text.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ');
    return ui.title.querySelectorAll('.w');
}

function renderChapterStatic(i) {
    navItems.forEach((el, j) => el.classList.toggle('is-active', j === i));
    ui.arrows[0].disabled = i === 0;
    ui.arrows[1].disabled = i === cameraPoints.length - 1;
}

function revealChapter(i) {
    renderChapterStatic(i);
    return revealCaption(cameraPoints[i]);
}

// Didascalia generica (capitoli e riprese dello show)
function revealCaption({ kicker = '', title = '', description = '' }) {
    ui.kicker.textContent = kicker;
    ui.desc.textContent = description;
    const words = setTitle(title);
    const blurIn = { opacity: 0, y: 18, filter: 'blur(12px)' };
    const sharp = { opacity: 1, y: 0, filter: 'blur(0px)', ease: 'power3.out' };
    return gsap.timeline()
        .set(ui.chapter, { opacity: 1 })
        .fromTo(ui.kicker, blurIn, { ...sharp, duration: 1.4 }, 0)
        .fromTo(words, blurIn, { ...sharp, duration: 1.5, stagger: 0.09 }, 0.15)
        .fromTo(ui.desc, blurIn, { ...sharp, duration: 1.8 }, 0.55);
}

function chapterOut() {
    const blurOut = { opacity: 0, y: -12, filter: 'blur(10px)', duration: 0.8, ease: 'power2.in' };
    return gsap.timeline()
        .to(ui.kicker, blurOut, 0)
        .to(ui.title.querySelectorAll('.w'), { ...blurOut, stagger: 0.05 }, 0.05)
        .to(ui.desc, blurOut, 0.1);
}

// === ATMOSFERA ===
let moodMode = 'auto';
const currentMoodName = () => (moodMode === 'auto' ? cameraPoints[currentPoint].lighting : moodMode);

function placeMoodIndicator() {
    const active = ui.moodBtns.find((b) => b.dataset.mood === moodMode);
    if (!active) return;
    ui.moodIndicator.style.width = `${active.offsetWidth}px`;
    ui.moodIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

function setMoodMode(mode) {
    moodMode = mode;
    ui.moodBtns.forEach((b) => {
        const on = b.dataset.mood === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
    });
    requestAnimationFrame(placeMoodIndicator);
    setTimeout(placeMoodIndicator, 620);
    setAtmosphere(currentMoodName());
}

// Lampi: raffiche irregolari (doppio bagliore + coda lunga) solo durante il temporale
let lightning = null;
function strike() {
    const f = atmosphereUniforms.uFlash;
    const peak = 2.5 + Math.random() * 2.5;
    lighting.flashLight.position.set((Math.random() - 0.5) * 300, 160, (Math.random() - 0.5) * 300);
    gsap.timeline()
        .to(f, { value: peak, duration: 0.06, ease: 'power4.out' })
        .to(f, { value: 0.25, duration: 0.09 })
        .to(f, { value: peak * 0.7, duration: 0.05 })
        .to(f, { value: 0, duration: 1.2, ease: 'power2.out' });
}
function scheduleLightning(delay) {
    lightning = gsap.delayedCall(delay ?? 2.5 + Math.random() * 5.5, () => {
        strike();
        scheduleLightning();
    });
}

// Pietra bagnata durante il temporale: più lucida e più scura
let basilicaMaterials = [];
const DRY = { roughness: 0.78, tone: 1 };
function setWetness(wet, duration = 4.5) {
    basilicaMaterials.forEach((m) => {
        gsap.to(m, { roughness: wet ? 0.38 : DRY.roughness, duration, ease: 'sine.inOut' });
        const c = wet ? 0.72 : DRY.tone;
        gsap.to(m.color, { r: c, g: c, b: c, duration, ease: 'sine.inOut' });
    });
}

function setAtmosphere(name, duration) {
    applyMood(name, moodContext, duration);
    setWetness(name === 'storm', duration);
    if (name === 'storm') {
        if (!lightning) scheduleLightning((duration ?? 4.5) * 0.6);
    } else if (lightning) {
        lightning.kill();
        lightning = null;
    }
}
ui.moodBtns.forEach((b) => b.addEventListener('click', () => setMoodMode(b.dataset.mood)));

// === SUONO ===
const audio = new AudioManager();
function syncSoundBtn() {
    ui.soundBtn.setAttribute('aria-pressed', String(audio.playing));
    ui.soundBtn.setAttribute('aria-label', audio.playing ? 'Disattiva suono' : 'Attiva suono');
}
ui.soundBtn.addEventListener('click', async () => {
    await audio.toggle();
    syncSoundBtn();
});

// === NAVIGAZIONE ===
let currentPoint = 0;
let busy = true; // sbloccato a fine intro
let hintHidden = false;
let queued = null; // un input ricevuto durante la transizione viene eseguito subito dopo

let offChapter = false; // true quando lo show ha portato la camera fuori dalle pose dei capitoli

let revealCall = null;
function scheduleReveal(index, delay) {
    revealCall?.kill();
    revealCall = gsap.delayedCall(delay, () => revealChapter(index));
}
function scheduleCaption(caption, delay) {
    revealCall?.kill();
    revealCall = gsap.delayedCall(delay, () => revealCaption(caption));
}

function hideScrollHint() {
    if (hintHidden) return;
    hintHidden = true;
    gsap.to(ui.scrollHint, { autoAlpha: 0, duration: 1 });
}

// Spostamento verso un capitolo (usato sia dalla navigazione sia dallo show)
function travel(index, { duration = TRANSITION, mood = null, idle = 1 } = {}) {
    return new Promise((resolve) => {
        busy = true;
        const moving = index !== currentPoint || offChapter;
        offChapter = false;
        currentPoint = index;
        freezeIdle();
        chapterOut();
        const done = () => {
            busy = false;
            startIdle(idle);
            resolve();
        };
        if (moving) {
            // Respiro della focale: sale e torna a zero, da qualunque valore parta
            gsap.to(lens, {
                keyframes: [
                    { breath: reducedMotion ? 0 : 6, duration: duration / 2, ease: 'sine.inOut' },
                    { breath: 0, duration: duration / 2, ease: 'sine.inOut' },
                ],
                overwrite: 'auto',
            });
            arcTo(cameraPoints[index], duration).eventCallback('onComplete', done);
        } else {
            gsap.delayedCall(duration, done);
        }
        const moodName = mood ?? (moodMode === 'auto' ? cameraPoints[index].lighting : null);
        if (moodName) setAtmosphere(moodName, duration);
        scheduleReveal(index, moving ? duration * 0.5 : 1.1);
    });
}

function gotoPoint(index) {
    if (show) { exitShow(); return; }
    if (index === currentPoint || index < 0 || index >= cameraPoints.length) return;
    if (busy) { queued = index; return; }
    hideScrollHint();
    travel(index).then(() => {
        if (queued === null) return;
        const next = queued;
        queued = null;
        gotoPoint(next);
    });
}

// === SHOW CINEMATOGRAFICO (loop ~5 min) ===
// Capitoli alternati a riprese da drone (gru, orbite, sorvoli, scansione 3D): vedi showSequence.js
const SHOW_TRAVEL = reducedMotion ? 1.5 : 7;
const chromeEls = ['.topbar', '.chapter-nav', '.bottombar'];
let show = null;

ui.showProgress.innerHTML = SHOW_SEQUENCE.map(() => '<span><i></i></span>').join('');
const showSegments = [...ui.showProgress.querySelectorAll('i')];
const wait = (seconds, token) => new Promise((resolve) => token.calls.push(gsap.delayedCall(seconds, resolve)));
const track = (token, tween) => { token.calls.push(tween); return tween; };

// Mirino del drone: visibile nelle riprese aeree, aggiornato nel render loop
const droneHud = {
    el: $('.drone-hud'),
    time: $('.hud-time'),
    coords: $('.hud-coords'),
    alt: $('.hud-alt'),
    hdg: $('.hud-hdg'),
    scan: $('.hud-scan'),
    scanValue: $('.hud-scan b'),
    scanBar: $('.hud-scan em i'),
    on: false,
    started: 0,
    lastUpdate: 0,
};
function setDroneHud(on) {
    droneHud.on = on;
    document.body.classList.toggle('is-drone', on);
    gsap.to(droneHud.el, { autoAlpha: on ? 1 : 0, duration: on ? 1.6 : 0.8, ease: 'power2.inOut', overwrite: 'auto' });
}

// Scansione 3D: la linea sale dalla base alla cima della basilica
function runScan(duration, token) {
    gsap.to(droneHud.scan, { opacity: 1, duration: 1 });
    track(token, gsap.timeline()
        .to(scanUniforms.uScanMix, { value: 1, duration: 1.5, ease: 'sine.inOut' }, 0)
        .fromTo(scanUniforms.uScanY, { value: -2 }, { value: 72, duration: duration * 0.78, ease: 'sine.inOut' }, 0.5)
        .to(scanUniforms.uScanMix, { value: 0, duration: 2.5, ease: 'sine.inOut' }, duration * 0.78 + 0.8)
        .to(droneHud.scan, { opacity: 0, duration: 1 }, duration * 0.78 + 1.5));
}
function stopScan() {
    gsap.to(scanUniforms.uScanMix, { value: 0, duration: 1.2, overwrite: 'auto' });
    gsap.to(droneHud.scan, { opacity: 0, duration: 0.6, overwrite: 'auto' });
}

async function playChapterShot(shot, token) {
    setDroneHud(false);
    const duration = shot.travel ?? (shot.chapter === currentPoint && !offChapter ? 3.5 : SHOW_TRAVEL);
    await travel(shot.chapter, { duration, mood: shot.mood, idle: 1.6 });
    return shot.hold;
}

async function playPathShot(shot, token) {
    busy = true;
    offChapter = true;
    freezeIdle();
    chapterOut();
    const enter = reducedMotion ? 0.1 : shot.enter ?? 6;
    setAtmosphere(shot.mood, Math.max(enter, 3));
    setDroneHud(!!shot.drone);
    gsap.to(lens, { breath: shot.fov ?? 0, duration: Math.max(enter, 3), ease: 'sine.inOut', overwrite: 'auto' });
    if (shot.caption) scheduleCaption(shot.caption, enter * 0.6 + 0.6);

    const startPos = new THREE.Vector3();
    const startTarget = new THREE.Vector3();
    shot.pose(0, startPos, startTarget);
    await new Promise((resolve) => {
        track(token, arcTo({ position: startPos, target: startTarget }, enter)).eventCallback('onComplete', resolve);
    });
    if (show !== token) return 0;

    if (shot.scan) runScan(shot.duration, token);
    // Senza caption la ripresa resta "pulita": si nasconde il testo precedente
    if (!shot.caption) chapterOut();
    const state = { t: 0 };
    track(token, gsap.to(state, {
        t: 1,
        duration: shot.duration,
        ease: shot.ease ?? 'sine.inOut',
        onUpdate: () => shot.pose(state.t, rig.basePos, rig.target),
        onComplete: () => { busy = false; },
    }));
    // La barra avanza durante la ripresa; il resto dell'attesa è la ripresa stessa
    return shot.duration;
}

async function startShow() {
    if (show || busy) return;
    const token = { calls: [] };
    show = token;
    queued = null;
    hideScrollHint();
    document.body.classList.add('is-show');
    droneHud.started = clock.elapsedTime;
    gsap.to(chromeEls, { autoAlpha: 0, duration: 1.2, ease: 'power2.inOut' });
    gsap.to(ui.showHud, { autoAlpha: 1, duration: 1.4, delay: 1.2 });
    if (!audio.playing) {
        await audio.play();
        syncSoundBtn();
    }

    // Loop continuo finché l'utente non esce
    while (show === token) {
        gsap.set(showSegments, { scaleX: 0 });
        for (let i = 0; i < SHOW_SEQUENCE.length; i++) {
            if (show !== token) return;
            const shot = SHOW_SEQUENCE[i];
            const hold = shot.type === 'chapter' ? await playChapterShot(shot, token) : await playPathShot(shot, token);
            if (show !== token) return;
            track(token, gsap.to(showSegments[i], { scaleX: 1, duration: hold, ease: 'none' }));
            await wait(hold, token);
        }
    }
}

function exitShow() {
    const token = show;
    if (!token) return;
    show = null;
    token.calls.forEach((c) => c.kill());
    document.body.classList.remove('is-show');
    gsap.to(ui.showHud, { autoAlpha: 0, duration: 0.8 });
    gsap.to(chromeEls, { autoAlpha: 1, duration: 1.4, delay: 0.6, ease: 'power2.out' });
    setDroneHud(false);
    stopScan();
    gsap.to(lens, { breath: 0, duration: 2.5, ease: 'sine.inOut', overwrite: 'auto' });
    setAtmosphere(currentMoodName(), 3);
    if (offChapter) {
        // Interrotto durante una ripresa aerea: si torna con calma al capitolo corrente
        busy = false;
        travel(currentPoint, { duration: 5 });
    } else {
        chapterOut();
        scheduleReveal(currentPoint, 1.1);
    }
}

ui.showCta.addEventListener('click', startShow);
ui.showExit.addEventListener('click', exitShow);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitShow(); });

const step = (dir) => gotoPoint((busy && queued !== null ? queued : currentPoint) + dir);
ui.arrows.forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.dir))));
navItems.forEach((b) => b.addEventListener('click', () => gotoPoint(Number(b.dataset.index))));

let wheelAccum = 0;
let wheelReset;
window.addEventListener('wheel', (e) => {
    if (debugEnabled || (busy && queued !== null && !show)) return;
    wheelAccum += e.deltaY;
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => { wheelAccum = 0; }, 180);
    if (Math.abs(wheelAccum) > 40) {
        step(Math.sign(wheelAccum));
        wheelAccum = 0;
    }
}, { passive: true });

window.addEventListener('keydown', (e) => {
    if (debugEnabled) return;
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
});

let touchStart = null;
window.addEventListener('touchstart', (e) => {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
window.addEventListener('touchend', (e) => {
    if (!touchStart || debugEnabled) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
    if (Math.abs(d) > 50) step(d < 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    rig.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
});

// === CARICAMENTO + INTRO ===
// Uscita del loader: lettere che salgono, orizzonte dorato che si apre, sipario che si divide
function loaderExit() {
    const q = (s) => ui.loader.querySelector(s);
    const fading = [q('.loader-powered'), q('.loader-foot'), ...ui.loader.querySelectorAll('.loader-corner')];
    // Le animazioni CSS d'ingresso (fill: both) vincerebbero sui tween: si spengono fissando lo stato finale
    fading.forEach((el) => { el.style.animation = 'none'; });
    // Le lettere SVG escono con transizioni CSS (transform-box: fill-box), sfalsate come in entrata
    ui.loaderPaths.forEach((p, i) => {
        p.style.animation = 'none';
        p.style.transform = 'translateY(0)';
        p.getBoundingClientRect();
        p.style.transition = `transform 1.1s cubic-bezier(0.7, 0, 0.84, 0) ${0.3 + i * 0.06}s`;
        p.style.transform = 'translateY(-130%)';
    });
    return gsap.timeline({ onComplete: () => ui.loader.classList.add('is-gone') })
        .to(fading,
            { opacity: 0, filter: 'blur(8px)', duration: 0.9, ease: 'power2.in', stagger: 0.08 }, 0.2)
        .to(q('.loader-sheen'), { opacity: 0, duration: 0.4 }, 0.2)
        .fromTo(q('.loader-seam'), { scaleX: 0, opacity: 1 }, { scaleX: 1, duration: 1.4, ease: 'expo.inOut' }, 1.1)
        .to(q('.curtain--top'), { yPercent: -100, duration: 2.6, ease: 'expo.inOut' }, 2.2)
        .to(q('.curtain--bottom'), { yPercent: 100, duration: 2.6, ease: 'expo.inOut' }, 2.2)
        .to(q('.loader-seam'), { opacity: 0, scaleX: 1.2, duration: 1.6, ease: 'power2.out' }, 2.5);
}

function intro({ basilica, cityPoints, cityEdges, heightfield: hf }) {
    heightfield = hf;
    basilica.traverse((o) => { if (o.isMesh) basilicaMaterials.push(o.material); });
    scene.add(createCityEdges(cityEdges), createCityPoints(cityPoints), createMotes(), createRain());
    shadowsDirtyUntil = clock.elapsedTime + 8; // ombre vive durante i fade-in
    setAtmosphere(cameraPoints[0].lighting, 0.01);

    const tl = gsap.timeline({ delay: 0.5 });
    tl.add(loaderExit(), 0);
    fadeInModel(basilica, 4200, 1800);
    // La luce "sorge": l'esposizione parte dal buio mentre il sipario si apre
    tl.fromTo(renderer, { toneMappingExposure: 0.05 }, {
        toneMappingExposure: MOODS[cameraPoints[0].lighting].exposure, duration: 5, ease: 'sine.inOut',
    }, 2);
    // La città si accende a onda dal centro verso l'esterno
    tl.to(atmosphereUniforms.uReveal, { value: 1, duration: reducedMotion ? 0.1 : 10, ease: 'sine.inOut' }, 2.4);
    tl.to(rig.basePos, {
        x: cameraPoints[0].position.x,
        y: cameraPoints[0].position.y,
        z: cameraPoints[0].position.z,
        duration: reducedMotion ? 0.1 : 7.5,
        ease: EASE_CAMERA,
    }, 1.8);
    tl.set('.topbar, .chapter-nav, .bottombar', { opacity: 1 }, 5.4);
    tl.fromTo(ui.topbarItems, { opacity: 0, y: -14, filter: 'blur(6px)' }, {
        opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.8, ease: 'power3.out', stagger: 0.15,
    }, 5.4);
    tl.fromTo(navItems, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 1.6, ease: 'power3.out', stagger: 0.09 }, 5.9);
    tl.fromTo(['.show-cta', '.arrow-btn'], { opacity: 0, y: 14 }, {
        opacity: 1, y: 0, duration: 1.6, ease: 'power3.out', stagger: 0.12, clearProps: 'opacity,transform',
    }, 6);
    tl.fromTo(ui.scrollHint, { opacity: 0 }, { opacity: 1, duration: 2 }, 7.4);
    tl.call(() => revealChapter(0), null, 5.8);
    tl.call(() => { busy = false; placeMoodIndicator(); startIdle(); }, null, 9);
}

setupModelLoader(scene)
    .then(intro)
    .catch((error) => {
        console.error('Errore caricamento modello:', error);
        ui.loader.classList.add('loader-error');
        ui.loaderLabel.textContent = 'Impossibile caricare il modello — ricarica la pagina';
    });

// === RESIZE ===
function resize() {
    updateLens();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    placeMoodIndicator();
}
window.addEventListener('resize', resize);

// === RISOLUZIONE ADATTIVA ===
// Se il frame rate scende, riduce il pixel ratio a gradini; risale solo dopo più finestre stabili.
const perf = { acc: 0, frames: 0, dpr: maxDpr, good: 0 };
function setDpr(dpr) {
    perf.dpr = THREE.MathUtils.clamp(dpr, 1, maxDpr);
    renderer.setPixelRatio(perf.dpr);
    composer.setPixelRatio(perf.dpr);
    resize();
}
function adaptResolution(dt) {
    perf.acc += dt;
    perf.frames++;
    if (perf.acc < 2) return;
    const avg = perf.acc / perf.frames;
    perf.acc = 0;
    perf.frames = 0;
    if (avg > 1 / 40 && perf.dpr > 1) { perf.good = 0; setDpr(perf.dpr - 0.25); }
    else if (avg < 1 / 57 && perf.dpr < maxDpr && ++perf.good >= 3) { perf.good = 0; setDpr(perf.dpr + 0.25); }
}

// Telemetria del mirino: quota, rotta e coordinate reali derivate dalla posizione della camera
// (asse -z = nord, +x = est; origine sulla basilica).
const ORIGIN = { lat: 45.70336, lon: 9.6625 };
const _dir = new THREE.Vector3();
function updateDroneHud(t) {
    droneHud.lastUpdate = t;
    const p = camera.position;
    const lat = ORIGIN.lat - p.z / 111320;
    const lon = ORIGIN.lon + p.x / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
    camera.getWorldDirection(_dir);
    const hdg = (THREE.MathUtils.radToDeg(Math.atan2(_dir.x, -_dir.z)) + 360) % 360;
    const elapsed = Math.max(0, t - droneHud.started);
    droneHud.time.textContent = `${pad(Math.floor(elapsed / 60))}:${pad(Math.floor(elapsed % 60))}`;
    droneHud.coords.textContent = `${lat.toFixed(5)}° N · ${lon.toFixed(5)}° E`;
    droneHud.alt.textContent = `ALT ${String(Math.round(p.y)).padStart(3, '0')} m`;
    droneHud.hdg.textContent = `HDG ${String(Math.round(hdg)).padStart(3, '0')}°`;
    const scan = THREE.MathUtils.clamp((scanUniforms.uScanY.value + 2) / 74, 0, 1);
    droneHud.scanValue.textContent = `${String(Math.round(scan * 100)).padStart(3, '0')}%`;
    droneHud.scanBar.style.setProperty('--scan', scan.toFixed(3));
}

// === RENDER LOOP ===
const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    atmosphereUniforms.uTime.value = t;
    atmosphereUniforms.uPixelRatio.value = renderer.getPixelRatio();
    if (t < shadowsDirtyUntil) renderer.shadowMap.needsUpdate = true;
    lighting.flashLight.intensity = atmosphereUniforms.uFlash.value * 1.6;
    fogPass.uniforms.uSunDir.value.subVectors(lighting.sunLight.position, lighting.sunLight.target.position).normalize();
    fogPass.uniforms.uSunColor.value.copy(lighting.sunLight.color);

    if (camera.fov !== lens.base + lens.breath) {
        camera.fov = lens.base + lens.breath;
        camera.updateProjectionMatrix();
    }

    if (debugEnabled) {
        debugSystem.controls.update();
        debugSystem.update({ camera, target: debugSystem.controls.target, lighting, deltaTime: dt, renderer });
    } else {
        idlePose(t, _pos, _tgt);
        rig.pointerSmooth.lerp(rig.pointer, 0.025);
        const driftX = reducedMotion ? 0 : Math.sin(t * 0.13) * 0.6 + rig.pointerSmooth.x * 2;
        const driftY = reducedMotion ? 0 : Math.sin(t * 0.17) * 0.35 - rig.pointerSmooth.y * 1.1;
        camera.position.copy(_pos);
        camera.lookAt(_tgt);
        camera.translateX(driftX);
        camera.translateY(driftY);
        // Rete di sicurezza: la camera non scende mai dentro tetti o terreno
        const minY = heightfield ? heightfield.heightAt(camera.position.x, camera.position.z, 3) + CAMERA_CLEARANCE : -Infinity;
        if (camera.position.y < minY) camera.position.y = minY;
        camera.lookAt(_tgt);
    }

    if (droneHud.on && t - droneHud.lastUpdate > 0.1) updateDroneHud(t);

    composer.render(dt);
    adaptResolution(dt);
});

export { scene, camera, renderer };

// Solo sviluppo: accesso alla scena per ispezioni e screenshot automatici
if (import.meta.env.DEV) window.__skycrab = { THREE, scene, camera, renderer, composer, rig, cameraPoints, scanUniforms, setAtmosphere };
