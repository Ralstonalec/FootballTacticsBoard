import { useEffect, useState } from 'react';
import { runDiagnostics, type DiagCheck, type ServerInfo } from '../engine/ai';

export function AISettings(props: {
  open: boolean; onClose: () => void;
  serverInfo: ServerInfo; apiKey: string; textModel: string; decisionModel: string;
  onApiKey: (k: string) => void; onTextModel: (m: string) => void; onDecisionModel: (m: string) => void;
}) {
  const [diag, setDiag] = useState<DiagCheck[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  const server = props.serverInfo.configured;

  const test = async () => {
    setBusy(true); setDiag(null); setErr('');
    try { setDiag(await runDiagnostics()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="AI settings">
        <header>
          <h3>🤖 AI settings</h3>
          <button onClick={props.onClose} aria-label="Close">✕</button>
        </header>

        <div className={`status-box ${server ? 'ok' : 'bad'}`}>
          {server
            ? <>✅ <b>Server-side AI is configured</b><br /><span className="muted">Text model <code>{props.serverInfo.textModel}</code><br />Decision model <code>{props.serverInfo.decisionModel}</code></span></>
            : <>❌ <b>The server has no working AI configuration</b><br /><span className="muted">Either <code>OPENROUTER_API_KEY</code> is not set for this deployment (or it wasn't redeployed after adding it), or there is no <code>/api</code> route here. Press the test below to see exactly which.</span></>}
        </div>

        <button className="primary wide" onClick={test} disabled={busy}>{busy ? 'Testing…' : '🔌 Test AI connection'}</button>
        {err && <p className="error">{err}</p>}
        {diag && (
          <ul className="diag">
            {diag.map((c, i) => <li key={i} className={c.ok ? 'ok' : 'bad'}><b>{c.ok ? '✅' : '❌'} {c.name}</b><span>{c.detail}</span></li>)}
          </ul>
        )}

        {!server && (
          <details className="dev">
            <summary>Local development only: use a key from this browser</summary>
            <p className="muted">For <code>npm run dev</code> where there is no server. The key stays in this browser and is sent straight to OpenRouter. Don't use this on a shared computer.</p>
            <label className="field">OpenRouter key
              <input className="text" type="password" value={props.apiKey} placeholder="sk-or-…" onChange={(e) => props.onApiKey(e.target.value)} />
            </label>
            <label className="field">Text model (coach, feedback, explain)
              <input className="text" value={props.textModel} onChange={(e) => props.onTextModel(e.target.value)} />
            </label>
            <label className="field">Decision model (in-match player decisions)
              <input className="text" value={props.decisionModel} onChange={(e) => props.onDecisionModel(e.target.value)} />
            </label>
          </details>
        )}
      </div>
    </div>
  );
}
