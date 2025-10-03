"""USGS data access helpers for elevation and seismic context."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

import logging

import requests


logger = logging.getLogger(__name__)

USGS_ELEVATION_ENDPOINT = "https://nationalmap.gov/epqs/pqs.php"
USGS_GEOSERVE_ENDPOINT = "https://earthquake.usgs.gov/ws/geoserve/regions.json"
DEFAULT_TIMEOUT = 10


class USGSError(RuntimeError):
    """Raised when the USGS services cannot be reached."""


@dataclass(frozen=True)
class EnvironmentReport:
    elevation_m: Optional[float]
    is_coastal_zone: Optional[bool]
    seismic_zone_risk: str
    tectonic_summary: Optional[str]


class USGSClient:
    """Wrapper around public USGS services used by AstroShield."""

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()

    def build_environment_report(self, lat: float, lon: float) -> EnvironmentReport:
        elevation = self._fetch_elevation(lat, lon)
        tectonic_data = self._fetch_geoserve(lat, lon)
        risk = self._classify_seismic_risk(tectonic_data)
        is_coastal = self._estimate_coastal_zone(tectonic_data, elevation)
        summary_text = None
        if tectonic_data:
            summary_text = tectonic_data.get("tectonicSummary", {}).get("text")
        return EnvironmentReport(
            elevation_m=elevation,
            is_coastal_zone=is_coastal,
            seismic_zone_risk=risk,
            tectonic_summary=summary_text,
        )

    # ------------------------------------------------------------------
    # Elevation
    # ------------------------------------------------------------------
    def _fetch_elevation(self, lat: float, lon: float) -> Optional[float]:
        params = {
            "y": lat,
            "x": lon,
            "units": "Meters",
            "output": "json",
        }
        try:
            response = self.session.get(USGS_ELEVATION_ENDPOINT, params=params, timeout=DEFAULT_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            service = data.get("USGS_Elevation_Point_Query_Service", {})
            query = service.get("ElevationQuery", {})
            elevation = query.get("Elevation")
            if elevation in (None, "-1000000"):
                return None
            return float(elevation)
        except requests.RequestException as exc:  # pragma: no cover - runtime guard
            logger.debug("USGS elevation lookup failed: %s", exc)
            return None
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------
    # Geoserve (seismic regions)
    # ------------------------------------------------------------------
    def _fetch_geoserve(self, lat: float, lon: float) -> Dict[str, object]:
        params = {
            "latitude": lat,
            "longitude": lon,
        }
        try:
            response = self.session.get(USGS_GEOSERVE_ENDPOINT, params=params, timeout=DEFAULT_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            return data.get("geoserve", {})
        except requests.RequestException as exc:  # pragma: no cover - runtime guard
            logger.debug("USGS geoserve lookup failed: %s", exc)
            return {}
        except ValueError:
            return {}

    # ------------------------------------------------------------------
    # Classification helpers
    # ------------------------------------------------------------------
    def _classify_seismic_risk(self, geoserve_payload: Dict[str, object]) -> str:
        tectonic_regions = self._extract_region_names(geoserve_payload)
        if not tectonic_regions:
            return "Unknown"
        joined = " ".join(name.lower() for name in tectonic_regions)
        if any(keyword in joined for keyword in ("subduction", "transform", "rift", "trenches")):
            return "Very High"
        if any(keyword in joined for keyword in ("arc", "plate boundary", "fault", "ridge")):
            return "High"
        if any(keyword in joined for keyword in ("stable", "craton", "platform")):
            return "Low"
        return "Moderate"

    def _estimate_coastal_zone(self, geoserve_payload: Dict[str, object], elevation: Optional[float]) -> Optional[bool]:
        tectonic_regions = self._extract_region_names(geoserve_payload)
        if elevation is None:
            return None
        if elevation > 300:
            return False
        if not tectonic_regions:
            return elevation < 75
        joined = " ".join(name.lower() for name in tectonic_regions)
        if any(keyword in joined for keyword in ("coastal", "pacific", "ocean", "gulf", "sea")):
            return True
        if "inland" in joined or "continental interior" in joined:
            return False
        return elevation < 50

    def _extract_region_names(self, geoserve_payload: Dict[str, object]) -> List[str]:
        regions = geoserve_payload.get("regions", {}) if geoserve_payload else {}
        names: List[str] = []
        for category in ("tectonic", "states", "countries"):
            entries = regions.get(category, []) if isinstance(regions, dict) else []
            for entry in entries:
                name = entry.get("name") if isinstance(entry, dict) else None
                if name:
                    names.append(str(name))
        return names
