
import { Address, BHP256, Plaintext } from '@provablehq/sdk';

(async () => {
    const validAddress = "aleo146vlesnaw2gv1991n9zedjeanmus6swzkku82kk4r4e0z60ulcxq269550";
    
    try {
        console.log("\n--- Plaintext Type Check ---");
        const pt = Plaintext.fromString(`"${validAddress}"`);
        console.log("Created plaintext from quoted string.");
        console.log("toString():", pt.toString());
        // Check if we can detect type. 
        // Plaintext doesn't have explicit type getter in JS usually, but let's see.
        
        // Let's try to parse as address directly?
        // If Plaintext.fromString(validAddress) failed, it implies it didn't recognize 'aleo1...' as a valid literal.
        
        // What if we try casting?
        // Plaintext.fromString("aleo1... as address")? No.
        
        // Let's try `Address.from_string` again but maybe catch why it failed.
        // If Address.from_string works, we should use that.
        // The panic might be due to threading or memory?
        
    } catch (e) {
        console.log("Error:", e);
    }
})();
