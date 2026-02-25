#!/bin/bash

echo "================================================"
echo "🚀 Starting PMS Server"
echo "================================================"
echo ""

if [ "$1" == "dev" ]; then
    echo "🔧 Mode: Development (with auto-reload)"
    echo ""
    npm run dev
elif [ "$1" == "prod" ]; then
    echo "🏭 Mode: Production"
    echo ""
    node index.js
else
    echo "Usage:"
    echo "  bash start_server.sh dev   - Development mode"
    echo "  bash start_server.sh prod  - Production mode"
    echo ""
    echo "Or directly:"
    echo "  npm run dev    - Development with auto-reload"
    echo "  node index.js  - Production"
    echo ""
    exit 1
fi