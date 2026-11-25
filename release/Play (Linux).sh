#!/bin/bash
cd "$(dirname "$0")"
python3 serve.py || { echo "Slipstreet needs Python 3 (e.g. sudo apt install python3)."; read -r -p "Press Enter to close."; }
