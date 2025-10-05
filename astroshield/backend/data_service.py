"""High-level data service combining NASA, USGS, and mock fallbacks."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import logging

from .data_mock import MockDataManager, OrbitalElements
from .nasa_client import NASAClient, NASAAPIError, NEOCatalogEntry
from .usgs_client import USGSClient, EnvironmentReport

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NEOData:
    source: str
    asteroid_id: str
    friendly_id: str
    name: str
    designation: str
    absolute_magnitude_h: Optional[float]
    diameter_m: float
    diameter_range_m: Tuple[Optional[float], Optional[float]]
    velocity_kms: float
    density_kg_m3: float
    mass_kg: Optional[float]
    is_potentially_hazardous: bool
    orbit_class: Optional[str]
    close_approach: Dict[str, Optional[float | str]]
    orbital_elements: OrbitalElements
    nasa_jpl_url: Optional[str]


class AstroDataService:
    """Coordinates live NASA/USGS data with deterministic fallbacks."""

    DEFAULT_ALIASES = {
        "Impactor-2025": "3542519",  # Maps challenge asteroid to a hazardous NEO (2010 PK9)
        "Didymos-Alt": "2099942",    # Dimorphos system proxy
        "Apophis": "99942",
        "Bennu": "101955",
    }

    def __init__(self, *, nasa_api_key: str, enable_live_apis: bool = True, default_asteroid_id: Optional[str] = None) -> None:
        self.enable_live_apis = enable_live_apis
        self.mock_manager = MockDataManager()
        self.alias_map = {**self.DEFAULT_ALIASES, **self.mock_manager.aliases}
        self.default_asteroid_id = default_asteroid_id or self.mock_manager.default_asteroid_id
        self.nasa_client = NASAClient(nasa_api_key) if enable_live_apis else None
        self.usgs_client = USGSClient() if enable_live_apis else None

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------
    def get_neo_data(self, asteroid_id: Optional[str]) -> NEOData:
        friendly = asteroid_id or self.default_asteroid_id
        resolved_id = self.alias_map.get(friendly, friendly)

        if self.nasa_client is not None:
            try:
                payload = self.nasa_client.fetch_neo(resolved_id)
                normalised = self.nasa_client.to_physics_payload(payload)
                orbital_elements = self._elements_from_dict(normalised.get("orbital_elements", {}))
                diameter_m = self._ensure_quantity(normalised.get("diameter_m"), fallback=self.mock_manager.default_diameter)
                velocity_kms = self._ensure_quantity(normalised.get("velocity_kms"), fallback=self.mock_manager.default_velocity)
                density = self._ensure_quantity(normalised.get("density_kg_m3"), fallback=self.mock_manager.default_density)

                return NEOData(
                    source="nasa",
                    asteroid_id=str(normalised.get("asteroid_id") or resolved_id),
                    friendly_id=friendly,
                    name=normalised.get("name", friendly),
                    designation=normalised.get("designation", friendly),
                    absolute_magnitude_h=normalised.get("absolute_magnitude_h"),
                    diameter_m=diameter_m,
                    diameter_range_m=normalised.get("diameter_range_m", (None, None)),
                    velocity_kms=velocity_kms,
                    density_kg_m3=density,
                    mass_kg=None,
                    is_potentially_hazardous=bool(normalised.get("is_potentially_hazardous")),
                    orbit_class=normalised.get("orbit_class"),
                    close_approach=normalised.get("close_approach", {}),
                    orbital_elements=orbital_elements,
                    nasa_jpl_url=normalised.get("nasa_jpl_url"),
                )
            except NASAAPIError as exc:  # pragma: no cover - runtime guard
                logger.warning("NASA NEO lookup failed for %s (%s): %s", friendly, resolved_id, exc)
        return self._neo_from_mock(friendly)

    def get_environment_report(self, lat: float, lon: float) -> EnvironmentReport:
        if self.usgs_client is not None:
            report = self.usgs_client.build_environment_report(lat, lon)
            if any(value is not None for value in (report.elevation_m, report.is_coastal_zone)):
                return report
        return self.mock_manager.build_environment_report(lat, lon)

    def list_catalog(self, *, limit: int = 12) -> List[Dict[str, object]]:
        entries: List[Dict[str, object]] = []
        if self.nasa_client is not None:
            try:
                for entry in self.nasa_client.list_featured(page_size=limit):
                    entries.append(self._serialise_catalog_entry(entry))
            except NASAAPIError as exc:  # pragma: no cover - runtime guard
                logger.warning("NASA catalog fetch failed: %s", exc)
        if not entries:
            entries.extend(self.mock_manager.catalog_snapshot(limit=limit))
        default_entry = self._default_catalog_entry()
        if default_entry and not any(item.get("friendly_id") == default_entry.get("friendly_id") for item in entries):
            entries.insert(0, default_entry)
        return entries

    def get_health_snapshot(self, *, latitude: Optional[float] = None, longitude: Optional[float] = None) -> Dict[str, object]:
        """Summarise the health of live integrations and fallbacks."""

        services: Dict[str, Dict[str, object]] = {}

        # NASA status
        if self.nasa_client is None:
            services["nasa_neo_api"] = {
                "status": "disabled",
                "detail": "Live NASA API access disabled; using deterministic mock data.",
            }
        else:
            resolved_id = self._resolve_asteroid_id(self.default_asteroid_id)
            try:
                self.nasa_client.fetch_neo(resolved_id)
                services["nasa_neo_api"] = {"status": "ok"}
            except NASAAPIError as exc:  # pragma: no cover - relies on network
                services["nasa_neo_api"] = {
                    "status": "degraded",
                    "detail": str(exc),
                }
            except Exception as exc:  # pragma: no cover - defensive
                services["nasa_neo_api"] = {
                    "status": "error",
                    "detail": str(exc),
                }

        # USGS status
        if self.usgs_client is None:
            services["usgs_services"] = {
                "status": "disabled",
                "detail": "Live USGS services disabled; using deterministic mock data.",
            }
        else:
            sample_lat = latitude if latitude is not None else 0.0
            sample_lon = longitude if longitude is not None else 0.0
            try:
                report = self.usgs_client.build_environment_report(sample_lat, sample_lon)
                if any(
                    getattr(report, field) is not None
                    for field in ("elevation_m", "is_coastal_zone", "tectonic_summary")
                ):
                    services["usgs_services"] = {"status": "ok"}
                else:
                    services["usgs_services"] = {
                        "status": "degraded",
                        "detail": "No usable data returned for sample location; mock data will be used.",
                    }
            except Exception as exc:  # pragma: no cover - defensive
                services["usgs_services"] = {
                    "status": "error",
                    "detail": str(exc),
                }

        services["mock_data"] = {
            "status": "ok",
            "detail": "Deterministic fallback catalogue available.",
        }

        overall = _aggregate_overall_status(services.values())

        return {
            "status": overall,
            "services": services,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _neo_from_mock(self, asteroid_id: str) -> NEOData:
        data = self.mock_manager.get_neo_parameters(asteroid_id)
        return NEOData(
            source="mock",
            asteroid_id=data["asteroid_id"],
            friendly_id=asteroid_id,
            name=data["name"],
            designation=data["designation"],
            absolute_magnitude_h=data.get("absolute_magnitude_h"),
            diameter_m=data["diameter_m"],
            diameter_range_m=data.get("diameter_range_m", (data["diameter_m"], data["diameter_m"])),
            velocity_kms=data["velocity_kms"],
            density_kg_m3=data["density_kg_m3"],
            mass_kg=data.get("mass_kg"),
            is_potentially_hazardous=data.get("is_potentially_hazardous", False),
            orbit_class=data.get("orbit_class"),
            close_approach=data.get("close_approach", {}),
            orbital_elements=data["orbital_elements"],
            nasa_jpl_url=data.get("nasa_jpl_url"),
        )

    def _serialise_catalog_entry(self, entry: NEOCatalogEntry) -> Dict[str, object]:
        return {
            "asteroid_id": entry.asteroid_id,
            "friendly_id": entry.asteroid_id,
            "name": entry.name,
            "designation": entry.designation,
            "absolute_magnitude_h": entry.absolute_magnitude_h,
            "diameter_min_m": entry.diameter_min_m,
            "diameter_max_m": entry.diameter_max_m,
            "relative_velocity_kms": entry.relative_velocity_kms,
            "close_approach_date": entry.close_approach_date,
            "is_potentially_hazardous": entry.is_potentially_hazardous,
            "orbit_class": entry.orbit_class,
        }

    def _default_catalog_entry(self) -> Optional[Dict[str, object]]:
        try:
            return self.mock_manager.catalog_snapshot(limit=1)[0]
        except (IndexError, KeyError):
            return None

    def _resolve_asteroid_id(self, friendly_id: str) -> str:
        return self.alias_map.get(friendly_id, friendly_id)

    def _elements_from_dict(self, raw: Dict[str, Optional[float]]) -> OrbitalElements:
        return OrbitalElements(
            semi_major_axis_au=self._ensure_quantity(raw.get("semi_major_axis_au"), fallback=self.mock_manager.default_elements.semi_major_axis_au),
            eccentricity=self._ensure_quantity(raw.get("eccentricity"), fallback=self.mock_manager.default_elements.eccentricity),
            inclination_deg=self._ensure_quantity(raw.get("inclination_deg"), fallback=self.mock_manager.default_elements.inclination_deg),
            longitude_ascending_node_deg=self._ensure_quantity(raw.get("longitude_ascending_node_deg"), fallback=self.mock_manager.default_elements.longitude_ascending_node_deg),
            argument_periapsis_deg=self._ensure_quantity(raw.get("argument_periapsis_deg"), fallback=self.mock_manager.default_elements.argument_periapsis_deg),
            mean_anomaly_deg=self._ensure_quantity(raw.get("mean_anomaly_deg"), fallback=self.mock_manager.default_elements.mean_anomaly_deg),
        )

    @staticmethod
    def _ensure_quantity(value: Optional[float], *, fallback: float) -> float:
        if value is None or value != value:  # NaN guard
            return fallback
        return float(value)


def _aggregate_overall_status(service_snapshots: Iterable[Dict[str, object]]) -> str:
    seen_statuses = {snapshot.get("status", "unknown") for snapshot in service_snapshots}
    if "error" in seen_statuses:
        return "error"
    if "degraded" in seen_statuses:
        return "degraded"
    if "ok" in seen_statuses and seen_statuses.issubset({"ok", "disabled", "unknown"}):
        return "ok"
    if seen_statuses.issubset({"disabled", "unknown"}):
        return "degraded"
    return "unknown"
