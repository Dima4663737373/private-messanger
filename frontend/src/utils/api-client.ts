import { API_CONFIG } from '../config';
import { logger } from './logger';
import { getSessionToken } from './auth-store';
import { API_TIMEOUT } from '../constants';

interface SafeFetchOptions {
  method?: string;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
  retries?: number;
  timeout?: number;
  mockFallback?: unknown;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Safe wrapper for Backend API calls.
 * Handles 404 as "null data" (not error).
 * Retries on network failure.
 */
export async function safeBackendFetch<T>(
  endpoint: string, 
  options: SafeFetchOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    headers = {},
    retries = 1,
    timeout = API_TIMEOUT,
    mockFallback
  } = options;

  const url = `${API_CONFIG.BACKEND_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);

      const token = getSessionToken();
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      
      clearTimeout(id);

      if (res.ok) {
        const data = await res.json();
        return { data, error: null, status: res.status };
      }

      if (res.status === 404) {
        // Valid "not found" state
        return { data: null, error: null, status: 404 };
      }

      if (res.status >= 500) {
        throw new Error(`Server Error ${res.status}`);
      }

      // 400-499 errors (except 404)
      const errData = await res.json().catch(() => ({}));
      return { 
        data: null, 
        error: errData.message || `Request failed with status ${res.status}`, 
        status: res.status 
      };

    } catch (e) {
      const isNetworkError = e.name === 'AbortError' || e.message.includes('Failed to fetch');
      
      if (isNetworkError && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (attempt === retries) {
        logger.warn(`Backend fetch failed for ${url}:`, e);

        if (mockFallback !== undefined) {
          logger.info('Using mock fallback for', endpoint);
          return { data: mockFallback as T, error: null, status: 200 };
        }

        return { 
          data: null, 
          error: isNetworkError ? 'Network Error' : e.message, 
          status: 0 
        };
      }
    }
  }

  return { data: null, error: 'Unknown error', status: 0 };
}
