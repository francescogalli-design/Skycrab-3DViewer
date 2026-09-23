// atmosphere.js
// Contesto urbano come nuvola di punti + profili architettonici, pulviscolo e nebbia volumetrica.
// Tutto animato su GPU tramite uniform: nessun lavoro per-vertice sulla CPU.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const CENTER = new THREE.Vector2(-4, -4);

// Uniform condivisi da tutti gli strati: un solo tween per cambiare atmosfera
export const atmosphereUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uReveal: { value: 0 },
    uNight: { value: 0 },
    uPointColor: { value: new THREE.Color(0.78, 0.74, 0.66) },
    uWarm: { value: new THREE.Color(1.0, 0.62, 0.28) },
    uCenter: { value: CENTER },
    uRain: { value: 0 },          // 0..1 intensità pioggia
    uFlash: { value: 0 },         // lampo in corso (0 = nessuno)
    uWind: { value: new THREE.Vector2(6, 2.5) },
};

// Fotogrammetria da drone: la ricostruzione segue la spirale di volo (coordinate "in giri")
export const scanUniforms = {
    uScanMix: { value: 0 },
    uScanU: { value: -1 },                       // avanzamento del drone lungo la spirale, in giri
    uScanTurns: { value: 2.5 },
    uScanStartAz: { value: 0 },
    uScanCenter: { value: new THREE.Vector2(-4, -4) },
    uDronePos: { value: new THREE.Vector3(0, 100, 0) },
    uDroneDir: { value: new THREE.Vector3(0, -1, 0) },
    uShutter: { value: 0 },                      // impulso a ogni scatto
};

/**
 * Effetto "fotogrammetria" sul materiale della basilica, in tre stati per frammento:
 * non ancora ripreso → nuvola sparsa di tie point; appena ripreso → maglia della mesh che svanisce;
 * ricostruito → texture finale. Il fronte di ricostruzione avanza con il drone lungo un'elica,
 * e l'impronta della camera del drone si illumina a ogni scatto.
 */
export function applyScanEffect(material) {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, scanUniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorld;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvScanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec3 vScanWorld;
                uniform float uScanMix, uScanU, uScanTurns, uScanStartAz, uShutter;
                uniform vec2 uScanCenter;
                uniform vec3 uDronePos, uDroneDir;`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                if (uScanMix > 0.001) {
                    vec3 p = vScanWorld;
                    vec2 d = p.xz - uScanCenter;
                    float f = fract((atan(d.x, d.y) - uScanStartAz) / 6.2831853);
                    float s = clamp(1.0 - p.y / 70.0, 0.0, 1.0);
                    float age = uScanU - (s * uScanTurns + f - 0.5);
                    float covered = smoothstep(0.0, 0.06, age);

                    vec3 tech = vec3(0.84, 0.92, 1.0);
                    vec3 albedo = gl_FragColor.rgb;
                    // nuvola sparsa colorata come le foto (stile DJI Terra): un punto per cella di 80 cm,
                    // attenuata quando le celle diventano più piccole di pochi pixel
                    float cellPx = 1.0 / max(length(fwidth(p * 1.25)), 1e-4);
                    vec3 cell = floor(p * 1.25);
                    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                    float pt = (1.0 - smoothstep(0.1, 0.2, length(fract(p * 1.25) - 0.5))) * step(0.45, h);
                    pt *= smoothstep(2.5, 7.0, cellPx);
                    vec3 pending = albedo * 0.025 + albedo * pt * 1.35;

                    // maglia della mesh appena calcolata (linee antialias, svanisce presto e da lontano)
                    vec3 gp = p * 0.75;
                    vec3 g = abs(fract(gp) - 0.5) / max(fwidth(gp), vec3(1e-4));
                    float wire = 1.0 - clamp(min(min(g.x, g.y), g.z) - 0.5, 0.0, 1.0);
                    wire *= smoothstep(3.0, 9.0, 1.0 / max(length(fwidth(gp)), 1e-4));
                    float fresh = covered * (1.0 - smoothstep(0.03, 0.32, age));
                    vec3 built = mix(albedo, albedo * 0.55 + tech * wire * 0.28, fresh * 0.8);

                    vec3 col = mix(pending, built, covered);
                    col += vec3(0.96, 0.8, 0.52) * exp(-pow(age / 0.03, 2.0)) * 0.55;

                    // impronta della camera: appena percettibile, un lampo leggero a ogni scatto
                    float cone = smoothstep(0.86, 0.885, dot(normalize(p - uDronePos), uDroneDir));
                    col += albedo * cone * (0.08 + uShutter * 0.35);

                    gl_FragColor.rgb = mix(gl_FragColor.rgb, col, uScanMix);
                }`);
    };
    material.customProgramCacheKey = () => 'basilica-photogrammetry';
}

// Header: min xyz, max xyz (float32), count (uint32); poi record quantizzati uint16
function readQuantized(buffer, stride) {
    const view = new DataView(buffer);
    const min = [0, 1, 2].map((i) => view.getFloat32(i * 4, true));
    const max = [0, 1, 2].map((i) => view.getFloat32(12 + i * 4, true));
    const count = view.getUint32(24, true);
    const positions = new Float32Array(count * 3);
    const bytes = new Uint8Array(buffer, 28);
    for (let i = 0; i < count; i++) {
        const o = i * stride;
        for (let q = 0; q < 3; q++) {
            const u = bytes[o + q * 2] | (bytes[o + q * 2 + 1] << 8);
            positions[i * 3 + q] = min[q] + (u / 65535) * (max[q] - min[q]);
        }
    }
    return { positions, bytes, count };
}

const radialFadeGLSL = /* glsl */ `
    float radialFade(vec3 p) {
        return 1.0 - smoothstep(55.0, 360.0, length(p.xz - uCenter));
    }
    // L'onda di "scansione" che si espande lentamente dalla basilica
    float scanWave(vec3 p) {
        float d = length(p.xz - uCenter);
        float front = mod(uTime * 7.0, 460.0) - 30.0;
        return exp(-pow((d - front) / 7.0, 2.0)) * (1.0 - smoothstep(200.0, 420.0, d));
    }
`;

export function createCityPoints(buffer) {
    const { positions, bytes, count } = readQuantized(buffer, 8);
    const meta = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        meta[i * 2] = bytes[i * 8 + 6] / 255;
        meta[i * 2 + 1] = bytes[i * 8 + 7] / 255;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));

    const material = new THREE.ShaderMaterial({
        uniforms: atmosphereUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            uniform float uTime, uPixelRatio, uReveal, uNight;
            uniform vec3 uPointColor, uWarm;
            uniform vec2 uCenter;
            attribute vec2 aMeta;
            varying vec3 vColor;
            varying float vAlpha;
            ${radialFadeGLSL}
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                float camDist = -mv.z;
                float shade = aMeta.x;       // 1 = superfici orizzontali (tetti, strade)
                float rnd = aMeta.y;
                float dist = length(position.xz - uCenter);

                // Rivelazione iniziale: i punti si accendono a onda dal centro verso l'esterno
                float reveal = smoothstep(dist - 40.0, dist, uReveal * 460.0);
                float twinkle = 0.78 + 0.22 * sin(uTime * (0.25 + rnd * 0.35) + rnd * 40.0);
                float nearFade = smoothstep(5.0, 32.0, camDist);
                float radial = radialFade(position);

                float lamp = uNight * step(0.9972, rnd) * step(0.6, shade);
                vColor = mix(uPointColor, uWarm, lamp);
                vAlpha = reveal * nearFade * radial * ((0.25 + 0.6 * shade) * twinkle * 0.7
                        + scanWave(position) * 0.9 + lamp * 2.4);

                gl_PointSize = clamp((1.1 + lamp * 3.0) * uPixelRatio * 70.0 / camDist, 0.6, 9.0 * uPixelRatio);
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.05, d) * vAlpha;
                if (a < 0.002) discard;
                gl_FragColor = vec4(vColor * a, a);
            }
        `,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    return points;
}

export function createCityEdges(buffer) {
    const { positions } = readQuantized(buffer, 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.ShaderMaterial({
        uniforms: atmosphereUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            uniform float uTime, uReveal;
            uniform vec2 uCenter;
            varying float vAlpha;
            ${radialFadeGLSL}
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                float dist = length(position.xz - uCenter);
                float reveal = smoothstep(dist - 60.0, dist, uReveal * 460.0 - 40.0);
                float radial = 1.0 - smoothstep(40.0, 210.0, dist);
                vAlpha = reveal * radial * smoothstep(6.0, 40.0, -mv.z) * (0.075 + scanWave(position) * 0.4);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uPointColor;
            varying float vAlpha;
            void main() { gl_FragColor = vec4(mix(uPointColor, vec3(0.79, 0.66, 0.38), 0.35) * vAlpha, vAlpha); }
        `,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    return lines;
}

/**
 * Suolo di Città Alta e dintorni: griglia 500×500 a 3,2 m (±800 m), Int16 in cm, origine (-800, -800).
 * Coincide con strade e piazze della città e, sotto la basilica, con il piano della sua piazza:
 * il modello vi appoggia e ne riceve le ombre. Sfuma nel nero verso l'orizzonte.
 */
export function createGround(buffer) {
    const m = 500;
    const size = 1600;
    const cell = size / m;
    const heights = new Int16Array(buffer);
    const geometry = new THREE.PlaneGeometry(size, size, m - 1, m - 1);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i++) {
        const h = heights[i] / 100;
        pos.setY(i, h);
        lowest = Math.min(lowest, h);
    }
    geometry.computeVertexNormals();

    // Pietra scura con variazioni a grana larga e fine: le ombre della basilica restano leggibili
    const material = new THREE.MeshStandardMaterial({ color: 0x3b3834, roughness: 0.96, metalness: 0, envMapIntensity: 0.25 });
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec3 vGroundWorld;
                float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float gNoise(vec2 p) {
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                float gv = gNoise(vGroundWorld.xz * 0.05) * 0.55 + gNoise(vGroundWorld.xz * 0.6) * 0.3 + gNoise(vGroundWorld.xz * 3.0) * 0.15;
                diffuseColor.rgb *= 0.7 + gv * 0.6;`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                gl_FragColor.rgb *= mix(1.0, 0.18, smoothstep(40.0, 220.0, length(vGroundWorld.xz - vec2(-4.0, -4.0)))) * (1.0 - smoothstep(300.0, 760.0, length(vGroundWorld.xz - vec2(-4.0, -4.0))));`);
    };

    const group = new THREE.Group();
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    const outer = new THREE.Mesh(
        new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    outer.position.y = lowest - 2;
    group.add(terrain, outer);

    // Quota del suolo in un punto (bilineare): usata anche per tenere la camera sopra il terreno
    const sample = (gx, gz) => heights[Math.min(m - 1, Math.max(0, gz)) * m + Math.min(m - 1, Math.max(0, gx))] / 100;
    group.userData.heightAt = (x, z) => {
        const fx = (x + size / 2) / cell;
        const fz = (z + size / 2) / cell;
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        const tx = fx - ix;
        const tz = fz - iz;
        return (sample(ix, iz) * (1 - tx) + sample(ix + 1, iz) * tx) * (1 - tz)
            + (sample(ix, iz + 1) * (1 - tx) + sample(ix + 1, iz + 1) * tx) * tz;
    };
    return group;
}

// Pulviscolo sospeso: particelle lente che scendono e ondeggiano, animate interamente nel vertex shader
export function createMotes(count = 1600) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = CENTER.x + (Math.random() - 0.5) * 220;
        positions[i * 3 + 1] = Math.random() * 90;
        positions[i * 3 + 2] = CENTER.y + (Math.random() - 0.5) * 220;
        seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: atmosphereUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            uniform float uTime, uPixelRatio, uReveal;
            attribute float aSeed;
            varying float vAlpha;
            void main() {
                vec3 p = position;
                float t = uTime * (0.35 + aSeed * 0.4);
                p.y = mod(p.y - t, 90.0);
                p.x += sin(t * 0.21 + aSeed * 30.0) * 4.0;
                p.z += cos(t * 0.17 + aSeed * 20.0) * 4.0;
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                float d = -mv.z;
                vAlpha = uReveal * smoothstep(2.0, 10.0, d) * (1.0 - smoothstep(60.0, 160.0, d))
                       * smoothstep(0.0, 8.0, p.y) * (1.0 - smoothstep(75.0, 90.0, p.y)) * (0.25 + aSeed * 0.35);
                gl_PointSize = clamp(uPixelRatio * (40.0 + aSeed * 60.0) / d, 0.8, 22.0 * uPixelRatio);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uPointColor;
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = pow(smoothstep(0.5, 0.0, d), 2.0) * vAlpha;
                gl_FragColor = vec4(mix(vec3(1.0), uPointColor, 0.5) * a, a);
            }
        `,
    });
    const motes = new THREE.Points(geometry, material);
    motes.frustumCulled = false;
    motes.renderOrder = 3;
    return motes;
}

// Pioggia: gocce come segmenti allungati nella direzione di caduta, animate interamente su GPU.
// uRain fa comparire progressivamente le gocce (seed < uRain), così l'intensità cresce in modo naturale.
export function createRain(count = 26000) {
    const positions = new Float32Array(count * 2 * 3);
    const seeds = new Float32Array(count * 2);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        const x = CENTER.x + (Math.random() - 0.5) * 200;
        const y = Math.random() * 120;
        const z = CENTER.y + (Math.random() - 0.5) * 200;
        const seed = Math.random();
        for (let e = 0; e < 2; e++) {
            const k = i * 2 + e;
            positions.set([x, y, z], k * 3);
            seeds[k] = seed;
            ends[k] = e;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: atmosphereUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            uniform float uTime, uRain, uFlash;
            uniform vec2 uWind;
            attribute float aSeed, aEnd;
            varying float vAlpha;
            void main() {
                float speed = 34.0 + aSeed * 16.0;
                vec3 vel = normalize(vec3(uWind.x, -speed, uWind.y));
                vec3 p = position;
                float fall = uTime * speed + aSeed * 500.0;
                p.y = mod(position.y - fall, 120.0);
                // lo spostamento del vento segue la caduta
                p.xz += uWind * (120.0 - p.y) / speed;
                p -= vel * (1.6 + aSeed * 2.2) * aEnd;
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                float d = -mv.z;
                float visible = step(aSeed, uRain);
                vAlpha = visible * smoothstep(1.5, 6.0, d) * (1.0 - smoothstep(50.0, 170.0, d))
                       * (0.3 + aEnd * 0.22) * (1.0 + uFlash * 1.5);
            }
        `,
        fragmentShader: /* glsl */ `
            varying float vAlpha;
            void main() { gl_FragColor = vec4(vec3(0.72, 0.78, 0.9) * vAlpha, vAlpha); }
        `,
    });
    const rain = new THREE.LineSegments(geometry, material);
    rain.frustumCulled = false;
    rain.renderOrder = 4;
    return rain;
}

// Rumore 3D precalcolato (value noise tileabile) per la nebbia: una texture invece di hash per pixel
function createNoiseTexture(size = 64) {
    const lattice = new Float32Array(size * size * size).map(() => Math.random());
    const data = new Uint8Array(size * size * size);
    const L = (x, y, z) => lattice[((z & (size - 1)) * size + (y & (size - 1))) * size + (x & (size - 1))];
    const smooth = (t) => t * t * (3 - 2 * t);
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let v = 0, amp = 0.6, freq = 1 / 8, norm = 0;
        for (let o = 0; o < 3; o++) {
            const fx = x * freq, fy = y * freq, fz = z * freq;
            const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
            const tx = smooth(fx - ix), ty = smooth(fy - iy), tz = smooth(fz - iz);
            const p = size * freq;
            const g = (a, b, c) => L((ix + a) % p + 0, (iy + b) % p, (iz + c) % p);
            const lerp = (a, b, t) => a + (b - a) * t;
            const val = lerp(
                lerp(lerp(g(0, 0, 0), g(1, 0, 0), tx), lerp(g(0, 1, 0), g(1, 1, 0), tx), ty),
                lerp(lerp(g(0, 0, 1), g(1, 0, 1), tx), lerp(g(0, 1, 1), g(1, 1, 1), tx), ty),
                tz,
            );
            v += val * amp; norm += amp; amp *= 0.5; freq *= 2;
        }
        data[(z * size + y) * size + x] = Math.round((v / norm) * 255);
    }
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RedFormat;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Nebbia volumetrica in post-processing: ray-marching nel mondo ricostruito dal depth buffer.
 * Banchi di foschia bassi che scorrono lentamente tra i tetti, senza tagli sulle geometrie.
 */
export class FogPass extends Pass {
    constructor(camera) {
        super();
        this.camera = camera;
        this.uniforms = {
            tDiffuse: { value: null },
            tDepth: { value: null },
            tNoise: { value: createNoiseTexture() },
            uProjInv: { value: new THREE.Matrix4() },
            uCamWorld: { value: new THREE.Matrix4() },
            uCamPos: { value: new THREE.Vector3() },
            uFogColor: { value: new THREE.Color(0.16, 0.17, 0.19) },
            uDensity: { value: 0.0035 },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
            uSunGlow: { value: 0.25 },
            uFlash: atmosphereUniforms.uFlash,
            uTime: atmosphereUniforms.uTime,
            uReveal: atmosphereUniforms.uReveal,
            uCenter: atmosphereUniforms.uCenter,
        };
        this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
            `,
            fragmentShader: /* glsl */ `
                precision highp sampler3D;
                uniform sampler2D tDiffuse, tDepth;
                uniform sampler3D tNoise;
                uniform mat4 uProjInv, uCamWorld;
                uniform vec3 uCamPos, uFogColor, uSunDir, uSunColor;
                uniform float uDensity, uTime, uReveal, uSunGlow, uFlash;
                uniform vec2 uCenter;
                varying vec2 vUv;

                float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

                void main() {
                    vec4 col = texture2D(tDiffuse, vUv);
                    float depth = texture2D(tDepth, vUv).x;
                    vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                    view /= view.w;
                    vec3 world = (uCamWorld * vec4(view.xyz, 1.0)).xyz;
                    vec3 rd = world - uCamPos;
                    float len = length(rd);
                    rd /= len;
                    len = depth >= 1.0 ? 420.0 : min(len, 420.0);

                    // Diffusione in avanti (Henyey-Greenstein): la foschia si accende guardando verso il sole
                    float mu = dot(rd, uSunDir);
                    float g = 0.72;
                    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
                    vec3 inscatter = uFogColor + uSunColor * uSunGlow * phase + vec3(0.55, 0.62, 0.8) * uFlash * 0.35;

                    const int STEPS = 9;
                    float stepLen = len / float(STEPS);
                    float jitter = ign(gl_FragCoord.xy + fract(uTime) * 61.0);
                    float T = 1.0;
                    vec3 acc = vec3(0.0);
                    for (int i = 0; i < STEPS; i++) {
                        vec3 p = uCamPos + rd * stepLen * (float(i) + jitter);
                        float heightFall = exp(-max(p.y - 4.0, 0.0) / 16.0);
                        vec3 q = p * 0.006 + vec3(uTime * 0.0035, uTime * 0.001, uTime * 0.0022);
                        float n = texture(tNoise, q).r * 0.65 + texture(tNoise, q * 2.7 + 0.37).r * 0.35;
                        float banks = smoothstep(0.42, 0.78, n);
                        float radial = 1.0 - smoothstep(120.0, 400.0, length(p.xz - uCenter));
                        float dens = uDensity * heightFall * banks * radial * uReveal;
                        float a = 1.0 - exp(-dens * stepLen);
                        acc += T * a * inscatter;
                        T *= 1.0 - a;
                    }
                    gl_FragColor = vec4(col.rgb * T + acc, col.a);
                }
            `,
        }));
    }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.uniforms;
        u.tDiffuse.value = readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(this.camera.matrixWorld);
        u.uCamPos.value.setFromMatrixPosition(this.camera.matrixWorld);
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    dispose() {
        this.quad.dispose();
    }
}

/** Transizione di atmosfera: colore dei punti, nebbia, luci cittadine notturne, bloom. */
export function tweenAtmosphere(mood, { fogPass, bloomPass }, duration) {
    const ease = 'sine.inOut';
    const a = mood.atmosphere;
    const c = new THREE.Color(...a.point);
    gsap.to(atmosphereUniforms.uPointColor.value, { r: c.r, g: c.g, b: c.b, duration, ease });
    gsap.to(atmosphereUniforms.uNight, { value: a.night, duration, ease });
    gsap.to(atmosphereUniforms.uRain, { value: a.rain ?? 0, duration, ease });
    if (fogPass) {
        const f = new THREE.Color(...a.fog);
        gsap.to(fogPass.uniforms.uFogColor.value, { r: f.r, g: f.g, b: f.b, duration, ease });
        gsap.to(fogPass.uniforms.uDensity, { value: a.density, duration, ease });
        gsap.to(fogPass.uniforms.uSunGlow, { value: a.sunGlow ?? 0.25, duration, ease });
    }
    if (bloomPass) gsap.to(bloomPass, { strength: a.bloom, duration, ease });
}
