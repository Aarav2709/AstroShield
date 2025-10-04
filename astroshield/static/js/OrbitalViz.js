import * as THREE from '../vendor/three.module.js';

const AU_IN_KM = 149_597_870.7;
const SCALE_FACTOR = 1 / AU_IN_KM; // Convert kilometres into Astronomical Units for the scene
const MAX_PIXEL_RATIO = 2;
const MIN_POLAR_ANGLE = 0.15;
const MAX_POLAR_ANGLE = Math.PI - 0.15;
const MIN_RADIUS = 3;
const MAX_RADIUS = 28;
const DRAG_SENSITIVITY = 0.0065;
const ZOOM_SENSITIVITY = 0.18;
const EARTH_TEXTURE_PATH = '/static/textures/earth-day.jpg';
const EARTH_REMOTE_FALLBACK = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.1024x512.jpg';
const CLOUD_OPACITY = 0.35;
const CLOUD_ROTATION_SPEED = 0.0008;

export default class OrbitalViz {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x02060d);

        const width = this.container.clientWidth || this.container.parentElement?.clientWidth || 640;
        const height = this.container.clientHeight || 420;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
        this.renderer.setSize(width, height);
        this.container.appendChild(this.renderer.domElement);

        this._textureLoader = new THREE.TextureLoader();
        if (this._textureLoader.setCrossOrigin) {
            this._textureLoader.setCrossOrigin('anonymous');
        }

        this.maxAnisotropy = this.renderer.capabilities?.getMaxAnisotropy
            ? this.renderer.capabilities.getMaxAnisotropy()
            : 4;

        this.viewTarget = new THREE.Vector3(0, 0, 0);
        this.cameraRig = {
            spherical: new THREE.Spherical(11, Math.PI / 2.35, Math.PI / 8),
            position: new THREE.Vector3(),
        };
        this._needsCameraUpdate = true;
        this._isDragging = false;
        this._pointerLast = new THREE.Vector2();

        this._initLights();
        this._initBodies();
    this._loadEarthTexture();

        this._bindInteractions();
        this._updateCameraFromSpherical();

        this.baselineOrbit = null;
        this.deflectedOrbit = null;
        this.asteroidMarker = null;
        this.asteroidPathVectors = null;
        this._asteroidProgress = 0;
        this._asteroidSpeed = 0.0024;
        this.cloudMesh = null;

        this._animate = this._animate.bind(this);
        requestAnimationFrame(this._animate);
        window.addEventListener('resize', () => this._onResize());
    }

    _initLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        const directional = new THREE.DirectionalLight(0xffffff, 0.9);
        directional.position.set(5, 10, 7);
        this.scene.add(ambient, directional);
    }

    _initBodies() {
        const earthGeometry = new THREE.SphereGeometry(1, 64, 64);
        this.earthMaterial = new THREE.MeshPhongMaterial({
            color: 0x1d8bff,
            specular: new THREE.Color('#262626'),
            shininess: 12,
        });
        const proceduralTexture = this._createProceduralEarthTexture();
        this.earthMaterial.map = proceduralTexture;
        this.earthMaterial.needsUpdate = true;
        this.earth = new THREE.Mesh(earthGeometry, this.earthMaterial);
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

        this.cloudMesh = this._createCloudLayer();
        if (this.cloudMesh) {
            this.scene.add(this.cloudMesh);
        }
    }

    _onResize() {
        if (!this.container) return;
        const width = this.container.clientWidth || this.container.parentElement?.clientWidth || 640;
        const height = this.container.clientHeight || 420;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this._needsCameraUpdate = true;
    }

    _animate() {
        if (this._needsCameraUpdate) {
            this._updateCameraFromSpherical();
            this._needsCameraUpdate = false;
        }
        this.earth.rotation.y += 0.0025;
        if (this.asteroidMarker) {
            this.asteroidMarker.rotation.y += 0.01;
            this._advanceAsteroidMarker();
        }
        if (this.cloudMesh) {
            this.cloudMesh.rotation.y += CLOUD_ROTATION_SPEED;
        }
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this._animate);
    }

    _updateCameraFromSpherical() {
        const { spherical, position } = this.cameraRig;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE);
        spherical.radius = THREE.MathUtils.clamp(spherical.radius, MIN_RADIUS, MAX_RADIUS);
        position.setFromSpherical(spherical);
        this.camera.position.copy(position);
        this.camera.lookAt(this.viewTarget);
    }

    _bindInteractions() {
        const canvas = this.renderer.domElement;
        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', (event) => this._handlePointerDown(event));
        window.addEventListener('pointermove', (event) => this._handlePointerMove(event));
        window.addEventListener('pointerup', (event) => this._handlePointerUp(event));
        canvas.addEventListener(
            'wheel',
            (event) => {
                this._handleWheel(event);
            },
            { passive: false },
        );
    }

    _handlePointerDown(event) {
        if (event.button !== 0) return;
        this._isDragging = true;
        this._pointerLast.set(event.clientX, event.clientY);
        this.renderer.domElement.setPointerCapture?.(event.pointerId);
    }

    _handlePointerMove(event) {
        if (!this._isDragging) return;
        const deltaX = event.clientX - this._pointerLast.x;
        const deltaY = event.clientY - this._pointerLast.y;
        this._pointerLast.set(event.clientX, event.clientY);
        const { spherical } = this.cameraRig;
        spherical.theta -= deltaX * DRAG_SENSITIVITY;
        spherical.phi -= deltaY * DRAG_SENSITIVITY;
        this._needsCameraUpdate = true;
    }

    _handlePointerUp(event) {
        if (!this._isDragging) return;
        this._isDragging = false;
        this.renderer.domElement.releasePointerCapture?.(event.pointerId);
    }

    _handleWheel(event) {
        event.preventDefault();
        const { spherical } = this.cameraRig;
        const delta = event.deltaY > 0 ? 1 : -1;
        const factor = Math.exp(delta * ZOOM_SENSITIVITY * 0.12);
        spherical.radius *= factor;
        this._needsCameraUpdate = true;
    }

    _loadEarthTexture() {
        const applyTexture = (texture, sourceLabel) => {
            this._applyTextureSettings(texture);
            this.earthMaterial.map = texture;
            this.earthMaterial.needsUpdate = true;
            if (sourceLabel) {
                console.info(`[OrbitalViz] Earth texture loaded from ${sourceLabel}.`);
            }
        };

        const handleProceduralFallback = () => {
            console.warn('[OrbitalViz] Using procedural Earth texture fallback.');
            applyTexture(this._createProceduralEarthTexture(), 'procedural generator');
        };

        const tryRemoteFallback = () => {
            console.warn('[OrbitalViz] Local Earth texture missing; attempting NASA Blue Marble fallback.');
            this._textureLoader.load(
                EARTH_REMOTE_FALLBACK,
                (texture) => applyTexture(texture, 'NASA Blue Marble (remote)'),
                undefined,
                handleProceduralFallback,
            );
        };

        this._textureLoader.load(
            EARTH_TEXTURE_PATH,
            (texture) => applyTexture(texture, 'local asset'),
            undefined,
            tryRemoteFallback,
        );
    }

    _applyTextureSettings(texture) {
        if (texture.anisotropy !== undefined && this.maxAnisotropy) {
            texture.anisotropy = Math.min(texture.anisotropy || this.maxAnisotropy, this.maxAnisotropy);
        }
        if ('colorSpace' in texture && THREE.SRGBColorSpace) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else if ('encoding' in texture && THREE.sRGBEncoding !== undefined) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        if (texture.repeat) {
            texture.repeat.set(1, 1);
        }
        texture.needsUpdate = true;
    }

    _createProceduralEarthTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const oceanGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        oceanGradient.addColorStop(0, '#02223d');
        oceanGradient.addColorStop(1, '#044a7f');
        ctx.fillStyle = oceanGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const drawContinent = (points, fillStyle) => {
            if (!points.length) return;
            ctx.beginPath();
            const [firstLon, firstLat] = points[0];
            ctx.moveTo(
                ((firstLon + 180) / 360) * canvas.width,
                ((90 - firstLat) / 180) * canvas.height,
            );
            for (let i = 1; i < points.length; i += 1) {
                const [lon, lat] = points[i];
                ctx.lineTo(
                    ((lon + 180) / 360) * canvas.width,
                    ((90 - lat) / 180) * canvas.height,
                );
            }
            ctx.closePath();
            ctx.fillStyle = fillStyle;
            ctx.fill();
        };

        const landColor = '#2f9f6e';
        const desertColor = '#c7a76d';
        const tundraColor = '#7fb5c7';

        drawContinent(
            [
                [-168, 72],
                [-140, 65],
                [-125, 61],
                [-120, 50],
                [-118, 39],
                [-105, 32],
                [-95, 20],
                [-85, 17],
                [-78, 26],
                [-75, 40],
                [-66, 43],
                [-60, 52],
                [-72, 64],
                [-100, 72],
            ],
            landColor,
        );

        drawContinent(
            [
                [-80, 12],
                [-72, 9],
                [-68, 4],
                [-65, -4],
                [-70, -18],
                [-76, -25],
                [-80, -35],
                [-62, -56],
                [-54, -50],
                [-53, -32],
                [-60, -12],
                [-72, -4],
            ],
            landColor,
        );

        drawContinent(
            [
                [-10, 72],
                [15, 72],
                [45, 65],
                [72, 56],
                [90, 48],
                [110, 45],
                [130, 35],
                [142, 25],
                [146, 8],
                [120, 5],
                [105, 8],
                [90, 20],
                [75, 22],
                [60, 30],
                [40, 36],
                [25, 45],
                [10, 50],
                [-12, 58],
                [-24, 65],
            ],
            landColor,
        );

        drawContinent(
            [
                [18, 37],
                [40, 35],
                [42, 23],
                [33, 5],
                [18, -5],
                [5, 4],
                [-5, 12],
                [-10, 22],
                [-2, 32],
            ],
            landColor,
        );

        drawContinent(
            [
                [45, 28],
                [55, 32],
                [62, 28],
                [70, 20],
                [75, 12],
                [70, 6],
                [60, 8],
                [50, 18],
            ],
            desertColor,
        );

        drawContinent(
            [
                [44, -10],
                [50, -12],
                [54, -18],
                [52, -28],
                [46, -32],
                [40, -28],
                [38, -18],
            ],
            landColor,
        );

        drawContinent(
            [
                [120, -10],
                [130, -12],
                [138, -20],
                [142, -32],
                [150, -38],
                [154, -44],
                [150, -50],
                [138, -40],
                [128, -32],
                [122, -20],
            ],
            landColor,
        );

        drawContinent(
            [
                [-46, 78],
                [-34, 75],
                [-28, 70],
                [-42, 68],
                [-52, 70],
            ],
            tundraColor,
        );

        const polarGradientNorth = ctx.createRadialGradient(
            canvas.width / 2,
            canvas.height * 0.1,
            0,
            canvas.width / 2,
            canvas.height * 0.1,
            canvas.height * 0.35,
        );
        polarGradientNorth.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        polarGradientNorth.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = polarGradientNorth;
        ctx.fillRect(0, 0, canvas.width, canvas.height / 2);

        const polarGradientSouth = ctx.createRadialGradient(
            canvas.width / 2,
            canvas.height * 0.9,
            0,
            canvas.width / 2,
            canvas.height * 0.9,
            canvas.height * 0.35,
        );
        polarGradientSouth.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
        polarGradientSouth.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = polarGradientSouth;
        ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);

        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 180; i += 1) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const radius = Math.random() * 80 + 20;
            const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
            gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        const gridGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        gridGradient.addColorStop(0, 'rgba(255,255,255,0.045)');
        gridGradient.addColorStop(0.5, 'rgba(255,255,255,0.08)');
        gridGradient.addColorStop(1, 'rgba(255,255,255,0.045)');
        ctx.fillStyle = gridGradient;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';

        const texture = new THREE.CanvasTexture(canvas);
        this._applyTextureSettings(texture);
        return texture;
    }

    _createCloudLayer() {
        const canvas = this._generateCloudTexture(1024, 512);
        if (!canvas) return null;
        const texture = new THREE.CanvasTexture(canvas);
        this._applyTextureSettings(texture);
        const material = new THREE.MeshLambertMaterial({
            map: texture,
            transparent: true,
            opacity: CLOUD_OPACITY,
            depthWrite: false,
        });
        const geometry = new THREE.SphereGeometry(1.015, 64, 64);
        return new THREE.Mesh(geometry, material);
    }

    _generateCloudTexture(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        const cloudCount = 260;
        for (let i = 0; i < cloudCount; i += 1) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const radius = Math.random() * 90 + 35;
            const gradient = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius);
            gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        return canvas;
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
    this.baselineOrbit = null;
    this.deflectedOrbit = null;
    this.asteroidMarker = null;
        this.asteroidPathVectors = null;
        this._asteroidProgress = 0;

        this.baselineOrbit = this._createOrbitLine(baseline_path, 0x2ee5ff);
        this.deflectedOrbit = this._createOrbitLine(deflected_path, 0x6effa9);
        this.scene.add(this.baselineOrbit, this.deflectedOrbit);

        const deflectedVectors = deflected_path.map((point) => new THREE.Vector3(
            (Number(point?.x) || 0) * SCALE_FACTOR,
            (Number(point?.y) || 0) * SCALE_FACTOR,
            (Number(point?.z) || 0) * SCALE_FACTOR,
        ));
        if (deflectedVectors.length) {
            this.asteroidPathVectors = deflectedVectors;
            const dynamicSpeed = Math.min(0.01, Math.max(0.00045, 0.8 / deflectedVectors.length));
            this._asteroidSpeed = dynamicSpeed;
            const markerGeometry = new THREE.SphereGeometry(0.12, 24, 24);
            const markerMaterial = new THREE.MeshPhongMaterial({ color: 0xffd166, emissive: 0x421f0f });
            this.asteroidMarker = new THREE.Mesh(markerGeometry, markerMaterial);
            this.asteroidMarker.position.copy(deflectedVectors[0]);
            this.scene.add(this.asteroidMarker);
        }
    }

    _advanceAsteroidMarker() {
        if (!this.asteroidMarker || !this.asteroidPathVectors || this.asteroidPathVectors.length === 0) {
            return;
        }
        if (this.asteroidPathVectors.length === 1) {
            this.asteroidMarker.position.copy(this.asteroidPathVectors[0]);
            return;
        }
        this._asteroidProgress = (this._asteroidProgress + this._asteroidSpeed) % 1;
        const segmentPosition = this._asteroidProgress * this.asteroidPathVectors.length;
        const currentIndex = Math.floor(segmentPosition);
        const nextIndex = (currentIndex + 1) % this.asteroidPathVectors.length;
        const blend = segmentPosition - currentIndex;
        const currentPoint = this.asteroidPathVectors[currentIndex];
        const nextPoint = this.asteroidPathVectors[nextIndex];
        this.asteroidMarker.position.lerpVectors(currentPoint, nextPoint, blend);
    }

    _disposeObject(object3d) {
        if (!object3d) return;
        if (object3d.geometry) {
            object3d.geometry.dispose();
        }
        if (object3d.material) {
            const disposeMaterial = (material) => {
                material?.map?.dispose?.();
                material?.dispose?.();
            };
            if (Array.isArray(object3d.material)) {
                object3d.material.forEach(disposeMaterial);
            } else {
                disposeMaterial(object3d.material);
            }
        }
        this.scene.remove(object3d);
    }
}
