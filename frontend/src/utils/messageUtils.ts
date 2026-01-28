// Convert string to Aleo field
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
