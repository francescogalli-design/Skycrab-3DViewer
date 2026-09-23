// drone.js
// Drone per fotogrammetria: modello procedurale, cono della camera proiettato sull'edificio,
// e "rete di prese" (i fotogrammi già scattati) che si disegna lungo la spirale di volo.
import * as THREE from 'three';

const GREY = 0x5d6064;      // grigio Mavic
const DARK = 0x1c1d20;
const EDGE = 0xf4efe6;

// Braccio rastremato tra due punti (sezione ovale schiacciata)
function armBetween(a, b, rStart, rEnd, material) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(rEnd, rStart, len, 10, 1);
    geo.scale(1, 1, 0.55);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
}

// Pala d'elica: profilo sottile e affusolato, leggermente svergolato
function bladeGeometry(length) {
    const s = new THREE.Shape();
    s.moveTo(0, -0.006);
    s.bezierCurveTo(length * 0.3, -0.016, length * 0.75, -0.012, length, -0.003);
    s.lineTo(length, 0.003);
    s.bezierCurveTo(length * 0.7, 0.01, length * 0.3, 0.012, 0, 0.006);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.0015, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    return geo;
}

/**
 * Drone da rilievo modellato sulle proporzioni di un DJI Mavic 3 (347 × 283 × 107 mm aperto):
 * corpo affusolato, bracci anteriori alti e posteriori bassi, eliche bipala, doppia camera sul gimbal.
 * Scala "eroica" ×7 per leggerlo nelle riprese a distanza. Profili appena accennati da linee sottili.
 */
export function createDrone() {
    const drone = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.42, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.55, metalness: 0.25 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.04, metalness: 0.95, envMapIntensity: 1.6 });
    const edgeMat = new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.1, depthWrite: false });
    const withEdges = (mesh, angle = 32) => {
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), edgeMat));
        return mesh;
    };

    // Corpo: sagoma vista dall'alto (naso arrotondato, spalle larghe, coda rastremata), estrusa e smussata
    const outline = new THREE.Shape();
    outline.moveTo(0, 0.118);
    outline.bezierCurveTo(0.03, 0.118, 0.05, 0.1, 0.056, 0.06);
    outline.lineTo(0.05, -0.07);
    outline.bezierCurveTo(0.046, -0.105, 0.03, -0.118, 0, -0.118);
    outline.bezierCurveTo(-0.03, -0.118, -0.046, -0.105, -0.05, -0.07);
    outline.lineTo(-0.056, 0.06);
    outline.bezierCurveTo(-0.05, 0.1, -0.03, 0.118, 0, 0.118);
    const bodyGeo = new THREE.ExtrudeGeometry(outline, {
        depth: 0.05, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.012, bevelSegments: 5, curveSegments: 18,
    });
    bodyGeo.rotateX(Math.PI / 2);
    bodyGeo.translate(0, 0.045, 0);
    bodyGeo.computeVertexNormals();
    drone.add(withEdges(new THREE.Mesh(bodyGeo, shell)));

    // Dorso: carenatura superiore più scura con la batteria
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    top.scale.set(0.62, 0.2, 1.05);
    top.position.set(0, 0.06, -0.04);
    drone.add(top);

    // Bracci: anteriori più alti e aperti in avanti, posteriori più bassi e aperti all'indietro
    const motors = [
        { root: new THREE.Vector3(0.045, 0.03, 0.055), tip: new THREE.Vector3(0.152, 0.04, 0.118) },
        { root: new THREE.Vector3(-0.045, 0.03, 0.055), tip: new THREE.Vector3(-0.152, 0.04, 0.118) },
        { root: new THREE.Vector3(0.042, 0.005, -0.06), tip: new THREE.Vector3(0.14, 0.012, -0.112) },
        { root: new THREE.Vector3(-0.042, 0.005, -0.06), tip: new THREE.Vector3(-0.14, 0.012, -0.112) },
    ];
    const blades = [];
    const motorGeo = new THREE.CylinderGeometry(0.017, 0.019, 0.024, 20);
    const discGeo = new THREE.CircleGeometry(0.118, 48).rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.022, depthWrite: false, side: THREE.DoubleSide });
    const blade = bladeGeometry(0.118);
    motors.forEach(({ root, tip }, i) => {
        drone.add(withEdges(armBetween(root, tip, 0.012, 0.009, shell), 40));
        const hub = new THREE.Group();
        hub.position.copy(tip);
        hub.add(withEdges(new THREE.Mesh(motorGeo, dark), 40));
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.y = 0.016;
        hub.add(disc);
        const prop = new THREE.Group();
        prop.position.y = 0.016;
        const b1 = new THREE.Mesh(blade, dark);
        const b2 = new THREE.Mesh(blade, dark);
        b2.rotation.y = Math.PI;
        prop.add(b1, b2);
        prop.userData.dir = i % 3 === 0 ? 1 : -1;
        hub.add(prop);
        blades.push(prop);
        drone.add(hub);
    });

    // Gimbal a tre assi sotto il naso con doppia camera (grandangolo Hasselblad + tele)
    const gimbal = new THREE.Group();
    gimbal.position.set(0, -0.004, 0.118);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.008, 0.02), dark);
    yoke.position.set(0, 0.012, -0.008);
    const head = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.036, 0.04, 2, 2, 2), dark);
    const mainLens = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0135, 0.008, 28).rotateX(Math.PI / 2), glass);
    mainLens.position.set(-0.008, 0, 0.022);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0135, 0.0018, 8, 28), shell);
    ring.position.set(-0.008, 0, 0.0255);
    const tele = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 20).rotateX(Math.PI / 2), glass);
    tele.position.set(0.014, 0.004, 0.021);
    head.add(withEdges(housing, 40), mainLens, ring, tele);
    gimbal.add(yoke, head);
    drone.add(gimbal);

    // Sensori di visione (coppie frontali e posteriori)
    const sensorGeo = new THREE.CircleGeometry(0.006, 16);
    [[-0.018, 0.05, 0.128, 0], [0.018, 0.05, 0.128, 0], [-0.016, 0.05, -0.128, Math.PI], [0.016, 0.05, -0.128, Math.PI]].forEach(([x, y, z, ry]) => {
        const lensMesh = new THREE.Mesh(sensorGeo, glass);
        lensMesh.position.set(x, y, z);
        lensMesh.rotation.y = ry;
        drone.add(lensMesh);
    });

    // Luci di navigazione sotto i bracci (rosse davanti, verdi dietro)
    const ledGeo = new THREE.SphereGeometry(0.005, 8, 8);
    const leds = motors.map(({ tip }, i) => {
        const led = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: i < 2 ? 0xff453a : 0x30d158 }));
        led.position.set(tip.x, tip.y - 0.016, tip.z);
        drone.add(led);
        return led;
    });

    drone.scale.setScalar(7);
    drone.visible = false;

    // Cono della camera: piramide di linee dal drone all'edificio
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const cone = new THREE.LineSegments(coneGeo, new THREE.LineBasicMaterial({
        color: 0xdfeaff, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    cone.frustumCulled = false;
    cone.visible = false;

    const _fwd = new THREE.Vector3();
    const _right = new THREE.Vector3();
    const _up = new THREE.Vector3();
    const _c = new THREE.Vector3();
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    return {
        group: drone,
        cone,
        gimbal,
        /** Posa del drone: posizione e punto inquadrato dalla camera (gimbal). */
        setPose(pos, look, t) {
            drone.position.copy(pos);
            _fwd.subVectors(look, pos);
            const dist = _fwd.length();
            _fwd.normalize();
            // il drone punta la prua verso il soggetto, leggermente inclinato in avanti
            drone.rotation.set(0, Math.atan2(_fwd.x, _fwd.z), 0);
            drone.rotateX(0.08);
            gimbal.lookAt(look);
            blades.forEach((b) => { b.rotation.y = t * 70 * b.userData.dir; });
            const blink = (Math.floor(t * 2.2) % 2) === 0;
            leds.forEach((l, i) => { l.visible = i < 2 ? blink : !blink; });

            // piramide del campo visivo (hFov ~ 70°, 3:2) lunga fino al soggetto
            _right.crossVectors(_fwd, THREE.Object3D.DEFAULT_UP).normalize();
            _up.crossVectors(_right, _fwd).normalize();
            const len = Math.min(dist * 0.92, 60);
            const hw = Math.tan(THREE.MathUtils.degToRad(35)) * len;
            const hh = hw * 0.66;
            _c.copy(pos).addScaledVector(_fwd, len);
            corners[0].copy(_c).addScaledVector(_right, -hw).addScaledVector(_up, hh);
            corners[1].copy(_c).addScaledVector(_right, hw).addScaledVector(_up, hh);
            corners[2].copy(_c).addScaledVector(_right, hw).addScaledVector(_up, -hh);
            corners[3].copy(_c).addScaledVector(_right, -hw).addScaledVector(_up, -hh);
            const a = coneGeo.attributes.position.array;
            let k = 0;
            const put = (v) => { a[k++] = v.x; a[k++] = v.y; a[k++] = v.z; };
            corners.forEach((cn) => { put(pos); put(cn); });
            for (let i = 0; i < 4; i++) { put(corners[i]); put(corners[(i + 1) % 4]); }
            coneGeo.attributes.position.needsUpdate = true;
        },
        setVisible(v) {
            drone.visible = v;
            cone.visible = v;
        },
    };
}

/**
 * Rete delle prese fotografiche: ogni scatto lascia un piccolo fotogramma (rettangolo orientato)
 * nella posizione del drone. Tutto pre-allocato: si aggiorna solo il drawRange.
 */
export function createCaptureNetwork(max = 420) {
    const positions = new Float32Array(max * 8 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
        color: 0xc9a962, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.visible = false;
    let count = 0;

    const f = new THREE.Vector3();
    const r = new THREE.Vector3();
    const u = new THREE.Vector3();
    const q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    return {
        lines,
        reset() {
            count = 0;
            geo.setDrawRange(0, 0);
        },
        add(pos, look) {
            if (count >= max) return;
            f.subVectors(look, pos).normalize();
            r.crossVectors(f, THREE.Object3D.DEFAULT_UP).normalize();
            u.crossVectors(r, f).normalize();
            const w = 1.1;
            const h = 0.75;
            q[0].copy(pos).addScaledVector(r, -w).addScaledVector(u, h);
            q[1].copy(pos).addScaledVector(r, w).addScaledVector(u, h);
            q[2].copy(pos).addScaledVector(r, w).addScaledVector(u, -h);
            q[3].copy(pos).addScaledVector(r, -w).addScaledVector(u, -h);
            let k = count * 24;
            for (let i = 0; i < 4; i++) {
                const a = q[i];
                const b = q[(i + 1) % 4];
                positions[k++] = a.x; positions[k++] = a.y; positions[k++] = a.z;
                positions[k++] = b.x; positions[k++] = b.y; positions[k++] = b.z;
            }
            count++;
            geo.attributes.position.needsUpdate = true;
            geo.setDrawRange(0, count * 8);
        },
        get count() { return count; },
    };
}
