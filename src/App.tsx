/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Play, AlertCircle, AlertTriangle, CheckCircle, Search, Loader2, History, X, Sparkles, ShieldCheck } from 'lucide-react';
import { Issue, QaReport, HistoryRun } from './types';

// Hook for fake uptime
function useUptime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<QaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [models, setModels] = useState<{name: string, latency: number}[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [forceRefresh, setForceRefresh] = useState<boolean>(false);
  const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);
  const [isPresenting, setIsPresenting] = useState<boolean>(false);

  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [explanations, setExplanations] = useState<Record<string, { explanation: string, fix_suggestion: string, loading: boolean }>>({});
  const [modalExplanation, setModalExplanation] = useState<{ issue: string, data: any } | null>(null);

  const uptime = useUptime();

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistoryRuns(data);
      }
    } catch (err) {
      console.error('Failed to fetch history', err);
    }
  };

  useEffect(() => {
    if (isHistoryOpen) {
      fetchHistory();
    }
  }, [isHistoryOpen]);

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setModels(data.models);
          setSelectedModel(data.default || data.models[0].name);
        }
      })
      .catch(err => console.error("Failed to fetch models:", err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    let validUrl = url;
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl;
    }

    setLoading(true);
    setReport(null);
    setError(null);

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validUrl, model: selectedModel, forceRefresh })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze website');
      }

      setReport(data);
      if (isHistoryOpen) {
        fetchHistory();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoRun = async () => {
    setLoading(true);
    setIsDemoRunning(true);
    setError(null);
    setReport(null);

    try {
      const response = await fetch('/api/demo-run');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze website');
      }

      setUrl(data.url);
      setReport(data);
      if (isHistoryOpen) {
        fetchHistory();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
      setIsDemoRunning(false);
    }
  };

  const handleExplainIssue = async (issue: Issue, indexKey: string) => {
    if (explanations[indexKey] && explanations[indexKey].explanation) {
      setModalExplanation({ issue: issue.description, data: explanations[indexKey] });
      return;
    }
    if (explanations[indexKey] && explanations[indexKey].loading) return;

    setExplanations(prev => ({ ...prev, [indexKey]: { explanation: '', fix_suggestion: '', loading: true } }));

    try {
      const response = await fetch('/api/explain-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue, model: selectedModel })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setExplanations(prev => ({ ...prev, [indexKey]: { ...data, loading: false } }));
      setModalExplanation({ issue: issue.description, data });
    } catch (error: any) {
      console.error(error);
      const errorData = { explanation: 'Error: ' + error.message, fix_suggestion: '', loading: false };
      setExplanations(prev => ({ ...prev, [indexKey]: errorData }));
      setModalExplanation({ issue: issue.description, data: errorData });
    }
  };

  const getSeverityClasses = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high': return 'bg-rose-500/20 text-rose-400 border-rose-500/50';
      case 'medium': return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'low': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
      default: return 'bg-slate-500/20 text-slate-400 border-slate-500/50';
    }
  };

  const allIssues = report 
    ? report.pages.flatMap(p => p.issues.map(i => ({ ...i, pageUrl: p.url })))
    : [];
  
  const criticalCount = allIssues.filter(i => i.severity.toLowerCase() === 'high').length;

  const handleDownload = async () => {
    try {
      const response = await fetch('/api/qa/download');
      if (!response.ok) {
        throw new Error('Failed to download report');
      }
      const blob = await response.blob();
      const tempUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = tempUrl;
      a.download = 'qa-report.json';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(tempUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      alert('Failed to download report.');
    }
  };

  const handleDownloadPdf = async () => {
    if (!report) return;
    try {
      const response = await fetch('/api/qa/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report)
      });
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      const blob = await response.blob();
      const tempUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = tempUrl;
      a.download = 'qa-report.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(tempUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      alert('Failed to download PDF.');
    }
  };

  return (
    <>
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img src={selectedImage} className="max-w-full max-h-full object-contain rounded drop-shadow-2xl" alt="Full screenshot preview" />
          <button className="absolute top-4 right-4 text-white hover:text-emerald-400 font-bold bg-slate-900/50 px-4 py-2 rounded" onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}>
            Close
          </button>
        </div>
      )}
      <div className="w-full h-screen bg-slate-900 text-slate-200 flex overflow-hidden font-sans">
      {/* Left Sidebar: Session Controls & Stats */}
      {!isPresenting && (
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 text-sm">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></div>
            <h1 className="text-xs font-bold uppercase tracking-widest text-slate-400">Autonomous QA</h1>
          </div>
          <div className="text-xl font-semibold text-white">Explorer v1.0</div>
        </div>

        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 mb-3 block">Session Metrics</label>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Uptime</span>
                <span className="font-mono">{uptime}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Pages Completed</span>
                <span className="font-mono text-blue-400">{loading ? '0 / 5' : report ? `${report.pages_tested} / 5` : '0 / 0'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Status</span>
                <span className={`font-mono ${loading ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}`}>
                  {loading ? 'SCANNING' : 'IDLE'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Critical Errors</span>
                <span className="font-mono text-rose-500 font-bold">{criticalCount > 9 ? criticalCount : `0${criticalCount}`}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 mb-3 block">Configuration</label>
            <div className="space-y-3">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <div className="text-[10px] text-slate-500 mb-1">Model</div>
                <select 
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-slate-700 rounded text-xs text-white p-1 outline-none focus:border-emerald-500 disabled:opacity-50"
                >
                  {models.map(m => (
                    <option key={m.name} value={m.name}>
                      {m.name} {m.source ? `(${m.source})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <div className="text-[10px] text-slate-500">Concurrency</div>
                <div className="text-xs">Sequential (Max 5)</div>
              </div>
              <label className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer mt-2 w-full p-2 rounded bg-slate-900 border border-slate-800">
                <input 
                  type="checkbox" 
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  disabled={loading}
                  className="rounded border-slate-700 bg-black text-emerald-500 focus:ring-emerald-500 flex-shrink-0"
                />
                <span>Force fresh scan</span>
              </label>
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2">
          <button 
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded text-xs font-bold transition-colors flex items-center justify-center gap-2"
          >
            <History className="w-4 h-4" />
            {isHistoryOpen ? 'CLOSE HISTORY' : 'VIEW HISTORY'}
          </button>
          <button 
            onClick={() => { setReport(null); setError(null); setUrl(''); }}
            className="w-full bg-rose-600/20 hover:bg-rose-500/30 text-rose-500 py-2 rounded text-xs font-bold transition-colors"
          >
            RESET SESSION
          </button>
        </div>
      </aside>
      )}

      {/* Main Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header: URL Input */}
        <header className="h-16 bg-slate-900/50 border-b border-slate-800 flex items-center px-6 gap-4 shrink-0">
          {!isPresenting ? (
          <form onSubmit={handleSubmit} className="flex-1 flex gap-4 w-full">
            <div className="flex-1 flex items-center bg-black border border-slate-700 rounded-md px-3 py-1.5 focus-within:border-emerald-500 transition-colors">
              <span className="text-slate-500 text-xs mr-2">Target:</span>
              <input 
                type="text" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-transparent text-xs w-full outline-none text-emerald-400 font-mono placeholder-slate-700" 
                placeholder="https://example.com"
                disabled={loading}
                required
              />
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {report && report.cached && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-1 rounded border border-amber-400/20 mr-2 flex items-center gap-1">
                  ⚡ Loaded from cache
                </span>
              )}
              <button type="submit" disabled={loading || !url} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:bg-slate-800 text-white rounded text-xs font-bold transition-colors flex items-center gap-2 tracking-wide">
                {loading && <Loader2 className="w-3 h-3 animate-spin"/>}
                {loading ? 'SCANNING' : (report ? 'RE-RUN ANALYSIS' : 'RUN AUDIT')}
              </button>
              {report && (
                <>
                  <button type="button" onClick={handleDownload} className="px-4 py-1.5 border border-slate-700 hover:bg-slate-800 rounded text-xs font-bold text-slate-300 transition-colors">
                    DOWNLOAD JSON
                  </button>
                  <button type="button" onClick={handleDownloadPdf} className="px-4 py-1.5 border border-slate-700 hover:bg-slate-800 rounded text-xs font-bold text-slate-300 transition-colors">
                    DOWNLOAD PDF
                  </button>
                  <button type="button" onClick={() => setIsPresenting(true)} className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 border border-purple-500/50 rounded text-xs font-bold text-white transition-colors">
                    PRESENTATION MODE
                  </button>
                </>
              )}
              <button type="button" onClick={() => setReport(null)} className="px-4 py-1.5 border border-slate-700 hover:bg-slate-800 rounded text-xs font-bold text-slate-300 transition-colors">
                CLEAR LOGS
              </button>
              <button type="button" onClick={handleDemoRun} disabled={loading} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:bg-slate-800 text-white rounded text-xs font-bold transition-colors flex items-center gap-2 tracking-wide">
                RUN DEMO
              </button>
            </div>
          </form>
          ) : (
            <div className="flex-1 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white tracking-wide">Quality Assurance Report Presentation</h2>
              <button type="button" onClick={() => setIsPresenting(false)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors flex items-center gap-2 tracking-wide">
                EXIT PRESENTATION MODE
              </button>
            </div>
          )}
        </header>

        {/* Content Grid: Screenshots & Findings */}
        <div className="flex-1 p-6 overflow-y-auto bg-slate-900">
          {!report && !loading && !error && (
             <div className="h-full border-2 border-dashed border-slate-800 rounded-xl flex items-center justify-center text-slate-500 text-sm font-mono flex-col gap-2">
               <Search className="w-8 h-8 text-slate-700 mb-2" />
               <div>Enter a target URL to begin autonomous crawl.</div>
               <div className="text-[10px] text-slate-600">Playwright will navigate up to 5 pages and send screenshots to Gemini.</div>
             </div>
          )}

          {loading && (
            <div className="h-full border border-slate-800 rounded-xl flex items-center justify-center bg-slate-950 flex-col gap-4">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <div className="text-sm font-mono text-slate-400 animate-pulse">
                {isDemoRunning ? 'Running demo on sample application...' : 'Running multi-page UI analysis...'}
              </div>
            </div>
          )}

          {error && (
            <div className="p-6 border border-rose-500/50 bg-rose-500/10 rounded-xl text-rose-400 font-mono text-sm max-w-2xl mx-auto mt-10">
              <div className="font-bold flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4" /> [CRITICAL ENGINE FAILURE]</div>
              <div>{error}</div>
            </div>
          )}

          {report && !isPresenting && (
            <div className="mb-6">
              {report.executive_summary && (
                <div className="bg-slate-800/80 border border-indigo-500/50 rounded-xl p-5 shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-sm font-bold tracking-widest uppercase text-indigo-400">AI Executive Summary</h3>
                  </div>
                  <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {typeof report.executive_summary === 'string' ? report.executive_summary : JSON.stringify(report.executive_summary, null, 2)}
                  </p>
                </div>
              )}
            </div>
          )}

          {report && !isPresenting && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allIssues.length === 0 ? (
                <div className="col-span-full border border-emerald-500/50 bg-emerald-500/10 p-6 rounded-lg text-emerald-400 font-mono text-sm">
                  <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4"/> <span>No critical UI issues detected across {report.pages_tested} pages.</span></div>
                </div>
              ) : (
                allIssues.map((issue, idx) => (
                  <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800 shrink-0">
                      <span className="text-[10px] font-mono text-slate-400 truncate pr-2 max-w-[200px]" title={issue.pageUrl}>
                        {(() => {
                           try {
                             return new URL(issue.pageUrl).pathname || '/';
                           } catch {
                             return issue.pageUrl;
                           }
                        })()}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${getSeverityClasses(issue.severity)}`}>
                        {issue.severity.toUpperCase()}
                      </span>
                    </div>
                    <div className="px-4 pt-3 pb-1 border-b border-slate-800/50">
                       <h4 className="text-sm font-bold text-slate-200 truncate" title={issue.title}>{issue.title}</h4>
                    </div>
                    <div className="flex-1 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300 font-sans">
                       {issue.description}
                    </div>
                    <div className="p-3 bg-slate-900 border-t border-slate-800 text-xs shrink-0 flex flex-col gap-3">
                      <div>
                        <div className="font-bold text-emerald-400 mb-1 text-[10px] uppercase tracking-wider">Suggested Fix</div>
                        <div className="text-slate-400">{issue.suggestion}</div>
                      </div>
                      
                      <button 
                        onClick={() => handleExplainIssue(issue, `issue-norm-${idx}`)}
                        disabled={explanations[`issue-norm-${idx}`]?.loading}
                        className="self-start text-[10px] font-bold px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded border border-blue-500/30 transition-colors flex items-center gap-2"
                      >
                        {explanations[`issue-norm-${idx}`]?.loading ? <><Loader2 className="w-3 h-3 animate-spin"/> EXPLAINING...</> : 'AI EXPLAIN ISSUE'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {report && report.pages.length > 0 && !isPresenting && (
            <div className="mt-8">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Captured Pages</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {report.pages.map((p, idx) => (
                  <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg flex flex-col overflow-hidden">
                    <div 
                      className="h-32 bg-slate-900 overflow-hidden cursor-pointer flex items-center justify-center relative group"
                      onClick={() => p.screenshot && setSelectedImage(p.screenshot)}
                    >
                      {p.screenshot ? (
                        <>
                          <img src={p.screenshot} alt={`Screenshot`} className="w-full h-full object-cover object-top opacity-80 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs font-bold">
                            <Search className="w-5 h-5 mb-1 text-emerald-400" />
                            VIEW FULL
                          </div>
                        </>
                      ) : (
                        <div className="text-slate-600 text-xs font-mono">No Preview</div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-slate-700 bg-slate-800 shrink-0">
                      <div className="text-[10px] font-mono text-slate-400 truncate" title={p.url}>
                        {(() => {
                            try {
                              return new URL(p.url).pathname || '/';
                            } catch {
                              return p.url;
                            }
                        })()}
                      </div>
                      <div className="text-[10px] mt-1 text-emerald-500 font-bold">
                        {p.issues?.length || 0} {(p.issues?.length || 0) === 1 ? 'issue' : 'issues'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report && isPresenting && (
            <div className="max-w-6xl mx-auto space-y-16 pb-16 pt-8 animate-in fade-in duration-700">
              <div className="text-center">
                <h1 className="text-4xl font-bold text-slate-100 mb-10">{(() => { try { return new URL(url).hostname } catch { return url || 'Audit Report' } })()}</h1>
                
                {report.executive_summary && (
                  <div className="max-w-4xl mx-auto mb-10 bg-slate-800/80 border border-indigo-500/50 rounded-2xl p-8 shadow-xl text-left">
                    <div className="flex items-center gap-3 mb-4 justify-center">
                      <Sparkles className="w-6 h-6 text-indigo-400" />
                      <h3 className="text-lg font-bold tracking-widest uppercase text-indigo-400">AI Executive Summary</h3>
                    </div>
                    <p className="text-slate-300 text-lg leading-relaxed whitespace-pre-wrap text-center">
                      {typeof report.executive_summary === 'string' ? report.executive_summary : JSON.stringify(report.executive_summary, null, 2)}
                    </p>
                  </div>
                )}

                <div className={`inline-flex items-center justify-center w-56 h-56 rounded-full border-[12px] text-8xl font-black mb-10 shadow-2xl ${report.score >= 90 ? 'border-emerald-500 text-emerald-400 shadow-emerald-900/40' : report.score >= 70 ? 'border-amber-500 text-amber-500 shadow-amber-900/40' : 'border-rose-500 text-rose-500 shadow-rose-900/40'}`}>
                  {report.score}
                </div>
                <p className="text-2xl text-slate-300 max-w-4xl mx-auto leading-relaxed">
                  {typeof report.summary === 'string' ? report.summary : JSON.stringify(report.summary, null, 2)}
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {['ui', 'functional', 'layout', 'accessibility'].map((cat) => (
                  <div key={cat} className="bg-slate-800 rounded-2xl p-6 text-center border border-slate-700 shadow-xl">
                    <div className="text-slate-400 font-bold uppercase tracking-widest text-sm mb-2">{cat}</div>
                    <div className="text-5xl font-light text-slate-200">{(report.issue_summary as any)[cat]}</div>
                  </div>
                ))}
              </div>

              {allIssues.length > 0 && (
                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-3">Key Issues</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {allIssues.slice(0, 6).map((issue, idx) => (
                      <div key={idx} className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 flex flex-col shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold border tracking-wider ${getSeverityClasses(issue.severity)}`}>
                            {issue.severity.toUpperCase()}
                          </span>
                        </div>
                        <h4 className="text-xl font-bold text-slate-100 mb-3">{issue.title}</h4>
                        <p className="text-slate-300 text-base leading-relaxed mb-4 flex-1">
                          {typeof issue.description === 'string' ? issue.description : JSON.stringify(issue.description, null, 2)}
                        </p>
                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 flex flex-col gap-3">
                           <div>
                             <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2">Recommendation</div>
                             <div className="text-slate-300 text-sm">{issue.suggestion}</div>
                           </div>
                           
                           <button 
                             onClick={() => handleExplainIssue(issue, `issue-pres-${idx}`)}
                             disabled={explanations[`issue-pres-${idx}`]?.loading}
                             className="self-start text-[10px] font-bold px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded border border-blue-500/30 transition-colors flex items-center gap-2 mt-2"
                           >
                             {explanations[`issue-pres-${idx}`]?.loading ? <><Loader2 className="w-3 h-3 animate-spin"/> EXPLAINING...</> : 'AI EXPLAIN ISSUE'}
                           </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.pages.length > 0 && (
                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-3">Captured Pages</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {report.pages.map((p, idx) => (
                      <div key={idx} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-xl border-t-4 border-t-slate-600">
                        {p.screenshot && (
                          <div 
                            className="h-64 cursor-pointer relative group bg-black"
                            onClick={() => setSelectedImage(p.screenshot!)}
                          >
                            <img src={p.screenshot} className="w-full h-full object-cover object-top opacity-70 group-hover:opacity-100 transition-all duration-300" alt="Preview"/>
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Search className="w-8 h-8 text-emerald-400" />
                            </div>
                          </div>
                        )}
                        <div className="px-4 py-3 bg-slate-800">
                          <div className="text-xs font-mono text-slate-400 truncate" title={p.url}>
                            {(() => {
                                try {
                                  return new URL(p.url).pathname || '/';
                                } catch {
                                  return p.url;
                                }
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom: Live Console & JSON Output */}
        {!isPresenting && (
        <footer className="h-48 border-t border-slate-800 bg-black flex font-mono text-[11px] leading-relaxed shrink-0 flex-col sm:flex-row">
          <div className="flex-1 p-3 text-slate-400 sm:border-r border-slate-800 overflow-y-auto">
            {!report && !loading && (
              <>
                <div className="text-blue-500 mb-1">[SYSTEM] Playwright rendering engine initialized</div>
                <div className="text-slate-500">[WORKER] Awaiting target designation...</div>
              </>
            )}
            
            {loading && (
              <div className="animate-in fade-in duration-500 pointer-events-none">
                <div className="text-amber-400 mt-2">[NAV] Initiating multi-page crawl of {url}...</div>
                <div className="text-slate-500 delay-100">[DOM] Discovering links and analyzing structure...</div>
                <div className="text-emerald-400 delay-300">[CAPTURE] Batching DOM renders to full-page buffers...</div>
                <div className="text-purple-400 delay-500">[GEMINI] Analyzing screenshots for visual anomalies...</div>
              </div>
            )}
            
            {error && <div className="text-rose-500 mt-2">[ERROR] {error}</div>}
            
            {report && report.logs && report.logs.length > 0 && (
               <div className="mt-2 space-y-1">
                 {report.logs.map((log, idx) => (
                   <div key={idx} className="text-slate-400 font-mono">[{new Date().toLocaleTimeString()}] {log}</div>
                 ))}
                 <div className="text-emerald-400">[SUCCESS] AI Vision processing complete for {report.pages_tested} pages.</div>
                 <div className="text-blue-400">[ANALYSIS] Identified {report.total_issues} violations total.</div>
               </div>
            )}
          </div>
          <div className="w-full sm:w-80 p-3 text-emerald-500 bg-emerald-950/10 overflow-hidden flex flex-col border-t sm:border-t-0 border-slate-800 h-24 sm:h-auto">
            <div className="text-slate-500 mb-2 font-sans font-bold uppercase text-[9px] tracking-widest bg-transparent pb-1">JSON Stream</div>
            <pre className="flex-1 text-[10px] opacity-80 overflow-y-auto">
{report ? JSON.stringify(report, null, 2) : 
  error ? JSON.stringify({ error: "EXECUTION_HALTED", message: error }, null, 2) : 
  loading ? JSON.stringify({ status: "PROCESSING", target: url, max_pages: 5 }, null, 2) : 
  '{\n  "status": "AWAITING_INPUT"\n}'}
            </pre>
          </div>
        </footer>
        )}
      </main>

      {/* History Sidebar */}
      {isHistoryOpen && !isPresenting && (
        <aside className="w-80 bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 z-10">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Session History</h2>
            <button onClick={() => setIsHistoryOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4"/></button>
          </div>

          {compareIds.length === 2 && (
            <div className="p-4 border-b border-slate-800 bg-slate-900 border-l-2 border-l-blue-500">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Comparison</h3>
                <button onClick={() => setCompareIds([])} className="text-[10px] text-slate-400 hover:text-white bg-slate-800 px-2 py-0.5 rounded transition-colors">Clear</button>
              </div>
              <div className="space-y-2 text-xs">
                {(() => {
                  const r1 = historyRuns.find(r => r.id === compareIds[0]);
                  const r2 = historyRuns.find(r => r.id === compareIds[1]);
                  if (!r1 || !r2) return null;
                  
                  return (
                    <>
                      <div className="flex justify-between pb-1 border-b border-slate-800">
                        <span className="text-slate-500 w-[60px] shrink-0 text-[10px] uppercase">Score</span>
                        <span className="font-mono text-center w-1/2">{r1.report.score}</span>
                        <span className="font-mono text-center w-1/2 border-l border-slate-800">{r2.report.score}</span>
                      </div>
                      <div className="flex justify-between pb-1 border-b border-slate-800 mt-1">
                        <span className="text-slate-500 w-[60px] shrink-0 text-[10px] uppercase">Issues</span>
                        <span className="font-mono text-center w-1/2 text-rose-400">{r1.report.total_issues}</span>
                        <span className="font-mono text-center w-1/2 border-l border-slate-800 text-rose-400">{r2.report.total_issues}</span>
                      </div>
                      <div className="flex mt-2">
                        <span className="text-[9px] leading-tight w-1/2 pr-2 text-slate-400 line-clamp-3" title={r1.report.summary}>{r1.report.summary}</span>
                        <span className="text-[9px] leading-tight w-1/2 pl-2 border-l border-slate-800 text-slate-400 line-clamp-3" title={r2.report.summary}>{r2.report.summary}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {historyRuns.length === 0 && !loading ? (
              <div className="text-xs text-slate-500 text-center mt-4 font-mono">No history available.</div>
            ) : (
              historyRuns.map(run => {
                const isSelected = compareIds.includes(run.id);
                const canSelect = isSelected || compareIds.length < 2;
                const d = new Date(run.timestamp);
                const dateStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
                return (
                  <div key={run.id} className={`p-3 rounded border flex gap-3 transition-colors ${isSelected ? 'border-blue-500 bg-blue-950/20' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      disabled={!canSelect}
                      onChange={() => {
                        if (isSelected) setCompareIds(compareIds.filter(c => c !== run.id));
                        else if (canSelect) setCompareIds([...compareIds, run.id]);
                      }}
                      className="mt-1 flex-shrink-0 cursor-pointer accent-blue-500"
                    />
                    <div className="overflow-hidden flex-1 cursor-pointer" onClick={() => { setReport(run.report); setUrl(run.url); }}>
                      <div className="text-xs font-bold text-slate-300 truncate" title={run.url}>
                        {(() => {
                           try {
                             return new URL(run.url).pathname !== '/' ? new URL(run.url).pathname : run.url;
                           } catch {
                             return run.url;
                           }
                        })()}
                      </div>
                      <div className="text-[10px] text-slate-500 flex justify-between mt-1.5 items-center">
                        <span className="font-mono">{dateStr}</span>
                        <span className="font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-400">Score: {run.report.score}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {modalExplanation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <h3 className="text-blue-400 font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" /> AI Explanation
              </h3>
              <button 
                onClick={() => setModalExplanation(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="mb-6">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2">Original Issue</div>
                <div className="text-slate-300 bg-slate-950 p-4 rounded border border-slate-800 text-sm">
                  {typeof modalExplanation.issue === 'string'
                    ? modalExplanation.issue
                    : JSON.stringify(modalExplanation.issue, null, 2)}
                </div>
              </div>

              <div className="mb-6">
                <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Detailed Explanation</div>
                <div className="text-slate-200 text-sm leading-relaxed p-4 bg-blue-950/20 border border-blue-900/30 rounded">
                  {typeof modalExplanation.data?.explanation === 'string' 
                    ? modalExplanation.data?.explanation 
                    : JSON.stringify(modalExplanation.data?.explanation, null, 2)}
                </div>
              </div>

              {modalExplanation.data?.fix_suggestion && (
                <div>
                  <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-2">Suggested Implementation</div>
                  {(() => {
                    let fixData = modalExplanation.data.fix_suggestion;
                    if (typeof fixData === 'string') {
                      try {
                        fixData = JSON.parse(fixData);
                      } catch (e) {
                        // Not JSON, keep as string
                      }
                    }

                    if (typeof fixData === 'object' && fixData !== null && fixData.description) {
                      return (
                        <div className="space-y-4">
                          <div className="text-slate-300 text-sm leading-relaxed p-4 bg-slate-950 border border-slate-800 rounded">
                            {fixData.description}
                          </div>
                          {fixData.code_example && (
                            <div className="space-y-3">
                              {fixData.code_example.html && (
                                <div className="overflow-hidden rounded border border-slate-800 bg-black">
                                  <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 text-[10px] font-mono text-slate-400">HTML</div>
                                  <pre className="text-slate-300 text-[11px] font-mono leading-relaxed p-4 overflow-x-auto">
                                    {fixData.code_example.html}
                                  </pre>
                                </div>
                              )}
                              {fixData.code_example.css && (
                                <div className="overflow-hidden rounded border border-slate-800 bg-black">
                                  <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 text-[10px] font-mono text-slate-400">CSS</div>
                                  <pre className="text-slate-300 text-[11px] font-mono leading-relaxed p-4 overflow-x-auto">
                                    {fixData.code_example.css}
                                  </pre>
                                </div>
                              )}
                              {fixData.code_example.js && (
                                <div className="overflow-hidden rounded border border-slate-800 bg-black">
                                  <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 text-[10px] font-mono text-slate-400">JavaScript</div>
                                  <pre className="text-slate-300 text-[11px] font-mono leading-relaxed p-4 overflow-x-auto">
                                    {fixData.code_example.js}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <pre className="text-slate-300 text-[11px] font-mono leading-relaxed p-4 bg-black border border-slate-800 rounded overflow-x-auto">
                        {typeof fixData === 'string' ? fixData : JSON.stringify(fixData, null, 2)}
                      </pre>
                    );
                  })()}
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button 
                onClick={() => setModalExplanation(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
