import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Carousel,
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
  DatePicker,
  Segmented,
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
  BookOpenText,
  Bot,
  CheckCircle,
  Download,
  Edit3,
  Image as ImageIcon,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Settings,
  Square,
  Trash2,
  Wifi,
} from 'lucide-react';
import { api } from './api';
import type {
  AnnotationJob,
  AnnotationJobItem,
  AnnotationLevel,
  AnnotationStatus,
  Asset,
  Message,
  PromptScene,
  SettingsPayload,
  TeacherConfig,
  TeacherConnectionTestResult,
  Validation
} from './types';

const { Header, Content } = Layout;
const { Text, Title } = Typography;

type ViewKey = 'home' | 'annotation';
type AnnotationSection = 'jobs' | 'review' | 'prompts' | 'settings';

const annotationSections: AnnotationSection[] = ['jobs', 'review', 'prompts', 'settings'];

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
  { label: '未标注', value: 'raw', color: 'default' },
  { label: '已预标注', value: 'prelabelled', color: 'processing' },
  { label: '已修订', value: 'annotated', color: 'warning' },
  { label: '已入库', value: 'accepted', color: 'success' },
  { label: '待返修', value: 'rework', color: 'error' }
];

const jobItemStatusText: Record<string, string> = {
  queued: '排队中',
  running: '标注中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

const jobStatusText: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  completed_with_errors: '部分失败',
  failed: '失败',
  cancelled: '已取消'
};

const emptySettings: SettingsPayload = {
  swift: { swift_bin: 'swift', working_dir: '', default_cuda_visible_devices: '0' },
  vlm: {
    endpoint: '',
    api_key: '',
    model: '',
    timeout_seconds: 60
  },
  teachers: { active_id: '', items: [] }
};

function statusColor(status: string) {
  return statusOptions.find((item) => item.value === status)?.color ?? jobStatusColor(status);
}

function jobStatusColor(status: string) {
  if (status === 'completed') return 'success';
  if (status === 'running') return 'processing';
  if (status === 'queued') return 'default';
  if (status === 'paused') return 'warning';
  if (status === 'completed_with_errors') return 'warning';
  if (status === 'cancelled') return 'default';
  return status.includes('fail') ? 'error' : 'default';
}

function annotationStatusText(status: string) {
  return statusOptions.find((item) => item.value === status)?.label ?? status;
}

function jobItemStatusLabel(status: string) {
  return jobItemStatusText[status] ?? status;
}

function jobStatusLabel(status: string) {
  return jobStatusText[status] ?? status;
}

function progressOf(job: AnnotationJob) {
  if (!job.total_count) return 0;
  return Math.round(((job.completed_count + job.failed_count) / job.total_count) * 100);
}

function jobLevel(job: AnnotationJob) {
  return job.config?.annotation_level === 'behavior' ? 'behavior' : 'instance';
}

function jobLevelLabel(job: AnnotationJob) {
  return jobLevel(job) === 'behavior' ? '行为级' : '实例级';
}

function annotationLevelLabel(level?: string) {
  return level === 'behavior' ? '行为级' : '实例级';
}

function annotationLevelTagColor(level?: string) {
  return level === 'behavior' ? 'purple' : 'blue';
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function dateKey(value?: string | null) {
  return value?.slice(0, 10) ?? '';
}

function compactPath(value: unknown) {
  const path = String(value ?? '');
  if (!path) return '-';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `...\\${parts.slice(-3).join('\\')}`;
}

function TopWorkspaceNav({
  route,
  onOpenAnnotation
}: {
  route: { view: ViewKey; section: AnnotationSection };
  onOpenAnnotation: () => void;
}) {
  return (
    <nav className="top-workspace-nav" aria-label="工作台">
      <button className={`top-workspace-item ${route.view === 'annotation' ? 'active' : ''}`} type="button" onClick={onOpenAnnotation}>
        <Bot size={15} />
        <span>标注中心</span>
      </button>
    </nav>
  );
}

const homeSlides = Array.from({ length: 10 }, (_, index) => ({
  src: `/home/wilderness-${index + 1}.jpg`,
  alt: `山水旷野轮播图 ${index + 1}`
}));

function HomeView() {
  return (
    <div className="home-page">
      <section className="home-sanctuary" aria-label="首页">
        <Text className="home-quote">山高路远，步履不停；心有旷野，终见云开。</Text>
        <div className="home-carousel-shell">
          <Carousel autoplay autoplaySpeed={5200} pauseOnHover className="home-carousel">
            {homeSlides.map((slide) => (
              <div className="home-slide" key={slide.src}>
                <img src={slide.src} alt={slide.alt} draggable={false} />
              </div>
            ))}
          </Carousel>
        </div>
      </section>
    </div>
  );
}

function AnnotationNav({ section, onChange }: { section: AnnotationSection; onChange: (section: AnnotationSection) => void }) {
  const items: Array<{ key: AnnotationSection; label: string; icon: ReactNode }> = [
    { key: 'jobs', label: '标注任务', icon: <Bot size={16} /> },
    { key: 'review', label: '人工审核', icon: <Edit3 size={16} /> },
    { key: 'prompts', label: '提示词库', icon: <BookOpenText size={16} /> },
    { key: 'settings', label: 'Teacher', icon: <Settings size={16} /> }
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
  onReviewJob,
  reviewJobId,
  navCollapsed
}: {
  section: AnnotationSection;
  onSectionChange: (section: AnnotationSection) => void;
  onReviewJob: (jobId: string) => void;
  reviewJobId?: string;
  navCollapsed: boolean;
}) {
  return (
    <div className={`annotation-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
      {navCollapsed && <div className="nav-hover-zone" aria-hidden="true" />}
      <AnnotationNav section={section} onChange={onSectionChange} />
      <div className="annotation-content">
        {section === 'jobs' && <JobCenter onReviewJob={onReviewJob} />}
        {section === 'review' && <ReviewView jobId={reviewJobId} onReviewJob={onReviewJob} onClearJob={() => onSectionChange('review')} />}
        {section === 'prompts' && <PromptLibraryView />}
        {section === 'settings' && <SettingsView />}
      </div>
    </div>
  );
}

function SettingsView() {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm<Partial<TeacherConfig>>();
  const [teachers, setTeachers] = useState<TeacherConfig[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [testResult, setTestResult] = useState<TeacherConnectionTestResult>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyTeacher: Partial<TeacherConfig> = {
    id: '',
    name: '默认 Teacher',
    endpoint: '',
    api_key: '',
    model: '',
    timeout_seconds: 60
  };

  function applyStore(store: SettingsPayload['teachers'], preferredId?: string) {
    const items = Array.isArray(store.items) ? store.items : [];
    setTeachers(items);
    setActiveId(store.active_id ?? '');
    const next = items.find((item) => item.id === preferredId)
      ?? items.find((item) => item.id === store.active_id)
      ?? items[0];
    if (next) {
      setSelectedId(next.id);
      form.setFieldsValue(next);
    } else {
      setSelectedId('');
      form.setFieldsValue(emptyTeacher);
    }
  }

  async function refresh(preferredId?: string) {
    setLoading(true);
    try {
      const store = await api.listTeacherConfigs();
      applyStore(store, preferredId);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function selectConfig(config: TeacherConfig) {
    setSelectedId(config.id);
    setTestResult(undefined);
    form.setFieldsValue(config);
  }

  function createConfig() {
    setSelectedId('');
    setTestResult(undefined);
    form.setFieldsValue({ ...emptyTeacher, name: `Teacher ${teachers.length + 1}` });
  }

  async function save(values: Partial<TeacherConfig>) {
    setSaving(true);
    try {
      const payload = { ...values, id: selectedId || values.id || undefined };
      const store = await api.saveTeacherConfig(payload);
      const nextId = payload.id || store.items[store.items.length - 1]?.id;
      applyStore(store, nextId);
      message.success('Teacher 配置已保存');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function activateCurrent() {
    if (!selectedId) {
      message.warning('请先保存当前配置');
      return;
    }
    try {
      const store = await api.activateTeacherConfig(selectedId);
      applyStore(store, selectedId);
      message.success('已设为启用配置');
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function activateConfig(configId: string) {
    try {
      const store = await api.activateTeacherConfig(configId);
      applyStore(store, configId);
      message.success('已设为启用配置');
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function testCurrent() {
    try {
      const result = await api.testTeacherConfig({ ...form.getFieldsValue(), id: selectedId || undefined });
      setTestResult(result);
      if (result.ok) {
        message.success('Teacher 连接正常');
      } else {
        message.warning(result.message);
      }
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  function deleteConfig(config: TeacherConfig) {
    modal.confirm({
      title: `删除 ${config.name}？`,
      content: activeId === config.id ? '当前配置正在启用，删除后会自动切换到列表中的其它配置。' : '删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const store = await api.deleteTeacherConfig(config.id);
        applyStore(store);
        message.success('已删除配置');
      }
    });
  }

  return (
    <div className="single-panel teacher-settings-panel">
      <div className="panel-title-row">
        <Title level={4}>Teacher 配置</Title>
        <Button icon={<RefreshCw size={16} />} onClick={() => refresh(selectedId)}>刷新</Button>
      </div>
      <div className="teacher-settings-grid">
        <section className="teacher-list-panel">
          <div className="panel-title-row">
            <Text strong>配置列表</Text>
            <Button size="small" icon={<Plus size={14} />} onClick={createConfig}>新建</Button>
          </div>
          <Spin spinning={loading}>
            <List
              dataSource={teachers}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置" /> }}
              renderItem={(config) => (
                <List.Item className="teacher-list-item">
                  <div
                    className={`teacher-config-row ${selectedId === config.id ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectConfig(config)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') selectConfig(config);
                    }}
                  >
                    <div className="teacher-config-main">
                      <Space size={6}>
                        <Text strong ellipsis>{config.name}</Text>
                        {activeId === config.id && <Tag color="green">启用中</Tag>}
                      </Space>
                      <Text type="secondary" ellipsis>{config.model || '未填写 model'}</Text>
                    </div>
                    <Space>
                      <Tooltip title="设为启用">
                        <Button
                          size="small"
                          icon={<Power size={14} />}
                          disabled={activeId === config.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void activateConfig(config.id);
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button
                          size="small"
                          danger
                          icon={<Trash2 size={14} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteConfig(config);
                          }}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                </List.Item>
              )}
            />
          </Spin>
        </section>

        <section className="teacher-editor-panel">
          <Form form={form} layout="vertical" initialValues={emptyTeacher} onFinish={save}>
            <Form.Item name="id" hidden><Input /></Form.Item>
            <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]}>
              <Input placeholder="例如：内网 Qwen-VL Teacher" />
            </Form.Item>
            <Form.Item name="endpoint" label="内网 endpoint">
              <Input placeholder="http://teacher.internal/v1" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key">
              <Input.Password placeholder="sk-..." />
            </Form.Item>
            <Form.Item name="model" label="model">
              <Input placeholder="Qwen2.5-VL-72B-Instruct" />
            </Form.Item>
            <Form.Item name="timeout_seconds" label="超时（秒）">
              <InputNumber min={1} max={600} />
            </Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={saving} icon={<Save size={16} />}>保存配置</Button>
              <Button icon={<Wifi size={16} />} onClick={testCurrent}>检测连接</Button>
              <Button icon={<Power size={16} />} disabled={!selectedId || activeId === selectedId} onClick={activateCurrent}>设为启用</Button>
            </Space>
          </Form>
          {testResult && (
            <Alert
              className="teacher-test-result"
              type={testResult.ok ? 'success' : 'warning'}
              showIcon
              message={testResult.message}
              description={[
                testResult.status_code ? `HTTP ${testResult.status_code}` : '',
                testResult.latency_ms != null ? `${testResult.latency_ms} ms` : '',
                testResult.model ? `model: ${testResult.model}` : ''
              ].filter(Boolean).join(' · ')}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PromptLibraryView() {
  const { message } = AntApp.useApp();
  const [sceneForm] = Form.useForm();
  const [versionForm] = Form.useForm();
  const [scenes, setScenes] = useState<PromptScene[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sceneModalOpen, setSceneModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<PromptScene | null>(null);
  const [versionScene, setVersionScene] = useState<PromptScene | null>(null);

  async function refresh() {
    const response = await api.listPromptScenes();
    setScenes(Array.isArray(response.items) ? response.items : []);
  }

  useEffect(() => {
    void refresh().catch((error) => message.error((error as Error).message));
  }, []);

  const filteredScenes = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return scenes;
    return scenes.filter((scene) => {
      const versionText = (scene.versions ?? []).map((version) => `${version.version} ${version.prompt_text} ${version.notes}`).join(' ');
      return [
        scene.name,
        scene.description,
        scene.annotation_level,
        annotationLevelLabel(scene.annotation_level),
        versionText
      ].join(' ').toLowerCase().includes(keyword);
    });
  }, [scenes, searchText]);

  function latestVersion(scene: PromptScene) {
    return (scene.versions ?? [])[0];
  }

  function openCreateScene() {
    setEditingScene(null);
    sceneForm.resetFields();
    sceneForm.setFieldsValue({ annotation_level: 'instance', description: '' });
    setSceneModalOpen(true);
  }

  function openEditScene(scene: PromptScene) {
    setEditingScene(scene);
    sceneForm.setFieldsValue({
      name: scene.name,
      annotation_level: scene.annotation_level ?? 'instance',
      description: scene.description ?? ''
    });
    setSceneModalOpen(true);
  }

  function openAddVersion(scene: PromptScene) {
    setVersionScene(scene);
    versionForm.resetFields();
    setVersionModalOpen(true);
  }

  async function saveScene(values: { name: string; annotation_level: AnnotationLevel; description?: string }) {
    setLoading(true);
    try {
      const payload = {
        name: values.name,
        annotation_level: values.annotation_level,
        description: values.description ?? ''
      };
      const scene = editingScene
        ? await api.updatePromptScene(editingScene.id, payload)
        : await api.createPromptScene(payload);
      message.success(editingScene ? `已更新：${scene.name}` : `已新建：${scene.name}`);
      sceneForm.resetFields();
      setSceneModalOpen(false);
      setEditingScene(null);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createVersion(values: { version: string; prompt_text: string; notes?: string }) {
    if (!versionScene) return;
    setLoading(true);
    try {
      await api.createPromptVersion({
        scene_id: versionScene.id,
        version: values.version,
        prompt_text: values.prompt_text,
        notes: values.notes ?? ''
      });
      message.success('版本已保存');
      versionForm.resetFields();
      setVersionModalOpen(false);
      setVersionScene(null);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="ops-panel full task-board-panel prompt-library-panel">
        <div className="panel-title-row task-title-row">
          <Title level={4}>提示词库</Title>
          <Space className="task-title-actions" wrap>
            <Button icon={<RefreshCw size={16} />} onClick={() => refresh()}>刷新</Button>
            <Button type="primary" icon={<Plus size={16} />} onClick={openCreateScene}>新建场景</Button>
          </Space>
        </div>
        <div className="task-toolbar prompt-toolbar">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder="搜索场景名 / 等级 / 版本 / 提示词"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Text type="secondary">共 {filteredScenes.length} / {scenes.length} 个场景</Text>
        </div>
        <Table
          rowKey="id"
          size="small"
          tableLayout="fixed"
          loading={loading}
          dataSource={filteredScenes}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1140 }}
          expandable={{
            expandedRowRender: (scene) => {
              const versions = scene.versions ?? [];
              return (
                <div className="prompt-expanded">
                  <div className="prompt-expanded-meta">
                    <Text type="secondary">说明</Text>
                    <Text>{scene.description || '暂无说明'}</Text>
                  </div>
                  {versions.length ? (
                    <div className="prompt-version-list">
                      {versions.map((version) => (
                        <article className="prompt-version-card" key={version.id}>
                          <div className="prompt-version-head">
                            <Space wrap>
                              <Tag color="blue">{version.version}</Tag>
                              {version.notes && <Text type="secondary">{version.notes}</Text>}
                            </Space>
                            <Text type="secondary">{formatDateTime(version.created_at)}</Text>
                          </div>
                          <pre className="prompt-preview">{version.prompt_text}</pre>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无版本" />
                  )}
                </div>
              );
            }
          }}
          columns={[
            {
              title: '场景名',
              width: 220,
              fixed: 'left',
              render: (_: unknown, scene: PromptScene) => (
                <div className="job-name-cell">
                  <Text strong ellipsis>{scene.name}</Text>
                  <Text type="secondary" ellipsis>ID: {scene.id}</Text>
                </div>
              )
            },
            {
              title: '等级',
              width: 100,
              render: (_: unknown, scene: PromptScene) => (
                <Tag color={annotationLevelTagColor(scene.annotation_level)}>{annotationLevelLabel(scene.annotation_level)}</Tag>
              )
            },
            {
              title: '版本',
              width: 150,
              render: (_: unknown, scene: PromptScene) => {
                const latest = latestVersion(scene);
                return latest ? (
                  <Space size={6} wrap>
                    <Tag color="blue">{latest.version}</Tag>
                    <Text type="secondary">共 {(scene.versions ?? []).length} 个</Text>
                  </Space>
                ) : <Text type="secondary">暂无版本</Text>;
              }
            },
            {
              title: '提示词预览',
              width: 360,
              render: (_: unknown, scene: PromptScene) => {
                const promptText = latestVersion(scene)?.prompt_text ?? '';
                if (!promptText) return <Text type="secondary">暂无提示词</Text>;
                return (
                  <Tooltip title={<pre className="prompt-tooltip">{promptText}</pre>}>
                    <Text className="prompt-snippet" ellipsis>{promptText}</Text>
                  </Tooltip>
                );
              }
            },
            { title: '更新时间', dataIndex: 'updated_at', width: 170, render: (value: string) => formatDateTime(value) },
            {
              title: '操作',
              width: 230,
              render: (_: unknown, scene: PromptScene) => (
                <Space wrap>
                  <Button size="small" icon={<Plus size={14} />} onClick={() => openAddVersion(scene)}>添加版本</Button>
                  <Button size="small" icon={<Edit3 size={14} />} onClick={() => openEditScene(scene)}>修改信息</Button>
                </Space>
              )
            }
          ]}
        />
      </section>
      <Modal
        title={editingScene ? '修改场景信息' : '新建提示词场景'}
        open={sceneModalOpen}
        onCancel={() => {
          setSceneModalOpen(false);
          setEditingScene(null);
        }}
        footer={null}
        destroyOnClose
        width={640}
      >
        <Form form={sceneForm} layout="vertical" onFinish={saveScene}>
          <Form.Item name="name" label="场景名" rules={[{ required: true, message: '请输入场景名' }]}>
            <Input placeholder="例如：小障碍物识别" />
          </Form.Item>
          <Form.Item name="annotation_level" label="标注等级" rules={[{ required: true, message: '请选择标注等级' }]}>
            <Select
              options={[
                { label: '实例级', value: 'instance' },
                { label: '行为级', value: 'behavior' }
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="用于说明该场景适用的数据、任务目标或评审注意点" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>{editingScene ? '保存修改' : '新建场景'}</Button>
            <Button onClick={() => setSceneModalOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
      <Modal
        title={versionScene ? `添加版本：${versionScene.name}` : '添加版本'}
        open={versionModalOpen}
        onCancel={() => {
          setVersionModalOpen(false);
          setVersionScene(null);
        }}
        footer={null}
        destroyOnClose
        width={760}
      >
        {versionScene && (
          <div className="prompt-version-context">
            <Tag color={annotationLevelTagColor(versionScene.annotation_level)}>{annotationLevelLabel(versionScene.annotation_level)}</Tag>
            <Text type="secondary">版本会保存到当前场景，不会与其他等级混用。</Text>
          </div>
        )}
        <Form form={versionForm} layout="vertical" onFinish={createVersion}>
          <Form.Item name="version" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}>
            <Input placeholder="v1 / v2-cot / 2026-07-road" />
          </Form.Item>
          <Form.Item name="prompt_text" label="提示词" rules={[{ required: true, message: '请输入提示词' }]}>
            <Input.TextArea rows={10} placeholder="请输入该场景下用于 Teacher 生产标注结果的完整提示词" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可记录本次迭代的变化点" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>保存版本</Button>
            <Button onClick={() => setVersionModalOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}

function JobCenter({ onReviewJob }: { onReviewJob: (jobId: string) => void }) {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);
  const [scenes, setScenes] = useState<PromptScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [createdDate, setCreatedDate] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const annotationLevel = Form.useWatch('annotation_level', form) ?? 'instance';
  const currentAnnotationLevel: AnnotationLevel = annotationLevel === 'behavior' ? 'behavior' : 'instance';

  async function refresh() {
    const [jobsResponse, scenesResponse] = await Promise.all([api.listAnnotationJobs(), api.listPromptScenes()]);
    setJobs(Array.isArray(jobsResponse.items) ? jobsResponse.items : []);
    setScenes(Array.isArray(scenesResponse.items) ? scenesResponse.items : []);
  }

  useEffect(() => {
    void refresh().catch((error) => message.error((error as Error).message));
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    form.setFieldsValue({ prompt_scene_id: undefined, prompt_version_id: undefined });
    setSelectedSceneId(undefined);
  }, [currentAnnotationLevel]);

  async function create(values: {
    name: string;
    folder_path: string;
    annotation_level: 'instance' | 'behavior';
    frame_count?: number;
    copy_assets?: boolean;
    concurrency: number;
    prompt_scene_id?: number;
    prompt_version_id?: number;
    custom_prompt?: string;
  }) {
    setLoading(true);
    try {
      const job = await api.createAnnotationJob({
        name: values.name,
        folder_path: values.folder_path,
        annotation_level: values.annotation_level,
        frame_count: values.annotation_level === 'behavior' ? values.frame_count ?? 5 : 1,
        copy_assets: values.copy_assets ?? true,
        concurrency: values.concurrency,
        overwrite_existing: false,
        prompt_scene_id: values.prompt_scene_id,
        prompt_version_id: values.prompt_version_id,
        custom_prompt: values.custom_prompt ?? ''
      });
      message.success(`任务已启动：${job.name}`);
      setIsCreateOpen(false);
      form.resetFields();
      setSelectedSceneId(undefined);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const availablePromptScenes = useMemo(
    () => scenes.filter((scene) => (scene.annotation_level ?? 'instance') === currentAnnotationLevel),
    [scenes, currentAnnotationLevel]
  );
  const selectedScene = availablePromptScenes.find((scene) => scene.id === selectedSceneId);
  const filteredJobs = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return jobs.filter((job) => {
      const searchable = [
        job.name,
        job.id,
        jobLevel(job),
        jobLevelLabel(job),
        jobStatusLabel(job.status)
      ].join(' ').toLowerCase();
      const matchesKeyword = !keyword || searchable.includes(keyword);
      const matchesDate = !createdDate || dateKey(job.created_at) === createdDate;
      return matchesKeyword && matchesDate;
    });
  }, [jobs, searchText, createdDate]);

  async function exportJob(job: AnnotationJob, acceptedOnly: boolean) {
    try {
      const result = await api.downloadAnnotationJob(job.id, { accepted_only: acceptedOnly });
      message.success(`已开始下载：${result.filename}`);
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  function cancelJob(job: AnnotationJob) {
    modal.confirm({
      title: `取消任务 ${job.name}？`,
      content: '已排队样本会停止调用 Teacher；正在请求中的样本会在当前请求结束后停止写入结果。',
      okText: '取消任务',
      okButtonProps: { danger: true },
      cancelText: '关闭',
      onOk: async () => {
        await api.cancelAnnotationJob(job.id);
        message.success('任务已取消');
        await refresh();
      }
    });
  }

  async function pauseJob(job: AnnotationJob) {
    try {
      await api.pauseAnnotationJob(job.id);
      message.success('任务已暂停');
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  async function resumeJob(job: AnnotationJob) {
    try {
      await api.resumeAnnotationJob(job.id);
      message.success('任务已继续');
      await refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  }

  function openCreateModal() {
    form.resetFields();
    setSelectedSceneId(undefined);
    setIsCreateOpen(true);
  }

  function renderJobActions(job: AnnotationJob) {
    return (
      <Space wrap>
        <Button size="small" icon={<Edit3 size={14} />} onClick={() => onReviewJob(job.id)}>查看</Button>
        {['queued', 'running'].includes(job.status) && (
          <Button size="small" icon={<Pause size={14} />} onClick={() => pauseJob(job)}>暂停</Button>
        )}
        {job.status === 'paused' && (
          <Button size="small" icon={<Play size={14} />} onClick={() => resumeJob(job)}>继续</Button>
        )}
        {['queued', 'running', 'paused'].includes(job.status) && (
          <Button size="small" danger icon={<Square size={14} />} onClick={() => cancelJob(job)}>取消</Button>
        )}
        <Button size="small" icon={<Download size={14} />} onClick={() => exportJob(job, false)}>导出</Button>
        <Button size="small" onClick={() => exportJob(job, true)}>仅导出已通过</Button>
      </Space>
    );
  }

  const createTaskForm = (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        name: `drive_${new Date().toISOString().slice(0, 10)}`,
        annotation_level: 'instance',
        frame_count: 5,
        concurrency: 3,
        copy_assets: true
      }}
      onFinish={create}
    >
      <Form.Item name="name" label="任务名" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="folder_path" label="本地图片目录" rules={[{ required: true, message: '请输入本地图片目录' }]}>
        <Input placeholder="D:\\datasets\\driving_frames\\scene_001" />
      </Form.Item>
      <Form.Item name="annotation_level" label="标注等级">
        <Select
          options={[
            { label: '实例级', value: 'instance' },
            { label: '行为级', value: 'behavior' }
          ]}
        />
      </Form.Item>
      {annotationLevel === 'behavior' && (
        <Form.Item name="frame_count" label="每条行为样本帧数">
          <InputNumber min={1} max={10} />
        </Form.Item>
      )}
      <Form.Item name="concurrency" label="并发数">
        <InputNumber min={1} max={16} />
      </Form.Item>
      <Form.Item name="prompt_scene_id" label="提示词场景">
        <Select
          allowClear
          placeholder={`可选：选择${annotationLevelLabel(currentAnnotationLevel)}场景`}
          options={availablePromptScenes.map((scene) => ({
            label: `${scene.name} · ${annotationLevelLabel(scene.annotation_level)}`,
            value: scene.id
          }))}
          onChange={(value) => {
            setSelectedSceneId(value as number | undefined);
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
      <Form.Item shouldUpdate noStyle>
        {({ getFieldValue }) => (
          <Form.Item
            name="custom_prompt"
            label="任务提示词"
            rules={[
              {
                validator: (_, value) => {
                  if (String(value ?? '').trim() || getFieldValue('prompt_version_id') || getFieldValue('prompt_scene_id')) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('请输入本次任务提示词，或选择提示词场景/版本'));
                }
              }
            ]}
          >
            <Input.TextArea
              rows={6}
              placeholder="请输入本次标注任务的场景提示词，例如：基于道路连续帧判断前车是否存在变道意图，并给出可见依据。"
            />
          </Form.Item>
        )}
      </Form.Item>
      <Form.Item name="copy_assets" valuePropName="checked">
        <Checkbox>复制图片到工作区</Checkbox>
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={loading} icon={<Play size={16} />}>启动标注</Button>
    </Form>
  );

  return (
    <div className="jobs-grid">
      <section className="ops-panel full task-board-panel">
        <div className="panel-title-row task-title-row">
          <Title level={4}>标注任务</Title>
          <Space className="task-title-actions" wrap>
            <Segmented
              value={viewMode}
              onChange={(value) => setViewMode(value as 'list' | 'grid')}
              options={[
                { label: '列表', value: 'list' },
                { label: '网格', value: 'grid' }
              ]}
            />
            <Button icon={<RefreshCw size={16} />} onClick={() => refresh()}>刷新</Button>
            <Button type="primary" icon={<Plus size={16} />} onClick={openCreateModal}>新增</Button>
          </Space>
        </div>
        <div className="task-toolbar">
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder="搜索任务名 / 任务 ID / 等级"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <DatePicker
            allowClear
            placeholder="创建日期"
            onChange={(_, value) => setCreatedDate(Array.isArray(value) ? value[0] ?? '' : value)}
          />
          <Text type="secondary">共 {filteredJobs.length} / {jobs.length} 个任务</Text>
        </div>
        {viewMode === 'list' ? (
          <Table
            rowKey="id"
            size="small"
            tableLayout="fixed"
            dataSource={filteredJobs}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1340 }}
            columns={[
              {
                title: '任务',
                width: 300,
                fixed: 'left',
                render: (_: unknown, job: AnnotationJob) => (
                  <Tooltip title={<div><div>{job.name}</div><div>ID: {job.id}</div></div>}>
                    <div className="job-name-cell">
                      <Text strong ellipsis>{job.name}</Text>
                      <Text type="secondary" ellipsis>ID: {job.id}</Text>
                    </div>
                  </Tooltip>
                )
              },
              { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={statusColor(value)}>{jobStatusLabel(value)}</Tag> },
              {
                title: '等级',
                width: 90,
                render: (_: unknown, job: AnnotationJob) => (
                  <Tag color={jobLevel(job) === 'behavior' ? 'purple' : 'blue'}>{jobLevelLabel(job)}</Tag>
                )
              },
              { title: '创建时间', dataIndex: 'created_at', width: 160, render: (value: string) => formatDateTime(value) },
              {
                title: '进度',
                width: 150,
                render: (_: unknown, job: AnnotationJob) => <Progress percent={progressOf(job)} size="small" status={job.failed_count ? 'exception' : undefined} />
              },
              {
                title: '数量',
                width: 80,
                render: (_: unknown, job: AnnotationJob) => `${job.completed_count + job.failed_count}/${job.total_count}`
              },
              {
                title: '来源目录',
                width: 160,
                render: (_: unknown, job: AnnotationJob) => {
                  const fullPath = String(job.source?.folder_path ?? '');
                  return (
                    <Tooltip title={fullPath || '-'}>
                      <Text className="path-cell" ellipsis>{compactPath(fullPath)}</Text>
                    </Tooltip>
                  );
                }
              },
              {
                title: '操作',
                width: 300,
                render: (_: unknown, job: AnnotationJob) => renderJobActions(job)
              }
            ]}
          />
        ) : (
          <div className="job-card-grid">
            {filteredJobs.length ? filteredJobs.map((job) => (
              <article className="job-card" key={job.id}>
                <div className="job-card-header">
                  <div className="job-card-title">
                    <Text strong ellipsis>{job.name}</Text>
                    <Text type="secondary" ellipsis>ID: {job.id}</Text>
                  </div>
                  <Tag color={statusColor(job.status)}>{jobStatusLabel(job.status)}</Tag>
                </div>
                <div className="job-card-meta">
                  <span><Text type="secondary">等级</Text><Tag color={jobLevel(job) === 'behavior' ? 'purple' : 'blue'}>{jobLevelLabel(job)}</Tag></span>
                  <span><Text type="secondary">创建</Text><Text>{formatDateTime(job.created_at)}</Text></span>
                  <span><Text type="secondary">数量</Text><Text>{job.completed_count + job.failed_count}/{job.total_count}</Text></span>
                </div>
                <Progress percent={progressOf(job)} size="small" status={job.failed_count ? 'exception' : undefined} />
                <Tooltip title={String(job.source?.folder_path ?? '') || '-'}>
                  <Text className="job-card-path" type="secondary" ellipsis>{compactPath(job.source?.folder_path)}</Text>
                </Tooltip>
                <div className="job-card-actions">{renderJobActions(job)}</div>
              </article>
            )) : <Empty className="task-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配任务" />}
          </div>
        )}
        <Modal
          title="新增标注任务"
          open={isCreateOpen}
          onCancel={() => setIsCreateOpen(false)}
          footer={null}
          destroyOnClose
          width={720}
        >
          {createTaskForm}
        </Modal>
      </section>
    </div>
  );
}

function ReviewTaskPicker({ onReviewJob }: { onReviewJob: (jobId: string) => void }) {
  const { message } = AntApp.useApp();
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [createdDate, setCreatedDate] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  async function refresh() {
    setLoading(true);
    try {
      const response = await api.listAnnotationJobs();
      setJobs(Array.isArray(response.items) ? response.items : []);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredJobs = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return jobs.filter((job) => {
      const searchable = [
        job.name,
        job.id,
        jobLevel(job),
        jobLevelLabel(job),
        jobStatusLabel(job.status)
      ].join(' ').toLowerCase();
      const matchesKeyword = !keyword || searchable.includes(keyword);
      const matchesDate = !createdDate || dateKey(job.created_at) === createdDate;
      return matchesKeyword && matchesDate;
    });
  }, [jobs, searchText, createdDate]);

  function renderEnterButton(job: AnnotationJob) {
    return <Button size="small" type="primary" icon={<Edit3 size={14} />} onClick={() => onReviewJob(job.id)}>进入审核</Button>;
  }

  return (
    <section className="ops-panel full task-board-panel review-task-panel">
      <div className="panel-title-row task-title-row">
        <Title level={4}>选择审核任务</Title>
        <Space className="task-title-actions" wrap>
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value as 'list' | 'grid')}
            options={[
              { label: '列表', value: 'list' },
              { label: '网格', value: 'grid' }
            ]}
          />
          <Button icon={<RefreshCw size={16} />} onClick={() => refresh()} loading={loading}>刷新</Button>
        </Space>
      </div>
      <div className="task-toolbar">
        <Input
          allowClear
          prefix={<Search size={15} />}
          placeholder="搜索任务名 / 任务 ID / 等级"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <DatePicker
          allowClear
          placeholder="创建日期"
          onChange={(_, value) => setCreatedDate(Array.isArray(value) ? value[0] ?? '' : value)}
        />
        <Text type="secondary">共 {filteredJobs.length} / {jobs.length} 个任务</Text>
      </div>
      {viewMode === 'list' ? (
        <Table
          rowKey="id"
          size="small"
          tableLayout="fixed"
          loading={loading}
          dataSource={filteredJobs}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: '任务',
              width: 300,
              fixed: 'left',
              render: (_: unknown, job: AnnotationJob) => (
                <Tooltip title={<div><div>{job.name}</div><div>ID: {job.id}</div></div>}>
                  <div className="job-name-cell">
                    <Text strong ellipsis>{job.name}</Text>
                    <Text type="secondary" ellipsis>ID: {job.id}</Text>
                  </div>
                </Tooltip>
              )
            },
            { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={statusColor(value)}>{jobStatusLabel(value)}</Tag> },
            {
              title: '等级',
              width: 90,
              render: (_: unknown, job: AnnotationJob) => (
                <Tag color={jobLevel(job) === 'behavior' ? 'purple' : 'blue'}>{jobLevelLabel(job)}</Tag>
              )
            },
            { title: '创建时间', dataIndex: 'created_at', width: 160, render: (value: string) => formatDateTime(value) },
            {
              title: '进度',
              width: 150,
              render: (_: unknown, job: AnnotationJob) => <Progress percent={progressOf(job)} size="small" status={job.failed_count ? 'exception' : undefined} />
            },
            {
              title: '数量',
              width: 80,
              render: (_: unknown, job: AnnotationJob) => `${job.completed_count + job.failed_count}/${job.total_count}`
            },
            {
              title: '来源目录',
              width: 180,
              render: (_: unknown, job: AnnotationJob) => {
                const fullPath = String(job.source?.folder_path ?? '');
                return (
                  <Tooltip title={fullPath || '-'}>
                    <Text className="path-cell" ellipsis>{compactPath(fullPath)}</Text>
                  </Tooltip>
                );
              }
            },
            {
              title: '操作',
              width: 120,
              render: (_: unknown, job: AnnotationJob) => renderEnterButton(job)
            }
          ]}
        />
      ) : (
        <div className="job-card-grid">
          {filteredJobs.length ? filteredJobs.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-card-header">
                <div className="job-card-title">
                  <Text strong ellipsis>{job.name}</Text>
                  <Text type="secondary" ellipsis>ID: {job.id}</Text>
                </div>
                <Tag color={statusColor(job.status)}>{jobStatusLabel(job.status)}</Tag>
              </div>
              <div className="job-card-meta">
                <span><Text type="secondary">等级</Text><Tag color={jobLevel(job) === 'behavior' ? 'purple' : 'blue'}>{jobLevelLabel(job)}</Tag></span>
                <span><Text type="secondary">创建</Text><Text>{formatDateTime(job.created_at)}</Text></span>
                <span><Text type="secondary">数量</Text><Text>{job.completed_count + job.failed_count}/{job.total_count}</Text></span>
              </div>
              <Progress percent={progressOf(job)} size="small" status={job.failed_count ? 'exception' : undefined} />
              <Tooltip title={String(job.source?.folder_path ?? '') || '-'}>
                <Text className="job-card-path" type="secondary" ellipsis>{compactPath(job.source?.folder_path)}</Text>
              </Tooltip>
              <div className="job-card-actions">{renderEnterButton(job)}</div>
            </article>
          )) : <Empty className="task-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配任务" />}
        </div>
      )}
    </section>
  );
}

function ReviewView({
  jobId,
  onReviewJob,
  onClearJob
}: {
  jobId?: string;
  onReviewJob: (jobId: string) => void;
  onClearJob: () => void;
}) {
  if (!jobId) return <ReviewTaskPicker onReviewJob={onReviewJob} />;
  return <ReviewWorkspace jobId={jobId} onClearJob={onClearJob} />;
}

function ReviewWorkspace({ jobId, onClearJob }: { jobId: string; onClearJob: () => void }) {
  const { message, modal } = AntApp.useApp();
  const [job, setJob] = useState<AnnotationJob>();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [validation, setValidation] = useState<Validation>({ errors: [], warnings: [] });
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
      const payload = await api.getAnnotationJob(jobId);
      setJob(payload);
      const jobAssets = (payload.items ?? []).map((item) => item.asset).filter(Boolean);
      setAssets(jobAssets);
      const next = jobAssets.find((asset) => asset.id === nextAssetId) ?? jobAssets[0];
      if (next) await loadAsset(next);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshJobOnly() {
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
      void refreshJobOnly();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [jobId]);

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
      message.success('审核已通过');
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
  const selectedItem = selected ? itemsByAsset.get(selected.id) : undefined;
  const selectedFrames = selectedItem?.sample?.frames?.length
    ? selectedItem.sample.frames
    : selected
      ? [{ index: 1, asset_id: selected.id, file_name: selected.file_name, original_path: selected.original_path, stored_path: selected.stored_path, width: selected.width, height: selected.height, sha256: selected.sha256 }]
      : [];
  const orderedSelectedFrames = [...selectedFrames].sort((left, right) => left.index - right.index);
  const isBehaviorSample = selectedItem?.sample?.annotation_level === 'behavior';

  return (
    <div className="workspace-grid">
      <aside className="side-panel">
        {job ? (
          <div className="job-summary">
            <div className="job-summary-title">
              <Tooltip title={<div><div>{job.name}</div><div>ID: {job.id}</div></div>}>
                <span>
                  <Text strong ellipsis>{job.name}</Text>
                  <Text type="secondary" ellipsis>ID: {job.id}</Text>
                </span>
              </Tooltip>
              <Tag color={statusColor(job.status)}>{jobStatusLabel(job.status)}</Tag>
            </div>
            <Space size={6} wrap>
              <Tag color={jobLevel(job) === 'behavior' ? 'purple' : 'blue'}>{jobLevelLabel(job)}</Tag>
              <Text type="secondary">{formatDateTime(job.created_at)}</Text>
            </Space>
            <Progress percent={progressOf(job)} size="small" />
            <Button size="small" onClick={onClearJob}>切换任务</Button>
          </div>
        ) : (
          <div className="job-summary">
            <Text type="secondary">正在加载任务...</Text>
            <Button size="small" onClick={onClearJob}>返回任务选择</Button>
          </div>
        )}
        <Button icon={<RefreshCw size={16} />} onClick={() => refresh(selected?.id)}>刷新</Button>
        <Spin spinning={loading}>
          <List
            className="asset-list"
            dataSource={assets}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(asset) => {
              const item = itemsByAsset.get(asset.id);
              const assetTooltip = (
                <div className="asset-tooltip">
                  <div><strong>{asset.file_name}</strong></div>
                  <div className="asset-tooltip-line">原始路径：{asset.original_path || '-'}</div>
                  <div>尺寸：{asset.width}x{asset.height}</div>
                  <div>批次：{asset.batch || '-'}</div>
                  <div>图片状态：{annotationStatusText(asset.annotation.status)}</div>
                  {item && <div>任务状态：{jobItemStatusLabel(item.status)}</div>}
                </div>
              );
              return (
                <Tooltip title={assetTooltip} placement="right" mouseEnterDelay={0.25}>
                  <button className={`asset-row ${selected?.id === asset.id ? 'selected' : ''}`} onClick={() => loadAsset(asset)}>
                    <span className="thumb"><ImageIcon size={18} /></span>
                    <span className="asset-main">
                      <Text ellipsis title={asset.file_name}>{asset.file_name}</Text>
                      <span className="asset-meta" title={`${asset.width}x${asset.height} · ${asset.batch}`}>{asset.width}x{asset.height} · {asset.batch}</span>
                    </span>
                    <Space direction="vertical" size={2}>
                      <Tag color={statusColor(asset.annotation.status)}>{annotationStatusText(asset.annotation.status)}</Tag>
                      {item && <Tag color={statusColor(item.status)}>{jobItemStatusLabel(item.status)}</Tag>}
                      {item?.sample?.annotation_level === 'behavior' && <Tag color="purple">{item.sample.frame_count ?? item.sample.frames?.length ?? 1} 帧</Tag>}
                    </Space>
                  </button>
                </Tooltip>
              );
            }}
          />
        </Spin>
      </aside>

      <main className="image-panel">
        {selected ? (
          <>
            <div className="image-toolbar">
              <div className="image-title-block">
                <Space wrap size={6}>
                  <Tag color={selected.duplicate_of ? 'orange' : 'blue'}>{selected.id}</Tag>
                  {isBehaviorSample && <Tag color="purple">行为级</Tag>}
                  {isBehaviorSample && <Tag color="purple">{orderedSelectedFrames.length} 帧</Tag>}
                  <Tag color={statusColor(selected.annotation.status)}>{annotationStatusText(selected.annotation.status)}</Tag>
                </Space>
                <Tooltip title={<div className="asset-tooltip"><div><strong>{selected.file_name}</strong></div><div className="asset-tooltip-line">{selected.original_path}</div></div>}>
                  <Text strong ellipsis className="image-title-text">{selected.file_name}</Text>
                </Tooltip>
              </div>
              <Space className="image-toolbar-meta">
                <Statistic value={`${selected.width}x${selected.height}`} title="尺寸" />
              </Space>
            </div>
            <div className={orderedSelectedFrames.length > 1 ? 'image-stage sequence-stage' : 'image-stage'}>
              {orderedSelectedFrames.length > 1 ? (
                <div className="frame-sequence">
                  {orderedSelectedFrames.map((frame) => (
                    <figure className="sequence-frame" key={`${frame.asset_id}-${frame.index}`}>
                      <div className="sequence-frame-media">
                        <Image src={api.assetImageUrl(frame.asset_id)} alt={frame.file_name} preview />
                      </div>
                      <figcaption>
                        <Tag color="blue">frame {frame.index}</Tag>
                        <Tooltip
                          title={(
                            <div className="asset-tooltip">
                              <div><strong>{frame.file_name}</strong></div>
                              <div className="asset-tooltip-line">原始路径：{frame.original_path || '-'}</div>
                              <div>尺寸：{frame.width}x{frame.height}</div>
                            </div>
                          )}
                        >
                          <Text ellipsis className="sequence-frame-name" title={frame.file_name}>{frame.file_name}</Text>
                        </Tooltip>
                        <Text type="secondary">{frame.width}x{frame.height}</Text>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <Image src={api.imageUrl(selected)} alt={selected.file_name} preview />
              )}
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
            <Tooltip title="审核通过"><Button type="primary" icon={<CheckCircle size={16} />} onClick={accept} disabled={!selected} /></Tooltip>
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
  const [navCollapsed, setNavCollapsed] = useState(false);

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
    setReviewJobId(undefined);
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
          <TopWorkspaceNav route={route} onOpenAnnotation={() => openAnnotation('jobs')} />
          <Space className="header-actions">
            {route.view === 'annotation' && (
              <Tooltip title={navCollapsed ? '固定侧边栏' : '隐藏侧边栏'}>
                <Button
                  aria-label={navCollapsed ? '固定侧边栏' : '隐藏侧边栏'}
                  aria-pressed={navCollapsed}
                  icon={navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                  onClick={() => setNavCollapsed((current) => !current)}
                />
              </Tooltip>
            )}
          </Space>
        </Header>
        <Content className="app-content">
          <ErrorBoundary key={`${route.view}-${route.section}-${reviewJobId ?? ''}`}>
            {route.view === 'home' && <HomeView />}
            {route.view === 'annotation' && (
              <AnnotationCenter
                section={route.section}
                onSectionChange={openAnnotation}
                onReviewJob={reviewJob}
                reviewJobId={reviewJobId}
                navCollapsed={navCollapsed}
              />
            )}
          </ErrorBoundary>
        </Content>
      </Layout>
    </AntApp>
  );
}
