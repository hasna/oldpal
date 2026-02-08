import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ChannelsManager, ChannelListItem, ChannelMessage, ChannelMember, Channel } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface ChannelsPanelProps {
  manager: ChannelsManager;
  onClose: () => void;
  /** Active person ID for message attribution (if logged in) */
  activePersonId?: string;
  /** Active person name for message attribution */
  activePersonName?: string;
  /** Called when a person sends a message - triggers assistant to respond */
  onPersonMessage?: (channelName: string, personName: string, message: string) => void;
}

type Mode =
  | 'list'
  | 'detail'
  | 'chat'
  | 'members'
  | 'create-name'
  | 'create-desc'
  | 'create-confirm'
  | 'invite'
  | 'delete-confirm';

function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'never';
  const diff = Date.now() - new Date(isoDate).getTime();
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function ChannelsPanel({ manager, onClose, activePersonId, activePersonName, onPersonMessage }: ChannelsPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Create wizard state
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');

  // Chat state
  const [chatInput, setChatInput] = useState('');

  // Invite state
  const [inviteName, setInviteName] = useState('');

  const loadChannels = () => {
    try {
      const list = manager.listChannels();
      setChannels(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  const openChannel = (nameOrId: string) => {
    const ch = manager.getChannel(nameOrId);
    if (ch) {
      setSelectedChannel(ch);
      const result = manager.readMessages(ch.id, 50);
      setMessages(result?.messages || []);
      setMode('chat');
    }
  };

  const openMembers = (nameOrId: string) => {
    const ch = manager.getChannel(nameOrId);
    if (ch) {
      setSelectedChannel(ch);
      setMembers(manager.getMembers(ch.id));
      setMode('members');
    }
  };

  // Disable main keyboard handler during text-entry modes so TextInput receives keystrokes
  const isTextEntry = mode === 'create-name' || mode === 'create-desc' || mode === 'invite' || mode === 'chat';

  // Escape handler — always active so user can always go back
  useInput((_input, key) => {
    if (key.escape) {
      if (mode === 'list') {
        onClose();
      } else {
        setMode('list');
        setSelectedChannel(null);
        setStatusMessage(null);
      }
    }
  });

  // Main keyboard handler — disabled during text entry
  useInput((input, key) => {
    if (key.escape) return; // handled above

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((prev) => Math.min(channels.length - 1, prev + 1));
      } else if (key.return) {
        if (channels.length > 0) {
          openChannel(channels[selectedIndex].id);
        }
      } else if (input === 'c') {
        setCreateName('');
        setCreateDesc('');
        setMode('create-name');
      } else if (input === 'm' && channels.length > 0) {
        openMembers(channels[selectedIndex].id);
      } else if (input === 'i' && channels.length > 0) {
        const ch = channels[selectedIndex];
        setSelectedChannel(manager.getChannel(ch.id));
        setInviteName('');
        setMode('invite');
      } else if (input === 'l' && channels.length > 0) {
        const ch = channels[selectedIndex];
        const result = manager.leave(ch.name);
        setStatusMessage(result.message);
        loadChannels();
      } else if (input === 'd' && channels.length > 0) {
        const ch = channels[selectedIndex];
        setSelectedChannel(manager.getChannel(ch.id));
        setMode('delete-confirm');
      } else if (input === 'q') {
        onClose();
      } else if (input === 'r') {
        loadChannels();
        setStatusMessage('Refreshed');
      }
    } else if (mode === 'delete-confirm') {
      if (input === 'y' && selectedChannel) {
        const result = manager.archiveChannel(selectedChannel.id);
        setStatusMessage(result.message);
        setMode('list');
        setSelectedChannel(null);
        loadChannels();
      } else if (input === 'n') {
        setMode('list');
      }
    } else if (mode === 'create-confirm') {
      if (input === 'y') {
        const result = manager.createChannel(createName, createDesc || undefined);
        if (result.success) {
          setStatusMessage(`Created #${createName}`);
          loadChannels();
          if (result.channelId) {
            openChannel(result.channelId);
          } else {
            setMode('list');
          }
        } else {
          setStatusMessage(`Error: ${result.message}`);
          setMode('list');
        }
      } else if (input === 'n') {
        setMode('list');
      }
    }
  }, { isActive: !isTextEntry });

  // Header
  const header = (
    <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
      <Text bold color="blue">Channels</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'list' ? 'q:close c:create enter:open m:members i:invite l:leave d:delete r:refresh' :
         mode === 'chat' ? 'esc:back (type to chat)' :
         mode === 'members' ? 'esc:back' :
         mode === 'delete-confirm' ? 'y:confirm n:cancel' :
         mode === 'create-confirm' ? 'y:confirm n:cancel' :
         'Enter to continue'}
      </Text>
    </Box>
  );

  // Status message
  const statusBar = statusMessage ? (
    <Box marginBottom={1}>
      <Text color="yellow">{statusMessage}</Text>
    </Box>
  ) : null;

  // Error bar
  const errorBar = error ? (
    <Box marginBottom={1}>
      <Text color="red">Error: {error}</Text>
    </Box>
  ) : null;

  // List view
  if (mode === 'list') {
    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        {errorBar}
        {channels.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No channels. Press 'c' to create one.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {channels.map((ch, i) => (
              <Box key={ch.id}>
                <Text color={i === selectedIndex ? 'blue' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text bold={i === selectedIndex} color={i === selectedIndex ? 'blue' : undefined}>
                  #{ch.name}
                </Text>
                {ch.unreadCount > 0 && (
                  <Text color="red"> ({ch.unreadCount})</Text>
                )}
                <Text color="gray">
                  {' '}| {ch.memberCount} members | {ch.lastMessagePreview ? `"${ch.lastMessagePreview}"` : 'no messages'}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Chat view
  if (mode === 'chat' && selectedChannel) {
    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        <Box paddingX={1} marginBottom={1}>
          <Text bold color="blue">#{selectedChannel.name}</Text>
          {selectedChannel.description && (
            <Text color="gray"> — {selectedChannel.description}</Text>
          )}
        </Box>

        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          {messages.length === 0 ? (
            <Text color="gray">No messages yet. Be the first to say something!</Text>
          ) : (
            messages.slice(-20).map((msg) => (
              <Box key={msg.id} marginBottom={0}>
                <Text color="cyan" bold>{msg.senderName}</Text>
                <Text color="gray"> ({formatRelativeTime(msg.createdAt)}): </Text>
                <Text>{msg.content}</Text>
              </Box>
            ))
          )}
        </Box>

        <Box paddingX={1} borderStyle="single" borderColor="gray">
          <Text color="gray">{'> '}</Text>
          <TextInput
            value={chatInput}
            onChange={setChatInput}
            onSubmit={() => {
              if (chatInput.trim()) {
                const msg = chatInput.trim();
                // Send as person if logged in, otherwise as assistant
                const result = activePersonId && activePersonName
                  ? manager.sendAs(selectedChannel.id, msg, activePersonId, activePersonName)
                  : manager.send(selectedChannel.id, msg);
                if (result.success) {
                  setChatInput('');
                  // Reload messages
                  const updated = manager.readMessages(selectedChannel.id, 50);
                  setMessages(updated?.messages || []);
                  // Trigger assistant to respond when a person sends a message
                  if (activePersonId && activePersonName && onPersonMessage && selectedChannel) {
                    onPersonMessage(selectedChannel.name, activePersonName, msg);
                  }
                } else {
                  setStatusMessage(`Error: ${result.message}`);
                }
              }
            }}
            placeholder="Type a message..."
          />
        </Box>
      </Box>
    );
  }

  // Members view
  if (mode === 'members' && selectedChannel) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} marginBottom={1}>
          <Text bold>#{selectedChannel.name} — Members ({members.length})</Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {members.map((m) => (
            <Box key={`${m.channelId}-${m.assistantId}`}>
              <Text>  </Text>
              <Text bold>{m.assistantName}</Text>
              {m.role === 'owner' && <Text color="yellow"> (owner)</Text>}
              {m.memberType === 'person' && <Text color="green"> [person]</Text>}
              <Text color="gray"> — joined {new Date(m.joinedAt).toLocaleDateString()}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  // Delete confirm
  if (mode === 'delete-confirm' && selectedChannel) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text color="red" bold>Archive channel?</Text>
          <Text> </Text>
          <Text>This will archive #{selectedChannel.name} ({selectedChannel.id})</Text>
          <Text>Messages will be preserved but the channel will be inactive.</Text>
          <Text> </Text>
          <Text>Press 'y' to confirm, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // Create wizard: name
  if (mode === 'create-name') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Channel</Text>
          <Text> </Text>
          <Box>
            <Text>Name: #</Text>
            <TextInput
              value={createName}
              onChange={setCreateName}
              onSubmit={() => {
                if (createName.trim()) {
                  setMode('create-desc');
                }
              }}
              placeholder="e.g., general"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: description
  if (mode === 'create-desc') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Channel</Text>
          <Text>Name: #{createName}</Text>
          <Text> </Text>
          <Box>
            <Text>Description: </Text>
            <TextInput
              value={createDesc}
              onChange={setCreateDesc}
              onSubmit={() => {
                setMode('create-confirm');
              }}
              placeholder="(optional) What is this channel for?"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: confirm
  if (mode === 'create-confirm') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Confirm Channel Creation</Text>
          <Text> </Text>
          <Text>Name:        #{createName}</Text>
          {createDesc && <Text>Description: {createDesc}</Text>}
          <Text> </Text>
          <Text>Press 'y' to create, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // Invite
  if (mode === 'invite' && selectedChannel) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Invite to #{selectedChannel.name}</Text>
          <Text> </Text>
          <Box>
            <Text>Agent name: </Text>
            <TextInput
              value={inviteName}
              onChange={setInviteName}
              onSubmit={() => {
                if (inviteName.trim()) {
                  const result = manager.invite(selectedChannel.id, inviteName.trim(), inviteName.trim());
                  setStatusMessage(result.message);
                  setMode('list');
                  loadChannels();
                }
              }}
              placeholder="e.g., alice"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text color="gray">Loading...</Text>
    </Box>
  );
}
