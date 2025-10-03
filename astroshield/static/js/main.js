/*
 * Client-side logic for AstroShield.
 *
 * Responsibilities:
 *  - Manage form interactions and communicate with the Flask backend.
 *  - Render Leaflet map visualisations and GSAP-powered animations.
 *  - Provide a gamified "Defend Earth" scenario with countdown pressure.
 */

// -----------------------------------------------------------------------------
// GSAP setup
// -----------------------------------------------------------------------------
if (window.gsap && window.TextPlugin) {
    gsap.registerPlugin(TextPlugin);
}

// -----------------------------------------------------------------------------
// DOM references
// -----------------------------------------------------------------------------
const form = document.getElementById("impact-form");
const defendButton = document.getElementById("defend-earth-button");
const countdownEl = document.getElementById("defense-countdown");
const defenseMessage = document.getElementById("defense-message");

const diameterInput = document.getElementById("diameter_m");
const velocityInput = document.getElementById("velocity_kms");
const deltaVInput = document.getElementById("deflection_delta_v");

const diameterOutput = document.getElementById("diameter-output");
const velocityOutput = document.getElementById("velocity-output");
const deltaVOutput = document.getElementById("delta-v-output");

const energyOutput = document.getElementById("energy-output");
const craterOutput = document.getElementById("crater-output");
const seismicOutput = document.getElementById("seismic-output");
const tsunamiWarning = document.getElementById("tsunami-warning");

// -----------------------------------------------------------------------------
// Leaflet map initialisation
// -----------------------------------------------------------------------------
const map = L.map("map", {
    worldCopyJump: true,
    zoomControl: false,
}).setView([20, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 7,
    attribution: "© OpenStreetMap contributors",
}).addTo(map);

let impactCircle = null;

// -----------------------------------------------------------------------------
// State for defense mode
// -----------------------------------------------------------------------------
let defenseModeActive = false;
let defenseCountdownTween = null;
let defenseBaselineCraterKm = null;
let defenseSubmitted = false;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function updateOutputs() {
    diameterOutput.textContent = `${Number(diameterInput.value).toFixed(0)}`;
    velocityOutput.textContent = `${Number(velocityInput.value).toFixed(0)}`;
    deltaVOutput.textContent = `${Number(deltaVInput.value).toFixed(0)}`;
}

function toggleInputs(disabled) {
    diameterInput.disabled = disabled;
    velocityInput.disabled = disabled;
    deltaVInput.disabled = false; // Always leave ΔV controllable
}

function resetDefenseState() {
    defenseModeActive = false;
    defenseBaselineCraterKm = null;
    defenseSubmitted = false;
    if (defenseCountdownTween) {
        defenseCountdownTween.kill();
        defenseCountdownTween = null;
    }
    countdownEl.textContent = "";
    countdownEl.classList.remove("warning-text");
    defenseMessage.className = "defense-message hidden";
    defenseMessage.textContent = "";
    form.reset();
    diameterInput.value = 150;
    velocityInput.value = 20;
    deltaVInput.value = 0;
    updateOutputs();
    toggleInputs(false);
}

function animateMetric(element, suffix, value, decimals = 1) {
    const obj = { val: 0 };
    gsap.to(obj, {
        val: value,
        duration: 1.5,
        ease: "power2.out",
        onUpdate() {
            element.textContent = `${obj.val.toFixed(decimals)} ${suffix}`;
        },
    });
}

function showTsunamiWarning(active) {
    if (active) {
        tsunamiWarning.classList.remove("hidden");
        tsunamiWarning.classList.add("pulse");
    } else {
        tsunamiWarning.classList.add("hidden");
        tsunamiWarning.classList.remove("pulse");
    }
}

function showDefenseMessage(success) {
    defenseMessage.classList.remove("hidden", "defense-success", "defense-failure");
    if (success) {
        defenseMessage.textContent = "Defense Successful! Earth is safe.";
        defenseMessage.classList.add("defense-success");
    } else {
        defenseMessage.textContent = "Defense Failed. Impact devastation imminent.";
        defenseMessage.classList.add("defense-failure");
    }
}

function renderImpact(data) {
    const { impact_lat, impact_lon } = data;

    // Remove previous circle, if any
    if (impactCircle) {
        map.removeLayer(impactCircle);
    }

    impactCircle = L.circle([impact_lat, impact_lon], {
        radius: 0,
        color: "#ff4d4d",
        fillColor: "#ff4d4d",
        fillOpacity: 0.25,
        weight: 2,
    }).addTo(map);

    map.flyTo([impact_lat, impact_lon], 6, {
        animate: true,
        duration: 1.5,
    });

    const radiusState = { km: 0 };
    const targetRadiusKm = Math.max(Number(data.crater_diameter_km) || 0, 0);
    gsap.to(radiusState, {
        km: targetRadiusKm,
        duration: 1.5,
        ease: "power2.out",
        onUpdate() {
            const radiusMeters = Math.max(radiusState.km * 1000, 1000);
            impactCircle.setRadius(radiusMeters);
        },
    });

    animateMetric(energyOutput, "MT", data.energy_mt, 2);
    animateMetric(craterOutput, "km", data.crater_diameter_km, 2);
    animateMetric(seismicOutput, "Mw", data.seismic_magnitude, 2);

    if (Number(data.deflection_delta_v) > 0) {
        gsap.fromTo(
            energyOutput,
            { color: "#4cffaf" },
            { color: "#2ee5ff", duration: 1.2, ease: "power2.out" }
        );
    }

    showTsunamiWarning(Boolean(data.tsunami_risk));

    if (defenseModeActive && defenseBaselineCraterKm !== null) {
        const reduction = 1 - data.crater_diameter_km / defenseBaselineCraterKm;
        const success = reduction >= 0.5 && Number(data.deflection_delta_v) > 0;
        showDefenseMessage(success);
        defenseSubmitted = true;
        defenseModeActive = false;
        toggleInputs(false);
        if (defenseCountdownTween) {
            defenseCountdownTween.kill();
            defenseCountdownTween = null;
        }
        countdownEl.textContent = "";
    }
}

async function runSimulation(payload) {
    try {
        const response = await fetch("/api/simulate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Simulation failed with status ${response.status}`);
        }

        const data = await response.json();
        renderImpact(data);
        return data;
    } catch (error) {
        console.error("Simulation error", error);
        defenseMessage.classList.remove("hidden");
        defenseMessage.textContent = "Simulation error. Please try again.";
        defenseMessage.classList.add("defense-failure");
        return null;
    }
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------
function handleFormSubmit(event) {
    event.preventDefault();

    const payload = {
        diameter_m: Number(diameterInput.value),
        velocity_kms: Number(velocityInput.value),
        deflection_delta_v: Number(deltaVInput.value),
        impact_lat: 34.05,
        impact_lon: -118.25,
    };

    runSimulation(payload);
}

function startDefenseMode() {
    resetDefenseState();
    defenseModeActive = true;

    // Fixed high-threat scenario
    const fixedDiameter = 450;
    const fixedVelocity = 28;
    const baselinePayload = {
        diameter_m: fixedDiameter,
        velocity_kms: fixedVelocity,
        deflection_delta_v: 0,
        impact_lat: 34.05,
        impact_lon: -118.25,
    };

    diameterInput.value = fixedDiameter;
    velocityInput.value = fixedVelocity;
    deltaVInput.value = 0;
    updateOutputs();

    toggleInputs(true);

    runSimulation(baselinePayload).then((data) => {
        if (data) {
            defenseBaselineCraterKm = data.crater_diameter_km;
        }
    });

    const countdownState = { seconds: 10 };
    countdownEl.classList.add("warning-text");

    defenseCountdownTween = gsap.to(countdownState, {
        seconds: 0,
        duration: 10,
        ease: "none",
        onUpdate() {
            countdownEl.textContent = `Time to Impact: ${Math.ceil(countdownState.seconds)}s`;
        },
        onComplete() {
            if (defenseModeActive && !defenseSubmitted) {
                showDefenseMessage(false);
                defenseModeActive = false;
                toggleInputs(false);
            }
        },
    });
}

// -----------------------------------------------------------------------------
// Wire up listeners
// -----------------------------------------------------------------------------
form.addEventListener("submit", handleFormSubmit);
[diameterInput, velocityInput, deltaVInput].forEach((input) => {
    input.addEventListener("input", updateOutputs);
});

defendButton.addEventListener("click", () => {
    if (defenseModeActive) {
        resetDefenseState();
    } else {
        startDefenseMode();
    }
});

// Initialise outputs on load
updateOutputs();

// Run an initial simulation for immediate feedback
runSimulation({
    diameter_m: Number(diameterInput.value),
    velocity_kms: Number(velocityInput.value),
    deflection_delta_v: Number(deltaVInput.value),
    impact_lat: 34.05,
    impact_lon: -118.25,
});
