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
        this.activeCountdown = false;
        this.countdownTween = null;
        this.baselineCraterKm = null;
        this.successThreshold = 0.12;
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
        this.activeCountdown = true;
        this._resetMessage();
        this.onLockInputs?.();
        this._beginCountdown();
        return this.explicitScenario;
    }

    cancel() {
        if (!this.active && !this.activeCountdown) return;
        this.active = false;
        this.baselineCraterKm = null;
        this.activeCountdown = false;
        this._stopCountdown();
        this._resetMessage();
        this.onUnlockInputs?.();
    }

    recordBaseline(craterKm) {
        this.baselineCraterKm = craterKm;
        if (this.active) {
            this._showHint('Baseline impact locked', 'neutral', 'Increase ΔV to begin deflection attempts.');
        }
    }

    evaluateAttempt({ craterKm, deltaV }) {
        if (!this.active || this.baselineCraterKm === null) return false;
        if (deltaV <= 0) {
            this._showHint('Increase ΔV to attempt a deflection.');
            return false;
        }
        const reduction = 1 - craterKm / this.baselineCraterKm;
        const percent = Math.max(0, Math.round(reduction * 100));
        if (reduction >= this.successThreshold) {
            this._resolve(true, { reductionPercent: percent });
            return true;
        }
        this._resolve(false, { reductionPercent: percent });
        return false;
    }

    handleTimeout() {
        if (!this.activeCountdown) return;
        this._resolve(false, { fromTimeout: true });
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
        this.activeCountdown = false;
    }

    _resetMessage() {
        this.messageEl.classList.remove("visible", "defense-success", "defense-failure");
        this.messageEl.textContent = "";
    }

    _showHint(text, tone = 'failure', detail = null) {
        this._renderMessage({ tone, text, detail });
        this._focusMessage();
    }

    _resolve(success, { fromTimeout = false, reductionPercent = null } = {}) {
        this.active = false;
        this.activeCountdown = false;
        this._stopCountdown();
        this.onUnlockInputs?.();
        if (success) {
            this._renderMessage({
                tone: 'success',
                text: 'Defense successful',
                percent: reductionPercent,
                detail: 'Earth is safe.'
            });
            this.countdownEl.textContent = "Defense successful!";
        } else {
            if (fromTimeout) {
                this._renderMessage({
                    tone: 'failure',
                    text: 'Defense failed',
                    detail: 'Countdown reached zero.'
                });
            } else if (reductionPercent !== null) {
                this._renderMessage({
                    tone: 'failure',
                    text: 'Defense failed',
                    percent: reductionPercent,
                    detail: 'Crater reduction too small.'
                });
            } else {
                this._renderMessage({
                    tone: 'failure',
                    text: 'Defense failed',
                    detail: 'Insufficient mitigation.'
                });
            }
            this.countdownEl.textContent = "Defense failed.";
        }
        this._focusMessage();
    }

    _renderMessage({ tone = 'neutral', text, percent = null, detail = null }) {
        if (!this.messageEl) return;
        this.messageEl.classList.add('visible');
        this.messageEl.classList.remove('defense-success', 'defense-failure');
        if (tone === 'success') {
            this.messageEl.classList.add('defense-success');
        } else if (tone === 'failure') {
            this.messageEl.classList.add('defense-failure');
        }

        while (this.messageEl.firstChild) {
            this.messageEl.removeChild(this.messageEl.firstChild);
        }

        if (text) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'defense-message__label';
            labelSpan.textContent = text;
            this.messageEl.appendChild(labelSpan);
        }

        if (typeof percent === 'number' && Number.isFinite(percent)) {
            const percentSpan = document.createElement('span');
            percentSpan.className = 'defense-message__percent';
            percentSpan.textContent = `${percent}%`;
            this.messageEl.appendChild(percentSpan);
        }

        if (detail) {
            const detailSpan = document.createElement('span');
            detailSpan.className = 'defense-message__detail';
            detailSpan.textContent = detail;
            this.messageEl.appendChild(detailSpan);
        }
    }

    _focusMessage() {
        if (!this.messageEl) return;
        this.messageEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        if (gsapRef) {
            gsapRef.fromTo(
                this.messageEl,
                { opacity: 0.35, scale: 0.96 },
                { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }
            );
        }
    }
}
