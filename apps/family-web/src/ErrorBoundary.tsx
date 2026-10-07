import { Component } from 'react';
import type { ReactNode } from 'react';
import { Leaf, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const english = document.documentElement.lang.startsWith('en');
    const reloadOnline = () => {
      // The active worker may still serve an older index whose lazy module was
      // removed by a later deployment. A query bypasses its public-shell cache.
      const url = new URL(location.href);
      url.searchParams.set('focus-refresh', String(Date.now()));
      location.assign(url.href);
    };
    return <main className="loading-screen"><Leaf size={32} /><h1>{english ? 'Let’s reopen your space' : '重新打开家庭空间'}</h1><p>{english ? 'Reconnect to load the current page. Saved records will remain.' : '请联网读取当前页面，已保存的记录会保留。'}</p><p>{english ? 'If this keeps happening after an update, finish or pause practice on your other tabs, then close all tabs for this site and reopen it while online. Choices that have not been saved will need to be entered again.' : '如果更新后反复出现这个页面，请先完成或暂停其他页面中的练习，再关闭本站所有标签页，联网重新打开。尚未保存的选择需要重新填写。'}</p><button className="primary" onClick={reloadOnline}><RotateCcw size={18} />{english ? 'Reload online' : '联网重新打开'}</button></main>;
  }
}
