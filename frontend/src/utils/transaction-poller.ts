// Utility for polling transaction status on public RPC endpoints

const POLL_ENDPOINTS = [
  'https://api.explorer.aleo.org/v1',
  'https://vm.aleo.org/api',
  'https://api.explorer.provable.com/v1',
  'https://api.explorer.provable.com/v2',
];

export type TransactionStatus = 'confirmed' | 'failed' | 'pending' | 'timeout';

export interface TransactionInfo {
  status: TransactionStatus;
  transactionId: string;
  data?: any;
}

/**
 * Polls transaction status from public RPC endpoints
 */
export async function pollTransactionStatus(
  txId: string,
  maxAttempts: number = 60,
  delayMs: number = 5000
): Promise<TransactionStatus> {
  const paths = [
    `/testnet3/transaction/${txId}`,
    `/transaction/${txId}`,
    `/testnet/transaction/${txId}`,
  ];

  for (let i = 0; i < maxAttempts; i++) {
    for (const endpoint of POLL_ENDPOINTS) {
      for (const path of paths) {
        try {
          const url = `${endpoint}${path}`;
          const response = await fetch(url);

          if (response.ok) {
            const data = await response.json();

            // Check different response formats
            if (data.status === 'confirmed' || 
                data.finalize_type === 'accepted' ||
                data.execution?.finalize?.type === 'accepted' ||
                (data.type && data.status === 'accepted')) {
              return 'confirmed';
            }

            if (data.status === 'failed' || 
                data.finalize_type === 'rejected' ||
                data.execution?.finalize?.type === 'rejected' ||
                (data.type && data.status === 'rejected')) {
              return 'failed';
            }

            // If we got a response but status is unclear, assume pending
            if (data.status === 'pending' || data.transaction_id || data.id) {
              // Continue polling
              break;
            }
          }
        } catch (error) {
          // Continue to next endpoint/path
          continue;
        }
      }
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return 'timeout';
}

/**
 * Get transaction info from RPC
 */
export async function getTransactionInfo(txId: string): Promise<TransactionInfo | null> {
  const paths = [
    `/testnet3/transaction/${txId}`,
    `/transaction/${txId}`,
    `/testnet/transaction/${txId}`,
  ];

  for (const endpoint of POLL_ENDPOINTS) {
    for (const path of paths) {
      try {
        const url = `${endpoint}${path}`;
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          
          let status: TransactionStatus = 'pending';
          if (data.status === 'confirmed' || data.finalize_type === 'accepted') {
            status = 'confirmed';
          } else if (data.status === 'failed' || data.finalize_type === 'rejected') {
            status = 'failed';
          }

          return {
            status,
            transactionId: txId,
            data,
          };
        }
      } catch (error) {
        continue;
      }
    }
  }

  return null;
}
