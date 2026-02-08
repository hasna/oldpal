import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ChannelsManager, ChannelListItem, ChannelMessage, ChannelMember, Channel } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

// Slack's base aubergine color for channel badges
const SLACK_COLOR = '#4A154B';

// Deterministic color palette for assistant badges (white text on colored bg)
const ASSISTANT_COLORS = [
  '#6B4C9A', // purple
  '#2E86AB', // cerulean
  '#A23B72', // mulberry
  '#1B813E', // forest
  '#C1440E', // rust
  '#5B5EA6', // indigo
  '#9B2335', // crimson
  '#2D6A4F', // teal green
  '#7C4DFF', // violet
  '#D4621B', // tangerine
];

function getAssistantColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return ASSISTANT_COLORS[Math.abs(hash) % ASSISTANT_COLORS.length];
}

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
  const lastSubmitTimeRef = useRef<number>(0);

  // @mention dropdown state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [chatMembers, setChatMembers] = useState<ChannelMember[]>([]);

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

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, channels.length - 1)));
  }, [channels.length]);

  const openChannel = (nameOrId: string) => {
    const ch = manager.getChannel(nameOrId);
    if (ch) {
      setSelectedChannel(ch);
      const result = manager.readMessages(ch.id, 50);
      setMessages(result?.messages || []);
      setChatMembers(manager.getMembers(ch.id));
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

  // Filtered mention candidates
  const mentionCandidates = useMemo(() => {
    if (!mentionActive) return [];
    const q = mentionQuery.toLowerCase();
    return chatMembers.filter((m) =>
      m.assistantName.toLowerCase().includes(q)
    );
  }, [mentionActive, mentionQuery, chatMembers]);

  // Track @mention trigger via onChange
  const handleChatInputChange = (value: string) => {
    const prev = chatInput;
    setChatInput(value);

    // Detect new @ typed (value grew by 1 char and the new char is @)
    if (value.length === prev.length + 1 && value[value.length - 1] === '@' && !mentionActive) {
      setMentionActive(true);
      setMentionQuery('');
      setMentionIndex(0);
      return;
    }

    // If mention dropdown is active, update the query
    if (mentionActive) {
      // Find the last @ in the value to extract the query after it
      const lastAt = value.lastIndexOf('@');
      if (lastAt >= 0) {
        const afterAt = value.slice(lastAt + 1);
        // If user typed a space or deleted past the @, dismiss
        if (lastAt > prev.lastIndexOf('@') + prev.slice(prev.lastIndexOf('@') + 1).length + 1) {
          // @ was deleted
          setMentionActive(false);
        } else {
          setMentionQuery(afterAt);
          setMentionIndex(0);
        }
      } else {
        // No @ in input anymore — dismiss
        setMentionActive(false);
      }
    }
  };

  // Insert selected mention into chat input
  const insertMention = (memberName: string) => {
    const lastAt = chatInput.lastIndexOf('@');
    if (lastAt >= 0) {
      const before = chatInput.slice(0, lastAt);
      const needsQuotes = memberName.includes(' ');
      const mention = needsQuotes ? `@"${memberName}" ` : `@${memberName} `;
      setChatInput(before + mention);
    }
    setMentionActive(false);
    setMentionQuery('');
    setMentionIndex(0);
  };

  useInput((input, key) => {
    // Handle mention dropdown navigation when active
    if (mentionActive && mode === 'chat') {
      if (key.escape) {
        setMentionActive(false);
        setMentionQuery('');
        return;
      }
      if (key.upArrow) {
        if (mentionCandidates.length === 0) {
          setMentionIndex(0);
        } else {
          setMentionIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (mentionCandidates.length === 0) {
          setMentionIndex(0);
        } else {
          setMentionIndex((prev) => Math.min(mentionCandidates.length - 1, prev + 1));
        }
        return;
      }
      if (key.tab && mentionCandidates.length > 0) {
        insertMention(mentionCandidates[mentionIndex].assistantName);
        return;
      }
      // Let other keys pass through to TextInput
    }

    // In text-entry modes (chat, create, invite), only handle Escape
    const isTextEntry = mode === 'create-name' || mode === 'create-desc' || mode === 'invite' || mode === 'chat';

    if (key.escape || input === 'q' && !isTextEntry) {
      if (key.escape && mode === 'list' || input === 'q' && mode === 'list') {
        onClose();
      } else if (key.escape) {
        setMode('list');
        setSelectedChannel(null);
        setStatusMessage(null);
        setMentionActive(false);
      }
      return;
    }

    // Don't handle other keys during text entry - let TextInput receive them
    if (isTextEntry) return;

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        if (channels.length === 0) {
          setSelectedIndex(0);
        } else {
          setSelectedIndex((prev) => Math.min(channels.length - 1, prev + 1));
        }
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
  });

  // Header
  const header = (
    <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
      <Text backgroundColor={SLACK_COLOR} color="white" bold> Channels </Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'list' ? 'q:close c:create enter:open m:members i:invite l:leave d:delete r:refresh' :
         mode === 'chat' ? 'esc:back (type to chat, @ to mention)' :
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
          <Text backgroundColor={SLACK_COLOR} color="white" bold> #{selectedChannel.name} </Text>
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
                <Text backgroundColor={getAssistantColor(msg.senderName)} color="white" bold> {msg.senderName} </Text>
                <Text color="gray"> {formatRelativeTime(msg.createdAt)}: </Text>
                <Text>{msg.content}</Text>
              </Box>
            ))
          )}
        </Box>

        <Box paddingX={1} borderStyle="single" borderColor="gray">
          <Text color="gray">{'> '}</Text>
          <TextInput
            value={chatInput}
            onChange={handleChatInputChange}
            onSubmit={() => {
              if (chatInput.trim()) {
                // Dedup guard: prevent double-firing within 500ms
                const now = Date.now();
                if (now - lastSubmitTimeRef.current < 500) return;
                lastSubmitTimeRef.current = now;

                const msg = chatInput.trim();
                // Send as person if logged in, otherwise as assistant
                const result = activePersonId && activePersonName
                  ? manager.sendAs(selectedChannel.id, msg, activePersonId, activePersonName)
                  : manager.send(selectedChannel.id, msg);
                if (result.success) {
                  setChatInput('');
                  setMentionActive(false);
                  // Reload messages
                  const updated = manager.readMessages(selectedChannel.id, 50);
                  setMessages(updated?.messages || []);
                  // Trigger assistant to respond and start polling for reply
                  if (activePersonId && activePersonName && onPersonMessage && selectedChannel) {
                    onPersonMessage(selectedChannel.name, activePersonName, msg);
                    setStatusMessage('Assistant is thinking...');
                    // Poll for assistant's reply every 2 seconds for up to 60 seconds
                    const channelId = selectedChannel.id;
                    const currentCount = updated?.messages.length || 0;
                    let polls = 0;
                    const pollInterval = setInterval(() => {
                      polls++;
                      const fresh = manager.readMessages(channelId, 50);
                      if (fresh) {
                        setMessages(fresh.messages);
                        if (fresh.messages.length > currentCount) {
                          // New message arrived (assistant replied)
                          clearInterval(pollInterval);
                          setStatusMessage(null);
                        }
                      }
                      if (polls >= 30) {
                        clearInterval(pollInterval);
                        setStatusMessage(null);
                      }
                    }, 2000);
                  }
                } else {
                  setStatusMessage(`Error: ${result.message}`);
                }
              }
            }}
            placeholder="Type a message... (@ to mention)"
          />
        </Box>

        {mentionActive && mentionCandidates.length > 0 && (
          <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor="yellow" marginTop={0}>
            <Text color="yellow" bold>Members (Tab to select, Esc to dismiss)</Text>
            {mentionCandidates.slice(0, 8).map((m, i) => (
              <Box key={m.assistantId}>
                <Text color={i === mentionIndex ? 'blue' : undefined}>
                  {i === mentionIndex ? '▸ ' : '  '}
                </Text>
                <Text bold={i === mentionIndex} color={i === mentionIndex ? 'blue' : undefined}>
                  {m.assistantName}
                </Text>
                <Text color="gray">
                  {m.memberType === 'person' ? ' [person]' : ' [assistant]'}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Members view
  if (mode === 'members' && selectedChannel) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} marginBottom={1}>
          <Text backgroundColor={SLACK_COLOR} color="white" bold> #{selectedChannel.name} </Text>
          <Text bold> Members ({members.length})</Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {members.map((m) => (
            <Box key={`${m.channelId}-${m.assistantId}`}>
              <Text>  </Text>
              <Text backgroundColor={getAssistantColor(m.assistantName)} color="white" bold> {m.assistantName} </Text>
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
