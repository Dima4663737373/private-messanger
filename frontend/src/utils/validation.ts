// Validation utilities for Aleo transaction parameters

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates Aleo address
 */
export function validateAleoAddress(address: string): ValidationResult {
  const errors: string[] = [];

  if (!address) {
    errors.push('Address is empty');
  } else {
    const trimmed = address.trim();
    if (!trimmed.startsWith('aleo1')) {
      errors.push('Address must start with "aleo1"');
    } else if (trimmed.length < 59 || trimmed.length > 63) {
      errors.push(`Address must be 59-63 characters, got ${trimmed.length}`);
    } else if (!/^aleo1[a-z0-9]+$/.test(trimmed)) {
      errors.push('Address contains invalid characters (only lowercase letters and numbers allowed)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates timestamp for Aleo (must be in seconds, not milliseconds)
 */
export function validateTimestamp(timestamp: number): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(timestamp)) {
    errors.push('Timestamp must be an integer');
  } else if (timestamp < 0) {
    errors.push('Timestamp cannot be negative');
  } else if (timestamp > 2147483647) {
    errors.push('Timestamp too large (max: 2147483647)');
  } else if (timestamp > 10000000000) {
    // If more than year 2286, probably milliseconds
    errors.push('Timestamp appears to be in milliseconds (should be in seconds)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates message content
 */
export function validateMessage(content: string): ValidationResult {
  const errors: string[] = [];

  if (!content) {
    errors.push('Message is empty');
  } else if (content.trim().length === 0) {
    errors.push('Message contains only whitespace');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates amount (must be 0 for messages)
 */
export function validateAmount(amount: number): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(amount)) {
    errors.push('Amount must be an integer');
  } else if (amount < 0) {
    errors.push('Amount cannot be negative');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates all send_message transaction parameters
 */
export function validateTransactionParams(
  recipient: string,
  amount: number,
  message: string,
  timestamp: number
): ValidationResult {
  const errors: string[] = [];

  // Recipient validation
  const addressValidation = validateAleoAddress(recipient);
  if (!addressValidation.valid) {
    errors.push(...addressValidation.errors.map(e => `Recipient: ${e}`));
  }

  // Message validation
  const messageValidation = validateMessage(message);
  if (!messageValidation.valid) {
    errors.push(...messageValidation.errors.map(e => `Message: ${e}`));
  }

  // Timestamp validation
  const timestampValidation = validateTimestamp(timestamp);
  if (!timestampValidation.valid) {
    errors.push(...timestampValidation.errors.map(e => `Timestamp: ${e}`));
  }

  // Amount validation
  const amountValidation = validateAmount(amount);
  if (!amountValidation.valid) {
    errors.push(...amountValidation.errors.map(e => `Amount: ${e}`));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Cleans and formats address (removes spaces, quotes)
 */
export function cleanAddress(address: string): string {
  if (!address) return '';
  return address.trim().replace(/['"]/g, '');
}

/**
 * Checks field value format
 */
export function validateFieldValue(fieldValue: string): ValidationResult {
  const errors: string[] = [];

  if (!fieldValue) {
    errors.push('Field value is empty');
  } else if (!fieldValue.endsWith('field')) {
    errors.push('Field value must end with "field"');
  } else {
    const numStr = fieldValue.replace('field', '');
    if (!/^\d+$/.test(numStr)) {
      errors.push('Field value must be a number followed by "field"');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
