"""Backend package for AstroShield.

Exposes utility factories for physics calculations and data acquisition.
"""
from __future__ import annotations

from .data_mock import MockDataManager
from .data_service import AstroDataService, NEOData
from .nasa_client import NASAClient
from .usgs_client import USGSClient
from .physics_engine import (
    calculate_crater_scaling,
    calculate_kinetic_energy,
    calculate_seismic_magnitude,
    simulate_orbital_change,
)

__all__ = [
    "MockDataManager",
    "AstroDataService",
    "NEOData",
    "NASAClient",
    "USGSClient",
    "calculate_kinetic_energy",
    "calculate_crater_scaling",
    "calculate_seismic_magnitude",
    "simulate_orbital_change",
]
