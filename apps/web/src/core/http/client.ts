import { beginGlobalLoading } from '../ui/loading';

export interface HttpRequestOptions extends RequestInit {
  authToken?: string | null;
  parseJson?: boolean;
  trackLoading?: boolean;
  loadingDelayMs?: number;
  loadingScope?: string;
  silent?: boolean;
}

export interface HttpErrorShape {
  status: number;
  body: unknown;
  message: string;
}

function resolveErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') {
    return `Request failed (${status})`;
  }

  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }
  if (Array.isArray(record.details)) {
    const detail = record.details.find((entry) => typeof entry === 'string' && entry.trim());
    if (typeof detail === 'string') {
      return detail;
    }
  }

  return `Request failed (${status})`;
}

export async function httpRequest<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const {
    authToken = null,
    parseJson = true,
    trackLoading = true,
    loadingDelayMs = 500,
    loadingScope = '',
    silent = false,
    ...requestOptions
  } = options;

  const stopLoading = beginGlobalLoading({
    trackLoading,
    loadingDelayMs,
    loadingScope,
    silent,
  });

  const headers = new Headers(requestOptions.headers || {});
  const credentials = requestOptions.credentials ?? 'include';
  const hasBody = requestOptions.body !== undefined && requestOptions.body !== null;
  const isFormDataPayload =
    typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;

  if (hasBody && !isFormDataPayload && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  try {
    const response = await fetch(url, {
      ...requestOptions,
      credentials,
      headers
    });

    const body = parseJson === false ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: HttpErrorShape = {
        status: response.status,
        body,
        message: resolveErrorMessage(body, response.status)
      };
      throw error;
    }

    return body as T;
  } finally {
    stopLoading();
  }
}
