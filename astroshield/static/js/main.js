import ImpactViz from './ImpactViz.js';
import OrbitalViz from './OrbitalViz.js';
import DefenseMode from './DefenseMode.js';

const gsapRef = window.gsap;
const TextPlugin = window.TextPlugin;
if (gsapRef && TextPlugin) {
    gsapRef.registerPlugin(TextPlugin);
}

const DEFAULT_COORDS = { lat: 34.05, lon: -118.25 };
const TNT_JOULES = 4.184e15;
const ASTEROID_DENSITY = 3000;

const OFFLINE_BASELINE = {
    inputs: {
        diameter_m: 210,
        velocity_kms: 21.5,
        deflection_delta_v: 0,
        impact_lat: 34.05,
        impact_lon: -118.25,
        asteroid_id: 'Impactor-2025',
    },
    neo_reference: {
        name: 'Impactor-2025',
        designation: '2025-IM',
        velocity_kms: 21.5,
        diameter_m: 210,
        diameter_range_m: { min_m: 190, max_m: 230 },
        absolute_magnitude_h: 21.0,
        close_approach: {
            miss_distance_km: 120000,
        },
    },
    energy: {
        energy_mt: 1172.3,
        mass_kg: 14547144782,
        effective_velocity_ms: 21500,
        energy_joules: 3.67e18,
    },
    impact_effects: {
        crater_diameter_km: 1.16,
        seismic_magnitude: 6.6,
    },
    environment: {
        elevation_m: 92,
        seismic_zone_risk: 'High',
        is_coastal_zone: true,
        tsunami_risk: true,
    },
    orbital_solution: {
        baseline_path: Array.from({ length: 64 }, (_, i) => {
            const angle = (i / 64) * Math.PI * 2;
            const radius = 150000000;
            return {
                x: radius * Math.cos(angle),
                y: radius * Math.sin(angle),
                z: 50000000 * Math.sin(angle * 0.5),
            };
        }),
        deflected_path: Array.from({ length: 64 }, (_, i) => {
            const angle = (i / 64) * Math.PI * 2;
            const radius = 152500000;
            return {
                x: radius * Math.cos(angle + 0.05),
                y: radius * Math.sin(angle + 0.05),
                z: 45000000 * Math.sin(angle * 0.55),
            };
        }),
        deflected_moid_km: 87000,
    },
};

const form = document.getElementById('impact-form');
const runButton = document.getElementById('run-simulation');
const defenseButton = document.getElementById('defend-earth-button');
const countdownEl = document.getElementById('defense-countdown');
const messageEl = document.getElementById('defense-message');
const asteroidSelect = document.getElementById('asteroid-select');

const neoNameEl = document.getElementById('neo-name');
const neoDesignationEl = document.getElementById('neo-designation');
const neoVelocityEl = document.getElementById('neo-velocity');
const neoDiameterEl = document.getElementById('neo-diameter');
const neoMagnitudeEl = document.getElementById('neo-magnitude');
const neoMoidEl = document.getElementById('neo-moid');

const diameterInput = document.getElementById('diameter_m');
const velocityInput = document.getElementById('velocity_kms');
const deltaVInput = document.getElementById('deflection_delta_v');

const diameterOutput = document.getElementById('diameter-output');
const velocityOutput = document.getElementById('velocity-output');
const deltaVOutput = document.getElementById('delta-v-output');

const energyOutput = document.getElementById('energy-output');
const craterOutput = document.getElementById('crater-output');
const seismicOutput = document.getElementById('seismic-output');
const moidOutput = document.getElementById('moid-output');
const elevationOutput = document.getElementById('elevation-output');
const seismicRiskOutput = document.getElementById('seismic-risk-output');
const coastalOutput = document.getElementById('coastal-output');

let lastSimulationData = null;

const impactViz = new ImpactViz('map');
const orbitalViz = new OrbitalViz('orbital-canvas');

const defenseMode = new DefenseMode({
    countdownEl,
    messageEl,
    onLockInputs: () => {
        diameterInput.disabled = true;
        velocityInput.disabled = true;
        defenseButton.textContent = 'Cancel Defense';
    },
    onUnlockInputs: () => {
        diameterInput.disabled = false;
        velocityInput.disabled = false;
        defenseButton.textContent = 'Defend Earth Mode';
    },
    onExpire: () => {
        defenseButton.textContent = 'Defend Earth Mode';
    },
});

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------
function updateSliderOutputs() {
    diameterOutput.textContent = `${Number(diameterInput.value).toFixed(0)}`;
    velocityOutput.textContent = `${Number(velocityInput.value).toFixed(1)}`;
    deltaVOutput.textContent = `${Number(deltaVInput.value).toFixed(0)}`;
}

function animateMetric(element, value, suffix, decimals = 1) {
    const target = Number(value) || 0;
    element.dataset.value = target;
    if (!gsapRef) {
        element.textContent = `${target.toFixed(decimals)}${suffix}`;
        return;
    }
    const start = Number(element.dataset.renderedValue || 0);
    const proxy = { val: start };
    gsapRef.to(proxy, {
        val: target,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate: () => {
            element.dataset.renderedValue = proxy.val;
            element.textContent = `${proxy.val.toFixed(decimals)}${suffix}`;
        },
    });
}

function collectPayload(overrides = {}) {
    return {
        diameter_m: Number(diameterInput.value),
        velocity_kms: Number(velocityInput.value),
        deflection_delta_v: Number(deltaVInput.value),
        impact_lat: DEFAULT_COORDS.lat,
        impact_lon: DEFAULT_COORDS.lon,
        asteroid_id: asteroidSelect?.value || undefined,
        ...overrides,
    };
}

function computeApproximateMass(diameterMeters, templateMassKg) {
    if (templateMassKg) return templateMassKg;
    const radius = Math.max(diameterMeters || 0, 0) / 2;
    const volume = (4 / 3) * Math.PI * radius ** 3;
    return volume * ASTEROID_DENSITY;
}

function estimateDeflectionOutcome(template, payload) {
    if (!template) return null;
    const clone = JSON.parse(JSON.stringify(template));
    clone.inputs = { ...template.inputs, ...payload };

    const massKg = computeApproximateMass(payload?.diameter_m, template.energy?.mass_kg);
    const velocityKms = payload?.velocity_kms ?? template.inputs?.velocity_kms ?? 0;
    const deltaV = payload?.deflection_delta_v ?? 0;
    const effectiveVelocityMs = Math.max(velocityKms * 1000 - deltaV, 1);
    const energyJoules = 0.5 * massKg * effectiveVelocityMs ** 2;
    const energyMt = energyJoules / TNT_JOULES;
    const craterKm = Math.max(0, 0.11 * Math.cbrt(Math.max(energyMt, 0)));
    const seismicMagnitude = Math.max(0, 0.67 * Math.log10(Math.max(energyJoules, 1)) - 5.8);

    clone.energy = {
        mass_kg: massKg,
        effective_velocity_ms: effectiveVelocityMs,
        energy_joules: energyJoules,
        energy_mt: energyMt,
    };

    clone.impact_effects = {
        ...template.impact_effects,
        crater_diameter_km: craterKm,
        seismic_magnitude: seismicMagnitude,
    };

    if (clone.orbital_solution) {
        const baselineMoid = clone.orbital_solution.baseline_moid_km ?? clone.orbital_solution.deflected_moid_km;
        const adjustmentFactor = Math.min(Math.max(deltaV / (velocityKms * 1000 || 1), -0.8), 0.8);
        const moidChange = (clone.orbital_solution.moid_change_km ?? 0) * adjustmentFactor || 0;
        clone.orbital_solution.deflected_moid_km = Math.max(0, (baselineMoid ?? 0) - moidChange);
    }

    return clone;
}

function bindTooltips() {
    document.querySelectorAll('.info-card').forEach((card) => {
        const trigger = card.querySelector('.tooltip-trigger');
        const tooltip = card.querySelector('.tooltip');
        if (!trigger || !tooltip) return;
        const show = () => tooltip.classList.add('visible');
        const hide = () => tooltip.classList.remove('visible');
        trigger.addEventListener('mouseenter', show);
        trigger.addEventListener('focus', show);
        trigger.addEventListener('mouseleave', hide);
        trigger.addEventListener('blur', hide);
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            tooltip.classList.toggle('visible');
        });
    });
}

function resetDefenseStateUI() {
    defenseMode.cancel();
    defenseButton.textContent = 'Defend Earth Mode';
    messageEl.classList.remove('visible', 'defense-success', 'defense-failure');
    messageEl.textContent = '';
}

// -----------------------------------------------------------------------------
// Networking
// -----------------------------------------------------------------------------
async function runSimulation(overrides = {}, { skipDefenseCheck = false } = {}) {
    const payload = collectPayload(overrides);
    try {
        runButton.disabled = true;
        runButton.textContent = 'Calculating...';
        const response = await fetch('/api/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Simulation failed with status ${response.status}`);
        }
        const data = await response.json();
        renderSimulation(data, { skipDefenseCheck });
        lastSimulationData = data;
        messageEl.classList.remove('visible', 'defense-failure');
        if (!defenseMode.isActive()) {
            messageEl.textContent = '';
        }
        return data;
    } catch (error) {
        console.error('Simulation error', error);
        const fallback = lastSimulationData || OFFLINE_BASELINE;
        const isDefenseActive = defenseMode.isActive();
        const approximated = isDefenseActive ? estimateDeflectionOutcome(fallback, payload) : fallback;
        messageEl.classList.add('visible');
        messageEl.classList.remove('defense-success');
        if (isDefenseActive) {
            messageEl.classList.remove('defense-failure');
            messageEl.textContent = 'Live data unavailable. Using onboard estimator for defense check.';
        } else {
            messageEl.classList.add('defense-failure');
            messageEl.textContent = 'Connection issue detected. Showing cached simulation.';
        }
        if (approximated) {
            renderSimulation(approximated, { skipDefenseCheck: !isDefenseActive });
            lastSimulationData = approximated;
        }
        return null;
    } finally {
        runButton.disabled = false;
        runButton.textContent = 'Run Simulation';
    }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------
function renderSimulation(data, { skipDefenseCheck = false } = {}) {
    const { inputs, impact_effects, energy, environment, orbital_solution, neo_reference } = data;

    impactViz.updateImpact({
        lat: inputs.impact_lat,
        lon: inputs.impact_lon,
        craterDiameterKm: impact_effects.crater_diameter_km,
        tsunamiRisk: environment.tsunami_risk,
    });

    orbitalViz.renderPaths(orbital_solution);

    renderNeoOverview(neo_reference);
    renderEnvironment(environment);

    animateMetric(energyOutput, energy.energy_mt, ' MT', 2);
    animateMetric(craterOutput, impact_effects.crater_diameter_km, ' km', 2);
    animateMetric(seismicOutput, impact_effects.seismic_magnitude, ' Mw', 2);
    animateMetric(moidOutput, orbital_solution.deflected_moid_km, ' km', 0);

    if (defenseMode.isActive()) {
        if (!defenseMode.hasBaseline()) {
            defenseMode.recordBaseline(impact_effects.crater_diameter_km);
        } else if (!skipDefenseCheck) {
            defenseMode.evaluateAttempt({
                craterKm: impact_effects.crater_diameter_km,
                deltaV: inputs.deflection_delta_v,
            });
        }
    }
}

function renderNeoOverview(neo) {
    if (!neo) return;
    neoNameEl.textContent = neo.name || '—';
    neoDesignationEl.textContent = neo.designation || '—';
    neoVelocityEl.textContent = neo.velocity_kms ? `${Number(neo.velocity_kms).toFixed(2)} km/s` : '—';
    const diameterRange = neo.diameter_range_m || {};
    if (diameterRange.min_m && diameterRange.max_m) {
        neoDiameterEl.textContent = `${diameterRange.min_m.toFixed(0)}–${diameterRange.max_m.toFixed(0)} m`;
    } else if (neo.diameter_m) {
        neoDiameterEl.textContent = `${Number(neo.diameter_m).toFixed(0)} m`;
    } else {
        neoDiameterEl.textContent = '—';
    }
    neoMagnitudeEl.textContent = neo.absolute_magnitude_h ? neo.absolute_magnitude_h.toFixed(1) : '—';
    neoMoidEl.textContent = neo.close_approach?.miss_distance_km
        ? `${Number(neo.close_approach.miss_distance_km).toLocaleString()} km`
        : '—';

}

function renderEnvironment(environment) {
    if (!environment) return;
    const elevation = environment.elevation_m;
    elevationOutput.textContent = typeof elevation === 'number'
        ? `${elevation.toFixed(0)} m`
        : '—';
    seismicRiskOutput.textContent = environment.seismic_zone_risk || 'Unknown';
    const coastal = environment.is_coastal_zone;
    if (coastal === null || coastal === undefined) {
        coastalOutput.textContent = 'Unknown';
    } else {
        coastalOutput.textContent = coastal ? 'Coastal' : 'Inland';
    }
}

// -----------------------------------------------------------------------------
// Event bindings
// -----------------------------------------------------------------------------
form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSimulation();
});

[diameterInput, velocityInput, deltaVInput].forEach((input) => {
    input.addEventListener('input', updateSliderOutputs);
});

asteroidSelect?.addEventListener('change', () => {
    resetDefenseStateUI();
    runSimulation({ asteroid_id: asteroidSelect.value });
});

defenseButton.addEventListener('click', async () => {
    if (defenseMode.isActive()) {
        resetDefenseStateUI();
        diameterInput.value = 210;
        velocityInput.value = 21.5;
        deltaVInput.value = 0;
        updateSliderOutputs();
        runSimulation();
        return;
    }

    const scenario = defenseMode.start();
    diameterInput.value = scenario.diameter_m;
    velocityInput.value = scenario.velocity_kms;
    deltaVInput.value = 0;
    updateSliderOutputs();
    await runSimulation({
        diameter_m: scenario.diameter_m,
        velocity_kms: scenario.velocity_kms,
        deflection_delta_v: 0,
        impact_lat: scenario.impact_lat,
        impact_lon: scenario.impact_lon,
    }, { skipDefenseCheck: true });
});

// -----------------------------------------------------------------------------
// Initialise UI & first simulation
// -----------------------------------------------------------------------------
bindTooltips();
updateSliderOutputs();
lastSimulationData = OFFLINE_BASELINE;
renderSimulation(OFFLINE_BASELINE, { skipDefenseCheck: true });
loadAsteroidCatalog().then(() => {
    runSimulation();
});

async function loadAsteroidCatalog() {
    if (!asteroidSelect) return;
    try {
        asteroidSelect.disabled = true;
        const response = await fetch('/api/asteroids?limit=20');
        if (!response.ok) throw new Error('Catalog fetch failed');
        const payload = await response.json();
        const options = payload.objects || [];
        asteroidSelect.innerHTML = '';
        options.forEach((obj, idx) => {
            const option = document.createElement('option');
            option.value = obj.friendly_id || obj.asteroid_id;
            option.dataset.asteroidId = obj.asteroid_id;
            option.textContent = `${obj.name} (${obj.designation || obj.asteroid_id})`;
            if (idx === 0 && !asteroidSelect.dataset.initialised) {
                option.selected = true;
            }
            asteroidSelect.appendChild(option);
        });
        asteroidSelect.dataset.initialised = 'true';
        if (!options.length) {
            asteroidSelect.innerHTML = '<option value="Impactor-2025">Impactor-2025 (fallback)</option>';
        }
    } catch (error) {
        console.error('Unable to load asteroid catalog', error);
        asteroidSelect.innerHTML = '<option value="Impactor-2025">Impactor-2025 (fallback)</option>';
        asteroidSelect.dataset.initialised = 'true';
    } finally {
        asteroidSelect.disabled = false;
    }
}
