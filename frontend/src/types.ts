export type AnnotationStatus = 'raw' | 'prelabelled' | 'annotated' | 'accepted' | 'rework';
export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
}

export interface Annotation {
  id: number;
  asset_id: number;
  messages: Message[];
  status: AnnotationStatus;
  provenance: Record<string, unknown>;
  is_golden: boolean;
  rework_reason: string;
  quality_notes: string;
  updated_at: string;
}

export interface Asset {
  id: number;
  file_name: string;
  original_path: string;
  stored_path: string;
  image_url: string;
  sha256: string;
  perceptual_hash: string;
  width: number;
  height: number;
  size_bytes: number;
  batch: string;
  tags: string[];
  quality_score: number;
  duplicate_of?: number | null;
  created_at: string;
  annotation: Annotation;
}

export interface Validation {
  errors: string[];
  warnings: string[];
}

export interface AnnotationSampleFrame {
  index: number;
  asset_id: number;
  file_name: string;
  original_path: string;
  stored_path: string;
  width: number;
  height: number;
  sha256: string;
}

export interface AnnotationSample {
  sample_id?: string;
  annotation_level?: 'instance' | 'behavior';
  frame_count?: number;
  source_dir?: string;
  primary_asset_id?: number;
  frames?: AnnotationSampleFrame[];
}

export interface AnnotationJobItem {
  id: number;
  job_id: string;
  asset_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  provider: string;
  error: string;
  sample: AnnotationSample;
  updated_at: string;
  asset: Asset;
}

export interface AnnotationJob {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  source: Record<string, unknown>;
  config: Record<string, unknown>;
  total_count: number;
  completed_count: number;
  failed_count: number;
  export_path: string;
  error: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  items?: AnnotationJobItem[];
}

export interface PromptVersion {
  id: number;
  scene_id: number;
  version: string;
  prompt_text: string;
  notes: string;
  created_at: string;
}

export interface PromptScene {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  versions: PromptVersion[];
}

export interface DatasetVersion {
  id: string;
  name: string;
  export_path: string;
  manifest: Record<string, unknown>;
  train_count: number;
  val_count: number;
  golden_count: number;
  created_at: string;
}

export interface RunRecord {
  id: string;
  status: string;
  dataset_version_id: string;
  command: string[];
  log_path: string;
  return_code?: number | null;
  error: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  output_dir?: string;
  adapter_path?: string;
  training_run_id?: string;
  metrics?: Record<string, unknown>;
  samples?: unknown[];
}

export interface SettingsPayload {
  swift: {
    swift_bin: string;
    working_dir: string;
    default_cuda_visible_devices: string;
  };
  vlm: {
    endpoint: string;
    api_key: string;
    model: string;
    timeout_seconds: number;
  };
}
