"""Physics utilities powering the AstroShield simulation backend."""
from __future__ import annotations

from dataclasses import asdict
from typing import Dict, Iterable, List, Tuple

import math

from scipy import constants

from .data_mock import OrbitalElements

# -----------------------------------------------------------------------------
# Shared constants
# -----------------------------------------------------------------------------
ASTEROID_DENSITY_KG_M3 = 3000.0
MEGATON_TNT_JOULES = 4.184e15
MIN_EFFECTIVE_VELOCITY_MS = 1.0
AU_IN_KM = constants.astronomical_unit / 1000.0  # Convert to kilometres


# -----------------------------------------------------------------------------
# Utility helpers
# -----------------------------------------------------------------------------
def _ensure_mass_kg(
    diameter_m: float,
    density_kg_m3: float = ASTEROID_DENSITY_KG_M3,
) -> float:
    radius_m = max(diameter_m, 0.0) / 2.0
    volume_m3 = (4.0 / 3.0) * math.pi * radius_m**3
    return volume_m3 * density_kg_m3


def _effective_velocity_ms(velocity_kms: float, delta_v_ms: float) -> float:
    return max(velocity_kms * 1000.0 - delta_v_ms, MIN_EFFECTIVE_VELOCITY_MS)


# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------
def calculate_kinetic_energy(
    mass_kg: float | None,
    velocity_kms: float,
    delta_v_ms: float,
    *,
    diameter_m: float | None = None,
    density_kg_m3: float = ASTEROID_DENSITY_KG_M3,
) -> Dict[str, float]:
    """Return kinetic energy metrics in Joules and TNT megatons."""

    if mass_kg is None:
        if diameter_m is None:
            raise ValueError("Either mass_kg or diameter_m must be provided")
        mass_kg = _ensure_mass_kg(diameter_m, density_kg_m3)

    effective_velocity_ms = _effective_velocity_ms(velocity_kms, delta_v_ms)
    kinetic_energy_joules = 0.5 * mass_kg * effective_velocity_ms**2
    energy_mt = kinetic_energy_joules / MEGATON_TNT_JOULES

    return {
        "mass_kg": mass_kg,
        "effective_velocity_ms": effective_velocity_ms,
        "energy_joules": kinetic_energy_joules,
        "energy_mt": energy_mt,
    }


def calculate_crater_scaling(energy_mt: float) -> float:
    """Estimate transient crater diameter in kilometres.

    Based on simplified pi-scaling relationships tuned for demonstrative impact
    visualisations. Maintains non-negative outputs.
    """

    energy_mt = max(energy_mt, 0.0)
    diameter_km = 0.11 * energy_mt ** (1.0 / 3.0)
    return max(diameter_km, 0.0)


def calculate_seismic_magnitude(energy_mt: float) -> float:
    """Approximate local moment magnitude from impact energy."""

    energy_joules = max(energy_mt * MEGATON_TNT_JOULES, 1.0)
    magnitude = 0.67 * math.log10(energy_joules) - 5.8
    return max(magnitude, 0.0)


# -----------------------------------------------------------------------------
# Orbital mechanics (Keplerian approximation)
# -----------------------------------------------------------------------------
def _rotation_angles(elements: OrbitalElements) -> Tuple[float, float, float]:
    return (
        math.radians(elements.longitude_ascending_node_deg),
        math.radians(elements.inclination_deg),
        math.radians(elements.argument_periapsis_deg),
    )


def _radius_at_true_anomaly(a_km: float, e: float, true_anomaly_rad: float) -> float:
    return (a_km * (1 - e**2)) / (1 + e * math.cos(true_anomaly_rad))


def _point_in_space(elements: OrbitalElements, true_anomaly_rad: float, a_km: float | None = None, e: float | None = None) -> Tuple[float, float, float]:
    a_km = a_km if a_km is not None else elements.semi_major_axis_au * AU_IN_KM
    e = e if e is not None else elements.eccentricity

    r = _radius_at_true_anomaly(a_km, e, true_anomaly_rad)
    omega, inc, argp = _rotation_angles(elements)
    true_lon = argp + true_anomaly_rad

    cos_O = math.cos(omega)
    sin_O = math.sin(omega)
    cos_i = math.cos(inc)
    sin_i = math.sin(inc)
    cos_w = math.cos(true_lon)
    sin_w = math.sin(true_lon)

    x = r * (cos_O * cos_w - sin_O * sin_w * cos_i)
    y = r * (sin_O * cos_w + cos_O * sin_w * cos_i)
    z = r * (sin_w * sin_i)
    return x, y, z


def _sample_true_anomalies(sample_count: int) -> Iterable[float]:
    return (math.radians(angle) for angle in [i * (360.0 / sample_count) for i in range(sample_count)])


def _approximate_moid_km(points_km: Iterable[Tuple[float, float, float]]) -> float:
    """Approximate MOID by minimising radial distance from Earth's orbit (1 AU)."""

    min_difference = float("inf")
    for x, y, z in points_km:
        distance_from_sun_km = math.sqrt(x**2 + y**2 + z**2)
        difference = abs(distance_from_sun_km - AU_IN_KM)
        if difference < min_difference:
            min_difference = difference
    return min_difference


def simulate_orbital_change(
    elements: OrbitalElements,
    delta_v_ms: float,
    *,
    sample_points: int = 180,
) -> Dict[str, object]:
    """Generate baseline and mitigated orbital tracks and MOID estimates."""

    sample_points = max(sample_points, 60)

    # Baseline orbit
    baseline_points: List[Tuple[float, float, float]] = []
    for anomaly in _sample_true_anomalies(sample_points):
        baseline_points.append(_point_in_space(elements, anomaly))

    baseline_moid_km = _approximate_moid_km(baseline_points)

    # Apply delta-v as a fractional adjustment to the semi-major axis and eccentricity
    velocity_adjustment_factor = max(min(delta_v_ms / 12000.0, 0.5), -0.5)
    a_km = elements.semi_major_axis_au * AU_IN_KM
    mitigated_a_km = a_km * (1.0 - 0.3 * velocity_adjustment_factor)
    mitigated_e = max(0.01, min(0.95, elements.eccentricity * (1.0 - 0.6 * velocity_adjustment_factor)))

    deflected_points: List[Tuple[float, float, float]] = []
    for anomaly in _sample_true_anomalies(sample_points):
        deflected_points.append(_point_in_space(elements, anomaly, mitigated_a_km, mitigated_e))

    deflected_moid_km = _approximate_moid_km(deflected_points)

    return {
        "baseline_path": [
            {"x": x, "y": y, "z": z} for x, y, z in baseline_points
        ],
        "deflected_path": [
            {"x": x, "y": y, "z": z} for x, y, z in deflected_points
        ],
        "baseline_moid_km": baseline_moid_km,
        "deflected_moid_km": deflected_moid_km,
        "moid_change_km": baseline_moid_km - deflected_moid_km,
    }
