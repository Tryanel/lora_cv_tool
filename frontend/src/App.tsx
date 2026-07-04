import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import {
  ArrowLeft,
  BookOpenText,
  Bot,
  CheckCircle,
  Download,
  Edit3,
  FileJson,
  Home,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Upload
} from 'lucide-react';
import { api } from './api';
import type { AnnotationJob, AnnotationJobItem, AnnotationStatus, Asset, Message, PromptScene, SettingsPayload, Validation } from './types';

const { Header, Content } = Layout;
const { Text, Title } = Typography;

type ViewKey = 'home' | 'annotation';
type AnnotationSection = 'jobs' | 'review' | 'import' | 'prompts' | 'settings' | 'export';

const annotationSections: AnnotationSection[] = ['jobs', 'review', 'import', 'prompts', 'settings', 'export'];

function routeFromHash(): { view: ViewKey; section: AnnotationSection } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [view, section] = raw.split('/');
  if (view === 'annotation' && annotationSections.includes(section as AnnotationSection)) {
    return { view: 'annotation', section: section as AnnotationSection };
  }
  if (annotationSections.includes(raw as AnnotationSection)) {
    return { view: 'annotation', section: raw as AnnotationSection };
  }
  return { view: 'home', section: 'jobs' };
}

function setRoute(view: ViewKey, section: AnnotationSection = 'jobs') {
  const nextHash = view === 'home' ? '#/' : `#/annotation/${section}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  } else {
    window.dispatchEvent(new Event('hashchange'));
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-panel">
          <Title level={4}>页面渲染失败</Title>
          <Text type="danger">{this.state.error.message}</Text>
          <Button type="primary" onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const statusOptions: Array<{ label: string; value: AnnotationStatus; color: string }> = [
  { label: 'raw', value: 'raw', color: 'default' },
  { label: 'prelabelled', value: 'prelabelled', color: 'processing' },
  { label: 'annotated', value: 'annotated', color: 'warning' },
  { label: 'accepted', value: 'accepted', color: 'success' },
  { label: 'rework', value: 'rework', color: 'error' }
];

const emptySettings: SettingsPayload = {
  swift: { swift_bin: 'swift', working_dir: '', default_cuda_visible_devices: '0' },
  vlm: {
    endpoint: '',
    api_key: '',
    model: '',
    timeout_seconds: 60,
    prompt_template:
      '请基于图片生成一条中文图文问答 SFT 样本，并只返回 JSON：{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}'
  }
};

function statusColor(status: string) {
  return statusOptions.find((item) => item.value === status)?.color ?? (status.includes('fail') ? 'error' : 'default');
}

function progressOf(job: AnnotationJob) {
  if (!job.total_count) return 0;
  return Math.round(((job.completed_count + job.failed_count) / job.total_count) * 100);
}

function FeatureCard({
  title,
  caption,
  icon,
  onClick,
  disabled
}: {
  title: string;
  caption: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`feature-card ${disabled ? 'disabled' : ''}`} type="button" onClick={onClick} disabled={disabled}>
      <span className="feature-icon">{icon}</span>
      <span className="feature-copy">
        <strong>{title}</strong>
        <span>{caption}</span>
      </span>
    </button>
  );
}

function HomeView({ onOpenAnnotation }: { onOpenAnnotation: () => void }) {
  return (
    <div className="home-page">
      <div className="home-title">
        <Title level={2}>工作台</Title>
      </div>
      <div className="feature-grid">
        <FeatureCard title="标注中心" caption="图文数据生产" icon={<Bot size={22} />} onClick={onOpenAnnotation} />
        <FeatureCard title="训练管理" caption="后续接入" icon={<Play size={22} />} disabled />
        <FeatureCard title="评测分析" caption="后续接入" icon={<CheckCircle size={22} />} disabled />
      </div>
    </div>
  );
}

function AnnotationNav({ section, onChange }: { section: AnnotationSection; onChange: (section: AnnotationSection) => void }) {
  const items: Array<{ key: AnnotationSection; label: string; icon: ReactNode }> = [
    { key: 'jobs', label: '标注任务', icon: <Bot size={16} /> },
    { key: 'review', label: '人工审核', icon: <Edit3 size={16} /> },
    { key: 'import', label: '素材导入', icon: <Upload size={16} /> },
    { key: 'prompts', label: '提示词库', icon: <BookOpenText size={16} /> },
    { key: 'settings', label: 'Teacher', icon: <Settings size={16} /> },
    { key: 'export', label: '导出 JSON', icon: <FileJson size={16} /> }
  ];

  return (
    <aside className="annotation-nav">
      <div className="nav-title">标注中心</div>
      {items.map((item) => (
        <button key={item.key} className={`nav-item ${section === item.key ? 'active' : ''}`} type="button" onClick={() => onChange(item.key)}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </aside>
  );
}

function AnnotationCenter({
  section,
  onSectionChange,
  onReviewJob
}: {
  section: AnnotationSection;
  onSectionChange: (section: AnnotationSection) => void;
  onReviewJob: (jobId: string) => void;
}) {
  return (
    <div className="annotation-shell">
      <AnnotationNav section={section} onChange={onSectionChange} />
      <div className="annotation-content">
        {section === 'jobs' && <JobCenter onReviewJob={onReviewJob} />}
        {section === 'review' && <ReviewView />}
        {section === 'import' && <ImportView />}
        {section === 'prompts' && <PromptLibraryView />}
        {section === 'settings' && <SettingsView />}
        {section === 'export' && <ExportView onReviewJob={onReviewJob} />}
      </div>
    </div>
  );
}

function ImportView() {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [batches, setBatches] = useState<string[]>([]);

  async function refreshBatches() {
    const response = await api.listAssets();
    setBatches(Array.isArray(response.batches) ? response.batches : []);
  }

  useEffect(() => {
    void refreshBatches();
  }, []);

  async function submit(values: { folder_path: string; batch: string; copy_assets?: boolean }) {
    setLoading(true);
    try {
      const result = await api.importAssets({ folder_path: values.folder_path, batch: values.batch || 'default', copy_assets: values.copy_assets ?? true });
      message.success(`导入 ${result.imported} 条，重复 ${result.duplicates} 条`);
      if (result.failed.length) {
        modal.warning({ title: '导入异常', content: result.failed.slice(0, 8).map((item) => `${item.path}: ${item.reason}`).join('\n') });
      }
      await refreshBatches();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="single-panel">
      <Title level={4}>素材导入</Title>
      <Form form={form} layout="vertical" initialValues={{ batch: 'default', copy_assets: true }} onFinish={submit}>
        <Form.Item name="folder_path" label="图片文件夹" rules={[{ required: true, message: '请输入文件夹路径' }]}>
          <Input placeholder="D:\\data\\images" />
        </Form.Item>
        <Form.Item name="batch" label="批次名">
          <Input placeholder="例如：产品图_第一批" />
        </Form.Item>
        <Form.Item name="copy_assets" valuePropName="checked">
          <Checkbox>复制到工作区</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} icon={<Upload size={16} />}>开始导入</Button>
      </Form>
      <div className="batch-strip">
        {batches.map((batch) => <Tag key={batch}>{batch}</Tag>)}
      </div>
    </div>
  );
}

function SettingsView() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    api.getSettings()
      .then((payload) => form.setFieldsValue(payload.vlm))
      .catch((error) => message.error((error as Error).message));
  }, [form, message]);

  async function save(values: SettingsPayload['vlm']) {
    await api.saveVlmSettings(values);
    message.success('Teacher 设置已保存');
  }

  return (
    <div className="single-panel">
      <Title level={4}>Teacher</Title>
      <Form form={form} layout="vertical" initialValues={emptySettings.vlm} onFinish={save}>
        <Form.Item name="endpoint" label="内网 endpoint">
          <Input placeholder="http://teacher.internal/v1" />
        </Form.Item>
        <Form.Item name="api_key" label="API Key">
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item name="model" label="model">
          <Input placeholder="Qwen2.5-VL-72B-Instruct" />
        </Form.Item>
        <Form.Item name="timeout_seconds" label="超时">
          <InputNumber min={1} max={600} />
        </Form.Item>
        <Form.Item name="prompt_template" label="默认提示词">
          <Input.TextArea rows={6} />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<Save size={16} />}>保存</Button>
      </Form>
    </div>
  );
}

function PromptLibraryView() {
  const { message } = AntApp.useApp();
  const [sceneForm] = Form.useForm();
  const [versionForm] = Form.useForm();
  const [scenes, setScenes] = useState<PromptScene[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const response = await api.listPromptScenes();
    setScenes(Array.isArray(response.items) ? response.items : []);
  }

  useEffect(() => {
    void refresh().catch((error) => message.error((error as Error).message));
  }, []);

  async function createScene(values: { name: string; description?: string }) {
    setLoading(true);
    try {
      const scene = await api.createPromptScene({ name: values.name, description: values.description ?? '' });
      message.success(`已创建：${scene.name}`);
      sceneForm.resetFields();
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createVersion(values: { scene_id: number; version: string; prompt_text: string; notes?: string }) {
    setLoading(true);
    try {
      await api.createPromptVersion({
        scene_id: values.scene_id,
        version: values.version,
        prompt_text: values.prompt_text,
        notes: values.notes ?? ''
      });
      message.success('版本已保存');
      versionForm.resetFields(['version', 'prompt_text', 'notes']);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const versionRows = scenes.flatMap((scene) =>
    (scene.versions ?? []).map((version) => ({
      ...version,
      scene_name: scene.name
    }))
  );

  return (
    <div className="prompt-grid">
      <section className="ops-panel">
        <Title level={4}>场景</Title>
        <Form form={sceneForm} layout="vertical" onFinish={createScene}>
          <Form.Item name="name" label="场景名" rules={[{ required: true, message: '请输入场景名' }]}>
            <Input placeholder="例如：商品图细节问答" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>新建</Button>
        </Form>
      </section>
      <section className="ops-panel">
        <Title level={4}>版本</Title>
        <Form form={versionForm} layout="vertical" onFinish={createVersion}>
          <Form.Item name="scene_id" label="所属场景" rules={[{ required: true, message: '请选择场景' }]}>
            <Select options={scenes.map((scene) => ({ label: scene.name, value: scene.id }))} />
          </Form.Item>
          <Form.Item name="version" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}>
            <Input placeholder="v1 / v2-cot" />
          </Form.Item>
          <Form.Item name="prompt_text" label="提示词" rules={[{ required: true, message: '请输入提示词' }]}>
            <Input.TextArea rows={8} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>保存版本</Button>
        </Form>
      </section>
      <section className="ops-panel full">
        <div className="panel-title-row">
          <Title level={4}>版本列表</Title>
          <Button icon={<RefreshCw size={16} />} onClick={() => refresh()} />
        </div>
        <Table
          rowKey="id"
          size="small"
          dataSource={versionRows}
          pagination={{ pageSize: 6 }}
          scroll={{ x: 720 }}
          expandable={{ expandedRowRender: (row) => <pre className="prompt-preview">{row.prompt_text}</pre> }}
          columns={[
            { title: '场景', dataIndex: 'scene_name', width: 180, ellipsis: true },
            { title: '版本', dataIndex: 'version', width: 140 },
            { title: '备注', dataIndex: 'notes', ellipsis: true },
            { title: '创建时间', dataIndex: 'created_at', width: 190 }
          ]}
        />
      </section>
    </div>
  );
}

function JobCenter({ onReviewJob }: { onReviewJob: (jobId: string) => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);
  const [batches, setBatches] = useState<string[]>([]);
  const [scenes, setScenes] = useState<PromptScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number>();
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const [jobsResponse, assetsResponse, scenesResponse] = await Promise.all([api.listAnnotationJobs(), api.listAssets(), api.listPromptScenes()]);
    setJobs(Array.isArray(jobsResponse.items) ? jobsResponse.items : []);
    setBatches(Array.isArray(assetsResponse.batches) ? assetsResponse.batches : []);
    setScenes(Array.isArray(scenesResponse.items) ? scenesResponse.items : []);
  }

  useEffect(() => {
    void refresh().catch((error) => message.error((error as Error).message));
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  async function create(values: {
    name: string;
    batch?: string;
    status: string;
    concurrency: number;
    overwrite_existing?: boolean;
    prompt_scene_id?: number;
    prompt_version_id?: number;
    custom_prompt?: string;
  }) {
    setLoading(true);
    try {
      const job = await api.createAnnotationJob({
        name: values.name,
        batch: values.batch,
        status: values.status,
        concurrency: values.concurrency,
        overwrite_existing: values.overwrite_existing ?? false,
        prompt_scene_id: values.prompt_scene_id,
        prompt_version_id: values.prompt_version_id,
        custom_prompt: values.custom_prompt ?? ''
      });
      message.success(`任务已启动：${job.name}`);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId);

  async function exportJob(job: AnnotationJob, acceptedOnly: boolean) {
    try {
      const result = await api.exportAnnotationJob(job.id, { accepted_only: acceptedOnly });
      message.success(`已导出 ${result.count} 条：${result.jsonl_path}`);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  return (
    <div className="jobs-grid">
      <section className="ops-panel">
        <Title level={4}>创建任务</Title>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: `teacher_${new Date().toISOString().slice(0, 10)}`, status: 'raw', concurrency: 3, overwrite_existing: false }}
          onFinish={create}
        >
          <Form.Item name="name" label="任务名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="batch" label="素材批次">
            <Select allowClear placeholder="全部批次" options={batches.map((batch) => ({ label: batch, value: batch }))} />
          </Form.Item>
          <Form.Item name="status" label="素材状态">
            <Select
              options={[
                { label: 'raw', value: 'raw' },
                { label: 'rework', value: 'rework' },
                { label: 'all', value: 'all' }
              ]}
            />
          </Form.Item>
          <Form.Item name="concurrency" label="并发数">
            <InputNumber min={1} max={16} />
          </Form.Item>
          <Form.Item name="prompt_scene_id" label="提示词场景">
            <Select
              allowClear
              placeholder="使用全局默认"
              options={scenes.map((scene) => ({ label: scene.name, value: scene.id }))}
              onChange={(value) => {
                setSelectedSceneId(value);
                form.setFieldValue('prompt_version_id', undefined);
              }}
            />
          </Form.Item>
          <Form.Item name="prompt_version_id" label="提示词版本">
            <Select
              allowClear
              placeholder={selectedScene ? '默认最新版本' : '先选场景'}
              disabled={!selectedScene}
              options={(selectedScene?.versions ?? []).map((version) => ({ label: version.version, value: version.id }))}
            />
          </Form.Item>
          <Form.Item name="custom_prompt" label="临时提示词">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item name="overwrite_existing" valuePropName="checked">
            <Checkbox>覆盖已有标注</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} icon={<Play size={16} />}>启动标注</Button>
        </Form>
      </section>
      <section className="ops-panel">
        <div className="panel-title-row">
          <Title level={4}>任务列表</Title>
          <Button icon={<RefreshCw size={16} />} onClick={() => refresh()} />
        </div>
        <Table
          rowKey="id"
          size="small"
          dataSource={jobs}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 900 }}
          columns={[
            { title: '任务', dataIndex: 'name', ellipsis: true },
            { title: '状态', dataIndex: 'status', width: 140, render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
            {
              title: '提示词',
              width: 180,
              render: (_: unknown, job: AnnotationJob) => <Text ellipsis>{String(job.config?.prompt_label ?? '全局默认')}</Text>
            },
            {
              title: '进度',
              width: 180,
              render: (_: unknown, job: AnnotationJob) => <Progress percent={progressOf(job)} size="small" status={job.failed_count ? 'exception' : undefined} />
            },
            {
              title: '数量',
              width: 110,
              render: (_: unknown, job: AnnotationJob) => `${job.completed_count}/${job.total_count}`
            },
            {
              title: '操作',
              width: 260,
              render: (_: unknown, job: AnnotationJob) => (
                <Space>
                  <Button size="small" icon={<Edit3 size={14} />} onClick={() => onReviewJob(job.id)}>查看</Button>
                  <Button size="small" icon={<Download size={14} />} onClick={() => exportJob(job, false)}>导出</Button>
                  <Button size="small" onClick={() => exportJob(job, true)}>仅入库</Button>
                </Space>
              )
            }
          ]}
        />
      </section>
    </div>
  );
}

function ExportView({ onReviewJob }: { onReviewJob: (jobId: string) => void }) {
  const { message } = AntApp.useApp();
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);

  async function refresh() {
    const response = await api.listAnnotationJobs();
    setJobs(Array.isArray(response.items) ? response.items : []);
  }

  useEffect(() => {
    void refresh().catch((error) => message.error((error as Error).message));
  }, []);

  async function exportJob(job: AnnotationJob, acceptedOnly: boolean) {
    try {
      const result = await api.exportAnnotationJob(job.id, { accepted_only: acceptedOnly });
      message.success(`已导出 ${result.count} 条：${result.jsonl_path}`);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  return (
    <section className="ops-panel full">
      <div className="panel-title-row">
        <Title level={4}>导出 JSON</Title>
        <Button icon={<RefreshCw size={16} />} onClick={() => refresh()} />
      </div>
      <Table
        rowKey="id"
        size="small"
        dataSource={jobs}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 900 }}
        columns={[
          { title: '任务', dataIndex: 'name', ellipsis: true },
          { title: '状态', dataIndex: 'status', width: 160, render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
          { title: '已完成', width: 100, render: (_: unknown, job: AnnotationJob) => `${job.completed_count}/${job.total_count}` },
          { title: '导出路径', dataIndex: 'export_path', ellipsis: true },
          {
            title: '操作',
            width: 240,
            render: (_: unknown, job: AnnotationJob) => (
              <Space>
                <Button size="small" icon={<Edit3 size={14} />} onClick={() => onReviewJob(job.id)}>查看</Button>
                <Button size="small" icon={<Download size={14} />} onClick={() => exportJob(job, false)}>导出全部</Button>
                <Button size="small" onClick={() => exportJob(job, true)}>仅入库</Button>
              </Space>
            )
          }
        ]}
      />
    </section>
  );
}

function ReviewView({ jobId }: { jobId?: string }) {
  const { message, modal } = AntApp.useApp();
  const [job, setJob] = useState<AnnotationJob>();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [validation, setValidation] = useState<Validation>({ errors: [], warnings: [] });
  const [status, setStatus] = useState<AnnotationStatus>('prelabelled');
  const [query, setQuery] = useState('');
  const [qualityNotes, setQualityNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [isGolden, setIsGolden] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadAsset(asset: Asset) {
    const response = await api.getAnnotation(asset.id);
    setSelected(response.asset);
    setMessages(response.asset.annotation.messages.length ? response.asset.annotation.messages : [{ role: 'user', content: '' }, { role: 'assistant', content: '' }]);
    setValidation(response.validation);
    setQualityNotes(response.asset.annotation.quality_notes);
    setTagsText(response.asset.tags.join(','));
    setIsGolden(response.asset.annotation.is_golden);
  }

  async function refresh(nextAssetId?: number) {
    setLoading(true);
    try {
      if (jobId) {
        const payload = await api.getAnnotationJob(jobId);
        setJob(payload);
        const jobAssets = (payload.items ?? []).map((item) => item.asset).filter(Boolean);
        setAssets(jobAssets);
        const next = jobAssets.find((asset) => asset.id === nextAssetId) ?? jobAssets[0];
        if (next) await loadAsset(next);
      } else {
        const response = await api.listAssets({ status, q: query });
        setAssets(Array.isArray(response.items) ? response.items : []);
        const next = response.items.find((asset) => asset.id === nextAssetId) ?? response.items[0];
        if (next) await loadAsset(next);
      }
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshJobOnly() {
    if (!jobId) return;
    try {
      const payload = await api.getAnnotationJob(jobId);
      setJob(payload);
      setAssets((payload.items ?? []).map((item) => item.asset).filter(Boolean));
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (jobId) void refreshJobOnly();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobId, status]);

  async function save(statusOverride?: AnnotationStatus) {
    if (!selected) return;
    try {
      const response = await api.saveAnnotation(selected.id, {
        messages,
        status: statusOverride,
        is_golden: isGolden,
        quality_notes: qualityNotes,
        tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean)
      });
      setSelected(response.asset);
      setValidation(response.validation);
      message.success('已保存');
      await refresh(response.asset.id);
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function accept() {
    if (!selected) return;
    try {
      await save('annotated');
      const response = await api.acceptAnnotation(selected.id);
      setSelected(response.asset);
      setValidation(response.validation);
      message.success('已入库');
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function rework() {
    if (!selected) return;
    modal.confirm({
      title: '返修原因',
      content: <Input.TextArea id="rework-reason" rows={3} />,
      onOk: async () => {
        const reason = (document.getElementById('rework-reason') as HTMLTextAreaElement | null)?.value ?? '';
        await api.reworkAnnotation(selected.id, reason);
        message.success('已返修');
        await refresh();
      }
    });
  }

  function updateMessage(index: number, patch: Partial<Message>) {
    setMessages((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  const itemsByAsset = useMemo(() => {
    const map = new Map<number, AnnotationJobItem>();
    job?.items?.forEach((item) => map.set(item.asset_id, item));
    return map;
  }, [job]);

  return (
    <div className="workspace-grid">
      <aside className="side-panel">
        {job ? (
          <div className="job-summary">
            <Text strong>{job.name}</Text>
            <Tag color={statusColor(job.status)}>{job.status}</Tag>
            <Progress percent={progressOf(job)} size="small" />
          </div>
        ) : (
          <>
            <Input prefix={<Search size={15} />} placeholder="文件名" value={query} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => refresh()} />
            <Select value={status} onChange={setStatus} options={statusOptions.map((item) => ({ label: item.label, value: item.value }))} />
          </>
        )}
        <Button icon={<RefreshCw size={16} />} onClick={() => refresh(selected?.id)}>刷新</Button>
        <Spin spinning={loading}>
          <List
            className="asset-list"
            dataSource={assets}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(asset) => {
              const item = itemsByAsset.get(asset.id);
              return (
                <button className={`asset-row ${selected?.id === asset.id ? 'selected' : ''}`} onClick={() => loadAsset(asset)}>
                  <span className="thumb"><ImageIcon size={18} /></span>
                  <span className="asset-main">
                    <Text ellipsis>{asset.file_name}</Text>
                    <span className="asset-meta">{asset.width}x{asset.height} · {asset.batch}</span>
                  </span>
                  <Space direction="vertical" size={2}>
                    <Tag color={statusColor(asset.annotation.status)}>{asset.annotation.status}</Tag>
                    {item && <Tag color={statusColor(item.status)}>{item.status}</Tag>}
                  </Space>
                </button>
              );
            }}
          />
        </Spin>
      </aside>

      <main className="image-panel">
        {selected ? (
          <>
            <div className="image-toolbar">
              <Space>
                <Tag color={selected.duplicate_of ? 'orange' : 'blue'}>{selected.id}</Tag>
                <Text strong>{selected.file_name}</Text>
              </Space>
              <Space>
                <Statistic value={`${selected.width}x${selected.height}`} title="尺寸" />
                <Tag color={statusColor(selected.annotation.status)}>{selected.annotation.status}</Tag>
              </Space>
            </div>
            <div className="image-stage">
              <Image src={api.imageUrl(selected)} alt={selected.file_name} preview />
            </div>
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </main>

      <aside className="editor-panel">
        <div className="editor-actions">
          <Space wrap>
            <Tooltip title="保存"><Button icon={<Save size={16} />} onClick={() => save('annotated')} disabled={!selected} /></Tooltip>
            <Tooltip title="入库"><Button type="primary" icon={<CheckCircle size={16} />} onClick={accept} disabled={!selected} /></Tooltip>
            <Tooltip title="返修"><Button danger icon={<RefreshCw size={16} />} onClick={rework} disabled={!selected} /></Tooltip>
          </Space>
        </div>
        <div className="message-list">
          {messages.map((item, index) => (
            <div className="message-row" key={`${index}-${item.role}`}>
              <Select
                value={item.role}
                onChange={(role) => updateMessage(index, { role })}
                options={[
                  { label: 'system', value: 'system' },
                  { label: 'user', value: 'user' },
                  { label: 'assistant', value: 'assistant' }
                ]}
              />
              <Input.TextArea value={item.content} onChange={(event) => updateMessage(index, { content: event.target.value })} autoSize={{ minRows: 2, maxRows: 8 }} />
              <Button onClick={() => setMessages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
            </div>
          ))}
          <Button block onClick={() => setMessages((current) => [...current, { role: 'user', content: '' }, { role: 'assistant', content: '' }])}>
            添加一轮
          </Button>
        </div>
        <div className="meta-grid">
          <Checkbox checked={isGolden} onChange={(event) => setIsGolden(event.target.checked)}>黄金集</Checkbox>
          <Input value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="标签，逗号分隔" />
          <Input.TextArea value={qualityNotes} onChange={(event) => setQualityNotes(event.target.value)} rows={2} placeholder="备注" />
        </div>
        <div className="validation-box">
          {validation.errors.map((item) => <Alert key={item} type="error" message={item} showIcon />)}
          {validation.warnings.map((item) => <Alert key={item} type="warning" message={item} showIcon />)}
          {!validation.errors.length && !validation.warnings.length && <Alert type="success" message="校验通过" showIcon />}
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  const [route, setRouteState] = useState(() => routeFromHash());
  const [reviewJobId, setReviewJobId] = useState<string>();

  useEffect(() => {
    const syncView = () => setRouteState(routeFromHash());
    window.addEventListener('hashchange', syncView);
    syncView();
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  function goHome() {
    setReviewJobId(undefined);
    setRoute('home');
  }

  function openAnnotation(section: AnnotationSection = 'jobs') {
    if (section !== 'review') setReviewJobId(undefined);
    setRoute('annotation', section);
  }

  function reviewJob(jobId: string) {
    setReviewJobId(jobId);
    setRoute('annotation', 'review');
  }

  return (
    <AntApp>
      <Layout className="app-shell">
        <Header className="app-header">
          <button className="brand-mark" type="button" onClick={goHome} aria-label="返回首页">
            <span className="brand-main">S</span>
            <span className="brand-sub">FT</span>
          </button>
          <div className="header-copy">
            <Title level={4}>图文标注工具</Title>
          </div>
          <Space className="header-actions">
            {route.view !== 'home' && <Button icon={<ArrowLeft size={16} />} onClick={goHome}>首页</Button>}
            <Button icon={<Home size={16} />} onClick={goHome} />
          </Space>
        </Header>
        <Content className="app-content">
          <ErrorBoundary key={`${route.view}-${route.section}-${reviewJobId ?? ''}`}>
            {route.view === 'home' && <HomeView onOpenAnnotation={() => openAnnotation('jobs')} />}
            {route.view === 'annotation' && (
              <AnnotationCenter section={route.section} onSectionChange={openAnnotation} onReviewJob={reviewJob} />
            )}
          </ErrorBoundary>
        </Content>
      </Layout>
    </AntApp>
  );
}
