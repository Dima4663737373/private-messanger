// Component to display program indexing status
// Shows whether the program is available on public RPC endpoints

import { useEffect, useState } from 'react';
import { checkProgramExists } from '../utils/aleo-rpc';
import { PROGRAM_ID } from '../deployed_program';
import { getAleoScanUrl } from '../utils/programUtils';
import { logger } from '../utils/logger';

export type ProgramStatusType = 'checking' | 'indexed' | 'not-indexed';

export function ProgramStatus() {
  const [status, setStatus] = useState<ProgramStatusType>('checking');
  const [programUrl, setProgramUrl] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const info = await checkProgramExists(PROGRAM_ID);
        setStatus(info.exists ? 'indexed' : 'not-indexed');
        setProgramUrl(info.url || null);
      } catch (error: any) {
        // Only log unexpected errors (not 404s from RPC endpoints)
        if (error?.message && !error.message.includes('404')) {
          logger.debug('Error checking program status:', error);
        }
        setStatus('not-indexed');
      }
    };

    check();
    const interval = setInterval(check, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  if (status === 'checking') {
    return (
      <div className="flex items-center gap-2 text-gray-600 text-xs font-bold uppercase bg-gray-200 border-2 border-black p-2">
        <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full" />
        Checking program status...
      </div>
    );
  }

  if (status === 'not-indexed') {
    return (
      <div className="p-2 bg-yellow-50 border-2 border-yellow-200 rounded-lg text-xs">
        <div className="flex items-center gap-2 text-yellow-800">
          <span className="text-lg">⚠️</span>
          <div className="flex-1">
            <div className="font-bold uppercase">Program Not Indexed Yet</div>
            <div className="text-[10px] mt-1">
              The program is deployed but RPC endpoints haven't indexed it yet.
              This usually takes 5-10 minutes. Please wait...
            </div>
            <div className="mt-1">
              <a 
                href={getAleoScanUrl()} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="underline font-bold hover:text-yellow-900"
              >
                Check on AleoScan
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-green-600 text-xs font-bold uppercase bg-green-50 border-2 border-green-200 p-2">
      <span className="text-lg">✅</span>
      <div>
        <div>Program is indexed and ready to use</div>
        {programUrl && (
          <a 
            href={programUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-[10px] underline hover:text-green-800"
          >
            View on RPC
          </a>
        )}
      </div>
    </div>
  );
}
