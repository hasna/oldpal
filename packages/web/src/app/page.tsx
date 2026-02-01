import { ChatContainer } from '@/components/chat/ChatContainer';
import { Header } from '@/components/shared/Header';
import { Sidebar } from '@/components/shared/Sidebar';
import { CommandPalette } from '@/components/shared/CommandPalette';

export default function HomePage() {
  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1">
          <ChatContainer />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
