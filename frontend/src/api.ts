import type {
  AnnotationJob,
  AnnotationStatus,
  Asset,
  DatasetVersion,
  Message,
  PromptScene,
  PromptVersion,
  RunRecord,
  SettingsPayload,
  Validation
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || '请求失败');
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response.text() as Promise<T>;
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const asciiMatch = disposition.match(/filename="?([^"]+)"?/i);
  return asciiMatch?.[1] ?? fallback;
}

async function downloadFile(path: string, fallbackName: string) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || '下载失败');
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename };
}

export const api = {
  imageUrl(asset: Asset) {
    return `${API_BASE}${asset.image_url}`;
  },
  assetImageUrl(assetId: number) {
    return `${API_BASE}/assets/${assetId}/image`;
  },
  listAssets(params: { status?: AnnotationStatus; batch?: string; q?: string } = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return request<{ items: Asset[]; counts: Record<AnnotationStatus, number>; batches: string[] }>(`/assets?${query.toString()}`);
  },
  getAnnotation(assetId: number) {
    return request<{ asset: Asset; validation: Validation }>(`/annotations/${assetId}`);
  },
  saveAnnotation(
    assetId: number,
    payload: { messages: Message[]; status?: AnnotationStatus; is_golden?: boolean; quality_notes?: string; tags?: string[]; quality_score?: number }
  ) {
    return request<{ asset: Asset; validation: Validation }>(`/annotations/${assetId}/save`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  acceptAnnotation(assetId: number) {
    return request<{ asset: Asset; validation: Validation }>(`/annotations/${assetId}/accept`, { method: 'POST' });
  },
  reworkAnnotation(assetId: number, reason: string) {
    return request<Asset>(`/annotations/${assetId}/rework`, { method: 'POST', body: JSON.stringify({ reason }) });
  },
  prelabel(assetId: number) {
    return request<{ asset: Asset; suggestion: unknown; validation: Validation }>(`/annotations/${assetId}/prelabel`, { method: 'POST' });
  },
  createPromptScene(payload: { name: string; description: string }) {
    return request<PromptScene>('/prompt-scenes', { method: 'POST', body: JSON.stringify(payload) });
  },
  listPromptScenes() {
    return request<{ items: PromptScene[] }>('/prompt-scenes');
  },
  createPromptVersion(payload: { scene_id: number; version: string; prompt_text: string; notes: string }) {
    return request<PromptVersion>('/prompt-versions', { method: 'POST', body: JSON.stringify(payload) });
  },
  createAnnotationJob(payload: {
    name: string;
    folder_path?: string;
    annotation_level?: 'instance' | 'behavior';
    frame_count?: number;
    copy_assets?: boolean;
    batch?: string;
    status?: string;
    asset_ids?: number[];
    concurrency: number;
    overwrite_existing: boolean;
    prompt_scene_id?: number;
    prompt_version_id?: number;
    custom_prompt?: string;
  }) {
    return request<AnnotationJob>('/annotation-jobs', { method: 'POST', body: JSON.stringify(payload) });
  },
  listAnnotationJobs() {
    return request<{ items: AnnotationJob[] }>('/annotation-jobs');
  },
  getAnnotationJob(jobId: string) {
    return request<AnnotationJob>(`/annotation-jobs/${jobId}`);
  },
  exportAnnotationJob(jobId: string, payload: { accepted_only: boolean }) {
    return request<{ export_path: string; jsonl_path: string; count: number; validation_errors: unknown[] }>(`/annotation-jobs/${jobId}/export`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  downloadAnnotationJob(jobId: string, payload: { accepted_only: boolean }) {
    const query = new URLSearchParams({ accepted_only: String(payload.accepted_only) });
    return downloadFile(`/annotation-jobs/${jobId}/export/download?${query.toString()}`, `annotation_${jobId.slice(0, 8)}.json`);
  },
  exportDataset(payload: { name: string; val_ratio: number; seed: number }) {
    return request<DatasetVersion>('/datasets/export', { method: 'POST', body: JSON.stringify(payload) });
  },
  listDatasets() {
    return request<{ items: DatasetVersion[] }>('/datasets');
  },
  getSettings() {
    return request<SettingsPayload>('/settings');
  },
  saveSwiftSettings(payload: SettingsPayload['swift']) {
    return request<SettingsPayload['swift']>('/settings/swift', { method: 'POST', body: JSON.stringify(payload) });
  },
  saveVlmSettings(payload: SettingsPayload['vlm']) {
    return request<SettingsPayload['vlm']>('/settings/vlm', { method: 'POST', body: JSON.stringify(payload) });
  },
  trainPreview(payload: Record<string, unknown>) {
    return request<{ command: string[]; env: Record<string, string>; output_dir: string }>('/runs/train/preview', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  trainStart(payload: Record<string, unknown>) {
    return request<RunRecord>('/runs/train/start', { method: 'POST', body: JSON.stringify(payload) });
  },
  listTrainRuns() {
    return request<{ items: RunRecord[] }>('/runs/train');
  },
  trainLogs(runId: string) {
    return request<string>(`/runs/train/${runId}/logs`);
  },
  killTrain(runId: string) {
    return request<{ killed: boolean }>(`/runs/train/${runId}/kill`, { method: 'POST' });
  },
  evalPreview(payload: Record<string, unknown>) {
    return request<{ command: string[]; env: Record<string, string> }>('/runs/eval/preview', { method: 'POST', body: JSON.stringify(payload) });
  },
  evalStart(payload: Record<string, unknown>) {
    return request<RunRecord>('/runs/eval/start', { method: 'POST', body: JSON.stringify(payload) });
  },
  listEvalRuns() {
    return request<{ items: RunRecord[] }>('/runs/eval');
  },
  evalLogs(runId: string) {
    return request<string>(`/runs/eval/${runId}/logs`);
  }
};
