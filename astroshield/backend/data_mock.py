"""Mock data providers for NASA NEO and USGS style datasets.

The hackathon setting encourages rapid iteration without relying on fragile
network connectivity. These helpers emulate the minimal subset of external data
required by the simulation, allowing the rest of the stack to be developed as if
real integrations existed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


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
        self._neo_catalog: Dict[str, Dict[str, object]] = {
            "Impactor-2025": {
                "diameter_m": 210.0,
                "velocity_kms": 21.5,
                "density_kg_m3": 3000.0,
                "mass_kg": None,  # Allow physics core to derive from diameter/density
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
                "diameter_m": 160.0,
                "velocity_kms": 18.0,
                "density_kg_m3": 2900.0,
                "mass_kg": None,
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

        return self._neo_catalog.get(asteroid_id, self._neo_catalog["Impactor-2025"]).copy()

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
