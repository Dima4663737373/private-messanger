// Convert string to Aleo fields
import { logger } from './logger';

export const stringToField = (str: string): string => {
  try {
    if (!str) return "0field";
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    let val = BigInt(0);
    for (let i = 0; i < Math.min(encoded.length, 31); i++) {
      val = (val << BigInt(8)) | BigInt(encoded[i]);
    }
    return val.toString() + "field";
  } catch (e) {
    logger.debug("Error encoding string to field:", e);
    return "0field";
  }
};

export const stringToFields = (str: string, count: number = 4): string[] => {
  try {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str || "");
    const fields: string[] = [];
    
    // Each field can hold ~31 bytes (248 bits) safely
    const CHUNK_SIZE = 31;
    
    for (let i = 0; i < count; i++) {
      const start = i * CHUNK_SIZE;
      const end = start + CHUNK_SIZE;
      const chunk = encoded.slice(start, end);
      
      if (chunk.length === 0) {
        fields.push("0field");
        continue;
      }

      let val = BigInt(0);
      for (let j = 0; j < chunk.length; j++) {
        val = (val << BigInt(8)) | BigInt(chunk[j]);
      }
      fields.push(val.toString() + "field");
    }
    
    return fields;
  } catch (e) {
    logger.error("Error encoding string to fields:", e);
    return Array(count).fill("0field");
  }
};

// Convert Aleo field to string
export const fieldToString = (fieldStr: string): string => {
  try {
    let valStr = fieldStr.replace(/field/g, "")
      .replace(/u64/g, "")
      .replace(/\.private/g, "")
      .replace(/\.public/g, "");

    valStr = valStr.replace(/\D/g, "");

    if (!valStr) return fieldStr;

    let val = BigInt(valStr);
    const bytes = [];
    while (val > 0n) {
      bytes.unshift(Number(val & 0xffn));
      val >>= 8n;
    }

    if (bytes.length === 0) return "";

    const decoder = new TextDecoder();
    const decoded = decoder.decode(new Uint8Array(bytes));

    if (decoded.length === 0) return valStr;

    return decoded.trim();
  } catch (e) {
    logger.debug("Error decoding field to string:", e);
    return fieldStr;
  }
};

export const fieldsToString = (fields: string[]): string => {
  try {
    let allBytes: number[] = [];
    
    for (const fieldStr of fields) {
       let valStr = fieldStr.replace(/field/g, "")
         .replace(/u64/g, "")
         .replace(/\.private/g, "")
         .replace(/\.public/g, "");
         
       valStr = valStr.replace(/\D/g, "");
       if (!valStr || valStr === "0") continue;
       
       let val = BigInt(valStr);
       const bytes = [];
       while (val > 0n) {
         bytes.unshift(Number(val & 0xffn));
         val >>= 8n;
       }
       // bytes are pushed in reverse order (big endian), so unshift corrects it
       allBytes = allBytes.concat(bytes);
    }
    
    if (allBytes.length === 0) return "";
    
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(allBytes));
  } catch (e) {
    logger.error("Error decoding fields to string:", e);
    return "";
  }
};
