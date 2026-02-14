export const mapErrorToUserMessage = (error: any): string => {
  const msg = typeof error === 'string' ? error : error?.message || 'Unknown error';

  // Wallet / User actions
  if (msg.includes('User rejected') || msg.includes('user rejected') || msg.includes('User denied')) return 'Transaction cancelled by user';
  if (msg.includes('insufficient funds') || msg.includes('Insufficient balance')) return 'Insufficient ALEO credits for fee';
  if (msg.includes('Wallet not connected')) return 'Please connect your wallet first';

  // Network
  if (msg.includes('Network Error') || msg.includes('ERR_NETWORK')) return 'Network error. Check your connection';
  if (msg.includes('Failed to fetch') || msg.includes('fetch failed')) return 'Cannot reach server. Is the backend running?';
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) return 'Request timed out. Please try again';
  if (msg.includes('Too many requests') || msg.includes('rate limit')) return 'Too many requests. Please wait a moment';

  // Transaction
  if (msg.includes('Signature verification failed')) return 'Security check failed. Try again';
  if (msg.includes('INVALID_PARAMS')) return 'Invalid transaction parameters. Please check your inputs';
  if (msg.includes('already been spent')) return 'This record has already been used';
  if (msg.includes('record not found')) return 'Message record not found in wallet';

  // Crypto
  if (msg.includes('Decryption failed') || msg.includes('decryption')) return 'Could not decrypt message. Key mismatch?';
  if (msg.includes('Invalid payload format')) return 'Corrupted message data';
  if (msg.includes('public key not found') || msg.includes('Recipient public key')) return 'Recipient has no encryption key. They need to create a profile first';

  // Program
  if (msg.includes('Function does not exist')) return 'Contract function not found. Check program ID';
  if (msg.includes('Program not found')) return 'Smart contract not deployed on this network';

  // Truncate long technical errors
  if (msg.length > 120) return msg.slice(0, 100) + '...';

  return msg;
};
