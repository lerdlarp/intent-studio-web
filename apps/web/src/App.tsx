import { useEffect } from 'react';
import { studio, useStudio } from './state/instance';
import { Header } from './features/shell/Header';
import { Banners } from './features/shell/Banners';
import { Home } from './features/shell/Home';
import { ProjectScreen } from './features/shell/ProjectScreen';
import { RoomScreen } from './features/room/RoomScreen';

const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const screen = useStudio((s) => s.screen);

  useEffect(() => {
    void studio.getState().loadProjects();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTextField(e.target)) return; // text fields keep their own undo
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) studio.getState().undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') studio.getState().redo();
      else return;
      e.preventDefault();
    };
    const onLeave = () => void studio.getState().flush();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onLeave);
    };
  }, []);

  return (
    <div className="app">
      <Header />
      <Banners />
      <main className="app-main" id="main">
        {screen === 'home' && <Home />}
        {screen === 'project' && <ProjectScreen />}
        {screen === 'room' && <RoomScreen />}
      </main>
    </div>
  );
}
