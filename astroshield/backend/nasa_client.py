"""NASA Near-Earth Object API integration helpers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

import logging
import math

import requests


logger = logging.getLogger(__name__)

NASA_API_ROOT = "https://api.nasa.gov/neo/rest/v1"
DEFAULT_TIMEOUT = 10


class NASAAPIError(RuntimeError):
    """Raised when the NASA NEO API request fails."""


@dataclass(frozen=True)
class NEOCatalogEntry:
    """Subset of NEO attributes exposed to the client/UI."""

    asteroid_id: str
    name: str
    designation: str
    absolute_magnitude_h: Optional[float]
    diameter_min_m: Optional[float]
    diameter_max_m: Optional[float]
    is_potentially_hazardous: bool
    orbit_class: Optional[str]
    close_approach_date: Optional[str]
    relative_velocity_kms: Optional[float]


class NASAClient:
    """Lightweight NASA NEO API wrapper with caching and graceful fallbacks."""

    def __init__(self, api_key: str, session: Optional[requests.Session] = None) -> None:
        self.api_key = api_key or "DEMO_KEY"
        self.session = session or requests.Session()
        self._neo_cache: Dict[str, Dict[str, object]] = {}
        self._catalog_cache: Dict[tuple[int, int], List[NEOCatalogEntry]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def fetch_neo(self, asteroid_id: str) -> Dict[str, object]:
        """Return the raw NASA payload for the requested asteroid."""

        path = f"/neo/{asteroid_id}"
        if asteroid_id in self._neo_cache:
            return self._neo_cache[asteroid_id]
        payload = self._request_json(path)
        self._neo_cache[asteroid_id] = payload
        return payload

    def list_featured(self, *, page: int = 0, page_size: int = 12) -> List[NEOCatalogEntry]:
        """Return a curated list of NEOs suitable for dropdown selectors."""

        cache_key = (page, page_size)
        if cache_key in self._catalog_cache:
            return self._catalog_cache[cache_key]

        payload = self._request_json(
            "/neo/browse",
            params={"page": page, "size": page_size},
        )
        objects = payload.get("near_earth_objects", [])
        entries: List[NEOCatalogEntry] = []
        for item in objects:
            try:
                entries.append(self._to_catalog_entry(item))
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.debug("Failed to parse NASA catalog entry %s: %s", item.get("id"), exc)
        self._catalog_cache[cache_key] = entries
        return entries

    def fetch_orbital_elements(self, asteroid_id: str) -> Dict[str, float]:
        """Shortcut to NASA orbital elements (AU/degrees)."""

        payload = self.fetch_neo(asteroid_id)
        return self._parse_orbital_elements(payload)

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------
    def to_physics_payload(self, payload: Dict[str, object]) -> Dict[str, object]:
        """Normalise NASA NEO payload into AstroShield simulation schema."""

        estimated = payload.get("estimated_diameter", {}).get("meters", {})
        diameter_min = self._safe_float(estimated.get("estimated_diameter_min"))
        diameter_max = self._safe_float(estimated.get("estimated_diameter_max"))
        diameter_avg = None
        if diameter_min and diameter_max:
            diameter_avg = (diameter_min + diameter_max) / 2.0
        elif diameter_min:
            diameter_avg = diameter_min
        elif diameter_max:
            diameter_avg = diameter_max

        close_approach = payload.get("close_approach_data", [])
        first_approach = close_approach[0] if close_approach else {}
        rel_velocity = first_approach.get("relative_velocity", {}) if first_approach else {}
        orbit_data = payload.get("orbital_data", {})

        velocity_kms = self._safe_float(rel_velocity.get("kilometers_per_second"))
        if velocity_kms is None:
            # Convert from semi-major axis and period if velocity unavailable
            velocity_kms = self._approximate_orbital_velocity(orbit_data)

        orbital_elements = self._parse_orbital_elements(payload)

        return {
            "source": "nasa",
            "asteroid_id": str(payload.get("id") or ""),
            "name": payload.get("name", "Unknown"),
            "designation": payload.get("designation") or payload.get("name", "Unknown"),
            "absolute_magnitude_h": self._safe_float(payload.get("absolute_magnitude_h")),
            "diameter_m": diameter_avg,
            "diameter_range_m": (diameter_min, diameter_max),
            "velocity_kms": velocity_kms,
            "is_potentially_hazardous": bool(payload.get("is_potentially_hazardous_asteroid", False)),
            "orbit_class": orbit_data.get("orbit_class", {}).get("orbit_class_description"),
            "close_approach": {
                "date": first_approach.get("close_approach_date"),
                "orbiting_body": first_approach.get("orbiting_body"),
                "miss_distance_km": self._safe_float(first_approach.get("miss_distance", {}).get("kilometers")),
                "relative_velocity_kms": velocity_kms,
            },
            "orbital_elements": orbital_elements,
            "nasa_jpl_url": payload.get("nasa_jpl_url"),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _request_json(self, path: str, params: Optional[Dict[str, object]] = None) -> Dict[str, object]:
        url = f"{NASA_API_ROOT}{path}"
        merged_params = {"api_key": self.api_key}
        if params:
            merged_params.update(params)
        try:
            response = self.session.get(url, params=merged_params, timeout=DEFAULT_TIMEOUT)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:  # pragma: no cover - runtime guard
            raise NASAAPIError(str(exc)) from exc

    def _parse_orbital_elements(self, payload: Dict[str, object]) -> Dict[str, float]:
        orbit = payload.get("orbital_data", {})
        return {
            "semi_major_axis_au": self._safe_float(orbit.get("semi_major_axis")),
            "eccentricity": self._safe_float(orbit.get("eccentricity")),
            "inclination_deg": self._safe_float(orbit.get("inclination")),
            "longitude_ascending_node_deg": self._safe_float(orbit.get("ascending_node_longitude")),
            "argument_periapsis_deg": self._safe_float(orbit.get("perihelion_argument")),
            "mean_anomaly_deg": self._safe_float(orbit.get("mean_anomaly")),
        }

    def _to_catalog_entry(self, payload: Dict[str, object]) -> NEOCatalogEntry:
        estimated = payload.get("estimated_diameter", {}).get("meters", {})
        approach = payload.get("close_approach_data", [])
        first_approach = approach[0] if approach else {}
        rel_velocity = first_approach.get("relative_velocity", {}) if first_approach else {}
        return NEOCatalogEntry(
            asteroid_id=str(payload.get("id")),
            name=payload.get("name", "Unknown"),
            designation=payload.get("designation") or payload.get("name", "Unknown"),
            absolute_magnitude_h=self._safe_float(payload.get("absolute_magnitude_h")),
            diameter_min_m=self._safe_float(estimated.get("estimated_diameter_min")),
            diameter_max_m=self._safe_float(estimated.get("estimated_diameter_max")),
            is_potentially_hazardous=bool(payload.get("is_potentially_hazardous_asteroid", False)),
            orbit_class=(payload.get("orbital_data", {}).get("orbit_class", {}) or {}).get("orbit_class_type"),
            close_approach_date=first_approach.get("close_approach_date"),
            relative_velocity_kms=self._safe_float(rel_velocity.get("kilometers_per_second")),
        )

    def _approximate_orbital_velocity(self, orbit_data: Dict[str, object]) -> Optional[float]:
        try:
            semi_major_axis_au = float(orbit_data.get("semi_major_axis"))
            orbital_period_days = float(orbit_data.get("orbital_period"))
            # v = 2 * pi * a / T. Convert AU to km and days to seconds.
            AU_IN_KM = 149_597_870.7
            circumference_km = 2 * math.pi * semi_major_axis_au * AU_IN_KM
            seconds = orbital_period_days * 24 * 3600
            return circumference_km / seconds
        except (TypeError, ValueError, ZeroDivisionError):
            return None

    @staticmethod
    def _safe_float(value: object) -> Optional[float]:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None
