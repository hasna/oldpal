import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { TelephonyManager, CallListItem, SmsListItem, PhoneNumber, RoutingRule, TelephonyStatus } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface TelephonyPanelProps {
  manager: TelephonyManager;
  onClose: () => void;
}

type Mode =
  | 'overview'
  | 'calls'
  | 'messages'
  | 'numbers'
  | 'routes'
  | 'sms-compose'
  | 'call-compose';

type Tab = 'overview' | 'calls' | 'messages' | 'numbers' | 'routes';

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

export function TelephonyPanel({ manager, onClose }: TelephonyPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [messages, setMessages] = useState<SmsListItem[]>([]);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [routes, setRoutes] = useState<RoutingRule[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeStep, setComposeStep] = useState<'to' | 'body'>('to');

  const loadData = () => {
    try {
      setStatus(manager.getStatus());
      setCalls(manager.getCallHistory({ limit: 20 }));
      setMessages(manager.getSmsHistory({ limit: 20 }));
      setNumbers(manager.listPhoneNumbers());
      setRoutes(manager.listRoutingRules());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const tabs: Tab[] = ['overview', 'calls', 'messages', 'numbers', 'routes'];

  useInput((input, key) => {
    // Don't handle during text input modes
    if (mode === 'sms-compose' || mode === 'call-compose') return;

    if (key.escape || input === 'q') {
      onClose();
      return;
    }

    // Tab switching with number keys
    if (input === '1') { setTab('overview'); setMode('overview'); setSelectedIndex(0); }
    else if (input === '2') { setTab('calls'); setMode('calls'); setSelectedIndex(0); }
    else if (input === '3') { setTab('messages'); setMode('messages'); setSelectedIndex(0); }
    else if (input === '4') { setTab('numbers'); setMode('numbers'); setSelectedIndex(0); }
    else if (input === '5') { setTab('routes'); setMode('routes'); setSelectedIndex(0); }

    // Tab switching with left/right
    if (key.leftArrow) {
      const idx = tabs.indexOf(tab);
      if (idx > 0) {
        const newTab = tabs[idx - 1];
        setTab(newTab);
        setMode(newTab);
        setSelectedIndex(0);
      }
    } else if (key.rightArrow) {
      const idx = tabs.indexOf(tab);
      if (idx < tabs.length - 1) {
        const newTab = tabs[idx + 1];
        setTab(newTab);
        setMode(newTab);
        setSelectedIndex(0);
      }
    }

    // List navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => {
        const maxIndex = getListLength() - 1;
        return Math.min(Math.max(0, maxIndex), prev + 1);
      });
    }

    // Actions
    if (input === 's' && (tab === 'overview' || tab === 'messages')) {
      setComposeTo('');
      setComposeBody('');
      setComposeStep('to');
      setMode('sms-compose');
    } else if (input === 'c' && (tab === 'overview' || tab === 'calls')) {
      setComposeTo('');
      setComposeStep('to');
      setMode('call-compose');
    } else if (input === 'r') {
      loadData();
      setStatusMessage('Refreshed');
    }
  });

  const getListLength = (): number => {
    switch (tab) {
      case 'calls': return calls.length;
      case 'messages': return messages.length;
      case 'numbers': return numbers.length;
      case 'routes': return routes.length;
      default: return 0;
    }
  };

  // Tab bar
  const tabBar = (
    <Box marginBottom={1}>
      {tabs.map((t, i) => (
        <Box key={t} marginRight={1}>
          <Text
            color={tab === t ? 'blue' : 'gray'}
            bold={tab === t}
          >
            {i + 1}:{t}
          </Text>
        </Box>
      ))}
    </Box>
  );

  // Header
  const header = (
    <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
      <Text bold color="blue">Telephony</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'sms-compose' ? 'esc:cancel' :
         mode === 'call-compose' ? 'esc:cancel' :
         'q:close s:sms c:call r:refresh'}
      </Text>
    </Box>
  );

  const statusBar2 = statusMessage ? (
    <Box marginBottom={1}><Text color="yellow">{statusMessage}</Text></Box>
  ) : null;

  const errorBar = error ? (
    <Box marginBottom={1}><Text color="red">Error: {error}</Text></Box>
  ) : null;

  // SMS compose
  if (mode === 'sms-compose') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Send SMS</Text>
          <Text> </Text>
          {composeStep === 'to' ? (
            <Box>
              <Text>To: </Text>
              <TextInput
                value={composeTo}
                onChange={setComposeTo}
                onSubmit={() => {
                  if (composeTo.trim()) setComposeStep('body');
                }}
                placeholder="+15551234567"
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>To: {composeTo}</Text>
              <Box>
                <Text>Body: </Text>
                <TextInput
                  value={composeBody}
                  onChange={setComposeBody}
                  onSubmit={async () => {
                    if (composeBody.trim()) {
                      const result = await manager.sendSms(composeTo.trim(), composeBody.trim());
                      setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                      setMode('messages');
                      setTab('messages');
                      loadData();
                    }
                  }}
                  placeholder="Type your message..."
                />
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Call compose
  if (mode === 'call-compose') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Make Call</Text>
          <Text> </Text>
          <Box>
            <Text>To: </Text>
            <TextInput
              value={composeTo}
              onChange={setComposeTo}
              onSubmit={async () => {
                if (composeTo.trim()) {
                  const result = await manager.makeCall(composeTo.trim());
                  setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                  setMode('calls');
                  setTab('calls');
                  loadData();
                }
              }}
              placeholder="+15551234567"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Overview tab
  if (tab === 'overview') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>System Status</Text>
          <Text> </Text>
          {status ? (
            <>
              <Text>Twilio:       {status.twilioConfigured ? <Text color="green">Connected</Text> : <Text color="red">Not configured</Text>}</Text>
              <Text>ElevenLabs:   {status.elevenLabsConfigured ? <Text color="green">Connected</Text> : <Text color="red">Not configured</Text>}</Text>
              <Text>Phone #s:     {status.phoneNumbers}</Text>
              <Text>Active calls: {status.activeCalls}</Text>
              <Text>Routes:       {status.routingRules}</Text>
              <Text> </Text>
              <Text color="gray">Press 's' to send SMS, 'c' to make a call</Text>
            </>
          ) : (
            <Text color="gray">Loading...</Text>
          )}
        </Box>
      </Box>
    );
  }

  // Calls tab
  if (tab === 'calls') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {calls.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No call history. Press 'c' to make a call.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {calls.map((call, i) => (
              <Box key={call.id}>
                <Text color={i === selectedIndex ? 'blue' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text color={call.direction === 'inbound' ? 'green' : 'cyan'}>
                  {call.direction === 'inbound' ? 'IN ' : 'OUT'}
                </Text>
                <Text> {call.fromNumber} → {call.toNumber}</Text>
                <Text color="gray"> | {call.status}</Text>
                {call.duration != null && <Text color="gray"> | {call.duration}s</Text>}
                <Text color="gray"> | {formatRelativeTime(call.createdAt)}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Messages tab
  if (tab === 'messages') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {messages.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No messages. Press 's' to send an SMS.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {messages.map((msg, i) => (
              <Box key={msg.id} flexDirection="column">
                <Box>
                  <Text color={i === selectedIndex ? 'blue' : undefined}>
                    {i === selectedIndex ? '▸ ' : '  '}
                  </Text>
                  <Text color={msg.direction === 'inbound' ? 'green' : 'cyan'}>
                    {msg.direction === 'inbound' ? 'IN ' : 'OUT'}
                  </Text>
                  <Text color={msg.messageType === 'whatsapp' ? 'green' : undefined}>
                    [{msg.messageType === 'whatsapp' ? 'WA' : 'SMS'}]
                  </Text>
                  <Text> {msg.fromNumber} → {msg.toNumber}</Text>
                  <Text color="gray"> | {formatRelativeTime(msg.createdAt)}</Text>
                </Box>
                <Box paddingLeft={4}>
                  <Text color="gray">{msg.bodyPreview}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Numbers tab
  if (tab === 'numbers') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {numbers.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No phone numbers. Run /phone sync to import from Twilio.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {numbers.map((num, i) => {
              const caps: string[] = [];
              if (num.capabilities.voice) caps.push('voice');
              if (num.capabilities.sms) caps.push('sms');
              if (num.capabilities.whatsapp) caps.push('whatsapp');
              return (
                <Box key={num.id}>
                  <Text color={i === selectedIndex ? 'blue' : undefined}>
                    {i === selectedIndex ? '▸ ' : '  '}
                  </Text>
                  <Text bold={i === selectedIndex}>{num.number}</Text>
                  {num.friendlyName && <Text color="gray"> ({num.friendlyName})</Text>}
                  <Text color="gray"> [{caps.join(', ')}]</Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  // Routes tab
  if (tab === 'routes') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {routes.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No routing rules configured.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {routes.map((rule, i) => (
              <Box key={rule.id} flexDirection="column">
                <Box>
                  <Text color={i === selectedIndex ? 'blue' : undefined}>
                    {i === selectedIndex ? '▸ ' : '  '}
                  </Text>
                  <Text bold={i === selectedIndex}>{rule.name}</Text>
                  <Text color="gray"> (priority: {rule.priority})</Text>
                  {!rule.enabled && <Text color="red"> [DISABLED]</Text>}
                </Box>
                <Box paddingLeft={4}>
                  <Text color="gray">
                    Type: {rule.messageType} → {rule.targetAssistantName}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
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
