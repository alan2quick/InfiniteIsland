import React, { useEffect, useRef, useState } from 'react';

const VIEWS = [
  { id: 'desktop', label: 'Desktop', width: 1280, height: 720 },
  { id: 'portrait', label: 'Mobile portrait', width: 390, height: 844, touch: true },
  { id: 'landscape', label: 'Mobile landscape', width: 844, height: 390, touch: true },
];

function PreviewFrame({ view, settings }) {
  const container = useRef(null), frame = useRef(null), latest = useRef(settings);
  const [scale, setScale] = useState(0.1);
  const [loaded, setLoaded] = useState(false);
  latest.current = settings;
  const send = () => frame.current?.contentWindow?.postMessage({ type: 'island-editor-preview', settings: latest.current }, location.origin);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.max(0.05, Math.min(entry.contentRect.width / view.width, entry.contentRect.height / view.height)));
    });
    observer.observe(container.current);
    const ready = (event) => {
      if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'island-editor-preview-ready') { setLoaded(true); send(); }
    };
    window.addEventListener('message', ready);
    return () => { observer.disconnect(); window.removeEventListener('message', ready); };
  }, [view]);
  useEffect(send, [settings]);
  return <section className={`island-comparison-card island-comparison-${view.id}`} aria-label={`${view.label} live preview`}>
    <header><strong>{view.label}</strong><span>{view.width} × {view.height} · {loaded ? 'Live · muted' : 'Loading…'}</span></header>
    <div className="island-comparison-stage" ref={container}>
      <div style={{ width: view.width * scale, height: view.height * scale }}>
        <iframe ref={frame} title={`${view.label} live game`} src={`/?editorPreview=1${view.touch ? '&touch' : ''}`}
          onLoad={send} style={{ width: view.width, height: view.height, transform: `scale(${scale})` }} />
      </div>
    </div>
  </section>;
}

export function ComparisonPreview({ settings }) {
  return <section className="island-comparison" aria-label="All device previews">
    {VIEWS.map(view => <PreviewFrame key={view.id} view={view} settings={settings} />)}
  </section>;
}
