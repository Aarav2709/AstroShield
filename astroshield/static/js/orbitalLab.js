import OrbitalViz from './OrbitalViz.js';
import {
    OFFLINE_BASELINE,
    estimateDeflectionOutcome,
    DEFAULT_COORDS,
} from './shared/simulationUtils.js';

const gsapRef = window.gsap;
const labRoot = document.querySelector('[data-page="orbital-lab"]');

if (!labRoot) {
    console.debug('Orbital lab script: container not found, skipping initialisation.');
} else {
    const asteroidSelect = document.getElementById('orbital-asteroid-select');
    const deltaVInput = document.getElementById('orbital-deflection-delta-v');
    const deltaVOutput = document.getElementById('orbital-delta-output');
    const runButton = document.getElementById('orbital-run');
    const form = document.getElementById('orbital-form');

    const nameEl = document.getElementById('orbital-neo-name');
    const velocityEl = document.getElementById('orbital-neo-velocity');
    const diameterEl = document.getElementById('orbital-neo-diameter');
    const orbitalViz = new OrbitalViz('orbital-canvas');

    let lastResult = OFFLINE_BASELINE;

    function updateDeltaOutput() {
        if (!deltaVInput || !deltaVOutput) return;
        deltaVOutput.textContent = `${Number(deltaVInput.value).toFixed(0)}`;
    }

    function collectPayload(overrides = {}) {
        return {
            diameter_m: lastResult?.inputs?.diameter_m ?? 210,
            velocity_kms: lastResult?.inputs?.velocity_kms ?? 21.5,
            deflection_delta_v: Number(deltaVInput?.value ?? 0),
            impact_lat: DEFAULT_COORDS.lat,
            impact_lon: DEFAULT_COORDS.lon,
            asteroid_id: asteroidSelect?.value || 'Impactor-2025',
            ...overrides,
        };
    }

    async function loadCatalog() {
        if (!asteroidSelect) return;
        try {
            asteroidSelect.disabled = true;
            const response = await fetch('/api/asteroids?limit=20');
            if (!response.ok) throw new Error('Catalog request failed');
            const payload = await response.json();
            const options = payload.objects || [];
            asteroidSelect.innerHTML = '';
            options.forEach((obj, idx) => {
                const option = document.createElement('option');
                option.value = obj.friendly_id || obj.asteroid_id;
                option.dataset.asteroidId = obj.asteroid_id;
                option.textContent = `${obj.name} (${obj.designation || obj.asteroid_id})`;
                if (idx === 0) option.selected = true;
                asteroidSelect.appendChild(option);
            });
            if (!options.length) {
                asteroidSelect.innerHTML = '<option value="Impactor-2025">Impactor-2025 (fallback)</option>';
            }
        } catch (error) {
            console.error('Unable to load orbital catalog', error);
            asteroidSelect.innerHTML = '<option value="Impactor-2025">Impactor-2025 (fallback)</option>';
        } finally {
            asteroidSelect.disabled = false;
        }
    }

    async function fetchSimulation(payload) {
        if (!payload || payload.asteroid_id === 'Impactor-2025') {
            const offlineEstimate = estimateDeflectionOutcome(OFFLINE_BASELINE, payload) || OFFLINE_BASELINE;
            lastResult = offlineEstimate;
            runButton.disabled = false;
            runButton.textContent = 'Update Trajectory';
            return offlineEstimate;
        }

        try {
            runButton.disabled = true;
            runButton.textContent = 'Updating...';
            const response = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) throw new Error(`Simulation failed (${response.status})`);
            const data = await response.json();
            lastResult = data;
            return data;
        } catch (error) {
            console.error('Orbital lab simulation error', error);
            const estimate = estimateDeflectionOutcome(lastResult, payload);
            if (estimate) {
                lastResult = estimate;
            }
            return estimate;
        } finally {
            runButton.disabled = false;
            runButton.textContent = 'Update Trajectory';
        }
    }

    function renderSummary(data) {
        const neo = data?.neo_reference;
        if (neo) {
            if (nameEl) nameEl.textContent = neo.name || '—';
            if (velocityEl) velocityEl.textContent = neo.velocity_kms ? `${Number(neo.velocity_kms).toFixed(2)} km/s` : '—';
            if (diameterEl) {
                const range = neo.diameter_range_m || {};
                if (range.min_m && range.max_m) {
                    diameterEl.textContent = `${range.min_m.toFixed(0)}–${range.max_m.toFixed(0)} m`;
                } else if (neo.diameter_m) {
                    diameterEl.textContent = `${Number(neo.diameter_m).toFixed(0)} m`;
                } else {
                    diameterEl.textContent = '—';
                }
            }
        }
    }

    function renderSimulation(data) {
        if (!data) return;
        const { orbital_solution } = data;
        if (orbital_solution) {
            orbitalViz.renderPaths(orbital_solution);
        }
        renderSummary(data);
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = collectPayload();
        const data = await fetchSimulation(payload);
        renderSimulation(data);
    });

    deltaVInput?.addEventListener('input', updateDeltaOutput);

    asteroidSelect?.addEventListener('change', async () => {
        const payload = collectPayload({ asteroid_id: asteroidSelect.value });
        const data = await fetchSimulation(payload);
        renderSimulation(data);
    });

    updateDeltaOutput();
    loadCatalog()
        .then(async () => {
            const payload = collectPayload();
            const data = await fetchSimulation(payload);
            renderSimulation(data);
        })
        .catch((error) => {
            console.error('Failed to initialise orbital lab', error);
        });
}
