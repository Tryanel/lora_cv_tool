import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          borderRadius: 6,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        components: {
          Button: { borderRadius: 6 },
          Card: { borderRadiusLG: 8 },
          Input: { borderRadius: 6 }
        }
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
