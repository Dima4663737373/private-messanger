
async function checkEndpoints() {
    const endpoints = [
        "https://api.explorer.provable.com/v1",
        "https://api.explorer.aleo.org/v1",
        "https://mainnet.aleorpc.com"
    ];

    for (const url of endpoints) {
        console.log(`\nChecking ${url}...`);

        // Check 1: /testnet/latest/height (current naming)
        try {
            const res = await fetch(`${url}/testnet/latest/height`);
            if (res.ok) console.log(`✅ /testnet/latest/height: ${await res.text()}`);
            else console.log(`❌ /testnet/latest/height: ${res.status}`);
        } catch(e) { console.log(`❌ /testnet/latest/height failed: ${e.message}`); }

        // Check 2: /latest/height (no network prefix)
        try {
            const res = await fetch(`${url}/latest/height`);
            if (res.ok) console.log(`✅ /latest/height: ${await res.text()}`);
            else console.log(`❌ /latest/height: ${res.status}`);
        } catch(e) { console.log(`❌ /latest/height failed: ${e.message}`); }

        // Check 3: /testnet/program/credits.aleo
        try {
            const res = await fetch(`${url}/testnet/program/credits.aleo`);
            if (res.ok) console.log(`✅ /testnet/program/credits.aleo: Found`);
            else console.log(`❌ /testnet/program/credits.aleo: ${res.status}`);
        } catch(e) { console.log(`❌ /testnet/program/credits.aleo failed: ${e.message}`); }

        // Check 4: /program/credits.aleo (no network prefix)
        try {
            const res = await fetch(`${url}/program/credits.aleo`);
            if (res.ok) console.log(`✅ /program/credits.aleo: Found`);
            else console.log(`❌ /program/credits.aleo: ${res.status}`);
        } catch(e) { console.log(`❌ /program/credits.aleo failed: ${e.message}`); }
    }
}

checkEndpoints();
