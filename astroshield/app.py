"""AstroShield Flask backend.

Exposes simulation endpoints that calculate impact energy and expected consequences
based on simplified physics. Designed for hackathon pace: clear structure, ample
comments, and defensive programming around user inputs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

import math

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

# -----------------------------------------------------------------------------
# Flask application setup
# -----------------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

# -----------------------------------------------------------------------------
# Domain constants
# -----------------------------------------------------------------------------
ASTEROID_DENSITY_KG_M3 = 3000  # Average rocky asteroid density
EARTH_DENSITY_KG_M3 = 5515  # Not directly used yet, but useful for extensions
MEGATON_TNT_JOULES = 4.184e15  # Conversion factor from Joules to megatons TNT
MIN_EFFECTIVE_VELOCITY_MS = 1.0  # Prevent zero or negative velocities


@dataclass
class SimulationResult:
    """Typed container for simulation outputs."""

    energy_mt: float
    crater_diameter_km: float
    seismic_magnitude: float
    impact_lat: float
    impact_lon: float
    tsunami_risk: bool
    deflection_delta_v: float
    effective_velocity_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "energy_mt": self.energy_mt,
            "crater_diameter_km": self.crater_diameter_km,
            "seismic_magnitude": self.seismic_magnitude,
            "impact_lat": self.impact_lat,
            "impact_lon": self.impact_lon,
            "tsunami_risk": self.tsunami_risk,
            "deflection_delta_v": self.deflection_delta_v,
            "effective_velocity_ms": self.effective_velocity_ms,
        }


# -----------------------------------------------------------------------------
# Core physics helpers
# -----------------------------------------------------------------------------
def calculate_impact_energy(
    diameter_m: float,
    velocity_kms: float,
    deflection_delta_v: float,
) -> Dict[str, float]:
    """Compute impact kinetic energy and related secondary values.

    Parameters
    ----------
    diameter_m:
        Asteroid diameter in meters.
    velocity_kms:
        Approach velocity in kilometres per second.
    deflection_delta_v:
        Applied mitigation delta-v in metres per second. Positive values reduce
        impact velocity; negative values represent an unfortunate speed-up.

    Returns
    -------
    dict with keys:
        "energy_mt": kinetic energy in megatons TNT.
        "effective_velocity_ms": velocity after mitigation, metres per second.
        "mass_kg": computed asteroid mass.
    """

    radius_m = max(diameter_m / 2.0, 0.0)
    volume_m3 = (4.0 / 3.0) * math.pi * radius_m**3
    mass_kg = volume_m3 * ASTEROID_DENSITY_KG_M3

    velocity_ms = velocity_kms * 1000.0
    effective_velocity_ms = max(velocity_ms - deflection_delta_v, MIN_EFFECTIVE_VELOCITY_MS)

    kinetic_energy_joules = 0.5 * mass_kg * effective_velocity_ms**2
    energy_mt = kinetic_energy_joules / MEGATON_TNT_JOULES

    return {
        "energy_mt": energy_mt,
        "effective_velocity_ms": effective_velocity_ms,
        "mass_kg": mass_kg,
    }


def calculate_consequences(energy_mt: float) -> Dict[str, float]:
    """Derive surface consequences from impact energy.

    Uses intentionally simple scaling laws suitable for educational tooling.
    """

    energy_mt = max(energy_mt, 0.0)
    energy_joules = energy_mt * MEGATON_TNT_JOULES

    # Crater diameter scaling: order-of-magnitude, tuned for accessibility
    crater_diameter_km = 0.1 * (energy_mt ** (1.0 / 3.0))
    crater_diameter_km = max(crater_diameter_km, 0.0)

    # Gutenberg-Richter inspired conversion between energy and magnitude
    seismic_magnitude = 0.67 * math.log10(max(energy_joules, 1.0)) - 5.8

    return {
        "crater_diameter_km": crater_diameter_km,
        "seismic_magnitude": seismic_magnitude,
    }


# -----------------------------------------------------------------------------
# Flask routes
# -----------------------------------------------------------------------------
@app.route("/")
def index() -> str:
    """Serve the single-page application."""

    return render_template("index.html")


@app.route("/api/simulate", methods=["POST"])
def simulate() -> Any:
    """Run the asteroid impact simulation with provided parameters."""

    payload = request.get_json(force=True, silent=True) or {}

    diameter_m = float(payload.get("diameter_m", 150.0))
    velocity_kms = float(payload.get("velocity_kms", 20.0))
    deflection_delta_v = float(payload.get("deflection_delta_v", 0.0))
    impact_lat = float(payload.get("impact_lat", 34.05))
    impact_lon = float(payload.get("impact_lon", -118.25))

    energy_context = calculate_impact_energy(diameter_m, velocity_kms, deflection_delta_v)
    consequence_context = calculate_consequences(energy_context["energy_mt"])

    tsunami_risk = 30.0 <= impact_lat <= 40.0

    result = SimulationResult(
        energy_mt=energy_context["energy_mt"],
        crater_diameter_km=consequence_context["crater_diameter_km"],
        seismic_magnitude=consequence_context["seismic_magnitude"],
        impact_lat=impact_lat,
        impact_lon=impact_lon,
        tsunami_risk=tsunami_risk,
        deflection_delta_v=deflection_delta_v,
        effective_velocity_ms=energy_context["effective_velocity_ms"],
    )

    return jsonify(result.to_dict())


if __name__ == "__main__":
    # Enable reloader for hackathon-friendly rapid iteration.
    app.run(debug=True)
