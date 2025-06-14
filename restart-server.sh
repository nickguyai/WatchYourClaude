#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Watch Your Claude Server Restart   ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Kill any process running on port 2025
echo -e "${YELLOW}🔍 Checking for processes on port 2025...${NC}"
if lsof -Pi :2025 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${RED}⚠️  Found process on port 2025${NC}"
    echo -e "${YELLOW}🔨 Killing process...${NC}"
    lsof -ti:2025 | xargs kill -9
    echo -e "${GREEN}✅ Process killed successfully${NC}"
    sleep 1
else
    echo -e "${GREEN}✨ Port 2025 is available${NC}"
fi

echo ""
echo -e "${BLUE}================================${NC}"
echo ""

# Start the server
echo -e "${YELLOW}🚀 Starting Watch Your Claude server...${NC}"
echo -e "${GREEN}📊 Dashboard will be available at http://localhost:2025${NC}"
echo ""
npm start