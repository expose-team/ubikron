#!/usr/bin/env python3
"""Fill Mimic's main-property names and import the Expose provider.

The signed-in Mimic account must be able to read system entity types.
This does not send an Expose API key. Set that afterwards with
`mimic credentials set expose --type api_key`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT_TOKEN = "__INPUT__"
TITLES = {"company": "Company", "school": "School"}


def mimic(*args: str) -> subprocess.CompletedProcess[str]:
    binary = shutil.which("mimic")
    if binary is None:
        sys.exit("mimic is not on PATH. Install it from https://github.com/Ubikron-Tech-Farm/mimic-cli")
    return subprocess.run([binary, *args], text=True, capture_output=True)


def entity_main_property(type_name: str) -> str:
    result = mimic("types", "entities", "get", type_name, "-o", "json")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if result.returncode == 3:
            sys.exit("Mimic is not signed in. Run `mimic login`, then run this script again.")
        sys.exit(f"Could not read {type_name} (exit {result.returncode}).\n{detail}")
    payload = json.loads(result.stdout)
    body = payload.get("data", payload) if isinstance(payload, dict) else payload
    if isinstance(body, dict) and isinstance(body.get("data"), dict):
        body = body["data"]
    main = body.get("main_property") if isinstance(body, dict) else None
    if not isinstance(main, str) or not main.strip():
        sys.exit(f"{type_name} has no main property. Refusing to guess an input name.")
    return main


def mapping_spec(name: str) -> dict:
    if name == "person":
        return json.loads((ROOT / "mappings" / "person.json").read_text())
    spec = json.loads((ROOT / "mappings" / "organization.json").read_text())
    title = TITLES[name]
    for section in spec["sections"]:
        if section.get("titleExpression") == "__TITLE__":
            section["titleExpression"] = f"'{title}'"
    return spec


def build_bundle() -> dict:
    bundle = json.loads((ROOT / "bundle" / "expose.json").read_text())
    properties: dict[str, str] = {}
    for provider in bundle["providers"]:
        for endpoint in provider["endpoints"]:
            type_name = endpoint["entity_type"]
            if type_name not in properties:
                properties[type_name] = entity_main_property(type_name)
            main = properties[type_name]
            endpoint["endpoint_url"] = endpoint["endpoint_url"].replace("{{" + INPUT_TOKEN + "}}", "{{" + main + "}}")
            for item in endpoint["entity_type_inputs"]:
                if item["property_name"] == INPUT_TOKEN:
                    item["property_name"] = main
            endpoint["mapping_spec"] = mapping_spec(endpoint.pop("mapping"))
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the Expose provider into the signed-in Mimic account.")
    parser.add_argument("--dry-run", action="store_true", help="Write the bundle and preview the import.")
    parser.add_argument("--update", action="store_true", help="Merge when the account already has this provider.")
    parser.add_argument("--output", default=str(ROOT / "expose.bundle.json"), help="Where to write the filled bundle.")
    args = parser.parse_args()

    bundle = build_bundle()
    output = Path(args.output)
    output.write_text(json.dumps(bundle, indent=2) + "\n")
    output.chmod(0o600)
    print(f"Wrote {output}")

    command = ["import", str(output)]
    if args.dry_run:
        command.append("--dry-run")
    if args.update:
        command.extend(["--on-conflict", "merge"])
    result = mimic(*command, "-o", "json")
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        sys.exit(result.returncode)
    if args.dry_run:
        return
    print("Set your own Expose key next. Mimic stores it and does not put it in this repository:")
    print("  mimic credentials set expose --type api_key")


if __name__ == "__main__":
    main()
