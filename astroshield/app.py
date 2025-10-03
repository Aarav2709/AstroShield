"""AstroShield Flask application entrypoint."""
from __future__ import annotations

from typing import Any, Dict

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

from config import get_settings
from backend import (
    AstroDataService,
    NEOData,
    calculate_crater_scaling,
    calculate_kinetic_energy,
    calculate_seismic_magnitude,
    simulate_orbital_change,
)


settings = get_settings()
app = Flask(__name__)
app.config.update(JSON_SORT_KEYS=False)
CORS(app)

data_service = AstroDataService(
    nasa_api_key=settings.nasa_api_key,
    enable_live_apis=settings.use_live_apis,
    default_asteroid_id=settings.default_asteroid_id,
)


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
    neo_data = data_service.get_neo_data(asteroid_id)
    neo_reference = neo_data

    # Fill missing or zero inputs with reference values.
    diameter_m = user_inputs["diameter_m"] or float(neo_reference.diameter_m)
    velocity_kms = user_inputs["velocity_kms"] or float(neo_reference.velocity_kms)
    deflection_delta_v = user_inputs["deflection_delta_v"]
    impact_lat = user_inputs["impact_lat"]
    impact_lon = user_inputs["impact_lon"]

    energy_metrics = calculate_kinetic_energy(
        mass_kg=neo_reference.mass_kg,
        velocity_kms=velocity_kms,
        delta_v_ms=deflection_delta_v,
        diameter_m=diameter_m,
        density_kg_m3=float(neo_reference.density_kg_m3),
    )

    crater_diameter_km = calculate_crater_scaling(energy_metrics["energy_mt"])
    seismic_magnitude = calculate_seismic_magnitude(energy_metrics["energy_mt"])

    environment_report = data_service.get_environment_report(impact_lat, impact_lon)
    tsunami_risk = _derive_tsunami_risk(environment_report)

    orbital_solution = simulate_orbital_change(
        neo_reference.orbital_elements,
        deflection_delta_v,
        sample_points=settings.simulation_sample_points,
    )

    diameter_range = {
        "min_m": neo_reference.diameter_range_m[0],
        "max_m": neo_reference.diameter_range_m[1],
    }

    close_approach = {
        "date": neo_reference.close_approach.get("date"),
        "miss_distance_km": neo_reference.close_approach.get("miss_distance_km"),
        "relative_velocity_kms": neo_reference.close_approach.get("relative_velocity_kms"),
        "orbiting_body": neo_reference.close_approach.get("orbiting_body"),
    }

    environment_payload = {
        "elevation_m": environment_report.elevation_m,
        "is_coastal_zone": environment_report.is_coastal_zone,
        "seismic_zone_risk": environment_report.seismic_zone_risk,
        "tsunami_risk": tsunami_risk,
        "tectonic_summary": environment_report.tectonic_summary,
    }

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
            "source": neo_reference.source,
            "asteroid_id": neo_reference.asteroid_id,
            "friendly_id": neo_reference.friendly_id,
            "name": neo_reference.name,
            "designation": neo_reference.designation,
            "absolute_magnitude_h": neo_reference.absolute_magnitude_h,
            "diameter_m": float(neo_reference.diameter_m),
            "diameter_range_m": diameter_range,
            "velocity_kms": float(neo_reference.velocity_kms),
            "density_kg_m3": float(neo_reference.density_kg_m3),
            "mass_kg": neo_reference.mass_kg,
            "orbit_class": neo_reference.orbit_class,
            "is_potentially_hazardous": neo_reference.is_potentially_hazardous,
            "close_approach": close_approach,
            "nasa_jpl_url": neo_reference.nasa_jpl_url,
            "orbital_elements": neo_reference.orbital_elements.__dict__,
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
        "environment": environment_payload,
        "orbital_solution": orbital_solution,
    }

    return jsonify(response)


@app.route("/api/asteroids", methods=["GET"])
def asteroid_catalog() -> Any:
    limit = int(request.args.get("limit", 12))
    catalog = data_service.list_catalog(limit=limit)
    return jsonify({"objects": catalog})


def _derive_tsunami_risk(report: Any) -> bool:
    elevation = getattr(report, "elevation_m", None)
    coastal = getattr(report, "is_coastal_zone", None)
    if elevation is None or coastal is None:
        return False
    try:
        return bool(coastal) and float(elevation) < 75.0
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    app.run(debug=settings.debug)
