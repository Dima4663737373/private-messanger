/**
 * Script to verify that the deployed program has all required functions
 * Run this after deploying to ensure the deployment was successful
 */

const PROGRAM_ID = "priv_messenger_leotest_010.aleo";
const REQUIRED_FUNCTIONS = [
    "send_message",
    "create_profile",
    "update_profile",
    "update_contact_name",
    "delete_chat",
    "restore_chat"
];

const RPC_BASES = [
    { base: "https://api.explorer.provable.com/v2", paths: [`/programs/${PROGRAM_ID}`] },
    { base: "https://api.explorer.provable.com/v1", paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`] },
    { base: "https://api.explorer.aleo.org/v1", paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`] },
    { base: "https://vm.aleo.org/api", paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`] }
];

async function verifyDeployment() {
    console.log(`\n🔍 Verifying deployment of ${PROGRAM_ID}\n`);
    console.log(`Required functions: ${REQUIRED_FUNCTIONS.join(", ")}\n`);

    let programFound = false;
    let programContent = "";
    let foundUrl = "";

    for (const rpc of RPC_BASES) {
        for (const path of rpc.paths) {
            const url = `${rpc.base}${path}`;
            try {
                console.log(`Checking ${url}...`);
                const res = await fetch(url);
                if (res.ok) {
                    const contentType = res.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const data = await res.json();
                        // Provable API v2 returns JSON, extract program content
                        programContent = data.program || data.source || JSON.stringify(data);
                    } else {
                        programContent = await res.text();
                    }
                    programFound = true;
                    foundUrl = url;
                    console.log(`✅ Program found at ${url}\n`);
                    break;
                } else {
                    console.log(`   ❌ ${res.status} ${res.statusText}`);
                }
            } catch (e) {
                console.log(`   ❌ Error: ${e.message}`);
                // Continue to next URL
            }
        }
        if (programFound) break;
    }

    if (!programFound) {
        console.log("❌ Program not found on any RPC endpoint.");
        console.log("\nThis could mean:");
        console.log("1. The program hasn't been deployed yet");
        console.log("2. The program ID is incorrect");
        console.log("3. The RPC endpoints are unavailable");
        console.log("\nTo deploy the program, run:");
        console.log("  leo deploy --network testnet");
        return;
    }

    // Check for required functions
    console.log("Checking for required functions...\n");
    const missingFunctions = [];
    const foundFunctions = [];

    for (const funcName of REQUIRED_FUNCTIONS) {
        // Check for transition function
        const transitionPattern = new RegExp(`transition\\s+${funcName}\\s*\\(`, 'i');
        // Also check for async transition
        const asyncTransitionPattern = new RegExp(`async\\s+transition\\s+${funcName}\\s*\\(`, 'i');
        
        if (transitionPattern.test(programContent) || asyncTransitionPattern.test(programContent)) {
            foundFunctions.push(funcName);
            console.log(`✅ ${funcName} - Found`);
        } else {
            missingFunctions.push(funcName);
            console.log(`❌ ${funcName} - MISSING`);
        }
    }

    console.log("\n" + "=".repeat(50));
    if (missingFunctions.length === 0) {
        console.log("✅ All required functions are present in the deployed program!");
    } else {
        console.log(`❌ Missing ${missingFunctions.length} required function(s):`);
        missingFunctions.forEach(func => console.log(`   - ${funcName}`));
        console.log("\n⚠️  The deployed program is missing required functions.");
        console.log("   This usually means:");
        console.log("   1. An older version of the code was deployed");
        console.log("   2. The deployment failed partially");
        console.log("   3. The wrong program file was deployed");
        console.log("\n   Solution: Redeploy the program with the current code:");
        console.log("   leo deploy --network testnet");
    }
    console.log("=".repeat(50) + "\n");
}

verifyDeployment().catch(console.error);
