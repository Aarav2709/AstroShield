import * as THREE from '../vendor/three.module.js';

const AU_IN_KM = 149_597_870.7;
const SCALE_FACTOR = 1 / AU_IN_KM; // Convert kilometres into Astronomical Units for the scene
const MAX_PIXEL_RATIO = 2;

export default class OrbitalViz {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x02060d);

        const width = this.container.clientWidth || this.container.parentElement?.clientWidth || 640;
        const height = this.container.clientHeight || 420;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 6, 10);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);
    this._onResize();

        this.controls = null;
        this._initLights();
        this._initBodies();

    this.baselineOrbit = null;
    this.deflectedOrbit = null;
    this.asteroidMarker = null;

        this._animate = this._animate.bind(this);
        requestAnimationFrame(this._animate);
        window.addEventListener("resize", () => this._onResize());
    }

    _initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        const directional = new THREE.DirectionalLight(0xffffff, 0.9);
        directional.position.set(5, 10, 7);
        this.scene.add(ambient, directional);
    }

    _initBodies() {
        const earthGeometry = new THREE.SphereGeometry(1, 32, 32);
        const earthMaterial = new THREE.MeshPhongMaterial({
            color: 0x1d8bff,
            emissive: 0x06264d,
            shininess: 20,
        });
        this.earth = new THREE.Mesh(earthGeometry, earthMaterial);
        this.scene.add(this.earth);

        const orbitGeometry = new THREE.RingGeometry(0.99, 1.01, 96);
        const orbitMaterial = new THREE.MeshBasicMaterial({
            color: 0x2ee5ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25,
        });
        const earthOrbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
        earthOrbit.rotation.x = Math.PI / 2;
        this.scene.add(earthOrbit);
    }

    _onResize() {
        if (!this.container) return;
        const width = this.container.clientWidth || this.container.parentElement?.clientWidth || 640;
        const height = this.container.clientHeight || 420;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(0, 0, 0);
        this.renderer.setSize(width, height);
    }

    _animate() {
        this.earth.rotation.y += 0.0025;
        if (this.asteroidMarker) {
            this.asteroidMarker.rotation.y += 0.01;
        }
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this._animate);
    }

    _createOrbitLine(points, color) {
        const vectors = points.map((p) => new THREE.Vector3(p.x, p.y, p.z).multiplyScalar(SCALE_FACTOR));
        const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
        const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        return new THREE.LineLoop(geometry, material);
    }

    renderPaths({ baseline_path, deflected_path }) {
        if (!baseline_path || !deflected_path) return;

    this._disposeObject(this.baselineOrbit);
    this._disposeObject(this.deflectedOrbit);
    this._disposeObject(this.asteroidMarker);

        this.baselineOrbit = this._createOrbitLine(baseline_path, 0x2ee5ff);
        this.deflectedOrbit = this._createOrbitLine(deflected_path, 0x6effa9);
        this.scene.add(this.baselineOrbit, this.deflectedOrbit);

        const lastPoint = deflected_path[Math.floor(deflected_path.length / 4)] || deflected_path[0];
        const markerGeometry = new THREE.SphereGeometry(0.12, 24, 24);
        const markerMaterial = new THREE.MeshPhongMaterial({ color: 0xffd166, emissive: 0x421f0f });
        this.asteroidMarker = new THREE.Mesh(markerGeometry, markerMaterial);
        this.asteroidMarker.position.set(
            lastPoint.x * SCALE_FACTOR,
            lastPoint.y * SCALE_FACTOR,
            lastPoint.z * SCALE_FACTOR
        );
        this.scene.add(this.asteroidMarker);
    }

    _disposeObject(object3d) {
        if (!object3d) return;
        if (object3d.geometry) {
            object3d.geometry.dispose();
        }
        if (object3d.material) {
            if (Array.isArray(object3d.material)) {
                object3d.material.forEach((mat) => mat.dispose?.());
            } else {
                object3d.material.dispose?.();
            }
        }
        this.scene.remove(object3d);
    }
}
