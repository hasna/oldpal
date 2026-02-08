import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { PeopleManager, PersonListItem } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface PeoplePanelProps {
  manager: PeopleManager;
  onClose: () => void;
}

type Mode =
  | 'list'
  | 'create-name'
  | 'create-email'
  | 'create-confirm'
  | 'delete-confirm';

export function PeoplePanel({ manager, onClose }: PeoplePanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Create wizard state
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');

  const loadPeople = () => {
    try {
      const list = manager.listPeople();
      setPeople(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadPeople();
  }, []);

  useInput((input, key) => {
    // Don't handle input during text entry modes
    if (mode === 'create-name' || mode === 'create-email') return;

    if (key.escape || input === 'q') {
      if (mode === 'list') {
        onClose();
      } else {
        setMode('list');
        setStatusMessage(null);
      }
      return;
    }

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((prev) => Math.min(people.length - 1, prev + 1));
      } else if (key.return && people.length > 0) {
        // Login/switch to selected person
        const person = people[selectedIndex];
        manager.setActivePerson(person.id).then(() => {
          setStatusMessage(`Logged in as ${person.name}`);
          loadPeople();
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
        });
      } else if (input === 'c') {
        setCreateName('');
        setCreateEmail('');
        setMode('create-name');
      } else if (input === 'l') {
        // Logout
        manager.logout().then(() => {
          setStatusMessage('Logged out');
          loadPeople();
        });
      } else if (input === 'd' && people.length > 0) {
        setMode('delete-confirm');
      } else if (input === 'r') {
        loadPeople();
        setStatusMessage('Refreshed');
      }
    } else if (mode === 'delete-confirm') {
      if (input === 'y' && people.length > 0) {
        const person = people[selectedIndex];
        manager.deletePerson(person.id).then(() => {
          setStatusMessage(`Deleted ${person.name}`);
          setMode('list');
          loadPeople();
          if (selectedIndex >= people.length - 1) {
            setSelectedIndex(Math.max(0, selectedIndex - 1));
          }
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
          setMode('list');
        });
      } else if (input === 'n') {
        setMode('list');
      }
    } else if (mode === 'create-confirm') {
      if (input === 'y') {
        manager.createPerson({
          name: createName,
          email: createEmail || undefined,
        }).then((person) => {
          return manager.setActivePerson(person.id).then(() => {
            setStatusMessage(`Created and logged in as ${person.name}`);
            setMode('list');
            loadPeople();
          });
        }).catch((err: Error) => {
          setStatusMessage(`Error: ${err.message}`);
          setMode('list');
        });
      } else if (input === 'n') {
        setMode('list');
      }
    }
  });

  // Header
  const header = (
    <Box borderStyle="single" borderColor="green" paddingX={1} marginBottom={1}>
      <Text bold color="green">People</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'list' ? 'q:close c:create enter:login l:logout d:delete r:refresh' :
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
        {people.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No people registered. Press 'c' to create one.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {people.map((p, i) => (
              <Box key={p.id}>
                <Text color={i === selectedIndex ? 'green' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text bold={i === selectedIndex} color={i === selectedIndex ? 'green' : undefined}>
                  {p.name}
                </Text>
                {p.email && (
                  <Text color="gray"> &lt;{p.email}&gt;</Text>
                )}
                {p.isActive && (
                  <Text color="cyan"> (active)</Text>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirm
  if (mode === 'delete-confirm' && people.length > 0) {
    const person = people[selectedIndex];
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text color="red" bold>Delete person?</Text>
          <Text> </Text>
          <Text>This will permanently delete {person.name} ({person.id})</Text>
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
          <Text bold>Create Person</Text>
          <Text> </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={createName}
              onChange={setCreateName}
              onSubmit={() => {
                if (createName.trim()) {
                  setMode('create-email');
                }
              }}
              placeholder="e.g., Andrei"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: email
  if (mode === 'create-email') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Person</Text>
          <Text>Name: {createName}</Text>
          <Text> </Text>
          <Box>
            <Text>Email: </Text>
            <TextInput
              value={createEmail}
              onChange={setCreateEmail}
              onSubmit={() => {
                setMode('create-confirm');
              }}
              placeholder="(optional) e.g., andrei@hasna.com"
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
          <Text bold>Confirm Person Creation</Text>
          <Text> </Text>
          <Text>Name:  {createName}</Text>
          {createEmail && <Text>Email: {createEmail}</Text>}
          <Text> </Text>
          <Text>Press 'y' to create, 'n' to cancel.</Text>
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
