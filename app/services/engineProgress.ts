import { apiUrl } from './apiBase';
import type { YueProgress } from '../types';

/**
 * The running job's progress, pushed by the studio service as the engine log
 * moves: one stream while songs are being made, instead of a request every
 * moment. Returns the unsubscribe.
 */
export function followEngineProgress(onProgress: (progress: YueProgress | null) => void): () => void {
  const events = new EventSource(apiUrl('/v1/engine/progress'));
  events.onmessage = (message) => onProgress(JSON.parse(message.data) as YueProgress | null);
  return () => events.close();
}
