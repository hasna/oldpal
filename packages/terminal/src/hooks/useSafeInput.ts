import { useEffect } from 'react';
import { useStdin, type Key } from 'ink';
// Inline minimal keypress parser to avoid depending on ink internals
function parseKeypress(s: string): { name: string; ctrl: boolean; shift: boolean; meta: boolean; option: boolean; sequence: string } {
  const key = { name: '', ctrl: false, shift: false, meta: false, option: false, sequence: s };
  if (s === '\r' || s === '\n') { key.name = 'return'; }
  else if (s === '\x1b') { key.name = 'escape'; }
  else if (s === '\t') { key.name = 'tab'; }
  else if (s === '\x7f' || s === '\b') { key.name = 'backspace'; }
  else if (s === '\x1b[A') { key.name = 'up'; }
  else if (s === '\x1b[B') { key.name = 'down'; }
  else if (s === '\x1b[C') { key.name = 'right'; }
  else if (s === '\x1b[D') { key.name = 'left'; }
  else if (s === '\x1b[5~') { key.name = 'pageup'; }
  else if (s === '\x1b[6~') { key.name = 'pagedown'; }
  else if (s === '\x1b[H' || s === '\x1bOH') { key.name = 'home'; }
  else if (s === '\x1b[F' || s === '\x1bOF') { key.name = 'end'; }
  else if (s === '\x1b[3~') { key.name = 'delete'; }
  else if (s.length === 1 && s.charCodeAt(0) <= 26) {
    key.ctrl = true;
    key.name = String.fromCharCode(s.charCodeAt(0) + 96);
  } else if (s.startsWith('\x1b') && s.length === 2) {
    key.meta = true;
    key.name = s[1];
  } else {
    key.name = s;
  }
  return key;
}
const NON_ALPHA_KEYS = ['up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'delete', 'backspace', 'return', 'escape', 'tab'];

type Handler = (input: string, key: Key) => void;
type Options = { isActive?: boolean };

// Input hook that avoids toggling raw mode off when handlers deactivate.
export function useSafeInput(handler: Handler, options: Options = {}): void {
  const { internal_eventEmitter, internal_exitOnCtrlC, setRawMode, isRawModeSupported } = useStdin() as {
    internal_eventEmitter?: NodeJS.EventEmitter;
    internal_exitOnCtrlC?: boolean;
    setRawMode?: (isEnabled: boolean) => void;
    isRawModeSupported?: boolean;
  };

  useEffect(() => {
    if (!isRawModeSupported || !setRawMode) return;
    setRawMode(true);
    return () => {
      setRawMode(false);
    };
  }, [isRawModeSupported, setRawMode]);

  useEffect(() => {
    if (options.isActive === false) return;
    if (!internal_eventEmitter) return;

    const handleData = (data: string) => {
      const keypress = parseKeypress(data);
      const key = {
        upArrow: keypress.name === 'up',
        downArrow: keypress.name === 'down',
        leftArrow: keypress.name === 'left',
        rightArrow: keypress.name === 'right',
        pageDown: keypress.name === 'pagedown',
        pageUp: keypress.name === 'pageup',
        home: keypress.name === 'home',
        end: keypress.name === 'end',
        return: keypress.name === 'return',
        escape: keypress.name === 'escape',
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: keypress.name === 'tab',
        backspace: keypress.name === 'backspace',
        delete: keypress.name === 'delete',
        meta: keypress.meta || keypress.name === 'escape' || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (NON_ALPHA_KEYS.includes(keypress.name)) {
        input = '';
      }
      if (input.startsWith('\u001B')) {
        input = input.slice(1);
      }
      if (input.length === 1 && typeof input[0] === 'string' && /[A-Z]/.test(input[0])) {
        key.shift = true;
      }

      if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
        handler(input, key);
      }
    };

    internal_eventEmitter.on('input', handleData);
    return () => {
      internal_eventEmitter.removeListener('input', handleData);
    };
  }, [handler, internal_eventEmitter, internal_exitOnCtrlC, options.isActive]);
}
