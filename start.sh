#!/bin/bash
# BlinkByte Local Server Runner
# Bypasses local browser CORS policies for ES modules by serving files via localhost

PORT=8080

echo "============================================="
echo "   BlinkByte // Local Development Server     "
echo "============================================="

# Check if Python 3 is available
if command -v python3 &>/dev/null; then
  echo "[+] Starting Python3 local server on http://localhost:$PORT ..."
  echo "[+] Press Ctrl+C to terminate."
  python3 -m http.server $PORT
# Fallback to npx serve
elif command -v npx &>/dev/null; then
  echo "[+] Starting Node.js (npx serve) on http://localhost:$PORT ..."
  echo "[+] Press Ctrl+C to terminate."
  npx -y serve -l $PORT
else
  echo "[!] Error: Neither python3 nor Node.js (npx) was detected."
  echo "[!] Please run a static web server of your choice in this directory."
  exit 1
fi
