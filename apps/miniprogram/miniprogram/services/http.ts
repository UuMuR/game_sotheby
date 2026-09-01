export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  data?: unknown;
  headers?: Record<string, string>;
}

export interface HttpClient {
  request<T>(options: RequestOptions): Promise<T>;
}

export function createHttpClient(
  platformRequest: <T>(options: RequestOptions) => Promise<T>,
  apiBaseUrl: string,
  getToken: () => string | undefined,
): HttpClient {
  return {
    request<T>(options: RequestOptions): Promise<T> {
      const token = getToken();
      return platformRequest<T>({
        ...options,
        url: `${apiBaseUrl}${options.url}`,
        headers: {
          ...options.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
    },
  };
}
