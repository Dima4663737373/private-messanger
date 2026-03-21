#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY not found in .env"
    exit 1
fi

PROGRAM_ID="ghost_msg_019.aleo"
NETWORK="${NETWORK:-testnet}"

echo "Deploying to Aleo ($NETWORK)..."
echo "Program ID: $PROGRAM_ID"
echo "Endpoint: ${ENDPOINT:-https://api.explorer.provable.com/v1}"

# Using Leo CLI (if available)
if command -v leo &> /dev/null; then
    echo "Using Leo CLI..."
    leo deploy --network "$NETWORK" --private-key "$PRIVATE_KEY" --priority-fee 1000000
else
    echo "Leo CLI not found. Please install Leo or SnarkOS."
    echo "Command to run manually:"
    echo "leo deploy --network $NETWORK --private-key \$PRIVATE_KEY"
fi
