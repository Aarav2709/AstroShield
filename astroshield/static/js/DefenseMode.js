/* global gsap */

const gsapRef = window.gsap;

export default class DefenseMode {
    constructor({ countdownEl, messageEl, onLockInputs, onUnlockInputs, onExpire }) {
        this.countdownEl = countdownEl;
        this.messageEl = messageEl;
        this.onLockInputs = onLockInputs;
        this.onUnlockInputs = onUnlockInputs;
        this.onExpire = onExpire;

        this.active = false;
        this.countdownTween = null;
        this.baselineCraterKm = null;
        this.explicitScenario = {
            diameter_m: 460,
            velocity_kms: 28,
            impact_lat: 34.05,
            impact_lon: -118.25,
        };
    }

    isActive() {
        return this.active;
    }

    hasBaseline() {
        return this.baselineCraterKm !== null;
    }

    start() {
        if (this.active) return this.explicitScenario;
        this.active = true;
        this.baselineCraterKm = null;
        this._resetMessage();
        this.onLockInputs?.();
        this._beginCountdown();
        return this.explicitScenario;
    }

    cancel() {
        this.active = false;
        this.baselineCraterKm = null;
        this._stopCountdown();
        this._resetMessage();
        this.onUnlockInputs?.();
    }

    recordBaseline(craterKm) {
        this.baselineCraterKm = craterKm;
    }

    evaluateAttempt({ craterKm, deltaV }) {
        if (!this.active || this.baselineCraterKm === null) return false;
        if (deltaV <= 0) return false;
        const reduction = 1 - craterKm / this.baselineCraterKm;
        const success = reduction >= 0.5;
        this._resolve(success);
        return success;
    }

    handleTimeout() {
        if (!this.active) return;
        this._resolve(false, true);
    }

    _beginCountdown() {
        const counter = { time: 10 };
        this.countdownEl.textContent = "Time to impact: 10s";
        this.countdownTween = gsapRef.to(counter, {
            time: 0,
            duration: 10,
            ease: "none",
            onUpdate: () => {
                this.countdownEl.textContent = `Time to impact: ${Math.ceil(counter.time)}s`;
            },
            onComplete: () => {
                this.countdownEl.textContent = "Impact!";
                this.handleTimeout();
                this.onExpire?.();
            },
        });
    }

    _stopCountdown() {
        this.countdownEl.textContent = "";
        if (this.countdownTween) {
            this.countdownTween.kill();
            this.countdownTween = null;
        }
    }

    _resetMessage() {
        this.messageEl.classList.remove("visible", "defense-success", "defense-failure");
        this.messageEl.textContent = "";
    }

    _resolve(success, fromTimeout = false) {
        this.active = false;
        this._stopCountdown();
        this.onUnlockInputs?.();
        this.messageEl.classList.add("visible");
        if (success) {
            this.messageEl.classList.add("defense-success");
            this.messageEl.textContent = "Defense successful! Earth is safe.";
        } else {
            this.messageEl.classList.add("defense-failure");
            this.messageEl.textContent = fromTimeout
                ? "Defense failed: countdown reached zero."
                : "Defense failed: insufficient mitigation.";
        }
    }
}
