#!/usr/bin/env python3
"""Compare whale-inspired wing morphologies for the hybrid airship concept."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from hybrid_airship_model import (
    build_wing_variants,
    membrane_section_area_coefficient,
    wing_aspect_ratio,
    wing_planform_area,
)

SEA_LEVEL_AIR_DENSITY = 1.225
HYDROGEN_DENSITY = 0.08988


def estimate_wing_gas_volume(variant_name: str) -> float:
    variant = build_wing_variants()[variant_name]
    section_areas = [
        membrane_section_area_coefficient(
            thickness_ratio=section.thickness_ratio,
            thickness_power=variant.thickness_power,
        )
        * section.chord
        * section.chord
        for section in variant.sections
    ]
    return 2.0 * sum(
        (section_b.span_y - section_a.span_y) * (area_a + area_b) * 0.5
        for section_a, section_b, area_a, area_b in zip(
            variant.sections,
            variant.sections[1:],
            section_areas,
            section_areas[1:],
        )
    )


def build_rows() -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for key, variant in build_wing_variants().items():
        area = wing_planform_area(variant.sections)
        aspect_ratio = wing_aspect_ratio(variant.sections)
        gas_volume = estimate_wing_gas_volume(key)
        gas_lift_kg = gas_volume * (SEA_LEVEL_AIR_DENSITY - HYDROGEN_DENSITY)
        hydrogen_mass_kg = gas_volume * HYDROGEN_DENSITY
        hydrogen_energy_kwh = hydrogen_mass_kg * 120.0 / 3.6
        rows.append(
            {
                "variant": key,
                "label": variant.name,
                "wing_area_m2": round(area, 1),
                "aspect_ratio": round(aspect_ratio, 2),
                "wing_gas_volume_m3": round(gas_volume, 1),
                "wing_gas_lift_kg": round(gas_lift_kg, 1),
                "wing_hydrogen_mass_kg": round(hydrogen_mass_kg, 1),
                "wing_hydrogen_energy_kwh": round(hydrogen_energy_kwh, 1),
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, float | str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("generated/hybrid_airship_morphologies.csv"),
        help="CSV output path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = build_rows()
    write_csv(args.out, rows)
    print("Hybrid airship morphology comparison")
    for row in rows:
        print(
            f"  {row['variant']}: area {row['wing_area_m2']} m^2, AR {row['aspect_ratio']}, "
            f"wing gas {row['wing_gas_volume_m3']} m^3, lift {row['wing_gas_lift_kg']} kg"
        )
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
