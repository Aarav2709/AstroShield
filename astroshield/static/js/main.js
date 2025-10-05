import ImpactViz from './ImpactViz.js';
import OrbitalViz from './OrbitalViz.js';
import DefenseMode from './DefenseMode.js';
import {
    DEFAULT_COORDS,
    OFFLINE_BASELINE,
    estimateDeflectionOutcome,
} from './shared/simulationUtils.js';

const gsapRef = window?.gsap ?? null;

function initMissionControl() {
    const missionControlSection = document.querySelector('#mission-control');
    if (!missionControlSection) {
        return;
    }

    const statusBadge = missionControlSection.querySelector('#simulation-status');
    const defenseButton = missionControlSection.querySelector('#defend-earth-button');
    const downloadBriefingButton = missionControlSection.querySelector('#download-briefing-button');
    const form = missionControlSection.querySelector('#impact-form');
    if (!form || !defenseButton) {
        return;
    }

    const asteroidSelect = missionControlSection.querySelector('#asteroid-select');
    const diameterInput = missionControlSection.querySelector('#diameter_m');
    const velocityInput = missionControlSection.querySelector('#velocity_kms');
    const deltaVInput = missionControlSection.querySelector('#deflection_delta_v');
    const diameterOutput = missionControlSection.querySelector('#diameter-output');
    const velocityOutput = missionControlSection.querySelector('#velocity-output');
    const deltaVOutput = missionControlSection.querySelector('#delta-v-output');
    const messageEl = missionControlSection.querySelector('#defense-message');
    const defenseCountdown = missionControlSection.querySelector('#defense-countdown');
    const energyOutput = missionControlSection.querySelector('#energy-output');
    const craterOutput = missionControlSection.querySelector('#crater-output');
    const seismicOutput = missionControlSection.querySelector('#seismic-output');
    const moidOutput = missionControlSection.querySelector('#moid-output');
    const elevationOutput = missionControlSection.querySelector('#elevation-output');
    const seismicRiskOutput = missionControlSection.querySelector('#seismic-risk-output');
    const coastalOutput = missionControlSection.querySelector('#coastal-output');
    const neoNameEl = missionControlSection.querySelector('#neo-name');
    const neoDesignationEl = missionControlSection.querySelector('#neo-designation');
    const neoVelocityEl = missionControlSection.querySelector('#neo-velocity');
    const neoDiameterEl = missionControlSection.querySelector('#neo-diameter');
    const neoMagnitudeEl = missionControlSection.querySelector('#neo-magnitude');
    const neoMoidEl = missionControlSection.querySelector('#neo-moid');

    const impactViz = missionControlSection.querySelector('#map') ? new ImpactViz('map') : null;
    const orbitalCanvas = document.getElementById('orbital-canvas');
    const orbitalViz = orbitalCanvas ? new OrbitalViz('orbital-canvas') : null;

    const interactiveControls = [diameterInput, velocityInput, asteroidSelect].filter(Boolean);
    const toggleControls = (disabled) => {
        interactiveControls.forEach((control) => {
            control.disabled = disabled;
        });
        missionControlSection.classList.toggle('defense-locked', disabled);
    };

    const updateDefenseButtonState = (isActive) => {
        if (!defenseButton) return;
        defenseButton.textContent = isActive ? 'Abort Defense Mode' : 'Defend Earth Mode';
        defenseButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    };

    const lockInputs = () => {
        toggleControls(true);
        updateDefenseButtonState(true);
    };

    const unlockInputs = () => {
        toggleControls(false);
        updateDefenseButtonState(false);
    };

    unlockInputs();

    const defenseMode = defenseButton && defenseCountdown && messageEl
        ? new DefenseMode({
            countdownEl: defenseCountdown,
            messageEl,
            onLockInputs: lockInputs,
            onUnlockInputs: unlockInputs,
            onExpire: () => runSimulation({}, { skipDefenseCheck: true }),
        })
        : null;

    let lastSimulationData = null;
    let pendingSimulationHandle = null;

        function setStatus(message, { isBusy = false } = {}) {
            if (!statusBadge) return;
            statusBadge.textContent = message;
            statusBadge.classList.toggle('is-busy', Boolean(isBusy));
        }

        setStatus('Auto-updates on change');

        function updateSliderOutputs(arg = true) {
            const shouldSchedule = typeof arg === 'boolean' ? arg : true;
            if (diameterInput && diameterOutput) {
                diameterOutput.textContent = `${Number(diameterInput.value).toFixed(0)}`;
            }
            if (velocityInput && velocityOutput) {
                velocityOutput.textContent = `${Number(velocityInput.value).toFixed(1)}`;
            }
            if (deltaVInput && deltaVOutput) {
                deltaVOutput.textContent = `${Number(deltaVInput.value).toFixed(0)}`;
            }
            if (shouldSchedule) {
                scheduleSimulation();
            }
        }

        function scheduleSimulation(overrides = {}, options = {}) {
            if (pendingSimulationHandle) {
                clearTimeout(pendingSimulationHandle);
            }
            const overridesCopy = { ...overrides };
            const optionsCopy = { ...options };
            setStatus('Updating…', { isBusy: true });
            pendingSimulationHandle = window.setTimeout(() => {
                pendingSimulationHandle = null;
                runSimulation(overridesCopy, optionsCopy);
            }, 220);
        }

        function animateMetric(element, value, suffix, decimals = 1) {
            if (!element) return;
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
                diameter_m: Number(diameterInput?.value ?? 0),
                velocity_kms: Number(velocityInput?.value ?? 0),
                deflection_delta_v: Number(deltaVInput?.value ?? 0),
                impact_lat: DEFAULT_COORDS.lat,
                impact_lon: DEFAULT_COORDS.lon,
                asteroid_id: asteroidSelect?.value || undefined,
                ...overrides,
            };
        }

        function setInputValue(input, value) {
            if (!input || value === undefined || value === null) {
                return;
            }
            const numericValue = Number(value);
            if (Number.isNaN(numericValue)) {
                return;
            }
            const min = Number(input.min ?? numericValue);
            const max = Number(input.max ?? numericValue);
            const clamped = Math.min(Math.max(numericValue, min), max);
            input.value = String(clamped);
        }

        function updateNeoMetadataFromOption(option) {
            if (!option) return;
            const name = option.dataset.name || option.textContent || option.value;
            const designation = option.dataset.designation || option.dataset.asteroidId || '—';
            const velocity = Number(option.dataset.velocityKms);
            const absMag = option.dataset.absoluteMagnitude;
            const diameterMin = Number(option.dataset.diameterMin);
            const diameterMax = Number(option.dataset.diameterMax);
            const moidKm = option.dataset.moidKm;

            if (neoNameEl) neoNameEl.textContent = name;
            if (neoDesignationEl) neoDesignationEl.textContent = designation;
            if (neoVelocityEl) {
                neoVelocityEl.textContent = !Number.isNaN(velocity)
                    ? `${velocity.toFixed(2)} km/s`
                    : '—';
            }
            if (neoDiameterEl) {
                if (!Number.isNaN(diameterMin) && !Number.isNaN(diameterMax) && diameterMin && diameterMax) {
                    neoDiameterEl.textContent = `${Math.round(diameterMin)}–${Math.round(diameterMax)} m`;
                } else {
                    const median = Number(option.dataset.diameterMedian);
                    neoDiameterEl.textContent = !Number.isNaN(median) ? `${Math.round(median)} m` : '—';
                }
            }
            if (neoMagnitudeEl) {
                neoMagnitudeEl.textContent = absMag !== undefined && absMag !== null && absMag !== ''
                    ? Number(absMag).toFixed(1)
                    : '—';
            }
            if (neoMoidEl) {
                neoMoidEl.textContent = moidKm ? `${Number(moidKm).toLocaleString()} km` : '—';
            }
        }

        function enrichNeoReferenceFromOption(neo, option) {
            if (!option) return neo;
            const clone = {
                ...(neo || {}),
            };
            clone.name = option.dataset.name || clone.name;
            clone.designation = option.dataset.designation || clone.designation;
            const absMag = option.dataset.absoluteMagnitude;
            if (absMag !== undefined && absMag !== null && absMag !== '') {
                clone.absolute_magnitude_h = Number(absMag);
            }
            const velocity = Number(option.dataset.velocityKms);
            if (!Number.isNaN(velocity)) {
                clone.velocity_kms = velocity;
            }
            const diameterMin = Number(option.dataset.diameterMin);
            const diameterMax = Number(option.dataset.diameterMax);
            const diameterMedian = Number(option.dataset.diameterMedian);
            const derivedRange = {
                min_m: !Number.isNaN(diameterMin) ? diameterMin : (clone.diameter_range_m?.min_m ?? diameterMedian),
                max_m: !Number.isNaN(diameterMax) ? diameterMax : (clone.diameter_range_m?.max_m ?? diameterMedian),
            };
            clone.diameter_range_m = derivedRange;
            if (!Number.isNaN(diameterMedian)) {
                clone.diameter_m = diameterMedian;
            }
            const moidKm = option.dataset.moidKm;
            const closeApproach = {
                ...(clone.close_approach || {}),
            };
            if (moidKm) {
                closeApproach.miss_distance_km = Number(moidKm);
            }
            clone.close_approach = closeApproach;
            clone.friendly_id = option.value || clone.friendly_id;
            clone.asteroid_id = option.dataset.asteroidId || clone.asteroid_id;
            return clone;
        }

        function applyCatalogDefaults(option) {
            if (!option) return;
            const diameterMedian = Number(option.dataset.diameterMedian);
            const velocityKms = Number(option.dataset.velocityKms);
            if (!Number.isNaN(diameterMedian)) {
                setInputValue(diameterInput, diameterMedian);
            }
            if (!Number.isNaN(velocityKms)) {
                setInputValue(velocityInput, velocityKms);
            }
            setInputValue(deltaVInput, 0);
            updateSliderOutputs(false);
            updateNeoMetadataFromOption(option);
        }

        function applyNeoDefaultsFromNeo(neo) {
            if (!neo) return;
            if (neo.diameter_m) {
                setInputValue(diameterInput, neo.diameter_m);
            }
            if (neo.velocity_kms) {
                setInputValue(velocityInput, neo.velocity_kms);
            }
            updateSliderOutputs(false);
        }

        function makeFallbackOption() {
            const option = document.createElement('option');
            option.value = 'Impactor-2025';
            option.textContent = 'Impactor-2025 (offline baseline)';
            option.dataset.diameterMedian = String(OFFLINE_BASELINE.inputs?.diameter_m ?? 210);
            option.dataset.velocityKms = String(OFFLINE_BASELINE.inputs?.velocity_kms ?? 21.5);
            option.dataset.deltaV = String(OFFLINE_BASELINE.inputs?.deflection_delta_v ?? 0);
            option.dataset.name = OFFLINE_BASELINE.neo_reference?.name || 'Impactor-2025';
            option.dataset.designation = OFFLINE_BASELINE.neo_reference?.designation || '2025-IM';
            option.dataset.absoluteMagnitude = OFFLINE_BASELINE.neo_reference?.absolute_magnitude_h ?? '21.0';
            option.dataset.diameterMin = String(OFFLINE_BASELINE.neo_reference?.diameter_range_m?.min_m ?? 190);
            option.dataset.diameterMax = String(OFFLINE_BASELINE.neo_reference?.diameter_range_m?.max_m ?? 230);
            option.dataset.moidKm = String(OFFLINE_BASELINE.neo_reference?.close_approach?.miss_distance_km ?? '');
            return option;
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
            if (!defenseMode || !messageEl) return;
            defenseMode.cancel();
            updateDefenseButtonState(false);
            messageEl.classList.remove('visible', 'defense-success', 'defense-failure');
            messageEl.textContent = '';
        }

        function clearStatusMessage() {
            if (!messageEl || defenseMode?.isActive()) return;
            messageEl.classList.remove('visible', 'defense-success', 'defense-failure');
            messageEl.textContent = '';
        }

        async function runSimulation(overrides = {}, { skipDefenseCheck = false, applyNeoDefaults = false } = {}) {
            if (pendingSimulationHandle) {
                clearTimeout(pendingSimulationHandle);
                pendingSimulationHandle = null;
            }

            const payload = collectPayload(overrides);
            const isOfflineAsteroid = payload.asteroid_id === 'Impactor-2025';
            const selectedOption = asteroidSelect?.selectedOptions?.[0];

            setStatus('Updating…', { isBusy: true });

            if (isOfflineAsteroid) {
                const offlineInputs = {
                    ...OFFLINE_BASELINE.inputs,
                    diameter_m: payload.diameter_m || OFFLINE_BASELINE.inputs.diameter_m,
                    velocity_kms: payload.velocity_kms || OFFLINE_BASELINE.inputs.velocity_kms,
                    deflection_delta_v: payload.deflection_delta_v ?? OFFLINE_BASELINE.inputs.deflection_delta_v,
                };
                setInputValue(diameterInput, offlineInputs.diameter_m);
                setInputValue(velocityInput, offlineInputs.velocity_kms);
                setInputValue(deltaVInput, offlineInputs.deflection_delta_v);
                updateSliderOutputs(false);

                const offlineData = JSON.parse(JSON.stringify(OFFLINE_BASELINE));
                offlineData.inputs = offlineInputs;
                offlineData.neo_reference = enrichNeoReferenceFromOption(offlineData.neo_reference, selectedOption);
                updateNeoMetadataFromOption(selectedOption);

                renderSimulation(offlineData, { skipDefenseCheck: true });
                lastSimulationData = offlineData;
                setStatus('Offline baseline ready', { isBusy: false });
                clearStatusMessage();
                return offlineData;
            }

            try {
                const response = await fetch('/api/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!response.ok) {
                    throw new Error(`Simulation failed with status ${response.status}`);
                }
                const data = await response.json();
                if (applyNeoDefaults) {
                    applyNeoDefaultsFromNeo(data.neo_reference);
                }
                renderSimulation(data, { skipDefenseCheck });
                lastSimulationData = data;
                clearStatusMessage();
                const source = data?.neo_reference?.source;
                if (source === 'nasa') {
                    setStatus('NASA data synced', { isBusy: false });
                } else if (source === 'mock') {
                    setStatus('Fallback model active', { isBusy: false });
                } else {
                    setStatus('Simulation updated', { isBusy: false });
                }
                return data;
            } catch (error) {
                console.error('Simulation error', error);
                let fallback = lastSimulationData || OFFLINE_BASELINE;
                if (applyNeoDefaults && payload.asteroid_id && fallback?.inputs?.asteroid_id !== payload.asteroid_id) {
                    fallback = estimateDeflectionOutcome(OFFLINE_BASELINE, payload) || OFFLINE_BASELINE;
                }
                const isDefenseActive = defenseMode?.isActive?.() ?? false;
                const approximated = isDefenseActive ? estimateDeflectionOutcome(fallback, payload) : fallback;
                if (approximated && applyNeoDefaults) {
                    approximated.neo_reference = enrichNeoReferenceFromOption(
                        { ...(approximated.neo_reference || {}) },
                        selectedOption,
                    );
                }
                clearStatusMessage();
                if (approximated) {
                    if (applyNeoDefaults) {
                        applyNeoDefaultsFromNeo(approximated.neo_reference);
                    }
                    renderSimulation(approximated, { skipDefenseCheck: !isDefenseActive });
                    lastSimulationData = approximated;
                    setStatus('Fallback model active', { isBusy: false });
                    return approximated;
                }
                setStatus('Simulation unavailable', { isBusy: false });
                return null;
            }
        }

        function renderSimulation(data, { skipDefenseCheck = false } = {}) {
            const { inputs, impact_effects, energy, environment, orbital_solution, neo_reference } = data;

            if (impactViz) {
                impactViz.updateImpact({
                    lat: inputs.impact_lat,
                    lon: inputs.impact_lon,
                    craterDiameterKm: impact_effects.crater_diameter_km,
                    tsunamiRisk: environment.tsunami_risk,
                });
            }

            if (orbitalViz && orbital_solution) {
                orbitalViz.renderPaths(orbital_solution);
            }

            renderNeoOverview(neo_reference);
            renderEnvironment(environment);

            animateMetric(energyOutput, energy?.energy_mt, ' MT', 2);
            animateMetric(craterOutput, impact_effects?.crater_diameter_km, ' km', 2);
            animateMetric(seismicOutput, impact_effects?.seismic_magnitude, ' Mw', 2);
            animateMetric(moidOutput, orbital_solution?.deflected_moid_km, ' km', 0);

            if (defenseMode?.isActive()) {
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
            if (neoNameEl) neoNameEl.textContent = neo.name || '—';
            if (neoDesignationEl) neoDesignationEl.textContent = neo.designation || '—';
            if (neoVelocityEl) neoVelocityEl.textContent = neo.velocity_kms ? `${Number(neo.velocity_kms).toFixed(2)} km/s` : '—';
            const diameterRange = neo.diameter_range_m || {};
            if (neoDiameterEl) {
                if (diameterRange.min_m && diameterRange.max_m) {
                    neoDiameterEl.textContent = `${diameterRange.min_m.toFixed(0)}–${diameterRange.max_m.toFixed(0)} m`;
                } else if (neo.diameter_m) {
                    neoDiameterEl.textContent = `${Number(neo.diameter_m).toFixed(0)} m`;
                } else {
                    neoDiameterEl.textContent = '—';
                }
            }
            if (neoMagnitudeEl) {
                neoMagnitudeEl.textContent = neo.absolute_magnitude_h ? neo.absolute_magnitude_h.toFixed(1) : '—';
            }
            if (neoMoidEl) {
                neoMoidEl.textContent = neo.close_approach?.miss_distance_km
                    ? `${Number(neo.close_approach.miss_distance_km).toLocaleString()} km`
                    : '—';
            }
        }

        function renderEnvironment(environment) {
            if (!environment) return;
            const elevation = environment.elevation_m;
            if (elevationOutput) {
                elevationOutput.textContent = typeof elevation === 'number'
                    ? `${elevation.toFixed(0)} m`
                    : '—';
            }
            if (seismicRiskOutput) {
                seismicRiskOutput.textContent = environment.seismic_zone_risk || 'Unknown';
            }
            if (coastalOutput) {
                const coastal = environment.is_coastal_zone;
                if (coastal === null || coastal === undefined) {
                    coastalOutput.textContent = 'Unknown';
                } else {
                    coastalOutput.textContent = coastal ? 'Coastal' : 'Inland';
                }
            }
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            scheduleSimulation();
        });

        if (diameterInput) diameterInput.addEventListener('input', updateSliderOutputs);
        if (velocityInput) velocityInput.addEventListener('input', updateSliderOutputs);
        if (deltaVInput) deltaVInput.addEventListener('input', updateSliderOutputs);

        asteroidSelect?.addEventListener('change', () => {
            const selectedOption = asteroidSelect?.selectedOptions?.[0];
            if (selectedOption) {
                applyCatalogDefaults(selectedOption);
            }
            if (asteroidSelect) {
                asteroidSelect.dataset.lastSelection = asteroidSelect.value;
            }
            resetDefenseStateUI();
            scheduleSimulation({
                asteroid_id: asteroidSelect?.value,
                diameter_m: Number(diameterInput?.value ?? 0),
                velocity_kms: Number(velocityInput?.value ?? 0),
            }, { applyNeoDefaults: true });
        });

        if (downloadBriefingButton) {
            downloadBriefingButton.addEventListener('click', async () => {
                if (downloadBriefingButton.disabled) return;
                try {
                    downloadBriefingButton.disabled = true;
                    setStatus('Preparing briefing…', { isBusy: true });
                    const payload = collectPayload();
                    const response = await fetch('/api/export/scenario', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!response.ok) {
                        throw new Error(`Scenario export failed: ${response.status}`);
                    }
                    const blob = await response.blob();
                    const filename = `astroshield_${payload.asteroid_id || 'scenario'}.pptx`;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    setStatus('Briefing downloaded', { isBusy: false });
                } catch (error) {
                    console.error('Briefing export failed', error);
                    setStatus('Briefing unavailable', { isBusy: false });
                } finally {
                    downloadBriefingButton.disabled = false;
                }
            });
        }

        defenseButton.addEventListener('click', async () => {
            if (!defenseMode) return;
            if (defenseMode.isActive()) {
                resetDefenseStateUI();
                if (diameterInput) diameterInput.value = 210;
                if (velocityInput) velocityInput.value = 21.5;
                if (deltaVInput) deltaVInput.value = 0;
                updateSliderOutputs(false);
                runSimulation();
                return;
            }

            const scenario = defenseMode.start();
            if (diameterInput) diameterInput.value = scenario.diameter_m;
            if (velocityInput) velocityInput.value = scenario.velocity_kms;
            if (deltaVInput) deltaVInput.value = 0;
            updateSliderOutputs(false);
            await runSimulation({
                diameter_m: scenario.diameter_m,
                velocity_kms: scenario.velocity_kms,
                deflection_delta_v: 0,
                impact_lat: scenario.impact_lat,
                impact_lon: scenario.impact_lon,
            }, { skipDefenseCheck: true });
        });

        bindTooltips();
        updateSliderOutputs(false);
        lastSimulationData = OFFLINE_BASELINE;
        renderSimulation(OFFLINE_BASELINE, { skipDefenseCheck: true });
        loadAsteroidCatalog()
            .then(() => {
                scheduleSimulation({
                    asteroid_id: asteroidSelect?.value,
                    diameter_m: Number(diameterInput?.value ?? 0),
                    velocity_kms: Number(velocityInput?.value ?? 0),
                }, { applyNeoDefaults: true, skipDefenseCheck: true });
            })
            .catch((error) => {
                console.error('Catalog initialisation failed', error);
            });

        async function loadAsteroidCatalog() {
            if (!asteroidSelect) return;
            const previousSelection = asteroidSelect.dataset.lastSelection || asteroidSelect.value;
            try {
                asteroidSelect.disabled = true;
                const response = await fetch('/api/asteroids?limit=20');
                if (!response.ok) throw new Error('Catalog fetch failed');
                const payload = await response.json();
                const options = payload.objects || [];
                asteroidSelect.innerHTML = '';

                const optionElements = [];
                options.forEach((obj) => {
                    const option = document.createElement('option');
                    option.value = obj.friendly_id || obj.asteroid_id;
                    option.dataset.asteroidId = obj.asteroid_id;
                    option.dataset.diameterMedian = String(
                        obj.diameter_min_m && obj.diameter_max_m
                            ? (Number(obj.diameter_min_m) + Number(obj.diameter_max_m)) / 2
                            : OFFLINE_BASELINE.inputs?.diameter_m || 210,
                    );
                    option.dataset.velocityKms = String(obj.relative_velocity_kms || OFFLINE_BASELINE.inputs?.velocity_kms || 21.5);
                    option.dataset.diameterMin = obj.diameter_min_m ? String(obj.diameter_min_m) : option.dataset.diameterMedian;
                    option.dataset.diameterMax = obj.diameter_max_m ? String(obj.diameter_max_m) : option.dataset.diameterMedian;
                    option.dataset.absoluteMagnitude = obj.absolute_magnitude_h ?? '';
                    option.dataset.designation = obj.designation || '';
                    option.dataset.name = obj.name || option.value;
                    option.dataset.moidKm = obj.miss_distance_km ? String(obj.miss_distance_km) : '';
                    option.textContent = `${obj.name} (${obj.designation || obj.asteroid_id})`;
                    asteroidSelect.appendChild(option);
                    optionElements.push(option);
                });

                if (!optionElements.length) {
                    const fallbackOption = makeFallbackOption();
                    asteroidSelect.appendChild(fallbackOption);
                    optionElements.push(fallbackOption);
                }

                const selected = optionElements.find((option) => option.value === previousSelection) || optionElements[0];
                if (selected) {
                    selected.selected = true;
                    asteroidSelect.dataset.lastSelection = selected.value;
                    applyCatalogDefaults(selected);
                }

                asteroidSelect.dataset.initialised = 'true';
            } catch (error) {
                console.error('Unable to load asteroid catalog', error);
                asteroidSelect.innerHTML = '';
                const fallbackOption = makeFallbackOption();
                asteroidSelect.appendChild(fallbackOption);
                asteroidSelect.dataset.initialised = 'true';
                asteroidSelect.dataset.lastSelection = fallbackOption.value;
                applyCatalogDefaults(fallbackOption);
            } finally {
                asteroidSelect.disabled = false;
            }
        }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMissionControl, { once: true });
} else {
    initMissionControl();
}
