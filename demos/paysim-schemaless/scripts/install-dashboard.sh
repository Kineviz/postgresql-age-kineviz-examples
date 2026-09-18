#!/usr/bin/env bash
# Install the AGE-native dashboard into an existing Kineviz Desktop project.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$repo_root/gxr" dashboard install "$@"
