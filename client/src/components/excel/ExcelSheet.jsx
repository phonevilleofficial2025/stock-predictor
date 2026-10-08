import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mountExcelApp } from './engine.js';

// React wrapper around the vanilla-JS spreadsheet engine. Mounts the engine once, then
// pushes every later `workbook` change through `update()` instead of tearing down and
// recreating it — a fresh `mountExcelApp` would otherwise silently reset zoom, full
// screen, every window's scroll position, and the current cell selection on every
// single edit or page/filter change, even though the data itself barely moved.
const ExcelSheet = forwardRef(function ExcelSheet({ workbook, onCommit, className = '' }, ref) {
  const containerRef = useRef(null);
  const appRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !workbook) return;
    if (!appRef.current) appRef.current = mountExcelApp(containerRef.current, workbook, { onCommit });
    else appRef.current.update(workbook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook]);

  useEffect(() => () => { appRef.current?.destroy(); appRef.current = null; }, []);

  useImperativeHandle(ref, () => ({
    setCellStatus: (sheetName, r, c, status) => appRef.current?.setCellStatus(sheetName, r, c, status),
  }), []);

  return <div ref={containerRef} className={className} />;
});

export default ExcelSheet;
