const PROGRAM_ID = "priv_messenger_leotest_008.aleo";
const RPC_BASES = [
    "https://api.explorer.aleo.org/v1",
    "https://vm.aleo.org/api",
    "https://testnet3.aleo.org"
];

async function checkDeployedProgram() {
    console.log(`Checking deployed program: ${PROGRAM_ID}\n`);

    const paths = [
        `/testnet3/program/${PROGRAM_ID}`,
        `/program/${PROGRAM_ID}`,
    ];
    
    for (const RPC_BASE of RPC_BASES) {
        console.log(`\nTrying RPC base: ${RPC_BASE}`);

        for (const path of paths) {
            const url = `${RPC_BASE}${path}`;
            try {
                console.log(`  Fetching ${url}...`);
                const res = await fetch(url);
                if (res.ok) {
                    const text = await res.text();
                    console.log(`✅ Program found at ${url}\n`);
                    console.log("Program content (first 2000 chars):");
                    console.log(text.substring(0, 2000));
                    
                    // Check for send_message function
                    if (text.includes("send_message")) {
                        console.log("\n✅ send_message function found in deployed program");
                    } else {
                        console.log("\n❌ send_message function NOT found in deployed program");
                        console.log("\nLooking for transition functions...");
                        const transitionMatches = text.match(/transition\s+(\w+)/g);
                        if (transitionMatches) {
                            console.log("Available transitions:", transitionMatches);
                        }
                    }
                    return;
                } else {
                    console.log(`  ❌ ${res.status} ${res.statusText}`);
                }
            } catch (e) {
                console.log(`  Error fetching ${url}:`, e.message);
            }
        }
    }
    
    console.log("\n⚠️ Program NOT found on any checked path.");
}

checkDeployedProgram();
