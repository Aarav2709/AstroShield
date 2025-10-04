export const DEFAULT_COORDS = { lat: 34.05, lon: -118.25 };
export const TNT_JOULES = 4.184e15;
export const ASTEROID_DENSITY = 3000;

export const OFFLINE_BASELINE = {
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
        tsunami_risk: false,
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
        baseline_moid_km: 91000,
        moid_change_km: 4000,
    },
};

export function computeApproximateMass(diameterMeters, templateMassKg) {
    if (templateMassKg) return templateMassKg;
    const radius = Math.max(diameterMeters || 0, 0) / 2;
    const volume = (4 / 3) * Math.PI * radius ** 3;
    return volume * ASTEROID_DENSITY;
}

export function estimateDeflectionOutcome(template, payload) {
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
        const AU_KM = 149_597_870.7;
        const approximateMoidKm = (points) => {
            if (!Array.isArray(points) || !points.length) return 0;
            let minDifference = Number.POSITIVE_INFINITY;
            points.forEach((rawPoint) => {
                if (!rawPoint) return;
                const point = rawPoint;
                const x = Number(point.x) || 0;
                const y = Number(point.y) || 0;
                const z = Number(point.z) || 0;
                const distance = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
                const diff = Math.abs(distance - AU_KM);
                if (diff < minDifference) {
                    minDifference = diff;
                }
            });
            return Number.isFinite(minDifference) ? minDifference : 0;
        };

        const templateBaseline = template.orbital_solution?.baseline_path || clone.orbital_solution.baseline_path || [];
        const templateDeflected = template.orbital_solution?.deflected_path || clone.orbital_solution.deflected_path || templateBaseline;
        const pathLength = templateDeflected.length || templateBaseline.length || 1;

        const velocityRatio = velocityKms > 0 ? deltaV / (velocityKms * 1000) : 0;
        const adjustmentFactor = Math.min(Math.max(velocityRatio, -0.8), 0.8);

        const deflectedPath = templateDeflected.map((point, index) => {
            if (!point) return { x: 0, y: 0, z: 0 };
            const x = Number(point.x) || 0;
            const y = Number(point.y) || 0;
            const z = Number(point.z) || 0;
            const angle = Math.atan2(y, x);
            const radius = Math.hypot(x, y);
            const scale = 1 + adjustmentFactor * 0.32;
            const phaseShift = adjustmentFactor * 0.45;
            const wave = Math.sin((index / pathLength) * Math.PI * 2 + adjustmentFactor * 1.6);
            const verticalOffset = adjustmentFactor * 2_400_000 * wave;
            return {
                x: radius * scale * Math.cos(angle + phaseShift),
                y: radius * scale * Math.sin(angle + phaseShift),
                z: z * (1 - adjustmentFactor * 0.2) + verticalOffset,
            };
        });

        const baselinePath = templateBaseline.map((point) => ({
            x: Number(point?.x) || 0,
            y: Number(point?.y) || 0,
            z: Number(point?.z) || 0,
        }));

        const baselineMoid = clone.orbital_solution.baseline_moid_km ?? approximateMoidKm(baselinePath);
        const deflectedMoid = approximateMoidKm(deflectedPath);
        const moidChange = baselineMoid - deflectedMoid;

        clone.orbital_solution.baseline_path = baselinePath;
        clone.orbital_solution.deflected_path = deflectedPath;
        clone.orbital_solution.baseline_moid_km = baselineMoid;
        clone.orbital_solution.deflected_moid_km = Math.max(0, deflectedMoid);
        clone.orbital_solution.moid_change_km = moidChange;
    }

    return clone;
}
