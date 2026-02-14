
(async () => {
    try {
        console.log("Testing Provable SDK in Node.js with EVAL Import...");
        
        // Dynamic ESM import in CJS context
        const sdk = await (new Function('return import("@provablehq/sdk")'))();
        const { Plaintext, BHP256 } = sdk;

        const address = "aleo146vlesnaw2gv1991n9zedjeanmus6swzkku82kk4r4e0z60ulcxq269550";
        console.log("Hashing address:", address);

        // Try creating plaintext
        let plaintext;
        try {
            plaintext = Plaintext.fromString(address);
            console.log("Plaintext created directly");
        } catch (e) {
            console.log("Direct Plaintext creation failed, trying quoted...");
            plaintext = Plaintext.fromString(`"${address}"`);
            console.log("Plaintext created from quoted string");
        }

        const hasher = new BHP256();
        const hash = hasher.hash(plaintext.toBitsLe()).toString();
        hasher.free();

        console.log("Hash result:", hash);

    } catch (e) {
        console.error("SDK Test Failed:", e);
    }
})();
