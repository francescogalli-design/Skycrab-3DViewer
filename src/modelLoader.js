// modelLoader.js
// Carica il modello ottimizzato (GLB meshopt + texture 4K JPG) con progresso reale in byte.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { gsap } from 'gsap';
import { applyScanEffect } from './atmosphere.js';

const ASSETS = {
    model: '/models/opt/cattedrale.glb',
    diffuse: '/models/opt/cattedrale_diffuse.jpg',
    normal: '/models/opt/cattedrale_normal.jpg',
    cityPoints: '/models/opt/city_points.bin',
    cityEdges: '/models/opt/city_edges.bin',
    heightfield: '/models/opt/heightfield.bin',
    ground: '/models/opt/ground.bin',
};

// Peso approssimativo usato finché il server non comunica il Content-Length
const FALLBACK_BYTES = { model: 17e6, diffuse: 6.3e6, normal: 6.9e6, cityPoints: 5.6e6, cityEdges: 0.7e6, heightfield: 0.46e6, ground: 0.5e6 };

async function fetchWithProgress(url, onBytes) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body) {
        const buf = await res.arrayBuffer();
        onBytes(buf.byteLength, buf.byteLength);
        return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onBytes(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    return out.buffer;
}

function textureFromBuffer(buffer, colorSpace) {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, (tex) => {
            URL.revokeObjectURL(url);
            tex.colorSpace = colorSpace;
            tex.anisotropy = 8;
            resolve(tex);
        }, undefined, reject);
    });
}

/**
 * @param {THREE.Scene} scene
 * @param {(progress: number) => void} onProgress valore 0..1
 */
export async function setupModelLoader(scene, onProgress = () => {}) {
    const state = Object.fromEntries(Object.keys(ASSETS).map((k) => [k, { loaded: 0, total: FALLBACK_BYTES[k] }]));
    const report = () => {
        const loaded = Object.values(state).reduce((s, v) => s + v.loaded, 0);
        const total = Object.values(state).reduce((s, v) => s + v.total, 0);
        onProgress(Math.min(loaded / total, 0.99));
    };
    const track = (key) => (loaded, total) => {
        state[key].loaded = loaded;
        if (total) state[key].total = total;
        report();
    };

    const [modelBuf, diffuseBuf, normalBuf, cityPointsBuf, cityEdgesBuf, heightBuf, groundBuf] = await Promise.all(
        Object.entries(ASSETS).map(([key, url]) => fetchWithProgress(url, track(key))),
    );

    const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [diffuseMap, normalMap, gltf] = await Promise.all([
        textureFromBuffer(diffuseBuf, THREE.SRGBColorSpace),
        textureFromBuffer(normalBuf, THREE.NoColorSpace),
        gltfLoader.parseAsync(modelBuf, ''),
    ]);

    // Le UV arrivano dall'FBX originale (convenzione OpenGL): le texture restano con flipY = true.
    // Scala, rotazione e appoggio al suolo identici alla vecchia pipeline: i cameraPoints restano validi.
    const model = new THREE.Group();
    model.add(gltf.scene);
    gltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({
            map: diffuseMap,
            normalMap,
            roughness: 0.78,
            metalness: 0.0,
            transparent: true,
            opacity: 0,
        });
        applyScanEffect(child.material);
        child.castShadow = true;
        child.receiveShadow = true;
    });

    model.scale.setScalar(0.01);
    model.rotation.y = THREE.MathUtils.degToRad(140);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.position.y -= box.min.y;

    scene.add(model);
    onProgress(1);
    return {
        model,
        basilica: gltf.scene,
        cityPoints: cityPointsBuf,
        cityEdges: cityEdgesBuf,
        heightfield: parseHeightfield(heightBuf),
        ground: groundBuf,
    };
}

// Heightfield in coordinate mondo: griglia 480x480 a 1 m, origine (-240, -240), Int16 in cm.
// Massimo tra basilica e città: usato per tenere la camera fuori dagli edifici e sopra il suolo.
function parseHeightfield(buffer) {
    const n = 480, x0 = -240, z0 = -240;
    const data = new Int16Array(buffer);
    const sample = (gx, gz) => (gx < 0 || gz < 0 || gx >= n || gz >= n ? 0 : data[gz * n + gx] / 100);
    return {
        // Altezza massima in un intorno di raggio r metri
        heightAt(x, z, r = 2) {
            const gx = Math.floor(x - x0), gz = Math.floor(z - z0);
            let h = -Infinity;
            for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) h = Math.max(h, sample(gx + dx, gz + dz));
            return h;
        },
    };
}

export function fadeInModel(model, duration = 2000, delay = 0) {
    model.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        mat.transparent = true;
        mat.opacity = 0;
        gsap.to(mat, {
            opacity: 1,
            duration: duration / 1000,
            delay: delay / 1000,
            ease: 'power2.out',
            // Opaco a fine fade: niente artefatti di ordinamento delle trasparenze
            onComplete: () => { mat.transparent = false; mat.needsUpdate = true; },
        });
    });
}
