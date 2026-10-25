const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');
export { API };
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}/api${path}`, { ...options, credentials: 'include', headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data as T;
}
export const post = <T,>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: data instanceof FormData ? data : JSON.stringify(data ?? {}) });
export const patch = <T,>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) });
export const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

export type RoomSettingsUpdate = {
  name?: string;
  description?: string;
  visibility?: 'private' | 'public';
  maxParticipants?: number;
  password?: string;
};

export const updateRoomSettings = (roomCode: string, settings: RoomSettingsUpdate) =>
  patch<{ room: any }>(`/rooms/${encodeURIComponent(roomCode)}/settings`, settings);

export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number, loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api${path}`);
    xhr.withCredentials = true;

    if (signal) {
      if (signal.aborted) {
        return reject(new DOMException('Upload aborted', 'AbortError'));
      }
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      });
    }

    if (xhr.upload && onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent, event.loaded, event.total);
        }
      });
    }

    xhr.onload = () => {
      try {
        const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as T);
        } else {
          reject(new Error(data.message || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload.'));
    };

    xhr.onabort = () => {
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    xhr.send(formData);
  });
}
