import { createContext, useContext, useEffect, useRef, useState } from 'react';

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const STEP = 10;

const btnCls = 'inline-flex items-center justify-center h-8 w-8 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed';

const ZoomContext = createContext(100);

// Wrap just the <table> markup (not the search/filter toolbar or pagination) in this —
// it's the only part that scales when the zoom controls are used.
export function ZoomArea({ children }) {
  const zoom = useContext(ZoomContext);
  return <div style={{ zoom: `${zoom}%` }}>{children}</div>;
}

export default function TableFrame({ children }) {
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function zoomOut() {
    setZoom((z) => Math.max(MIN_ZOOM, z - STEP));
  }
  function zoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, z + STEP));
  }
  function resetZoom() {
    setZoom(100);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
  }

  return (
    <div
      ref={containerRef}
      className={isFullscreen ? 'bg-white dark:bg-gray-800 p-6 overflow-auto h-full w-full' : ''}
    >
      <div className="flex justify-end items-center gap-1 mb-2">
        <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} title="Zoom out" className={btnCls}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 12H6" />
          </svg>
        </button>
        <button type="button" onClick={resetZoom} title="Reset zoom" className={`${btnCls} w-14 text-xs`}>
          {zoom}%
        </button>
        <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in" className={btnCls}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v12M6 12h12" />
          </svg>
        </button>
        <button type="button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'} className={btnCls}>
          {isFullscreen ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 4v4H5M15 4v4h4M15 20v-4h4M9 20v-4H5" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
            </svg>
          )}
        </button>
      </div>
      <ZoomContext.Provider value={zoom}>{children}</ZoomContext.Provider>
    </div>
  );
}
