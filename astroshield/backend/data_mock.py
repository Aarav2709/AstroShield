"""Mock data providers for NASA NEO and USGS style datasets.

The hackathon setting encourages rapid iteration without relying on fragile
network connectivity. These helpers emulate the minimal subset of external data
required by the simulation, allowing the rest of the stack to be developed as if
real integrations existed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from .usgs_client import EnvironmentReport


@dataclass(frozen=True)
class OrbitalElements:
    """Simplified Keplerian orbital elements for a near-Earth object."""

    semi_major_axis_au: float
    eccentricity: float
    inclination_deg: float
    longitude_ascending_node_deg: float
    argument_periapsis_deg: float
    mean_anomaly_deg: float


class MockDataManager:
    """Provides deterministic, curriculum-quality datasets."""

    def __init__(self) -> None:
        self.default_asteroid_id = "Impactor-2025"
        self.aliases: Dict[str, str] = {
            "Impactor-2025": "3542519",
            "Didymos-Alt": "2099942",
        }
        self._neo_catalog: Dict[str, Dict[str, object]] = {
            "Impactor-2025": {
                "asteroid_id": "Impactor-2025",
                "name": "Impactor-2025",
                "designation": "2025-IM",
                "diameter_m": 210.0,
                "velocity_kms": 21.5,
                "density_kg_m3": 3000.0,
                "mass_kg": None,  # Allow physics core to derive from diameter/density
                "absolute_magnitude_h": 21.0,
                "is_potentially_hazardous": True,
                "orbit_class": "Apollo-class Near-Earth Object",
                "close_approach": {
                    "date": "2025-10-12",
                    "orbiting_body": "Earth",
                    "miss_distance_km": 120000.0,
                    "relative_velocity_kms": 21.5,
                },
                "nasa_jpl_url": "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=99942",
                "orbital_elements": OrbitalElements(
                    semi_major_axis_au=1.12,
                    eccentricity=0.23,
                    inclination_deg=6.5,
                    longitude_ascending_node_deg=80.2,
                    argument_periapsis_deg=130.4,
                    mean_anomaly_deg=45.0,
                ),
            },
            "Didymos-Alt": {
                "asteroid_id": "Didymos-Alt",
                "name": "Didymos Reference",
                "designation": "65803 Didymos",
                "diameter_m": 160.0,
                "velocity_kms": 18.0,
                "density_kg_m3": 2900.0,
                "mass_kg": None,
                "absolute_magnitude_h": 18.2,
                "is_potentially_hazardous": False,
                "orbit_class": "Apollo binary system",
                "close_approach": {
                    "date": "2024-11-03",
                    "orbiting_body": "Earth",
                    "miss_distance_km": 630000.0,
                    "relative_velocity_kms": 18.0,
                },
                "nasa_jpl_url": "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=65803",
                "orbital_elements": OrbitalElements(
                    semi_major_axis_au=1.05,
                    eccentricity=0.14,
                    inclination_deg=3.1,
                    longitude_ascending_node_deg=110.0,
                    argument_periapsis_deg=318.0,
                    mean_anomaly_deg=260.0,
                ),
            },
        }

    # ------------------------------------------------------------------
    # NASA-like data
    # ------------------------------------------------------------------
    def get_neo_parameters(self, asteroid_id: str = "Impactor-2025") -> Dict[str, object]:
        """Return canonical parameters for the requested asteroid."""

        return self._neo_catalog.get(asteroid_id, self._neo_catalog[self.default_asteroid_id]).copy()

    @property
    def default_elements(self) -> OrbitalElements:
        return self._neo_catalog[self.default_asteroid_id]["orbital_elements"]

    @property
    def default_diameter(self) -> float:
        return float(self._neo_catalog[self.default_asteroid_id]["diameter_m"])

    @property
    def default_velocity(self) -> float:
        return float(self._neo_catalog[self.default_asteroid_id]["velocity_kms"])

    @property
    def default_density(self) -> float:
        return float(self._neo_catalog[self.default_asteroid_id]["density_kg_m3"])

    # ------------------------------------------------------------------
    # USGS-like data
    # ------------------------------------------------------------------
    def get_usgs_data(self, impact_lat: float, impact_lon: float) -> Dict[str, object]:
        """Return pseudo-environmental attributes for an impact site."""

        southern_california_bounds = {
            "lat": (32.5, 36.5),
            "lon": (-122.0, -114.0),
        }

        coastal = southern_california_bounds["lat"][0] <= impact_lat <= southern_california_bounds["lat"][1] and (
            southern_california_bounds["lon"][0] <= impact_lon <= southern_california_bounds["lon"][1]
        )

        if coastal:
            return {
                "topography_m": 92.0,
                "is_coastal_zone": True,
                "seismic_zone_risk": "High",
            }

        # Default inland profile (e.g., Midwest United States)
        return {
            "topography_m": 265.0,
            "is_coastal_zone": False,
            "seismic_zone_risk": "Moderate",
        }

    # ------------------------------------------------------------------
    # Derived analytics helpers
    # ------------------------------------------------------------------
    def get_tsunami_risk(self, topography_m: float, is_coastal_zone: bool) -> bool:
        """Derive a binary tsunami risk indicator."""

        # Simple heuristic: coastal locations with low-lying terrain are at risk.
        return is_coastal_zone and topography_m < 150.0

    def build_environment_report(self, lat: float, lon: float) -> EnvironmentReport:
        env = self.get_usgs_data(lat, lon)
        return EnvironmentReport(
            elevation_m=env["topography_m"],
            is_coastal_zone=env["is_coastal_zone"],
            seismic_zone_risk=env["seismic_zone_risk"],
            tectonic_summary=None,
        )

    def catalog_snapshot(self, *, limit: int = 12) -> List[Dict[str, object]]:
        entries: List[Dict[str, object]] = []
        for idx, (neo_id, data) in enumerate(self._neo_catalog.items()):
            if idx >= limit:
                break
            entries.append(
                {
                    "asteroid_id": self.aliases.get(neo_id, neo_id),
                    "friendly_id": neo_id,
                    "name": data["name"],
                    "designation": data["designation"],
                    "absolute_magnitude_h": data.get("absolute_magnitude_h"),
                    "diameter_min_m": data["diameter_m"] * 0.9,
                    "diameter_max_m": data["diameter_m"] * 1.1,
                    "relative_velocity_kms": data["velocity_kms"],
                    "close_approach_date": data.get("close_approach", {}).get("date"),
                    "is_potentially_hazardous": data.get("is_potentially_hazardous", False),
                    "orbit_class": data.get("orbit_class"),
                }
            )
        return entries
