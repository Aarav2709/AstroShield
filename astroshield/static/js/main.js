import ImpactViz from './ImpactViz.js';
import OrbitalViz from './OrbitalViz.js';
import DefenseMode from './DefenseMode.js';

const gsapRef = window.gsap;
const TextPlugin = window.TextPlugin;
if (gsapRef && TextPlugin) {
    gsapRef.registerPlugin(TextPlugin);
}

const DEFAULT_COORDS = { lat: 34.05, lon: -118.25 };

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
const neoHazardBadge = document.getElementById('neo-hazard');
const neoMoidEl = document.getElementById('neo-moid');
const neoLinkEl = document.getElementById('neo-link');

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
        return data;
    } catch (error) {
        console.error('Simulation error', error);
        messageEl.classList.add('visible', 'defense-failure');
        messageEl.textContent = 'Simulation error. Please retry.';
        return null;
    } finally {
        runButton.disabled = false;
        runButton.textContent = 'Run Simulation';
    }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------
function renderSimulation(data, { skipDefenseCheck }) {
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

    const hazard = Boolean(neo.is_potentially_hazardous);
    neoHazardBadge.textContent = hazard ? 'Hazardous' : 'Monitored';
    neoHazardBadge.classList.toggle('hazard', hazard);
    neoHazardBadge.classList.toggle('monitored', !hazard);
    neoHazardBadge.dataset.source = neo.source || 'mock';
    neoHazardBadge.title = neo.source === 'nasa'
        ? 'Live data from NASA NeoWs'
        : 'Reference profile (offline fallback)';

    if (neoLinkEl) {
        if (neo.nasa_jpl_url) {
            neoLinkEl.href = neo.nasa_jpl_url;
            neoLinkEl.hidden = false;
        } else {
            neoLinkEl.hidden = true;
            neoLinkEl.removeAttribute('href');
        }
    }
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
