import { Component } from 'react';
import type { ReactNode } from 'react';
import { Leaf, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const english = document.documentElement.lang.startsWith('en');
    return <main className="loading-screen"><Leaf size={32} /><h1>{english ? 'Let’s reopen your space' : '重新打开家庭空间'}</h1><p>{english ? 'The page needs to reload. This does not delete saved records.' : '页面暂时需要重新加载，这不会删除已保存的记录。'}</p><p>{english ? 'If this keeps happening after an update, finish or pause practice on your other tabs, then close all tabs for this site and reopen it while online. Choices that have not been saved will need to be entered again.' : '如果更新后反复出现这个页面，请先完成或暂停其他页面中的练习，再关闭本站所有标签页，联网重新打开。尚未保存的选择需要重新填写。'}</p><button className="primary" onClick={() => location.reload()}><RotateCcw size={18} />{english ? 'Reload' : '重新加载'}</button></main>;
  }
}
