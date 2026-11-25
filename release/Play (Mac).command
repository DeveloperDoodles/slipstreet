#!/bin/bash
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 serve.py
else
  echo "Slipstreet needs Python 3 to start. Install it from https://www.python.org/downloads/ and run this again."
  read -r -p "Press Enter to close."
fi
