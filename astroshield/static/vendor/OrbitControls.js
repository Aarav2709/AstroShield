import {
    EventDispatcher,
    MOUSE,
    Quaternion,
    Spherical,
    TOUCH,
    Vector2,
    Vector3,
} from '../vendor/three.module.js';

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

export class OrbitControls extends EventDispatcher {
    constructor(object, domElement) {
        super();

        if (!domElement) {
            throw new Error('OrbitControls: The second parameter (domElement) is required.');
        }

        this.object = object;
        this.domElement = domElement;
        this.enabled = true;

        this.target = new Vector3();

        this.minDistance = 0;
        this.maxDistance = Infinity;

        this.minZoom = 0;
        this.maxZoom = Infinity;

        this.minPolarAngle = 0;
        this.maxPolarAngle = Math.PI;

        this.minAzimuthAngle = -Infinity;
        this.maxAzimuthAngle = Infinity;

        this.enableDamping = true;
        this.dampingFactor = 0.05;

        this.enableZoom = true;
        this.zoomSpeed = 1.0;

        this.enableRotate = true;
        this.rotateSpeed = 1.0;

        this.enablePan = false;
        this.panSpeed = 1.0;
        this.screenSpacePanning = false;
        this.keyPanSpeed = 7.0;

        this.autoRotate = false;
        this.autoRotateSpeed = 2.0;

        this.enableKeys = false;
        this.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };

        this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
        this.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };

        this.target0 = this.target.clone();
        this.position0 = this.object.position.clone();
        this.zoom0 = this.object.zoom;

        this._spherical = new Spherical();
        this._sphericalDelta = new Spherical();

        this._scale = 1;
        this._panOffset = new Vector3();
        this._zoomChanged = false;

        this._rotateStart = new Vector2();
        this._rotateEnd = new Vector2();
        this._rotateDelta = new Vector2();

        this._dollyStart = new Vector2();
        this._dollyEnd = new Vector2();
        this._dollyDelta = new Vector2();

        this._mouseUpEvent = { type: 'mouseup' };
        this._mouseDownEvent = { type: 'mousedown', button: 0 };
        this._state = OrbitControls.STATE.NONE;

        this._domElementKeyEvents = null;

        this._lastPosition = new Vector3();
        this._lastQuaternion = new Quaternion();

        this._quat = new Quaternion().setFromUnitVectors(this.object.up, new Vector3(0, 1, 0));
        this._quatInverse = this._quat.clone().invert();

        this._updateOffset = new Vector3();
        this._pan = new Vector3();
        this._panRight = new Vector3();
        this._panUp = new Vector3();
        this._panInternalOffset = new Vector3();

        this._bindEvents();
        this.update();
    }

    getPolarAngle() {
        return this._spherical.phi;
    }

    getAzimuthalAngle() {
        return this._spherical.theta;
    }

    saveState() {
        this.target0.copy(this.target);
        this.position0.copy(this.object.position);
        this.zoom0 = this.object.zoom;
    }

    reset() {
        this.target.copy(this.target0);
        this.object.position.copy(this.position0);
        this.object.zoom = this.zoom0;
        this.object.updateProjectionMatrix();
        this.dispatchEvent(_changeEvent);
        this.update();
    }

    update() {
        const position = this.object.position;
        this._updateOffset.copy(position).sub(this.target);

        this._updateOffset.applyQuaternion(this._quat);

        this._spherical.setFromVector3(this._updateOffset);

        if (this.autoRotate && this._state === OrbitControls.STATE.NONE) {
            this.rotateLeft(this._getAutoRotationAngle());
        }

        if (this.enableDamping) {
            this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor;
            this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor;
        } else {
            this._spherical.theta += this._sphericalDelta.theta;
            this._spherical.phi += this._sphericalDelta.phi;
        }

        let min = this.minAzimuthAngle;
        let max = this.maxAzimuthAngle;
        $wrapAngle(this._spherical.theta, min, max);

        this._spherical.theta = Math.max(min, Math.min(max, this._spherical.theta));
        this._spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._spherical.phi));
        this._spherical.makeSafe();

        if (this.enableDamping) {
            this._spherical.radius += this._sphericalDelta.radius * this.dampingFactor;
        } else {
            this._spherical.radius += this._sphericalDelta.radius;
        }

        this._spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._spherical.radius));
        this.target.add(this._panOffset);

        this._updateOffset.setFromSpherical(this._spherical);
        this._updateOffset.applyQuaternion(this._quatInverse);

        position.copy(this.target).add(this._updateOffset);

        this.object.lookAt(this.target);

        if (this.enableDamping) {
            this._sphericalDelta.theta *= 1 - this.dampingFactor;
            this._sphericalDelta.phi *= 1 - this.dampingFactor;
            this._panOffset.multiplyScalar(1 - this.dampingFactor);
        } else {
            this._sphericalDelta.set(0, 0, 0);
            this._panOffset.set(0, 0, 0);
        }

        if (this._zoomChanged) {
            this.dispatchEvent(_changeEvent);
            this._zoomChanged = false;
        } else if (!this._lastPosition.equals(position) || !this._lastQuaternion.equals(this.object.quaternion)) {
            this.dispatchEvent(_changeEvent);
            this._lastPosition.copy(position);
            this._lastQuaternion.copy(this.object.quaternion);
        }
    }

    dispose() {
        this.domElement.removeEventListener('contextmenu', this._onContextMenu);
        this.domElement.removeEventListener('pointerdown', this._onPointerDown);
        this.domElement.removeEventListener('pointercancel', this._onPointerCancel);
        this.domElement.removeEventListener('wheel', this._onMouseWheel);
        this.domElement.ownerDocument.removeEventListener('pointermove', this._onPointerMove);
        this.domElement.ownerDocument.removeEventListener('pointerup', this._onPointerUp);
    }

    // API helpers ------------------------------------------------------------
    rotateLeft(angle) {
        this._sphericalDelta.theta -= angle;
    }

    rotateUp(angle) {
        this._sphericalDelta.phi -= angle;
    }

    dollyIn(dollyScale) {
        if (this.object.isPerspectiveCamera) {
            this._scale /= dollyScale;
        } else if (this.object.isOrthographicCamera) {
            this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom * dollyScale));
            this.object.updateProjectionMatrix();
            this._zoomChanged = true;
        } else {
            console.warn('OrbitControls: Unsupported camera type.');
        }
    }

    dollyOut(dollyScale) {
        if (this.object.isPerspectiveCamera) {
            this._scale *= dollyScale;
        } else if (this.object.isOrthographicCamera) {
            this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / dollyScale));
            this.object.updateProjectionMatrix();
            this._zoomChanged = true;
        } else {
            console.warn('OrbitControls: Unsupported camera type.');
        }
    }

    panLeft(distance, objectMatrix) {
        this._panInternalOffset.setFromMatrixColumn(objectMatrix, 0);
        this._panInternalOffset.multiplyScalar(-distance);
        this._panOffset.add(this._panInternalOffset);
    }

    panUp(distance, objectMatrix) {
        this._panInternalOffset.setFromMatrixColumn(objectMatrix, 0);
        this._panInternalOffset.crossVectors(this.object.up, this._panInternalOffset);
        this._panInternalOffset.multiplyScalar(distance);
        this._panOffset.add(this._panInternalOffset);
    }

    pan(deltaX, deltaY) {
        const element = this.domElement;
        if (this.object.isPerspectiveCamera) {
            const position = this.object.position;
            this._pan.copy(position).sub(this.target);
            let targetDistance = this._pan.length();
            targetDistance *= Math.tan((this.object.fov / 2) * Math.PI / 180);
            this.panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.object.matrix);
            this.panUp((2 * deltaY * targetDistance) / element.clientHeight, this.object.matrix);
        } else if (this.object.isOrthographicCamera) {
            this.panLeft(deltaX * (this.object.right - this.object.left) / element.clientWidth, this.object.matrix);
            this.panUp(deltaY * (this.object.top - this.object.bottom) / element.clientHeight, this.object.matrix);
        } else {
            console.warn('OrbitControls: Unsupported camera type.');
        }
    }

    _bindEvents() {
        this._onContextMenu = (event) => event.preventDefault();
        this._onPointerDown = this._handlePointerDown.bind(this);
        this._onPointerCancel = this._handlePointerCancel.bind(this);
        this._onPointerMove = this._handlePointerMove.bind(this);
        this._onPointerUp = this._handlePointerUp.bind(this);
        this._onMouseWheel = this._handleMouseWheel.bind(this);

        this.domElement.addEventListener('contextmenu', this._onContextMenu);
        this.domElement.addEventListener('pointerdown', this._onPointerDown);
        this.domElement.addEventListener('pointercancel', this._onPointerCancel);
        this.domElement.addEventListener('wheel', this._onMouseWheel, { passive: false });
        this.domElement.ownerDocument.addEventListener('pointermove', this._onPointerMove);
        this.domElement.ownerDocument.addEventListener('pointerup', this._onPointerUp);
    }

    _getAutoRotationAngle() {
        return (2 * Math.PI / 60 / 60) * this.autoRotateSpeed;
    }

    _handlePointerDown(event) {
        if (!this.enabled) return;
        switch (event.pointerType) {
            case 'touch':
                this._onTouchStart(event);
                break;
            default:
                this._onMouseDown(event);
                break;
        }
    }

    _handlePointerMove(event) {
        if (!this.enabled) return;
        switch (event.pointerType) {
            case 'touch':
                this._onTouchMove(event);
                break;
            default:
                this._onMouseMove(event);
                break;
        }
    }

    _handlePointerUp(event) {
        switch (event.pointerType) {
            case 'touch':
                this._onTouchEnd(event);
                break;
            default:
                this._onMouseUp(event);
                break;
        }
    }

    _handlePointerCancel(event) {
        this._handlePointerUp(event);
    }

    _handleMouseWheel(event) {
        if (!this.enabled || !this.enableZoom || (this._state !== OrbitControls.STATE.NONE && this._state !== OrbitControls.STATE.ROTATE)) return;
        event.preventDefault();
        event.stopPropagation();

        if (event.deltaY < 0) {
            this.dollyIn(this._getZoomScale());
        } else if (event.deltaY > 0) {
            this.dollyOut(this._getZoomScale());
        }

        this.update();
        this.dispatchEvent(_startEvent);
        this.dispatchEvent(_endEvent);
    }

    _getZoomScale() {
        return Math.pow(0.95, this.zoomSpeed);
    }

    _onMouseDown(event) {
        this.domElement.setPointerCapture(event.pointerId);
        this._mouseDownEvent.button = event.button;
        this.dispatchEvent(this._mouseDownEvent);

        switch (event.button) {
            case 0:
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    if (this.enablePan) {
                        this._state = OrbitControls.STATE.PAN;
                    } else {
                        this._state = OrbitControls.STATE.NONE;
                    }
                } else {
                    this._state = this.enableRotate ? OrbitControls.STATE.ROTATE : OrbitControls.STATE.NONE;
                }
                break;
            case 1:
                this._state = this.enableZoom ? OrbitControls.STATE.DOLLY : OrbitControls.STATE.NONE;
                break;
            case 2:
                this._state = this.enablePan ? OrbitControls.STATE.PAN : OrbitControls.STATE.NONE;
                break;
            default:
                this._state = OrbitControls.STATE.NONE;
        }

        if (this._state === OrbitControls.STATE.ROTATE && this.enableRotate) {
            this._rotateStart.set(event.clientX, event.clientY);
        } else if (this._state === OrbitControls.STATE.DOLLY && this.enableZoom) {
            this._dollyStart.set(event.clientX, event.clientY);
        } else if (this._state === OrbitControls.STATE.PAN && this.enablePan) {
            this._panStart.set(event.clientX, event.clientY);
        }
        this.dispatchEvent(_startEvent);
    }

    _onMouseMove(event) {
        if (!this.enabled) return;
        switch (this._state) {
            case OrbitControls.STATE.ROTATE:
                if (!this.enableRotate) return;
                this._rotateEnd.set(event.clientX, event.clientY);
                this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
                const element = this.domElement;
                this.rotateLeft((2 * Math.PI * this._rotateDelta.x) / element.clientHeight);
                this.rotateUp((2 * Math.PI * this._rotateDelta.y) / element.clientHeight);
                this._rotateStart.copy(this._rotateEnd);
                this.update();
                break;
            case OrbitControls.STATE.DOLLY:
                if (!this.enableZoom) return;
                this._dollyEnd.set(event.clientX, event.clientY);
                this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart);
                if (this._dollyDelta.y > 0) {
                    this.dollyIn(this._getZoomScale());
                } else if (this._dollyDelta.y < 0) {
                    this.dollyOut(this._getZoomScale());
                }
                this._dollyStart.copy(this._dollyEnd);
                this.update();
                break;
            case OrbitControls.STATE.PAN:
                if (!this.enablePan) return;
                this._panEnd.set(event.clientX, event.clientY);
                this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed);
                this.pan(this._panDelta.x, this._panDelta.y);
                this._panStart.copy(this._panEnd);
                this.update();
                break;
            default:
        }
    }

    _onMouseUp(event) {
        this.domElement.releasePointerCapture(event.pointerId);
        this.dispatchEvent(this._mouseUpEvent);
        this.dispatchEvent(_endEvent);
        this._state = OrbitControls.STATE.NONE;
    }

    _onTouchStart(event) {
        this.dispatchEvent(_startEvent);
        this._state = OrbitControls.STATE.TOUCH_ROTATE;
        this._rotateStart.set(event.touches[0].pageX, event.touches[0].pageY);
    }

    _onTouchMove(event) {
        if (!this.enabled || this._state !== OrbitControls.STATE.TOUCH_ROTATE) return;
        this._rotateEnd.set(event.touches[0].pageX, event.touches[0].pageY);
        this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
        const element = this.domElement;
        this.rotateLeft((2 * Math.PI * this._rotateDelta.x) / element.clientHeight);
        this.rotateUp((2 * Math.PI * this._rotateDelta.y) / element.clientHeight);
        this._rotateStart.copy(this._rotateEnd);
        this.update();
    }

    _onTouchEnd() {
        this.dispatchEvent(_endEvent);
        this._state = OrbitControls.STATE.NONE;
    }
}

OrbitControls.STATE = {
    NONE: -1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
};

function $wrapAngle(theta, min, max) {
    const TWO_PI = 2 * Math.PI;
    if (isFinite(min) && isFinite(max)) {
        while (theta < min) theta += TWO_PI;
        while (theta > max) theta -= TWO_PI;
    }
}
