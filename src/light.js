import * as THREE from 'three';
import { gsap } from 'gsap';
import { tweenAtmosphere } from './atmosphere.js';

// Atmosfere: ogni capitolo del tour ne richiama una (cameraPoints[].lighting)
export const MOODS = {
    // Alba: sole radente rosato, foschia mattutina densa (usata nello show)
    dawn: {
        label: 'Alba',
        sun: { color: 0xffb996, intensity: 1.9, position: [-130, 22, 70] },
        ambient: { color: 0x9aa8cc, intensity: 0.34 },
        fill: { color: 0x5b6fa3, intensity: 0.5 },
        accent: { intensity: 0 },
        exposure: 0.92,
        envIntensity: 0.2,
        atmosphere: { point: [0.86, 0.74, 0.78], fog: [0.2, 0.2, 0.25], density: 0.0085, night: 0.08, bloom: 0.38, rain: 0, sunGlow: 1.1 },
    },
    day: {
        label: 'Giorno',
        sun: { color: 0xfff4e0, intensity: 2.6, position: [60, 140, 40] },
        ambient: { color: 0xffffff, intensity: 0.55 },
        fill: { color: 0x8aa4c8, intensity: 0.6 },
        accent: { intensity: 0 },
        exposure: 0.95,
        envIntensity: 0.35,
        // point: colore della nuvola urbana · fog: colore/densità della foschia · night: luci cittadine
        atmosphere: { point: [0.62, 0.6, 0.55], fog: [0.2, 0.21, 0.23], density: 0.0032, night: 0, bloom: 0.28, rain: 0, sunGlow: 0.3 },
    },
    sunset: {
        label: 'Tramonto',
        sun: { color: 0xff9a4d, intensity: 3.2, position: [140, 38, -30] },
        ambient: { color: 0xffd2b0, intensity: 0.28 },
        fill: { color: 0x3b4f8f, intensity: 0.7 },
        accent: { intensity: 0 },
        exposure: 0.9,
        envIntensity: 0.22,
        atmosphere: { point: [0.95, 0.66, 0.36], fog: [0.3, 0.18, 0.1], density: 0.0042, night: 0.35, bloom: 0.45, rain: 0, sunGlow: 1.3 },
    },
    // Temporale: luce fredda e piatta, pioggia fitta e lampi (usata nello show)
    storm: {
        label: 'Temporale',
        sun: { color: 0x8a96ab, intensity: 0.55, position: [30, 150, -40] },
        ambient: { color: 0x56617c, intensity: 0.3 },
        fill: { color: 0x2b3653, intensity: 0.5 },
        accent: { intensity: 0 },
        exposure: 0.88,
        envIntensity: 0.12,
        atmosphere: { point: [0.55, 0.6, 0.72], fog: [0.11, 0.12, 0.15], density: 0.0075, night: 0.45, bloom: 0.42, rain: 1, sunGlow: 0 },
    },
    night: {
        label: 'Notte',
        sun: { color: 0x9db4ff, intensity: 0.55, position: [-60, 120, 80] },
        ambient: { color: 0x3a4a7a, intensity: 0.18 },
        fill: { color: 0x1d2a55, intensity: 0.35 },
        accent: { intensity: 900 },
        exposure: 1.05,
        envIntensity: 0.06,
        atmosphere: { point: [0.42, 0.52, 0.82], fog: [0.07, 0.09, 0.16], density: 0.005, night: 1, bloom: 0.75, rain: 0, sunGlow: 0.15 },
    },
};

export function setupLighting(scene) {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sunLight.position.set(60, 140, 40);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -120;
    sunLight.shadow.camera.right = 120;
    sunLight.shadow.camera.top = 120;
    sunLight.shadow.camera.bottom = -120;
    sunLight.shadow.bias = -0.0002;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.radius = 3;
    sunLight.target.position.set(-4, 10, -4);
    scene.add(sunLight, sunLight.target);

    const fillLight = new THREE.DirectionalLight(0x8aa4c8, 0.6);
    fillLight.position.set(-80, 40, -60);
    scene.add(fillLight);

    // Illuminazione architetturale notturna: fari caldi dal basso verso le facciate
    const accentLights = [
        [55, 2, 35],
        [-30, 2, 30],
        [60, 2, -55],
        [-20, 2, -45],
    ].map(([x, y, z]) => {
        const spot = new THREE.SpotLight(0xffb36b, 0, 140, Math.PI / 5, 0.6, 1.6);
        spot.position.set(x, y, z);
        spot.target.position.set(-4, 30, -4);
        scene.add(spot, spot.target);
        return spot;
    });

    // Lampo: luce fredda senza ombre, pilotata dall'uniform uFlash
    const flashLight = new THREE.DirectionalLight(0xd6e2ff, 0);
    flashLight.position.set(-60, 160, 40);
    scene.add(flashLight);

    return { sunLight, ambientLight, fillLight, accentLights, flashLight };
}

/**
 * Transizione morbida verso un'atmosfera.
 */
export function applyMood(name, { lighting, renderer, scene, atmosphere }, duration = 4.5) {
    const mood = MOODS[name] ?? MOODS.day;
    const { sunLight, ambientLight, fillLight, accentLights } = lighting;
    const ease = 'sine.inOut';

    const tweenColor = (target, hex) => {
        const c = new THREE.Color(hex);
        gsap.to(target, { r: c.r, g: c.g, b: c.b, duration, ease });
    };

    tweenColor(sunLight.color, mood.sun.color);
    tweenColor(ambientLight.color, mood.ambient.color);
    tweenColor(fillLight.color, mood.fill.color);

    gsap.to(sunLight, { intensity: mood.sun.intensity, duration, ease });
    gsap.to(ambientLight, { intensity: mood.ambient.intensity, duration, ease });
    gsap.to(fillLight, { intensity: mood.fill.intensity, duration, ease });
    const [x, y, z] = mood.sun.position;
    gsap.to(sunLight.position, { x, y, z, duration, ease });

    accentLights.forEach((spot, i) => {
        gsap.to(spot, { intensity: mood.accent.intensity, duration, ease, delay: mood.accent.intensity ? i * 0.12 : 0 });
    });

    gsap.to(renderer, {
        toneMappingExposure: mood.exposure,
        duration,
        ease,
        onUpdate: () => { renderer.shadowMap.needsUpdate = true; },
        onComplete: () => { renderer.shadowMap.needsUpdate = true; },
    });
    if (scene) gsap.to(scene, { environmentIntensity: mood.envIntensity, duration, ease });
    if (atmosphere) tweenAtmosphere(mood, atmosphere, duration);
}
