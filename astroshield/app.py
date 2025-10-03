"""AstroShield Flask application entrypoint."""
from __future__ import annotations

from typing import Any, Dict

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

from config import get_settings
from backend import (
    MockDataManager,
    calculate_crater_scaling,
    calculate_kinetic_energy,
    calculate_seismic_magnitude,
    simulate_orbital_change,
)


settings = get_settings()
app = Flask(__name__)
app.config.update(JSON_SORT_KEYS=False)
CORS(app)

data_manager = MockDataManager()


def _prepare_inputs(payload: Dict[str, Any]) -> Dict[str, float]:
    return {
        "diameter_m": float(payload.get("diameter_m", 0) or 0),
        "velocity_kms": float(payload.get("velocity_kms", 0) or 0),
        "deflection_delta_v": float(payload.get("deflection_delta_v", 0) or 0),
        "impact_lat": float(payload.get("impact_lat", settings.default_latitude)),
        "impact_lon": float(payload.get("impact_lon", settings.default_longitude)),
    }


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/simulate", methods=["POST"])
def simulate() -> Any:
    payload = request.get_json(silent=True) or {}
    asteroid_id = payload.get("asteroid_id", settings.default_asteroid_id)

    user_inputs = _prepare_inputs(payload)
    neo_reference = data_manager.get_neo_parameters(asteroid_id)

    # Fill missing or zero inputs with reference values.
    diameter_m = user_inputs["diameter_m"] or float(neo_reference["diameter_m"])
    velocity_kms = user_inputs["velocity_kms"] or float(neo_reference["velocity_kms"])
    deflection_delta_v = user_inputs["deflection_delta_v"]
    impact_lat = user_inputs["impact_lat"]
    impact_lon = user_inputs["impact_lon"]

    energy_metrics = calculate_kinetic_energy(
        mass_kg=neo_reference.get("mass_kg"),
        velocity_kms=velocity_kms,
        delta_v_ms=deflection_delta_v,
        diameter_m=diameter_m,
        density_kg_m3=float(neo_reference.get("density_kg_m3", 3000.0)),
    )

    crater_diameter_km = calculate_crater_scaling(energy_metrics["energy_mt"])
    seismic_magnitude = calculate_seismic_magnitude(energy_metrics["energy_mt"])

    usgs = data_manager.get_usgs_data(impact_lat, impact_lon)
    tsunami_risk = data_manager.get_tsunami_risk(usgs["topography_m"], usgs["is_coastal_zone"])

    orbital_solution = simulate_orbital_change(
        neo_reference["orbital_elements"],
        deflection_delta_v,
        sample_points=settings.simulation_sample_points,
    )

    response = {
        "inputs": {
            "diameter_m": diameter_m,
            "velocity_kms": velocity_kms,
            "deflection_delta_v": deflection_delta_v,
            "impact_lat": impact_lat,
            "impact_lon": impact_lon,
            "asteroid_id": asteroid_id,
        },
        "neo_reference": {
            "diameter_m": float(neo_reference["diameter_m"]),
            "velocity_kms": float(neo_reference["velocity_kms"]),
            "density_kg_m3": float(neo_reference["density_kg_m3"]),
            "orbital_elements": neo_reference["orbital_elements"].__dict__,
        },
        "energy": {
            "mass_kg": energy_metrics["mass_kg"],
            "effective_velocity_ms": energy_metrics["effective_velocity_ms"],
            "energy_mt": energy_metrics["energy_mt"],
            "energy_joules": energy_metrics["energy_joules"],
        },
        "impact_effects": {
            "crater_diameter_km": crater_diameter_km,
            "seismic_magnitude": seismic_magnitude,
        },
        "environment": {
            **usgs,
            "tsunami_risk": tsunami_risk,
        },
        "orbital_solution": orbital_solution,
    }

    return jsonify(response)


if __name__ == "__main__":
    app.run(debug=settings.debug)
